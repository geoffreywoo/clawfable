import { ANTIHUNTER_AGENT_ID, parseOperatorBrief, validateCampaign, type OperatorGrowthState, type OperatorReplyContext } from './antihunter-operator-state';
import { reviewedOperatorReply } from './antihunter-replies';
import type { Tweet } from './types';

export const OPERATOR_CADENCE = {
  mode: 'readiness-and-budget',
  targetOriginalsPerDay: null,
  maxOriginalsPerRolling24Hours: null,
  minimumGapMinutes: 0,
  maxPerCycle: null,
  cycleMinutes: 30,
} as const;
const DAY_MS = 24 * 60 * 60_000;

/** Missing legacy dates only; this decodes an existing post ID, not proof of publication.
 * X's string/64-bit contract: https://docs.x.com/fundamentals/x-ids
 * Epoch and 22-bit layout: https://github.com/twitter-archive/snowflake/blob/snowflake-2010/src/main/scala/com/twitter/service/snowflake/IdWorker.scala
 */
function snowflakeCreatedAt(id: unknown): number {
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(id)) return NaN;
  const bits = BigInt(id);
  if (bits > BigInt('18446744073709551615')) return NaN;
  const elapsed = bits >> BigInt(22);
  // Tiny IDs without timestamp bits cannot supply a usable creation time.
  if (elapsed === BigInt(0)) return NaN;
  return Number(elapsed) + 1_288_834_974_657;
}

/** Account-5 readiness barriers and informational original counts; no fixed posting throttle. */
export function getOperatorCadence(tweets: Tweet[], state: OperatorGrowthState, now = Date.now()) {
  const posted = new Map<string, number>();
  let blockedReason: string | null = null;
  const remember = (id: string, value: string | null | undefined, allowMissingDateFallback = false) => {
    const at = value == null && allowMissingDateFallback ? snowflakeCreatedAt(id) : value ? Date.parse(value) : NaN;
    if (!Number.isFinite(at) || at > now) {
      blockedReason ||= 'Resolve the invalid publication timestamp before publishing';
      return;
    }
    posted.set(id, Math.max(posted.get(id) ?? -Infinity, at));
  };
  for (const tweet of tweets) {
    if (String(tweet.agentId) !== ANTIHUNTER_AGENT_ID || tweet.type !== 'original') continue;
    // Deleting a published post does not remove it from the activity record.
    if (['posted', 'deleted_from_x'].includes(tweet.status) && tweet.xTweetId) remember(tweet.xTweetId, tweet.postedAt, true);
  }
  for (const receipt of Object.values(state.dispatches)) {
    if (['pending', 'uncertain'].includes(receipt.state)) blockedReason ||= 'Resolve the outstanding dispatch before publishing';
    if (receipt.state === 'posted' && !receipt.verifiedAt) blockedReason ||= 'Verify the previous publication and learning receipt before publishing';
    // Legacy receipts without a type are originals. Reply receipts retain the
    // same readiness barriers but do not contribute to original-post counts.
    // If a tweet record is absent, verification time is a conservative fallback.
    if (receipt.xTweetId) {
      if (receipt.type === 'reply') {
        const at = Date.parse(receipt.verifiedAt || receipt.at);
        if (!Number.isFinite(at) || at > now) blockedReason ||= 'Resolve the invalid publication timestamp before publishing';
      } else if (!posted.has(receipt.xTweetId)) remember(receipt.xTweetId, receipt.verifiedAt || receipt.at);
    }
  }
  const recent = [...posted.values()].filter(at => now - at < DAY_MS).sort((a, b) => b - a);
  const lastPostedAt = posted.size ? Math.max(...posted.values()) : null;
  // Readiness does not authorize a write: identity, budget reservations and
  // duplicate protection remain mandatory at the publication boundary.
  return { ...OPERATOR_CADENCE, postedLast24Hours: recent.length,
    lastPostedAt: lastPostedAt === null ? null : new Date(lastPostedAt).toISOString(),
    nextEligibleAt: blockedReason ? null : new Date(now).toISOString(), blockedReason };
}

export function assertOperatorCadence(tweets: Tweet[], state: OperatorGrowthState, now = Date.now()) {
  const { blockedReason } = getOperatorCadence(tweets, state, now);
  if (blockedReason) throw new Error(blockedReason);
}

/** Private read-only outbox; explicit fields, never raw source briefs or credentials. */
export function getOperatorOutbox(tweets: Tweet[], state: OperatorGrowthState) {
  return tweets.filter(tweet => String(tweet.agentId) === ANTIHUNTER_AGENT_ID && ['original', 'reply'].includes(tweet.type) && tweet.status === 'draft'
    && tweet.contentProvenance === 'operator_written' && !tweet.quarantinedAt)
    .flatMap(tweet => {
      const brief = parseOperatorBrief(tweet.sourceBrief);
      const sources = brief?.sources.filter((source): source is string => typeof source === 'string' && Boolean(source.trim())) || [];
      if (!brief || !sources.length) return [];
      let reply: OperatorReplyContext | null = null;
      if (tweet.type === 'reply') {
        try {
          const reviewed = reviewedOperatorReply(tweet);
          reply = { targetTweetId: reviewed.targetTweetId, targetAuthorId: reviewed.targetAuthorId,
            conversationId: reviewed.conversationId, targetText: reviewed.targetText,
            verifiedAt: reviewed.verifiedAt, reason: reviewed.reason, mentionUserId: reviewed.mentionUserId };
        } catch { return []; }
      }
      let campaign: ReturnType<typeof validateCampaign> | null = null;
      try { if (brief?.campaign) campaign = validateCampaign(brief.campaign); } catch { /* Invalid metadata remains unverified. */ }
      return [{ id: tweet.id, type: tweet.type, content: tweet.content, createdAt: typeof tweet.createdAt === 'string' ? tweet.createdAt : null,
        contentProvenance: tweet.contentProvenance || null, quarantinedAt: tweet.quarantinedAt || null,
        sources, campaign, reply, hasImage: Boolean(brief.asset), dispatchState: state.dispatches[tweet.id]?.state || null }];
    }).sort((a, b) => (a.createdAt || '\uffff').localeCompare(b.createdAt || '\uffff') || a.id.localeCompare(b.id));
}
