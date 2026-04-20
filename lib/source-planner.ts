import type {
  AgentLearnings,
  ContentSourceLane,
  ManualExampleCuration,
  ManualTopicCluster,
  TrendTolerance,
  TweetPerformance,
} from './types';
import type { VoiceProfile } from './soul-parser';
import type { TrendingTopic } from './trending';

export interface TrendFitScores {
  freshness: number;
  velocity: number;
  soul: number;
  manual: number;
  total: number;
}

export interface EnrichedTrendingTopic extends TrendingTopic {
  fitScores: TrendFitScores;
  sourceLane: ContentSourceLane | 'reject';
  plannerReason: string;
}

export interface SourcePlannerSlot {
  slot: number;
  sourceLane: ContentSourceLane;
  mode: 'exploit' | 'explore';
  targetTopic: string;
  trendTopicId: string | null;
  trendHeadline: string | null;
  plannerReason: string;
}

export interface SourcePlannerPlan {
  slots: SourcePlannerSlot[];
  laneCounts: Record<ContentSourceLane, number>;
  acceptedTrends: EnrichedTrendingTopic[];
  rejectedTrends: EnrichedTrendingTopic[];
}

const PROMO_PATTERNS = [
  'clawfable.com',
  'sign up',
  'waitlist',
  'launching',
  'announcing',
  'available now',
  'book a demo',
  'try it here',
];

const BASE_LANE_BUDGETS: Record<'safe' | 'balanced' | 'explore', Record<ContentSourceLane, number>> = {
  safe: {
    manual_core_exploit: 0.6,
    trend_aligned_exploit: 0.25,
    trend_adjacent_explore: 0,
    core_explore_fallback: 0.15,
  },
  balanced: {
    manual_core_exploit: 0.5,
    trend_aligned_exploit: 0.3,
    trend_adjacent_explore: 0,
    core_explore_fallback: 0.2,
  },
  explore: {
    manual_core_exploit: 0.35,
    trend_aligned_exploit: 0.35,
    trend_adjacent_explore: 0,
    core_explore_fallback: 0.3,
  },
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeTopic(value: string | null | undefined): string {
  return (value || 'general').trim().toLowerCase();
}

function parseDate(value: string | null | undefined): number {
  const ts = value ? Date.parse(value) : NaN;
  return Number.isFinite(ts) ? ts : 0;
}

function weightedEngagement(tweet: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies'>): number {
  return tweet.likes + tweet.retweets + (tweet.replies * 2);
}

function recencyWeight(isoDate: string): number {
  const ageMs = Math.max(0, Date.now() - parseDate(isoDate));
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / 30);
}

function engagementWeight(tweet: TweetPerformance): number {
  return weightedEngagement(tweet) * recencyWeight(tweet.postedAt || tweet.checkedAt);
}

function isPinned(curation: ManualExampleCuration | null | undefined, xTweetId: string): boolean {
  return Boolean(curation?.pinnedXTweetIds.some((id) => String(id) === String(xTweetId)));
}

function isBlocked(curation: ManualExampleCuration | null | undefined, xTweetId: string): boolean {
  return Boolean(curation?.blockedXTweetIds.some((id) => String(id) === String(xTweetId)));
}

