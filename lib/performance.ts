/**
 * Performance tracking engine.
 * Checks how posted tweets actually performed, builds learnings,
 * and feeds insights back into generation.
 */

import type { Agent, TweetPerformance, AgentLearnings, StyleFingerprint, OperatorVoiceReference, ManualExampleCuration, SourceLanePerformance, StyleModePerformance, Tweet, LearningSignal, AudienceSegment, PromptStrategy, MediaExperimentType, PostPortfolioRole, Mention } from './types';
import {
  createTweet,
  getTweets,
  getPerformanceHistory,
  addPerformanceEntry,
  getLearnings,
  saveLearnings,
  getAnalysis,
  getProtocolSettings,
  updateProtocolSettings,
  saveAnalysis,
  addPostLogEntry,
  getPostLog,
  getRecentMentions,
  updateTweet,
  saveFeedback,
  addLearningSignal,
  getManualExampleCuration,
  getLearningSignals,
  invalidateAgentConnection,
  saveRelationshipOpportunities,
  saveViralityPostmortems,
} from './kv-storage';
import { getUserTimeline, decodeKeys, getFollowing, type TwitterKeys } from './twitter-client';
import { analyzeAccount } from './analysis';
import { inferDeleteIntent } from './delete-intent';
import { generateText } from './ai';
import { extractCandidateFeatureTags, extractStructureType } from './tweet-features';
import { buildManualTopicProfile } from './source-planner';
import { normalizeContentStyleMode, SHITPOAST_STYLE_MODE, STANDARD_STYLE_MODE, tweetStyleMode } from './style-mode';
import { collapsePerformanceSnapshots } from './performance-history';
import { historicalPerformanceEvidenceWeight } from './winner-learning';
import { formatActionError, getTwitterRateLimitResetAt, isInvalidTwitterCredentialError, isRateLimitTwitterError, isTransientTwitterError } from './twitter-debug';
import { hasRecentReadEndpointFailure } from './twitter-read-backoff';
import {
  computeActionRewards,
  computeEarlyVelocityScore,
  inferAudienceSegment,
  inferPerformanceCheckpoint,
  inferPromptStrategy,
  scoreReplyPotential,
  scoreSlopRisk,
} from './virality-signals';
import {
  buildRelationshipOpportunities,
  buildVelocityFollowupFallback,
  buildViralityPostmortem,
  inferPortfolioRole,
  shouldCreateVelocityFollowup,
} from './growth-engine';

function replyLogEntry(postLog: Array<{ xTweetId: string; format: string; topic: string }>, xTweetId: string) {
  return postLog.find((e) => String(e.xTweetId) === xTweetId) || null;
}

function weightedEngagementScore(tweet: TweetPerformance): number {
  return tweet.likes + tweet.retweets + (tweet.replies * 2);
}

function parsePerformanceTimestamp(value: string | undefined): number {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getLearningInsightPromptLimits(historyLength: number): { rankingRows: number; examples: number; textChars: number } {
  if (historyLength < 12) return { rankingRows: 4, examples: 4, textChars: 180 };
  if (historyLength < 30) return { rankingRows: 6, examples: 6, textChars: 220 };
  return { rankingRows: 8, examples: 8, textChars: 250 };
}

export function getLearningInsightMaxTokens(historyLength: number): number {
  if (historyLength < 12) return 768;
  return 1024;
}

export function formatLearningInsightTweetExample(tweet: TweetPerformance, textChars: number): string {
  const content = tweet.content.replace(/\s+/g, ' ').trim();
  const text = content.length <= textChars
    ? content
    : `${content.slice(0, textChars - 3).trimEnd()}...`;
  return `- [${tweet.likes} likes, ${tweet.retweets} RTs, source:${tweet.source}] "${text}"`;
}

const TWEET_CLASSIFICATION_TEXT_LIMIT = 220;

export function getTweetClassificationMaxTokens(tweetCount: number): number {
  if (tweetCount <= 5) return 768;
  if (tweetCount <= 10) return 1280;
  return 2048;
}

function compactClassificationTweetText(text: string): string {
  const compacted = text.replace(/\s+/g, ' ').trim();
  if (compacted.length <= TWEET_CLASSIFICATION_TEXT_LIMIT) return compacted;
  return `${compacted.slice(0, TWEET_CLASSIFICATION_TEXT_LIMIT - 3).trimEnd()}...`;
}

export function formatTweetClassificationList(tweets: Array<{ id: string; text: string }>): string {
  return tweets
    .map((tweet, index) => `[${index}] "${compactClassificationTweetText(tweet.text)}"`)
    .join('\n');
}

const CHECKPOINT_ORDER: Array<NonNullable<TweetPerformance['performanceCheckpoint']>> = [
  'initial_15m',
  'early_30m',
  'momentum_2h',
  'full_24h',
  'late',
];

function checkpointRank(checkpoint: TweetPerformance['performanceCheckpoint'] | undefined): number {
  const index = CHECKPOINT_ORDER.indexOf(checkpoint || 'initial_15m');
  return index === -1 ? 0 : index;
}

function latestPerformanceByXId(history: TweetPerformance[]): Map<string, TweetPerformance> {
  const byId = new Map<string, TweetPerformance>();
  for (const entry of history) {
    const id = String(entry.xTweetId || '');
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing || parsePerformanceTimestamp(entry.checkedAt) > parsePerformanceTimestamp(existing.checkedAt)) {
      byId.set(id, entry);
    }
  }
  return byId;
}

function shouldTrackPerformanceCheckpoint(existing: TweetPerformance | undefined, postedAt: string, checkedAt: string): boolean {
  if (!existing) return true;
  const nextCheckpoint = inferPerformanceCheckpoint(postedAt, checkedAt);
  if (checkpointRank(nextCheckpoint) <= checkpointRank(existing.performanceCheckpoint)) return false;
  const lastChecked = parsePerformanceTimestamp(existing.checkedAt);
  if (!lastChecked) return true;
  return Date.parse(checkedAt) - lastChecked >= 10 * 60 * 1000;
}

function manualPostSuccessSignals(signals: LearningSignal[]): { tweetIds: Set<string>; xTweetIds: Set<string> } {
  const tweetIds = new Set<string>();
  const xTweetIds = new Set<string>();

  for (const signal of signals) {
    if (signal.signalType !== 'x_post_succeeded' || signal.surface !== 'manual_post') continue;
    if (signal.tweetId) tweetIds.add(String(signal.tweetId));
    if (signal.xTweetId) xTweetIds.add(String(signal.xTweetId));
  }

  return { tweetIds, xTweetIds };
}

function wasManuallyPosted(
  tweetId: string | null | undefined,
  xTweetId: string | null | undefined,
  manualSignals: { tweetIds: Set<string>; xTweetIds: Set<string> },
): boolean {
  return Boolean(
    (tweetId && manualSignals.tweetIds.has(String(tweetId))) ||
    (xTweetId && manualSignals.xTweetIds.has(String(xTweetId)))
  );
}

function normalizeManualPerformanceSources(
  history: TweetPerformance[],
  signals: LearningSignal[],
): TweetPerformance[] {
  const manualSignals = manualPostSuccessSignals(signals);
  if (manualSignals.tweetIds.size === 0 && manualSignals.xTweetIds.size === 0) return history;

  return history.map((entry) => {
    if (entry.source !== 'autopilot') return entry;
    if (!wasManuallyPosted(entry.tweetId, entry.xTweetId, manualSignals)) return entry;
    return { ...entry, source: 'manual' };
  });
}

function sourceSignalWeight(source: TweetPerformance['source']): number {
  if (source === 'manual') return 2;
  if (source === 'timeline') return 1.25;
  return 1;
}

function weightedLearningScore(tweet: TweetPerformance): number {
  const qualityScore = tweet.qualityAdjustedGrowthScore
    ?? tweet.actionRewards?.qualityAdjustedGrowthScore
    ?? computeActionRewards(tweet).qualityAdjustedGrowthScore
    ?? 50;
  return (
    ((qualityScore * 1.15) + (weightedEngagementScore(tweet) * 0.28))
    * sourceSignalWeight(tweet.source)
    * historicalPerformanceEvidenceWeight(tweet)
  );
}

