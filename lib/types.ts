import type { SetupStep } from './setup-state';

// ─── User types ──────────────────────────────────────────────────────────────

export type BillingPlan = 'free' | 'pro' | 'scale';
export type BillingStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

export interface BillingEntitlements {
  maxAgents: number;
  autopilot: boolean;
  advancedLearning: boolean;
  prioritySupport: boolean;
}

export interface BillingSummary {
  configured: boolean;
  checkoutReady: boolean;
  portalReady: boolean;
  plan: BillingPlan;
  status: BillingStatus;
  label: string;
  isPaid: boolean;
  grandfathered: boolean;
  agentCount: number;
  maxAgents: number;
  agentsRemaining: number;
  canCreateAgent: boolean;
  canUseAutopilot: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingEmail: string | null;
  currentPeriodEnd: string | null;
  entitlements: BillingEntitlements;
}

export interface User {
  id: string;          // X user ID
  username: string;    // X screen name
  name: string;        // X display name
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingEmail: string | null;
  billingStatus: BillingStatus;
  plan: BillingPlan;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export interface Session {
  userId: string;
  createdAt: string;
}

// ─── Core domain types ────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  handle: string;
  name: string;
  soulMd: string;
  soulSummary: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  accessToken: string | null;
  accessSecret: string | null;
  isConnected: number; // 0 | 1
  xUserId: string | null;
  soulPublic: number; // 0 | 1, default 1 (open source)
  setupStep: SetupStep;
  createdAt: string;
}

export interface AgentSummary {
  id: string;
  handle: string;
  name: string;
  soulSummary: string | null;
  soulMdPreview: string;
  isConnected: number;
  xUserId: string | null;
  setupStep: SetupStep;
  createdAt: string;
  tweetCount: number;
  mentionCount: number;
}

export interface AgentDetail {
  id: string;
  handle: string;
  name: string;
  soulMd: string;
  soulSummary: string | null;
  isConnected: number;
  xUserId: string | null;
  soulPublic: number;
  setupStep: SetupStep;
  createdAt: string;
  hasKeys: boolean;
  connectionStatusNote?: {
    reason: string;
    occurredAt: string;
  } | null;
}

export type AutonomyMode = 'safe' | 'balanced' | 'explore';
export type TweetStatus = 'preview' | 'draft' | 'queued' | 'posted' | 'deleted_from_x';
export type MetricAvailabilityStatus =
  | 'available'
  | 'not_connected'
  | 'waiting_for_cron'
  | 'metric_unavailable'
  | 'no_posts_yet'
  | 'no_data_in_window';

export interface MetricAvailability {
  metricName: string;
  status: MetricAvailabilityStatus;
  reason: string;
  checkedAt: string;
}
export type TweetHookType =
  | 'question'
  | 'bold_claim'
  | 'data_point'
  | 'story'
  | 'observation'
  | 'contrarian'
  | 'listicle'
  | 'callout'
  | 'prediction'
  | 'confession'
  | 'how_to'
  | 'unknown';
export type TweetToneType =
  | 'sarcastic'
  | 'earnest'
  | 'analytical'
  | 'provocative'
  | 'educational'
  | 'casual'
  | 'urgent'
  | 'playful'
  | 'unknown';
export type TweetSpecificityType =
  | 'abstract'
  | 'concrete'
  | 'data_driven'
  | 'tactical'
  | 'story_led'
  | 'unknown';
export type TweetStructureType =
  | 'single_punch'
  | 'stacked_lines'
  | 'argument'
  | 'story_arc'
  | 'list'
  | 'question_led'
  | 'comparison'
  | 'manifesto'
  | 'unknown';

export interface CandidateFeatureTags {
  hook: TweetHookType;
  tone: TweetToneType;
  specificity: TweetSpecificityType;
  structure: TweetStructureType;
  thesis: string;
  riskFlags: string[];
  domainTags?: string[];
  technicalDepth?: number;
  statusTextureRisk?: number;
}

export interface CandidateJudgeBreakdown {
  overall: number;
  voiceFit: number;
  clarity: number;
  novelty: number;
  audienceFit: number;
  policySafety: number;
}

export interface CandidateCriticScores {
  voice: number;
  audience: number;
  novelty: number;
  slop: number;
  factualRisk: number;
  replyPotential: number;
}

export interface CriticVerdict {
  id: string;
  agentId: string;
  tweetId: string;
  action: 'allow' | 'review' | 'block';
  score: number;
  reasons: string[];
  genericness: number;
  overclaiming: number;
  cringe: number;
  voiceDrift: number;
  factualRisk: number;
  engagementBait: number;
  replySuitability: number;
  createdAt: string;
}

