import { describe, expect, it, vi } from 'vitest';
import { createAgent, createTweet, getFeedback, getTweet } from '@/lib/kv-storage';

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => ({
    user: { id: 'user-1' },
    agent: { id },
  })),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

import { DELETE, PATCH } from '@/app/api/agents/[id]/queue/[tweetId]/route';

describe('queue ownership route guard', () => {
  it('returns 404 when updating a tweet that belongs to another agent', async () => {
    const primaryAgent = await createAgent({
      handle: 'queue-owner-primary',
      name: 'Queue Owner Primary',
      soulMd: '# soul',
    } as any);
    const otherAgent = await createAgent({
      handle: 'queue-owner-other',
      name: 'Queue Owner Other',
      soulMd: '# soul',
    } as any);
    const foreignTweet = await createTweet({
      agentId: otherAgent.id,
      content: 'foreign tweet',
      type: 'original',
      status: 'draft',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const response = await PATCH(
      new Request('http://localhost/api/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'queued' }),
      }) as any,
      { params: Promise.resolve({ id: primaryAgent.id, tweetId: foreignTweet.id }) }
    );

    expect(response.status).toBe(404);
    await expect(getTweet(foreignTweet.id)).resolves.not.toBeNull();
  });

  it('returns 404 when deleting a tweet that belongs to another agent', async () => {
    const primaryAgent = await createAgent({
      handle: 'queue-delete-primary',
      name: 'Queue Delete Primary',
      soulMd: '# soul',
    } as any);
    const otherAgent = await createAgent({
      handle: 'queue-delete-other',
      name: 'Queue Delete Other',
      soulMd: '# soul',
    } as any);
    const foreignTweet = await createTweet({
      agentId: otherAgent.id,
      content: 'foreign delete tweet',
      type: 'original',
      status: 'draft',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const response = await DELETE(
      new Request('http://localhost/api/queue', { method: 'DELETE' }) as any,
      { params: Promise.resolve({ id: primaryAgent.id, tweetId: foreignTweet.id }) }
    );

    expect(response.status).toBe(404);
    await expect(getTweet(foreignTweet.id)).resolves.not.toBeNull();
  });

  it('stores an explicit delete reason as negative feedback', async () => {
    const agent = await createAgent({
      handle: 'queue-delete-feedback',
      name: 'Queue Delete Feedback',
      soulMd: '# soul',
    } as any);
    const queuedTweet = await createTweet({
      agentId: agent.id,
      content: 'delete me with explicit reason',
      type: 'original',
      status: 'queued',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const response = await DELETE(
      new Request('http://localhost/api/queue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Too generic and sounds unlike the operator.' }),
      }) as any,
      { params: Promise.resolve({ id: agent.id, tweetId: queuedTweet.id }) }
    );

    expect(response.status).toBe(200);
    await expect(getTweet(queuedTweet.id)).resolves.toBeNull();

    const feedback = await getFeedback(agent.id);
    expect(feedback.some((entry) =>
      entry.source === 'queue_delete' &&
      entry.reason === 'Too generic and sounds unlike the operator.' &&
      entry.userProvidedReason === true
    )).toBe(true);
  });

  it('infers delete intent when the operator skips a reason', async () => {
    const agent = await createAgent({
      handle: 'queue-delete-infer',
      name: 'Queue Delete Infer',
      soulMd: '# soul',
    } as any);
    const queuedTweet = await createTweet({
      agentId: agent.id,
      content: 'delete me without a reason',
      type: 'original',
      status: 'queued',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const response = await DELETE(
      new Request('http://localhost/api/queue', { method: 'DELETE' }) as any,
      { params: Promise.resolve({ id: agent.id, tweetId: queuedTweet.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.feedbackSource).toBe('inferred');

    const feedback = await getFeedback(agent.id);
    expect(feedback.some((entry) =>
      entry.source === 'queue_delete' &&
      entry.userProvidedReason === false &&
      typeof entry.intentSummary === 'string' &&
      entry.intentSummary.length > 0
    )).toBe(true);
  });
});
