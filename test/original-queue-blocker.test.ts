import { expect, it } from 'vitest';
import { originalQueueBlockerReason } from '@/lib/original-queue-blocker';
import type { GenerationCanary, GenerationJob } from '@/lib/generation-job';

const now = Date.parse('2026-09-26T19:00:00Z');
const job = { status: 'deferred', stage: 'tweet_writing', blocker: 'reserve_ready',
  nextAttemptAt: now - 1000, expiresAt: now + 3600000 } as GenerationJob;
const canary = { status: 'blocked', emptyRuns: 3 } as GenerationCanary;

it('prioritizes the canary stop over an overdue reserve retry and selection codes', () => {
  const reason = originalQueueBlockerReason(job, canary,
    { idea_not_selected: 9, final_technical_credibility_below_floor: 3 }, now);
  expect(reason).toContain('canary blocked after 3');
  expect(reason).toContain('final_technical_credibility_below_floor (3)');
  expect(reason).not.toContain('idea_not_selected');
  expect(reason).toContain('no automatic retry');
  expect(reason).not.toContain('resume saved work');
});

it('does not promise reuse of expired evidence', () => {
  const reason = originalQueueBlockerReason({ ...job, expiresAt: now - 1 }, null, {}, now);
  expect(reason).toContain('evidence expired');
  expect(reason).not.toContain('resume saved work');
});

it('distinguishes provider deferral from editorial rejection and names the retry time', () => {
  const reason = originalQueueBlockerReason({ ...job, stage: 'copy_judgment',
    blocker: 'provider_pending', nextAttemptAt: now + 600000 }, null, {}, now);
  expect(reason).toContain('deferred at copy_judgment (provider_pending)');
  expect(reason).toContain('2026-09-26T19:10:00.000Z');
  expect(reason).not.toContain('editorial');
});
