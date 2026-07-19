import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFollowing: vi.fn(),
  getHomeTimeline: vi.fn(),
  getUserTimeline: vi.fn(),
}));

vi.mock('@/lib/twitter-client', () => ({
  getFollowing: mocks.getFollowing,
  getHomeTimeline: mocks.getHomeTimeline,
  getUserTimeline: mocks.getUserTimeline,
}));

import { classifyTrendCategory, fetchCurrentTrends, fetchHackerNewsTopics, fetchTrendingFromFollowing, isLowSignalXCommentary, mergeTrendingTopics, normalizeHackerNewsHeadline } from '@/lib/trending';
import { getTwitterRateLimitResetAt, isRateLimitTwitterError, TwitterActionError } from '@/lib/twitter-debug';

describe('fetchTrendingFromFollowing', () => {
  const keys = {
    appKey: 'key',
    appSecret: 'secret',
    accessToken: 'token',
    accessSecret: 'access-secret',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
    mocks.getFollowing.mockResolvedValue([
      { id: 'followed-1', name: 'Builder', username: 'builder', description: 'AI startup founder', followersCount: 10000, verified: true },
      { id: 'followed-2', name: 'Operator', username: 'operator', description: 'Venture investor and engineer', followersCount: 9000, verified: false },
    ]);
    mocks.getHomeTimeline.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves X rate-limit metadata when all followed timelines fail', async () => {
    mocks.getUserTimeline.mockRejectedValue(new TwitterActionError({
      action: 'get_user_timeline',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));

    let caught: unknown = null;
    try {
      await fetchTrendingFromFollowing(keys, 'agent-user-1');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TwitterActionError);
    expect(isRateLimitTwitterError(caught)).toBe(true);
    expect(getTwitterRateLimitResetAt(caught)).toBe('2026-04-07T12:20:00.000Z');
    expect(mocks.getUserTimeline).toHaveBeenCalledTimes(2);
  });

  it('drops old pinned posts before engagement ranking', async () => {
    mocks.getUserTimeline.mockImplementation(async (_keys: unknown, userId: string) => userId === 'followed-1'
      ? [{
          id: 'old-pinned',
          text: 'From zero to one: startup ideas from 2014',
          likes: 13000,
          retweets: 2000,
          createdAt: '2014-09-08T12:00:00.000Z',
        }]
      : [{
          id: 'fresh-round',
          text: 'We raised a Series A to qualify a new inference ASIC package.',
          likes: 80,
          retweets: 12,
          createdAt: '2026-07-14T08:00:00.000Z',
        }]);

    const topics = await fetchTrendingFromFollowing(keys, 'agent-user-1');

    expect(topics).toHaveLength(1);
    expect(topics[0].topTweet?.id).toBe('fresh-round');
    expect(topics[0].sourceUrl).toBe('https://x.com/operator/status/fresh-round');
    expect(topics[0].timestamp).toBe('2026-07-14T08:00:00.000Z');
  });

  it('matches YC as a token and never as the middle of NYCMayor', () => {
    expect(classifyTrendCategory('NYCMayor announces a new housing policy')).toBeNull();
    expect(classifyTrendCategory('YC startup founders released a robotics benchmark')).toBe('startups');
  });

  it('does not turn company names or reply banter into technology news', () => {
    expect(classifyTrendCategory('Congrats on your use of a ruler and Microsoft Paint.')).toBeNull();
    expect(isLowSignalXCommentary('Thanks, Choco. I have been called worse by better.')).toBe(true);
    expect(isLowSignalXCommentary('Would not be surprised if OpenAI crumbles and never makes it to IPO.')).toBe(true);
    expect(isLowSignalXCommentary('OpenAI published a new inference benchmark with measured latency.')).toBe(false);
  });

  it('normalizes headline price typography without inventing a negative cost', () => {
    expect(normalizeHackerNewsHeadline(
      'Show HN: I RL-trained an agent that trains models with RL (for –$1.3k)',
    )).toBe('Show HN: I RL-trained an agent that trains models with RL (for about $1.3k)');
  });

  it('preserves date, publisher, and URL from fresh Hacker News stories', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const responses = new Map<string, unknown>([
      ['topstories.json', [101, 102, 103, 104]],
      ['item/101.json', {
        id: 101,
        type: 'story',
        title: 'New inference ASIC startup publishes its memory bandwidth benchmark',
        url: 'https://example.com/asic-benchmark',
        time: nowSeconds - 3600,
        score: 180,
        descendants: 42,
      }],
      ['item/102.json', {
        id: 102,
        type: 'story',
        title: 'A very old software story',
        url: 'https://old.example/story',
        time: nowSeconds - 10 * 24 * 3600,
        score: 900,
      }],
      ['item/103.json', {
        id: 103,
        type: 'story',
        title: 'City election polling update',
        time: nowSeconds - 1200,
        score: 500,
      }],
      ['item/104.json', {
        id: 104,
        type: 'story',
        title: 'Startup claims a revolutionary battery manufacturing breakthrough',
        url: 'https://tech.supercarblondie.com/battery-breakthrough',
        time: nowSeconds - 600,
        score: 800,
      }],
    ]);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const match = [...responses.entries()].find(([suffix]) => url.endsWith(suffix));
      return {
        ok: Boolean(match),
        status: match ? 200 : 404,
        json: async () => match?.[1],
      };
    }) as unknown as typeof fetch;

    const topics = await fetchHackerNewsTopics(fetchMock);

    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      category: 'compute',
      sourceType: 'hacker_news',
      sourceUrl: 'https://example.com/asic-benchmark',
      publisher: 'example.com',
    });
    expect(topics.some((topic) => topic.sourceUrl?.includes('supercarblondie.com'))).toBe(false);
  });

  it('keeps fresh X discovery when the public news source is unavailable', async () => {
    mocks.getUserTimeline.mockResolvedValue([{
      id: 'x-fresh',
      text: 'A robotics startup released a new force-control benchmark.',
      likes: 50,
      retweets: 8,
      createdAt: '2026-07-14T10:00:00.000Z',
    }]);
    const failedFetch = vi.fn(async () => { throw new Error('HN unavailable'); }) as unknown as typeof fetch;

    const topics = await fetchCurrentTrends(keys, 'agent-user-1', failedFetch);

    expect(topics.length).toBeGreaterThan(0);
    expect(topics.every((topic) => topic.sourceType === 'x')).toBe(true);
  });

  it('keeps followed-network subjects ahead of a higher-scoring publisher feed', () => {
    const network = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      headline: `Network subject ${index} exposes a distinct production constraint`,
      source: `@source${index}`,
      relevanceScore: 70 - index,
      category: `learned subject ${index}`,
      timestamp: '2026-07-14T10:00:00.000Z',
      tweetCount: 2,
      sourceType: 'x' as const,
      sourceUrl: `https://x.com/source${index}/status/${index}`,
      discoveryMethod: 'followed_network' as const,
      networkTopicId: `network-${index}`,
      topTweet: { id: `x-${index}`, text: `network evidence ${index}`, likes: 80, author: `source${index}` },
    }));
    const publisher = Array.from({ length: 8 }, (_, index) => ({
      id: index + 20,
      headline: `Publisher story ${index} about a different technology`,
      source: 'Hacker News',
      relevanceScore: 99 - index,
      category: `publisher category ${index}`,
      timestamp: '2026-07-14T10:00:00.000Z',
      tweetCount: 0,
      sourceType: 'hacker_news' as const,
      sourceUrl: `https://example.com/story-${index}`,
    }));

    const merged = mergeTrendingTopics([network, publisher], 12);

    expect(merged.filter((topic) => topic.discoveryMethod === 'followed_network')).toHaveLength(8);
    expect(merged[0].discoveryMethod).toBe('followed_network');
  });
});
