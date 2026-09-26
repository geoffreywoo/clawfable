import { createHash, randomUUID } from 'node:crypto';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';

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
    if (current && current.nextAttemptAt > now && current.policy === policy && current.expiresAt > now) return {value: current, result: null, skip: true};
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
      value.status='running';value.result=undefined;value.blocker=null;
      value.checkpoints=Object.fromEntries(Object.entries(current.checkpoints).filter(([key])=>key!=='ideaNormalizationVersion' && !key.startsWith('drafts_ready') && !key.startsWith('repair:')));
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
  async finish(result: unknown[], outcome: string) {
    const reserve = outcome === 'quality_empty' && !this.deferred && (this.job.checkpoints.reserveIdeas as string[] || []).length > 0;
    if (reserve) await this.write(current=>({...current,checkpoints:{...current.checkpoints,attemptedIdeas:[...current.checkpoints.attemptedIdeas as string[] || [],...current.checkpoints.selectedIdeas as string[] || []]}}));
    const operational = reserve || this.deferred || ['run_deadline','provider_failure','idea_generation_failed','idea_judgment_failed','copy_judgment_failed','writing_failed','malformed_output','budget_exhausted','budget_unavailable','evaluation_deferred','stage_output_unavailable'].includes(outcome);
    await this.write(current => ({...current, result:result.length ? result : undefined,
      // Repeated provider trouble must not discard paid stages and restart
      // ideation. Keep the job resumable while it is valid, with capped backoff.
      status:result.length ? 'assessed' : operational ? 'deferred' : 'failed',
      blocker:result.length ? null : this.deferred ? 'stage_deferred' : reserve ? 'reserve_ready' : outcome,
      failures:current.failures + (operational && !this.deferred ? 1 : 0),
      nextAttemptAt: result.length ? 0 : Date.now() + (reserve || this.deferred ? 1000 : outcome === 'quality_empty' ? 30*60_000 : Math.min(120,10*2**current.failures)*60_000),
      owner:result.length ? current.owner : null,leaseUntil:result.length ? current.leaseUntil : 0}));
  }
}
export async function acknowledgeGenerationQueue(agentId: string, runId: string, queued: boolean): Promise<void> {
  await mutateAiOperationalState<GenerationJob,void>(agentId,GENERATION_JOB_NAMESPACE,current=>{
    if (!current || current.id !== runId) return {value:current!,result:undefined,skip:true};
    const attemptedIdeas=[...new Set([...current.checkpoints.attemptedIdeas as string[] || [],...current.checkpoints.selectedIdeas as string[] || []])];
    return {value:{...current,status:queued?'queued':'failed',owner:null,leaseUntil:0,stage:queued?'queued':current.stage,blocker:queued?null:'queue_rejected',nextAttemptAt:queued?0:Date.now()+30*60_000,revision:(current.revision || 0)+1,
      checkpoints:{...current.checkpoints,attemptedIdeas}},result:undefined};
  });
}

export interface GenerationCanary { id:string; limitUsd:number; emptyRuns:number; emptyAttemptIds?:string[]; queuedIds:string[]; status:'active'|'passed'|'blocked'; }
export const getGenerationCanary = (agentId:string) => getAiOperationalState<GenerationCanary>(agentId,'generation-canary');
export async function recordGenerationCanary(agentId:string, event:{queuedId?:string;empty?:boolean;attemptId?:string}) {
  return mutateAiOperationalState<GenerationCanary,void>(agentId,'generation-canary',state=>{
    if (!state || state.status!=='active') return {value:state!,result:undefined,skip:true};
    if(event.empty && event.attemptId && state.emptyAttemptIds?.includes(event.attemptId)) return {value:state,result:undefined,skip:true};
    const queuedIds=[...new Set([...state.queuedIds,...event.queuedId?[event.queuedId]:[]])];
    const emptyRuns=event.queuedId ? 0 : state.emptyRuns+(event.empty?1:0);
    const emptyAttemptIds=event.empty && event.attemptId ? [...state.emptyAttemptIds || [],event.attemptId] : state.emptyAttemptIds;
    return {value:{...state,queuedIds,emptyRuns,emptyAttemptIds,status:queuedIds.length>=2?'passed':emptyRuns>=3?'blocked':'active'},result:undefined};
  });
}
