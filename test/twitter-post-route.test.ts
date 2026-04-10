import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent, createTweet, getLearningSignals, getTweet } from '@/lib/kv-storage';

const mocks = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
  postTweet: vi.fn(),
  replyToTweet: vi.fn(),
  decodeKeys: vi.fn(() => ({
    appKey: 'app-key',
    appSecret: 'app-secret',
    accessToken: 'access-token',
    accessSecret: 'access-secret',
  })),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: mocks.requireAgentAccess,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/twitter-client', () => ({
  postTweet: mocks.postTweet,
  replyToTweet: mocks.replyToTweet,
  decodeKeys: mocks.decodeKeys,
}));

import { POST } from '@/app/api/agents/[id]/twitter/post/route';

describe('twitter post route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks and quarantines incomplete manual posts before they reach X', async () => {
    const agent = await createAgent({
      handle: 'manual-post-guard',
      name: 'Manual Post Guard',
      soulMd: '# soul',
      apiKey: 'encoded-app-key',
      apiSecret: 'encoded-app-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
      isConnected: 1,
      xUserId: 'x-guard-1',
    } as any);

    const tweet = await createTweet({
      agentId: agent.id,
      content: 'psa to every vc partner still doing "pattern matching":\n\n' +
        'your entire investment thesis just became obsolete\n\n' +
        "while you're scheduling 47 coffee meetings to evaluate one deal, mythos agents are processing 10k startups per day with better accuracy than y",
      type: 'original',
      status: 'queued',
      topic: 'vc',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    mocks.requireAgentAccess.mockResolvedValue({
      user: { id: 'user-1' },
      agent,
    });

    const response = await POST(
      new Request('http://localhost/api/agents/twitter/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
      }) as any,
      { params: Promise.resolve({ id: agent.id }) }
    );

    const data = await response.json();
    const updatedTweet = await getTweet(tweet.id);
    const signals = await getLearningSignals(agent.id, 10);

    expect(response.status).toBe(422);
    expect(String(data.error)).toContain('mid-word or mid-thought');
    expect(mocks.postTweet).not.toHaveBeenCalled();
    expect(updatedTweet?.quarantinedAt).toBeTruthy();
    expect(updatedTweet?.quarantineReason).toContain('mid-word or mid-thought');
    expect(signals.some((signal) =>
      signal.tweetId === tweet.id
      && signal.signalType === 'x_post_rejected'
      && signal.surface === 'manual_post'
    )).toBe(true);
  });
});