export interface CandidateScoreProvenance {
  localPrior: number;
  globalPrior: number;
  judge: number;
  predictedReward: number;
  noveltyCoverage: number;
  riskPenalty: number;
  creativity?: number;
  holdout?: number;
  antiSlop?: number;
  technicalElevation?: number;
  banalOpsTexture?: number;
  nativeVoice?: number;
  technicalCredibility?: number;
  cringeRisk?: number;
  statusTextureRisk?: number;
  truthfulnessRisk?: number;
  generatedPatternRisk?: number;
  patternReuseRisk?: number;
  authorityProof?: number;
  audienceSegment?: number;
  promptStrategy?: number;
  portfolio?: number;
  portfolioDiversity?: number;
  mediaExperiment?: number;
  relationship?: number;
  ideaGraph?: number;
  memoryAlignment?: number;
  outcomeCalibration?: number;
  conversationQuality?: number;
  formulaicCadence?: number;
  operatorAnchor?: number;
  operatorAnchorOutcome?: number;
  fallbackShapeOutcome?: number;
  anchorCopyRisk?: number;
  phraseReuseRisk?: number;
  approvalFriction?: number;
  rejectionLesson?: number;
  tasteCalibration?: number;
  learnedReviewCaution?: number;
}

export interface RewardBreakdown {
  approval: number;
  editBurden: number;
  deletionPenalty: number;
  postingOutcome: number;
  copySignal: number;
  replyOutcome: number;
  timeToApproval: number;
  engagementLift: number;
  immediateTotal: number;
  delayedTotal: number;
  total: number;
  computedAt: string;
  notes: string[];
  actionRewards?: ActionRewardBreakdown;
}

export interface ActionRewardBreakdown {
  likeReward: number;
  replyReward: number;
  repostReward: number;
  impressionReward: number;
  engagementRateReward: number;
  profileClickReward: number;
  followReward: number;
  highQualityReplyReward?: number;
  relationshipReward?: number;
  targetAudienceReward?: number;
  bookmarkProxyReward?: number;
  cringeRiskPenalty?: number;
  qualityAdjustedGrowthScore?: number;
  qualityAdjustedGrowthReward?: number;
  negativeFeedbackRisk: number;
  total: number;
}

export type ContentSourceLane =
  | 'manual_core_exploit'
  | 'trend_aligned_exploit'
  | 'trend_adjacent_explore'
  | 'core_explore_fallback';

export type ContentStyleMode = 'standard' | 'shitpoast';

export type TrendTolerance = 'adjacent' | 'moderate' | 'aggressive';

export type CreativeLane =
  | 'operator_take'
  | 'contrarian_angle'
  | 'story_example'
  | 'teaching_threadlet'
  | 'weird_memetic'
  | 'trend_riff';

export type AudienceSegment =
  | 'founders'
  | 'ai_builders'
  | 'biohackers'
  | 'investors'
  | 'creator_operators'
  | 'technical_operators'
  | 'reply_regulars'
  | 'generalists';

export type PromptStrategy =
  | 'baseline'
  | 'high_specificity'
  | 'contrarian'
  | 'story'
  | 'weird'
  | 'trend_riff'
  | 'reply_bait';

export type MediaExperimentType =
  | 'text_only'
  | 'image'
  | 'video'
  | 'screenshot'
  | 'meme';

export type PostPortfolioRole =
  | 'proof'
  | 'contrarian'
  | 'story'
  | 'reply_bait'
  | 'trend'
  | 'media'
  | 'relationship';

export type PerformanceCheckpoint =
  | 'initial_15m'
  | 'early_30m'
  | 'momentum_2h'
  | 'full_24h'
  | 'late';

export type DraftExperimentStatus =
  | 'generated'
  | 'approved'
  | 'edited'
  | 'posted'
  | 'rejected'
  | 'deleted'
  | 'measured';

