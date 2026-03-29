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
