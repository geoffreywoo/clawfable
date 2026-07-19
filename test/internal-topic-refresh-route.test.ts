import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireAutopilotLock: vi.fn(),
  getAgent: vi.fn(),
  getTopicIntelligenceState: vi.fn(),
  releaseAutopilotLock: vi.fn(),
  resetReadCache: vi.fn(),
  refreshAgentTopicIntelligence: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  acquireAutopilotLock: mocks.acquireAutopilotLock,
  getAgent: mocks.getAgent,
  getTopicIntelligenceState: mocks.getTopicIntelligenceState,
  releaseAutopilotLock: mocks.releaseAutopilotLock,
  resetReadCache: mocks.resetReadCache,
}));

vi.mock('@/lib/topic-intelligence-refresh', () => ({
  refreshAgentTopicIntelligence: mocks.refreshAgentTopicIntelligence,
}));

import { POST } from '@/app/api/internal/agents/[id]/topics/refresh/route';

function request(secret = 'test-cron-secret'): Request {
  return new Request('http://localhost/api/internal/agents/13/topics/refresh', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('internal topic intelligence refresh route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.getAgent.mockResolvedValue({ id: '13', handle: 'geoffwoo' });
    mocks.acquireAutopilotLock.mockResolvedValue({
      acquired: true,
      owner: 'internal-topic-refresh:test',
      lock: null,
    });
    mocks.releaseAutopilotLock.mockResolvedValue(true);
    mocks.getTopicIntelligenceState.mockResolvedValue({
      observedAt: '2026-07-14T14:00:00.000Z',
      refreshSequence: 3,
      followGraphSource: 'home_timeline',
      activeAuthorCount: 17,
    });
    mocks.refreshAgentTopicIntelligence.mockResolvedValue({
      attempted: true,
      refreshed: true,
      busy: false,
      sampledNetworkAccounts: 17,
      networkCandidateTweets: 9,
      networkPartialFailures: 0,
      error: null,
      topics: [{
        id: 1,
        networkTopicId: 'network-wafer-bonding-abc123',
        discoveryMethod: 'followed_network',
        category: 'wafer bonding yield constraints',
        headline: 'Hybrid bonding yield is becoming the packaging bottleneck.',
        relevanceScore: 91,
        timestamp: '2026-07-14T13:00:00.000Z',
        source: '@processengineer',
        tweetCount: 2,
        networkMomentumScore: 0.84,
        networkMomentumDelta: 0.12,
        topicConfidence: 0.88,
        evidence: [{
          tweetId: '123',
          author: 'processengineer',
          text: 'Hybrid bonding yield falls sharply when surface roughness drifts.',
          createdAt: '2026-07-14T13:00:00.000Z',
          sourceUrl: 'https://x.com/processengineer/status/123',
          likes: 400,
          retweets: 80,
          replies: 12,
          quotes: 20,
          bookmarks: 40,
          weightedEngagement: 710,
          authorBaseline: 120,
          breakoutMultiple: 5.7,
          engagementVelocity: 355,
          viralScore: 0.91,
        }],
      }],
    });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('rejects requests without the configured bearer secret', async () => {
    const response = await POST(request('wrong-secret') as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.refreshAgentTopicIntelligence).not.toHaveBeenCalled();
  });

  it('forces a read-only refresh and returns source provenance', async () => {
    const response = await POST(request() as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.refreshAgentTopicIntelligence).toHaveBeenCalledWith(
      expect.objectContaining({ id: '13' }),
      { force: true },
    );
    expect(mocks.releaseAutopilotLock).toHaveBeenCalledWith('13', 'internal-topic-refresh:test');
    expect(data).toMatchObject({
      handle: '@geoffwoo',
      refreshed: true,
      busy: false,
      source: 'home_timeline',
      sourceComplete: true,
      activeAuthors: 17,
      candidateTweets: 9,
      partialFailures: 0,
      networkTopics: [{
        id: 'network-wafer-bonding-abc123',
        label: 'wafer bonding yield constraints',
        sourceAuthors: ['@processengineer'],
      }],
    });
  });
});
