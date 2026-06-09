import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTrendingCache: vi.fn(),
  setTrendingCache: vi.fn(),
  getPostLog: vi.fn(),
  getAnalysis: vi.fn(),
  addPostLogEntry: vi.fn(),
  getAgents: vi.fn(),
  getPerformanceHistory: vi.fn(),
  fetchTrendingFromFollowing: vi.fn(),
  replyToTweet: vi.fn(),
  likeTweet: vi.fn(),
  followUser: vi.fn(),
  getFollowing: vi.fn(),
  getUserByUsername: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getTrendingCache: mocks.getTrendingCache,
  setTrendingCache: mocks.setTrendingCache,
  getPostLog: mocks.getPostLog,
  getAnalysis: mocks.getAnalysis,
  addPostLogEntry: mocks.addPostLogEntry,
  getAgents: mocks.getAgents,
  getPerformanceHistory: mocks.getPerformanceHistory,
}));

vi.mock('@/lib/trending', () => ({
  fetchTrendingFromFollowing: mocks.fetchTrendingFromFollowing,
}));

vi.mock('@/lib/twitter-client', () => ({
  replyToTweet: mocks.replyToTweet,
  likeTweet: mocks.likeTweet,
  followUser: mocks.followUser,
  getFollowing: mocks.getFollowing,
  getUserByUsername: mocks.getUserByUsername,
}));

vi.mock('@/lib/ai', () => ({
  generateText: mocks.generateText,
}));

import { discoverAndFollow, formatPeerStyleTweetList, generateAgentShoutout, likeNetworkTweets, replyToViralTweets, studyPeerStyles } from '@/lib/proactive-engagement';
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
    mocks.fetchTrendingFromFollowing.mockResolvedValue([trendingTopic]);
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
  });

  it('keeps proactive API replies disabled even when a legacy setting is true', async () => {
    const sent = await replyToViralTweets(agent, keys, settings);

    expect(sent).toBe(0);
    expect(mocks.fetchTrendingFromFollowing).not.toHaveBeenCalled();
    expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });

  it('compacts peer style tweets before classification prompts', () => {
    const list = formatPeerStyleTweetList(Array.from({ length: 8 }, (_, index) => ({
      author: `builder${index + 1}`,
      likes: 200 - index,
      text: `peer tweet ${index + 1} ${'with repeated style context '.repeat(20)}PEER_SENTINEL_${index + 1}`,
    })));

    expect(list).toContain('@builder1');
    expect(list).toContain('@builder6');
    expect(list).not.toContain('@builder7');
    expect(list).not.toContain('PEER_SENTINEL_1');
    expect(list).toContain('...');
  });

  it('uses compact peer style prompts and smaller output budget', async () => {
    mocks.getTrendingCache.mockResolvedValue(Array.from({ length: 8 }, (_, index) => ({
      ...trendingTopic,
      id: index + 1,
      topTweet: {
        id: `peer-${index + 1}`,
        text: `peer tweet ${index + 1} ${'with repeated style context '.repeat(20)}PEER_SENTINEL_${index + 1}`,
        likes: 200 - index,
        author: `builder${index + 1}`,
      },
    })));
    mocks.generateText.mockResolvedValue({
      text: '- Tweets that open with concrete mechanisms get more replies\n- Short proof beats abstract claims',
    });

    const insights = await studyPeerStyles(agent);

    const call = mocks.generateText.mock.calls[0]?.[0];
    expect(call).toEqual(expect.objectContaining({
      task: 'classification',
      tier: 'fast',
      maxTokens: 384,
    }));
    expect(call.prompt).toContain('@builder6');
    expect(call.prompt).not.toContain('@builder7');
    expect(call.prompt).not.toContain('PEER_SENTINEL_1');
    expect(insights).toContain('Tweets that open with concrete mechanisms get more replies');
  });

  it('uses compact shoutout summaries and smaller output budget', async () => {
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
    mocks.generateText.mockResolvedValue({ text: 'builderbot keeps shipping receipts in public' });

    const shoutout = await generateAgentShoutout(agent);

    const call = mocks.generateText.mock.calls[0]?.[0];
    expect(shoutout?.targetHandle).toBe('builderbot');
    expect(call).toEqual(expect.objectContaining({
      task: 'tweet_generation',
      tier: 'quality',
      maxTokens: 128,
    }));
    expect(call.prompt).toContain('@builderbot');
    expect(call.prompt).not.toContain('SHOUTOUT_SENTINEL');
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
    expect(mocks.fetchTrendingFromFollowing).not.toHaveBeenCalled();
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
        reason: 'get_following: Request failed.',
      },
    ]);

    const followed = await discoverAndFollow(agent, keys, { ...settings, autoFollow: true } as ProtocolSettings);

    expect(followed).toBe(0);
    expect(mocks.getFollowing).not.toHaveBeenCalled();
    expect(mocks.followUser).not.toHaveBeenCalled();
  });

  it('keeps proactive likes disabled even when a legacy setting is true', async () => {
    const liked = await likeNetworkTweets(agent, keys, settings);

    expect(liked).toBe(0);
    expect(mocks.fetchTrendingFromFollowing).not.toHaveBeenCalled();
    expect(mocks.likeTweet).not.toHaveBeenCalled();
  });

  it('logs reset-aware trend refresh rate limits for network growth', async () => {
    mocks.fetchTrendingFromFollowing.mockRejectedValue(new TwitterActionError({
      action: 'refresh_trending_for_engagement',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));

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
    mocks.fetchTrendingFromFollowing.mockResolvedValue([
      trendingTopic,
      {
        ...trendingTopic,
        id: 2,
        topTweet: {
          ...trendingTopic.topTweet,
          id: 'tweet-2',
          likes: 160,
          author: 'operator',
        },
      },
    ]);
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
