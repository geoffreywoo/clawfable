import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTrendingCache: vi.fn(),
  getPostLog: vi.fn(),
  getAnalysis: vi.fn(),
  addPostLogEntry: vi.fn(),
  getAgents: vi.fn(),
  getPerformanceHistory: vi.fn(),
  getTweets: vi.fn(),
  buildGenerationContext: vi.fn(),
  generatePublishingBatchV2: vi.fn(),
  refreshAgentTopicIntelligence: vi.fn(),
  replyToTweet: vi.fn(),
  likeTweet: vi.fn(),
  followUser: vi.fn(),
  getFollowing: vi.fn(),
  getUserByUsername: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getTrendingCache: mocks.getTrendingCache,
  getPostLog: mocks.getPostLog,
  getAnalysis: mocks.getAnalysis,
  addPostLogEntry: mocks.addPostLogEntry,
  getAgents: mocks.getAgents,
  getPerformanceHistory: mocks.getPerformanceHistory,
  getTweets: mocks.getTweets,
}));

vi.mock('@/lib/topic-intelligence-refresh', () => ({
  refreshAgentTopicIntelligence: mocks.refreshAgentTopicIntelligence,
}));

vi.mock('@/lib/twitter-client', () => ({
  replyToTweet: mocks.replyToTweet,
  likeTweet: mocks.likeTweet,
  followUser: mocks.followUser,
  getFollowing: mocks.getFollowing,
  getUserByUsername: mocks.getUserByUsername,
}));

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ai')>(),
  generateText: mocks.generateText,
  PUBLISHING_V2_MODEL_STACK: 'publishing_v2_quality',
}));

vi.mock('@/lib/automation-entitlement', () => ({
  assertAgentAutomationEntitlement: vi.fn(async () => ({
    source: 'agent_exemption',
    eligible: true,
    reason: 'test exemption',
    verifiedAt: new Date().toISOString(),
    paidThrough: null,
    paidInvoiceId: null,
    paidAmountCents: null,
    paidCurrency: null,
  })),
}));

vi.mock('@/lib/generation-context', () => ({
  buildGenerationContext: mocks.buildGenerationContext,
}));

vi.mock('@/lib/publishing-v2', () => ({
  generatePublishingBatchV2: mocks.generatePublishingBatchV2,
}));

import { discoverAndFollow, generateAgentShoutout, likeNetworkTweets, replyToViralTweets } from '@/lib/proactive-engagement';
import { TwitterActionError } from '@/lib/twitter-debug';
import type { Agent, ProtocolSettings } from '@/lib/types';

const agent: Agent = {
  id: 'agent-1',
  handle: 'geoffreywoo',
  name: 'Geoffrey Woo',
  soulMd: '# SOUL\n\nTopics: AI, startups',
  soulSummary: null,
  apiKey: 'key',
  apiSecret: 'secret',
  accessToken: 'token',
  accessSecret: 'access-secret',
  isConnected: 1,
  xUserId: 'user-1',
  soulPublic: 1,
  setupStep: 'ready',
  createdAt: '2026-05-01T00:00:00.000Z',
};

const settings = {
  proactiveReplies: true,
  proactiveLikes: true,
} as ProtocolSettings;

const keys = {
  appKey: 'key',
  appSecret: 'secret',
  accessToken: 'token',
  accessSecret: 'access-secret',
};

const trendingTopic = {
  id: 1,
  headline: 'AI agents are replacing busywork',
  source: '@builder',
  relevanceScore: 92,
  category: 'agents',
  timestamp: new Date().toISOString(),
  tweetCount: 4,
  topTweet: {
    id: 'tweet-1',
    text: 'AI agents are moving from demos to operating systems.',
    likes: 180,
    author: 'builder',
  },
};

