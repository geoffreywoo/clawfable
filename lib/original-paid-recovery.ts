import type { GenerationJob } from './generation-job';
import type { DraftEvaluation, GenerationBriefV2 } from './generation-v2';
import type { OriginalEditorialContext } from './original-editorial-context';
import type { DraftCandidate, IdeaCandidate } from './types';

export const ORIGINAL_PAID_RECOVERY_KEY = 'originalPaidRecovery';
export const ORIGINAL_PAID_RECOVERY_MAX_IDEAS = 6;
export const ORIGINAL_PAID_RECOVERY_MAX_DRAFTS = 18;
export interface OriginalPaidRecoveryEntry {
  originPolicy: string;
  idea: IdeaCandidate;
  subject: GenerationBriefV2 & { editorialContext?: OriginalEditorialContext };
  drafts: DraftEvaluation[];
  assessment?: { drafts: DraftEvaluation[]; selected: [] };
}
export interface OriginalPaidRecovery {
  version: 1;
  /** Frozen paid ideation inventory, including still-unwritten reserves. */
  subjects: OriginalPaidRecoveryEntry['subject'][];
  ideas: IdeaCandidate[];
  entries: OriginalPaidRecoveryEntry[];
  /** Permanent exclusions survive later policy changes; entries remain immutable audit evidence. */
  excludedIdeaIds: string[];
}
type RecoveryJob = Pick<GenerationJob, 'policy' | 'status' | 'checkpoints'>;

export function hasOriginalModelJudgment(draft: DraftCandidate): boolean {
  return [draft.judgeProvider, draft.judgeModel, draft.judgeScore, draft.judgeBreakdown,
    draft.judgeRawNotes, draft.judgeNotes, draft.judgePolicyVersion, draft.repairDecision].some(value => value != null);
}

function evaluations(value: unknown): DraftEvaluation[] | null {
  return Array.isArray(value) && value.every(row => row?.draft && typeof row.draft.id === 'string'
    && typeof row.draft.ideaId === 'string' && typeof row.draft.content === 'string') ? value : null;
}
function hasFinalDecision(rows: DraftEvaluation[]): boolean {
  return rows.some(row => row.qualifiedCandidate || hasOriginalModelJudgment(row.draft)
    || row.draft.status === 'selected' || row.draft.status === 'reserve');
}

/**
 * Capture only already-written work before compatible policy invalidation.
 * This grants no publishing eligibility: the adapter must validate the frozen
 * subject and re-run current deterministic and final assessment. It neither
 * changes attempt history nor purchases a call, consumes a recovery, or resets
 * the original job/campaign budget.
 */
export function captureOriginalPaidRecovery(job: RecoveryJob): OriginalPaidRecovery | null {
  const saved = job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] as OriginalPaidRecovery | undefined;
  const entries = saved?.version === 1 ? structuredClone(saved.entries) : [];
  const excluded = new Set(saved?.version === 1 ? saved.excludedIdeaIds : []);
  for (const id of job.checkpoints.queuedIdeas as string[] || []) excluded.add(id);
  const attempted = new Set(job.checkpoints.attemptedIdeas as string[] || []);
  const currentIdeas = (Array.isArray(job.checkpoints.ideas_ready) ? job.checkpoints.ideas_ready : [])
    .filter((idea): idea is IdeaCandidate => typeof idea?.id === 'string' && typeof idea?.briefId === 'string');
  const currentSubjects = [job.checkpoints.subjects_ready, job.checkpoints.briefs].find(value => Array.isArray(value)
    && value.length && value.every(subject => typeof subject?.id === 'string')) as OriginalPaidRecoveryEntry['subject'][] | undefined;
  const ideas = structuredClone((currentIdeas.length ? currentIdeas : saved?.ideas || []).slice(0, ORIGINAL_PAID_RECOVERY_MAX_IDEAS));
  const subjects = structuredClone((currentSubjects || saved?.subjects || []).slice(0, 2));
  // Preserve evidence of a genuine final decision before its derived snapshot
  // is invalidated. Never reinterpret queued or judge-rejected work as pending.
  for (const [key, value] of Object.entries(job.checkpoints)) {
    if (!key.startsWith('drafts_ready:') && !key.startsWith('assessed:')) continue;
    const id = key.slice(key.indexOf(':') + 1);
    const assessment = key.startsWith('assessed:') ? value as { drafts?: unknown; selected?: unknown[] } : null;
    const rows = evaluations(assessment ? assessment.drafts : value);
    if (assessment?.selected?.length || rows && hasFinalDecision(rows)) excluded.add(id);
  }
  if (job.status === 'queued') {
    for (const id of job.checkpoints.selectedIdeas as string[] || []) excluded.add(id);
  }

  const captured = new Set(entries.map(entry => entry.idea.id));
  const draftIds = new Set(entries.flatMap(entry => entry.drafts.map(row => row.draft.id)));
  for (const [key, value] of Object.entries(job.checkpoints)) {
    if (!key.startsWith('drafts_ready:')) continue;
    const id = key.slice('drafts_ready:'.length);
    if (captured.has(id) || excluded.has(id) || entries.length >= ORIGINAL_PAID_RECOVERY_MAX_IDEAS) continue;
    const drafts = evaluations(value);
    const idea = ideas.find(candidate => candidate.id === id);
    const matchingSubjects = subjects.filter(subject => subject.id === idea?.briefId);
    if (!drafts?.length || !idea || matchingSubjects.length !== 1 || new Set(drafts.map(row => row.draft.id)).size !== drafts.length
      || drafts.some(row => row.draft.ideaId !== id
      || row.idea?.id !== id || row.brief?.id !== idea.briefId || draftIds.has(row.draft.id))) continue;
    if (draftIds.size + drafts.length > ORIGINAL_PAID_RECOVERY_MAX_DRAFTS) continue;
    const previous = job.checkpoints[`assessed:${id}`] as { drafts?: unknown; selected?: unknown[] } | undefined;
    const assessedDrafts = previous ? evaluations(previous.drafts) : null;
    if (previous && (!attempted.has(id) || !Array.isArray(previous.selected) || previous.selected.length
      || !assessedDrafts?.length || assessedDrafts.length !== drafts.length
      || assessedDrafts.some(row => row.draft.ideaId !== id || row.idea?.id !== id || row.brief?.id !== idea.briefId
        || !drafts.some(written => written.draft.id === row.draft.id
        && written.draft.content === row.draft.content)))) continue;
    entries.push(structuredClone({ originPolicy: job.policy, idea, subject: matchingSubjects[0], drafts,
      ...(previous ? { assessment: { drafts: assessedDrafts!, selected: [] as [] } } : {}) }));
    captured.add(id);
    for (const row of drafts) draftIds.add(row.draft.id);
  }
  return entries.length || excluded.size || ideas.length || subjects.length
    ? { version: 1, subjects, ideas, entries, excludedIdeaIds: [...excluded] } : null;
}
