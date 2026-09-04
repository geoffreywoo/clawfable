import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ singleTweet: vi.fn() }));
vi.mock('twitter-api-v2', () => ({ default: class { v2 = { singleTweet: mocks.singleTweet }; } }));
import { lookupTweetAvailability } from '@/lib/twitter-client';
const keys = { appKey: 'test', appSecret: 'test', accessToken: 'test', accessSecret: 'test' };
describe('typed tweet availability', () => {
  beforeEach(() => vi.clearAllMocks());
  it('confirms presence and exact resource-not-found errors', async () => {
    mocks.singleTweet.mockResolvedValueOnce({ data: { id: '123' } });
    expect((await lookupTweetAvailability(keys, '123')).status).toBe('present');
    mocks.singleTweet.mockResolvedValueOnce({ errors: [{ type: 'https://api.twitter.com/2/problems/resource-not-found', resource_id: '123', resource_type: 'tweet' }] });
    expect((await lookupTweetAvailability(keys, '123')).status).toBe('not_found');
  });
  it.each([401, 403, 404, 429, 500])('keeps HTTP %s failures unknown', async (code) => {
    mocks.singleTweet.mockRejectedValueOnce({ code });
    expect((await lookupTweetAvailability(keys, '123')).status).toBe('unavailable');
  });
  it('keeps empty data and a different missing resource unknown', async () => {
    mocks.singleTweet.mockResolvedValueOnce({ data: undefined });
    expect((await lookupTweetAvailability(keys, '123')).status).toBe('unavailable');
    mocks.singleTweet.mockRejectedValueOnce({ data: { errors: [{ type: 'https://api.twitter.com/2/problems/resource-not-found', resource_id: '999', resource_type: 'tweet' }] } });
    expect((await lookupTweetAvailability(keys, '123')).status).toBe('unavailable');
  });
});
