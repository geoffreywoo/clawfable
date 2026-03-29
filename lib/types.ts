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

export type CreateMentionInput = Omit<Mention, 'id' | 'createdAt'>;

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

export interface AccountAnalysis {
  agentId: string;
  analyzedAt: string;
  tweetCount: number;
  viralTweets: ViralTweet[];
  engagementPatterns: EngagementPattern;
  followingProfile: FollowingProfile;
  contentFingerprint: string;  // summary of what makes this account's content perform
}
