import { createHash, randomUUID } from 'node:crypto';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';

export const GENERATION_JOB_VERSION = 'durable-original-1';
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
  result?: unknown[];
}
export function durableGenerationEnabled(agentId: string, settings: { durableGenerationEnabled?: boolean }): boolean {
  return agentId === '13' && settings.durableGenerationEnabled === true;
}
export const getGenerationJob = (agentId: string) => getAiOperationalState<GenerationJob>(agentId, GENERATION_JOB_NAMESPACE);
export function jobFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export async function claimGenerationJob(agentId: string, input: unknown, policy: string, now = Date.now()): Promise<GenerationJob | null> {
  const owner = randomUUID();
  return mutateAiOperationalState<GenerationJob, GenerationJob | null>(agentId, GENERATION_JOB_NAMESPACE, current => {
    if (current && current.leaseUntil > now && current.owner) return {value: current, result: null, skip: true};
    if (current && current.nextAttemptAt > now && current.policy === policy && current.expiresAt > now) return {value: current, result: null, skip: true};
    const reusable = current && current.policy === policy && current.expiresAt > now && !['queued','failed'].includes(current.status);
    const value: GenerationJob = reusable ? {...current, owner, leaseUntil: now + 300_000, status: current.status === 'assessed' ? 'assessed' : 'running'} : {
      version: GENERATION_JOB_VERSION, id: `generation-job-${randomUUID()}`, policy, input,
      createdAt: now, expiresAt: now + 24*3600_000, owner, leaseUntil: now + 300_000,
      stage: 'subject_ready', status: 'running', blocker: null, nextAttemptAt: 0, failures: 0, checkpoints: {},
    };
    return {value, result: value};
  });
}
export async function updateGenerationJob(agentId: string, job: Pick<GenerationJob,'id'|'owner'>, update: (current: GenerationJob) => GenerationJob, now = Date.now()): Promise<GenerationJob> {
  return mutateAiOperationalState<GenerationJob, GenerationJob>(agentId, GENERATION_JOB_NAMESPACE, current => {
    if (!current || current.id !== job.id || current.owner !== job.owner || current.leaseUntil <= now) throw new Error('generation_lease_lost');
    const value = update(current);
    return {value, result:value};
  });
}
export class GenerationJobSession {
  deferred = false;
  constructor(readonly agentId: string, public job: GenerationJob) {}
  async checkpoint<T>(key: string, compute: () => Promise<T>): Promise<T> {
    if (Object.prototype.hasOwnProperty.call(this.job.checkpoints, key)) return structuredClone(this.job.checkpoints[key]) as T;
    await this.write(current => ({...current, stage:key.startsWith('call:') ? key.split(':')[1] : key}));
    const value = await compute();
    if ((key === "ideas_ready" || key.startsWith("drafts_ready")) && Array.isArray(value) && !value.length) throw new Error("stage_output_unavailable");
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
      status:result.length ? 'assessed' : operational && current.failures < 3 ? 'deferred' : 'failed',
      blocker:result.length ? null : this.deferred ? 'stage_deferred' : reserve ? 'reserve_ready' : outcome,
      failures:current.failures + (operational && !this.deferred ? 1 : 0),
      nextAttemptAt: result.length ? 0 : Date.now() + (outcome === 'quality_empty' ? 30*60_000 : this.deferred ? 10*60_000 : Math.min(120,10*2**current.failures)*60_000),
      owner:result.length ? current.owner : null,leaseUntil:result.length ? current.leaseUntil : 0}));
  }
}
export async function acknowledgeGenerationQueue(agentId: string, runId: string, queued: boolean): Promise<void> {
  await mutateAiOperationalState<GenerationJob,void>(agentId,GENERATION_JOB_NAMESPACE,current=>{
    if (!current || current.id !== runId) return {value:current!,result:undefined,skip:true};
    return {value:{...current,status:queued?'queued':'failed',owner:null,leaseUntil:0,stage:queued?'queued':current.stage,blocker:queued?null:'queue_rejected',nextAttemptAt:queued?0:Date.now()+30*60_000},result:undefined};
  });
}

export interface GenerationCanary { id:string; limitUsd:number; emptyRuns:number; queuedIds:string[]; status:'active'|'passed'|'blocked'; }
export const getGenerationCanary = (agentId:string) => getAiOperationalState<GenerationCanary>(agentId,'generation-canary');
export async function recordGenerationCanary(agentId:string, event:{queuedId?:string;empty?:boolean}) {
  return mutateAiOperationalState<GenerationCanary,void>(agentId,'generation-canary',state=>{
    if (!state || state.status!=='active') return {value:state!,result:undefined,skip:true};
    const queuedIds=[...new Set([...state.queuedIds,...event.queuedId?[event.queuedId]:[]])];
    const emptyRuns=event.queuedId ? 0 : state.emptyRuns+(event.empty?1:0);
    return {value:{...state,queuedIds,emptyRuns,status:queuedIds.length>=2?'passed':emptyRuns>=3?'blocked':'active'},result:undefined};
  });
}