function firstMeaningfulLine(content: string): string {
  const line = content
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.length > 0) || content.trim();
  return line.replace(/^[@#]\S+\s*/, '').slice(0, 80).trim();
}

function isLikelyReply(tweet: TweetPerformance): boolean {
  const trimmed = tweet.content.trim();
  return /^@\w+/.test(trimmed);
}

function isLowSignalPromo(tweet: TweetPerformance): boolean {
  const lower = tweet.content.toLowerCase();
  return PROMO_PATTERNS.some((pattern) => lower.includes(pattern));
}

function usableManualTweet(tweet: TweetPerformance, curation: ManualExampleCuration | null | undefined): boolean {
  if (!tweet.content || tweet.content.trim().length < 25) return false;
  if (isPinned(curation, tweet.xTweetId)) return true;
  if (isBlocked(curation, tweet.xTweetId)) return false;
  if (isLikelyReply(tweet)) return false;
  if (isLowSignalPromo(tweet)) return false;
  return true;
}

export function buildManualTopicProfile(
  history: TweetPerformance[],
  curation: ManualExampleCuration | null | undefined,
): ManualTopicCluster[] {
  const usable = history.filter((tweet) => usableManualTweet(tweet, curation));
  if (usable.length === 0) return [];

  const buckets = new Map<string, TweetPerformance[]>();
  for (const tweet of usable) {
    const key = normalizeTopic(tweet.topic);
    const bucket = buckets.get(key) || [];
    bucket.push(tweet);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([topic, tweets]) => {
      const sorted = [...tweets].sort((a, b) => engagementWeight(b) - engagementWeight(a));
      const totalWeight = sorted.reduce((sum, tweet) => sum + engagementWeight(tweet), 0);
      const avgEngagement = Math.round(sorted.reduce((sum, tweet) => sum + weightedEngagement(tweet), 0) / Math.max(sorted.length, 1));
      return {
        topic,
        angle: firstMeaningfulLine(sorted[0]?.thesis || sorted[0]?.content || topic),
        weight: Number(totalWeight.toFixed(2)),
        sampleCount: sorted.length,
        avgEngagement,
        topTweets: sorted.slice(0, 3),
      } satisfies ManualTopicCluster;
    })
    .sort((a, b) => b.weight - a.weight || b.avgEngagement - a.avgEngagement || a.topic.localeCompare(b.topic))
    .slice(0, 8);
}

function topicFitScore(label: string, topics: string[]): number {
  if (!label) return 0;
  const lower = label.toLowerCase();
  const normalizedTopics = topics.map((topic) => topic.toLowerCase());
  if (normalizedTopics.some((topic) => lower.includes(topic) || topic.includes(lower))) return 1;
  return normalizedTopics.some((topic) => {
    const terms = topic.split(/[\s/_-]+/).filter((term) => term.length >= 4);
    return terms.some((term) => lower.includes(term));
  }) ? 0.58 : 0;
}

function manualFitScore(topic: TrendingTopic, clusters: ManualTopicCluster[]): number {
  const haystack = `${topic.category} ${topic.headline} ${topic.topTweet?.text || ''}`.toLowerCase();
  let best = 0;
  for (const cluster of clusters) {
    const topicMatch = topicFitScore(haystack, [cluster.topic]);
    const angleMatch = topicFitScore(haystack, [cluster.angle]);
    best = Math.max(best, Math.max(topicMatch, angleMatch * 0.85));
  }
  return best;
}

function freshnessScore(topic: TrendingTopic): number {
  const ageHours = Math.max(0.25, (Date.now() - parseDate(topic.timestamp)) / (1000 * 60 * 60));
  return clamp(1 - (ageHours / 24));
}

function velocityScore(topic: TrendingTopic): number {
  const likes = topic.topTweet?.likes || 0;
  const ageHours = Math.max(0.5, (Date.now() - parseDate(topic.timestamp)) / (1000 * 60 * 60));
  return clamp((likes / ageHours) / 250);
}

export function enrichTrendingTopics(
  trending: TrendingTopic[],
  voiceProfile: VoiceProfile,
  learnings: AgentLearnings | null,
  tolerance: TrendTolerance = 'moderate',
): EnrichedTrendingTopic[] {
  const manualClusters = learnings?.manualTopicProfile || [];

  return trending.map((topic) => {
    const haystack = `${topic.category} ${topic.headline} ${topic.topTweet?.text || ''}`;
    const soul = topicFitScore(haystack, voiceProfile.topics);
    const manual = manualFitScore(topic, manualClusters);
    const freshness = freshnessScore(topic);
    const velocity = velocityScore(topic);
    const total = clamp((freshness * 0.28) + (velocity * 0.28) + (soul * 0.22) + (manual * 0.22));

    let sourceLane: ContentSourceLane | 'reject' = 'reject';
    let plannerReason = 'Trend is too stale or too far from the account voice.';

    if (total >= 0.6 && (soul >= 0.45 || manual >= 0.45)) {
      sourceLane = 'trend_aligned_exploit';
      plannerReason = 'Hot trend with strong manual/core topic fit.';
    } else if (
      tolerance !== 'adjacent'
      ? total >= 0.42 && (soul >= 0.18 || manual >= 0.22) && freshness >= 0.2
      : total >= 0.5 && (soul >= 0.3 || manual >= 0.3)
    ) {
      sourceLane = 'trend_adjacent_explore';
      plannerReason = tolerance === 'aggressive'
        ? 'Trend is outside the core, but hot enough for a measured exploration slot.'
        : 'Trend is adjacent to the core voice and acceptable for exploration.';
    }

    return {
      ...topic,
      fitScores: {
        freshness: Number(freshness.toFixed(3)),
        velocity: Number(velocity.toFixed(3)),
        soul: Number(soul.toFixed(3)),
        manual: Number(manual.toFixed(3)),
        total: Number(total.toFixed(3)),
      },
      sourceLane,
      plannerReason,
    } satisfies EnrichedTrendingTopic;
  });
}

function allocateCounts(
  count: number,
  budgets: Record<ContentSourceLane, number>,
): Record<ContentSourceLane, number> {
  const entries = Object.entries(budgets) as Array<[ContentSourceLane, number]>;
  const counts = Object.fromEntries(entries.map(([lane]) => [lane, 0])) as Record<ContentSourceLane, number>;
  if (count <= 0) return counts;

  const weighted = entries.map(([lane, ratio]) => ({ lane, exact: ratio * count }));
  let assigned = 0;
  for (const item of weighted) {
    const base = Math.floor(item.exact);
    counts[item.lane] = base;
    assigned += base;
  }

  const remainder = count - assigned;
  weighted
    .sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))
    .slice(0, remainder)
    .forEach((item) => { counts[item.lane] += 1; });

  return counts;
}

