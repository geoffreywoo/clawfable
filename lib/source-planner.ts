import type {
  AgentLearnings,
  ContentSourceLane,
  ManualExampleCuration,
  ManualTopicCluster,
  TrendTolerance,
  TweetPerformance,
} from './types';
import type { VoiceProfile } from './soul-parser';
import { getTrendingTopicStableId, type TrendingTopic } from './trending';
import { formatFrontierIdeaSeedBrief, pickFrontierIdeaSeed, type FrontierIdeaSeed } from './frontier-idea-seeds';
import { isGeoffreyVoiceProfile } from './account-taste';

export interface TrendFitScores {
  freshness: number;
  velocity: number;
  soul: number;
  manual: number;
  identityFit?: number;
  driftRisk?: number;
  networkMomentum?: number;
  sourceQuality?: number;
  total: number;
}

export interface EnrichedTrendingTopic extends TrendingTopic {
  fitScores: TrendFitScores;
  sourceLane: ContentSourceLane | 'reject';
  plannerReason: string;
}

export interface NativeTopicIdentityAssessment {
  soul: number;
  manual: number;
  identityFit: number;
  driftRisk: number;
}

export interface SourcePlannerSlot {
  slot: number;
  sourceLane: ContentSourceLane;
  mode: 'exploit' | 'explore';
  targetTopic: string;
  trendTopicId: string | null;
  trendHeadline: string | null;
  ideaSeed: FrontierIdeaSeed | null;
  ideaSeedBrief: string | null;
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

const IDENTITY_STOP_WORDS = new Set([
  'about', 'account', 'after', 'against', 'also', 'before', 'being', 'between', 'could', 'current',
  'deep', 'from', 'frontier', 'hard', 'ideas', 'into', 'more', 'native', 'other', 'posts', 'should',
  'technical', 'technology', 'their', 'these', 'they', 'this', 'topics', 'voice', 'where', 'which',
  'with', 'write', 'writing', 'would',
]);

const GENERIC_IDENTITY_BRIDGE_TOKENS = new Set([
  'account', 'business', 'capacity', 'company', 'founder', 'founders', 'future', 'industry',
  'industrial', 'infrastructure', 'investor', 'investors', 'market', 'markets', 'operator',
  'operators', 'software', 'startup', 'startups', 'system', 'systems', 'tech', 'technical', 'technology',
]);

const BROAD_IDENTITY_TOPICS = new Set([
  'ai',
  'compute',
  'energy',
  'frontier tech',
  'deep tech',
  'hard tech',
  'manufacturing',
  're industrialization',
  'robotics',
  'space',
  'tech',
  'technology',
]);

const POLITICS_LED_TOPIC_PATTERN = /\b(?:biden|campaign|democrat|election|geopolitic|putin|republican|trump|white house)\b/i;
const GEOFFREY_RELEVANT_EVENT_PATTERN = /\b(?:accelerators?|agents?|aircraft|anduril|anthropic|apps?|archer|automation|autonomous|batter(?:y|ies)|chatgpt|chips?|claude|compute|data centers?|defense|drones?|e2b|energy|factor(?:y|ies)|fission|fusion|grids?|hugging face|inference|manufactur(?:e|ing)|minerals?|models?|nuclear|openai|power|prompts?|rare earth|reactors?|robots?|robotics|rockets?|semiconductors?|space|startups?|user scale|vertical lift|xiaomi)\b/i;
const GEOFFREY_AI_TOKEN_PATTERN = /(?:^|[\s/(])ai(?:$|[\s/),.:-])/i;
const GEOFFREY_NAMED_TECH_PATTERN = /\b(?:anduril|anthropic|archer|chatgpt|claude|e2b|hugging face|nvidia|openai|spacex|tsmc|xiaomi)\b/i;
const GEOFFREY_CONCRETE_EVENT_PATTERN = /\b(?:battlefield|benchmarks?|capacity|customers?|deployments?|factor(?:y|ies)|infrastructure|land|latency|payload|pricing|process|rate limits?|scale|supply|throttl(?:e|ed|ing)|throughput|training|vertical lift|yield)\b/i;
const GENERIC_BREAKOUT_EVENT_PATTERN = /\b(?:big|breakout|future|huge|moment|taking off|the next big thing)\b/i;

const BASE_LANE_BUDGETS: Record<'safe' | 'balanced' | 'explore', Record<ContentSourceLane, number>> = {
  safe: {
    manual_core_exploit: 0.55,
    trend_aligned_exploit: 0.25,
    trend_adjacent_explore: 0.05,
    core_explore_fallback: 0.15,
  },
  balanced: {
    manual_core_exploit: 0.45,
    trend_aligned_exploit: 0.3,
    trend_adjacent_explore: 0.1,
    core_explore_fallback: 0.15,
  },
  explore: {
    manual_core_exploit: 0.3,
    trend_aligned_exploit: 0.35,
    trend_adjacent_explore: 0.15,
    core_explore_fallback: 0.2,
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
  if (isBlocked(curation, tweet.xTweetId)) return false;
  if (isPinned(curation, tweet.xTweetId)) return true;
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
  const lower = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const labelTokens = new Set(lower.split(/\s+/).filter(Boolean));
  const normalizedTopics = topics.map((topic) => topic.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
  let best = 0;
  for (const topic of normalizedTopics) {
    const topicTokens = topic.split(/\s+/).filter(Boolean);
    const distinctive = topicTokens.filter((token) => !GENERIC_IDENTITY_BRIDGE_TOKENS.has(token));
    const exactMatch = topicTokens.length === 1
      ? labelTokens.has(topicTokens[0])
      : ` ${lower} `.includes(` ${topic} `);
    if (exactMatch) {
      // A broad category says where a post lives, not whether it belongs to
      // this particular person. Narrow phrases and mechanisms remain strong.
      best = Math.max(
        best,
        BROAD_IDENTITY_TOPICS.has(topic) || distinctive.length === 0 ? 0.16 : 1,
      );
      continue;
    }
    if (distinctive.length === 0) continue;
    const overlap = distinctive.filter((token) => labelTokens.has(token)).length;
    if (overlap >= 2) {
      best = Math.max(best, Math.min(0.86, 0.58 + (overlap / distinctive.length) * 0.28));
    } else if (overlap === 1 && distinctive.length === 1) {
      best = Math.max(best, 0.5);
    } else if (overlap === 1) {
      best = Math.max(best, 0.18);
    }
  }
  return best;
}

function identityTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => (
        token.length >= 4
        && !IDENTITY_STOP_WORDS.has(token)
        && !GENERIC_IDENTITY_BRIDGE_TOKENS.has(token)
        && !/^\d+$/.test(token)
      )),
  );
}

