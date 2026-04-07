import type { SetupStep } from './setup-state';

// ─── User types ──────────────────────────────────────────────────────────────

export interface User {
  id: string;          // X user ID
  username: string;    // X screen name
  name: string;        // X display name
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

export type TweetStatus = 'preview' | 'draft' | 'queued' | 'posted' | 'deleted_from_x';

export interface Tweet {
  id: string;
  agentId: string;
  content: string;
  type: string; // original | reply | quote
  status: TweetStatus;
  format: string | null;  // hot_take | question | data_point | short_punch | long_form | analysis | observation
  topic: string | null;
  xTweetId: string | null;
  quoteTweetId: string | null;  // X tweet ID to quote (for QTs)
  quoteTweetAuthor: string | null;
  scheduledAt: string | null;
  deletionReason: string | null;  // why the operator deleted this from X
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
  hook?: string;           // opening hook type: question, bold_claim, data_point, story, observation
  tone?: string;           // sarcastic, earnest, analytical, provocative, educational
  specificity?: string;    // abstract, concrete, data_driven
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
  rawExtraction: string;       // Claude's full style analysis text
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

export interface FunnelEvent {
  event: string;
  ts: string;
  meta?: Record<string, unknown>;
}
