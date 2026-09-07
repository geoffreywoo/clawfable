import type { CandidateJudgeBreakdown } from './types';
import { createHash } from 'node:crypto';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';

export const EFFICIENT_GENERATION_POLICY = 'geoffrey-autopost-per-dollar-1';
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
export function substantiveBriefDigest(brief: { topic: string; title: string; sourceBrief?: string; evidenceMode?: string; }, claims: string[], voiceVersion: string, policyVersion: string): string {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256').update(JSON.stringify([normalize(brief.topic), normalize(brief.title), normalize(brief.sourceBrief || ''),
    brief.evidenceMode, claims.map(normalize).sort(), voiceVersion, policyVersion])).digest('hex');
}
interface BriefAttempt { key: string; runId: string; at: number; outcome: 'quality_empty' | 'completed' | 'running'; }
interface FailureState { attempts: BriefAttempt[]; }
export async function failedBriefKeys(agentId: string, now = Date.now()): Promise<Set<string>> {
  const state = await getAiOperationalState<FailureState>(agentId, 'brief-attempts');
  return new Set((state?.attempts || []).filter(a => (a.outcome === 'quality_empty' && now - a.at < 86400000) || (a.outcome === 'running' && now-a.at<300000)).map(a => a.key));
}
export async function qualityGenerationPauseUntil(agentId: string, now = Date.now()): Promise<number | null> {
  const state = await getAiOperationalState<FailureState>(agentId, 'brief-attempts');
  const runs = new Map<string, BriefAttempt[]>();
  for (const a of [...(state?.attempts || []).filter(a=>a.outcome!=='running')].sort((a,b) => b.at-a.at)) runs.set(a.runId, [...(runs.get(a.runId) || []), a]);
  const recent = [...runs.values()].slice(0,3);
  if (recent.length < 3 || recent.some(run => run.some(a => a.outcome !== 'quality_empty'))) return null;
  if (new Set(recent.flat().map(a => a.key)).size < 3) return null;
  const until = Math.max(...recent[0].map(a => a.at)) + 21600000;
  return until > now ? until : null;
}
export async function recordBriefAttempts(agentId: string, runId: string, entries: {key: string; outcome: BriefAttempt['outcome']}[], now = Date.now()): Promise<void> {
  await mutateAiOperationalState<FailureState, void>(agentId, 'brief-attempts', state => ({ value: { attempts: [
    ...(state?.attempts || []).filter(a => now-a.at < 7*86400000 && a.runId !== runId),
    ...entries.map(a => ({ ...a, runId, at: now })) ] }, result: undefined }));
}

export async function claimGenerationBriefs(agentId: string, runId: string, keys: string[], now = Date.now()): Promise<string[]> {
  return mutateAiOperationalState<FailureState,string[]>(agentId,'brief-attempts',state=>{
    const current=(state?.attempts || []).filter(a=>now-a.at<7*86400000);
    const available=keys.filter(key=>!current.some(a=>a.key===key && a.runId!==runId && (
      (a.outcome==='quality_empty' && now-a.at<86400000) || (a.outcome==='running' && now-a.at<300000))));
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
