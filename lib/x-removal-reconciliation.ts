import type { Agent, LearningSignal, Tweet } from './types';
import { addLearningSignal, addPostLogEntry, updateTweet } from './kv-storage';
import { lookupTweetAvailability, type TwitterKeys } from './twitter-client';
import { isUnverifiedRemovalSignal } from './learning-evidence';

const CONFIRMATION_INTERVAL_MS = 15 * 60 * 1000;
const MAX_LOOKUPS_PER_RUN = 10;

/** Timeline gaps nominate candidates; independent official lookups confirm removal. */
export async function reconcileXRemovals(
  agent: Pick<Agent, 'id'>,
  keys: TwitterKeys,
  tweets: Tweet[],
  timelineIds: Set<string>,
  signals: LearningSignal[],
  now = new Date(),
): Promise<number> {
  const nowMs = now.getTime();
  const confirmedIds = new Set(signals.filter((signal) => signal.signalType === 'deleted_from_x'
    && !isUnverifiedRemovalSignal(signal)).map((signal) => String(signal.tweetId)));
  for (const tweet of tweets) {
    if (tweet.xTweetId && timelineIds.has(String(tweet.xTweetId)) && (tweet.xRemovalConfirmationCount || 0) > 0) {
      await updateTweet(tweet.id, { xRemovalFirstMissingAt: null, xRemovalConfirmationCount: 0, xRemovalLastCheckedAt: now.toISOString() });
    }
  }
  const candidates = tweets.filter((tweet) => {
    if (!tweet.xTweetId || confirmedIds.has(String(tweet.id))) return false;
    if (tweet.status !== 'posted' && tweet.status !== 'deleted_from_x') return false;
    const posted = Date.parse(tweet.postedAt || tweet.createdAt);
    if (!Number.isFinite(posted) || posted < nowMs - 7 * 24 * 60 * 60 * 1000) return false;
    if (timelineIds.has(String(tweet.xTweetId))) return false;
    const lastChecked = Date.parse(tweet.xRemovalLastCheckedAt || '');
    return !Number.isFinite(lastChecked) || nowMs - lastChecked >= CONFIRMATION_INTERVAL_MS;
  }).sort((a, b) => Date.parse(a.xRemovalLastCheckedAt || '1970-01-01') - Date.parse(b.xRemovalLastCheckedAt || '1970-01-01'))
    .slice(0, MAX_LOOKUPS_PER_RUN);

  let confirmed = 0;
  for (const tweet of candidates) {
    const result = await lookupTweetAvailability(keys, String(tweet.xTweetId));
    if (result.status === 'present') {
      await updateTweet(tweet.id, { xRemovalLastCheckedAt: now.toISOString(), xRemovalFirstMissingAt: null, xRemovalConfirmationCount: 0 });
      continue;
    }
    if (result.status === 'unavailable') {
      await updateTweet(tweet.id, { xRemovalLastCheckedAt: now.toISOString() });
      continue;
    }
    const firstMissing = Date.parse(tweet.xRemovalFirstMissingAt || '');
    const hasPrior = Number.isFinite(firstMissing) && nowMs - firstMissing >= CONFIRMATION_INTERVAL_MS
      && (tweet.xRemovalConfirmationCount || 0) >= 1;
    await updateTweet(tweet.id, {
      xRemovalLastCheckedAt: now.toISOString(),
      xRemovalFirstMissingAt: Number.isFinite(firstMissing) ? tweet.xRemovalFirstMissingAt : now.toISOString(),
      xRemovalConfirmationCount: hasPrior ? 2 : 1,
    });
    if (!hasPrior) continue;
    // A fact about availability is not evidence of the owner's editorial reason.
    await addLearningSignal(agent.id, {
      tweetId: tweet.id, xTweetId: String(tweet.xTweetId), signalType: 'deleted_from_x', surface: 'cron',
      rewardDelta: -0.8, inferred: true,
      reason: 'Two official by-ID checks confirmed the post is unavailable; editorial reason unknown.',
      metadata: { verifiedRemoval: true, verificationSource: 'official_by_id', confirmationCount: 2 },
    });
    await updateTweet(tweet.id, { status: 'deleted_from_x' });
    await addPostLogEntry(agent.id, {
      agentId: agent.id, tweetId: tweet.id, xTweetId: String(tweet.xTweetId), content: tweet.content,
      format: 'deletion_detected', topic: tweet.topic || 'general', postedAt: now.toISOString(), source: 'cron',
      action: 'skipped', reason: 'Post removal verified by two official by-ID lookups. No editorial reason inferred.',
    });
    confirmed++;
  }
  return confirmed;
}