function distributeLanes(counts: Record<ContentSourceLane, number>): ContentSourceLane[] {
  const entries = (Object.entries(counts) as Array<[ContentSourceLane, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const lanes: ContentSourceLane[] = [];
  let remaining = entries.reduce((sum, [, count]) => sum + count, 0);

  while (remaining > 0) {
    for (const entry of entries) {
      if (entry[1] <= 0) continue;
      lanes.push(entry[0]);
      entry[1] -= 1;
      remaining -= 1;
    }
  }

  return lanes;
}

function pickManualTopics(learnings: AgentLearnings | null, fallbackTopics: string[]): string[] {
  const manualTopics = (learnings?.manualTopicProfile || []).map((cluster) => cluster.topic);
  return [...new Set([...manualTopics, ...fallbackTopics.map((topic) => normalizeTopic(topic)).filter(Boolean)])].filter(Boolean);
}

export function buildSourcePlannerPlan({
  count,
  autonomyMode,
  trendMixTarget = 35,
  trendTolerance = 'moderate',
  voiceProfile,
  learnings,
  trending,
  fallbackTopics = [],
}: {
  count: number;
  autonomyMode: 'safe' | 'balanced' | 'explore';
  trendMixTarget?: number;
  trendTolerance?: TrendTolerance;
  voiceProfile: VoiceProfile;
  learnings: AgentLearnings | null;
  trending: TrendingTopic[] | null;
  fallbackTopics?: string[];
}): SourcePlannerPlan {
  const accepted = enrichTrendingTopics(trending || [], voiceProfile, learnings, trendTolerance)
    .sort((a, b) => b.fitScores.total - a.fitScores.total || b.relevanceScore - a.relevanceScore);
  const acceptedAligned = accepted.filter((topic) => topic.sourceLane === 'trend_aligned_exploit');
  const acceptedAdjacent = accepted.filter((topic) => topic.sourceLane === 'trend_adjacent_explore');
  const rejectedTrends = accepted.filter((topic) => topic.sourceLane === 'reject');

  const baseBudgets = BASE_LANE_BUDGETS[autonomyMode];
  const desiredTrendShare = clamp((trendMixTarget || 0) / 100);
  const totalTrendCap = baseBudgets.trend_aligned_exploit + baseBudgets.core_explore_fallback;
  const adjustedTrendShare = Math.min(totalTrendCap, Math.max(0.1, desiredTrendShare));
  const adjustedBudgets: Record<ContentSourceLane, number> = {
    manual_core_exploit: clamp(1 - adjustedTrendShare, 0.25, 0.8),
    trend_aligned_exploit: Math.min(baseBudgets.trend_aligned_exploit, adjustedTrendShare),
    trend_adjacent_explore: 0,
    core_explore_fallback: 0,
  };
  const remainingTrendShare = adjustedTrendShare - adjustedBudgets.trend_aligned_exploit;
  adjustedBudgets.trend_adjacent_explore = Math.min(baseBudgets.core_explore_fallback, Math.max(0, remainingTrendShare * 0.45));
  adjustedBudgets.core_explore_fallback = Math.max(0, adjustedTrendShare - adjustedBudgets.trend_aligned_exploit - adjustedBudgets.trend_adjacent_explore);

  const laneCounts = allocateCounts(count, adjustedBudgets);
  const alignedQuota = Math.min(laneCounts.trend_aligned_exploit, acceptedAligned.length);
  const adjacentQuota = Math.min(laneCounts.trend_adjacent_explore, acceptedAdjacent.length);
  const missingTrendSlots = (laneCounts.trend_aligned_exploit - alignedQuota) + (laneCounts.trend_adjacent_explore - adjacentQuota);
  laneCounts.trend_aligned_exploit = alignedQuota;
  laneCounts.trend_adjacent_explore = adjacentQuota;
  laneCounts.core_explore_fallback += Math.max(0, missingTrendSlots);

  const orderedLanes = distributeLanes(laneCounts).slice(0, count);
  const manualTopics = pickManualTopics(learnings, [...voiceProfile.topics, ...fallbackTopics]);
  const fallbackPool = [...new Set([...fallbackTopics, ...voiceProfile.topics])].filter(Boolean);

  const slots: SourcePlannerSlot[] = [];
  let alignedIndex = 0;
  let adjacentIndex = 0;
  let manualIndex = 0;
  let fallbackIndex = 0;

  for (let index = 0; index < orderedLanes.length; index++) {
    const lane = orderedLanes[index];
    let targetTopic = manualTopics[manualIndex % Math.max(manualTopics.length, 1)] || fallbackPool[0] || 'general';
    let trendTopicId: string | null = null;
    let trendHeadline: string | null = null;
    let plannerReason = 'Exploit proven manual topics and voice anchors.';
    let mode: 'exploit' | 'explore' = lane === 'manual_core_exploit' || lane === 'trend_aligned_exploit' ? 'exploit' : 'explore';

    if (lane === 'trend_aligned_exploit' && acceptedAligned[alignedIndex]) {
      const trend = acceptedAligned[alignedIndex++];
      targetTopic = trend.category || targetTopic;
      trendTopicId = String(trend.id);
      trendHeadline = trend.headline;
      plannerReason = trend.plannerReason;
    } else if (lane === 'trend_adjacent_explore' && acceptedAdjacent[adjacentIndex]) {
      const trend = acceptedAdjacent[adjacentIndex++];
      targetTopic = trend.category || targetTopic;
      trendTopicId = String(trend.id);
      trendHeadline = trend.headline;
      plannerReason = trend.plannerReason;
    } else if (lane === 'core_explore_fallback') {
      targetTopic = fallbackPool[fallbackIndex % Math.max(fallbackPool.length, 1)] || targetTopic;
      fallbackIndex++;
      plannerReason = 'Trend slots were unavailable, so this slot explores an underused core topic instead.';
    } else {
      manualIndex++;
    }

    slots.push({
      slot: index + 1,
      sourceLane: lane,
      mode,
      targetTopic,
      trendTopicId,
      trendHeadline,
      plannerReason,
    });
  }

  return {
    slots,
    laneCounts,
    acceptedTrends: [...acceptedAligned, ...acceptedAdjacent],
    rejectedTrends,
  };
}
