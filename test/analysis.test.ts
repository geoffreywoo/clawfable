import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDeepTimeline: vi.fn(),
  getFollowing: vi.fn(),
}));

vi.mock('@/lib/twitter-client', () => ({
  getDeepTimeline: mocks.getDeepTimeline,
  getFollowing: mocks.getFollowing,
}));

import { analyzeAccount } from '@/lib/analysis';
import { TwitterActionError } from '@/lib/twitter-debug';

const keys = {
  appKey: 'app-key',
  appSecret: 'app-secret',
  accessToken: 'access-token',
  accessSecret: 'access-secret',
};

const timeline = [
  {
    id: 'tweet-1',
    text: 'AI inference costs fell 50% because teams stopped treating evals like optional paperwork',
    likes: 100,
    retweets: 14,
    replies: 6,
    impressions: 5000,
    quotes: 2,
    bookmarks: 12,
    createdAt: '2026-04-07T12:00:00.000Z',
  },
  {
    id: 'tweet-2',
    text: 'Most product teams do not need another dashboard. They need one stronger decision loop.',
    likes: 10,
    retweets: 2,
    replies: 1,
    impressions: 1000,
    quotes: 0,
    bookmarks: 1,
    createdAt: '2026-04-07T18:00:00.000Z',
  },
  {
    id: 'tweet-3',
    text: 'Here is how to debug a growth loop before buying more distribution.',
    likes: 10,
    retweets: 1,
    replies: 0,
    impressions: 900,
    quotes: 0,
    bookmarks: 1,
    createdAt: '2026-04-07T18:30:00.000Z',
  },
  {
    id: 'tweet-4',
    text: 'Your moat is not the feature. It is the compounding taste in the review loop.',
    likes: 10,
    retweets: 2,
    replies: 1,
    impressions: 1000,
    quotes: 0,
    bookmarks: 1,
    createdAt: '2026-04-07T09:00:00.000Z',
  },
];

describe('analyzeAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDeepTimeline.mockResolvedValue(timeline);
    mocks.getFollowing.mockResolvedValue([
      {
        id: 'follow-1',
        name: 'AI Founder',
        username: 'aifounder',
        description: 'Founder building AI systems',
        followersCount: 50000,
        verified: true,
      },
    ]);
  });

  it('keeps timeline learning when the following graph hits an X rate limit', async () => {
    mocks.getFollowing.mockRejectedValue(new TwitterActionError({
      action: 'get_following',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));

    const analysis = await analyzeAccount(keys, 'user-1', 'agent-1');

    expect(analysis.tweetCount).toBe(4);
    expect(analysis.viralTweets.map((tweet) => tweet.id)).toEqual(['tweet-1']);
    expect(analysis.engagementPatterns.topTopics).toContain('AI/ML');
    expect(analysis.followingProfile).toEqual({
      totalFollowing: 0,
      topAccounts: [],
      categories: [],
    });
    expect(analysis.warnings).toHaveLength(1);
    expect(analysis.warnings?.[0]).toContain('Following graph unavailable during analysis');
    expect(analysis.warnings?.[0]).toContain('get_following [429 Too Many Requests]: Rate limit exceeded');
    expect(analysis.contentFingerprint).toContain('Strongest topics: AI/ML');
  });

  it('still fails when timeline learning cannot be fetched', async () => {
    const timelineError = new TwitterActionError({
      action: 'get_user_timeline',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
    });
    mocks.getDeepTimeline.mockRejectedValue(timelineError);

    await expect(analyzeAccount(keys, 'user-1', 'agent-1')).rejects.toBe(timelineError);
  });
});
