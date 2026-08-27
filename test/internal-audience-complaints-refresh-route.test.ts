import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backfillAudienceVoiceComplaints: vi.fn(),
  createMention: vi.fn(),
  fetchTweetById: vi.fn(),
  getAgent: vi.fn(),
  getTweets: vi.fn(),
  resetReadCache: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  backfillAudienceVoiceComplaints: mocks.backfillAudienceVoiceComplaints,
  createMention: mocks.createMention,
  getAgent: mocks.getAgent,
  getTweets: mocks.getTweets,
  resetReadCache: mocks.resetReadCache,
}));

vi.mock('@/lib/twitter-client', () => ({
  decodeKeys: () => ({
    appKey: 'app-key',
    appSecret: 'app-secret',
    accessToken: 'access-token',
    accessSecret: 'access-secret',
  }),
  fetchTweetById: mocks.fetchTweetById,
}));

import { POST } from '@/app/api/internal/agents/[id]/audience/complaints/refresh/route';

function request(tweetIds: string[], secret = 'test-cron-secret'): Request {
  return new Request('http://localhost/api/internal/agents/13/audience/complaints/refresh', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tweetIds }),
  });
}

describe('internal audience complaint refresh route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.getAgent.mockResolvedValue({
      id: '13',
      apiKey: 'encoded-api-key',
      apiSecret: 'encoded-api-secret',
      accessToken: 'encoded-access-token',
      accessSecret: 'encoded-access-secret',
    });
    mocks.fetchTweetById.mockResolvedValue({
      id: '2069114250891612174',
      text: 'this is AI slop and does not sound like you',
      authorId: 'reader-id',
      authorUsername: 'reader',
      likes: 4,
      createdAt: '2026-06-22T00:00:00.000Z',
      inReplyToId: '2069000000000000000',
    });
    mocks.getTweets.mockResolvedValue([{ id: 'parent-1', xTweetId: '2069000000000000000' }]);
    mocks.createMention.mockResolvedValue({ id: 'mention-1' });
    mocks.backfillAudienceVoiceComplaints.mockResolvedValue({ scanned: 1, matched: 1, added: 0, total: 1 });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('requires internal authentication', async () => {
    const response = await POST(request(['2069114250891612174'], 'wrong') as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.fetchTweetById).not.toHaveBeenCalled();
  });

  it('uses the official X lookup and stores a parent-linked reply for metric classification', async () => {
    const response = await POST(request(['2069114250891612174']) as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.fetchTweetById).toHaveBeenCalledWith(expect.any(Object), '2069114250891612174');
    expect(mocks.createMention).toHaveBeenCalledWith(expect.objectContaining({
      agentId: '13',
      tweetId: '2069114250891612174',
      inReplyToTweetId: '2069000000000000000',
      authorHandle: '@reader',
    }));
    expect(data).toMatchObject({
      requested: 1,
      fetched: 1,
      parentLinkedReplies: 1,
      complaints: { total: 1 },
    });
  });

  it('does not ingest a reply whose parent is not one of the agent posts', async () => {
    mocks.getTweets.mockResolvedValue([]);

    const response = await POST(request(['2069114250891612174']) as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createMention).not.toHaveBeenCalled();
    expect(data).toMatchObject({
      fetched: 1,
      parentLinkedReplies: 0,
      missingOrIneligibleTweetIds: ['2069114250891612174'],
    });
  });
});
