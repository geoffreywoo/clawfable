import { createHash, randomUUID } from 'node:crypto';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';
import { EFFICIENT_GENERATION_POLICY } from './generation-efficiency';
import { captureOriginalPaidRecovery, ORIGINAL_PAID_RECOVERY_KEY } from './original-paid-recovery';
import { committedAiSpend, nextAiBudgetDayAt, type AiBudgetExhaustionScope, type AiSpendAttempt, type AiSpendLedger } from './ai-budget';

export const GENERATION_JOB_VERSION = 'durable-original-2';
export const GENERATION_JOB_NAMESPACE = 'generation-job';
export interface GenerationJob {
  version: string;
  id: string;
  policy: string;
  input: unknown;
  createdAt: number;
  expiresAt: number;
  owner: string | null;
  leaseUntil: number;
  stage: string;
  status: 'running' | 'deferred' | 'assessed' | 'queued' | 'failed';
  blocker: string | null;
  nextAttemptAt: number;
  failures: number;
  checkpoints: Record<string, unknown>;
  revision?: number;
  result?: unknown[];
}
export function durableGenerationEnabled(agentId: string, settings: { durableGenerationEnabled?: boolean }): boolean {
  return agentId === '13' && settings.durableGenerationEnabled === true;
}
export const getGenerationJob = (agentId: string) => getAiOperationalState<GenerationJob>(agentId, GENERATION_JOB_NAMESPACE);
export const getGenerationJobRecord = (agentId:string, id:string) => getAiOperationalState<GenerationJob>(agentId, `generation-job:${id}`);
async function archiveGenerationJob(agentId:string, job:GenerationJob):Promise<void> {
  await mutateAiOperationalState<GenerationJob,void>(agentId,`generation-job:${job.id}`,stored=>
    stored && (stored.revision || 0) > (job.revision || 0)
      ? {value:stored,result:undefined,skip:true}
      : {value:job,result:undefined});
}
export function jobFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export async function claimGenerationJob(agentId: string, input: unknown, policy: string, now = Date.now(), compatiblePolicy?: (job:GenerationJob)=>boolean): Promise<GenerationJob | null> {
  const owner = randomUUID();
  const previous = await getGenerationJob(agentId);
  // Archive before replacing the active pointer. A crash or newer worker
  // cannot erase paid artifacts merely because the old job became terminal.
  if (previous) await archiveGenerationJob(agentId,previous);
  return mutateAiOperationalState<GenerationJob, GenerationJob | null>(agentId, GENERATION_JOB_NAMESPACE, current => {
    if (current && current.leaseUntil > now && current.owner) return {value: current, result: null, skip: true};
    // A policy change or expired subject cannot reset today's account allowance.
    if (current?.blocker === 'budget_daily_exhausted' && current.nextAttemptAt > now) return {value: current, result: null, skip: true};
    const batchCooldown = current?.status === 'failed' && ['quality_empty','no_qualified_context','budget_job_exhausted','queue_rejected'].includes(current.blocker || '');
    if (current && current.nextAttemptAt > now && current.policy === policy && (current.expiresAt > now || batchCooldown)) return {value: current, result: null, skip: true};
    const hasReserve = current?.status === 'queued' && (current.checkpoints.reserveIdeas as string[] || []).length > 0;
    const reusable = current && (current.policy === policy || compatiblePolicy?.(current)) && current.expiresAt > now && (hasReserve || !['queued','failed'].includes(current.status));
    if (!reusable && current && (current.id !== previous?.id || (current.revision || 0) !== (previous?.revision || 0))) return {value:current,result:null,skip:true};
    const value: GenerationJob = reusable ? {...current, policy, owner, leaseUntil: now + 300_000, status: current.status === 'assessed' ? 'assessed' : 'running',...(hasReserve ? {result:undefined,blocker:null,stage:'ideas_ready'} : {})} : {
      version: GENERATION_JOB_VERSION, id: `generation-job-${randomUUID()}`, policy, input,
      createdAt: now, expiresAt: now + 24*3600_000, owner, leaseUntil: now + 300_000,
      stage: 'subject_ready', status: 'running', blocker: null, nextAttemptAt: 0, failures: 0, checkpoints: {},
    };
    if (reusable && current.policy !== policy) {
      // Re-run deterministic normalization and assessment under the current
      // policy. Preserve raw paid response checkpoints: identical stage
      // contracts replay, changed prompts buy only that affected stage.
      const paidRecovery = captureOriginalPaidRecovery(current);
      value.status='running';value.result=undefined;value.blocker=null;value.nextAttemptAt=0;
      value.checkpoints=Object.fromEntries(Object.entries(current.checkpoints).filter(([key])=>!['ideaNormalizationVersion','ideas_ready','subjects_ready','briefs'].includes(key) && !key.startsWith('assessed:') && !key.startsWith('drafts_ready') && !key.startsWith('repair:')));
      if (paidRecovery) value.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] = paidRecovery;
    }
    value.revision = (reusable ? current.revision || 0 : 0) + 1;
    return {value, result: value};
  });
}
export async function updateGenerationJob(agentId: string, job: Pick<GenerationJob,'id'|'owner'>, update: (current: GenerationJob) => GenerationJob, now = Date.now()): Promise<GenerationJob> {
  const saved = await mutateAiOperationalState<GenerationJob, GenerationJob>(agentId, GENERATION_JOB_NAMESPACE, current => {
    if (!current || current.id !== job.id || current.owner !== job.owner || current.leaseUntil <= now) throw new Error('generation_lease_lost');
    const value = {...update(current),revision:(current.revision || 0)+1};
    return {value, result:value};
  });
  await archiveGenerationJob(agentId,saved);
  return saved;
}
export class GenerationJobSession {
  deferred = false;
  constructor(readonly agentId: string, public job: GenerationJob) {}
  async checkpoint<T>(key: string, compute: () => Promise<T>): Promise<T> {
    if (Object.prototype.hasOwnProperty.call(this.job.checkpoints, key)) return structuredClone(this.job.checkpoints[key]) as T;
    await this.write(current => ({...current, stage:key.startsWith('call:') ? key.split(':')[1] : key}));
    const value = await compute();
    if ((key === "ideas_ready" || key.startsWith("drafts_ready") || key.startsWith('repair:')) && Array.isArray(value) && !value.length) throw new Error("stage_output_unavailable");
    await this.write(current => ({...current, checkpoints:{...current.checkpoints,[key]:value}}));
    return structuredClone(value);
  }
  async write(update: (job: GenerationJob) => GenerationJob) {
    this.job = await updateGenerationJob(this.agentId, this.job, update);
  }
  async finish(result: unknown[], outcome: string, options: { budgetScope?: AiBudgetExhaustionScope } = {}) {
    const now = Date.now();
    const jobBudgetExhausted = outcome === 'budget_exhausted' && options.budgetScope === 'job';
    const dailyBudgetExhausted = outcome === 'budget_exhausted' && options.budgetScope === 'daily';
    const reserve = outcome === 'quality_empty' && !this.deferred && (this.job.checkpoints.reserveIdeas as string[] || []).length > 0;
    if (reserve) await this.write(current=>({...current,checkpoints:{...current.checkpoints,attemptedIdeas:[...current.checkpoints.attemptedIdeas as string[] || [],...current.checkpoints.selectedIdeas as string[] || []]}}));
    // Anything other than a completed editorial/context decision remains
    // resumable. New provider/storage error codes must not discard paid work.
    const operational = !result.length && !jobBudgetExhausted && (reserve || this.deferred || !['quality_empty','no_qualified_context','payment_required','voice_not_ready','subject_expired','stale_evidence'].includes(outcome));
    await this.write(current => ({...current, result:result.length ? result : undefined,
      // Repeated provider trouble must not discard paid stages and restart
      // ideation. Keep the job resumable while it is valid, with capped backoff.
      status:result.length ? 'assessed' : operational ? 'deferred' : 'failed',
      blocker:result.length ? null : jobBudgetExhausted ? 'budget_job_exhausted' : dailyBudgetExhausted ? 'budget_daily_exhausted' : this.deferred ? 'stage_deferred' : reserve ? 'reserve_ready' : outcome,
      failures:current.failures + (operational && !this.deferred && !reserve && !dailyBudgetExhausted ? 1 : 0),
      nextAttemptAt: result.length ? 0 : dailyBudgetExhausted ? nextAiBudgetDayAt(now) : outcome === 'malformed_output' ? current.expiresAt : now + (reserve || this.deferred ? 1000 : jobBudgetExhausted || ['quality_empty','no_qualified_context'].includes(outcome) ? 30*60_000 : Math.min(120,10*2**current.failures)*60_000),
      owner:result.length ? current.owner : null,leaseUntil:result.length ? current.leaseUntil : 0}));
  }
}
export async function acknowledgeGenerationQueue(agentId: string, runId: string, queued: boolean): Promise<void> {
  await mutateAiOperationalState<GenerationJob,void>(agentId,GENERATION_JOB_NAMESPACE,current=>{
    if (!current || current.id !== runId) return {value:current!,result:undefined,skip:true};
    const attemptedIdeas=[...new Set([...current.checkpoints.attemptedIdeas as string[] || [],...current.checkpoints.selectedIdeas as string[] || []])];
    return {value:{...current,status:queued?'queued':'failed',owner:null,leaseUntil:0,stage:queued?'queued':current.stage,blocker:queued?null:'queue_rejected',nextAttemptAt:queued?0:Date.now()+30*60_000,revision:(current.revision || 0)+1,
      checkpoints:{...current.checkpoints,attemptedIdeas,...(queued ? {
        queuedIdeas:[...new Set([...current.checkpoints.queuedIdeas as string[] || [],...current.checkpoints.selectedIdeas as string[] || []])],
      } : {})}},result:undefined};
  });
}

