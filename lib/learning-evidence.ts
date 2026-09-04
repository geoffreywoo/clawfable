import type { FeedbackEntry, LearningSignal, Tweet } from './types';

export const LEARNING_DERIVATION_VERSION = 'learning-2026-09-04-v3';

/** Historical timeline absence was recorded as a deletion without verification. */
export function isUnverifiedRemovalSignal(signal: LearningSignal): boolean {
  return signal.signalType === 'deleted_from_x'
    && signal.inferred === true
    && signal.metadata?.verifiedRemoval !== true;
}

export function filterLearningEvidence(signals: LearningSignal[], feedback: FeedbackEntry[] = [], tweets: Tweet[] = []) {
  const uncertain = new Set(signals.filter(isUnverifiedRemovalSignal).map((signal) => String(signal.tweetId || '')));
  const verified = new Set(signals.filter((signal) => signal.signalType === 'deleted_from_x' && !isUnverifiedRemovalSignal(signal)).map((signal) => String(signal.tweetId || '')));
  for (const tweet of tweets) {
    if (tweet.status === 'deleted_from_x' && (tweet.xRemovalConfirmationCount || 0) < 2 && !verified.has(String(tweet.id))) {
      // Legacy signals can have fallen out of the bounded ledger. An inferred
      // feedback row is still not editorial evidence without a verification.
      uncertain.add(String(tweet.id));
    }
  }
  return {
    signals: signals.filter((signal) => !isUnverifiedRemovalSignal(signal)),
    feedback: feedback.filter((entry) => !(entry.tweetId && uncertain.has(String(entry.tweetId))
      && !verified.has(String(entry.tweetId)) && entry.rating === 'down'
      && entry.userProvidedReason === false && entry.source === 'queue_delete')),
  };
}
