/**
 * Autopilot engine.
 * Manages automated tweet posting and mention replies for agents.
 *
 * On each run:
 * 1. Auto-post: generate content if queue is low, pick best tweet, post it
 * 2. Auto-reply: fetch new mentions, generate replies, post them
 */

import type { Agent, GenerationEvidenceReference, GenerationRunTrace, Mention, PostLogEntry, ProtocolSettings, RelationshipProfile, Tweet } from './types';
import {
  addLearningSignal,
  getProtocolSettings,
  getAgent,
  updateProtocolSettings,
  getQueuedTweets,
  getQueueVersion,
  getTweet,
  getTweets,
  getAnalysis,
  updateTweet,
  createMention,
  getRecentMentions,
  addPostLogEntry,
  getPostLog,
  logFunnelEvent,
  getTrendingCache,
  getTrendingCacheSnapshot,
  getTopicIntelligenceState,
  getConversationHistory,
  getPerformanceHistory,
  getRelationshipProfiles,
  getProductFacts,
  getGenerationRuns,
  invalidateAgentConnection,
  saveGenerationRun,
  upsertRelationshipProfile,
  type ConversationTurn,
} from './kv-storage';
import { generatePublishingBatchV2 } from './publishing-v2';
import { getCommittedTweetCopyMemoryV2 } from './generation-v2';
import { getGeneratedPublishIssue } from './generation-origin';
import { buildGenerationContext } from './generation-context';
import { buildLearnings } from './performance';
import { postTweet, replyToTweet, decodeKeys, getMe, getMentionsFromTwitter, getLatestTwitterTweetIdCursor, getSanitizedTweetTextIssue, type TwitterKeys } from './twitter-client';
import {
  formatActionError,
  getActionErrorStatusCode,
  getTwitterRateLimitResetAt,
  isInvalidTwitterCredentialError,
  isRateLimitTwitterError,
  isTwitterActionError,
  isTransientTwitterError,
} from './twitter-debug';
import { getTrendingTopicStableId, type TrendingTopic } from './trending';
import {
  jitterInterval,
  isDailyCapReached,
  countPostsInLast24h,
  isNearDuplicate,
  pickDiverseTweet,
  clampPostsPerDay,
  effectivePostsPerDay,
  MAX_AUTOMATED_ORIGINAL_POSTS_PER_DAY,
  getRecentPostDuplicateIssue,
  getReplyRepetitionIssue,
  getTweetCompletenessIssue,
  getTweetLengthIssue,
  getAutopostPolicyIssue,
  extractMentionHandles,
} from './survivability';
import { getAutonomyConfidenceThreshold } from './autonomy-policy';
import type { RankedPublishingCandidate as RankedProtocolTweet } from './publishing-candidate';
import { resolveQueuedTweetFailure } from './queue-healing';
import { PUBLISHING_V2_MODEL_STACK, resolvePublishingV2ModelStacks } from './ai';
import { getPublishingV2AutopostQualityMargin } from './publishing-quality-policy';
import { getAuthorityProofIssue, getReplyOptOutReason, scoreHighValueReply } from './virality-signals';
import { assessClaimEvidence } from './claim-evidence';
import { semanticIdeaSimilarity } from './tweet-features';
import {
  getTrustedClaimSourceTexts,
  isFollowedNetworkSource,
} from './source-trust';
import { areRepliesDisabled, REPLY_AUTOMATION_DISABLED_REASON } from './reply-safety';
import { buildGenerationLearningMetadata } from './learning-loop';
import { isGeoffreyAccount } from './account-taste';
import { assertAgentAutomationEntitlement } from './automation-entitlement';
import { createTweetFromGeneratedCandidate } from './tweet-persistence';
import { ACCOUNT_TOPIC_POLICY_VERSION, getAccountTopicPolicyIssue } from './account-topic-policy';
import {
  GEOFFREY_COMPANY_AMPLIFICATION_POLICY_VERSION,
  getGeoffreyCompanyAmplificationIssue,
} from './geoffrey-company-amplification';
import {
  GEOFFREY_CONTENT_MIX_POLICY_VERSION,
  evaluateGeoffreyQueueContentMix,
  getGeoffreyContentMixDecision,
  isGeoffreyContentMixQueueSlotReserved,
} from './geoffrey-content-mix';
import {
  ANTIFUND_PORTFOLIO_POLICY_VERSION,
  ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION,
  getAntiFundAutonomousPromotionPolicyIssue,
  getAntiFundPortfolioPolicyIssue,
} from './antifund-portfolio';
import {
  ENTITY_MENTION_POLICY_VERSION,
  getCuratedEntityMentionPolicyIssue,
  usedCuratedVerifiedMentionHandles,
} from './entity-mentions';

export interface AutopilotResult {
  agentId: string;
  action: 'posted' | 'replied' | 'skipped' | 'error';
  reason: string;
  tweetId?: string;
  xTweetId?: string;
  content?: string;
  format?: string;
  topic?: string;
  repliesSent?: number;
}

export interface AutopilotQueueHealth {
  queueDepth: number;
  activeQueueDepth: number;
  postableQueueDepth: number;
  lowConfidenceDepth: number;
  staleLowConfidenceDepth: number;
  threshold: number;
  mode: ProtocolSettings['autonomyMode'];
  maxConfidence: number | null;
}

export interface AutopilotQueueSelfHealResult {
  archived: number;
  generated: number;
  before: AutopilotQueueHealth;
  after: AutopilotQueueHealth;
  action: string;
}

export interface QueuePolicyRefreshResult {
  before: number;
  after: number;
  certified: number;
  quarantined: number;
  /** Queued drafts held out of this pass by a content-mix window; they stay queued. */
  deferred: number;
}

interface AutoReplyRunOutcome {
  repliesSent: number;
  lastReplyCheckedAt?: string | null;
}

const HANDLED_AUTO_REPLY_FORMATS = new Set([
  'auto_reply',
  'auto_reply_high_value',
  'auto_reply_opt_out',
  'auto_reply_do_not_reply',
  'auto_reply_relationship_cooldown',
  'auto_reply_length_gate',
  'auto_reply_text_gate',
  'auto_reply_repetition_gate',
  'auto_reply_blocked',
  'auto_reply_taste_gate',
  'auto_reply_thread_depth_gate',
  'auto_reply_low_value_gate',
  'auto_reply_self_mention',
  'auto_reply_terminal_error',
  'auto_reply_empty_generation',
]);
const AUTO_REPLY_HANDLED_LOG_LIMIT = 1000;
const MAX_AUTO_REPLIES_PER_CONVERSATION = 1;
/**
 * Post-log entries the posting tick reads. The cron writes at least one entry
 * per 10-minute tick, so a 50-entry window covered under 8 hours and the 24h
 * cap and the recent-post diversity gate never saw a full day.
 */
const AUTOPILOT_POST_LOG_WINDOW = 400;
/**
 * Shared by the autopost-time semantic gate and the queue-insert gate. When
 * the two drifted (0.48 vs 0.52) drafts queued in the gap were deterministically
 * quarantined at post time with a spurious negative learning signal.
 */
export const QUEUE_SEMANTIC_DUPLICATE_THRESHOLD = 0.48;
const CONTENT_MIX_DEFERRAL_LOG_PREFIX = 'content_mix_deferred:';

const POSTED_AUTO_REPLY_FORMATS = new Set([
  'auto_reply',
  'auto_reply_high_value',
]);

function coerceConfidenceValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const CONFIDENCE_THRESHOLD_EPSILON = 0.005;
const STALE_LOW_CONFIDENCE_QUEUE_MS = 24 * 60 * 60 * 1000;
const STALE_NETWORK_TOPIC_QUEUE_MS = 18 * 60 * 60 * 1000;
const MAX_NETWORK_TOPIC_QUEUE_MS = 48 * 60 * 60 * 1000;
const CURRENT_NETWORK_TOPIC_READ_MS = 5 * 60 * 60 * 1000;

function effectiveConfidence(tweet: { confidenceScore?: number | string | null; candidateScore?: number | string | null }): number {
  const confidenceScore = coerceConfidenceValue(tweet.confidenceScore);
  if (confidenceScore !== null) return confidenceScore;
  const candidateScore = coerceConfidenceValue(tweet.candidateScore);
  return candidateScore !== null ? candidateScore / 100 : 0.67;
}

function effectiveAutopostThreshold(tweet: Tweet, mode: ProtocolSettings['autonomyMode'], threshold: number): number {
  if (mode === 'explore' && tweet.generationMode !== 'explore') {
    return getAutonomyConfidenceThreshold('balanced');
  }
  return threshold;
}

function clearsAutonomyThreshold(tweet: Tweet, mode: ProtocolSettings['autonomyMode'], threshold: number): boolean {
  return effectiveConfidence(tweet) + CONFIDENCE_THRESHOLD_EPSILON >= effectiveAutopostThreshold(tweet, mode, threshold);
}

/**
 * The legacy confidence gate applies only to drafts that carry a model
 * confidence. V2 drafts were already judged by the final critic, and a post
 * the operator wrote is operator intent, not a model guess: neither is gated
 * or archived by the stale/low-confidence sweep. The posting tick, the queue
 * health inspection, and the watchdog sweep must all agree on this rule.
 */
function isConfidenceEligibleForAutopost(tweet: Tweet, mode: ProtocolSettings['autonomyMode'], threshold: number): boolean {
  return tweet.contentProvenance === 'operator_written'
    || tweet.pipelineVersion === 'v2'
    || clearsAutonomyThreshold(tweet, mode, threshold);
}

function isAutopostableQueuedTweet(tweet: Tweet): boolean {
  return !tweet.quarantinedAt && tweet.type !== 'reply' && !tweet.followupForTweetId;
}

function isAutopostableQueuedTweetForAgent(agent: Agent | null, tweet: Tweet): boolean {
  const portfolioCompanyIssue = isGeoffreyAccount(agent?.handle) || tweet.portfolioCompanyContext
    ? getAntiFundPortfolioPolicyIssue(tweet.content, tweet.portfolioCompanyContext)
    : null;
  const companyAmplificationIssue = getGeoffreyCompanyAmplificationIssue(
    agent?.handle,
    `${tweet.topic || ''} ${tweet.content}`,
  );
  const autonomousPromotionIssue = isGeoffreyAccount(agent?.handle)
    ? getAntiFundAutonomousPromotionPolicyIssue(tweet.portfolioCompanyContext)
    : null;
  return isAutopostableQueuedTweet(tweet)
    && !getGeneratedPublishIssue(tweet, { accountHandle: agent?.handle })
    && !getAccountTopicPolicyIssue(
      agent?.handle,
      `${tweet.topic || ''} ${tweet.content}`,
      null,
      tweet.portfolioCompanyContext,
    )
    && !companyAmplificationIssue
    && !portfolioCompanyIssue
    && !autonomousPromotionIssue
    && !getQueuedEntityMentionPolicyIssue(tweet);
}

const NON_ORIGINAL_LOG_FORMATS = new Set([
  'auto_reply',
  'auto_reply_high_value',
  'proactive_reply',
  'proactive_like',
  'auto_follow',
  'cron',
  'learning',
  'queue_refresh',
  'system',
]);

function isSuccessfulOriginalPostLogEntry(entry: PostLogEntry): boolean {
  const format = (entry.format || '').toLowerCase();
  if (NON_ORIGINAL_LOG_FORMATS.has(format)) return false;
  if (format.startsWith('auto_reply')) return false;
  if (format.endsWith('_error')) return false;
  if (entry.action === 'replied') return false;
  if (entry.topic?.startsWith('Reply to')) return false;
  return Boolean(
    entry.content
    && entry.xTweetId
    && (entry.action === 'posted' || !entry.action)
    && (entry.source === 'autopilot' || entry.source === 'cron' || entry.source === 'manual')
  );
}

function latestSuccessfulOriginalPostAt(postLog: PostLogEntry[]): string | null {
  return postLog.find(isSuccessfulOriginalPostLogEntry)?.postedAt || null;
}

function getQueuedEntityMentionPolicyIssue(tweet: Tweet): string | null {
  return getCuratedEntityMentionPolicyIssue(tweet.content);
}

function getQueuedAutopostPolicyIssue(agent: Agent, tweet: Tweet): string | null {
  return getAccountTopicPolicyIssue(
    agent.handle,
    `${tweet.topic || ''} ${tweet.content}`,
    null,
    tweet.portfolioCompanyContext,
  )
    || getGeoffreyCompanyAmplificationIssue(
      agent.handle,
      `${tweet.topic || ''} ${tweet.content}`,
    )
    || (isGeoffreyAccount(agent.handle) || tweet.portfolioCompanyContext
      ? getAntiFundPortfolioPolicyIssue(tweet.content, tweet.portfolioCompanyContext)
      : null)
    || (isGeoffreyAccount(agent.handle)
      ? getAntiFundAutonomousPromotionPolicyIssue(tweet.portfolioCompanyContext)
      : null)
    || getQueuedEntityMentionPolicyIssue(tweet)
    || getAutopostPolicyIssue(tweet.content, {
    allowedMentions: [
      agent.handle,
      ...(tweet.allowedMentionHandles || []),
      ...usedCuratedVerifiedMentionHandles(tweet.content),
      ...(tweet.relationshipTargetHandle ? [tweet.relationshipTargetHandle] : []),
    ],
  });
}

function extractMentionSummary(content: string): string {
  return extractMentionHandles(content).map((handle) => `@${handle}`).join(', ').slice(0, 160);
}

function normalizeReplyHandle(value: string | null | undefined): string {
  return String(value || '').replace(/^@/, '').trim().toLowerCase();
}

type TwitterMention = Awaited<ReturnType<typeof getMentionsFromTwitter>>[number];

async function storeMentionIfNeeded(
  agent: Agent,
  mention: TwitterMention,
  storedTweetIds: Set<string>,
): Promise<void> {
  if (storedTweetIds.has(String(mention.id))) return;

  await createMention({
    agentId: agent.id,
    author: String(mention.authorName || mention.authorId),
    authorHandle: `@${String(mention.authorUsername || mention.authorId)}`,
    content: mention.text,
    tweetId: mention.id,
    conversationId: mention.conversationId || null,
    inReplyToTweetId: mention.inReplyToTweetId || null,
    engagementLikes: 0,
    engagementRetweets: 0,
    authorFollowers: mention.authorFollowers ?? null,
    createdAt: mention.createdAt,
  });
  storedTweetIds.add(String(mention.id));
}

function storedMentionToTwitterMention(mention: Mention): TwitterMention | null {
  if (!mention.tweetId) return null;

  const handle = normalizeReplyHandle(mention.authorHandle || mention.author);
  const fallbackAuthor = String(mention.author || handle || mention.tweetId);

  return {
    id: String(mention.tweetId),
    text: mention.content,
    authorId: handle || fallbackAuthor,
    authorName: fallbackAuthor,
    authorUsername: handle || fallbackAuthor,
    authorFollowers: mention.authorFollowers ?? null,
    createdAt: mention.createdAt,
    conversationId: mention.conversationId || null,
    inReplyToTweetId: mention.inReplyToTweetId || null,
  };
}

