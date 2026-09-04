import { describe, expect, it } from 'vitest';
import { filterLearningEvidence } from '@/lib/learning-evidence';
import type { FeedbackEntry, LearningSignal, Tweet } from '@/lib/types';

const signal = { id: 's1', tweetId: 't1', agentId: 'a1', createdAt: '2026-09-01', signalType: 'deleted_from_x',
  surface: 'cron', inferred: true, rewardDelta: -0.8 } as LearningSignal;
const feedback = { tweetId: 't1', tweetText: 'A missing post.', rating: 'down', source: 'queue_delete',
  generatedAt: '2026-09-01', userProvidedReason: false, intentSummary: 'Model guessed the removal reason.' } as FeedbackEntry;
describe('legacy removal evidence', () => {
  it('inhibits uncertain removal evidence without changing the raw inputs', () => {
    const result = filterLearningEvidence([signal], [feedback]);
    expect(result.signals).toEqual([]);
    expect(result.feedback).toEqual([]);
    expect(signal.signalType).toBe('deleted_from_x');
    expect(feedback.rating).toBe('down');
  });
  it('preserves explicit owner explanations and confirmed removals', () => {
    expect(filterLearningEvidence([signal], [{ ...feedback, userProvidedReason: true }]).feedback).toHaveLength(1);
    const verified = { ...signal, metadata: { verifiedRemoval: true } };
    expect(filterLearningEvidence([verified], [feedback]).signals).toHaveLength(1);
    expect(filterLearningEvidence([verified], [feedback]).feedback).toHaveLength(1);
  });
  it('inhibits legacy guessed reasons after the bounded signal ledger has expired', () => {
    const tweets = [{ id: 't1', status: 'deleted_from_x' }] as Tweet[];
    expect(filterLearningEvidence([], [feedback], tweets).feedback).toEqual([]);
  });
});
