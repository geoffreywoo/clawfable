import type { GenerationCanary, GenerationJob } from './generation-job';

/** Explain a missed original slot from durable state without invoking generation. */
export function originalQueueBlockerReason(
  job: GenerationJob | null,
  canary: GenerationCanary | null,
  rejectionCounts: Record<string, number> = {},
  now = Date.now(),
): string {
  const failedGates = Object.entries(rejectionCounts)
    .filter(([code, count]) => count > 0 && !code.endsWith('_not_selected'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, count]) => `${code} (${count})`);
  const gates = failedGates.length ? ` Latest failed gates: ${failedGates.join(', ')}.` : '';
  if (canary?.status === 'blocked') {
    return `Original queue empty: canary blocked after ${canary.emptyRuns} consecutive editorial-empty attempts.${gates} Next: validate an offline fix before resuming paid canary work; no automatic retry is scheduled.`;
  }
  if (!job) return 'Original queue empty: no active generation job. Next: the generation worker will attempt refill on its next scheduled tick.';
  if (job.expiresAt <= now) {
    return `Original queue empty: saved subject evidence expired at ${new Date(job.expiresAt).toISOString()}.${gates} Next: the generation worker must select current evidence before resuming.`;
  }
  const retry = job.nextAttemptAt > now
    ? `on the first generation tick at or after ${new Date(job.nextAttemptAt).toISOString()}`
    : 'on the next scheduled generation tick';
  return `Original queue empty: generation ${job.status} at ${job.stage} (${job.blocker || 'in progress'}).${gates} Next: ${job.status === 'failed' ? 'attempt a new eligible job' : 'resume saved work'} ${retry}, subject to budget and evidence checks.`;
}