function isSelfAuthoredMention(agent: Agent, mention: TwitterMention): boolean {
  const authorId = String(mention.authorId || '').trim();
  const authorHandle = normalizeReplyHandle(mention.authorUsername || mention.authorName || mention.authorId);
  const agentHandle = normalizeReplyHandle(agent.handle);
  return (
    (Boolean(agent.xUserId) && authorId === String(agent.xUserId))
    || (Boolean(agentHandle) && authorHandle === agentHandle)
  );
}

function getTwitterBackoff(error: unknown): { kind: 'Rate limited' | 'API error'; pauseUntil: string; description: string } | null {
  const statusCode = getActionErrorStatusCode(error);
  const isRateLimit = isRateLimitTwitterError(error);
  const isServerError = isTransientTwitterError(error) && statusCode !== 429;
  if (!isRateLimit && !isServerError) return null;

  const fallbackBackoffMins = isRateLimit ? 60 : 15;
  const rateLimitResetAt = isRateLimit ? getTwitterRateLimitResetAt(error) : null;
  const resetAtMs = rateLimitResetAt ? Date.parse(rateLimitResetAt) : NaN;
  const hasFutureReset = Number.isFinite(resetAtMs) && resetAtMs > Date.now();
  const pauseUntil = hasFutureReset
    ? new Date(resetAtMs + 30 * 1000).toISOString()
    : new Date(Date.now() + fallbackBackoffMins * 60 * 1000).toISOString();

  return {
    kind: isRateLimit ? 'Rate limited' : 'API error',
    pauseUntil,
    description: hasFutureReset
      ? `until X resets the quota at ${pauseUntil}`
      : `${fallbackBackoffMins}m`,
  };
}

function isTerminalAutoReplyPostError(error: unknown): boolean {
  if (!isTwitterActionError(error) || error.action !== 'reply_to_tweet') return false;
  if (isInvalidTwitterCredentialError(error) || isRateLimitTwitterError(error) || isTransientTwitterError(error)) return false;

  const statusCode = getActionErrorStatusCode(error);
  if (statusCode !== undefined) {
    return statusCode >= 400 && statusCode < 500;
  }

  return true;
}

type QueuedNativeVoiceContext = Pick<
  Awaited<ReturnType<typeof buildGenerationContext>>,
  'voiceProfile' | 'learnings' | 'memory' | 'allTweets'
>;

function queuedOperatorEvidence(context: QueuedNativeVoiceContext | null): string[] {
  return [
    ...(context?.learnings?.operatorVoiceReference?.pinnedExamples || []),
    ...(context?.learnings?.operatorVoiceReference?.startupRegisterExamples || []),
    ...(context?.learnings?.operatorVoiceReference?.bestPerformers || []),
  ].map((entry) => entry.content);
}

function getQueuedClaimEvidenceIssue(
  tweet: Tweet,
  operatorEvidence: string[] = [],
): string | null {
  if (tweet.contentProvenance !== 'generated_v2') return null;
  const currentIssue = assessClaimEvidence(
    tweet.content,
    getTrustedClaimSourceTexts(tweet, operatorEvidence),
    { allowForecastTimingNumbers: true },
  ).issue;
  if (currentIssue) return currentIssue;
  const scoredRisk = tweet.scoreProvenance?.truthfulnessRisk;
  if (typeof scoredRisk === 'number') {
    return scoredRisk <= -0.1
      ? 'Claim evidence gate: the generation-time evidence check found an unsupported personal or numeric claim.'
      : null;
  }
  return null;
}

function getQueuedSourceCopyIssue(tweet: Tweet): string | null {
  if (tweet.contentProvenance !== 'generated_v2') return null;
  const sourceTexts = [
    ...(tweet.sourceEvidenceTexts || []),
    ...(tweet.generationEvidenceReferences || []).map((entry) => entry.content),
  ].filter((value) => value.trim().length > 0);
  const maxSimilarity = sourceTexts.reduce((highest, sourceText) => Math.max(
    highest,
    semanticIdeaSimilarity({ content: tweet.content, topic: tweet.topic }, { content: sourceText }),
  ), 0);
  return maxSimilarity >= 0.72
    ? `Source-copy gate: draft is too close to evidence wording (${maxSimilarity.toFixed(2)} similarity).`
    : null;
}

function clearsQueuedPostPreflight(
  agent: Agent,
  tweet: Tweet,
  recentPostedContent: string[],
  nativeContext: QueuedNativeVoiceContext | null = null,
): boolean {
  return (
    tweet.status === 'queued'
    && !tweet.quarantinedAt
    && !getSanitizedTweetTextIssue(tweet.content, 'post')
    && !getTweetLengthIssue(tweet.content, 'post')
    && !getTweetCompletenessIssue(tweet.content)
    && !getQueuedAutopostPolicyIssue(agent, tweet)
    && !(isGeoffreyAccount(agent.handle) && getGeoffreyContentMixDecision(
      tweet,
      nativeContext?.allTweets || [],
    ).issue)
    && !getAuthorityProofIssue(tweet.content)
    && !getQueuedClaimEvidenceIssue(tweet, queuedOperatorEvidence(nativeContext))
    && !getQueuedSourceCopyIssue(tweet)
    && !getRecentPostDuplicateIssue(tweet.content, recentPostedContent)
    && !getSemanticHistoryIssue(agent, tweet, recentPostedContent)
  );
}

function getSemanticHistoryIssue(
  _agent: Agent,
  tweet: Pick<Tweet, 'content' | 'topic'>,
  recentPostedContent: string[],
): string | null {
  const maxSimilarity = recentPostedContent.reduce((highest, content) => Math.max(
    highest,
    semanticIdeaSimilarity(
      { content: tweet.content, topic: tweet.topic },
      { content },
    ),
  ), 0);
  return maxSimilarity >= QUEUE_SEMANTIC_DUPLICATE_THRESHOLD
    ? `Semantic idea repeats a recent post (${maxSimilarity.toFixed(2)} similarity).`
    : null;
}

interface QueuePolicyRescoreOptions {
  /**
   * Recent post log (newest first) used to avoid re-logging an unchanged
   * content-mix deferral on every tick. Entries logged by this pass are
   * pushed onto it so a later pass in the same tick sees them.
   */
  recentLog?: PostLogEntry[];
}

async function rescoreQueuedTweetsForCurrentPolicy(
  agent: Agent,
  queuedTweets: Tweet[],
  context: Awaited<ReturnType<typeof buildGenerationContext>> | null,
  options: QueuePolicyRescoreOptions = {},
): Promise<{ valid: Tweet[]; deferred: Tweet[] }> {
  let valid: Tweet[] = [];
  const deferred: Tweet[] = [];
  const invalid: Array<{
    tweet: Tweet;
    issue: string;
    policyGate: 'account_topic_policy' | 'company_amplification_policy' | 'company_content_mix_policy' | 'portfolio_company_policy' | 'portfolio_promotion_priority_policy' | 'entity_mention_policy' | 'generation_origin' | 'autopost_quality_margin';
  }> = [];
  const requiredAutopostMargin = getPublishingV2AutopostQualityMargin(agent.handle);
  const currentVoiceCorpusVersion = context?.learnings?.voiceCorpus?.snapshotId || null;
  for (const tweet of queuedTweets) {
    const accountTopicIssue = getAccountTopicPolicyIssue(
      agent.handle,
      `${tweet.topic || ''} ${tweet.content}`,
      null,
      tweet.portfolioCompanyContext,
    );
    const companyAmplificationIssue = getGeoffreyCompanyAmplificationIssue(
      agent.handle,
      `${tweet.topic || ''} ${tweet.content}`,
    );
    const originIssue = getGeneratedPublishIssue(tweet, {
      currentVoiceCorpusVersion,
      accountHandle: agent.handle,
    });
    const portfolioCompanyIssue = isGeoffreyAccount(agent.handle) || tweet.portfolioCompanyContext
      ? getAntiFundPortfolioPolicyIssue(tweet.content, tweet.portfolioCompanyContext)
      : null;
    const autonomousPromotionIssue = isGeoffreyAccount(agent.handle)
      ? getAntiFundAutonomousPromotionPolicyIssue(tweet.portfolioCompanyContext)
      : null;
    const entityMentionIssue = !accountTopicIssue
      && !companyAmplificationIssue
      && !portfolioCompanyIssue
      && !autonomousPromotionIssue
      ? getQueuedEntityMentionPolicyIssue(tweet)
      : null;
    const accountMarginIssue = (
      !originIssue
      && tweet.pipelineVersion === 'v2'
      && tweet.generationSurface === 'original'
      && typeof tweet.finalCriticScores?.qualityMargin === 'number'
      && tweet.finalCriticScores.qualityMargin < requiredAutopostMargin
    )
      ? `V2-generated originals for @${agent.handle.replace(/^@/, '')} require autonomous quality margin at least ${requiredAutopostMargin.toFixed(2)}.`
      : null;
    const issue = accountTopicIssue
      || companyAmplificationIssue
      || portfolioCompanyIssue
      || autonomousPromotionIssue
      || entityMentionIssue
      || originIssue
      || accountMarginIssue;
    if (issue) invalid.push({
      tweet,
      issue,
      policyGate: accountTopicIssue
        ? 'account_topic_policy'
        : companyAmplificationIssue
          ? 'company_amplification_policy'
          : portfolioCompanyIssue
            ? 'portfolio_company_policy'
            : autonomousPromotionIssue
              ? 'portfolio_promotion_priority_policy'
              : entityMentionIssue
                ? 'entity_mention_policy'
                : originIssue
                  ? 'generation_origin'
                  : 'autopost_quality_margin',
    });
    else valid.push(tweet);
  }
  if (isGeoffreyAccount(agent.handle) && valid.length > 0) {
    const contentMixDecisions = evaluateGeoffreyQueueContentMix(
      valid,
      context?.allTweets || [],
    );
    // Every content-mix reason code is a transient scheduling constraint (a
    // recent-post window or a queue-slot reservation), not a content defect:
    // the same draft is postable again once the window clears. Defer it -
    // hold it out of this tick's postable set - instead of quarantining it
    // and punishing its arms.
    const contentMixDeferred = valid.flatMap((tweet) => {
      const decision = contentMixDecisions.get(String(tweet.id));
      return decision?.issue ? [{ tweet, issue: decision.issue }] : [];
    });
    if (contentMixDeferred.length > 0) {
      const deferredIds = new Set(contentMixDeferred.map(({ tweet }) => tweet.id));
      valid = valid.filter((tweet) => !deferredIds.has(tweet.id));
      deferred.push(...contentMixDeferred.map(({ tweet }) => tweet));
      // Log once per deferred set, not once per tick: a steady-state hold
      // would otherwise write an entry every 10 minutes and crowd the window
      // the daily cap and diversity gate read.
      const deferralKey = `${CONTENT_MIX_DEFERRAL_LOG_PREFIX}${[...deferredIds].map(String).sort().join(',')}`;
      const lastDeferralEntry = (options.recentLog || []).find((entry) => (
        entry.format === 'queue_refresh' && entry.topic === 'content_mix'
      ));
      if (lastDeferralEntry?.skipReason !== deferralKey) {
        const entry: Omit<PostLogEntry, 'id'> = {
          agentId: agent.id,
          tweetId: '',
          xTweetId: '',
          content: '',
          format: 'queue_refresh',
          topic: 'content_mix',
          postedAt: new Date().toISOString(),
          source: 'autopilot',
          action: 'skipped',
          reason: `Deferred ${contentMixDeferred.length} queued draft${contentMixDeferred.length === 1 ? '' : 's'} for the company content-mix window; they stay queued and become postable when the window clears.`,
          skipReason: deferralKey,
        };
        await addPostLogEntry(agent.id, entry).catch(() => null);
        options.recentLog?.unshift({ ...entry, id: `pending:${entry.postedAt}` });
      }
    }
  }
  await Promise.all(invalid.map(({ tweet, issue }) => updateTweet(tweet.id, {
    status: 'quarantined',
    preQuarantineStatus: 'queued',
    quarantinedAt: new Date().toISOString(),
    quarantineReason: issue,
  })));
  const learningInvalid = invalid.filter(({ policyGate }) => (
    policyGate === 'account_topic_policy'
    || policyGate === 'company_amplification_policy'
    || policyGate === 'portfolio_company_policy'
    || policyGate === 'entity_mention_policy'
    || policyGate === 'autopost_quality_margin'
  ));
  for (const { tweet, issue, policyGate } of learningInvalid) {
    await addLearningSignal(agent.id, {
      tweetId: tweet.id,
      xTweetId: tweet.xTweetId || undefined,
      signalType: 'x_post_rejected',
      surface: 'queue',
      rewardDelta: policyGate === 'company_amplification_policy'
        ? -0.95
        : policyGate === 'account_topic_policy'
          ? -0.9
          : policyGate === 'portfolio_company_policy'
            ? -0.85
            : -0.7,
      reason: issue,
      inferred: true,
      metadata: {
        pipelineVersion: tweet.pipelineVersion || null,
        qualityPolicyVersion: tweet.qualityPolicyVersion || null,
        accountTopicPolicyVersion: ACCOUNT_TOPIC_POLICY_VERSION,
        companyAmplificationPolicyVersion: GEOFFREY_COMPANY_AMPLIFICATION_POLICY_VERSION,
        contentMixPolicyVersion: GEOFFREY_CONTENT_MIX_POLICY_VERSION,
        portfolioCompanyPolicyVersion: ANTIFUND_PORTFOLIO_POLICY_VERSION,
        portfolioCompanyPromotionPolicyVersion: ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION,
        entityMentionPolicyVersion: ENTITY_MENTION_POLICY_VERSION,
        feedbackReasonCode: policyGate === 'account_topic_policy'
          ? 'bad_source_topic'
          : policyGate === 'company_amplification_policy'
            ? 'bad_source_topic'
          : policyGate === 'portfolio_company_policy'
            ? 'bad_premise'
            : 'bad_writing',
        policyGate,
        blockedDomain: policyGate === 'account_topic_policy' ? 'sports_competition' : null,
        blockedEntity: policyGate === 'company_amplification_policy' ? 'cursor' : null,
        operatorDirective: policyGate === 'account_topic_policy'
          ? 'stop_posting_sports'
          : policyGate === 'company_amplification_policy'
            ? 'stop_pumping_cursor_prefer_cognition_openai'
            : null,
        portfolioCompanyId: tweet.portfolioCompanyContext?.companyId || null,
        qualityMargin: tweet.finalCriticScores?.qualityMargin ?? null,
      },
    });
  }
  if (invalid.length > 0) {
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'generation_origin_gate',
      topic: 'generation',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'skipped',
      reason: `Quarantined ${invalid.length} queued artifact${invalid.length === 1 ? '' : 's'} that failed current generation, quality, or account-topic policy.`,
    });
  }
  return { valid, deferred };
}

