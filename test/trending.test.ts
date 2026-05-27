import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFollowing: vi.fn(),
  getUserTimeline: vi.fn(),
}));

vi.mock('@/lib/twitter-client', () => ({
  getFollowing: mocks.getFollowing,
  getUserTimeline: mocks.getUserTimeline,
}));

import { fetchTrendingFromFollowing } from '@/lib/trending';
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
    mocks.getFollowing.mockResolvedValue([
      { id: 'followed-1', username: 'builder', followersCount: 10000 },
      { id: 'followed-2', username: 'operator', followersCount: 9000 },
    ]);
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
});