export interface Tweet {
  id: string;
  agentId: string;
  content: string;
  originalContent?: string | null;
  type: string; // original | reply | quote
  status: TweetStatus;
  format: string | null;  // hot_take | question | data_point | short_punch | long_form | analysis | observation
  topic: string | null;
  xTweetId: string | null;
  quoteTweetId: string | null;  // X tweet ID to quote (for QTs)
  quoteTweetAuthor: string | null;
  scheduledAt: string | null;
  deletionReason: string | null;  // why the operator deleted this from X
  editCount?: number;
  lastEditedAt?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  rationale?: string | null;
  generationProvider?: 'openai' | 'anthropic' | 'local' | null;
  generationModel?: string | null;
  sourceBrief?: string | null;
  generationMode?: AutonomyMode | null;
  candidateScore?: number | null;
  confidenceScore?: number | null;
  voiceScore?: number | null;
  noveltyScore?: number | null;
  predictedEngagementScore?: number | null;
  freshnessScore?: number | null;
  repetitionRiskScore?: number | null;
  policyRiskScore?: number | null;
  surpriseScore?: number | null;
  creativeRiskScore?: number | null;
  slopScore?: number | null;
  replyBaitScore?: number | null;
  hookType?: TweetHookType | null;
  toneType?: TweetToneType | null;
  specificityType?: TweetSpecificityType | null;
  structureType?: TweetStructureType | null;
  thesis?: string | null;
  coverageCluster?: string | null;
  featureTags?: CandidateFeatureTags | null;
  judgeScore?: number | null;
  judgeBreakdown?: CandidateJudgeBreakdown | null;
  judgeNotes?: string | null;
  mutationRound?: number | null;
  rewardPrediction?: number | null;
  globalPriorWeight?: number | null;
  localPriorWeight?: number | null;
  scoreProvenance?: CandidateScoreProvenance | null;
  decisionSummary?: string | null;
  learningAdjustmentSummary?: string | null;
  rewardBreakdown?: RewardBreakdown | null;
  sourceLane?: ContentSourceLane | null;
  styleMode?: ContentStyleMode | null;
  creativeLane?: CreativeLane | null;
  targetAudienceSegment?: AudienceSegment | null;
  segmentHypothesis?: string | null;
  promptStrategy?: PromptStrategy | null;
  mediaExperimentType?: MediaExperimentType | null;
  mediaBrief?: string | null;
  portfolioRole?: PostPortfolioRole | null;
  relationshipTargetHandle?: string | null;
  followupForTweetId?: string | null;
  replyConversationId?: string | null;
  followupTrigger?: string | null;
  trendFitScore?: number | null;
  criticScores?: CandidateCriticScores | null;
  actionRewardPrediction?: ActionRewardBreakdown | null;
  draftExperimentId?: string | null;
  experimentBatchId?: string | null;
  experimentHypothesis?: string | null;
  experimentHoldout?: boolean | null;
  promptVariant?: string | null;
  trendTopicId?: string | null;
  trendHeadline?: string | null;
  quarantineReason?: string | null;
  quarantinedAt?: string | null;
  createdAt: string;
}

export interface Mention {
  id: string;
  agentId: string;
  author: string;
  authorHandle: string;
  content: string;
  tweetId: string | null;
  conversationId: string | null;
  inReplyToTweetId: string | null;
  engagementLikes: number;
  engagementRetweets: number;
  createdAt: string;
}

export interface Metric {
  id: string;
  agentId: string;
  metricName: string;
  value: number;
  date: string;
  availability?: MetricAvailability;
}

export type OutcomeEventType =
  | 'generated'
  | 'queued'
  | 'posted'
  | 'edited'
  | 'deleted'
  | 'metric_checkpoint'
  | 'calibration_labeled'
  | 'auto_replied'
  | 'skipped'
  | 'reply_outcome'
  | LearningSignalType;