export async function refreshQueuedTweetsForCurrentQualityPolicy(
  agent: Agent,
): Promise<QueuePolicyRefreshResult> {
  const before = await getQueuedTweets(agent.id);
  const context = await buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 });
  const { valid, deferred } = await rescoreQueuedTweetsForCurrentPolicy(agent, before, context);
  return {
    before: before.length,
    after: valid.length,
    certified: valid.length,
    quarantined: before.length - valid.length - deferred.length,
    deferred: deferred.length,
  };
}

export interface QueueRegenerationResult {
  archived: number;
  generatedNow: number;
  postsPerDay: number;
  minQueueSize: number;
}

/**
 * Operator-initiated hard queue refresh: archives every queued draft (with a
 * mild negative learning signal and full audit trail), optionally updates the
 * posting cadence, then starts a refill through the normal autopilot path so
 * fresh drafts are ranked by current rules. refillQueue generates at most 2
 * drafts per call by design; the 10-minute autopilot cron keeps refilling
 * until the queue reaches minQueueSize.
 */
export async function regenerateAgentQueue(
  agent: Agent,
  options: { postsPerDay?: number } = {},
): Promise<QueueRegenerationResult> {
  const now = new Date().toISOString();
  const queued = await getQueuedTweets(agent.id);

  await Promise.all(queued.map((tweet) => updateTweet(tweet.id, {
    status: 'quarantined',
    preQuarantineStatus: tweet.status === 'quarantined'
      ? (tweet.preQuarantineStatus || 'queued')
      : tweet.status,
    quarantinedAt: now,
    quarantineReason: 'Operator queue refresh: archived so autopilot can regenerate the queue with current ranking rules.',
  })));
  // Sequential on purpose: signal storage is a read-modify-write list, so
  // concurrent appends can drop entries.
  for (const tweet of queued) {
    await addLearningSignal(agent.id, {
      tweetId: tweet.id,
      signalType: 'deleted_from_queue',
      surface: 'queue',
      rewardDelta: -0.2,
      reason: 'Archived in an operator-initiated full queue refresh; softer than a targeted per-draft deletion.',
      metadata: { softArchive: true },
    });
  }

  let settings = await getProtocolSettings(agent.id);
  if (typeof options.postsPerDay === 'number' && Number.isFinite(options.postsPerDay)) {
    settings = await updateProtocolSettings(agent.id, {
      postsPerDay: clampPostsPerDay(options.postsPerDay),
    });
  }

  if (queued.length > 0) {
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'queue_refresh',
      topic: 'generation',
      postedAt: now,
      source: 'manual',
      action: 'skipped',
      reason: `Operator refresh archived ${queued.length} queued draft${queued.length === 1 ? '' : 's'}; regenerating fresh at ${settings.postsPerDay}/day.`,
    });
  }

  const generatedNow = await refillQueue(agent, Math.max(settings.minQueueSize, 2));
  return {
    archived: queued.length,
    generatedNow,
    postsPerDay: settings.postsPerDay,
    minQueueSize: settings.minQueueSize,
  };
}
function getStaleSelectionReason(candidate: Tweet, live: Tweet | null): string | null {
  if (!live) return `Stale selection gate: draft ${candidate.id} no longer exists in storage (deleted before posting).`;
  if (live.quarantinedAt) return `Stale selection gate: draft ${candidate.id} was quarantined before posting (${live.quarantineReason || 'no reason recorded'}).`;
  if (live.status !== 'queued') return `Stale selection gate: draft ${candidate.id} is now ${live.status}, not queued.`;
  if (live.content !== candidate.content) return `Stale selection gate: draft ${candidate.id} was edited after it was ranked; the new copy will be re-validated next tick.`;
  return null;
}

/**
 * A successful X post whose status write failed leaves the tweet queued while
 * the post log already records its xTweetId. Without this, the next tick
 * sees its own live copy in recent posts, quarantines the draft as a
 * duplicate, and records a negative signal for a post that is live.
 */
async function reconcileQueuedTweetsAlreadyPosted(
  agentId: string,
  queue: Tweet[],
  postLog: PostLogEntry[],
): Promise<Tweet[]> {
  const remaining: Tweet[] = [];
  for (const queuedTweet of queue) {
    const liveEntry = postLog.find((entry) => (
      String(entry.tweetId) === String(queuedTweet.id)
      && Boolean(entry.xTweetId)
      && isSuccessfulOriginalPostLogEntry(entry)
    ));
    if (!liveEntry) {
      remaining.push(queuedTweet);
      continue;
    }
    await updateTweet(queuedTweet.id, {
      status: 'posted',
      xTweetId: liveEntry.xTweetId,
      postedAt: liveEntry.postedAt,
    });
    await addPostLogEntry(agentId, {
      agentId,
      tweetId: queuedTweet.id,
      xTweetId: liveEntry.xTweetId,
      content: queuedTweet.content,
      format: 'queue_reconcile',
      topic: queuedTweet.topic || 'general',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'skipped',
      reason: `Reconciled queued draft to posted: X already accepted it as ${liveEntry.xTweetId} at ${liveEntry.postedAt} and only the status write had failed.`,
    }).catch(() => null);
  }
  return remaining;
}

async function validateQueuedTweetsForPosting(
  agent: Agent,
  queuedTweets: Tweet[],
  recentPostedContent: string[] = [],
  recentLog: PostLogEntry[] = [],
): Promise<Tweet[]> {
  const nativeContext = await buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 });
  const semanticHistoryContent = [...new Set([
    ...recentPostedContent,
    ...(nativeContext?.allTweets || [])
      .filter((tweet) => Boolean(tweet.xTweetId) && ['posted', 'deleted_from_x'].includes(tweet.status))
      .slice(0, 50)
      .map((tweet) => tweet.content),
  ])];
  const { valid: policyCurrentQueue } = await rescoreQueuedTweetsForCurrentPolicy(agent, queuedTweets, nativeContext, { recentLog });
  const validationPassedQueue: Tweet[] = [];
  for (const queuedTweet of policyCurrentQueue) {
    const sanitizedIssue = getSanitizedTweetTextIssue(queuedTweet.content, 'post');
    if (sanitizedIssue) {
      const resolved = await resolveQueuedTweetFailure(agent, queuedTweet, sanitizedIssue);
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: queuedTweet.id,
        xTweetId: queuedTweet.xTweetId || '',
        content: queuedTweet.content,
        format: queuedTweet.format || 'unknown',
        topic: queuedTweet.topic || 'general',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason: `${sanitizedIssue} ${resolved.detail}`,
      });

      if (
        resolved.tweet
        && clearsQueuedPostPreflight(agent, resolved.tweet, semanticHistoryContent, nativeContext)
      ) {
        validationPassedQueue.push(resolved.tweet);
      }
      continue;
    }

    const lengthIssue = getTweetLengthIssue(queuedTweet.content, 'post');
    if (lengthIssue) {
      const resolved = await resolveQueuedTweetFailure(agent, queuedTweet, lengthIssue);
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: queuedTweet.id,
        xTweetId: queuedTweet.xTweetId || '',
        content: queuedTweet.content,
        format: queuedTweet.format || 'unknown',
        topic: queuedTweet.topic || 'general',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason: `${lengthIssue} ${resolved.detail}`,
      });

      if (resolved.tweet && clearsQueuedPostPreflight(agent, resolved.tweet, semanticHistoryContent, nativeContext)) {
        validationPassedQueue.push(resolved.tweet);
      }
      continue;
    }

    const completenessIssue = getTweetCompletenessIssue(queuedTweet.content);
    if (completenessIssue) {
      const resolved = await resolveQueuedTweetFailure(agent, queuedTweet, completenessIssue);
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: queuedTweet.id,
        xTweetId: queuedTweet.xTweetId || '',
        content: queuedTweet.content,
        format: queuedTweet.format || 'unknown',
        topic: queuedTweet.topic || 'general',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason: `${completenessIssue} ${resolved.detail}`,
      });

      if (resolved.tweet && clearsQueuedPostPreflight(agent, resolved.tweet, semanticHistoryContent, nativeContext)) {
        validationPassedQueue.push(resolved.tweet);
      }
      continue;
    }

    const policyIssue = getQueuedAutopostPolicyIssue(agent, queuedTweet);
    if (policyIssue) {
      await updateTweet(queuedTweet.id, {
        status: 'quarantined',
        preQuarantineStatus: queuedTweet.status === 'quarantined'
          ? (queuedTweet.preQuarantineStatus || 'queued')
          : queuedTweet.status,
        quarantinedAt: new Date().toISOString(),
        quarantineReason: policyIssue,
      });
      await addLearningSignal(agent.id, {
        tweetId: queuedTweet.id,
        signalType: 'x_post_rejected',
        surface: 'autopilot',
        rewardDelta: -0.58,
        reason: policyIssue,
        inferred: true,
        metadata: {
          policyGate: 'unsolicited_mentions',
          mentionedHandles: extractMentionSummary(queuedTweet.content),
          confidenceScore: effectiveConfidence(queuedTweet),
          candidateScore: queuedTweet.candidateScore ?? null,
          generationMode: queuedTweet.generationMode ?? null,
          styleMode: queuedTweet.styleMode ?? 'standard',
          creativeLane: queuedTweet.creativeLane ?? null,
        },
      });
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: queuedTweet.id,
        xTweetId: queuedTweet.xTweetId || '',
        content: queuedTweet.content,
        format: 'autopost_policy_gate',
        topic: queuedTweet.topic || 'general',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason: policyIssue,
      });
      continue;
    }

    const authorityIssue = getAuthorityProofIssue(queuedTweet.content);
    if (authorityIssue) {
      await updateTweet(queuedTweet.id, {
        status: 'quarantined',
        preQuarantineStatus: queuedTweet.status === 'quarantined'
          ? (queuedTweet.preQuarantineStatus || 'queued')
          : queuedTweet.status,
        quarantinedAt: new Date().toISOString(),
        quarantineReason: authorityIssue,
      });
      await addLearningSignal(agent.id, {
        tweetId: queuedTweet.id,
        signalType: 'x_post_rejected',
        surface: 'autopilot',
        rewardDelta: -0.42,
        reason: authorityIssue,
        inferred: true,
        metadata: {
          qualityGate: 'authority_proof',
          confidenceScore: effectiveConfidence(queuedTweet),
          candidateScore: queuedTweet.candidateScore ?? null,
          generationMode: queuedTweet.generationMode ?? null,
          styleMode: queuedTweet.styleMode ?? 'standard',
          creativeLane: queuedTweet.creativeLane ?? null,
          topic: queuedTweet.topic ?? 'general',
        },
      });
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: queuedTweet.id,
        xTweetId: queuedTweet.xTweetId || '',
        content: queuedTweet.content,
        format: 'authority_quality_gate',
        topic: queuedTweet.topic || 'general',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason: authorityIssue,
      });
      continue;
    }

    const claimEvidenceIssue = getQueuedClaimEvidenceIssue(queuedTweet, queuedOperatorEvidence(nativeContext));
    if (claimEvidenceIssue) {
      await updateTweet(queuedTweet.id, {
        status: 'quarantined',
        preQuarantineStatus: queuedTweet.status === 'quarantined'
          ? (queuedTweet.preQuarantineStatus || 'queued')
          : queuedTweet.status,
        quarantinedAt: new Date().toISOString(),
        quarantineReason: claimEvidenceIssue,
      });
      await addLearningSignal(agent.id, {
        tweetId: queuedTweet.id,
        signalType: 'x_post_rejected',
        surface: 'autopilot',
        rewardDelta: -0.72,
        reason: claimEvidenceIssue,
        inferred: true,
        metadata: {
          qualityGate: 'claim_evidence',
          generationProvider: queuedTweet.generationProvider ?? null,
          generationModel: queuedTweet.generationModel ?? null,
          sourceBrief: queuedTweet.sourceBrief?.slice(0, 500) ?? null,
        },
      });
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: queuedTweet.id,
        xTweetId: queuedTweet.xTweetId || '',
        content: queuedTweet.content,
        format: 'claim_evidence_gate',
        topic: queuedTweet.topic || 'general',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason: claimEvidenceIssue,
      });
      continue;
    }

    const sourceCopyIssue = getQueuedSourceCopyIssue(queuedTweet);
    if (sourceCopyIssue) {
      const resolved = await resolveQueuedTweetFailure(agent, queuedTweet, sourceCopyIssue);
      await addLearningSignal(agent.id, {
        tweetId: queuedTweet.id,
        signalType: 'x_post_rejected',
        surface: 'autopilot',
        rewardDelta: -0.72,
        reason: sourceCopyIssue,
        inferred: true,
        metadata: { qualityGate: 'source_copy' },
      });
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: queuedTweet.id,
        xTweetId: queuedTweet.xTweetId || '',
        content: queuedTweet.content,
        format: 'source_copy_gate',
        topic: queuedTweet.topic || 'general',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason: `${sourceCopyIssue} ${resolved.detail}`,
      });
      continue;
    }

    const duplicateIssue = getRecentPostDuplicateIssue(queuedTweet.content, semanticHistoryContent)
      || getSemanticHistoryIssue(agent, queuedTweet, semanticHistoryContent);
    if (duplicateIssue) {
      const resolved = await resolveQueuedTweetFailure(agent, queuedTweet, duplicateIssue);
      await addLearningSignal(agent.id, {
        tweetId: queuedTweet.id,
        signalType: 'x_post_rejected',
        surface: 'autopilot',
        rewardDelta: -0.38,
        reason: duplicateIssue,
        inferred: true,
        metadata: {
          qualityGate: 'recent_duplicate',
          confidenceScore: effectiveConfidence(queuedTweet),
          candidateScore: queuedTweet.candidateScore ?? null,
          generationMode: queuedTweet.generationMode ?? null,
          styleMode: queuedTweet.styleMode ?? 'standard',
          creativeLane: queuedTweet.creativeLane ?? null,
          topic: queuedTweet.topic ?? 'general',
        },
      });
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: queuedTweet.id,
        xTweetId: queuedTweet.xTweetId || '',
        content: queuedTweet.content,
        format: 'recent_duplicate_gate',
        topic: queuedTweet.topic || 'general',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason: `${duplicateIssue} ${resolved.detail}`,
      });

      if (resolved.tweet && clearsQueuedPostPreflight(agent, resolved.tweet, semanticHistoryContent, nativeContext)) {
        validationPassedQueue.push(resolved.tweet);
      }
      continue;
    }

    validationPassedQueue.push(queuedTweet);
  }
  return validationPassedQueue;
}