export interface CanaryRecoveryEvidence {
  id: string;
  policy: string;
  evidenceRef: string;
  evidenceHash: string;
}
export interface GenerationCanary { id:string; limitUsd:number; emptyRuns:number; emptyAttemptIds?:string[]; queuedIds:string[]; status:'active'|'passed'|'blocked'; blockedPolicy?:string; blockedReason?:string; resumedFromPolicy?:string;
  recoveries?: Array<CanaryRecoveryEvidence & { resumedAt:string; previousEmptyRuns:number; previousEmptyAttemptIds:string[]; previousPolicy:string }>;
}
/** Identifies code; a version change alone is not evidence that a blocker is fixed. */
export const canaryPolicyKey = () => `${GENERATION_JOB_VERSION}:${EFFICIENT_GENERATION_POLICY}`;
export function generationCanaryAttemptId(canary:GenerationCanary | null, jobId:string, ideaIds:string[]):string {
  const attempt=`${jobId}:${ideaIds.join(',') || 'ideas'}`;
  const recovery=canary?.recoveries?.at(-1);
  return recovery ? `${recovery.id}:${attempt}` : attempt;
}
/**
 * Called explicitly after reviewing the referenced offline evaluation. Worker
 * ticks never authorize recovery merely because a deployment changed policy.
 * Keep campaign spending and all attempt identities across recovery windows.
 */