export interface OutcomeEvent {
  id: string;
  agentId: string;
  eventType: OutcomeEventType;
  source: 'tweet' | 'learning_signal' | 'cron' | 'manual' | 'autopilot' | 'metrics';
  tweetId?: string;
  xTweetId?: string;
  idempotencyKey: string;
  rewardDelta?: number;
  reason?: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface AutopilotRunPhase {
  runId: string;
  agentId: string;
  phase: string;
  status: 'started' | 'succeeded' | 'skipped' | 'failed';
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  reason?: string;
  model?: string;
  errorCode?: string;
}

export interface RelationshipProfile {
  handle: string;
  agentId: string;
  displayName: string | null;
  lastMentionId: string | null;
  lastInteractionAt: string;
  topics: string[];
  relationshipScore: number;
  interactions: number;
  repliesSent: number;
  repliesRejected: number;
  cooldownUntil: string | null;
  doNotReply: boolean;
  lastOutcome: 'posted' | 'rejected' | 'skipped' | null;
  updatedAt: string;
}

export interface IdeaAtom {
  id: string;
  agentId: string;
  claim: string;
  tension: string | null;
  audience: AudienceSegment | null;
  proof: string | null;
  example: string | null;
  riskNote: string | null;
  topic: string | null;
  sourceTweetId: string | null;
  lastUsedAt: string | null;
  performance: {
    generated: number;
    queued: number;
    posted: number;
    rejected: number;
    avgReward: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

// ─── Create / update input types ─────────────────────────────────────────────

export type CreateAgentInput = Omit<Agent, 'id' | 'createdAt' | 'soulPublic'> & { soulPublic?: number };
export type UpdateAgentInput = Partial<Omit<Agent, 'id' | 'createdAt'>>;

export type CreateTweetInput = Omit<Tweet, 'id' | 'createdAt' | 'format' | 'deletionReason'> & { format?: string | null; deletionReason?: string | null };
export type UpdateTweetInput = Partial<Omit<Tweet, 'id' | 'agentId' | 'createdAt'>>;

export type CreateMentionInput = Omit<Mention, 'id' | 'createdAt' | 'conversationId' | 'inReplyToTweetId'> & { createdAt?: string; conversationId?: string | null; inReplyToTweetId?: string | null };

export interface MetricInput {
  agentId: string;
  metricName: string;
  value: number;
  date: string;
}

// ─── Account analysis types ─────────────────────────────────────────────────

export interface ViralTweet {
  id: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  engagementRate: number;
  createdAt: string;
}

export interface EngagementPattern {
  avgLikes: number;
  avgRetweets: number;
  avgReplies: number;
  avgImpressions: number;
  topHours: number[];       // hours of day with highest engagement
  topFormats: string[];     // e.g. 'hot_take', 'thread_hook', 'question', 'data_point'
  topTopics: string[];      // extracted topic clusters
  viralThreshold: number;   // likes count that defines "viral" for this account
}

export interface FollowingProfile {
  totalFollowing: number;
  topAccounts: Array<{ username: string; name: string; description: string; followersCount: number }>;
  categories: Array<{ label: string; count: number; handles: string[] }>;
}

// ─── Autopilot types ─────────────────────────────────────────────────────────

export interface ProtocolSettings {
  enabled: boolean;
  postsPerDay: number;        // 1-24
  activeHoursStart: number;   // legacy, unused
  activeHoursEnd: number;     // legacy, unused
  minQueueSize: number;       // auto-generate when queue drops below this
  autoReply: boolean;         // auto-reply to new mentions
  highValueReplyMode?: boolean; // only reply when a mention gives the agent something valuable to add
  minReplyValueScore?: number;  // 0-1 threshold for high-value reply mode
  earlyVelocityFollowups?: boolean; // create supervised follow-up drafts when a post is taking off
  supervisedTrendDesk?: boolean;    // collect trend opportunities without auto-posting unsafe trend spam
  relationshipQueueEnabled?: boolean; // surface high-value accounts to reply to or study
  portfolioOptimizerEnabled?: boolean; // balance proof, story, contrarian, trend, media, and reply-bait roles
  mediaExperimentRate?: number; // 0-100, target share of drafts that carry a visual/media brief
  maxRepliesPerRun: number;   // max replies per cron run (1-10)
  replyIntervalMins: number;  // minimum minutes between reply runs
  lastPostedAt: string | null;
  postCooldownUntil?: string | null;
  lastRepliedAt: string | null;
  lastReplyCheckedAt?: string | null;
  totalAutoPosted: number;
  totalAutoReplied: number;
  // Content style controls
  lengthMix: {
    short: number;   // 0-100, percentage for <200 chars
    medium: number;  // 0-100, percentage for 200-500 chars
    long: number;    // 0-100, percentage for 500+ chars
  };
  autonomyMode: AutonomyMode; // safe = higher confidence, explore = learn faster
  explorationRate: number;    // 0-100, percentage of batch reserved for exploratory ideas
  trendMixTarget?: number;    // 0-100, target share of trend-led slots
  trendTolerance?: TrendTolerance; // how far from core voice trend exploration may go
  shitpoastEnabled?: boolean;  // capped high-chaos style experiments
  enabledFormats: string[];  // which formats to use, empty = all
  qtRatio: number;           // legacy, currently ignored; standalone originals are the default
  // Marketing track
  marketingEnabled: boolean;   // generate promotional tweets for clawfable.com
  marketingMix: number;        // 0-100, percentage of tweets that are promotional
  marketingRole: string;       // e.g. "ceo", "product", "service"
  // Soul evolution
  soulEvolutionMode: 'auto' | 'approval' | 'off';
  lastEvolvedAt: string | null;
  // Proactive engagement
  proactiveReplies: boolean;     // disabled: X blocks arbitrary API replies; use supervised Engage flow
  proactiveLikes: boolean;       // legacy disabled; X API like endpoint is blocked
  autoFollow: boolean;           // follow relevant accounts to expand network
  agentShoutouts: boolean;       // cross-promote other Clawfable agents
  // Posting schedule
  peakHours: number[];           // hours of day with best engagement (auto-detected)
  contentCalendar: Record<string, string>; // day-of-week -> topic focus (e.g. "monday": "analysis")
}

export type AutopilotHealthStatus = 'healthy' | 'watch' | 'degraded' | 'blocked';

export interface AutopilotHealthSnapshot {
  agentId: string;
  status: AutopilotHealthStatus;
  checkedAt: string;
  reason: string;
  details: string[];
  lastPostedAt: string | null;
  expectedPostBy: string | null;
  minutesOverdue: number;
  cadenceHours: number;
  queueDepth: number;
  postableQueueDepth: number;
  staleLowConfidenceDepth: number;
  maxConfidence: number | null;
  externalBlocker: 'x_auth' | 'x_api' | 'billing' | 'queue' | 'cooldown' | null;
  selfHealAttemptedAt: string | null;
  selfHealAction: string | null;
}

export interface VoiceDirective {
  id: string;
  role: 'operator' | 'agent';
  content: string;
  // For operator messages: the extracted directive that persists into generation
  directive?: string;
  ts: string;
}

export type VoiceDirectiveScopeType =
  | 'general'
  | 'hook'
  | 'topic'
  | 'tone'
  | 'length'
  | 'forbidden_phrase'
  | 'format'
  | 'structure';

export type VoiceDirectiveScopeOperator = 'prefer' | 'avoid' | 'require' | 'limit' | 'ban';

export interface VoiceDirectiveScope {
  type: VoiceDirectiveScopeType;
  operator: VoiceDirectiveScopeOperator;
  target: string | null;
}

export interface VoiceDirectiveRule {
  id: string;
  rawDirective: string;
  normalizedRule: string;
  systemLesson: string;
  scope: VoiceDirectiveScope;
  status: 'active' | 'superseded';
  sourceMessage: string | null;
  supersedesRuleIds: string[];
  supersededByRuleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SoulVersion {
  version: number;
  soulMd: string;
  updatedAt: string;
  reason: string;             // summary of what changed
}

export interface PostLogEntry {
  id: string;
  agentId: string;
  tweetId: string;           // internal tweet ID
  xTweetId: string;          // X post ID
  content: string;
  format: string;
  topic: string;
  postedAt: string;
  source: 'autopilot' | 'manual' | 'cron';
  action?: 'posted' | 'replied' | 'skipped' | 'error' | 'mentions_refreshed' | 'job_executed';
  reason?: string;
  runId?: string;
  skipReason?: string;
  model?: string;
  errorCode?: string;
}

// ─── Performance tracking types ──────────────────────────────────────────────

export interface TweetPerformance {
  tweetId: string;         // internal ID (empty for timeline-tracked tweets)
  xTweetId: string;        // X post ID
  content: string;
  format: string;
  topic: string;
  hook?: TweetHookType;
  tone?: TweetToneType;
  specificity?: TweetSpecificityType;
  structure?: TweetStructureType;
  thesis?: string;
  postedAt: string;
  checkedAt: string;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  engagementRate: number;  // (likes+RTs+replies) / impressions
  wasViral: boolean;       // exceeded the viral threshold
  source: 'autopilot' | 'manual' | 'timeline';  // timeline = tracked from full X timeline
  styleMode?: ContentStyleMode;
  creativeLane?: CreativeLane;
  targetAudienceSegment?: AudienceSegment;
  promptStrategy?: PromptStrategy;
  mediaExperimentType?: MediaExperimentType;
  mediaBrief?: string;
  portfolioRole?: PostPortfolioRole;
  relationshipTargetHandle?: string;
  followupForTweetId?: string;
  followupTrigger?: string;
  trendFitScore?: number;
  networkCluster?: AudienceSegment;
  performanceCheckpoint?: PerformanceCheckpoint;
  actionRewards?: ActionRewardBreakdown;
  qualityAdjustedGrowthScore?: number;
  draftExperimentId?: string;
  experimentBatchId?: string;
  experimentHoldout?: boolean;
  surpriseScore?: number;
  creativeRiskScore?: number;
  slopScore?: number;
  replyBaitScore?: number;
  earlyVelocityScore?: number;
}

export interface ManualExampleCuration {
  pinnedXTweetIds: string[];
  blockedXTweetIds: string[];
  updatedAt: string;
}

export interface ManualTopicCluster {
  topic: string;
  angle: string;
  weight: number;
  sampleCount: number;
  avgEngagement: number;
  topTweets: TweetPerformance[];
}

export interface StyleFingerprint {
  avgLength: number;
  shortPct: number;        // % tweets under 200 chars
  mediumPct: number;       // % tweets 200-500 chars
  longPct: number;         // % tweets 500+ chars
  questionRatio: number;   // % tweets that are questions
  usesLineBreaks: boolean;
  usesEmojis: boolean;
  usesNumbers: boolean;    // data-driven style
  topHooks: string[];      // most common opening hook types
  topTones: string[];      // most common tone types
  antiPatterns: string[];  // patterns that consistently underperform
  updatedAt: string;
}

export interface OperatorVoiceReference {
  sampleCount: number;                 // human-written reference pool size
  bestPerformers: TweetPerformance[];  // strongest operator-written tweets
  styleFingerprint: StyleFingerprint;  // how the best human-written tweets sound
  pinnedExamples?: TweetPerformance[];
  blockedXTweetIds?: string[];
}

export interface SourceLanePerformance {
  lane: ContentSourceLane;
  posts: number;
  avgEngagement: number;
  wins: number;
}

export interface StyleModePerformance {
  mode: ContentStyleMode;
  posts: number;
  avgEngagement: number;
  wins: number;
  approvals: number;
  rejections: number;
  deletes: number;
  avgConfidence: number;
  confidencePassRate: number;
}

export interface AgentLearnings {
  agentId: string;
  updatedAt: string;
  totalTracked: number;
  avgLikes: number;
  avgRetweets: number;
  bestPerformers: TweetPerformance[];    // top 10 by engagement
  worstPerformers: TweetPerformance[];   // bottom 5 by engagement
  formatRankings: Array<{ format: string; avgEngagement: number; count: number }>;
  topicRankings: Array<{ topic: string; avgEngagement: number; count: number }>;
  insights: string[];                     // AI-generated prescriptive rules
  styleFingerprint?: StyleFingerprint;    // computed from top performers
  operatorVoiceReference?: OperatorVoiceReference; // high-performing human-written voice anchors
  manualTopicProfile?: ManualTopicCluster[];
  manualExampleCuration?: ManualExampleCuration;
  sourceLanePerformance?: SourceLanePerformance[];
  styleModePerformance?: StyleModePerformance[];
  sourceBreakdown?: {
    autopilot: number;
    manual: number;
    timeline: number;
    trainingCount: number;
    trainingSource: 'autopilot' | 'mixed';
  };
  audienceSegmentPerformance?: Array<{ segment: AudienceSegment; posts: number; avgEngagement: number; wins: number }>;
  promptStrategyPerformance?: Array<{ strategy: PromptStrategy; posts: number; avgEngagement: number; wins: number }>;
  mediaExperimentPerformance?: Array<{ type: MediaExperimentType; posts: number; avgEngagement: number; wins: number }>;
  portfolioRolePerformance?: Array<{ role: PostPortfolioRole; posts: number; avgEngagement: number; wins: number }>;
  networkClusterPerformance?: Array<{ cluster: AudienceSegment; posts: number; avgEngagement: number; wins: number }>;
  topRelationshipHandles?: Array<{ handle: string; interactions: number; avgEngagement: number; lastSeenAt: string }>;
  viralityPostmortems?: ViralityPostmortem[];
}

export interface DraftExperiment {
  id: string;
  agentId: string;
  tweetId: string | null;
  xTweetId: string | null;
  batchId: string | null;
  slot: number | null;
  status: DraftExperimentStatus;
  creativeLane: CreativeLane;
  sourceLane: ContentSourceLane | null;
  styleMode: ContentStyleMode;
  generationMode: AutonomyMode;
  format: string | null;
  topic: string | null;
  hook: TweetHookType | string | null;
  tone: TweetToneType | string | null;
  specificity: TweetSpecificityType | string | null;
  structure: TweetStructureType | string | null;
  coverageCluster: string | null;
  hypothesis: string;
  promptVariant: string;
  holdout: boolean;
  predictedReward: number | null;
  predictedConfidence: number | null;
  candidateScore: number | null;
  voiceScore: number | null;
  noveltyScore: number | null;
  surpriseScore: number | null;
  creativeRiskScore: number | null;
  slopScore: number | null;
  replyBaitScore: number | null;
  policyRiskScore: number | null;
  targetAudienceSegment: AudienceSegment | null;
  segmentHypothesis: string | null;
  promptStrategy: PromptStrategy | null;
  mediaExperimentType?: MediaExperimentType | null;
  mediaBrief?: string | null;
  portfolioRole?: PostPortfolioRole | null;
  relationshipTargetHandle?: string | null;
  criticScores: CandidateCriticScores | null;
  actionRewardPrediction: ActionRewardBreakdown | null;
  immediateReward: number | null;
  finalReward: number | null;
  totalReward: number | null;
  actionRewards: ActionRewardBreakdown | null;
  earlyVelocityScore: number | null;
  actualEngagement: number | null;
  engagementRate: number | null;
  performanceLift: number | null;
  lastSignalType: LearningSignalType | null;
  outcomeNotes: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AccountAnalysis {
  agentId: string;
  analyzedAt: string;
  tweetCount: number;
  viralTweets: ViralTweet[];
  engagementPatterns: EngagementPattern;
  followingProfile: FollowingProfile;
  warnings?: string[];
  contentFingerprint: string;  // summary of what makes this account's content perform
}

// ─── Growth opportunity types ────────────────────────────────────────────────

export interface TrendOpportunity {
  id: string;
  agentId: string;
  topicId: string;
  headline: string;
  category: string;
  source: string;
  topTweetId: string | null;
  topTweetAuthor: string | null;
  topTweetText: string | null;
  topTweetLikes: number;
  fitScore: number;
  sourceLane: ContentSourceLane | 'reject';
  suggestedAngle: string;
  status: 'new' | 'drafted' | 'dismissed';
  createdAt: string;
}

export interface RelationshipOpportunity {
  id: string;
  agentId: string;
  handle: string;
  name: string | null;
  tweetId: string | null;
  tweetUrl: string | null;
  contentSample: string | null;
  networkCluster: AudienceSegment | null;
  score: number;
  reason: string;
  suggestedAction: 'reply' | 'follow' | 'list' | 'quote' | 'study';
  status: 'new' | 'acted' | 'dismissed';
  lastSeenAt: string;
  createdAt: string;
}

export interface ReplyMiningInsight {
  id: string;
  authorHandle: string;
  theme: string;
  prompt: string;
  opportunityScore: number;
  createdAt: string;
}

export interface ViralityPostmortem {
  id: string;
  agentId: string;
  tweetId: string;
  xTweetId: string;
  content: string;
  postedAt: string;
  analyzedAt: string;
  score: number;
  qualityAdjustedGrowthScore?: number | null;
  performanceSummary: string;
  winningFactors: string[];
  misses: string[];
  nextExperiments: string[];
  portfolioRole?: PostPortfolioRole | null;
  mediaExperimentType?: MediaExperimentType | null;
  targetAudienceSegment?: AudienceSegment | null;
  promptStrategy?: PromptStrategy | null;
}

// ─── Engagement types ────────────────────────────────────────────────────────

export type EngagementCandidateSource = 'feed' | 'pasted' | 'trend' | 'relationship' | 'reply_mined';
export type EngagementActionType = 'like' | 'reply';
export type EngagementActionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'aborted';
export type EngagementSessionState = 'draft' | 'approved' | 'running' | 'succeeded' | 'failed' | 'aborted';

export interface EngagementCandidate {
  id: string;
  agentId: string;
  source: EngagementCandidateSource;
  tweetId: string;
  tweetUrl: string;
  authorId: string | null;
  authorHandle: string;
  authorName: string | null;
  text: string;
  likes: number;
  createdAt: string;
  topic: string | null;
  networkCluster?: AudienceSegment | null;
  opportunityType?: 'reply' | 'follow' | 'list' | 'quote' | 'trend';
  relationshipReason?: string | null;
  score: number;
  scoreReason: string;
}

export interface EngagementDraft {
  tweetId: string;
  content: string;
  originalContent: string;
  edited: boolean;
  updatedAt: string;
}

export interface EngagementProof {
  type: 'screenshot' | 'dom';
  localPath?: string | null;
  note?: string | null;
  capturedAt: string;
}

export interface EngagementAction {
  id: string;
  type: EngagementActionType;
  status: EngagementActionStatus;
  candidate: EngagementCandidate;
  draft: EngagementDraft | null;
  resultTweetId: string | null;
  resultTweetUrl: string | null;
  proof: EngagementProof | null;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface EngagementSession {
  id: string;
  agentId: string;
  state: EngagementSessionState;
  actions: EngagementAction[];
  machineLabel: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  abortedAt: string | null;
  lastError: string | null;
}

export interface BrowserCompanionPairing {
  id: string;
  ownerUserId: string;
  machineLabel: string;
  token: string;
  status: 'pending' | 'active' | 'revoked';
  currentAgentId: string | null;
  currentAgentHandle: string | null;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt: string | null;
  expiresAt: string | null;
}

export interface EngageSnapshot {
  companion: {
    latestPairing: BrowserCompanionPairing | null;
    localUrl: string;
  };
  candidateFeed: EngagementCandidate[];
  currentSession: EngagementSession | null;
  recentSessions: EngagementSession[];
}

// ─── Tweet job types ────────────────────────────────────────────────────────

export interface TweetJob {
  id: string;
  agentId: string;
  name: string;                // e.g. "Peak Hour Hot Takes"
  description: string;         // human-readable explanation
  schedule: string;            // e.g. "every 4h", "3x/day", "daily 14:00"
  postsPerRun: number;         // 1-5
  topics: string[];            // filter to these topics, empty = any
  formats: string[];           // filter to these formats, empty = any
  enabled: boolean;
  lastRunAt: string | null;
  totalPosted: number;
  createdAt: string;
  source: 'user' | 'suggested';
}

export type CreateTweetJobInput = Omit<TweetJob, 'id' | 'createdAt' | 'lastRunAt' | 'totalPosted'>;
export type UpdateTweetJobInput = Partial<Omit<TweetJob, 'id' | 'agentId' | 'createdAt'>>;

export interface JobSuggestion {
  name: string;
  description: string;
  schedule: string;
  postsPerRun: number;
  topics: string[];
  formats: string[];
  reason: string;              // why this job is suggested
}

// ─── Activation funnel types ────────────────────────────────────────────────

export interface WizardData {
  exampleTweets: string[];     // 0-5 example tweets (optional)
  archetype: string;           // contrarian | optimist | analyst | provocateur | educator
  topics: string[];            // 2-3 selected topics
  frequency: string;           // '1x' | '3x' | '6x'
  createdAt: string;
}

export interface StyleSignals {
  sentenceLength: string;      // short | medium | long | mixed
  vocabulary: string;          // casual | technical | mixed
  toneMarkers: string[];       // e.g. ['sarcastic', 'data-driven']
  topicPreferences: string[];
  rawExtraction: string;       // Model's full style analysis text
}

export interface FeedbackEntry {
  tweetId?: string;
  tweetText: string;
  rating: 'up' | 'down';
  generatedAt: string; // when the feedback signal was recorded
  reason?: string;
  intentSummary?: string;
  source?: 'preview_feedback' | 'queue_delete' | 'taste_calibration';
  userProvidedReason?: boolean;
}

export type LearningSignalType =
  | 'approved_without_edit'
  | 'edited_before_queue'
  | 'edited_before_post'
  | 'copied_to_clipboard'
  | 'copied_not_posted'
  | 'deleted_from_queue'
  | 'deleted_from_x'
  | 'reply_generated'
  | 'reply_rejected'
  | 'reply_posted'
  | 'tweet_liked'
  | 'tweet_like_failed'
  | 'x_post_rejected'
  | 'x_post_succeeded'
  | 'taste_more_like_this'
  | 'taste_less_like_this'
  | 'taste_calibration_edit';

export interface LearningSignal {
  id: string;
  agentId: string;
  tweetId?: string;
  xTweetId?: string;
  signalType: LearningSignalType;
  surface: 'compose' | 'queue' | 'mentions' | 'setup' | 'autopilot' | 'manual_post' | 'cron' | 'engage';
  rewardDelta: number; // -1 to 1
  createdAt: string;
  reason?: string;
  inferred?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface OutcomeEpisode {
  agentId: string;
  tweetId: string;
  xTweetId?: string;
  format: string | null;
  topic: string | null;
  featureTags: CandidateFeatureTags;
  reward: RewardBreakdown;
  signals: LearningSignalType[];
  stage: 'immediate' | 'final';
  observedAt: string;
}

export interface PersonalizationMemory {
  alwaysDoMoreOfThis: string[];
  neverDoThisAgain: string[];
  topicsWithMomentum: string[];
  formatsUnderTested: string[];
  operatorHiddenPreferences: string[];
  fallbackShapeOutcomes?: FallbackShapeOutcomeCounter[];
  editTransformations: string[];
  referenceBank?: string[];
  conversationInsights?: string[];
  audienceSegmentLessons?: string[];
  promptStrategyLessons?: string[];
  networkClusterLessons?: string[];
  mediaExperimentLessons?: string[];
  portfolioLessons?: string[];
  relationshipLessons?: string[];
  viralityPostmortems?: string[];
  replyMiningInsights?: string[];
  outcomeFatigueLessons?: string[];
  identityConstraints: string[];
  weeklyChanges: string[];
  updatedAt: string;
}

export interface FallbackShapeOutcomeCounter {
  fallbackKind: string;
  topic?: string;
  shape: string;
  hook: string;
  structure: string;
  specificity: string;
  approved: number;
  posted: number;
  edited: number;
  rejected: number;
  total: number;
  netScore: number;
  latestOutcome?: 'approved' | 'posted' | 'edited' | 'rejected';
  latestOutcomeAt?: string;
  updatedAt: string;
}

export interface FunnelEvent {
  event: string;
  ts: string;
  meta?: Record<string, unknown>;
}