async function archiveStaleLowConfidenceQueue(
  agentId: string,
  tweets: Tweet[],
  threshold: number,
  mode: ProtocolSettings['autonomyMode'],
  now = Date.now(),
  force = false,
): Promise<number> {
  const staleLowConfidenceTweets = tweets.filter((tweet) => {
    const createdAt = new Date(tweet.createdAt).getTime();
    return (force || (Number.isFinite(createdAt) && now - createdAt >= STALE_LOW_CONFIDENCE_QUEUE_MS))
      && !isConfidenceEligibleForAutopost(tweet, mode, threshold);
  });

  if (staleLowConfidenceTweets.length === 0) return 0;

  await Promise.all(staleLowConfidenceTweets.map((tweet) => updateTweet(tweet.id, {
    status: 'quarantined',
    preQuarantineStatus: tweet.status === 'quarantined'
      ? (tweet.preQuarantineStatus || 'queued')
      : tweet.status,
    quarantinedAt: new Date(now).toISOString(),
    quarantineReason: `Auto-archived from autopost queue: confidence ${effectiveConfidence(tweet).toFixed(3)} stayed below the active threshold ${effectiveAutopostThreshold(tweet, mode, threshold).toFixed(2)}.`,
  })));

  await addPostLogEntry(agentId, {
    agentId,
    tweetId: '',
    xTweetId: '',
    content: '',
    format: 'queue_refresh',
    topic: 'generation',
    postedAt: new Date().toISOString(),
    source: 'autopilot',
    action: 'skipped',
    reason: `Moved ${staleLowConfidenceTweets.length} stale low-confidence draft${staleLowConfidenceTweets.length === 1 ? '' : 's'} out of the autopost queue so fresh candidates can be generated.`,
  });

  return staleLowConfidenceTweets.length;
}

export async function archiveStaleNetworkTopicQueue(
  agentId: string,
  tweets: Tweet[],
  currentTopics: TrendingTopic[],
  options: { currentReadComplete?: boolean; now?: number } = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  const currentNetworkTopicIds = new Set(
    currentTopics
      .filter((topic) => topic.discoveryMethod === 'followed_network')
      .map(getTrendingTopicStableId),
  );
  const stale = tweets.filter((tweet) => {
    const topicId = String(tweet.trendTopicId || '');
    if (!isFollowedNetworkSource(tweet)) return false;
    const createdAt = Date.parse(tweet.createdAt);
    if (!Number.isFinite(createdAt)) return false;
    const age = now - createdAt;
    if (age >= MAX_NETWORK_TOPIC_QUEUE_MS) return true;
    return options.currentReadComplete === true
      && age >= STALE_NETWORK_TOPIC_QUEUE_MS
      && !currentNetworkTopicIds.has(topicId);
  });

  if (stale.length === 0) return 0;

  await Promise.all(stale.map((tweet) => updateTweet(tweet.id, {
    status: 'quarantined',
    preQuarantineStatus: tweet.status === 'quarantined'
      ? (tweet.preQuarantineStatus || 'queued')
      : tweet.status,
    quarantinedAt: new Date(now).toISOString(),
    quarantineReason: 'Auto-archived from autopost queue: its followed-network topic lost current momentum support.',
  })));
  await addPostLogEntry(agentId, {
    agentId,
    tweetId: '',
    xTweetId: '',
    content: '',
    format: 'queue_refresh',
    topic: 'network_topics',
    postedAt: new Date(now).toISOString(),
    source: 'autopilot',
    action: 'skipped',
    reason: `Moved ${stale.length} stale network-topic draft${stale.length === 1 ? '' : 's'} out of the autopost queue after refreshed follow-graph evidence no longer supported the subject.`,
  });
  return stale.length;
}

export async function inspectAutopilotQueue(
  agentId: string,
  settingsArg?: ProtocolSettings,
): Promise<AutopilotQueueHealth> {
  const settings = settingsArg || await getProtocolSettings(agentId);
  const threshold = getAutonomyConfidenceThreshold(settings.autonomyMode || 'balanced');
  const [queue, agent] = await Promise.all([getQueuedTweets(agentId), getAgent(agentId)]);
  const activeQueue = queue.filter((tweet) => isAutopostableQueuedTweetForAgent(agent, tweet));
  const completeQueue = activeQueue.filter((tweet) => !getTweetCompletenessIssue(tweet.content));
  const confidenceValues = completeQueue.map(effectiveConfidence);
  const staleCutoff = Date.now() - STALE_LOW_CONFIDENCE_QUEUE_MS;

  return {
    queueDepth: queue.length,
    activeQueueDepth: activeQueue.length,
    postableQueueDepth: completeQueue.filter((tweet) =>
      isConfidenceEligibleForAutopost(tweet, settings.autonomyMode || 'balanced', threshold)
    ).length,
    lowConfidenceDepth: completeQueue.filter((tweet) =>
      !isConfidenceEligibleForAutopost(tweet, settings.autonomyMode || 'balanced', threshold)
    ).length,
    staleLowConfidenceDepth: completeQueue.filter((tweet) =>
      !isConfidenceEligibleForAutopost(tweet, settings.autonomyMode || 'balanced', threshold)
      && new Date(tweet.createdAt).getTime() < staleCutoff
    ).length,
    threshold,
    mode: settings.autonomyMode || 'balanced',
    maxConfidence: confidenceValues.length > 0 ? Math.max(...confidenceValues) : null,
  };
}

export async function selfHealAutopilotQueue(
  agent: Agent,
  settingsArg?: ProtocolSettings,
  options: { forceArchiveLowConfidence?: boolean } = {},
): Promise<AutopilotQueueSelfHealResult> {
  const settings = settingsArg || await getProtocolSettings(agent.id);
  const before = await inspectAutopilotQueue(agent.id, settings);

  if (before.postableQueueDepth > 0) {
    return {
      archived: 0,
      generated: 0,
      before,
      after: before,
      action: 'queue already has postable drafts',
    };
  }

  const queuedTweets = await getQueuedTweets(agent.id);
  const completeActiveQueue = queuedTweets
    .filter((tweet) => isAutopostableQueuedTweetForAgent(agent, tweet) && !getTweetCompletenessIssue(tweet.content));
  const archived = await archiveStaleLowConfidenceQueue(
    agent.id,
    completeActiveQueue,
    before.threshold,
    settings.autonomyMode || 'balanced',
    Date.now(),
    options.forceArchiveLowConfidence,
  );
  const generated = await refillQueue(agent, Math.max(settings.minQueueSize + 3, archived, 3));
  const after = await inspectAutopilotQueue(agent.id, settings);

  return {
    archived,
    generated,
    before,
    after,
    action: `archived ${archived}, generated ${generated}`,
  };
}

/**
 * Run full autopilot for a single agent — posting + replies.
 */
