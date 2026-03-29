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
  setupStep: string; // 'oauth' | 'soul' | 'analyze' | 'ready'
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
  setupStep: string;
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
  setupStep: string;
  createdAt: string;
  hasKeys: boolean;
}

export interface Tweet {
  id: string;
  agentId: string;
  content: string;
  type: string; // original | reply | quote
  status: string; // draft | queued | posted
  topic: string | null;
  xTweetId: string | null;
  quoteTweetId: string | null;  // X tweet ID to quote (for QTs)
  quoteTweetAuthor: string | null;
  scheduledAt: string | null;
  createdAt: string;
}

export interface Mention {
  id: string;
  agentId: string;
  author: string;
  authorHandle: string;
  content: string;
  tweetId: string | null;
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

export type CreateAgentInput = Omit<Agent, 'id' | 'createdAt'>;
export type UpdateAgentInput = Partial<Omit<Agent, 'id' | 'createdAt'>>;

export type CreateTweetInput = Omit<Tweet, 'id' | 'createdAt'>;
export type UpdateTweetInput = Partial<Omit<Tweet, 'id' | 'agentId' | 'createdAt'>>;

export type CreateMentionInput = Omit<Mention, 'id' | 'createdAt'> & { createdAt?: string };

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
  postsPerDay: number;        // 1-12
  activeHoursStart: number;   // UTC hour 0-23
  activeHoursEnd: number;     // UTC hour 0-23
  minQueueSize: number;       // auto-generate when queue drops below this
  autoReply: boolean;         // auto-reply to new mentions
  maxRepliesPerRun: number;   // max replies per cron run (1-5)
  replyIntervalMins: number;  // minimum minutes between reply runs (30-720)
  lastPostedAt: string | null;
  lastRepliedAt: string | null;
  totalAutoPosted: number;
  totalAutoReplied: number;
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
  action?: 'posted' | 'replied' | 'skipped' | 'error' | 'mentions_refreshed';
  reason?: string;
}

// ─── Performance tracking types ──────────────────────────────────────────────

export interface TweetPerformance {
  tweetId: string;         // internal ID
  xTweetId: string;        // X post ID
  content: string;
  format: string;
  topic: string;
  postedAt: string;
  checkedAt: string;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  engagementRate: number;  // (likes+RTs+replies) / impressions
  wasViral: boolean;       // exceeded the viral threshold
  source: 'autopilot' | 'manual';
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
  insights: string[];                     // AI-generated learnings
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
