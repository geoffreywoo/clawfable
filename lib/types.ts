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
}

export type AutonomyMode = 'safe' | 'balanced' | 'explore';
export type TweetStatus = 'preview' | 'draft' | 'queued' | 'posted' | 'deleted_from_x';
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
}

export interface CandidateJudgeBreakdown {
  overall: number;
  voiceFit: number;
  clarity: number;
  novelty: number;
  audienceFit: number;
  policySafety: number;
}

export interface CandidateScoreProvenance {
  localPrior: number;
  globalPrior: number;
  judge: number;
  predictedReward: number;
  noveltyCoverage: number;
  riskPenalty: number;
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
}

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
  generationMode?: AutonomyMode | null;
  candidateScore?: number | null;
  confidenceScore?: number | null;
  voiceScore?: number | null;
  noveltyScore?: number | null;
  predictedEngagementScore?: number | null;
  freshnessScore?: number | null;
  repetitionRiskScore?: number | null;
  policyRiskScore?: number | null;
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
  rewardBreakdown?: RewardBreakdown | null;
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
  maxRepliesPerRun: number;   // max replies per cron run (1-10)
  replyIntervalMins: number;  // minimum minutes between reply runs
  lastPostedAt: string | null;
  lastRepliedAt: string | null;
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
  enabledFormats: string[];  // which formats to use, empty = all
  qtRatio: number;           // 0-100, percentage of QTs vs originals
  // Marketing track
  marketingEnabled: boolean;   // generate promotional tweets for clawfable.com
  marketingMix: number;        // 0-100, percentage of tweets that are promotional
  marketingRole: string;       // e.g. "ceo", "product", "service"
  // Soul evolution
  soulEvolutionMode: 'auto' | 'approval' | 'off';
  lastEvolvedAt: string | null;
  // Proactive engagement
  proactiveReplies: boolean;     // reply to viral tweets in network
  proactiveLikes: boolean;       // like relevant tweets in network
  autoFollow: boolean;           // follow relevant accounts to expand network
  agentShoutouts: boolean;       // cross-promote other Clawfable agents
  // Posting schedule
  peakHours: number[];           // hours of day with best engagement (auto-detected)
  contentCalendar: Record<string, string>; // day-of-week -> topic focus (e.g. "monday": "analysis")
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
  sourceBreakdown?: {
    autopilot: number;
    manual: number;
    timeline: number;
    trainingCount: number;
    trainingSource: 'autopilot' | 'mixed';
  };
}

export interface AccountAnalysis {
  agentId: string;
  analyzedAt: string;
  tweetCount: number;
  viralTweets: ViralTweet[];
  engagementPatterns: EngagementPattern;
  followingProfile: FollowingProfile;
  contentFingerprint: string;  // summary of what makes this account's content perform
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
  source?: 'preview_feedback' | 'queue_delete';
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
  | 'x_post_rejected'
  | 'x_post_succeeded';

export interface LearningSignal {
  id: string;
  agentId: string;
  tweetId?: string;
  xTweetId?: string;
  signalType: LearningSignalType;
  surface: 'compose' | 'queue' | 'mentions' | 'setup' | 'autopilot' | 'manual_post' | 'cron';
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
  identityConstraints: string[];
  weeklyChanges: string[];
  updatedAt: string;
}

export interface FunnelEvent {
  event: string;
  ts: string;
  meta?: Record<string, unknown>;
}