export async function resumeGenerationCanaryWithEvidence(agentId:string, evidence:CanaryRecoveryEvidence): Promise<GenerationCanary | null> {
  if (!evidence?.id?.trim() || evidence.policy !== canaryPolicyKey() || !evidence.evidenceRef?.trim() || !/^[a-f0-9]{64}$/i.test(evidence.evidenceHash || '')) {
    throw new Error('canary_recovery_evidence_required');
  }
  const retired = await getRetiredGenerationCanary(agentId);
  if (retired) return retired.canary;
  return mutateAiOperationalState<GenerationCanary,GenerationCanary | null>(agentId,'generation-canary',state=>{
    if (!state || state.status!=='blocked' || state.recoveries?.some(r=>r.id===evidence.id || r.evidenceHash===evidence.evidenceHash)) return {value:state!,result:state || null,skip:true};
    const previousPolicy=state.blockedPolicy || 'unrecorded';
    const recovery={...evidence,resumedAt:new Date().toISOString(),previousEmptyRuns:state.emptyRuns,previousEmptyAttemptIds:[...state.emptyAttemptIds || []],previousPolicy};
    const value:GenerationCanary={...state,status:'active',emptyRuns:0,blockedPolicy:undefined,blockedReason:undefined,resumedFromPolicy:previousPolicy,recoveries:[...state.recoveries || [],recovery]};
    return {value,result:value};
  });
}
export const getGenerationCanary = (agentId:string) => getAiOperationalState<GenerationCanary>(agentId,'generation-canary');
export interface RetiredGenerationCanary {
  retiredAt: string;
  reason: 'continuous_generation';
  canary: GenerationCanary;
  /** Immutable campaign receipts. The complete live account ledger stays authoritative. */
  campaignAttempts: Record<string, AiSpendAttempt>;
  campaignCommittedUsd: number;
}
export const getRetiredGenerationCanary = (agentId: string) => getAiOperationalState<RetiredGenerationCanary>(agentId, 'generation-canary-retired');