export async function runAutopilot(agent: Agent): Promise<AutopilotResult> {
  const agentId = agent.id;

  const { getAgentAutomationEntitlement } = await import('./automation-entitlement');
  const entitlement = await getAgentAutomationEntitlement(agentId, { agent });
  if (!entitlement.eligible) {
    return { agentId, action: 'skipped', reason: entitlement.reason };
  }

  if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
    return { agentId, action: 'skipped', reason: 'X API not connected' };
  }

  const settings = await getProtocolSettings(agentId);
  if (!settings.enabled && !settings.autoReply) {
    return { agentId, action: 'skipped', reason: 'Auto-post and auto-reply both disabled' };
  }

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  // --- Auto-reply to mentions (runs regardless of active hours) ---
  let repliesSent = 0;
  if (settings.autoReply) {
    // Check reply cooldown
    const replyInterval = (settings.replyIntervalMins || 30) * 60 * 1000;
    const lastReplyAttemptAt = settings.lastReplyCheckedAt || settings.lastRepliedAt;
    const replyElapsed = lastReplyAttemptAt
      ? Date.now() - new Date(lastReplyAttemptAt).getTime()
      : Infinity;

    if (replyElapsed >= replyInterval) {
      const checkedAt = new Date().toISOString();
      try {
        const replyOutcome = await runAutoReply(agent, keys, settings);
        repliesSent = replyOutcome.repliesSent;
        await updateProtocolSettings(agent.id, {
          lastReplyCheckedAt: replyOutcome.lastReplyCheckedAt || checkedAt,
        });
      } catch (err) {
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: '',
          xTweetId: '',
          content: '',
          format: 'auto_reply_error',
          topic: 'mentions',
          postedAt: new Date().toISOString(),
          source: 'autopilot',
          action: 'error',
          reason: formatActionError(err, 'auto_reply_loop', {
            handle: `@${agent.handle}`,
          }),
        });
        await updateProtocolSettings(agent.id, { lastReplyCheckedAt: checkedAt });
        // Don't fail the whole run if replies fail
      }
    }
  }

  // --- Auto-post from queue ---
  if (!settings.enabled) {
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0 ? `Sent ${repliesSent} replies (auto-post disabled)` : 'Auto-post disabled',
      repliesSent,
    };
  }

  const postLog = await getPostLog(agentId, AUTOPILOT_POST_LOG_WINDOW);

  // Content calendar: if today has a topic focus, pass it to generation
  const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
  const todaysTopic = settings.contentCalendar?.[dayOfWeek] || null;

  // Fast feedback: check if any post from the last 2 hours is going viral (3x above average)
  let momentumTopic: string | null = null;
  const veryRecentPosts = postLog
    .filter((e) => isSuccessfulOriginalPostLogEntry(e) && new Date(e.postedAt).getTime() > Date.now() - 2 * 60 * 60 * 1000);

  if (veryRecentPosts.length > 0) {
    // We can't check engagement in real-time from post log (no likes stored there),
    // but we can check performance history for very recent tweets
    const perfHistory = await getPerformanceHistory(agentId, 20);
    const recentPerf = perfHistory.filter(
      (p) => new Date(p.checkedAt).getTime() > Date.now() - 2 * 60 * 60 * 1000
    );
    if (recentPerf.length > 0) {
      const avgLikes = perfHistory.length > 5
        ? perfHistory.reduce((s, p) => s + p.likes, 0) / perfHistory.length
        : 0;
      const hotTweet = recentPerf.find((p) => p.likes > avgLikes * 3 && p.likes >= 10);
      if (hotTweet) {
        momentumTopic = hotTweet.topic || hotTweet.format;
        console.log(`[autopilot] Momentum detected: "${hotTweet.content.slice(0, 50)}..." (${hotTweet.likes} likes, avg is ${Math.round(avgLikes)})`);
      }
    }
  }

  // Heal broken queued drafts before cooldown so the queue stays healthy even
  // during long off-peak pauses.
  let queue = await getQueuedTweets(agentId);
  queue = await reconcileQueuedTweetsAlreadyPosted(agentId, queue, postLog);
  queue = (await rescoreQueuedTweetsForCurrentPolicy(agent, queue, null, { recentLog: postLog })).valid;
  const healedQueue: typeof queue = [];
  for (const queuedTweet of queue) {
    const queueIssue = queuedTweet.quarantinedAt
      ? (queuedTweet.quarantineReason || 'Draft was previously quarantined after a posting failure.')
      : getTweetCompletenessIssue(queuedTweet.content);

    if (!queueIssue) {
      healedQueue.push(queuedTweet);
      continue;
    }

    const resolved = await resolveQueuedTweetFailure(agent, queuedTweet, queueIssue);
    if (resolved.tweet) {
      healedQueue.push(resolved.tweet);
    }

    await addPostLogEntry(agentId, {
      agentId,
      tweetId: queuedTweet.id,
      xTweetId: queuedTweet.xTweetId || '',
      content: queuedTweet.content,
      format: queuedTweet.format || 'unknown',
      topic: queuedTweet.topic || 'general',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'skipped',
      reason: `${queueIssue} ${resolved.detail}`,
    });
  }
  queue = healedQueue;
  if (queue.some(isFollowedNetworkSource)) {
    const [topicSnapshot, topicState] = await Promise.all([
      getTrendingCacheSnapshot(agentId),
      getTopicIntelligenceState(agentId),
    ]);
    const observedAt = Date.parse(topicState?.observedAt || '');
    const currentReadComplete = Boolean(
      topicSnapshot?.isFresh
      && topicState?.sourceComplete === true
      && Number.isFinite(observedAt)
      && Date.now() - observedAt <= CURRENT_NETWORK_TOPIC_READ_MS,
    );
    const archivedNetworkTopics = await archiveStaleNetworkTopicQueue(
      agentId,
      queue,
      Array.isArray(topicSnapshot?.data) ? topicSnapshot.data as TrendingTopic[] : [],
      { currentReadComplete },
    );
    if (archivedNetworkTopics > 0) {
      queue = await getQueuedTweets(agentId);
    }
  }
  let activeQueue = queue.filter((tweet) => isAutopostableQueuedTweetForAgent(agent, tweet));

  // Ensure queue has content
  if (activeQueue.length < settings.minQueueSize) {
    const generated = await refillQueue(agent, settings.minQueueSize - activeQueue.length + 3, {
      scheduledTopic: todaysTopic,
      momentumTopic,
    });
    if (generated > 0) {
      queue = await getQueuedTweets(agentId);
      activeQueue = queue.filter((tweet) => isAutopostableQueuedTweetForAgent(agent, tweet));
    }
  }

  // Clamp postsPerDay to the shared automated maximum
  const safePostsPerDay = effectivePostsPerDay(settings.postsPerDay);
  const baseIntervalMs = (24 / safePostsPerDay) * 60 * 60 * 1000;

  // Peak hour clustering: during peak hours, use 40% of normal cooldown (post more often).
  // During off-peak, use 3x cooldown (post less often). This clusters posts into high-engagement windows.
  const currentHour = new Date().getUTCHours();
  const hasPeakHours = settings.peakHours && settings.peakHours.length > 0;
  const isPeakHour = hasPeakHours && settings.peakHours.includes(currentHour);
  const cooldownMultiplier = hasPeakHours ? (isPeakHour ? 0.4 : 3.0) : 1.0;

  if (settings.postCooldownUntil) {
    const cooldownUntilMs = new Date(settings.postCooldownUntil).getTime();
    if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > Date.now()) {
      const minsLeft = Math.max(1, Math.round((cooldownUntilMs - Date.now()) / 60000));
      return {
        agentId,
        action: repliesSent > 0 ? 'replied' : 'skipped',
        reason: repliesSent > 0
          ? `Sent ${repliesSent} replies. X post API backoff: ${minsLeft}m left.`
          : `X post API backoff: ${minsLeft}m until retry`,
        repliesSent,
      };
    }
    await updateProtocolSettings(agentId, { postCooldownUntil: null });
  }

  const latestLoggedPostAt = latestSuccessfulOriginalPostAt(postLog);
  const settingsLastPostedMs = settings.lastPostedAt ? new Date(settings.lastPostedAt).getTime() : NaN;
  const loggedLastPostedMs = latestLoggedPostAt ? new Date(latestLoggedPostAt).getTime() : NaN;
  const cadenceAnchor = Number.isFinite(loggedLastPostedMs) && (!Number.isFinite(settingsLastPostedMs) || loggedLastPostedMs > settingsLastPostedMs)
    ? latestLoggedPostAt
    : settings.lastPostedAt;
  // Seed the jitter with the slot anchor so every tick evaluates the same
  // sampled interval for this slot instead of re-rolling until a low draw wins.
  const minIntervalMs = jitterInterval(
    Math.round(baseIntervalMs * cooldownMultiplier),
    cadenceAnchor ? `${agentId}:${cadenceAnchor}` : null,
  );
  if (cadenceAnchor) {
    const elapsed = Date.now() - new Date(cadenceAnchor).getTime();
    if (elapsed < minIntervalMs) {
      const minsLeft = Math.round((minIntervalMs - elapsed) / 60000);
      return {
        agentId,
        action: repliesSent > 0 ? 'replied' : 'skipped',
        reason: repliesSent > 0
          ? `Sent ${repliesSent} replies. Post cooldown: ${minsLeft}m left${isPeakHour ? ' (peak hour)' : ''}`
          : `Cooldown: ${minsLeft}m until next post${isPeakHour ? ' (peak hour, faster)' : ''}`,
        repliesSent,
      };
    }
  }

  // Daily hard cap — stop posting if we've hit the absolute limit
  if (
    countPostsInLast24h(postLog) >= MAX_AUTOMATED_ORIGINAL_POSTS_PER_DAY
    || isDailyCapReached(postLog)
  ) {
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0
        ? `Sent ${repliesSent} replies. Daily post cap reached.`
        : 'Daily post cap reached — pausing until tomorrow',
      repliesSent,
    };
  }

  if (activeQueue.length === 0) {
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0
        ? `Sent ${repliesSent} replies. No active queued tweet cleared posting filters.`
        : 'Queue empty after auto-repair and generation attempts',
      repliesSent,
    };
  }

  // Pick tweet with diversity awareness (avoids consecutive same-format/topic + near-duplicates)
  const recentPostEntries = postLog
    .filter(isSuccessfulOriginalPostLogEntry)
    .slice(0, 10)
    .map((e) => ({ format: e.format, topic: e.topic, content: e.content }));
  const recentPostedContent = recentPostEntries.map((entry) => entry.content);
  let validationPassedQueue = await validateQueuedTweetsForPosting(agent, activeQueue, recentPostedContent, postLog);

  if (validationPassedQueue.length === 0) {
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0
        ? 'Sent replies, but no queued tweets were salvageable after auto-repair.'
        : 'No queued tweets were salvageable after auto-repair.',
      repliesSent,
    };
  }

  const confidenceThreshold = getAutonomyConfidenceThreshold(settings.autonomyMode || 'balanced');
  let confidenceFiltered = validationPassedQueue.filter((tweet) => (
    isConfidenceEligibleForAutopost(tweet, settings.autonomyMode || 'balanced', confidenceThreshold)
  ));

  if (confidenceFiltered.length === 0) {
    const archived = await archiveStaleLowConfidenceQueue(agentId, validationPassedQueue, confidenceThreshold, settings.autonomyMode || 'balanced');
    if (archived > 0) {
      const generated = await refillQueue(agent, Math.max(settings.minQueueSize + 3, archived), {
        scheduledTopic: todaysTopic,
        momentumTopic,
      });

      if (generated > 0) {
        queue = await getQueuedTweets(agentId);
        activeQueue = queue.filter((tweet) => isAutopostableQueuedTweetForAgent(agent, tweet));
        validationPassedQueue = await validateQueuedTweetsForPosting(agent, activeQueue, recentPostedContent, postLog);
        confidenceFiltered = validationPassedQueue.filter((tweet) => (
          isConfidenceEligibleForAutopost(tweet, settings.autonomyMode || 'balanced', confidenceThreshold)
        ));
      }
    }
  }

  if (confidenceFiltered.length === 0) {
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0
        ? `Sent ${repliesSent} replies. No queued tweet cleared the ${settings.autonomyMode || 'balanced'} confidence threshold (${confidenceThreshold.toFixed(2)}).`
        : `No queued tweet cleared the ${settings.autonomyMode || 'balanced'} confidence threshold (${confidenceThreshold.toFixed(2)}).`,
      repliesSent,
    };
  }

  const rankedQueue = [...confidenceFiltered].sort((a, b) =>
    (b.candidateScore ?? 0) - (a.candidateScore ?? 0) ||
    (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0) ||
    a.createdAt.localeCompare(b.createdAt)
  );
  // The queue snapshot can be minutes old by now (refill and validation run
  // in between), and operator delete/edit/refresh routes do not take the
  // autopilot lock. Re-read the pick from storage and skip it if it is no
  // longer the queued draft we ranked, falling through to the next candidate.
  // The re-read below still leaves a window: an operator delete or edit that
  // lands after it would otherwise be published anyway. Every queue write bumps
  // the agent's queue version, so capture it before the re-read and re-check it
  // as the last step before the X call.
  const queueVersionBeforeSelection = await getQueueVersion(agentId);
  const selectionPool = [...rankedQueue];
  let tweet: Tweet | null = null;
  while (selectionPool.length > 0) {
    const candidate = pickDiverseTweet(selectionPool, recentPostEntries) || selectionPool[0];
    const staleReason = getStaleSelectionReason(candidate, await getTweet(candidate.id));
    if (!staleReason) {
      tweet = candidate;
      break;
    }
    selectionPool.splice(selectionPool.indexOf(candidate), 1);
    await addPostLogEntry(agentId, {
      agentId,
      tweetId: candidate.id,
      xTweetId: candidate.xTweetId || '',
      content: candidate.content,
      format: 'stale_selection_gate',
      topic: candidate.topic || 'general',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'skipped',
      reason: staleReason,
    }).catch(() => null);
  }
  if (!tweet) {
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0
        ? `Sent ${repliesSent} replies. Every ranked draft changed in storage before posting; nothing was posted.`
        : 'Every ranked draft changed in storage before posting; nothing was posted.',
      repliesSent,
    };
  }

  const queueVersionBeforePost = await getQueueVersion(agentId);
  if (queueVersionBeforePost !== queueVersionBeforeSelection) {
    const mutationReason = `Queue mutation gate: the queue changed (version ${queueVersionBeforeSelection} -> ${queueVersionBeforePost}) after draft ${tweet.id} was re-read, so the post was cancelled rather than racing an operator delete or edit. The queue is re-validated next tick.`;
    await addPostLogEntry(agentId, {
      agentId,
      tweetId: tweet.id,
      xTweetId: tweet.xTweetId || '',
      content: tweet.content,
      format: 'queue_mutation_gate',
      topic: tweet.topic || 'general',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'skipped',
      reason: mutationReason,
    }).catch(() => null);
    return {
      agentId,
      action: repliesSent > 0 ? 'replied' : 'skipped',
      reason: repliesSent > 0 ? `Sent ${repliesSent} replies. ${mutationReason}` : mutationReason,
      tweetId: tweet.id,
      content: tweet.content,
      format: tweet.format || 'unknown',
      topic: tweet.topic || 'general',
      repliesSent,
    };
  }

  let result: Awaited<ReturnType<typeof postTweet>>;
  try {
    result = await postTweet(keys, tweet.content, { username: agent.handle });
  } catch (err) {
    const message = formatActionError(err, 'post_tweet', {
      draftId: tweet.id,
      format: tweet.format || 'unknown',
      topic: tweet.topic || 'general',
    });

    const isInvalidCredentials = isInvalidTwitterCredentialError(err);
    if (isInvalidCredentials) {
      await invalidateAgentConnection(agentId);
      return {
        agentId,
        action: 'error',
        reason: `X credentials rejected by X. Agent disconnected, reconnect in Settings. ${message}`,
        tweetId: tweet.id,
        content: tweet.content,
        format: tweet.format || 'unknown',
        topic: tweet.topic || 'general',
        repliesSent,
      };
    }
    const backoff = getTwitterBackoff(err);
    if (backoff) {
      await updateProtocolSettings(agentId, { postCooldownUntil: backoff.pauseUntil });
      return {
        agentId,
        action: 'error',
        reason: `${backoff.kind} — pausing ${backoff.description}. ${message}`,
        tweetId: tweet.id,
        content: tweet.content,
        format: tweet.format || 'unknown',
        topic: tweet.topic || 'general',
        repliesSent,
      };
    }

    const resolved = await resolveQueuedTweetFailure(agent, tweet, message);
    await addLearningSignal(agentId, {
      tweetId: tweet.id,
      signalType: 'x_post_rejected',
      surface: 'autopilot',
      rewardDelta: -0.75,
      reason: message,
      metadata: {
        confidenceScore: effectiveConfidence(tweet),
        candidateScore: tweet.candidateScore ?? null,
        generationMode: tweet.generationMode ?? null,
        styleMode: tweet.styleMode ?? 'standard',
        draftExperimentId: tweet.draftExperimentId ?? null,
        creativeLane: tweet.creativeLane ?? null,
        experimentHoldout: tweet.experimentHoldout === true,
      },
    });

    return {
      agentId,
      action: 'error',
      reason: `${message} ${resolved.detail}`,
      tweetId: tweet.id,
      content: resolved.tweet?.content ?? tweet.content,
      format: (resolved.tweet?.format ?? tweet.format) || 'unknown',
      topic: (resolved.tweet?.topic ?? tweet.topic) || 'general',
      repliesSent,
    };
  }

  const postedAt = new Date().toISOString();
  const persistenceWarnings: string[] = [];
  const capturePersistence = async (label: string, write: Promise<unknown>) => {
    try {
      await write;
    } catch (err) {
      persistenceWarnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await capturePersistence(
    'tweet_status',
    updateTweet(tweet.id, { status: 'posted', xTweetId: result.tweetId, postedAt }),
  );

  await capturePersistence(
    'protocol_settings',
    updateProtocolSettings(agentId, {
      lastPostedAt: postedAt,
      postCooldownUntil: null,
      totalAutoPosted: settings.totalAutoPosted + 1,
    }),
  );

  await capturePersistence(
    'learning_signal',
    addLearningSignal(agentId, {
      tweetId: tweet.id,
      xTweetId: result.tweetId,
      signalType: 'x_post_succeeded',
      surface: 'autopilot',
      rewardDelta: 0.65,
      metadata: {
        ...buildGenerationLearningMetadata(tweet),
        confidenceScore: effectiveConfidence(tweet),
        candidateScore: tweet.candidateScore ?? null,
        generationMode: tweet.generationMode ?? null,
        styleMode: tweet.styleMode ?? 'standard',
        draftExperimentId: tweet.draftExperimentId ?? null,
        creativeLane: tweet.creativeLane ?? null,
        experimentHoldout: tweet.experimentHoldout === true,
      },
    }),
  );

  await capturePersistence(
    'post_log',
    addPostLogEntry(agentId, {
      agentId,
      tweetId: tweet.id,
      xTweetId: result.tweetId,
      content: tweet.content,
      format: tweet.format || tweet.topic || 'unknown',
      topic: tweet.topic || 'general',
      postedAt,
      source: 'autopilot',
      reason: `Posted with confidence ${effectiveConfidence(tweet).toFixed(2)} in ${settings.autonomyMode || 'balanced'} mode.`
        + (persistenceWarnings.length ? ` Persistence warnings: ${persistenceWarnings.join('; ')}` : ''),
    }),
  );

  const newTotal = settings.totalAutoPosted + 1;
  if (newTotal === 1) {
    await capturePersistence('funnel_event', logFunnelEvent(agentId, 'first_post', { xTweetId: result.tweetId }));
  } else if (newTotal === 10) {
    await capturePersistence('funnel_event', logFunnelEvent(agentId, 'tenth_post', { xTweetId: result.tweetId }));
  }

  return {
    agentId,
    action: 'posted',
    reason: `Posted to X as @${result.username}`
      + (repliesSent > 0 ? ` + ${repliesSent} replies` : '')
      + (persistenceWarnings.length ? `; persistence warnings: ${persistenceWarnings.join('; ')}` : ''),
    tweetId: tweet.id,
    xTweetId: result.tweetId,
    content: tweet.content,
    repliesSent,
  };
}

// ─── Auto-reply to mentions ──────────────────────────────────────────────────

async function runAutoReply(
  agent: Agent,
  keys: TwitterKeys,
  settings: ProtocolSettings
): Promise<AutoReplyRunOutcome> {
  const entitlement = await assertAgentAutomationEntitlement(agent.id, { agent });
  if (!agent.xUserId) return { repliesSent: 0 };
  if (areRepliesDisabled()) {
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'auto_reply_emergency_disabled',
      topic: 'mentions',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'skipped',
      reason: REPLY_AUTOMATION_DISABLED_REASON,
    }).catch(() => null);
    return { repliesSent: 0 };
  }

  const storedMentions = await getRecentMentions(agent.id, 500);
  const storedTweetIds = new Set(storedMentions.map((m) => String(m.tweetId)).filter(Boolean));
  const latestStoredTweetId = getLatestTwitterTweetIdCursor(storedMentions);

  // Fetch recent mentions from X
  let rawMentions;
  try {
    rawMentions = await getMentionsFromTwitter(keys, agent.xUserId, latestStoredTweetId);
  } catch (err) {
    const invalidCredentials = isInvalidTwitterCredentialError(err);
    if (invalidCredentials) {
      await invalidateAgentConnection(agent.id);
    }
    const backoff = invalidCredentials ? null : getTwitterBackoff(err);
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'auto_reply_error',
      topic: 'mentions',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'error',
      reason: `${invalidCredentials ? 'X credentials rejected by X. Agent disconnected, reconnect in Settings. ' : ''}${backoff ? `${backoff.kind} — pausing auto-replies ${backoff.description}. ` : ''}${formatActionError(err, 'fetch_mentions', {
        handle: `@${agent.handle}`,
        xUserId: agent.xUserId,
      })}`,
    });
    return { repliesSent: 0, lastReplyCheckedAt: backoff?.pauseUntil }; // API might not be available on free tier
  }

  // Track which mentions we've already replied to (check post log for reply entries)
  const postLog = await getPostLog(agent.id, AUTO_REPLY_HANDLED_LOG_LIMIT);
  const repliedToTweetIds = new Set(
    postLog
      .filter((e) => HANDLED_AUTO_REPLY_FORMATS.has(String(e.format || '')) && e.tweetId)
      .map((e) => String(e.tweetId))
  );
  const storedConversationByTweetId = new Map(
    storedMentions
      .filter((mention) => mention.tweetId && mention.conversationId)
      .map((mention) => [String(mention.tweetId), String(mention.conversationId)] as const)
  );
  const repliedConversationIds = new Set(
    postLog
      .filter((e) => POSTED_AUTO_REPLY_FORMATS.has(String(e.format || '')) && e.tweetId)
      .map((e) => storedConversationByTweetId.get(String(e.tweetId)))
      .filter((conversationId): conversationId is string => Boolean(conversationId))
  );

  // Durable replied markers: the post log is a sliding window (~1-3 weeks of
  // entries), so an old reply can fall out of it while its mention is still in
  // the stored-mention window and get re-replied. Persisted reply tweets carry
  // the mention's X id as generationTriggerId and never expire, so they are
  // the authoritative record.
  const persistedTweetsForReplies = await getTweets(agent.id);
  for (const tweet of persistedTweetsForReplies) {
    if (
      tweet.generationSurface === 'reply'
      && tweet.generationTriggerId
      && (tweet.status === 'posted' || tweet.status === 'deleted_from_x')
    ) {
      const triggerId = String(tweet.generationTriggerId);
      repliedToTweetIds.add(triggerId);
      const conversationId = storedConversationByTweetId.get(triggerId);
      if (conversationId) repliedConversationIds.add(conversationId);
    }
  }

  const storedUnrepliedMentions = storedMentions
    .filter((mention) => mention.tweetId && !repliedToTweetIds.has(String(mention.tweetId)))
    .map(storedMentionToTwitterMention)
    .filter((mention): mention is TwitterMention => mention !== null);
  const mentionById = new Map<string, TwitterMention>();
  for (const mention of storedUnrepliedMentions) {
    mentionById.set(String(mention.id), mention);
  }
  for (const mention of rawMentions || []) {
    mentionById.set(String(mention.id), mention);
  }
  const mentionCandidates = [...mentionById.values()];
  if (mentionCandidates.length === 0) return { repliesSent: 0 };

  // Filter to mentions we haven't replied to yet (regardless of whether they're stored)
  const unrepliedMentions = mentionCandidates.filter((m) => !repliedToTweetIds.has(String(m.id)));
  if (unrepliedMentions.length === 0) return { repliesSent: 0 };

  const relationshipProfiles: RelationshipProfile[] = await getRelationshipProfiles(agent.id, 250)
    .catch(() => [] as RelationshipProfile[]);
  const relationshipByHandle = new Map<string, RelationshipProfile>(
    relationshipProfiles.map((profile) => [normalizeReplyHandle(profile.handle), profile] as const)
  );
  const replyEligibleMentions: typeof unrepliedMentions = [];
  for (const mention of unrepliedMentions) {
    const mentionHandle = `@${mention.authorUsername || mention.authorId}`;
    const normalizedAuthor = normalizeReplyHandle(mention.authorUsername || mention.authorId);
    if (isSelfAuthoredMention(agent, mention)) {
      await storeMentionIfNeeded(agent, mention, storedTweetIds);
      const reason = 'Self-mention suppressed: the mention was authored by this managed X account.';
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: mention.id,
        xTweetId: '',
        content: mention.text,
        format: 'auto_reply_self_mention',
        topic: `Suppressed self-mention from @${mention.authorUsername || mention.authorId}`,
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason,
      });
      await addLearningSignal(agent.id, {
        xTweetId: mention.id,
        signalType: 'reply_rejected',
        surface: 'autopilot',
        rewardDelta: -0.08,
        reason,
        inferred: true,
        metadata: {
          policyGate: 'self_mention',
          targetMentionId: mention.id,
          authorHandle: mentionHandle,
        },
      });
      continue;
    }

    const relationshipProfile = relationshipByHandle.get(normalizedAuthor);
    const cooldownUntilMs = relationshipProfile?.cooldownUntil ? Date.parse(relationshipProfile.cooldownUntil) : NaN;
    const isDoNotReply = relationshipProfile?.doNotReply === true;
    const activeRelationshipCooldown = Number.isFinite(cooldownUntilMs) && cooldownUntilMs > Date.now();

    if (isDoNotReply || activeRelationshipCooldown) {
      if (!storedTweetIds.has(String(mention.id))) {
        await createMention({
          agentId: agent.id,
          author: String(mention.authorName || mention.authorId),
          authorHandle: `@${String(mention.authorUsername || mention.authorId)}`,
          content: mention.text,
          tweetId: mention.id,
          conversationId: mention.conversationId || null,
          inReplyToTweetId: mention.inReplyToTweetId || null,
          engagementLikes: 0,
          engagementRetweets: 0,
          authorFollowers: mention.authorFollowers ?? null,
          createdAt: mention.createdAt,
        });
        storedTweetIds.add(String(mention.id));
      }

      const reason = isDoNotReply
        ? 'Relationship is marked do-not-reply from a prior opt-out.'
        : `Relationship reply cooldown active until ${relationshipProfile?.cooldownUntil}.`;
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: mention.id,
        xTweetId: '',
        content: mention.text,
        format: isDoNotReply ? 'auto_reply_do_not_reply' : 'auto_reply_relationship_cooldown',
        topic: `Suppressed reply to @${mention.authorUsername || mention.authorId}`,
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason,
      });
      continue;
    }

    const optOutReason = getReplyOptOutReason(mention.text);
    if (!optOutReason) {
      replyEligibleMentions.push(mention);
      continue;
    }

    if (!storedTweetIds.has(String(mention.id))) {
      await createMention({
        agentId: agent.id,
        author: String(mention.authorName || mention.authorId),
        authorHandle: `@${String(mention.authorUsername || mention.authorId)}`,
        content: mention.text,
        tweetId: mention.id,
        conversationId: mention.conversationId || null,
        inReplyToTweetId: mention.inReplyToTweetId || null,
        engagementLikes: 0,
        engagementRetweets: 0,
        authorFollowers: mention.authorFollowers ?? null,
        createdAt: mention.createdAt,
      });
      storedTweetIds.add(String(mention.id));
    }

    await upsertRelationshipProfile(agent.id, {
      handle: mentionHandle,
      displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
      mentionId: mention.id,
      topic: 'reply_opt_out',
      outcome: 'rejected',
      rejected: true,
      doNotReply: true,
      cooldownMins: 365 * 24 * 60,
    }).catch(() => null);
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: mention.id,
      xTweetId: '',
      content: mention.text,
      format: 'auto_reply_opt_out',
      topic: `Opt-out from @${mention.authorUsername || mention.authorId}`,
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'skipped',
      reason: `Opt-out honored: ${optOutReason}.`,
    });
    await addLearningSignal(agent.id, {
      xTweetId: mention.id,
      signalType: 'reply_rejected',
      surface: 'autopilot',
      rewardDelta: -0.2,
      reason: `Auto-reply opt-out honored: ${optOutReason}.`,
      inferred: true,
      metadata: {
        policyGate: 'reply_opt_out',
        targetMentionId: mention.id,
        authorHandle: mentionHandle,
      },
    });
  }
  if (replyEligibleMentions.length === 0) return { repliesSent: 0 };

  // Use the full generation context so replies inherit voice directives, negative
  // feedback patterns, and remix preferences — same voice as auto-posts.
  // KV reads are request-cached, so this is effectively free if refillQueue runs later.
  const generationContext = await buildGenerationContext(agent, {
    negativeLimit: 5,
    directiveLimit: 10,
  });
  if (generationContext.learnings?.voiceCorpus?.active !== true) {
    generationContext.learnings = await buildLearnings(agent);
  }
  const { voiceProfile, learnings } = generationContext;
  const analysis = await getAnalysis(agent.id);
  const minReplyValueScore = Math.max(0, Math.min(1, settings.minReplyValueScore ?? 0.58));
  const allScoredMentions = replyEligibleMentions.map((mention) => ({
    mention,
    value: scoreHighValueReply(mention, {
      topics: voiceProfile.topics,
      relationshipHandles: learnings?.topRelationshipHandles || [],
    }),
  }));

  if (settings.highValueReplyMode) {
    const lowValueMentions = allScoredMentions.filter((item) => item.value.score < minReplyValueScore);
    for (const { mention, value } of lowValueMentions) {
      const mentionHandle = `@${mention.authorUsername || mention.authorId}`;
      await storeMentionIfNeeded(agent, mention, storedTweetIds);
      await upsertRelationshipProfile(agent.id, {
        handle: mentionHandle,
        displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
        mentionId: mention.id,
        topic: value.responseStrategy,
        outcome: 'skipped',
      }).catch(() => null);

      const reason = `High-value reply mode skipped mention below ${minReplyValueScore}: value ${value.score}. ${value.reason}`;
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: mention.id,
        xTweetId: '',
        content: mention.text,
        format: 'auto_reply_low_value_gate',
        topic: `Low-value reply to @${mention.authorUsername || mention.authorId}`,
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'skipped',
        reason,
      });
      await addLearningSignal(agent.id, {
        xTweetId: mention.id,
        signalType: 'reply_rejected',
        surface: 'autopilot',
        rewardDelta: -0.06,
        reason,
        inferred: true,
        metadata: {
          qualityGate: 'low_value_reply',
          highValueReplyMode: true,
          replyValueScore: value.score,
          minReplyValueScore,
          replyValueReason: value.reason,
          responseStrategy: value.responseStrategy,
          targetMentionId: mention.id,
          authorHandle: mentionHandle,
        },
      });
    }
  }

  const scoredMentions = allScoredMentions
    .filter((item) => !settings.highValueReplyMode || item.value.score >= minReplyValueScore)
    .sort((a, b) => b.value.score - a.value.score || Date.parse(b.mention.createdAt) - Date.parse(a.mention.createdAt));
  if (settings.highValueReplyMode && scoredMentions.length === 0) {
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'auto_reply_high_value',
      topic: 'mentions',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'skipped',
      reason: `High-value reply mode skipped ${replyEligibleMentions.length} mention${replyEligibleMentions.length === 1 ? '' : 's'} below ${minReplyValueScore}.`,
    });
    return { repliesSent: 0 };
  }
  const maxReplies = Math.min(scoredMentions.length, settings.maxRepliesPerRun || 3);
  const deferredMentions = scoredMentions.slice(maxReplies);
  if (deferredMentions.length > 0) {
    for (const { mention } of deferredMentions) {
      await storeMentionIfNeeded(agent, mention, storedTweetIds);
    }
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'auto_reply_backlog',
      topic: 'mentions',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'skipped',
      reason: `Stored ${deferredMentions.length} fetched mention${deferredMentions.length === 1 ? '' : 's'} beyond maxRepliesPerRun=${maxReplies} so they remain eligible on a later run.`,
    });
  }

  let repliesSent = 0;
  let lastReplyCheckedAt: string | null = null;
  const contextTweets = Array.isArray(generationContext.allTweets) ? generationContext.allTweets : [];

  // Iterate the full ranked list and count actual replies against the budget:
  // a mention skipped by a gate must not burn a budget slot, or one hot
  // conversation in the top slots can waste the whole run.
  for (const scored of scoredMentions) {
    if (repliesSent >= maxReplies) break;
    const { mention } = scored;
    let replyContent = '';
    let replyCandidate: RankedProtocolTweet | null = null;
    let replyArtifact: Tweet | null = contextTweets.find((tweet) => (
      tweet.pipelineVersion === 'v2'
      && tweet.generationSurface === 'reply'
      && tweet.generationTriggerId === String(mention.id)
      && tweet.status === 'queued'
    )) || null;
    const mentionHandle = `@${mention.authorUsername || mention.authorId}`;
    try {
      if (mention.conversationId && repliedConversationIds.has(String(mention.conversationId))) {
        await storeMentionIfNeeded(agent, mention, storedTweetIds);
        const reason = `Conversation reply gate: already sent ${MAX_AUTO_REPLIES_PER_CONVERSATION} auto-reply in this conversation.`;
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: mention.id,
          xTweetId: '',
          content: mention.text,
          format: 'auto_reply_thread_depth_gate',
          topic: `Reply to @${mention.authorUsername || mention.authorId}`,
          postedAt: new Date().toISOString(),
          source: 'autopilot',
          action: 'skipped',
          reason,
        });
        // A conversation-level cap is not a judgment about this author: do not
        // mark their relationship rejected, apply a 24h cooldown, or emit a
        // negative learning signal for merely replying in an already-answered
        // thread. The skip is logged above; the mention stays stored.
        continue;
      }

      await upsertRelationshipProfile(agent.id, {
        handle: mentionHandle,
        displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
        mentionId: mention.id,
        topic: scored.value.responseStrategy,
        outcome: 'skipped',
      }).catch(() => null);

      // Store the mention if not already stored
      if (!storedTweetIds.has(String(mention.id))) {
        await createMention({
          agentId: agent.id,
          author: String(mention.authorName || mention.authorId),
          authorHandle: `@${String(mention.authorUsername || mention.authorId)}`,
          content: mention.text,
          tweetId: mention.id,
          conversationId: mention.conversationId || null,
          inReplyToTweetId: mention.inReplyToTweetId || null,
          engagementLikes: 0,
          engagementRetweets: 0,
          authorFollowers: mention.authorFollowers ?? null,
          createdAt: mention.createdAt,
        });
      }

      // Check thread depth — skip if we've already gone N rounds
      const maxDepth = MAX_AUTO_REPLIES_PER_CONVERSATION;
      if (mention.conversationId) {
        const convoHistory = await getConversationHistory(agent.id, mention.conversationId, 10);
        const ourReplies = convoHistory.filter((t) => t.role === 'us');
        if (ourReplies.length >= maxDepth) {
          const reason = `Thread depth gate: already sent ${ourReplies.length} replies in this conversation; max is ${maxDepth}.`;
          await addPostLogEntry(agent.id, {
            agentId: agent.id,
            tweetId: mention.id,
            xTweetId: '',
            content: mention.text,
            format: 'auto_reply_thread_depth_gate',
            topic: `Reply to @${mention.authorUsername || mention.authorId}`,
            postedAt: new Date().toISOString(),
            source: 'autopilot',
            action: 'skipped',
            reason,
          });
          await upsertRelationshipProfile(agent.id, {
            handle: mentionHandle,
            displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
            mentionId: mention.id,
            topic: scored.value.responseStrategy,
            outcome: 'rejected',
            rejected: true,
            cooldownMins: 24 * 60,
          }).catch(() => null);
          await addLearningSignal(agent.id, {
            xTweetId: mention.id,
            signalType: 'reply_rejected',
            surface: 'autopilot',
            rewardDelta: -0.18,
            reason,
            inferred: true,
            metadata: {
              qualityGate: 'thread_depth',
              highValueReplyMode: settings.highValueReplyMode === true,
              replyValueScore: scored.value.score,
              targetMentionId: mention.id,
              conversationId: mention.conversationId,
              ourReplies: ourReplies.length,
              maxDepth,
            },
          });
          continue;
        }
      }

      // Get conversation history for thread-aware replies
      const conversationHistory = mention.conversationId
        ? await getConversationHistory(agent.id, mention.conversationId, 5)
        : [];

      // Walk up the reply chain to get FULL thread context, not just the immediate parent.
      // This is critical for understanding what the conversation is actually about.
      let parentContext: string | null = null;
      if (mention.inReplyToTweetId) {
        try {
          const { fetchTweetById } = await import('./twitter-client');
          const threadTweets: Array<{ author: string; text: string }> = [];
          let currentTweetId: string | null = mention.inReplyToTweetId;
          let depth = 0;

          // Walk up the reply chain (max 4 levels to bound API calls)
          while (currentTweetId && depth < 4) {
            const tweet = await fetchTweetById(keys, currentTweetId);
            if (!tweet || !tweet.text) break;
            threadTweets.unshift({ author: tweet.authorUsername, text: tweet.text.slice(0, 300) });
            // If this tweet is itself a reply, keep walking up
            currentTweetId = tweet.inReplyToId;
            depth++;
          }

          // Also prepend any conversation history we have from stored mentions
          if (conversationHistory.length > 0) {
            const historyContext = conversationHistory
              .map((t) => `${t.role === 'us' ? `@${agent.handle}` : t.author}: "${t.content.slice(0, 200)}"`)
              .join('\n');
            parentContext = historyContext + '\n' + threadTweets.map((t) => `@${t.author}: "${t.text}"`).join('\n');
          } else {
            parentContext = threadTweets.map((t) => `@${t.author}: "${t.text}"`).join('\n');
          }

          if (!parentContext.trim()) parentContext = null;
        } catch { /* non-critical */ }
      }

      if (replyArtifact) {
        replyContent = replyArtifact.content;
      } else {
        replyCandidate = await generateReply(
          agent,
          generationContext,
          analysis,
          mention,
          conversationHistory,
          parentContext,
          entitlement,
        );
        replyContent = replyCandidate?.content || '';
      }

      if (!replyContent) {
        const reason = 'Auto-reply generation returned an empty reply, so this mention was marked handled instead of retried.';
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: mention.id,
          xTweetId: '',
          content: mention.text,
          format: 'auto_reply_empty_generation',
          topic: `Reply to @${mention.authorUsername || mention.authorId}`,
          postedAt: new Date().toISOString(),
          source: 'autopilot',
          action: 'skipped',
          reason,
        });
        await upsertRelationshipProfile(agent.id, {
          handle: mentionHandle,
          displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
          mentionId: mention.id,
          topic: scored.value.responseStrategy,
          outcome: 'rejected',
          rejected: true,
          cooldownMins: 24 * 60,
        }).catch(() => null);
        await addLearningSignal(agent.id, {
          xTweetId: mention.id,
          signalType: 'reply_rejected',
          surface: 'autopilot',
          rewardDelta: -0.1,
          reason,
          inferred: true,
          metadata: {
            qualityGate: 'empty_reply_generation',
            highValueReplyMode: settings.highValueReplyMode === true,
            replyValueScore: scored.value.score,
            targetMentionId: mention.id,
            authorHandle: mentionHandle,
          },
        });
        continue;
      }

      const sanitizedIssue = getSanitizedTweetTextIssue(replyContent, 'reply');
      if (sanitizedIssue) {
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: mention.id,
          xTweetId: '',
          content: replyContent,
          format: 'auto_reply_text_gate',
          topic: `Reply to @${mention.authorUsername || mention.authorId}`,
          postedAt: new Date().toISOString(),
          source: 'autopilot',
          action: 'skipped',
          reason: sanitizedIssue,
        });
        await upsertRelationshipProfile(agent.id, {
          handle: mentionHandle,
          displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
          mentionId: mention.id,
          topic: scored.value.responseStrategy,
          outcome: 'rejected',
          rejected: true,
          cooldownMins: 24 * 60,
        }).catch(() => null);
        await addLearningSignal(agent.id, {
          xTweetId: mention.id,
          signalType: 'reply_rejected',
          surface: 'autopilot',
          rewardDelta: -0.22,
          reason: `Auto-reply text gate: ${sanitizedIssue}`,
          inferred: true,
          metadata: {
            policyGate: 'sanitized_empty',
            highValueReplyMode: settings.highValueReplyMode === true,
            replyValueScore: scored.value.score,
            targetMentionId: mention.id,
          },
        });
        continue;
      }

      const lengthIssue = getTweetLengthIssue(replyContent, 'reply');
      if (lengthIssue) {
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: mention.id,
          xTweetId: '',
          content: replyContent,
          format: 'auto_reply_length_gate',
          topic: `Reply to @${mention.authorUsername || mention.authorId}`,
          postedAt: new Date().toISOString(),
          source: 'autopilot',
          action: 'skipped',
          reason: lengthIssue,
        });
        await upsertRelationshipProfile(agent.id, {
          handle: mentionHandle,
          displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
          mentionId: mention.id,
          topic: scored.value.responseStrategy,
          outcome: 'rejected',
          rejected: true,
          cooldownMins: 24 * 60,
        }).catch(() => null);
        await addLearningSignal(agent.id, {
          xTweetId: mention.id,
          signalType: 'reply_rejected',
          surface: 'autopilot',
          rewardDelta: -0.24,
          reason: `Auto-reply length gate: ${lengthIssue}`,
          inferred: true,
          metadata: {
            policyGate: 'x_text_limit',
            highValueReplyMode: settings.highValueReplyMode === true,
            replyValueScore: scored.value.score,
            targetMentionId: mention.id,
            generatedLength: replyContent.trim().length,
          },
        });
        continue;
      }

      const previousThreadReplies = conversationHistory
        .filter((turn) => turn.role === 'us')
        .map((turn) => turn.content);
      const repetitionIssue = getReplyRepetitionIssue(replyContent, previousThreadReplies);
      if (repetitionIssue) {
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: mention.id,
          xTweetId: '',
          content: replyContent,
          format: 'auto_reply_repetition_gate',
          topic: `Reply to @${mention.authorUsername || mention.authorId}`,
          postedAt: new Date().toISOString(),
          source: 'autopilot',
          action: 'skipped',
          reason: repetitionIssue,
        });
        await upsertRelationshipProfile(agent.id, {
          handle: mentionHandle,
          displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
          mentionId: mention.id,
          topic: scored.value.responseStrategy,
          outcome: 'rejected',
          rejected: true,
          cooldownMins: 24 * 60,
        }).catch(() => null);
        await addLearningSignal(agent.id, {
          xTweetId: mention.id,
          signalType: 'reply_rejected',
          surface: 'autopilot',
          rewardDelta: -0.3,
          reason: `Auto-reply repetition gate: ${repetitionIssue}`,
          inferred: true,
          metadata: {
            qualityGate: 'reply_repetition',
            highValueReplyMode: settings.highValueReplyMode === true,
            replyValueScore: scored.value.score,
            targetMentionId: mention.id,
            previousThreadReplies: previousThreadReplies.length,
          },
        });
        continue;
      }

      // Output validation — block replies that look like bot commands or injection results
      if (isInjectedReply(replyContent, mention.text)) {
        console.warn(`[autopilot] Blocked injected reply for agent ${agent.id}: "${replyContent.slice(0, 100)}"`);
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: mention.id,
          xTweetId: '',
          content: replyContent,
          format: 'auto_reply_blocked',
          topic: `Blocked injection from @${mention.authorUsername || mention.authorId}`,
          postedAt: new Date().toISOString(),
          source: 'autopilot',
          action: 'skipped',
          reason: 'Prompt injection detected in reply output',
        });
        await upsertRelationshipProfile(agent.id, {
          handle: mentionHandle,
          displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
          mentionId: mention.id,
          topic: 'prompt_injection',
          outcome: 'rejected',
          rejected: true,
          cooldownMins: 24 * 60,
        }).catch(() => null);
        await addLearningSignal(agent.id, {
          xTweetId: mention.id,
          signalType: 'reply_rejected',
          surface: 'autopilot',
          rewardDelta: -0.5,
          reason: 'Auto-reply blocked generated output that looked like a prompt-injection result.',
          inferred: true,
          metadata: {
            policyGate: 'prompt_injection_output',
            highValueReplyMode: settings.highValueReplyMode === true,
            replyValueScore: scored.value.score,
            targetMentionId: mention.id,
            authorHandle: mentionHandle,
          },
        });
        continue;
      }

      if (!replyArtifact) {
        if (!replyCandidate) continue;
        replyArtifact = await createTweetFromGeneratedCandidate(agent.id, replyCandidate, {
          status: 'queued',
          type: 'reply',
          topic: `Reply to @${mention.authorUsername || mention.authorId}`,
          replyConversationId: mention.conversationId || null,
        });
        contextTweets.unshift(replyArtifact);
      }

      const result = await replyToTweet(keys, replyContent, mention.id, { username: agent.handle });
      await updateTweet(replyArtifact.id, {
        status: 'posted',
        xTweetId: result.tweetId,
        postedAt: new Date().toISOString(),
      });

      // Log it
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: mention.id,
        xTweetId: result.tweetId,
        content: replyContent,
        format: settings.highValueReplyMode ? 'auto_reply_high_value' : 'auto_reply',
        topic: `Reply to @${mention.authorUsername || mention.authorId}`,
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        reason: settings.highValueReplyMode
          ? `Value ${scored.value.score}: ${scored.value.reason}`
          : undefined,
      });
      await addLearningSignal(agent.id, {
        xTweetId: result.tweetId,
        signalType: 'reply_posted',
        surface: 'autopilot',
        rewardDelta: settings.highValueReplyMode ? 0.42 : 0.34,
        reason: settings.highValueReplyMode
          ? `High-value auto-reply posted: ${scored.value.reason}`
          : 'Auto-reply posted.',
        metadata: {
          highValueReplyMode: settings.highValueReplyMode === true,
          replyValueScore: scored.value.score,
          replyValueReason: scored.value.reason,
          responseStrategy: scored.value.responseStrategy,
          targetMentionId: mention.id,
        },
      });
      await upsertRelationshipProfile(agent.id, {
        handle: mentionHandle,
        displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
        mentionId: mention.id,
        topic: scored.value.responseStrategy,
        outcome: 'posted',
        replied: true,
        cooldownMins: Math.max(60, settings.replyIntervalMins || 60),
      }).catch(() => null);
      if (mention.conversationId) {
        repliedConversationIds.add(String(mention.conversationId));
      }

      repliesSent++;
    } catch (err) {
      const invalidCredentials = isInvalidTwitterCredentialError(err);
      if (invalidCredentials) {
        await invalidateAgentConnection(agent.id);
      }
      const backoff = invalidCredentials ? null : getTwitterBackoff(err);
      const terminalReplyFailure = !invalidCredentials && !backoff && isTerminalAutoReplyPostError(err);
      const formattedError = formatActionError(err, 'auto_reply', {
        mentionId: mention.id,
        author: `@${mention.authorUsername || mention.authorId}`,
        conversationId: mention.conversationId || undefined,
        preview: mention.text,
      });
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: mention.id,
        xTweetId: '',
        content: replyContent || mention.text,
        format: terminalReplyFailure ? 'auto_reply_terminal_error' : 'auto_reply_error',
        topic: `Reply to @${mention.authorUsername || mention.authorId}`,
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'error',
        reason: `${terminalReplyFailure ? 'Terminal X reply failure — marking this mention handled. ' : ''}${invalidCredentials ? 'X credentials rejected by X. Agent disconnected, reconnect in Settings. ' : ''}${backoff ? `${backoff.kind} — pausing auto-replies ${backoff.description}. ` : ''}${formattedError}`,
      });
      if (terminalReplyFailure) {
        await upsertRelationshipProfile(agent.id, {
          handle: mentionHandle,
          displayName: String(mention.authorName || mention.authorUsername || mention.authorId),
          mentionId: mention.id,
          topic: scored.value.responseStrategy,
          outcome: 'rejected',
          rejected: true,
          cooldownMins: 24 * 60,
        }).catch(() => null);
        await addLearningSignal(agent.id, {
          xTweetId: mention.id,
          signalType: 'reply_rejected',
          surface: 'autopilot',
          rewardDelta: -0.32,
          reason: `Terminal X reply failure: ${formattedError}`,
          inferred: true,
          metadata: {
            policyGate: 'x_terminal_reply_error',
            statusCode: getActionErrorStatusCode(err) ?? null,
            highValueReplyMode: settings.highValueReplyMode === true,
            replyValueScore: scored.value.score,
            targetMentionId: mention.id,
            authorHandle: mentionHandle,
          },
        });
      }
      if (backoff?.pauseUntil) {
        lastReplyCheckedAt = backoff.pauseUntil;
      }
      if (invalidCredentials || backoff) break;
    }
  }

  if (repliesSent > 0) {
    await updateProtocolSettings(agent.id, {
      lastRepliedAt: new Date().toISOString(),
      totalAutoReplied: (settings.totalAutoReplied || 0) + repliesSent,
    });
  }

  return { repliesSent, lastReplyCheckedAt };
}

