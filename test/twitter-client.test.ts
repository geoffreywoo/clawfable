import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tweet: vi.fn(),
  me: vi.fn(),
  TwitterApi: vi.fn(),
}));

vi.mock('twitter-api-v2', () => ({
  default: mocks.TwitterApi,
}));

import { decodeKeys, postTweet, replyToTweet } from '@/lib/twitter-client';

const keys = {
  appKey: 'consumer-key',
  appSecret: 'consumer-secret',
  accessToken: 'access-token',
  accessSecret: 'access-secret',
};

describe('twitter-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.TwitterApi.mockImplementation(function TwitterApiMock() {
      return {
      readWrite: {
        v2: {
          tweet: mocks.tweet,
        },
      },
      v2: {
        me: mocks.me,
      },
      };
    });
    mocks.tweet.mockResolvedValue({ data: { id: 'tweet-123' } });
    mocks.me.mockResolvedValue({ data: { id: 'user-1', name: 'Debug Bot', username: 'debugbot' } });
  });

  it('trims trailing newlines from decoded key material', () => {
    const decoded = decodeKeys({
      apiKey: Buffer.from('consumer-key\n').toString('base64'),
      apiSecret: Buffer.from('consumer-secret\n').toString('base64'),
      accessToken: Buffer.from('access-token').toString('base64'),
      accessSecret: Buffer.from('access-secret\n').toString('base64'),
    });

    expect(decoded).toEqual(keys);
  });

  it('does not call get_me before posting when the account handle is already known', async () => {
    const result = await postTweet(keys, 'ship the write first, read later', { username: '@debugbot' });

    expect(result).toEqual({
      tweetUrl: 'https://x.com/debugbot/status/tweet-123',
      tweetId: 'tweet-123',
      username: 'debugbot',
    });
    expect(mocks.me).not.toHaveBeenCalled();
    expect(mocks.tweet).toHaveBeenCalledWith('ship the write first, read later');
  });

  it('does not call get_me before replying when the account handle is already known', async () => {
    const result = await replyToTweet(
      keys,
      'exactly. write-path reads are reliability debt https://x.com/debugbot/status/111',
      'mention-1',
      { username: 'debugbot' },
    );

    expect(result.tweetUrl).toBe('https://x.com/debugbot/status/tweet-123');
    expect(mocks.me).not.toHaveBeenCalled();
    expect(mocks.tweet).toHaveBeenCalledWith('exactly. write-path reads are reliability debt', {
      reply: { in_reply_to_tweet_id: 'mention-1' },
    });
  });

  it('falls back to get_me when no username is supplied', async () => {
    const result = await postTweet(keys, 'fallback path still works');

    expect(mocks.me).toHaveBeenCalledOnce();
    expect(result.username).toBe('debugbot');
  });
});
