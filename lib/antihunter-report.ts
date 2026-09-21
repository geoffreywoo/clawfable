import { getOperatorComparison, observedAgeHours } from './antihunter-measurement';
import { ANTIHUNTER_AGENT_ID, parseOperatorBrief, validateCampaign } from './antihunter-operator-state';
import type { Tweet, TweetPerformance } from './types';

/** Project already-loaded records; campaign-free posts and later deletions remain visible. */
export function getOperatorOriginals(tweets: Tweet[], history: TweetPerformance[]) {
  const latest = new Map<string, TweetPerformance>();
  for (const entry of history) {
    const checkedAt = Date.parse(entry.checkedAt);
    if (!Number.isFinite(checkedAt)) continue;
    const prior = latest.get(entry.xTweetId);
    if (!prior || checkedAt > Date.parse(prior.checkedAt)) latest.set(entry.xTweetId, entry);
  }
  return tweets.flatMap(tweet => {
    if (String(tweet.agentId) !== ANTIHUNTER_AGENT_ID || tweet.type !== 'original'
      || tweet.contentProvenance !== 'operator_written' || typeof tweet.xTweetId !== 'string' || !tweet.xTweetId.trim()) return [];
    const brief = parseOperatorBrief(tweet.sourceBrief);
    if (!brief) return [];
    let campaign: ReturnType<typeof validateCampaign> | null = null;
    try { if (brief.campaign) campaign = validateCampaign(brief.campaign); } catch { /* Unknown metadata stays unknown. */ }
    const performance = latest.get(tweet.xTweetId) || null;
    return [{ id: tweet.id, xTweetId: tweet.xTweetId, status: tweet.status, content: tweet.content,
      postedAt: tweet.postedAt || null, format: tweet.format || null, topic: tweet.topic || null, campaign,
      performance, observedAgeHours: performance ? observedAgeHours(performance) : null,
      comparison: getOperatorComparison(history, tweet.xTweetId) }];
  });
}