async function generateReply(
  agent: Agent,
  context: Awaited<ReturnType<typeof buildGenerationContext>>,
  analysis: NonNullable<Awaited<ReturnType<typeof getAnalysis>>>,
  mention: TwitterMention,
  conversationHistory: ConversationTurn[],
  parentContext: string | null,
  entitlement: Awaited<ReturnType<typeof assertAgentAutomationEntitlement>>,
): Promise<RankedProtocolTweet | null> {
  const authorHandle = String(mention.authorUsername || mention.authorId).replace(/^@/, '');
  const targetPost: GenerationEvidenceReference = {
    id: `x-post:${mention.id}`,
    kind: 'target_post',
    sourceDocumentId: null,
    url: authorHandle ? `https://x.com/${authorHandle}/status/${mention.id}` : null,
    title: `Post by @${authorHandle || 'unknown'}`,
    publisher: authorHandle || null,
    content: mention.text,
    publishedAt: mention.createdAt || null,
    verifiedAt: new Date().toISOString(),
    expiresAt: null,
    trustTier: 'community',
  };
  const threadContext: GenerationEvidenceReference[] = conversationHistory.map((turn, index) => ({
    id: `conversation:${mention.conversationId || mention.id}:${index}`,
    kind: 'thread_context',
    sourceDocumentId: null,
    url: null,
    title: turn.role === 'us' ? `Earlier @${agent.handle} reply` : 'Earlier conversation turn',
    publisher: turn.role === 'us' ? agent.handle : turn.author,
    content: turn.content,
    publishedAt: null,
    verifiedAt: new Date().toISOString(),
    expiresAt: null,
    trustTier: 'community',
  }));
  if (parentContext?.trim()) {
    threadContext.push({
      id: `thread-parent:${mention.id}`,
      kind: 'thread_context',
      sourceDocumentId: null,
      url: null,
      title: 'Verified parent thread context',
      publisher: 'X',
      content: parentContext,
      publishedAt: null,
      verifiedAt: new Date().toISOString(),
      expiresAt: null,
      trustTier: 'community',
    });
  }

  const [candidate] = await generatePublishingBatchV2({
    agentId: agent.id,
    count: 1,
    request: {
      surface: 'reply',
      triggerId: String(mention.id),
      targetPost,
      threadContext,
    },
    voiceProfile: context.voiceProfile,
    analysis,
    learnings: context.learnings,
    style: context.style,
    recentPosts: context.recentPosts,
    allTweets: context.allTweets,
    memory: context.memory,
    signals: context.signals,
    trending: null,
    modelStack: PUBLISHING_V2_MODEL_STACK,
    mode: 'live',
    entitlement,
  });
  return candidate || null;
}
// ─── Injection detection ────────────────────────────────────────────────────

