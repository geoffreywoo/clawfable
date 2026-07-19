import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  acquireTopicIntelligenceLock: vi.fn(),
  getTrendingCacheSnapshot: vi.fn(),
  getTopicIntelligenceState: vi.fn(),
  releaseTopicIntelligenceLock: vi.fn(),
  saveTopicIntelligenceState: vi.fn(),
  setTrendingCache: vi.fn(),
  discoverCurrentTrends: vi.fn(),
  decodeKeys: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  acquireTopicIntelligenceLock: mocks.acquireTopicIntelligenceLock,
  getTrendingCacheSnapshot: mocks.getTrendingCacheSnapshot,
  getTopicIntelligenceState: mocks.getTopicIntelligenceState,
  releaseTopicIntelligenceLock: mocks.releaseTopicIntelligenceLock,
  saveTopicIntelligenceState: mocks.saveTopicIntelligenceState,
  setTrendingCache: mocks.setTrendingCache,
}));

vi.mock('@/lib/trending', () => ({
  discoverCurrentTrends: mocks.discoverCurrentTrends,
  mergeTrendingTopics: (groups: Array<Array<Record<string, unknown>>>) => groups.flat(),
}));

vi.mock('@/lib/twitter-client', () => ({
  decodeKeys: mocks.decodeKeys,
}));

import { refreshAgentTopicIntelligence } from '@/lib/topic-intelligence-refresh';

const agent = {
  id: 'agent-1',
  handle: 'geoffwoo',
  name: 'Geoffrey Woo',
  soulMd: '',
  soulSummary: null,
  isConnected: 1,
  apiKey: 'encoded-key',
  apiSecret: 'encoded-secret',
  accessToken: 'encoded-token',
  accessSecret: 'encoded-access-secret',
  xUserId: 'x-user-1',
  soulPublic: 1,
  setupStep: 'ready',
  createdAt: '2026-07-14T00:00:00.000Z',
} satisfies Agent;

const topic = {
  id: 1,
  headline: 'Packaging yield constrains solid-state transformer pilots',
  source: '@alice, @bob',
  relevanceScore: 91,
  category: 'solid-state transformer production',
  timestamp: '2026-07-14T10:00:00.000Z',
  tweetCount: 2,
};

describe('automatic topic-intelligence refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decodeKeys.mockReturnValue({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      accessSecret: 'access-secret',
    });
    mocks.getTopicIntelligenceState.mockResolvedValue(null);
    mocks.acquireTopicIntelligenceLock.mockResolvedValue({
      acquired: true,
      owner: 'topic-refresh:test',
      lock: null,
    });
    mocks.releaseTopicIntelligenceLock.mockResolvedValue(true);
  });

  it('uses the four-hour cache without recrawling X', async () => {
    mocks.getTrendingCacheSnapshot.mockResolvedValue({
      data: [topic],
      cachedAt: new Date().toISOString(),
      ageMs: 1000,
      isFresh: true,
    });

    const result = await refreshAgentTopicIntelligence(agent);

    expect(result.topics).toEqual([topic]);
    expect(result.attempted).toBe(false);
    expect(mocks.discoverCurrentTrends).not.toHaveBeenCalled();
  });

  it('persists tweet/topic momentum state when the cache expires', async () => {
    const networkState = {
      version: 1 as const,
      observedAt: '2026-07-14T12:00:00.000Z',
      refreshSequence: 1,
      followingCount: 500,
      sampledAccountIds: ['a', 'b'],
      sourceTweetCount: 40,
      viralTweets: [],
      topics: [],
      authorSignals: [],
    };
    mocks.getTrendingCacheSnapshot.mockResolvedValue({
      data: [],
      cachedAt: '2026-07-14T06:00:00.000Z',
      ageMs: 6 * 60 * 60 * 1000,
      isFresh: false,
    });
    mocks.discoverCurrentTrends.mockResolvedValue({
      topics: [topic],
      networkState,
      networkRefreshed: true,
      networkError: null,
      sampledNetworkAccounts: 18,
      networkCandidateTweets: 12,
      networkPartialFailures: 0,
    });

    const result = await refreshAgentTopicIntelligence(agent);

    expect(result).toMatchObject({
      refreshed: true,
      sampledNetworkAccounts: 18,
      networkCandidateTweets: 12,
    });
    expect(mocks.saveTopicIntelligenceState).toHaveBeenCalledWith(agent.id, networkState);
    expect(mocks.setTrendingCache).toHaveBeenCalledWith(agent.id, [topic]);
    expect(mocks.releaseTopicIntelligenceLock).toHaveBeenCalledWith(agent.id, 'topic-refresh:test');
  });

  it('does not feed expired topics to generation when refresh fails', async () => {
    mocks.getTrendingCacheSnapshot.mockResolvedValue({
      data: [topic],
      cachedAt: '2026-07-14T06:00:00.000Z',
      ageMs: 6 * 60 * 60 * 1000,
      isFresh: false,
    });
    mocks.discoverCurrentTrends.mockRejectedValue(new Error('X unavailable'));

    const result = await refreshAgentTopicIntelligence(agent);

    expect(result.topics).toEqual([]);
    expect(result.refreshed).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(mocks.setTrendingCache).not.toHaveBeenCalled();
  });

  it('returns partial discovery for the caller without caching it as a successful refresh', async () => {
    const networkError = new Error('X timelines unavailable');
    const cachedNetworkTopic = {
      ...topic,
      id: 2,
      networkTopicId: 'network-transformer-packaging-abc123',
      discoveryMethod: 'followed_network' as const,
    };
    mocks.getTrendingCacheSnapshot.mockResolvedValue({
      data: [cachedNetworkTopic],
      cachedAt: '2026-07-14T06:00:00.000Z',
      ageMs: 6 * 60 * 60 * 1000,
      isFresh: false,
    });
    mocks.discoverCurrentTrends.mockResolvedValue({
      topics: [topic],
      networkState: null,
      networkRefreshed: false,
      networkError,
      sampledNetworkAccounts: 0,
      networkCandidateTweets: 0,
      networkPartialFailures: 1,
    });

    const result = await refreshAgentTopicIntelligence(agent);
    const retry = await refreshAgentTopicIntelligence(agent);

    expect(result.topics).toEqual([topic]);
    expect(retry.topics).toEqual([topic]);
    expect(result.refreshed).toBe(false);
    expect(result.error).toBe(networkError);
    expect(mocks.discoverCurrentTrends).toHaveBeenCalledTimes(2);
    expect(mocks.setTrendingCache).not.toHaveBeenCalled();
    expect(mocks.saveTopicIntelligenceState).not.toHaveBeenCalled();
  });

  it('does not feed an expired snapshot to generation while another refresh owns the lock', async () => {
    mocks.getTrendingCacheSnapshot.mockResolvedValue({
      data: [topic],
      cachedAt: '2026-07-14T06:00:00.000Z',
      ageMs: 6 * 60 * 60 * 1000,
      isFresh: false,
    });
    mocks.acquireTopicIntelligenceLock.mockResolvedValue({
      acquired: false,
      owner: 'topic-refresh:waiting',
      lock: { owner: 'topic-refresh:active' },
    });

    const result = await refreshAgentTopicIntelligence(agent, { force: true });

    expect(result).toMatchObject({
      topics: [],
      attempted: false,
      refreshed: false,
      busy: true,
    });
    expect(mocks.discoverCurrentTrends).not.toHaveBeenCalled();
    expect(mocks.releaseTopicIntelligenceLock).not.toHaveBeenCalled();
  });
});
