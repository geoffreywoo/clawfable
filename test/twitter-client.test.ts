import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  tweet: vi.fn(),
  userTimeline: vi.fn(),
  userMentionTimeline: vi.fn(),
}));

vi.mock('twitter-api-v2', () => ({
  default: class TwitterApiMock {
    v2 = {
      me: mocks.me,
      userTimeline: mocks.userTimeline,
      userMentionTimeline: mocks.userMentionTimeline,
    };

    readWrite = {
      v2: {
        tweet: mocks.tweet,
      },
    };

    async appLogin() {
      return this;
    }
  },
}));

import { decodeKeys, getDeepTimeline, getLatestTwitterTweetIdCursor, getMentionsFromTwitter, getSanitizedTweetTextIssue, postTweet, replyToTweet, sanitizeTweetText } from '@/lib/twitter-client';

const keys = {
  appKey: 'consumer-key',
  appSecret: 'consumer-secret',
  accessToken: 'access-token',
  accessSecret: 'access-secret',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.me.mockResolvedValue({
    data: {
      id: 'user-1',
      name: 'Debug Bot',
      username: 'debugbot',
    },
  });
  mocks.tweet.mockResolvedValue({
    data: {
      id: 'tweet-123',
    },
  });
  mocks.userMentionTimeline.mockResolvedValue({
    data: {
      data: [],
      includes: { users: [] },
      meta: {},
    },
    done: true,
    fetchLast: vi.fn(),
  });
  mocks.userTimeline.mockResolvedValue({
    data: {
      data: [],
      meta: {},
    },
  });
});

describe('twitter-client', () => {

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

describe('sanitizeTweetText', () => {
  it('strips hallucinated X status URLs without removing ordinary links', () => {
    expect(
      sanitizeTweetText('read the failure mode https://x.com/fake/status/123456789 and fix the recovery path')
    ).toBe('read the failure mode and fix the recovery path');

    expect(
      sanitizeTweetText('context https://twitter.com/i/web/status/987654321\n\nkeep this https://example.com/proof')
    ).toBe('context\n\nkeep this https://example.com/proof');
  });

  it('reports when sanitizer removes all postable text', () => {
    expect(getSanitizedTweetTextIssue('https://x.com/fake/status/123456789', 'post')).toContain('Tweet text is empty');
    expect(getSanitizedTweetTextIssue('real point https://x.com/fake/status/123456789', 'reply')).toBeNull();
  });

  it('reports internal prompt leaks before posting', () => {
    const issue = getSanitizedTweetTextIssue([
      'The real edge is tighter feedback loops, faster iteration, and clearer taste.',
      '',
      '## OPERATOR VOICE REFERENCE (manual/operator-written tweets are high-signal — match voice, sentiment, tone, topic boundaries, and rhythm)',
    ].join('\n'), 'post');

    expect(issue).toContain('Internal prompt leak gate');
  });
});

describe('getLatestTwitterTweetIdCursor', () => {
  it('uses the highest numeric tweet id instead of relying on storage order', () => {
    expect(getLatestTwitterTweetIdCursor([
      { tweetId: '1999999999999999999' },
      { tweetId: '2000000000000000001' },
      { tweetId: '2000000000000000000' },
    ])).toBe('2000000000000000001');
  });

  it('ignores missing and non-numeric ids', () => {
    expect(getLatestTwitterTweetIdCursor([
      { tweetId: null },
      { tweetId: 'not-a-tweet-id' },
      {},
    ])).toBeUndefined();
  });
});

describe('getMentionsFromTwitter', () => {
  it('paginates mentions so viral bursts do not skip older new replies', async () => {
    const timeline = {
      data: {
        data: [
          {
            id: '200',
            text: 'newest question',
            author_id: 'author-2',
            created_at: '2026-04-07T12:02:00.000Z',
            conversation_id: 'conv-2',
          },
        ],
        includes: {
          users: [
            { id: 'author-2', name: 'Newest', username: 'newest' },
          ],
        },
        meta: {
          next_token: 'page-2',
        },
      },
      done: false,
      fetchLast: vi.fn(async (count: number) => {
        expect(count).toBe(1);
        timeline.data.data.push({
          id: '199',
          text: 'older question that would be skipped without pagination',
          author_id: 'author-1',
          created_at: '2026-04-07T12:01:00.000Z',
          conversation_id: 'conv-1',
        });
        timeline.data.includes.users.push({ id: 'author-1', name: 'Older', username: 'older' });
        timeline.data.meta.next_token = undefined as unknown as string;
        timeline.done = true;
        return timeline;
      }),
    };
    mocks.userMentionTimeline.mockResolvedValue(timeline);

    const mentions = await getMentionsFromTwitter(
      {
        appKey: 'app-key',
        appSecret: 'app-secret',
        accessToken: 'access-token',
        accessSecret: 'access-secret',
      },
      'managed-user',
      '198',
      2,
    );

    expect(mocks.userMentionTimeline).toHaveBeenCalledWith(
      'managed-user',
      expect.objectContaining({
        since_id: '198',
        max_results: 2,
      }),
    );
    expect(timeline.fetchLast).toHaveBeenCalledWith(1);
    expect(mentions.map((mention) => mention.id)).toEqual(['200', '199']);
    expect(mentions[1]).toMatchObject({
      authorName: 'Older',
      authorUsername: 'older',
      conversationId: 'conv-1',
    });
  });
});

describe('getDeepTimeline', () => {
  it('throws a normalized X error when the first timeline page fails', async () => {
    mocks.userTimeline.mockRejectedValue({
      code: 429,
      data: {
        title: 'Too Many Requests',
        detail: 'Rate limit exceeded',
      },
    });

    await expect(
      getDeepTimeline(
        {
          appKey: 'app-key',
          appSecret: 'app-secret',
          accessToken: 'access-token',
          accessSecret: 'access-secret',
        },
        'managed-user',
      )
    ).rejects.toMatchObject({
      name: 'TwitterActionError',
      action: 'get_user_timeline',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      context: {
        targetUserId: 'managed-user',
      },
    });
  });

  it('keeps partial timeline learning when a later page fails', async () => {
    mocks.userTimeline
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: '200',
              text: 'first strong post',
              created_at: '2026-04-07T12:00:00.000Z',
              public_metrics: {
                like_count: 25,
                retweet_count: 4,
                reply_count: 2,
                impression_count: 1000,
                quote_count: 1,
                bookmark_count: 8,
              },
            },
          ],
          meta: {
            next_token: 'page-2',
          },
        },
      })
      .mockRejectedValueOnce({
        code: 503,
        data: {
          title: 'Service Unavailable',
          detail: 'Temporary X outage',
        },
      });

    const timeline = await getDeepTimeline(
      {
        appKey: 'app-key',
        appSecret: 'app-secret',
        accessToken: 'access-token',
        accessSecret: 'access-secret',
      },
      'managed-user',
      200,
    );

    expect(timeline).toEqual([
      {
        id: '200',
        text: 'first strong post',
        createdAt: '2026-04-07T12:00:00.000Z',
        likes: 25,
        retweets: 4,
        replies: 2,
        impressions: 1000,
        quotes: 1,
        bookmarks: 8,
      },
    ]);
    expect(mocks.userTimeline).toHaveBeenNthCalledWith(
      2,
      'managed-user',
      expect.objectContaining({
        pagination_token: 'page-2',
      }),
    );
  });
});