describe('proactive engagement', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getTrendingCache.mockResolvedValue(null);
    mocks.refreshAgentTopicIntelligence.mockResolvedValue({ topics: [trendingTopic], error: null });
    mocks.getPostLog.mockResolvedValue([]);
    mocks.getAnalysis.mockResolvedValue(null);
    mocks.generateText.mockResolvedValue({ text: 'The real shift is agents getting judged by throughput, not demos.' });
    mocks.replyToTweet.mockResolvedValue({ tweetId: 'reply-1', username: 'geoffreywoo' });
    mocks.likeTweet.mockResolvedValue(undefined);
    mocks.followUser.mockResolvedValue(undefined);
    mocks.getFollowing.mockResolvedValue([]);
    mocks.getUserByUsername.mockResolvedValue({
      id: 'candidate-user-1',
      name: 'Builder',
      username: 'builder',
    });
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.getPerformanceHistory.mockResolvedValue([]);
    mocks.getTweets.mockResolvedValue([]);
    mocks.getAnalysis.mockResolvedValue({ agentId: agent.id, contentFingerprint: 'test' });
    mocks.buildGenerationContext.mockResolvedValue({
      voiceProfile: { tone: 'direct', topics: ['AI'], antiGoals: [], communicationStyle: 'plain', summary: 'builder' },
      learnings: null,
      style: {},
      recentPosts: [],
      allTweets: [],
      memory: null,
      signals: [],
    });
    mocks.generatePublishingBatchV2.mockResolvedValue([{
      content: 'builderbot keeps shipping receipts in public',
      format: 'relationship',
      targetTopic: 'builderbot',
      rationale: 'Verified relationship post.',
      pipelineVersion: 'v2',
      generationSurface: 'relationship',
      contentProvenance: 'generated_v2',
      generationRunId: 'run-relationship',
      ideaId: 'idea-relationship',
      draftCandidateId: 'draft-relationship',
      evidenceReferences: [],
    }]);
  });

  it('keeps proactive API replies disabled even when a legacy setting is true', async () => {
    const sent = await replyToViralTweets(agent, keys, settings);

    expect(sent).toBe(0);
    expect(mocks.refreshAgentTopicIntelligence).not.toHaveBeenCalled();
    expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });

  it('requires a verified target post and uses the shared relationship publisher', async () => {
    mocks.getAgents.mockResolvedValue([
      agent,
      {
        ...agent,
        id: 'agent-2',
        handle: 'builderbot',
        name: 'Builder Bot',
        soulSummary: `builder voice ${'summary detail '.repeat(40)}SHOUTOUT_SENTINEL`,
      },
    ]);
    mocks.getTweets.mockImplementation(async (agentId: string) => agentId === 'agent-2' ? [{
      id: 'target-post-1',
      agentId: 'agent-2',
      content: 'shipped the new workflow with measured latency receipts',
      type: 'original',
      status: 'posted',
      xTweetId: 'x-target-1',
      createdAt: '2026-07-31T00:00:00.000Z',
      postedAt: '2026-07-31T01:00:00.000Z',
    }] : []);

    const shoutout = await generateAgentShoutout(agent);

    expect(shoutout?.targetHandle).toBe('builderbot');
    expect(mocks.generatePublishingBatchV2).toHaveBeenCalledWith(expect.objectContaining({
      agentId: agent.id,
      request: expect.objectContaining({
        surface: 'relationship',
        targetHandle: 'builderbot',
        targetPost: expect.objectContaining({
          content: 'shipped the new workflow with measured latency receipts',
          url: 'https://x.com/builderbot/status/x-target-1',
        }),
      }),
      modelStack: 'publishing_v2_gpt_control',
    }));
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('backs off proactive trend refresh after a recent X read endpoint failure', async () => {
    mocks.getPostLog.mockResolvedValueOnce([
      {
        id: 'log-1',
        agentId: agent.id,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'trend_refresh_error',
        topic: 'network_growth',
        postedAt: new Date().toISOString(),
        source: 'cron',
        action: 'error',
        reason: 'get_following: Request failed.',
      },
    ]);

    const sent = await replyToViralTweets(agent, keys, settings);

    expect(sent).toBe(0);
    expect(mocks.refreshAgentTopicIntelligence).not.toHaveBeenCalled();
    expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });

  it('backs off auto-follow after a recent following lookup failure', async () => {
    mocks.getPostLog.mockResolvedValueOnce([
      {
        id: 'log-1',
        agentId: agent.id,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'auto_follow_error',
        topic: 'network_growth',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'error',
        errorCode: 'x_rate_limit',
        reason: 'get_following: rate limited by X.',
      },
    ]);

    const followed = await discoverAndFollow(agent, keys, { ...settings, autoFollow: true } as ProtocolSettings);

    expect(followed).toBe(0);
    expect(mocks.getFollowing).not.toHaveBeenCalled();
    expect(mocks.followUser).not.toHaveBeenCalled();
  });

  it('does not pause auto-follow for hours after a non-rate-limit lookup failure', async () => {
    mocks.getPostLog.mockResolvedValueOnce([
      {
        id: 'log-1',
        agentId: agent.id,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'auto_follow_error',
        topic: 'network_growth',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'error',
        errorCode: 'x_unknown',
        reason: 'get_following: Request failed.',
      },
    ]);
    mocks.getFollowing.mockResolvedValue([]);

    await discoverAndFollow(agent, keys, { ...settings, autoFollow: true } as ProtocolSettings);

    expect(mocks.getFollowing).toHaveBeenCalled();
  });

  it('keeps proactive likes disabled even when a legacy setting is true', async () => {
    const liked = await likeNetworkTweets(agent, keys, settings);

    expect(liked).toBe(0);
    expect(mocks.refreshAgentTopicIntelligence).not.toHaveBeenCalled();
    expect(mocks.likeTweet).not.toHaveBeenCalled();
  });

  it('logs reset-aware trend refresh rate limits for network growth', async () => {
    mocks.refreshAgentTopicIntelligence.mockResolvedValue({ topics: [], error: new TwitterActionError({
      action: 'refresh_trending_for_engagement',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }) });

    const followed = await discoverAndFollow(agent, keys, { ...settings, autoFollow: true } as ProtocolSettings);

    expect(followed).toBe(0);
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'trend_refresh_error',
        topic: 'network_growth',
        source: 'cron',
        action: 'error',
        errorCode: 'x_rate_limit',
        reason: expect.stringContaining('X trend refresh rate limited until 2026-04-07T12:20:00.000Z'),
      }),
    );
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        reason: expect.stringContaining('refresh_trending_for_engagement [429 Too Many Requests]: Rate limit exceeded'),
      }),
    );
    expect(mocks.followUser).not.toHaveBeenCalled();
  });

  it('stops auto-follow candidate processing after an X rate limit', async () => {
    mocks.refreshAgentTopicIntelligence.mockResolvedValue({
      error: null,
      topics: [trendingTopic, {
        ...trendingTopic,
        id: 2,
        topTweet: {
          ...trendingTopic.topTweet,
          id: 'tweet-2',
          likes: 160,
          author: 'operator',
        },
      }],
    });
    mocks.getUserByUsername.mockRejectedValue(new TwitterActionError({
      action: 'resolve_user',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));

    const followed = await discoverAndFollow(agent, keys, { ...settings, autoFollow: true } as ProtocolSettings);

    expect(followed).toBe(0);
    expect(mocks.getUserByUsername).toHaveBeenCalledTimes(1);
    expect(mocks.followUser).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'auto_follow_error',
        topic: 'network_growth',
        source: 'autopilot',
        action: 'error',
        errorCode: 'x_rate_limit',
        content: 'Follow @builder',
        reason: expect.stringContaining('X auto-follow rate limited until 2026-04-07T12:20:00.000Z'),
      }),
    );
  });
});
