import { describe, expect, it, vi } from 'vitest';
import { createAgent, createTweet } from '@/lib/kv-storage';

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => ({
    user: { id: 'user-1' },
    agent: { id, name: `Agent ${id}`, soulMd: '# soul' },
  })),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

import { GET } from '@/app/api/agents/[id]/queue/route';

describe('queue route', () => {
  it('returns queued items plus unresolved deleted-from-X feedback cards, but not posted tweets', async () => {
    const agent = await createAgent({
      handle: 'queue-route-agent',
      name: 'Queue Route Agent',
      soulMd: '# soul',
    } as any);

    const queuedTweet = await createTweet({
      agentId: agent.id,
      content: 'still queued',
      type: 'original',
      status: 'queued',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const deletedTweet = await createTweet({
      agentId: agent.id,
      content: 'needs deletion feedback',
      type: 'original',
      status: 'deleted_from_x',
      topic: 'AI',
      xTweetId: 'x-123',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const postedTweet = await createTweet({
      agentId: agent.id,
      content: 'already posted',
      type: 'original',
      status: 'posted',
      topic: 'AI',
      xTweetId: 'x-456',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const response = await GET(
      new Request('http://localhost/api/queue') as any,
      { params: Promise.resolve({ id: agent.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.map((tweet: { id: string }) => tweet.id)).toEqual(
      expect.arrayContaining([queuedTweet.id, deletedTweet.id])
    );
    expect(data.map((tweet: { id: string }) => tweet.id)).not.toContain(postedTweet.id);
    expect(data.every((tweet: { status: string }) => tweet.status === 'queued' || tweet.status === 'deleted_from_x')).toBe(true);
  });
});
