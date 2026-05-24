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
}));

vi.mock('@/lib/ai', () => ({
  generateText: mocks.generateText,
}));

import { discoverAndFollow, likeNetworkTweets, replyToViralTweets } from '@/lib/proactive-engagement';
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
    vi.clearAllMocks();
    mocks.getTrendingCache.mockResolvedValue(null);
    mocks.fetchTrendingFromFollowing.mockResolvedValue([trendingTopic]);
    mocks.getPostLog.mockResolvedValue([]);
    mocks.getAnalysis.mockResolvedValue(null);
    mocks.generateText.mockResolvedValue({ text: 'The real shift is agents getting judged by throughput, not demos.' });
    mocks.replyToTweet.mockResolvedValue({ tweetId: 'reply-1', username: 'geoffreywoo' });
    mocks.likeTweet.mockResolvedValue(undefined);
  });

  it('keeps proactive API replies disabled even when a legacy setting is true', async () => {
    const sent = await replyToViralTweets(agent, keys, settings);

    expect(sent).toBe(0);
    expect(mocks.fetchTrendingFromFollowing).not.toHaveBeenCalled();
    expect(mocks.replyToTweet).not.toHaveBeenCalled();
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
});