/**
 * Detect if a generated reply looks like the result of a prompt injection.
 * Checks for bot commands, suspicious patterns, and content that mirrors
 * the mention's instructions rather than responding to them.
 */
function isInjectedReply(reply: string, mentionText: string): boolean {
  const lower = reply.toLowerCase().trim();
  const mentionLower = mentionText.toLowerCase();

  // Block replies that tag bot accounts with commands
  const botCommandPattern = /@\w+\s+(create|mint|deploy|send|transfer|buy|sell|swap|bridge|launch|airdrop|drop|claim|tip|withdraw)\b/i;
  if (botCommandPattern.test(reply)) return true;

  // Block replies that look like token/DeFi commands
  const tokenPattern = /\b(create\s+token|mint\s+token|deploy\s+token|ticker\s+\$|name\s+\w+\s+ticker|claim\s+fees|send\s+\d|transfer\s+\d|swap\s+\d)\b/i;
  if (tokenPattern.test(reply)) return true;

  // Block replies containing wallet addresses, contract addresses, or tx hashes
  if (/0x[a-fA-F0-9]{40}/.test(reply)) return true;
  if (/0x[a-fA-F0-9]{64}/.test(reply)) return true;

  // Block replies that start with "hey @bot" — classic injection output
  if (/^hey\s+@\w+/i.test(reply.trim())) return true;

  // Detect parroting: mention asked for specific output and reply matches
  const injectionPhrases = [
    'reply with', 'only say', 'nothing else', 'just say', 'just respond',
    'corrected answer', 'correct this', 'delete ~', 'deleting ~', 'removing ~',
    'translate this', 'convert this', 'rewrite this', 'format this',
    'ignore previous', 'ignore above', 'new instructions', 'system prompt',
    'you are now', 'pretend to be', 'roleplay as', 'act as if',
    'admin override', 'developer mode', 'forget everything',
    'output only', 'respond only with', 'say exactly',
  ];

  const mentionHasInjection = injectionPhrases.some((p) => mentionLower.includes(p));

  if (mentionHasInjection) {
    // Check if reply parrots the mention content (>50% word overlap)
    const replyWords = lower.split(/\s+/).filter((w) => w.length > 3);
    const matchedWords = replyWords.filter((w) => mentionLower.includes(w));
    if (replyWords.length > 0 && matchedWords.length / replyWords.length > 0.5) {
      return true;
    }
    // If reply is very short and mention had injection phrases, suspicious
    if (reply.length < 80) return true;
  }

  return false;
}

