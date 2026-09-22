import { getOperatorComparison, observedAgeHours } from './antihunter-measurement';
import { ANTIHUNTER_AGENT_ID, parseOperatorBrief, validateCampaign } from './antihunter-operator-state';
import type { Tweet, TweetPerformance } from './types';

/** Read an explicit draft declaration; never infer a series from copy or results. */
function declaredEditorialSeries(thesis: unknown) {
  if (typeof thesis !== 'string') return null;
  const match = thesis.trim().match(/^Editorial series(?: assigned before publication)?: (The \$30 Machine|Expensive Humans|Receipts Court)(?:\.|$)/);
  return match?.[1] || null;
}

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
    const editorialSeries = declaredEditorialSeries(brief.thesis);
    return [{ id: tweet.id, xTweetId: tweet.xTweetId, status: tweet.status, content: tweet.content,
      postedAt: tweet.postedAt || null, format: tweet.format || null, topic: tweet.topic || null, campaign,
      editorialSeries, editorialSeriesSource: editorialSeries ? 'sourceBrief.thesis' : null,
      performance, observedAgeHours: performance ? observedAgeHours(performance) : null,
      comparison: getOperatorComparison(history, tweet.xTweetId) }];
  });
}
