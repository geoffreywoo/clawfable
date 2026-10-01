import type { GenerationCanary, GenerationJob } from './generation-job';
import type { DraftCandidate } from './types';
import { editorialRejectionCodes } from './candidate-disposition';

export function generationFailureDiagnostics(jobId: string | undefined, drafts: DraftCandidate[], selectedIdeaIds?: string[]) {
  const latest = new Map<string, DraftCandidate>();
  for (const draft of drafts.filter(d => d.generationRunId === jobId)) {
    if (!latest.has(draft.id) || latest.get(draft.id)!.updatedAt < draft.updatedAt) latest.set(draft.id, draft);
  }
  const history = [...latest.values()];
  const rows = selectedIdeaIds?.length ? history.filter(d => selectedIdeaIds.includes(d.ideaId)) : history;
  const parents = new Set(rows.map(d => d.parentDraftId).filter(Boolean));
  const assessed = rows.filter(d => !parents.has(d.id) && typeof d.judgeScore === 'number' && Number.isFinite(d.judgeScore));
  const count = (items: DraftCandidate[]) => {
    const counts: Record<string, number> = {};
    for (const draft of items) for (const code of editorialRejectionCodes(draft.rejectionCodes)) counts[code] = (counts[code] || 0) + 1;
    return counts;
  };
  return { hasActiveSelection: Boolean(selectedIdeaIds?.length), assessedDrafts: assessed.length, assessedRejectionCounts: count(assessed), currentPreflightRejectionCounts: count(rows.filter(d => !parents.has(d.id) && d.judgeScore == null)), historicalPreflightRejectionCounts: count(history.filter(d => d.judgeScore == null)), historicalAssessedRejectionCounts: count(history.filter(d => !rows.includes(d) && d.judgeScore != null)) };
}

/** Explain a missed original slot from durable state without invoking generation. */
export function originalQueueBlockerReason(
  job: GenerationJob | null,
  _canary: GenerationCanary | null,
  rejectionCounts: Record<string, number> = {},
  now = Date.now(),
): string {
  const failedGates = Object.entries(rejectionCounts)
    .filter(([code, count]) => count > 0 && !code.endsWith('_not_selected'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, count]) => `${code} (${count})`);
  const gates = failedGates.length ? ` Latest failed gates: ${failedGates.join(', ')}.` : '';
  if (!job) return 'Original queue empty: no active generation job. Next: the generation worker will attempt refill on its next scheduled tick.';
  const retry = job.nextAttemptAt > now
    ? `on the first generation tick at or after ${new Date(job.nextAttemptAt).toISOString()}`
    : 'on the next scheduled generation tick';
  if (job.blocker === 'budget_daily_exhausted') {
    return `Original queue empty: the Pacific-day AI allowance is exhausted. Next: generation resumes ${retry}, with current evidence and all earlier spending retained.`;
  }
  if (job.blocker === 'budget_job_exhausted') {
    return `Original queue empty: this generation job reached its spending cap.${gates} Next: start a fresh eligible job ${retry}, within the remaining daily allowance. Paid artifacts remain archived.`;
  }
  if (job.expiresAt <= now) {
    return `Original queue empty: saved subject evidence expired at ${new Date(job.expiresAt).toISOString()}.${gates} Next: the generation worker must select current evidence before resuming.`;
  }
  return `Original queue empty: generation ${job.status} at ${job.stage} (${job.blocker || 'in progress'}).${gates} Next: ${job.status === 'failed' ? 'attempt a new eligible job' : 'resume saved work'} ${retry}, subject to budget and evidence checks.`;
}
