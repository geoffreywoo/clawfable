import { ANTIHUNTER_AGENT_ID, parseOperatorBrief, validateCampaign, type OperatorGrowthState } from './antihunter-operator-state';
import type { Tweet } from './types';

export const OPERATOR_CADENCE = {
  targetOriginalsPerDay: 6,
  maxOriginalsPerRolling24Hours: 8,
  minimumGapMinutes: 90,
  maxPerCycle: 1,
  cycleMinutes: 30,
} as const;
const DAY_MS = 24 * 60 * 60_000;
const GAP_MS = OPERATOR_CADENCE.minimumGapMinutes * 60_000;

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

/** Account-5 originals, including legacy posts without operator-growth receipts. */
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
    // Deleting a published post does not restore a publishing slot.
    if (['posted', 'deleted_from_x'].includes(tweet.status) && tweet.xTweetId) remember(tweet.xTweetId, tweet.postedAt, true);
  }
  for (const receipt of Object.values(state.dispatches)) {
    if (['pending', 'uncertain'].includes(receipt.state)) blockedReason ||= 'Resolve the outstanding dispatch before publishing';
    if (receipt.state === 'posted' && !receipt.verifiedAt) blockedReason ||= 'Verify the previous publication and learning receipt before publishing';
    // These receipts are scoped to the original-only account-5 writer. If the
    // tweet record is absent, verification time is a conservative fallback.
    if (receipt.xTweetId && !posted.has(receipt.xTweetId)) remember(receipt.xTweetId, receipt.verifiedAt || receipt.at);
  }
  const recent = [...posted.values()].filter(at => now - at < DAY_MS).sort((a, b) => b - a);
  const lastPostedAt = posted.size ? Math.max(...posted.values()) : null;
  let eligibleAt = lastPostedAt === null ? now : Math.max(now, lastPostedAt + GAP_MS);
  if (recent.length >= OPERATOR_CADENCE.maxOriginalsPerRolling24Hours) {
    eligibleAt = Math.max(eligibleAt, recent[OPERATOR_CADENCE.maxOriginalsPerRolling24Hours - 1] + DAY_MS);
  }
  const blockedByReceipt = blockedReason !== null;
  if (!blockedReason && eligibleAt > now) blockedReason = 'Operator cadence cap: eight originals per rolling 24 hours, at least 90 minutes apart.';
  // The 90-minute gap also enforces at most one original in any 30-minute cycle.
  return { ...OPERATOR_CADENCE, postedLast24Hours: recent.length,
    lastPostedAt: lastPostedAt === null ? null : new Date(lastPostedAt).toISOString(),
    nextEligibleAt: blockedByReceipt ? null : new Date(eligibleAt).toISOString(), blockedReason };
}

export function assertOperatorCadence(tweets: Tweet[], state: OperatorGrowthState, now = Date.now()) {
  const { blockedReason } = getOperatorCadence(tweets, state, now);
  if (blockedReason) throw new Error(blockedReason);
}

/** Private read-only outbox; explicit fields, never raw source briefs or credentials. */
export function getOperatorOutbox(tweets: Tweet[], state: OperatorGrowthState) {
  return tweets.filter(tweet => String(tweet.agentId) === ANTIHUNTER_AGENT_ID && tweet.type === 'original' && tweet.status === 'draft'
    && tweet.contentProvenance === 'operator_written' && !tweet.quarantinedAt)
    .flatMap(tweet => {
      const brief = parseOperatorBrief(tweet.sourceBrief);
      const sources = brief?.sources.filter((source): source is string => typeof source === 'string' && Boolean(source.trim())) || [];
      if (!brief || !sources.length) return [];
      let campaign: ReturnType<typeof validateCampaign> | null = null;
      try { if (brief?.campaign) campaign = validateCampaign(brief.campaign); } catch { /* Invalid metadata remains unverified. */ }
      return [{ id: tweet.id, content: tweet.content, createdAt: typeof tweet.createdAt === 'string' ? tweet.createdAt : null,
        contentProvenance: tweet.contentProvenance || null, quarantinedAt: tweet.quarantinedAt || null,
        sources, campaign, hasImage: Boolean(brief.asset), dispatchState: state.dispatches[tweet.id]?.state || null }];
    }).sort((a, b) => (a.createdAt || '\uffff').localeCompare(b.createdAt || '\uffff') || a.id.localeCompare(b.id));
}