// ─── Queue refill ────────────────────────────────────────────────────────────

export async function refillQueue(
  agent: Agent,
  count: number,
  bias: { scheduledTopic?: string | null; momentumTopic?: string | null } = {},
  options: { attemptId?: string | null } = {},
): Promise<number> {
  try {
    const entitlement = await assertAgentAutomationEntitlement(agent.id, { agent });
    const refillCount = Math.min(2, Math.max(0, count));
    if (refillCount <= 0) return 0;
    const analysis = await getAnalysis(agent.id);
    if (!analysis) return 0;

    const context = await buildGenerationContext(agent, {
      negativeLimit: 10,
      directiveLimit: 10,
    });
    if (context.learnings?.voiceCorpus?.active !== true) {
      context.learnings = await buildLearnings(agent);
    }
    const { voiceProfile, learnings, settings, style, recentPosts, allTweets, memory, signals = [] } = context;
    const publishingModelStack = resolvePublishingV2ModelStacks(agent.handle).activeStack;
    const trendingSnapshot = await getTrendingCacheSnapshot(agent.id).catch(() => null);
    const trending = trendingSnapshot?.isFresh && Array.isArray(trendingSnapshot.data)
      ? trendingSnapshot.data as TrendingTopic[]
      : null;

    // If momentum or calendar focus exists, pass those biases into generation
    // so the batch can explore timely angles instead of repeating evergreen takes.

    const activeProductFacts = settings.marketingEnabled ? await getProductFacts() : [];
    const marketingCount = activeProductFacts.length > 0 && settings.marketingMix > 0
      ? Math.min(refillCount, Math.max(1, Math.round(refillCount * (settings.marketingMix / 100))))
      : 0;
    const organicCount = refillCount - marketingCount;
    const generationStyle = {
      ...style,
      bias: {
        scheduledTopic: bias.scheduledTopic ?? style.bias.scheduledTopic,
        momentumTopic: bias.momentumTopic ?? style.bias.momentumTopic,
      },
    };

    const queueFingerprint = allTweets
      .filter((tweet) => tweet.status === 'queued' && !tweet.quarantinedAt)
      .map((tweet) => tweet.id)
      .sort()
      .join(',') || 'empty';
    const attemptId = String(options.attemptId || '').trim().slice(0, 160);
    const refillTrigger = `refill:${trendingSnapshot?.cachedAt || 'no-research'}:${Math.floor(Date.now() / (2 * 60 * 60 * 1000))}:queue:${queueFingerprint}${attemptId ? `:attempt:${attemptId}` : ''}`;
    const batch = organicCount <= 0
      ? []
      : await generatePublishingBatchV2({
          agentId: agent.id,
          count: organicCount,
          request: { surface: 'original', triggerId: refillTrigger },
          voiceProfile,
          analysis,
          learnings,
          style: generationStyle,
          recentPosts,
          allTweets,
          memory,
          signals,
          trending,
          modelStack: publishingModelStack,
          mode: 'live',
          allowQualityRetry: Boolean(attemptId),
          entitlement,
        });
    const productEvidence: GenerationEvidenceReference[] = activeProductFacts.map((fact) => ({
      id: `product-fact:${fact.id}:v${fact.version}`,
      kind: 'product_fact',
      sourceDocumentId: null,
      url: fact.provenanceUrl,
      title: fact.provenanceLabel,
      publisher: 'Clawfable operator',
      content: fact.statement,
      publishedAt: fact.createdAt,
      verifiedAt: fact.verifiedAt,
      expiresAt: fact.expiresAt,
      trustTier: 'primary',
    }));
    const marketingBatch = marketingCount > 0
      ? await generatePublishingBatchV2({
          agentId: agent.id,
          count: marketingCount,
          request: {
            surface: 'marketing',
            triggerId: `marketing:${activeProductFacts.map((fact) => `${fact.id}:v${fact.version}`).join(',')}:${Math.floor(Date.now() / (2 * 60 * 60 * 1000))}`,
            productFacts: productEvidence,
          },
          voiceProfile,
          analysis,
          learnings,
          style: generationStyle,
          recentPosts,
          allTweets,
          memory,
          signals,
          trending: null,
          modelStack: publishingModelStack,
          mode: 'live',
          allowQualityRetry: Boolean(attemptId),
          entitlement,
        })
      : [];
    const allBatch = [...batch, ...marketingBatch];

    // Only copy that reached a committed lifecycle state can block a refill.
    // Quarantined and unreviewed artifacts are failed attempts, not editorial memory.
    const recentContent = getCommittedTweetCopyMemoryV2(allTweets, { limit: 50 });
    const operatorEvidence = [
      ...(learnings?.operatorVoiceReference?.pinnedExamples || []),
      ...(learnings?.operatorVoiceReference?.startupRegisterExamples || []),
      ...(learnings?.operatorVoiceReference?.bestPerformers || []),
    ].map((entry) => entry.content);
    const contentMixHistory = [...allTweets];

    const addBatchItems = async (items: typeof allBatch): Promise<number> => {
      let addedFromBatch = 0;
      const traceCache = new Map<string, GenerationRunTrace>();
      const recordQueueDecision = async (
        item: RankedProtocolTweet,
        outcome: 'persisted' | 'rejected' | 'deferred',
        rejectionCode: string | null = null,
        options: { persistedToQueue?: boolean } = {},
      ) => {
        const runId = item.generationRunId;
        if (!runId) return;
        let trace = traceCache.get(runId);
        if (!trace) {
          trace = (await getGenerationRuns(agent.id, 50)).find((run) => run.id === runId);
          if (!trace) return;
        }
        const persistedToQueue = outcome === 'persisted' || (outcome === 'deferred' && options.persistedToQueue === true);
        const stageCounts = {
          ...trace.stageCounts,
          queueCandidatesEvaluated: (trace.stageCounts.queueCandidatesEvaluated || 0) + 1,
          queueCandidatesPersisted: (trace.stageCounts.queueCandidatesPersisted || 0) + (persistedToQueue ? 1 : 0),
          queueCandidatesRejected: (trace.stageCounts.queueCandidatesRejected || 0) + (outcome === 'rejected' ? 1 : 0),
          queueCandidatesDeferred: (trace.stageCounts.queueCandidatesDeferred || 0) + (outcome === 'deferred' ? 1 : 0),
        };
        const rejectionCounts = { ...trace.rejectionCounts };
        if (outcome === 'rejected' && rejectionCode) {
          const key = `queue_${rejectionCode}`;
          rejectionCounts[key] = (rejectionCounts[key] || 0) + 1;
        }
        trace = { ...trace, stageCounts, rejectionCounts };
        traceCache.set(runId, trace);
        await saveGenerationRun(agent.id, trace);
      };
      const rejectCandidate = async (
        item: RankedProtocolTweet,
        code: string,
        detail: string | null = null,
      ) => {
        await Promise.allSettled([
          addPostLogEntry(agent.id, {
            agentId: agent.id,
            tweetId: '',
            xTweetId: '',
            content: item.content,
            format: 'refill_candidate_rejected',
            topic: item.targetTopic || 'generation',
            postedAt: new Date().toISOString(),
            source: 'autopilot',
            action: 'skipped',
            reason: detail ? `${code}: ${detail}` : code,
            runId: item.generationRunId || undefined,
            draftCandidateId: item.draftCandidateId || undefined,
            model: item.finalCriticModel || item.judgeModel || item.generationModel || undefined,
            qualityPolicyVersion: item.qualityPolicyVersion || undefined,
          }),
          recordQueueDecision(item, 'rejected', code),
        ]);
      };
      for (const item of items) {
        if (item.pipelineVersion !== 'v2' || !item.generationRunId || !item.ideaId || !item.draftCandidateId) {
          await rejectCandidate(item, 'missing_v2_provenance');
          continue;
        }
        const originIssue = getGeneratedPublishIssue(item, { accountHandle: agent.handle });
        if (originIssue) {
          await rejectCandidate(item, 'generated_publish_issue', originIssue);
          continue;
        }
        const accountTopicIssue = getAccountTopicPolicyIssue(
          agent.handle,
          `${item.targetTopic || ''} ${item.content}`,
          null,
          item.portfolioCompanyContext,
        );
        if (accountTopicIssue) {
          await rejectCandidate(item, 'account_topic_blocked', accountTopicIssue);
          continue;
        }
        const companyAmplificationIssue = getGeoffreyCompanyAmplificationIssue(
          agent.handle,
          `${item.targetTopic || ''} ${item.content}`,
        );
        if (companyAmplificationIssue) {
          await rejectCandidate(item, 'company_amplification_policy', companyAmplificationIssue);
          continue;
        }
        const portfolioCompanyIssue = isGeoffreyAccount(agent.handle) || item.portfolioCompanyContext
          ? getAntiFundPortfolioPolicyIssue(item.content, item.portfolioCompanyContext)
          : null;
        if (portfolioCompanyIssue) {
          await rejectCandidate(item, 'portfolio_company_policy', portfolioCompanyIssue);
          continue;
        }
        const autonomousPromotionIssue = isGeoffreyAccount(agent.handle)
          ? getAntiFundAutonomousPromotionPolicyIssue(item.portfolioCompanyContext)
          : null;
        if (autonomousPromotionIssue) {
          await rejectCandidate(item, 'portfolio_promotion_priority_policy', autonomousPromotionIssue);
          continue;
        }
        const entityMentionIssue = getCuratedEntityMentionPolicyIssue(item.content);
        if (entityMentionIssue) {
          await rejectCandidate(item, 'entity_mention_policy', entityMentionIssue);
          continue;
        }
        const completenessIssue = getTweetCompletenessIssue(item.content);
        if (completenessIssue) {
          await rejectCandidate(item, 'incomplete_copy', completenessIssue);
          continue;
        }
        const policyIssue = getAutopostPolicyIssue(item.content, {
          allowedMentions: [
            agent.handle,
            ...(item.allowedMentionHandles || []),
            ...usedCuratedVerifiedMentionHandles(item.content),
          ],
        });
        if (policyIssue) {
          await rejectCandidate(item, 'autopost_policy', policyIssue);
          continue;
        }
        const authorityIssue = getAuthorityProofIssue(item.content);
        if (authorityIssue) {
          await rejectCandidate(item, 'unearned_authority', authorityIssue);
          continue;
        }
        const claimEvidenceIssue = assessClaimEvidence(
          item.content,
          getTrustedClaimSourceTexts(item, operatorEvidence),
          { allowForecastTimingNumbers: true },
        ).issue;
        if (claimEvidenceIssue) {
          await rejectCandidate(item, 'claim_evidence', claimEvidenceIssue);
          continue;
        }
        if (isNearDuplicate(item.content, recentContent, 0.55).isDuplicate) {
          await rejectCandidate(item, 'recent_copy_duplicate');
          continue;
        }
        if (recentContent.some((content) => semanticIdeaSimilarity(
          { content: item.content, topic: item.targetTopic },
          { content },
        ) >= QUEUE_SEMANTIC_DUPLICATE_THRESHOLD)) {
          await rejectCandidate(item, 'recent_semantic_duplicate');
          continue;
        }
        const contentMixDecision = isGeoffreyAccount(agent.handle)
          ? getGeoffreyContentMixDecision({
            content: item.content,
            targetTopic: item.targetTopic,
            portfolioCompanyContext: item.portfolioCompanyContext,
          }, contentMixHistory)
          : null;
        if (contentMixDecision?.issue) {
          // A content-mix block is a scheduling window, not a content defect,
          // so a critic-approved draft is held rather than discarded. When no
          // queued draft holds the slot yet it is queued as the slot-holder
          // and the tick defers it until the window clears; when another
          // queued draft already reserves the slot it is kept as a draft so
          // the queue never fills with company-led holds.
          const holdStatus = isGeoffreyContentMixQueueSlotReserved(contentMixDecision) ? 'draft' : 'queued';
          const heldTweet = await createTweetFromGeneratedCandidate(agent.id, item, {
            status: holdStatus,
            topic: item.targetTopic,
          });
          contentMixHistory.push(heldTweet);
          recentContent.unshift(item.content);
          await Promise.allSettled([
            addPostLogEntry(agent.id, {
              agentId: agent.id,
              tweetId: heldTweet.id,
              xTweetId: '',
              content: item.content,
              format: 'refill_candidate_deferred',
              topic: item.targetTopic || 'generation',
              postedAt: new Date().toISOString(),
              source: 'autopilot',
              action: 'skipped',
              reason: `company_content_mix_policy: ${contentMixDecision.issue} ${holdStatus === 'queued'
                ? 'Queued as the slot-holder; autopilot defers it until the window clears.'
                : 'Held as a draft because another queued draft already reserves the slot.'}`,
              runId: item.generationRunId || undefined,
              draftCandidateId: item.draftCandidateId || undefined,
              model: item.finalCriticModel || item.judgeModel || item.generationModel || undefined,
              qualityPolicyVersion: item.qualityPolicyVersion || undefined,
            }),
            recordQueueDecision(item, 'deferred', null, { persistedToQueue: holdStatus === 'queued' }),
          ]);
          if (holdStatus === 'queued') addedFromBatch++;
          continue;
        }
        recentContent.unshift(item.content);
        const persistedTweet = await createTweetFromGeneratedCandidate(agent.id, item, {
          status: 'queued',
          topic: item.targetTopic,
        });
        contentMixHistory.push(persistedTweet);
        await recordQueueDecision(item, 'persisted').catch(() => null);
        addedFromBatch++;
      }
      return addedFromBatch;
    };

    return await addBatchItems(allBatch);
  } catch (err) {
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'refill_queue_error',
      topic: 'generation',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'error',
      reason: formatActionError(err, 'refill_queue', {
        handle: `@${agent.handle}`,
      }),
    }).catch(() => null);
    return 0;
  }
}