describe('replyToTweet', () => {
  it('sanitizes hallucinated status URLs before posting replies', async () => {
    await replyToTweet(
      {
        appKey: 'app-key',
        appSecret: 'app-secret',
        accessToken: 'access-token',
        accessSecret: 'access-secret',
      },
      'Good question https://x.com/fake/status/123456789. The issue is memory drift.',
      'parent-1',
    );

    expect(mocks.tweet).toHaveBeenCalledWith(
      'Good question The issue is memory drift.',
      { reply: { in_reply_to_tweet_id: 'parent-1' } },
    );
  });

  it('rejects replies that become empty after sanitizing before calling X', async () => {
    await expect(
      replyToTweet(
        {
          appKey: 'app-key',
          appSecret: 'app-secret',
          accessToken: 'access-token',
          accessSecret: 'access-secret',
        },
        'https://x.com/fake/status/123456789',
        'parent-1',
      )
    ).rejects.toThrow('Reply text is empty');

    expect(mocks.me).not.toHaveBeenCalled();
    expect(mocks.tweet).not.toHaveBeenCalled();
  });

  it('rejects replies with internal prompt text before calling X', async () => {
    await expect(
      replyToTweet(
        {
          appKey: 'app-key',
          appSecret: 'app-secret',
          accessToken: 'access-token',
          accessSecret: 'access-secret',
        },
        'Fair point.\n\n## OPERATOR VOICE REFERENCE\nVoice anchors:',
        'parent-1',
      )
    ).rejects.toThrow('Internal prompt leak gate');

    expect(mocks.me).not.toHaveBeenCalled();
    expect(mocks.tweet).not.toHaveBeenCalled();
  });
});
