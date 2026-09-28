import { expect, it } from 'vitest';
import { originalQueueBlockerReason, generationFailureDiagnostics } from '@/lib/original-queue-blocker';
import type { GenerationCanary, GenerationJob } from '@/lib/generation-job';

const now = Date.parse('2026-09-26T19:00:00Z');
const job = { status: 'deferred', stage: 'tweet_writing', blocker: 'reserve_ready',
  nextAttemptAt: now - 1000, expiresAt: now + 3600000 } as GenerationJob;
const canary = { status: 'blocked', emptyRuns: 3 } as GenerationCanary;

it('separates repaired parent failures from completed current assessments', () => {
  const base = { generationRunId: 'job', updatedAt: '2026-09-27T00:00:00Z' };
  const result = generationFailureDiagnostics('job', [
    { ...base, id: 'parent', judgeScore: null, rejectionCodes: ['missing_verified_entity_tag'] },
    { ...base, id: 'child', parentDraftId: 'parent', judgeScore: .5, rejectionCodes: ['copy_judge_low_quality', 'copy_not_selected'] },
    { ...base, id: 'pending', judgeScore: null, rejectionCodes: ['copy_judge_unavailable'] },
    { ...base, id: 'other', generationRunId: 'other-job', judgeScore: .2, rejectionCodes: ['unrelated'] },
  ] as any);
  expect(result.assessedRejectionCounts).toEqual({ copy_judge_low_quality: 1 });
  expect(result.historicalPreflightRejectionCounts).toEqual({ missing_verified_entity_tag: 1 });
});

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

it('keeps earlier reserve attempts out of the latest assessed blocker, including a pending new judge', () => {
  const drafts = [{id:'old',ideaId:'old-idea',generationRunId:'job',judgeScore:.4,rejectionCodes:['final_frontier_lead_below_floor']},
    {id:'new',ideaId:'new-idea',generationRunId:'job',judgeScore:.5,rejectionCodes:['copy_judge_voice_mismatch']}] as any;
  expect(generationFailureDiagnostics('job',drafts,['new-idea']).assessedRejectionCounts).toEqual({copy_judge_voice_mismatch:1});
  const pending=generationFailureDiagnostics('job',drafts,['next-idea']);
  expect(pending.hasActiveSelection).toBe(true);
  expect(pending.assessedRejectionCounts).toEqual({});
  expect(pending.historicalAssessedRejectionCounts.final_frontier_lead_below_floor).toBe(1);
});
