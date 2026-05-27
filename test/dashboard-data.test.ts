import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getTrendingCache: vi.fn(),
  setTrendingCache: vi.fn(),
  fetchTrendingFromFollowing: vi.fn(),
  decodeKeys: vi.fn(),
  addPostLogEntry: vi.fn(),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock('@/lib/account-access', () => ({
  getAccessibleAgentCount: vi.fn(),
  getAccessibleAgents: vi.fn(),
}));

vi.mock('@/lib/billing', () => ({
  getBillingSummary: vi.fn(() => ({ tier: 'free' })),
}));

vi.mock('@/lib/engagement', () => ({
  BROWSER_COMPANION_LOCAL_URL: 'http://localhost:4317',
  buildEngagementFeed: vi.fn(),
}));

vi.mock('@/lib/generation-context', () => ({
  buildGenerationContext: vi.fn(),
}));

vi.mock('@/lib/learning-snapshot', () => ({
  buildLearningSnapshot: vi.fn(),
}));

vi.mock('@/lib/autopilot-health', () => ({
  evaluateAutopilotHealth: vi.fn(),
}));

vi.mock('@/lib/open-source-souls', () => ({
  getPresetSoulProfile: vi.fn(() => null),
  getPresetSoulSummaries: vi.fn(() => []),
  toPublicSoulListItem: vi.fn((item: unknown) => item),
}));

vi.mock('@/lib/setup-state', () => ({
  normalizeSetupStep: vi.fn((step: string | null | undefined) => step || 'ready'),
}));

vi.mock('@/lib/source-planner', () => ({
  buildSourcePlannerPlan: vi.fn(),
  enrichTrendingTopics: vi.fn((topics: unknown[]) => topics),
}));

vi.mock('@/lib/kv-storage', () => ({
  getAgentByHandle: vi.fn(),
  getActiveEngagementSession: vi.fn(),
  getAutopilotHealth: vi.fn(),
  getAgents: vi.fn(),
  getAnalysis: vi.fn(),
  getBaseline: vi.fn(),
  getFeedback: vi.fn(),
  getLearnings: vi.fn(),
  getLatestBrowserCompanionPairingForUser: vi.fn(),
  getLearningSignals: vi.fn(),
  getManualExampleCuration: vi.fn(),
  getMentions: vi.fn(),
  getMentionCount: vi.fn(),
  getPerformanceHistory: vi.fn(),
  getPostLog: vi.fn(),
  getProtocolSettings: vi.fn(),
  getQueuedTweets: vi.fn(),
  getTrendingCache: mocks.getTrendingCache,
  getTweets: vi.fn(),
  getTweetCount: vi.fn(),
  listEngagementSessions: vi.fn(),
  setTrendingCache: mocks.setTrendingCache,
  addPostLogEntry: mocks.addPostLogEntry,
}));

vi.mock('@/lib/trending', () => ({
  fetchTrendingFromFollowing: mocks.fetchTrendingFromFollowing,
}));

vi.mock('@/lib/twitter-client', () => ({
  decodeKeys: mocks.decodeKeys,
}));

import { getAgentTopics, refreshAgentTopics } from '@/lib/dashboard-data';
import { TwitterActionError } from '@/lib/twitter-debug';

const agent = {
  id: 'agent-1',
  handle: 'geoffreywoo',
  name: 'Geoffrey Woo',
  soulMd: '# Geoffrey',
  soulSummary: null,
  isConnected: 1,
  apiKey: 'api-key',
  apiSecret: 'api-secret',
  accessToken: 'access-token',
  accessSecret: 'access-secret',
  xUserId: 'x-user-1',
  soulPublic: 1,
  setupStep: 'ready',
  createdAt: '2026-05-24T00:00:00.000Z',
} satisfies Agent;

const cachedTopic = {
  id: 1,
  headline: 'AI agents need taste loops',
  source: '@builder',
  relevanceScore: 91,
  category: 'agents',
  timestamp: '2026-05-24T00:00:00.000Z',
  tweetCount: 3,
};

describe('dashboard data topic loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTrendingCache.mockResolvedValue([cachedTopic]);
    mocks.decodeKeys.mockReturnValue({
      appKey: 'api-key',
      appSecret: 'api-secret',
      accessToken: 'access-token',
      accessSecret: 'access-secret',
    });
    mocks.fetchTrendingFromFollowing.mockResolvedValue([{ ...cachedTopic, id: 2 }]);
    mocks.setTrendingCache.mockResolvedValue(undefined);
    mocks.addPostLogEntry.mockResolvedValue(undefined);
  });

  it('serves dashboard topics from cache without crawling X', async () => {
    await expect(getAgentTopics(agent)).resolves.toEqual([cachedTopic]);

    expect(mocks.getTrendingCache).toHaveBeenCalledWith(agent.id);
    expect(mocks.decodeKeys).not.toHaveBeenCalled();
    expect(mocks.fetchTrendingFromFollowing).not.toHaveBeenCalled();
    expect(mocks.setTrendingCache).not.toHaveBeenCalled();
  });

  it('runs the X crawl only through explicit topic refresh', async () => {
    const topics = await refreshAgentTopics(agent);

    expect(topics).toEqual([{ ...cachedTopic, id: 2 }]);
    expect(mocks.decodeKeys).toHaveBeenCalledWith({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });
    expect(mocks.fetchTrendingFromFollowing).toHaveBeenCalledWith(
      {
        appKey: 'api-key',
        appSecret: 'api-secret',
        accessToken: 'access-token',
        accessSecret: 'access-secret',
      },
      agent.xUserId,
    );
    expect(mocks.setTrendingCache).toHaveBeenCalledWith(agent.id, [{ ...cachedTopic, id: 2 }]);
  });

  it('keeps cached topics and logs reset-aware X failures when refresh is rate limited', async () => {
    mocks.fetchTrendingFromFollowing.mockRejectedValue(new TwitterActionError({
      action: 'refresh_topics',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));

    const topics = await refreshAgentTopics(agent);

    expect(topics).toEqual([cachedTopic]);
    expect(mocks.setTrendingCache).not.toHaveBeenCalled();
    expect(mocks.getTrendingCache).toHaveBeenCalledWith(agent.id);
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'trend_refresh_error',
        topic: 'network_growth',
        source: 'manual',
        action: 'error',
        errorCode: 'x_rate_limit',
        reason: expect.stringContaining('X topic refresh rate limited until 2026-04-07T12:20:00.000Z'),
      }),
    );
  });
});
