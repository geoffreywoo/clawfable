import type { CandidateJudgeBreakdown } from './types';
import { createHash } from 'node:crypto';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';

export const EFFICIENT_GENERATION_POLICY = 'geoffrey-autopost-per-dollar-6';
export interface RepairDecision {
  disposition: 'pass' | 'repair' | 'abandon';
  failingDimension: string;
  offendingSpan: string;
  permittedChange: string;
  evidenceIds: string[];
  preserve: string[];
}
export const REPAIR_DECISION_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['disposition', 'failingDimension', 'offendingSpan', 'permittedChange', 'evidenceIds', 'preserve'],
  properties: { disposition: { type: 'string', enum: ['pass', 'repair', 'abandon'] }, failingDimension: { type: 'string' },
    offendingSpan: { type: 'string' }, permittedChange: { type: 'string' },
    evidenceIds: { type: 'array', items: { type: 'string' } }, preserve: { type: 'array', items: { type: 'string' } } } };
export function parseRepairDecision(value: unknown): RepairDecision | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as RepairDecision;
  if (!['pass', 'repair', 'abandon'].includes(d.disposition) || !['failingDimension','offendingSpan','permittedChange'].every(k => typeof d[k] === 'string')
    || !Array.isArray(d.evidenceIds) || !d.evidenceIds.every(x => typeof x === 'string')
    || !Array.isArray(d.preserve) || !d.preserve.every(x => typeof x === 'string')) return null;
  return d;
}
const REPAIRABLE_CODES: Record<string, string[]> = {
  voiceFit: ['copy_judge_voice_mismatch', 'final_native_voice_below_floor', 'final_quality_margin'],
  clarity: ['final_quality_margin', 'copy_judge_low_quality'],
  specificity: ['final_quality_margin'],
};
export function canRepairDraft(content: string, codes: string[], decision: RepairDecision | null | undefined, evidenceIds: string[], scores?: CandidateJudgeBreakdown | null): boolean {
  if (!decision || decision.disposition !== 'repair' || !decision.offendingSpan || !content.includes(decision.offendingSpan)
    || !decision.permittedChange.trim() || !decision.preserve.length || !decision.preserve.every(span => span && content.includes(span))
    || !decision.evidenceIds.every(id => evidenceIds.includes(id))) return false;
  if (scores && codes.includes('final_quality_margin')) {
    const diagnosed = scores[decision.failingDimension];
    const executionScores = [scores.voiceFit, scores.clarity, scores.specificity].filter((score): score is number => typeof score === 'number');
    if (typeof diagnosed !== 'number' || diagnosed > Math.min(...executionScores) + 0.02) return false;
    // An execution diagnosis cannot conceal a weak premise or low originality.
    if ([scores.insight, scores.novelty].some(score => typeof score === 'number' && score < diagnosed - 0.02)) return false;
  }
  const allowed = REPAIRABLE_CODES[decision.failingDimension];
  // Missing evidence, weak premises and insufficient ambition/originality cannot be fixed by wording.
  return Boolean(allowed && codes.length && codes.every(code => allowed.includes(code)));
}
export function preservesRepairDecision(content: string, decision: RepairDecision | null | undefined): boolean {
  return Boolean(decision?.preserve.length && decision.preserve.every(span => content.includes(span)));
}
export function substantiveBriefDigest(brief: { topic: string; title: string; sourceBrief?: string; evidenceMode?: string; }, claims: string[], voiceVersion: string, policyVersion: string): string {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256').update(JSON.stringify([normalize(brief.topic), normalize(brief.title), normalize(brief.sourceBrief || ''),
    brief.evidenceMode, claims.map(normalize).sort(), voiceVersion, policyVersion])).digest('hex');
}
interface BriefAttempt { policyVersion?: string; key: string; runId: string; at: number; outcome: 'quality_empty' | 'completed' | 'running'; }
interface FailureState { attempts: BriefAttempt[]; }
// Rejected premises are fed back to ideation, so a brief is worth retrying soon
// after one empty run. Only a brief that keeps failing is rested for a day.
export const BRIEF_FIRST_FAILURE_COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const BRIEF_REPEAT_FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const BRIEF_CLAIM_TTL_MS = 5 * 60 * 1000;
export function isBriefCoolingDown(attempts: BriefAttempt[], key: string, now: number, runId?: string): boolean {
  const mine = attempts.filter(a => a.key === key && a.runId !== runId);
  if (mine.some(a => a.outcome === 'running' && now - a.at < BRIEF_CLAIM_TTL_MS)) return true;
  const failures = mine.filter(a => a.outcome === 'quality_empty' && now - a.at < BRIEF_REPEAT_FAILURE_COOLDOWN_MS);
  if (failures.length >= 2) return true;
  return failures.some(a => now - a.at < BRIEF_FIRST_FAILURE_COOLDOWN_MS);
}
export async function failedBriefKeys(agentId: string, now = Date.now()): Promise<Set<string>> {
  const attempts = (await getAiOperationalState<FailureState>(agentId, 'brief-attempts'))?.attempts || [];
  return new Set(attempts.map(a => a.key).filter(key => isBriefCoolingDown(attempts, key, now)));
}
export const QUALITY_PAUSE_EMPTY_RUNS = 5;
export const QUALITY_PAUSE_MS = 2 * 60 * 60 * 1000;
export async function qualityGenerationPauseUntil(agentId: string, now = Date.now(), policyVersion?: string): Promise<number | null> {
  const state = await getAiOperationalState<FailureState>(agentId, 'brief-attempts');
  const runs = new Map<string, BriefAttempt[]>();
  for (const a of [...(state?.attempts || []).filter(a=>a.outcome!=='running' && (!policyVersion || a.policyVersion === policyVersion))].sort((a,b) => b.at-a.at)) runs.set(a.runId, [...(runs.get(a.runId) || []), a]);
  // The daily budget ledger bounds spend; this pause only stops a clearly
  // broken configuration from draining it, so it needs a longer empty streak.
  const recent = [...runs.values()].slice(0,QUALITY_PAUSE_EMPTY_RUNS);
  if (recent.length < QUALITY_PAUSE_EMPTY_RUNS || recent.some(run => run.some(a => a.outcome !== 'quality_empty'))) return null;
  if (new Set(recent.flat().map(a => a.key)).size < QUALITY_PAUSE_EMPTY_RUNS) return null;
  const until = Math.max(...recent[0].map(a => a.at)) + QUALITY_PAUSE_MS;
  return until > now ? until : null;
}
export async function recordBriefAttempts(agentId: string, runId: string, entries: {key: string; outcome: BriefAttempt['outcome']}[], now = Date.now(), policyVersion?: string): Promise<void> {
  await mutateAiOperationalState<FailureState, void>(agentId, 'brief-attempts', state => ({ value: { attempts: [
    ...(state?.attempts || []).filter(a => now-a.at < 7*86400000 && a.runId !== runId),
    ...entries.map(a => ({ ...a, runId, at: now, ...(policyVersion ? { policyVersion } : {}) })) ] }, result: undefined }));
}

export async function claimGenerationBriefs(agentId: string, runId: string, keys: string[], now = Date.now()): Promise<string[]> {
  return mutateAiOperationalState<FailureState,string[]>(agentId,'brief-attempts',state=>{
    const current=(state?.attempts || []).filter(a=>now-a.at<7*86400000);
    const available=keys.filter(key=>!isBriefCoolingDown(current,key,now,runId));
    return {value:{attempts:[...current,...available.filter(key=>!current.some(a=>a.runId===runId&&a.key===key)).map(key=>({key,runId,at:now,outcome:'running' as const}))]},result:available};
  });
}

/** All selected copy was rejected by final queue revalidation; it was not a productive run. */
export async function recordEmptyQueueRun(agentId: string, runId: string): Promise<void> {
  await mutateAiOperationalState<FailureState,void>(agentId,'brief-attempts',state=>({
    value:{attempts:(state?.attempts || []).map(a=>a.runId===runId && a.outcome==='completed'
      ? {...a,outcome:'quality_empty' as const,at:Date.now()} : a)},result:undefined,
  }));
}
