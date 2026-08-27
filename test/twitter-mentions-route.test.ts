import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterActionError } from '@/lib/twitter-debug';

const mocks = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
  createMention: vi.fn(),
  getRecentMentions: vi.fn(),
  addPostLogEntry: vi.fn(),
  invalidateAgentConnection: vi.fn(),
  getMentionsFromTwitter: vi.fn(),
  getLatestTwitterTweetIdCursor: vi.fn((items: Array<{ tweetId?: string | number | null }>) => {
    let latest: { raw: string; value: bigint } | null = null;
    for (const item of items) {
      const raw = String(item.tweetId ?? '').trim();
      if (!/^\d+$/.test(raw)) continue;
      const value = BigInt(raw);
      if (!latest || value > latest.value) latest = { raw, value };
    }
    return latest?.raw;
  }),
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

vi.mock('@/lib/kv-storage', () => ({
  createMention: mocks.createMention,
  getRecentMentions: mocks.getRecentMentions,
  addPostLogEntry: mocks.addPostLogEntry,
  invalidateAgentConnection: mocks.invalidateAgentConnection,
}));

vi.mock('@/lib/twitter-client', () => ({
  getMentionsFromTwitter: mocks.getMentionsFromTwitter,
  getLatestTwitterTweetIdCursor: mocks.getLatestTwitterTweetIdCursor,
  decodeKeys: mocks.decodeKeys,
}));

import { GET } from '@/app/api/agents/[id]/twitter/mentions/route';

const agent = {
  id: 'agent-mentions-1',
  handle: 'mentionsbot',
  name: 'Mentions Bot',
  isConnected: 1,
  apiKey: 'encoded-app-key',
  apiSecret: 'encoded-app-secret',
  accessToken: 'encoded-access-token',
  accessSecret: 'encoded-access-secret',
  xUserId: 'x-user-1',
};

describe('twitter mentions route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });
    mocks.getRecentMentions.mockResolvedValue([]);
    mocks.getMentionsFromTwitter.mockResolvedValue([]);
    mocks.createMention.mockResolvedValue(undefined);
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.invalidateAgentConnection.mockResolvedValue(undefined);
  });

  it('disconnects the agent when X rejects mention credentials', async () => {
    mocks.getMentionsFromTwitter.mockRejectedValue(new TwitterActionError({
      action: 'fetch_mentions',
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Invalid or expired token.',
    }));

    const response = await GET(
      new Request('http://localhost/api/agents/agent-mentions-1/twitter/mentions') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.invalidateAgentConnection).toHaveBeenCalledWith(agent.id);
  });

  it('uses the highest stored mention id for since_id even if local rows are unsorted', async () => {
    mocks.getRecentMentions
      .mockResolvedValueOnce([
        { tweetId: '100', createdAt: '2026-05-25T15:00:00.000Z' },
        { tweetId: '300', createdAt: '2026-05-25T14:00:00.000Z' },
        { tweetId: '200', createdAt: '2026-05-25T16:00:00.000Z' },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(
      new Request('http://localhost/api/agents/agent-mentions-1/twitter/mentions') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getMentionsFromTwitter).toHaveBeenCalledWith(
      expect.anything(),
      agent.xUserId,
      '300',
    );
  });
});