/** Archive once; never reset a canary, paid attempt, completion hold, or allowance. */
export async function retireGenerationCanary(agentId: string): Promise<GenerationCanary | null> {
  const retired = await getRetiredGenerationCanary(agentId);
  if (retired) return retired.canary;
  const canary = await getGenerationCanary(agentId);
  if (!canary) return null;
  const spend = await getAiOperationalState<AiSpendLedger>(agentId, 'spend');
  const campaignAttempts = Object.fromEntries(Object.entries(spend?.attempts || {}).filter(([,attempt]) => attempt.campaignId === canary.id));
  const archived = await mutateAiOperationalState<RetiredGenerationCanary, RetiredGenerationCanary>(agentId, 'generation-canary-retired', existing => {
    if (existing) return { value: existing, result: existing, skip: true };
    const value: RetiredGenerationCanary = { retiredAt: new Date().toISOString(), reason: 'continuous_generation',
      canary, campaignAttempts, campaignCommittedUsd: Object.values(campaignAttempts)
        .reduce((total, attempt) => total + committedAiSpend(attempt), 0) };
    return { value, result: value };
  });
  return archived.canary;
}
/** Reconcile completed decisions before another paid stage, including crashes before finish. */
export async function reconcileGenerationCanaryAssessments(agentId: string, job: GenerationJob): Promise<GenerationCanary | null> {
  const canary = await getGenerationCanary(agentId);
  if (await getRetiredGenerationCanary(agentId)) return canary;
  if (canary?.status !== 'active') return canary;
  for (const [key, value] of Object.entries(job.checkpoints)) {
    if (!key.startsWith('assessed:')) continue;
    const assessment = value as { canaryAttemptId?: string; selected?: unknown[]; drafts?: Array<{ draft?: { status?: string } }> };
    const attemptId = generationCanaryAttemptId(canary, job.id, [key.slice('assessed:'.length)]);
    if (!Array.isArray(assessment?.selected) || assessment.selected.length || !assessment.drafts?.length
      || assessment.canaryAttemptId !== attemptId
      || !assessment.drafts.every(row => row.draft?.status === 'rejected')) continue;
    await recordGenerationCanary(agentId, { empty: true, attemptId });
  }
  return getGenerationCanary(agentId);
}
export async function recordGenerationCanary(agentId:string, event:{queuedId?:string;empty?:boolean;attemptId?:string}) {
  if (await getRetiredGenerationCanary(agentId)) return;
  return mutateAiOperationalState<GenerationCanary,void>(agentId,'generation-canary',state=>{
    if (!state || state.status!=='active') return {value:state!,result:undefined,skip:true};
    if(event.empty && event.attemptId && state.emptyAttemptIds?.includes(event.attemptId)) return {value:state,result:undefined,skip:true};
    const queuedIds=[...new Set([...state.queuedIds,...event.queuedId?[event.queuedId]:[]])];
    const emptyRuns=event.queuedId ? 0 : state.emptyRuns+(event.empty?1:0);
    const emptyAttemptIds=event.empty && event.attemptId ? [...state.emptyAttemptIds || [],event.attemptId] : state.emptyAttemptIds;
    const status:GenerationCanary['status']=queuedIds.length>=2?'passed':emptyRuns>=3?'blocked':'active';
    return {value:{...state,queuedIds,emptyRuns,emptyAttemptIds,status,...(status==='blocked'?{blockedPolicy:canaryPolicyKey(),blockedReason:'canary_empty_limit'}:{})},result:undefined};
  });
}