function profileContextFitScore(label: string, voiceProfile: VoiceProfile): number {
  const candidate = identityTokens(label);
  if (candidate.size === 0) return 0;
  const nativeCommunicationStyle = voiceProfile.communicationStyle
    .split(/\n## ACCOUNT (?:TOPIC|ANTI-SLOP) POLICY\b/i)[0];
  const context = identityTokens(`${voiceProfile.summary} ${nativeCommunicationStyle}`);
  const overlap = [...candidate].filter((token) => context.has(token)).length;
  if (overlap >= 4) return 0.82;
  if (overlap === 3) return 0.68;
  if (overlap === 2) return 0.5;
  if (overlap === 1) return 0.16;
  return 0;
}

function manualFitScore(topic: Pick<TrendingTopic, 'category' | 'headline' | 'topTweet'>, clusters: ManualTopicCluster[]): number {
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
  return clamp(1 - (ageHours / 72));
}

function velocityScore(topic: TrendingTopic): number {
  const engagement = topic.engagementScore ?? topic.topTweet?.likes ?? 0;
  const ageHours = Math.max(0.5, (Date.now() - parseDate(topic.timestamp)) / (1000 * 60 * 60));
  const sourceScale = topic.sourceType === 'hacker_news' ? 12 : 250;
  return clamp((engagement / ageHours) / sourceScale);
}

function sourceQualityScore(topic: TrendingTopic): number {
  if (typeof topic.sourceQuality === 'number') return clamp(topic.sourceQuality);
  let score = topic.sourceType === 'hacker_news' ? 0.62 : 0.58;
  if (topic.sourceUrl) score += 0.12;
  if (topic.publisher) score += 0.06;
  if (topic.isPrimarySource) score += 0.12;
  if ((topic.sourceCount || 1) > 1) score += 0.08;
  return clamp(score);
}

function followedNetworkMomentumScore(topic: TrendingTopic): number {
  if (topic.discoveryMethod !== 'followed_network') return 0;
  const momentum = typeof topic.networkMomentumScore === 'number' ? topic.networkMomentumScore : 0;
  const breakout = typeof topic.networkBreakoutScore === 'number' ? topic.networkBreakoutScore : 0;
  const confidence = typeof topic.topicConfidence === 'number' ? topic.topicConfidence : 0.5;
  const diversity = clamp((topic.sourceCount || 1) / 4);
  return clamp(momentum * 0.55 + breakout * 0.2 + confidence * 0.15 + diversity * 0.1);
}

export function assessNativeTopicIdentity(
  topic: Pick<TrendingTopic, 'category' | 'headline' | 'topTweet'>,
  voiceProfile: VoiceProfile,
  learnings: AgentLearnings | null,
): NativeTopicIdentityAssessment {
  const haystack = `${topic.category} ${topic.headline} ${topic.topTweet?.text || ''}`;
  const geoffreyConcreteBridge = (() => {
    const relevantEvent = GEOFFREY_RELEVANT_EVENT_PATTERN.test(haystack)
      || GEOFFREY_AI_TOKEN_PATTERN.test(haystack);
    if (!isGeoffreyVoiceProfile(voiceProfile) || !relevantEvent) return 0;
    const headline = topic.headline.trim();
    const category = normalizeTopic(topic.category);
    const broadCategory = BROAD_IDENTITY_TOPICS.has(category);
    const namedTech = GEOFFREY_NAMED_TECH_PATTERN.test(haystack);
    const concreteEvent = GEOFFREY_CONCRETE_EVENT_PATTERN.test(haystack);
    const genericBreakout = GENERIC_BREAKOUT_EVENT_PATTERN.test(headline)
      && !namedTech
      && !concreteEvent;
    const specificHeadline = headline.split(/\s+/).filter(Boolean).length >= 4
      && normalizeTopic(headline) !== category
      && !genericBreakout;
    const namedProductLabel = namedTech && /[a-z]+[-/][a-z0-9-]+|\d/i.test(headline);

    if (namedTech && (concreteEvent || specificHeadline || namedProductLabel)) return 0.72;
    if (concreteEvent && specificHeadline) return 0.64;
    if (!broadCategory && specificHeadline) return 0.54;
    return 0;
  })();
  const soul = Math.max(
    topicFitScore(haystack, voiceProfile.topics),
    profileContextFitScore(haystack, voiceProfile),
    geoffreyConcreteBridge,
  );
  const manual = manualFitScore(topic, learnings?.manualTopicProfile || []);
  const identityFit = Math.max(soul, manual);
  return {
    soul: Number(soul.toFixed(3)),
    manual: Number(manual.toFixed(3)),
    identityFit: Number(identityFit.toFixed(3)),
    driftRisk: Number(clamp(1 - identityFit).toFixed(3)),
  };
}

export function formatTrendEvidence(topic: TrendingTopic): string {
  const sourceType = topic.sourceType === 'hacker_news' ? 'Hacker News' : 'X';
  const timestampLabel = topic.sourceType === 'hacker_news' ? 'discovered' : 'published';
  const metadata = [
    `source=${sourceType}`,
    topic.publisher ? `publisher=${topic.publisher}` : null,
    topic.timestamp ? `${timestampLabel}=${topic.timestamp}` : null,
    topic.sourceUrl ? `url=${topic.sourceUrl}` : null,
  ].filter(Boolean).join('; ');
  const sourceText = topic.topTweet?.text?.trim();
  const additionalEvidence = sourceText && sourceText !== topic.headline
    ? ` Source text: ${sourceText.slice(0, 500)}`
    : '';
  const networkMetadata = topic.discoveryMethod === 'followed_network'
    ? ` Followed-network topicId=${topic.networkTopicId || topic.id}; topic=${topic.category}; momentum=${Number(topic.networkMomentumScore || 0).toFixed(3)}; momentumDelta=${Number(topic.networkMomentumDelta || 0).toFixed(3)}; sourceAuthors=${topic.sourceCount || 1}; whyNow=${topic.topicWhyNow || 'breakout posts in the followed network'}.`
    : '';
  const networkEvidence = topic.discoveryMethod === 'followed_network' && topic.evidence?.length
    ? ` Evidence: ${topic.evidence.slice(0, 4).map((item) => (
      `@${item.author} (${item.breakoutMultiple.toFixed(2)}x author baseline; score ${item.viralScore.toFixed(3)}; ${item.sourceUrl}): ${item.text.slice(0, 280)}`
    )).join(' | ')}`
    : '';
  return `Current event [${metadata}]: ${topic.headline}${networkMetadata}${additionalEvidence}${networkEvidence}`;
}

export function getTrendSourceEvidenceTexts(topic: TrendingTopic): string[] {
  const evidence = topic.discoveryMethod === 'followed_network'
    ? (topic.evidence || []).map((item) => item.text)
    : [topic.topTweet?.text];
  return [...new Set(evidence.map((text) => String(text || '').replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .slice(0, 4)
    .map((text) => text.slice(0, 420));
}

export function formatTrendProvenance(topic: TrendingTopic): string {
  const sourceType = topic.sourceType === 'hacker_news' ? 'Hacker News' : 'X';
  const stableId = getTrendingTopicStableId(topic);
  const urls = [...new Set([
    topic.sourceUrl,
    ...(topic.evidence || []).map((item) => item.sourceUrl),
  ].filter((value): value is string => Boolean(value)))].slice(0, 4);
  const metadata = [
    `source=${sourceType}`,
    `topicId=${stableId}`,
    `topic=${topic.category}`,
    topic.timestamp ? `published=${topic.timestamp}` : null,
    topic.observedAt ? `observed=${topic.observedAt}` : null,
    topic.discoveryMethod === 'followed_network' ? `followed-network=true` : null,
    topic.networkMomentumScore !== null && topic.networkMomentumScore !== undefined
      ? `momentum=${Number(topic.networkMomentumScore).toFixed(3)}`
      : null,
    urls.length > 0 ? `urls=${urls.join(',')}` : null,
  ].filter(Boolean).join('; ');
  return `Current subject provenance [${metadata}]`;
}

export function enrichTrendingTopics(
  trending: TrendingTopic[],
  voiceProfile: VoiceProfile,
  learnings: AgentLearnings | null,
  tolerance: TrendTolerance = 'moderate',
): EnrichedTrendingTopic[] {
  return trending.map((topic) => {
    const identity = assessNativeTopicIdentity(topic, voiceProfile, learnings);
    const { soul, manual, identityFit, driftRisk } = identity;
    const freshness = freshnessScore(topic);
    const velocity = velocityScore(topic);
    const sourceQuality = sourceQualityScore(topic);
    const networkMomentum = followedNetworkMomentumScore(topic);
    const isFollowedNetworkTopic = topic.discoveryMethod === 'followed_network';
    const total = clamp(isFollowedNetworkTopic
      ? (freshness * 0.12)
        + (velocity * 0.1)
        + (soul * 0.18)
        + (manual * 0.14)
        + (identityFit * 0.16)
        + (sourceQuality * 0.1)
        + (networkMomentum * 0.2)
      : (freshness * 0.25)
        + (velocity * 0.2)
        + (soul * 0.2)
        + (manual * 0.2)
        + (sourceQuality * 0.15));
    const networkQualified = isFollowedNetworkTopic
      && networkMomentum >= 0.62
      && (topic.topicConfidence || 0) >= 0.45
      && ((topic.sourceCount || 1) >= 2 || (topic.networkBreakoutScore || 0) >= 0.78);
    const adjacentIdentityFloor = tolerance === 'adjacent' ? 0.32 : tolerance === 'aggressive' ? 0.18 : 0.24;
    const hasAlignedIdentityBridge = identityFit >= 0.45;
    const hasAdjacentIdentityBridge = identityFit >= adjacentIdentityFloor;
    const politicsLedDrift = isGeoffreyVoiceProfile(voiceProfile)
      && POLITICS_LED_TOPIC_PATTERN.test(`${topic.category} ${topic.headline} ${topic.topTweet?.text || ''}`)
      && manual < 0.55;

    let sourceLane: ContentSourceLane | 'reject' = 'reject';
    let plannerReason = 'Trend is too stale or too far from the account voice.';

    if (politicsLedDrift) {
      plannerReason = 'Rejected despite momentum: politics-led subject lacks manual evidence in Geoffrey\'s native writing.';
    } else if (total >= 0.55 && hasAlignedIdentityBridge) {
      sourceLane = 'trend_aligned_exploit';
      plannerReason = networkQualified
        ? 'Followed-network subject has strong momentum and a concrete bridge to native account topics.'
        : 'Hot trend with strong manual/core topic fit.';
    } else if (
      hasAdjacentIdentityBridge
      && freshness >= 0.2
      && total >= (tolerance === 'adjacent' ? 0.46 : tolerance === 'aggressive' ? 0.38 : 0.42)
    ) {
      sourceLane = 'trend_adjacent_explore';
      plannerReason = tolerance === 'aggressive'
        ? 'Trend has a defensible native bridge and enough momentum for one measured exploration slot.'
        : 'Trend is adjacent to native account evidence and acceptable for limited exploration.';
    } else if (identityFit < adjacentIdentityFloor) {
      plannerReason = 'Rejected despite momentum: no concrete bridge to the account\'s native topics or manual writing history.';
    }

    return {
      ...topic,
      fitScores: {
        freshness: Number(freshness.toFixed(3)),
        velocity: Number(velocity.toFixed(3)),
        soul: Number(soul.toFixed(3)),
        manual: Number(manual.toFixed(3)),
        identityFit: Number(identityFit.toFixed(3)),
        driftRisk: Number(driftRisk.toFixed(3)),
        networkMomentum: Number(networkMomentum.toFixed(3)),
        sourceQuality: Number(sourceQuality.toFixed(3)),
        total: Number(total.toFixed(3)),
      },
      sourceLane,
      plannerReason,
    } satisfies EnrichedTrendingTopic;
  });
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

function isBroadFrontierTopic(topic: string): boolean {
  return /^(ai|frontier tech|deep tech|hard tech|re-industrialization|industrial capacity|critical minerals|rare earth minerals)$/i.test(topic.trim());
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
  const configuredTrendShare = clamp((trendMixTarget || 0) / 100);
  const networkSignals = accepted
    .filter((topic) => topic.discoveryMethod === 'followed_network' && topic.sourceLane !== 'reject')
    .map((topic) => (topic.fitScores.networkMomentum || 0) * (topic.topicConfidence || 0.5))
    .sort((a, b) => b - a)
    .slice(0, 5);
  const networkStrength = networkSignals.length > 0
    ? networkSignals.reduce((sum, score) => sum + score, 0) / networkSignals.length
    : 0;
  const maximumTrendShare = autonomyMode === 'safe' ? 0.25 : autonomyMode === 'balanced' ? 0.35 : 0.45;
  const adjustedTrendShare = Math.min(configuredTrendShare, maximumTrendShare);
  const desiredTrendSlots = adjustedTrendShare <= 0 || count <= 0
    ? 0
    : Math.min(count, Math.max(1, Math.floor(count * adjustedTrendShare)));
  const alignedPreference = clamp(
    0.68 + networkStrength * 0.16,
    0.62,
    0.86,
  );
  let alignedQuota = Math.min(
    acceptedAligned.length,
    Math.min(desiredTrendSlots, Math.max(desiredTrendSlots > 0 ? 1 : 0, Math.round(desiredTrendSlots * alignedPreference))),
  );
  let adjacentQuota = Math.min(acceptedAdjacent.length, desiredTrendSlots - alignedQuota);
  const unfilledTrendSlots = desiredTrendSlots - alignedQuota - adjacentQuota;
  if (unfilledTrendSlots > 0) {
    alignedQuota += Math.min(unfilledTrendSlots, Math.max(0, acceptedAligned.length - alignedQuota));
  }
  adjacentQuota += Math.min(
    desiredTrendSlots - alignedQuota - adjacentQuota,
    Math.max(0, acceptedAdjacent.length - adjacentQuota),
  );

  const actualTrendSlots = alignedQuota + adjacentQuota;
  const nativeSlots = Math.max(0, count - actualTrendSlots);
  const nativeBudgetTotal = baseBudgets.manual_core_exploit + baseBudgets.core_explore_fallback;
  const manualPreference = nativeBudgetTotal > 0
    ? baseBudgets.manual_core_exploit / nativeBudgetTotal
    : 0.75;
  const manualCoreSlots = Math.min(nativeSlots, Math.round(nativeSlots * manualPreference));
  const laneCounts: Record<ContentSourceLane, number> = {
    manual_core_exploit: manualCoreSlots,
    trend_aligned_exploit: alignedQuota,
    trend_adjacent_explore: adjacentQuota,
    core_explore_fallback: nativeSlots - manualCoreSlots,
  };

  const orderedLanes = distributeLanes(laneCounts).slice(0, count);
  const manualTopics = pickManualTopics(learnings, [...voiceProfile.topics, ...fallbackTopics]);
  const fallbackPool = [...new Set([...fallbackTopics, ...voiceProfile.topics])].filter(Boolean);

  const slots: SourcePlannerSlot[] = [];
  let alignedIndex = 0;
  let adjacentIndex = 0;
  let manualIndex = 0;
  let fallbackIndex = 0;
  const usedIdeaSeedIds = new Set<string>();

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
      trendTopicId = getTrendingTopicStableId(trend);
      trendHeadline = trend.headline;
      plannerReason = trend.plannerReason;
    } else if (lane === 'trend_adjacent_explore' && acceptedAdjacent[adjacentIndex]) {
      const trend = acceptedAdjacent[adjacentIndex++];
      targetTopic = trend.category || targetTopic;
      trendTopicId = getTrendingTopicStableId(trend);
      trendHeadline = trend.headline;
      plannerReason = trend.plannerReason;
    } else if (lane === 'core_explore_fallback') {
      targetTopic = fallbackPool[fallbackIndex % Math.max(fallbackPool.length, 1)] || targetTopic;
      fallbackIndex++;
      plannerReason = 'Trend slots were unavailable, so this slot explores an underused core topic instead.';
    } else {
      manualIndex++;
    }

    const shouldAttachIdeaSeed =
      lane === 'core_explore_fallback'
      || (lane === 'manual_core_exploit' && isBroadFrontierTopic(targetTopic))
      || (!trendHeadline && isBroadFrontierTopic(targetTopic));
    const ideaSeed = shouldAttachIdeaSeed
      ? pickFrontierIdeaSeed({ voiceProfile, targetTopic, slot: index + 1, usedSeedIds: usedIdeaSeedIds })
      : null;
    if (ideaSeed) {
      usedIdeaSeedIds.add(ideaSeed.id);
      if (lane === 'core_explore_fallback' || isBroadFrontierTopic(targetTopic)) {
        targetTopic = ideaSeed.topic;
      }
      plannerReason = `${plannerReason} Frontier seed: ${ideaSeed.technicalObject} / ${ideaSeed.hiddenConstraint}`;
    }

    slots.push({
      slot: index + 1,
      sourceLane: lane,
      mode,
      targetTopic,
      trendTopicId,
      trendHeadline,
      ideaSeed,
      ideaSeedBrief: ideaSeed ? formatFrontierIdeaSeedBrief(ideaSeed) : null,
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