function buildSourceLanePerformance(
  history: TweetPerformance[],
  allTweets: Tweet[],
): SourceLanePerformance[] {
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  const tweetByXId = new Map(
    allTweets
      .filter((tweet) => tweet.xTweetId)
      .map((tweet) => [String(tweet.xTweetId), tweet]),
  );
  const buckets = new Map<SourceLanePerformance['lane'], { total: number; count: number; wins: number }>();

  for (const entry of history) {
    const tweet = (entry.tweetId && tweetById.get(String(entry.tweetId))) || tweetByXId.get(String(entry.xTweetId));
    const lane = tweet?.sourceLane;
    if (!lane) continue;
    const current = buckets.get(lane) || { total: 0, count: 0, wins: 0 };
    current.total += weightedEngagementScore(entry);
    current.count += 1;
    if (entry.wasViral || weightedEngagementScore(entry) >= 40) current.wins += 1;
    buckets.set(lane, current);
  }

  return [...buckets.entries()]
    .map(([lane, stats]) => ({
      lane,
      posts: stats.count,
      avgEngagement: Math.round(stats.total / Math.max(stats.count, 1)),
      wins: stats.wins,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.posts - a.posts);
}

function buildStyleModePerformance(
  history: TweetPerformance[],
  allTweets: Tweet[],
  signals: LearningSignal[],
): StyleModePerformance[] {
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  const tweetByXId = new Map(
    allTweets
      .filter((tweet) => tweet.xTweetId)
      .map((tweet) => [String(tweet.xTweetId), tweet]),
  );
  const buckets = new Map<StyleModePerformance['mode'], {
    total: number;
    posts: number;
    wins: number;
    approvals: number;
    rejections: number;
    deletes: number;
    confidenceTotal: number;
    confidenceCount: number;
    confidencePasses: number;
  }>();
  const ensure = (mode: StyleModePerformance['mode']) => {
    const existing = buckets.get(mode);
    if (existing) return existing;
    const next = {
      total: 0,
      posts: 0,
      wins: 0,
      approvals: 0,
      rejections: 0,
      deletes: 0,
      confidenceTotal: 0,
      confidenceCount: 0,
      confidencePasses: 0,
    };
    buckets.set(mode, next);
    return next;
  };

  ensure(STANDARD_STYLE_MODE);
  ensure(SHITPOAST_STYLE_MODE);

  const resolveMode = (tweetId?: string, xTweetId?: string, metadataMode?: unknown): StyleModePerformance['mode'] => {
    const tweet = (tweetId && tweetById.get(String(tweetId))) || (xTweetId && tweetByXId.get(String(xTweetId))) || null;
    return normalizeContentStyleMode(metadataMode || tweet?.styleMode);
  };

  for (const entry of history) {
    const mode = normalizeContentStyleMode(
      entry.styleMode ||
      ((entry.tweetId && tweetById.get(String(entry.tweetId))?.styleMode) || null) ||
      ((entry.xTweetId && tweetByXId.get(String(entry.xTweetId))?.styleMode) || null),
    );
    const current = ensure(mode);
    current.total += weightedEngagementScore(entry);
    current.posts += 1;
    if (entry.wasViral || weightedEngagementScore(entry) >= 40) current.wins += 1;
  }

  for (const tweet of allTweets) {
    const mode = tweetStyleMode(tweet);
    const confidence = tweet.confidenceScore;
    if (typeof confidence !== 'number') continue;
    const current = ensure(mode);
    current.confidenceTotal += confidence;
    current.confidenceCount += 1;
    if (confidence >= 0.58) current.confidencePasses += 1;
  }

  for (const signal of signals) {
    const mode = resolveMode(signal.tweetId, signal.xTweetId, signal.metadata?.styleMode);
    const current = ensure(mode);
    if (signal.signalType === 'approved_without_edit' || signal.signalType === 'edited_before_queue' || signal.signalType === 'edited_before_post') {
      current.approvals += 1;
    }
    if (signal.signalType === 'x_post_rejected' || signal.signalType === 'reply_rejected') {
      current.rejections += 1;
    }
    if (signal.signalType === 'deleted_from_queue' || signal.signalType === 'deleted_from_x') {
      current.deletes += 1;
    }
  }

  return [SHITPOAST_STYLE_MODE, STANDARD_STYLE_MODE].map((mode) => {
    const stats = ensure(mode);
    return {
      mode,
      posts: stats.posts,
      avgEngagement: stats.posts > 0 ? Math.round(stats.total / stats.posts) : 0,
      wins: stats.wins,
      approvals: stats.approvals,
      rejections: stats.rejections,
      deletes: stats.deletes,
      avgConfidence: stats.confidenceCount > 0 ? Number((stats.confidenceTotal / stats.confidenceCount).toFixed(3)) : 0,
      confidencePassRate: stats.confidenceCount > 0 ? Math.round((stats.confidencePasses / stats.confidenceCount) * 100) : 0,
    };
  });
}

function buildAudienceSegmentPerformance(history: TweetPerformance[]): AgentLearnings['audienceSegmentPerformance'] {
  const buckets = new Map<AudienceSegment, { total: number; posts: number; wins: number }>();
  for (const entry of history) {
    const segment = entry.targetAudienceSegment || inferAudienceSegment(entry.content, entry.topic);
    const current = buckets.get(segment) || { total: 0, posts: 0, wins: 0 };
    current.total += weightedEngagementScore(entry);
    current.posts += 1;
    if (entry.wasViral || weightedEngagementScore(entry) >= 40) current.wins += 1;
    buckets.set(segment, current);
  }

  return [...buckets.entries()]
    .map(([segment, stats]) => ({
      segment,
      posts: stats.posts,
      avgEngagement: Math.round(stats.total / Math.max(1, stats.posts)),
      wins: stats.wins,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.posts - a.posts);
}

function buildPromptStrategyPerformance(history: TweetPerformance[]): AgentLearnings['promptStrategyPerformance'] {
  const buckets = new Map<PromptStrategy, { total: number; posts: number; wins: number }>();
  for (const entry of history) {
    const strategy = entry.promptStrategy || 'baseline';
    const current = buckets.get(strategy) || { total: 0, posts: 0, wins: 0 };
    current.total += weightedEngagementScore(entry);
    current.posts += 1;
    if (entry.wasViral || weightedEngagementScore(entry) >= 40) current.wins += 1;
    buckets.set(strategy, current);
  }

  return [...buckets.entries()]
    .map(([strategy, stats]) => ({
      strategy,
      posts: stats.posts,
      avgEngagement: Math.round(stats.total / Math.max(1, stats.posts)),
      wins: stats.wins,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.posts - a.posts);
}

function buildMediaExperimentPerformance(history: TweetPerformance[]): AgentLearnings['mediaExperimentPerformance'] {
  const buckets = new Map<MediaExperimentType, { total: number; posts: number; wins: number }>();
  for (const entry of history) {
    const type = entry.mediaExperimentType || 'text_only';
    const current = buckets.get(type) || { total: 0, posts: 0, wins: 0 };
    current.total += weightedEngagementScore(entry);
    current.posts += 1;
    if (entry.wasViral || weightedEngagementScore(entry) >= 40) current.wins += 1;
    buckets.set(type, current);
  }

  return [...buckets.entries()]
    .map(([type, stats]) => ({
      type,
      posts: stats.posts,
      avgEngagement: Math.round(stats.total / Math.max(1, stats.posts)),
      wins: stats.wins,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.posts - a.posts);
}

function buildPortfolioRolePerformance(history: TweetPerformance[]): AgentLearnings['portfolioRolePerformance'] {
  const buckets = new Map<PostPortfolioRole, { total: number; posts: number; wins: number }>();
  for (const entry of history) {
    const role = entry.portfolioRole || inferPortfolioRole({
      content: entry.content,
      format: entry.format,
      creativeLane: entry.creativeLane,
      mediaExperimentType: entry.mediaExperimentType,
    });
    const current = buckets.get(role) || { total: 0, posts: 0, wins: 0 };
    current.total += weightedEngagementScore(entry);
    current.posts += 1;
    if (entry.wasViral || weightedEngagementScore(entry) >= 40) current.wins += 1;
    buckets.set(role, current);
  }

  return [...buckets.entries()]
    .map(([role, stats]) => ({
      role,
      posts: stats.posts,
      avgEngagement: Math.round(stats.total / Math.max(1, stats.posts)),
      wins: stats.wins,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.posts - a.posts);
}

function buildNetworkClusterPerformance(history: TweetPerformance[]): AgentLearnings['networkClusterPerformance'] {
  const buckets = new Map<AudienceSegment, { total: number; posts: number; wins: number }>();
  for (const entry of history) {
    const cluster = entry.networkCluster || entry.targetAudienceSegment || inferAudienceSegment(entry.content, entry.topic);
    const current = buckets.get(cluster) || { total: 0, posts: 0, wins: 0 };
    current.total += weightedEngagementScore(entry);
    current.posts += 1;
    if (entry.wasViral || weightedEngagementScore(entry) >= 40) current.wins += 1;
    buckets.set(cluster, current);
  }

  return [...buckets.entries()]
    .map(([cluster, stats]) => ({
      cluster,
      posts: stats.posts,
      avgEngagement: Math.round(stats.total / Math.max(1, stats.posts)),
      wins: stats.wins,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.posts - a.posts);
}

function buildTopRelationshipHandles(mentions: Mention[]): NonNullable<AgentLearnings['topRelationshipHandles']> {
  const buckets = new Map<string, { interactions: number; total: number; lastSeenAt: string }>();
  for (const mention of mentions) {
    const handle = mention.authorHandle.replace(/^@/, '').trim().toLowerCase();
    if (!handle) continue;
    const current = buckets.get(handle) || { interactions: 0, total: 0, lastSeenAt: mention.createdAt };
    current.interactions += 1;
    current.total += mention.engagementLikes + (mention.engagementRetweets * 2);
    if (parsePerformanceTimestamp(mention.createdAt) > parsePerformanceTimestamp(current.lastSeenAt)) {
      current.lastSeenAt = mention.createdAt;
    }
    buckets.set(handle, current);
  }

  return [...buckets.entries()]
    .map(([handle, stats]) => ({
      handle,
      interactions: stats.interactions,
      avgEngagement: Math.round(stats.total / Math.max(stats.interactions, 1)),
      lastSeenAt: stats.lastSeenAt,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.interactions - a.interactions)
    .slice(0, 12);
}

function analysisLikeBaseline(history: TweetPerformance[]): number {
  if (history.length === 0) return 10;
  const likes = history.map((entry) => entry.likes).sort((a, b) => a - b);
  const middle = Math.floor(likes.length / 2);
  return likes.length % 2 === 0
    ? Math.round((likes[middle - 1] + likes[middle]) / 2)
    : likes[middle];
}

function qualityGrowthScore(entry: TweetPerformance): number {
  return entry.qualityAdjustedGrowthScore
    ?? entry.actionRewards?.qualityAdjustedGrowthScore
    ?? computeActionRewards(entry).qualityAdjustedGrowthScore
    ?? 50;
}

const VELOCITY_FOLLOWUP_SOUL_LIMIT = 1000;
const VELOCITY_FOLLOWUP_POST_LIMIT = 1200;

function compactVelocityFollowupPromptText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 3).trimEnd()}...`;
}

export function formatVelocityFollowupSoulForPrompt(soulMd: string | null | undefined): string {
  if (!soulMd?.trim()) return 'No SOUL.md provided.';
  return compactVelocityFollowupPromptText(soulMd, VELOCITY_FOLLOWUP_SOUL_LIMIT);
}

export function formatVelocityFollowupPostForPrompt(content: string): string {
  return compactVelocityFollowupPromptText(content, VELOCITY_FOLLOWUP_POST_LIMIT);
}

export function getVelocityFollowupMaxTokens(originalLength: number): number {
  if (originalLength <= 280) return 256;
  if (originalLength <= 1000) return 384;
  return 512;
}

async function createVelocityFollowupDraft(
  agent: Agent,
  entry: TweetPerformance,
  allTweets: Tweet[],
): Promise<Tweet | null> {
  if (!shouldCreateVelocityFollowup(entry)) return null;
  if (allTweets.some((tweet) => tweet.followupForTweetId && String(tweet.followupForTweetId) === String(entry.xTweetId))) {
    return null;
  }

  const fallback = buildVelocityFollowupFallback(entry);
  let content = fallback;
  try {
    const promptSoul = formatVelocityFollowupSoulForPrompt(agent.soulMd);
    const promptPost = formatVelocityFollowupPostForPrompt(entry.content);
    const response = await generateText({
      task: 'reply_generation',
      tier: 'fast',
      maxTokens: getVelocityFollowupMaxTokens(entry.content.length),
      system: `You write follow-up reply drafts for an X account. Keep the account voice, add substance, and do not use engagement bait. Output only the reply text.`,
      prompt: `Account: ${agent.name} (@${agent.handle})
SOUL.md:
${promptSoul}

Original post taking off:
"${promptPost}"

Metrics now: ${entry.likes} likes, ${entry.retweets} reposts, ${entry.replies} replies, ${entry.impressions} impressions.

Write one reply that adds a sharper second-order point, answers the most likely objection, or gives a concrete example. Do not say "thanks for the replies".`,
    });
    const trimmed = response.text.trim().replace(/^["']|["']$/g, '');
    if (trimmed.length >= 20) content = trimmed;
  } catch {
    content = fallback;
  }

  const tweet = await createTweet({
    agentId: agent.id,
    content,
    type: 'reply',
    status: 'draft',
    format: 'velocity_followup',
    topic: entry.topic || 'followup',
    xTweetId: null,
    quoteTweetId: entry.xTweetId,
    quoteTweetAuthor: null,
    scheduledAt: null,
    rationale: `Supervised follow-up draft for a post with early velocity (${entry.likes} likes, ${entry.replies} replies).`,
    generationMode: 'balanced',
    sourceLane: 'manual_core_exploit',
    creativeLane: 'teaching_threadlet',
    targetAudienceSegment: entry.targetAudienceSegment || entry.networkCluster || inferAudienceSegment(entry.content, entry.topic),
    segmentHypothesis: 'Follow-up while attention is active should convert passive engagement into higher-quality replies.',
    promptStrategy: 'reply_bait',
    portfolioRole: 'reply_bait',
    mediaExperimentType: 'text_only',
    followupForTweetId: entry.xTweetId,
    followupTrigger: `early_velocity:${entry.earlyVelocityScore ?? 0}`,
  });

  await addPostLogEntry(agent.id, {
    agentId: agent.id,
    tweetId: tweet.id,
    xTweetId: entry.xTweetId,
    content,
    format: 'velocity_followup_draft',
    topic: entry.topic || 'followup',
    postedAt: new Date().toISOString(),
    source: 'cron',
    action: 'skipped',
    reason: 'Created supervised follow-up draft from early velocity signal.',
  });

  return tweet;
}

/**
 * Check performance of ALL recent tweets on the timeline.
 * Tracks both Clawfable-posted and manually written tweets.
 * Manually written tweets are the richest training signal — they show
 * what the human operator writes when they want maximum engagement.
 */
export async function checkPerformance(agent: Agent): Promise<number> {
  if (!agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
    return 0;
  }

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  // Get existing performance entries to avoid re-checking
  const existing = await getPerformanceHistory(agent.id, 500);
  const latestByXId = latestPerformanceByXId(existing);
  const [postLog, signals, settings] = await Promise.all([
    getPostLog(agent.id, 200),
    getLearningSignals(agent.id, 500),
    getProtocolSettings(agent.id),
  ]);
  const manualSignals = manualPostSuccessSignals(signals);

  if (hasRecentReadEndpointFailure(postLog, 'performance_timeline_error')) {
    return 0;
  }

  // Fetch full recent timeline (all tweets, not just ours)
  let timeline;
  try {
    timeline = await getUserTimeline(keys, String(agent.xUserId), 100);
  } catch (err) {
    const invalidCredentials = isInvalidTwitterCredentialError(err);
    if (invalidCredentials) {
      await invalidateAgentConnection(agent.id);
    }

    const rateLimited = isRateLimitTwitterError(err);
    const transient = !rateLimited && isTransientTwitterError(err);
    const resetAt = rateLimited ? getTwitterRateLimitResetAt(err) : null;
    const prefix = invalidCredentials
      ? 'X credentials rejected by X. Agent disconnected, reconnect in Settings. '
      : rateLimited
        ? `X performance timeline read rate limited${resetAt ? ` until ${resetAt}` : ''}; learning will retry on a later cron run. `
        : transient
          ? 'Transient X performance timeline failure; learning will retry on a later cron run. '
          : '';
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'performance_timeline_error',
      topic: 'learning',
      postedAt: new Date().toISOString(),
      source: 'cron',
      action: 'error',
      reason: `${prefix}${formatActionError(err, 'fetch_timeline_for_performance', {
        handle: `@${agent.handle}`,
        xUserId: agent.xUserId,
      })}`,
      errorCode: invalidCredentials
        ? 'x_invalid_credentials'
        : rateLimited
          ? 'x_rate_limit'
          : transient
            ? 'x_transient'
            : 'fetch_timeline_for_performance',
    });
    return 0;
  }

  if (timeline.length === 0) return 0;

  // Build a map of our Clawfable-posted tweets for source detection
  const allTweets = await getTweets(agent.id);
  const ourXIds = new Set(allTweets.filter((t) => t.xTweetId).map((t) => String(t.xTweetId)));
  const ourTweetMap = new Map(allTweets.filter((t) => t.xTweetId).map((t) => [String(t.xTweetId), t]));
  const followupTargets = new Set(
    allTweets
      .filter((tweet) => tweet.followupForTweetId)
      .map((tweet) => String(tweet.followupForTweetId))
  );

  // Also include reply xTweetIds from the post log (replies aren't in getTweets)
  const replyXIds = new Set(
    postLog
      .filter((e) => (e.format === 'auto_reply' || e.format === 'auto_reply_high_value' || e.format === 'proactive_reply') && e.xTweetId)
      .map((e) => String(e.xTweetId))
  );
  for (const xid of replyXIds) ourXIds.add(xid);

  const analysis = await getAnalysis(agent.id);
  const viralThreshold = analysis?.engagementPatterns?.viralThreshold || 30;

  // Collect new tweets to track
  const checkedAtForRun = new Date().toISOString();
  const newTweets = timeline.filter((t) =>
    shouldTrackPerformanceCheckpoint(latestByXId.get(String(t.id)), t.createdAt, checkedAtForRun)
  );
  if (newTweets.length === 0) return 0;

  // Batch classify manually written tweets via the fast AI tier (up to 20 at a time)
  const manualTweets = newTweets.filter((t) => !ourXIds.has(String(t.id)));
  const classifications = await batchClassifyTweets(manualTweets.slice(0, 20));

  let tracked = 0;

  for (const timelineTweet of newTweets) {
    const isOurs = ourXIds.has(String(timelineTweet.id));
    const ourTweet = isOurs ? ourTweetMap.get(String(timelineTweet.id)) : null;
    const classification = classifications.get(String(timelineTweet.id));
    const inferredFeatures = extractCandidateFeatureTags(timelineTweet.text, {
      topic: ourTweet?.topic || replyLogEntry(postLog, String(timelineTweet.id))?.topic || classification?.topic || 'general',
    });

    const totalEngagement = timelineTweet.likes + timelineTweet.retweets + (timelineTweet.replies ?? 0);
    const engagementRate = timelineTweet.impressions > 0
      ? Math.round((totalEngagement / timelineTweet.impressions) * 10000) / 100
      : 0;
    const format = ourTweet?.format || replyLogEntry(postLog, String(timelineTweet.id))?.format || classification?.format || 'unknown';
    const topic = ourTweet?.topic || replyLogEntry(postLog, String(timelineTweet.id))?.topic || classification?.topic || 'general';
    const targetAudienceSegment = ourTweet?.targetAudienceSegment || inferAudienceSegment(timelineTweet.text, topic);
    const promptStrategy = ourTweet?.promptStrategy || inferPromptStrategy({
      creativeLane: ourTweet?.creativeLane,
      sourceLane: ourTweet?.sourceLane,
      featureTags: inferredFeatures,
      content: timelineTweet.text,
    });
    const checkedAt = new Date().toISOString();
    const performanceCheckpoint = inferPerformanceCheckpoint(timelineTweet.createdAt, checkedAt);

    const entry: TweetPerformance = {
      tweetId: ourTweet?.id || '',
      xTweetId: String(timelineTweet.id),
      content: timelineTweet.text,
      format,
      topic,
      hook: classification?.hook || inferredFeatures.hook,
      tone: classification?.tone || inferredFeatures.tone,
      specificity: classification?.specificity || inferredFeatures.specificity,
      structure: inferredFeatures.structure || extractStructureType(timelineTweet.text),
      thesis: inferredFeatures.thesis,
      postedAt: timelineTweet.createdAt,
      checkedAt,
      likes: timelineTweet.likes,
      retweets: timelineTweet.retweets,
      replies: timelineTweet.replies ?? 0,
      impressions: timelineTweet.impressions ?? 0,
      engagementRate,
      wasViral: timelineTweet.likes >= viralThreshold,
      source: isOurs
        ? (wasManuallyPosted(ourTweet?.id, String(timelineTweet.id), manualSignals) ? 'manual' : 'autopilot')
        : 'timeline',
      styleMode: ourTweet?.styleMode ?? STANDARD_STYLE_MODE,
      creativeLane: ourTweet?.creativeLane ?? undefined,
      targetAudienceSegment,
      promptStrategy,
      mediaExperimentType: ourTweet?.mediaExperimentType ?? undefined,
      mediaBrief: ourTweet?.mediaBrief ?? undefined,
      portfolioRole: ourTweet?.portfolioRole ?? undefined,
      relationshipTargetHandle: ourTweet?.relationshipTargetHandle ?? undefined,
      followupForTweetId: ourTweet?.followupForTweetId ?? undefined,
      followupTrigger: ourTweet?.followupTrigger ?? undefined,
      trendFitScore: ourTweet?.trendFitScore ?? undefined,
      networkCluster: targetAudienceSegment,
      performanceCheckpoint,
      draftExperimentId: ourTweet?.draftExperimentId ?? undefined,
      experimentBatchId: ourTweet?.experimentBatchId ?? undefined,
      experimentHoldout: ourTweet?.experimentHoldout === true,
      surpriseScore: ourTweet?.surpriseScore ?? undefined,
      creativeRiskScore: ourTweet?.creativeRiskScore ?? undefined,
      slopScore: ourTweet?.slopScore ?? scoreSlopRisk(timelineTweet.text, inferredFeatures),
      replyBaitScore: ourTweet?.replyBaitScore ?? scoreReplyPotential(timelineTweet.text, inferredFeatures),
    };
    entry.actionRewards = computeActionRewards(entry, analysis?.engagementPatterns || null);
    entry.qualityAdjustedGrowthScore = entry.actionRewards.qualityAdjustedGrowthScore;
    entry.earlyVelocityScore = computeEarlyVelocityScore(entry);

    await addPerformanceEntry(agent.id, entry);
    if (settings.earlyVelocityFollowups !== false && !followupTargets.has(String(entry.xTweetId)) && shouldCreateVelocityFollowup(entry)) {
      await createVelocityFollowupDraft(agent, entry, allTweets);
      followupTargets.add(String(entry.xTweetId));
    }
    tracked++;
  }

  // Detect manual deletions: posted tweets whose xTweetId is no longer on the timeline
  // Only check tweets posted in the last 7 days (older tweets naturally fall off the timeline API)
  const timelineXIds = new Set(timeline.map((t) => String(t.id)));
  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const postedEntries = new Map(
    postLog
      .filter((entry) => entry.action === 'posted' && entry.tweetId)
      .map((entry) => [String(entry.tweetId), entry])
  );
  const postedTweets = allTweets.filter((t) => {
    if (t.status !== 'posted' || !t.xTweetId) return false;
    const postedAt = postedEntries.get(String(t.id))?.postedAt || t.createdAt;
    return new Date(postedAt).getTime() > recentCutoff;
  });

  for (const tweet of postedTweets) {
    if (!timelineXIds.has(String(tweet.xTweetId))) {
      // Tweet was deleted from X — mark it
      try {
        await updateTweet(tweet.id, { status: 'deleted_from_x' as any });
        const inferredReason = await inferDeleteIntent({
          agentName: agent.name,
          soulMd: agent.soulMd,
          tweetText: tweet.content,
        });
        await saveFeedback(agent.id, {
          tweetId: tweet.id,
          tweetText: tweet.content,
          rating: 'down',
          generatedAt: new Date().toISOString(),
          intentSummary: inferredReason,
          source: 'queue_delete',
          userProvidedReason: false,
        });
        await addLearningSignal(agent.id, {
          tweetId: tweet.id,
          xTweetId: tweet.xTweetId || undefined,
          signalType: 'deleted_from_x',
          surface: 'cron',
          rewardDelta: -0.8,
          reason: inferredReason,
          inferred: true,
        });
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: tweet.id,
          xTweetId: tweet.xTweetId || '',
          content: tweet.content,
          format: 'deletion_detected',
          topic: tweet.topic || 'general',
          postedAt: new Date().toISOString(),
          source: 'cron',
          action: 'skipped',
          reason: 'Tweet deleted from X — inferred reason captured, operator can still override it',
        });
      } catch { /* non-critical */ }
    }
  }

  return tracked;
}

/**
 * Batch classify tweets using the fast AI tier. Extracts format, topic, hook type,
 * tone, and specificity for each tweet. This is the key to learning from
 * manually written tweets — we can't learn from them without knowing what
 * dimensions they express.
 */
async function batchClassifyTweets(
  tweets: Array<{ id: string; text: string }>
): Promise<Map<string, { format: string; topic: string; hook: TweetPerformance['hook']; tone: TweetPerformance['tone']; specificity: TweetPerformance['specificity'] }>> {
  const result = new Map<string, { format: string; topic: string; hook: TweetPerformance['hook']; tone: TweetPerformance['tone']; specificity: TweetPerformance['specificity'] }>();
  if (tweets.length === 0) return result;

  try {
    const tweetList = formatTweetClassificationList(tweets);

    const response = await generateText({
      task: 'classification',
      tier: 'fast',
      maxTokens: getTweetClassificationMaxTokens(tweets.length),
      system: `You classify tweets by content dimensions. For each tweet, output one JSON line with:
- "idx": the tweet index number
- "format": one of: hot_take, question, data_point, short_punch, long_form, analysis, observation, thread_hook, story, announcement
- "topic": the primary topic (e.g. AI, crypto, startups, product, engineering, culture, personal, humor)
- "hook": opening hook type: question, bold_claim, data_point, story, observation, contrarian, listicle, callout
- "tone": sarcastic, earnest, analytical, provocative, educational, casual, urgent
- "specificity": abstract, concrete, data_driven

Output ONLY JSON objects, one per line, no other text.`,
      prompt: `Classify these tweets:\n${tweetList}`,
    });

    const text = response.text;

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const idx = parsed.idx;
        if (typeof idx === 'number' && idx >= 0 && idx < tweets.length) {
          result.set(String(tweets[idx].id), {
            format: parsed.format || 'unknown',
            topic: parsed.topic || 'general',
            hook: (parsed.hook || 'observation') as TweetPerformance['hook'],
            tone: (parsed.tone || 'casual') as TweetPerformance['tone'],
            specificity: (parsed.specificity || 'concrete') as TweetPerformance['specificity'],
          });
        }
      } catch { /* skip malformed lines */ }
    }
  } catch {
    // Classification failed — tweets still get tracked without dimensions
  }

  return result;
}

/**
 * Build learnings from performance history.
 * Analyzes ALL tracked tweets (both autopilot and manual/timeline).
 * Computes style fingerprint from top performers, ranks all dimensions,
 * and generates prescriptive rules for generation.
 */
export async function buildLearnings(agent: Agent): Promise<AgentLearnings> {
  const rawHistory = await getPerformanceHistory(agent.id, 500);
  const [allTweets, manualExampleCuration, signals, mentions, postLog] = await Promise.all([
    getTweets(agent.id),
    getManualExampleCuration(agent.id),
    getLearningSignals(agent.id, 500),
    getRecentMentions(agent.id, 500).catch(() => []),
    getPostLog(agent.id, 300).catch(() => []),
  ]);
  const history = normalizeManualPerformanceSources(collapsePerformanceSnapshots(rawHistory), signals);

  if (history.length === 0) {
    return {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 0,
      avgLikes: 0,
      avgRetweets: 0,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      manualExampleCuration,
      styleModePerformance: buildStyleModePerformance([], allTweets, signals),
      audienceSegmentPerformance: [],
      promptStrategyPerformance: [],
      mediaExperimentPerformance: [],
      portfolioRolePerformance: [],
      networkClusterPerformance: [],
      topRelationshipHandles: [],
      viralityPostmortems: [],
    };
  }

  const autopilotHistory = history.filter((t) => t.source === 'autopilot');
  const manualHistory = history.filter((t) => t.source === 'manual');
  const timelineHistory = history.filter((t) => t.source === 'timeline');
  const operatorReferenceHistory = history.filter((t) => t.source !== 'autopilot');
  const operatorHistory = history.filter((t) => t.source !== 'autopilot');
  const trainingHistory = operatorHistory.length > 0
    ? history
    : autopilotHistory.length >= 10
      ? autopilotHistory
      : history;
  const sourceBreakdown = {
    autopilot: autopilotHistory.length,
    manual: manualHistory.length,
    timeline: timelineHistory.length,
    trainingCount: trainingHistory.length,
    trainingSource: operatorHistory.length === 0 && autopilotHistory.length >= 10 ? 'autopilot' as const : 'mixed' as const,
  };

  // Sort by weighted engagement
  const sorted = [...trainingHistory].sort((a, b) =>
    weightedLearningScore(b) - weightedLearningScore(a) ||
    weightedEngagementScore(b) - weightedEngagementScore(a)
  );
  const identityHistory = operatorHistory.length > 0 ? operatorHistory : trainingHistory;
  const identitySorted = [...identityHistory].sort((a, b) =>
    weightedLearningScore(b) - weightedLearningScore(a) ||
    weightedEngagementScore(b) - weightedEngagementScore(a)
  );

  const totalLikes = history.reduce((s, h) => s + h.likes, 0);
  const totalRetweets = history.reduce((s, h) => s + h.retweets, 0);

  // Format rankings
  const formatMap: Record<string, { total: number; count: number; signalTotal: number }> = {};
  for (const h of trainingHistory) {
    const f = h.format || 'unknown';
    if (f === 'unknown') continue; // skip unclassified
    if (!formatMap[f]) formatMap[f] = { total: 0, count: 0, signalTotal: 0 };
    formatMap[f].total += weightedEngagementScore(h);
    formatMap[f].signalTotal += weightedLearningScore(h);
    formatMap[f].count++;
  }
  const formatRankings = Object.entries(formatMap)
    .map(([format, d]) => ({ format, avgEngagement: Math.round(d.total / d.count), count: d.count }))
    .sort((a, b) => {
      const left = formatMap[a.format].signalTotal / Math.max(formatMap[a.format].count, 1);
      const right = formatMap[b.format].signalTotal / Math.max(formatMap[b.format].count, 1);
      return right - left || b.avgEngagement - a.avgEngagement;
    });

  // Topic rankings
  const topicMap: Record<string, { total: number; count: number; signalTotal: number }> = {};
  for (const h of trainingHistory) {
    const t = h.topic || 'general';
    if (t === 'general' || t === 'unknown') continue;
    if (!topicMap[t]) topicMap[t] = { total: 0, count: 0, signalTotal: 0 };
    topicMap[t].total += weightedEngagementScore(h);
    topicMap[t].signalTotal += weightedLearningScore(h);
    topicMap[t].count++;
  }
  const topicRankings = Object.entries(topicMap)
    .map(([topic, d]) => ({ topic, avgEngagement: Math.round(d.total / d.count), count: d.count }))
    .sort((a, b) => {
      const left = topicMap[a.topic].signalTotal / Math.max(topicMap[a.topic].count, 1);
      const right = topicMap[b.topic].signalTotal / Math.max(topicMap[b.topic].count, 1);
      return right - left || b.avgEngagement - a.avgEngagement;
    });

  // Engagement can learn from every post. Identity cannot: once manual/operator
  // evidence exists, generated posts are excluded from the style fingerprint.
  const styleFingerprint = computeStyleFingerprint(identitySorted.slice(0, 30), identitySorted.slice(-10));
  const operatorVoiceReference = buildOperatorVoiceReference(operatorReferenceHistory, manualExampleCuration);
  const manualTopicProfile = buildManualTopicProfile(operatorReferenceHistory, manualExampleCuration);
  const sourceLanePerformance = buildSourceLanePerformance(history, allTweets);
  const styleModePerformance = buildStyleModePerformance(history, allTweets, signals);
  const audienceSegmentPerformance = buildAudienceSegmentPerformance(history);
  const promptStrategyPerformance = buildPromptStrategyPerformance(history);
  const mediaExperimentPerformance = buildMediaExperimentPerformance(history);
  const portfolioRolePerformance = buildPortfolioRolePerformance(history);
  const networkClusterPerformance = buildNetworkClusterPerformance(history);
  const relationshipOpportunities = buildRelationshipOpportunities({
    agentId: agent.id,
    mentions,
    postLog,
    performanceHistory: history,
  });
  const topRelationshipHandles = buildTopRelationshipHandles(mentions);
  const baselineLikes = analysisLikeBaseline(history);
  const viralityPostmortems = sorted
    .filter((entry) => {
      const engagement = weightedEngagementScore(entry);
      const quality = qualityGrowthScore(entry);
      const bigWin = entry.wasViral || engagement >= Math.max(20, baselineLikes * 2) || quality >= 72;
      const meaningfulMiss = (
        (entry.source === 'autopilot' || entry.source === 'manual') &&
        (engagement <= Math.max(2, baselineLikes * 0.35) || quality <= 34)
      );
      return bigWin || meaningfulMiss;
    })
    .sort((a, b) => {
      const aDistance = Math.abs(qualityGrowthScore(a) - 50) + (a.wasViral ? 20 : 0);
      const bDistance = Math.abs(qualityGrowthScore(b) - 50) + (b.wasViral ? 20 : 0);
      return bDistance - aDistance || weightedLearningScore(b) - weightedLearningScore(a);
    })
    .slice(0, 12)
    .map((entry) => buildViralityPostmortem(agent.id, entry));

  // Generate prescriptive insights
  const insights = await generateInsights(history, sorted, formatRankings, topicRankings, styleFingerprint, sourceBreakdown);

  const learnings: AgentLearnings = {
    agentId: agent.id,
    updatedAt: new Date().toISOString(),
    totalTracked: history.length,
    avgLikes: Math.round(totalLikes / history.length),
    avgRetweets: Math.round(totalRetweets / history.length),
    bestPerformers: sorted.slice(0, 10),
    worstPerformers: sorted.slice(-5).reverse(),
    formatRankings,
    topicRankings,
    insights,
    styleFingerprint,
    operatorVoiceReference,
    manualTopicProfile,
    manualExampleCuration,
    sourceLanePerformance,
    styleModePerformance,
    audienceSegmentPerformance,
    promptStrategyPerformance,
    mediaExperimentPerformance,
    portfolioRolePerformance,
    networkClusterPerformance,
    topRelationshipHandles,
    viralityPostmortems,
    sourceBreakdown,
  };

  await saveLearnings(agent.id, learnings);
  if (relationshipOpportunities.length > 0) {
    await saveRelationshipOpportunities(agent.id, relationshipOpportunities);
  }
  if (viralityPostmortems.length > 0) {
    await saveViralityPostmortems(agent.id, viralityPostmortems);
  }

  // Log it
  await addPostLogEntry(agent.id, {
    agentId: agent.id,
    tweetId: '',
    xTweetId: '',
    content: `Tracked ${history.length} tweets. Avg ${learnings.avgLikes} likes. ${insights.length} insights generated.`,
    format: 'learning',
    topic: 'performance',
    postedAt: new Date().toISOString(),
    source: 'cron',
    action: 'mentions_refreshed', // reusing as "system event"
    reason: `Top format: ${formatRankings[0]?.format || 'unknown'}`,
  });

  return learnings;
}

function buildOperatorVoiceReference(
  history: TweetPerformance[],
  curation: ManualExampleCuration,
): OperatorVoiceReference | undefined {
  const blocked = new Set(curation.blockedXTweetIds.map((id) => String(id)));
  const usableHistory = history.filter((tweet) =>
    tweet.content
    && tweet.content.trim().length > 0
    && !blocked.has(String(tweet.xTweetId))
  );
  if (usableHistory.length === 0) return undefined;

  const pinnedExamples = usableHistory.filter((tweet) => curation.pinnedXTweetIds.includes(String(tweet.xTweetId)));
  const sorted = [...usableHistory].sort((a, b) => weightedEngagementScore(b) - weightedEngagementScore(a));
  const recent = [...usableHistory].sort((a, b) =>
    Date.parse(b.postedAt || b.checkedAt) - Date.parse(a.postedAt || a.checkedAt)
  );
  const hasStandaloneSubstance = (tweet: TweetPerformance) => {
    const prose = tweet.content
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/@\w+/g, ' ')
      .replace(/#[a-z0-9_]+/gi, ' ')
      .replace(/[^a-z0-9'&+.-]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const wordCount = prose.split(/\s+/).filter(Boolean).length;
    const timestampLines = tweet.content.split('\n').filter((line) => /^\s*\d{1,2}:\d{2}\s*[-–]/.test(line)).length;
    return wordCount >= 8 && timestampLines < 2;
  };
  const substantiveSorted = sorted.filter(hasStandaloneSubstance);
  const substantiveRecent = recent.filter(hasStandaloneSubstance);
  const secondary = sorted.filter((tweet) => !hasStandaloneSubstance(tweet));
  const primaryCandidates = [...pinnedExamples];
  const maxCandidateLength = Math.max(substantiveSorted.length, Math.min(6, substantiveRecent.length));
  for (let index = 0; index < maxCandidateLength; index++) {
    if (substantiveSorted[index]) primaryCandidates.push(substantiveSorted[index]);
    if (index < 6 && substantiveRecent[index]) primaryCandidates.push(substantiveRecent[index]);
  }
  const topPerformers: TweetPerformance[] = [];
  const seenIds = new Set<string>();
  const modeCounts = new Map<string, number>();
  for (const tweet of primaryCandidates) {
    const id = String(tweet.xTweetId || tweet.tweetId || tweet.content);
    if (seenIds.has(id)) continue;
    const lengthMode = tweet.content.length < 120 ? 'short' : tweet.content.length < 360 ? 'medium' : 'long';
    const socialMode = /^@\w+/.test(tweet.content.trim())
      ? 'reply'
      : tweet.content.includes('?')
        ? 'question'
        : tweet.content.includes('\n')
          ? 'linebreak'
          : 'statement';
    const registerMode = /\b(?:bro|lol|cuz|ain'?t|bullshit\w*)\b|\.\./i.test(tweet.content)
      ? 'rough'
      : 'plain';
    const signature = [
      tweet.format || 'unknown',
      tweet.hook || 'unknown',
      tweet.tone || 'unknown',
      lengthMode,
      socialMode,
      registerMode,
    ].join(':');
    const pinned = curation.pinnedXTweetIds.includes(String(tweet.xTweetId));
    if (!pinned && (modeCounts.get(signature) || 0) >= 2) continue;
    topPerformers.push(tweet);
    seenIds.add(id);
    modeCounts.set(signature, (modeCounts.get(signature) || 0) + 1);
    if (topPerformers.length >= 12) break;
  }
  if (topPerformers.length < Math.min(12, primaryCandidates.length)) {
    for (const tweet of primaryCandidates) {
      const id = String(tweet.xTweetId || tweet.tweetId || tweet.content);
      if (seenIds.has(id)) continue;
      topPerformers.push(tweet);
      seenIds.add(id);
      if (topPerformers.length >= 12) break;
    }
  }
  if (topPerformers.length < 8) {
    for (const tweet of secondary) {
      const id = String(tweet.xTweetId || tweet.tweetId || tweet.content);
      if (seenIds.has(id)) continue;
      topPerformers.push(tweet);
      seenIds.add(id);
      if (topPerformers.length >= 8) break;
    }
  }
  const worstPerformers = sorted.slice(-6);
  if (topPerformers.length === 0) return undefined;

  return {
    sampleCount: usableHistory.length,
    bestPerformers: topPerformers.slice(0, 8),
    styleFingerprint: computeStyleFingerprint(topPerformers, worstPerformers),
    pinnedExamples: pinnedExamples.slice(0, 3),
    blockedXTweetIds: [...blocked],
  };
}

/**
 * Compute a style fingerprint from the top-performing tweets.
 * This captures HOW the best content is written, not just what topic it covers.
 */
function computeStyleFingerprint(
  topPerformers: TweetPerformance[],
  worstPerformers: TweetPerformance[]
): StyleFingerprint {
  const top = topPerformers.filter((t) => t.content);
  if (top.length === 0) {
    return {
      avgLength: 0, shortPct: 0, mediumPct: 0, longPct: 0,
      questionRatio: 0, usesLineBreaks: false, usesEmojis: false, usesNumbers: false,
      topHooks: [], topTones: [], antiPatterns: [], updatedAt: new Date().toISOString(),
    };
  }

  const lengths = top.map((t) => t.content.length);
  const avgLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  const shortPct = Math.round((lengths.filter((l) => l < 200).length / lengths.length) * 100);
  const mediumPct = Math.round((lengths.filter((l) => l >= 200 && l < 500).length / lengths.length) * 100);
  const longPct = Math.round((lengths.filter((l) => l >= 500).length / lengths.length) * 100);

  const questionCount = top.filter((t) => t.content.includes('?')).length;
  const questionRatio = Math.round((questionCount / top.length) * 100);

  const usesLineBreaks = top.filter((t) => t.content.includes('\n')).length > top.length * 0.3;
  const usesEmojis = top.filter((t) => /[\u{1F000}-\u{1FFFF}]/u.test(t.content)).length > top.length * 0.3;
  const usesNumbers = top.filter((t) => /\d+[%xX$]|\$\d/.test(t.content)).length > top.length * 0.3;

  // Count hook types from classified tweets
  const hookCounts: Record<string, number> = {};
  for (const t of top) {
    const inferred = extractCandidateFeatureTags(t.content, { topic: t.topic });
    const hook = t.hook || inferred.hook;
    if (hook) { hookCounts[hook] = (hookCounts[hook] || 0) + 1; }
  }
  const topHooks = Object.entries(hookCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => h);

  const toneCounts: Record<string, number> = {};
  for (const t of top) {
    const inferred = extractCandidateFeatureTags(t.content, { topic: t.topic });
    const tone = t.tone || inferred.tone;
    if (tone) { toneCounts[tone] = (toneCounts[tone] || 0) + 1; }
  }
  const topTones = Object.entries(toneCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => h);

  // Detect anti-patterns from worst performers
  const antiPatterns: string[] = [];
  const worst = worstPerformers.filter((t) => t.content);
  if (worst.length >= 3) {
    const worstAvgLen = worst.reduce((s, t) => s + t.content.length, 0) / worst.length;
    if (worstAvgLen > avgLength * 1.5) antiPatterns.push('Worst tweets are significantly longer than best');
    if (worstAvgLen < avgLength * 0.5) antiPatterns.push('Worst tweets are significantly shorter than best');

    const worstGeneric = worst.filter((t) =>
      /^(I think|In my opinion|Here's|The thing is|It's important)/i.test(t.content)
    );
    if (worstGeneric.length > worst.length * 0.3) antiPatterns.push('Generic openings ("I think", "Here\'s") underperform');

    const worstNoQuestion = worst.filter((t) => !t.content.includes('?'));
    if (worstNoQuestion.length > worst.length * 0.7 && questionRatio > 30) {
      antiPatterns.push('Tweets without questions underperform — your best work asks questions');
    }

    // Extract common opening phrases from worst performers (hard blocklist)
    const openingPhrases: Record<string, number> = {};
    for (const t of worst) {
      // Extract first 5 words as the opening phrase
      const opening = t.content.split(/\s+/).slice(0, 5).join(' ').toLowerCase();
      if (opening.length > 10) {
        openingPhrases[opening] = (openingPhrases[opening] || 0) + 1;
      }
    }
    for (const [phrase, count] of Object.entries(openingPhrases)) {
      if (count >= 2) {
        antiPatterns.push(`NEVER start with: "${phrase}" (appeared ${count}x in worst tweets)`);
      }
    }

    // Detect topics that consistently get 0 engagement
    const worstTopics: Record<string, number> = {};
    for (const t of worst) {
      if (t.topic && t.topic !== 'general' && t.topic !== 'unknown') {
        worstTopics[t.topic] = (worstTopics[t.topic] || 0) + 1;
      }
    }
    for (const [topic, count] of Object.entries(worstTopics)) {
      if (count >= 3) {
        antiPatterns.push(`Topic "${topic}" consistently underperforms (${count}x in bottom tweets)`);
      }
    }

    // Detect if worst tweets have a consistent length pattern
    const worstAllLong = worst.filter((t) => t.content.length > 500).length > worst.length * 0.6;
    const worstAllShort = worst.filter((t) => t.content.length < 100).length > worst.length * 0.6;
    if (worstAllLong) antiPatterns.push('Long tweets (500+ chars) consistently bomb — keep it concise');
    if (worstAllShort) antiPatterns.push('Very short tweets (<100 chars) consistently bomb — add substance');
  }

  return {
    avgLength, shortPct, mediumPct, longPct, questionRatio,
    usesLineBreaks, usesEmojis, usesNumbers,
    topHooks, topTones, antiPatterns,
    updatedAt: new Date().toISOString(),
  };
}

async function generateInsights(
  history: TweetPerformance[],
  sorted: TweetPerformance[],
  formatRankings: AgentLearnings['formatRankings'],
  topicRankings: AgentLearnings['topicRankings'],
  styleFingerprint: StyleFingerprint,
  sourceBreakdown: NonNullable<AgentLearnings['sourceBreakdown']>,
): Promise<string[]> {
  if (history.length < 5) return ['Not enough data yet — need at least 5 tracked tweets.'];

  const promptLimits = getLearningInsightPromptLimits(history.length);
  const best = sorted.slice(0, promptLimits.examples);
  const worst = sorted.slice(-promptLimits.examples);
  const operatorTweets = history.filter((t) => t.source !== 'autopilot');
  const autopilotTweets = history.filter((t) => t.source === 'autopilot');
  const trainingSetLabel = sourceBreakdown.trainingSource === 'autopilot'
    ? 'autopilot only'
    : sourceBreakdown.manual > 0
      ? 'mixed with manually posted high-signal approvals'
      : 'mixed because autopilot history is still sparse';

  try {
    const response = await generateText({
      task: 'learning',
      tier: 'quality',
      maxTokens: getLearningInsightMaxTokens(history.length),
      system: `You are a content strategist analyzing tweet performance. Generate 5-7 PRESCRIPTIVE RULES. Each rule must be:
1. Specific and actionable (not "post more engaging content")
2. Grounded in the data (reference actual numbers)
3. Written as a direct instruction ("Write X" not "Consider writing X")

Include at least one rule about what to STOP doing.
Include at least one rule comparing autopilot vs manual tweet performance (if both exist).
Output bullet points, one per line, no numbering.`,
      prompt: `PERFORMANCE DATA: ${history.length} tweets (${operatorTweets.length} operator-written reference, ${autopilotTweets.length} autopilot)
TRAINING SET FOR AUTONOMOUS POLICY: ${sourceBreakdown.trainingCount} tweets (${trainingSetLabel})
MANUAL POSTING RULE: Tweets manually posted by the operator are high-signal approvals. Treat their voice, sentiment, tone, topics, and structure as stronger guidance than autonomous posts unless direct deletion feedback contradicts them.

STYLE FINGERPRINT (computed from top 30 tweets):
- Avg length: ${styleFingerprint.avgLength} chars (${styleFingerprint.shortPct}% short, ${styleFingerprint.mediumPct}% medium, ${styleFingerprint.longPct}% long)
- Questions: ${styleFingerprint.questionRatio}% of top tweets ask questions
- Uses line breaks: ${styleFingerprint.usesLineBreaks}, Emojis: ${styleFingerprint.usesEmojis}, Numbers/data: ${styleFingerprint.usesNumbers}
- Top opening hooks: ${styleFingerprint.topHooks.join(', ') || 'unknown'}
- Top tones: ${styleFingerprint.topTones.join(', ') || 'unknown'}
- Anti-patterns: ${styleFingerprint.antiPatterns.join('; ') || 'none detected'}

FORMAT RANKINGS:
${formatRankings.slice(0, promptLimits.rankingRows).map((f) => `- ${f.format}: avg ${f.avgEngagement} engagement, ${f.count} tweets`).join('\n')}

TOPIC RANKINGS:
${topicRankings.slice(0, promptLimits.rankingRows).map((t) => `- ${t.topic}: avg ${t.avgEngagement} engagement, ${t.count} tweets`).join('\n')}

TOP ${best.length} TWEETS (with representative text so you can analyze style):
${best.map((t) => formatLearningInsightTweetExample(t, promptLimits.textChars)).join('\n')}

BOTTOM ${worst.length} TWEETS:
${worst.map((t) => formatLearningInsightTweetExample(t, promptLimits.textChars)).join('\n')}

Generate prescriptive rules for improving content quality. Focus on style patterns, not just topics.`,
    });

    const text = response.text;

    return text.split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 10)
      .slice(0, 7);
  } catch {
    return ['Insight generation failed — will retry on next learning cycle.'];
  }
}

/**
 * Auto-adjust content settings based on learnings.
 * Called after buildLearnings when we have enough data.
 */
export async function autoAdjustSettings(agentId: string, learnings: AgentLearnings): Promise<void> {
  if (learnings.sourceBreakdown?.trainingSource !== 'autopilot') return;
  if (learnings.totalTracked < 10) return; // Need enough data

  const settings = await getProtocolSettings(agentId);
  const trainingCount = learnings.sourceBreakdown?.trainingCount || 0;

  // Auto-adjust format list — enable top performers, drop consistent underperformers
  // Only auto-adjust if user hasn't manually configured formats, and only after
  // we have enough autonomous data to avoid collapsing variety too early.
  if ((!settings.enabledFormats || settings.enabledFormats.length === 0) && trainingCount >= 24 && learnings.formatRankings.length >= 5) {
    const avgEngagement = learnings.formatRankings.reduce((s, f) => s + f.avgEngagement, 0) / learnings.formatRankings.length;
    // Keep formats that perform at least 30% of average (very loose filter — just drops truly dead formats)
    const viableFormats = learnings.formatRankings
      .filter((f) => f.count >= 3 && f.avgEngagement >= avgEngagement * 0.3)
      .map((f) => f.format);
    // Only restrict if we still preserve enough room for experimentation.
    if (viableFormats.length >= 5 && viableFormats.length < learnings.formatRankings.length) {
      await updateProtocolSettings(agentId, { enabledFormats: viableFormats });
    }
  }

  // Auto-adjust length mix based on what length ranges perform best
  const shortPerf: number[] = [];
  const mediumPerf: number[] = [];
  const longPerf: number[] = [];

  for (const t of learnings.bestPerformers.concat(learnings.worstPerformers)) {
    const len = t.content.length;
    const eng = t.likes + t.retweets;
    if (len < 200) shortPerf.push(eng);
    else if (len < 500) mediumPerf.push(eng);
    else longPerf.push(eng);
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const shortAvg = avg(shortPerf);
  const medAvg = avg(mediumPerf);
  const longAvg = avg(longPerf);
  const total = shortAvg + medAvg + longAvg;

  if (total > 0) {
    const newMix = {
      short: Math.round((shortAvg / total) * 100),
      medium: Math.round((medAvg / total) * 100),
      long: Math.round((longAvg / total) * 100),
    };
    // Ensure they sum to 100
    const sum = newMix.short + newMix.medium + newMix.long;
    if (sum !== 100) newMix.medium += (100 - sum);
    // Ensure minimum 10% for each to keep variety
    if (newMix.short < 10) { newMix.short = 10; newMix.medium -= 5; newMix.long -= 5; }
    if (newMix.medium < 10) { newMix.medium = 10; newMix.short -= 5; newMix.long -= 5; }
    if (newMix.long < 10) { newMix.long = 10; newMix.short -= 5; newMix.medium -= 5; }

    await updateProtocolSettings(agentId, { lengthMix: newMix });
  }

}

/**
 * Auto re-analyze account if analysis is stale (older than 7 days).
 */
export async function maybeReanalyze(agent: Agent): Promise<boolean> {
  if (!agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
    return false;
  }

  const analysis = await getAnalysis(agent.id);

  // Run if: no analysis exists, or analysis is older than 7 days
  if (analysis) {
    const ageMs = Date.now() - new Date(analysis.analyzedAt).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (ageMs < sevenDays) return false;
  }

  const postLog = await getPostLog(agent.id, 200).catch(() => []);
  if (hasRecentReadEndpointFailure(postLog, 'cron_reanalysis_error')) {
    return false;
  }

  try {
    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const newAnalysis = await analyzeAccount(keys, agent.xUserId, agent.id);
    await saveAnalysis(agent.id, newAnalysis);

    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: `Auto re-analyzed account: ${newAnalysis.tweetCount} tweets, ${newAnalysis.viralTweets.length} viral, ${newAnalysis.followingProfile.totalFollowing} following`,
      format: 'system',
      topic: 'analysis',
      postedAt: new Date().toISOString(),
      source: 'cron',
      action: 'mentions_refreshed',
      reason: 'Weekly re-analysis',
    });

    return true;
  } catch (err) {
    const invalidCredentials = isInvalidTwitterCredentialError(err);
    if (invalidCredentials) {
      await invalidateAgentConnection(agent.id).catch(() => null);
    }

    const rateLimited = isRateLimitTwitterError(err);
    const transient = !rateLimited && isTransientTwitterError(err);
    const resetAt = rateLimited ? getTwitterRateLimitResetAt(err) : null;
    const prefix = invalidCredentials
      ? 'X credentials rejected by X during auto re-analysis. Agent disconnected, reconnect in Settings. '
      : rateLimited
        ? `X auto re-analysis rate limited${resetAt ? ` until ${resetAt}` : ''}; learning will retry on a later cron run. `
        : transient
          ? 'Transient X auto re-analysis failure; learning will retry on a later cron run. '
          : '';

    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'cron_reanalysis_error',
      topic: 'analysis',
      postedAt: new Date().toISOString(),
      source: 'cron',
      action: 'error',
      reason: `${prefix}${formatActionError(err, 'reanalyze_account', {
        handle: `@${agent.handle}`,
        xUserId: agent.xUserId,
      })}`,
      errorCode: invalidCredentials
        ? 'x_invalid_credentials'
        : rateLimited
          ? 'x_rate_limit'
          : transient
            ? 'x_transient'
            : 'reanalyze_account',
    }).catch(() => null);
    return false;
  }
}
