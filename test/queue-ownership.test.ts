import { describe, expect, it, vi } from 'vitest';
import { createAgent, createTweet, getFeedback, getTweet, saveFeedback } from '@/lib/kv-storage';

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => ({
    user: { id: 'user-1' },
    agent: { id, name: `Agent ${id}`, soulMd: '# soul' },
  })),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

vi.mock('@/lib/delete-intent', () => ({
  inferDeleteIntent: vi.fn(async ({ tweetText }: { tweetText: string }) => `Inferred intent for: ${tweetText}`),
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
      entry.tweetId === queuedTweet.id &&
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
      entry.tweetId === queuedTweet.id &&
      entry.userProvidedReason === false &&
      typeof entry.intentSummary === 'string' &&
      entry.intentSummary.length > 0
    )).toBe(true);
  });

  it('upserts deleted-from-X feedback when the operator supplies a better reason later', async () => {
    const agent = await createAgent({
      handle: 'queue-delete-from-x-explicit',
      name: 'Queue Delete From X Explicit',
      soulMd: '# soul',
    } as any);
    const deletedTweet = await createTweet({
      agentId: agent.id,
      content: 'tweet deleted from x',
      type: 'original',
      status: 'deleted_from_x',
      topic: 'AI',
      xTweetId: 'x-123',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    await saveFeedback(agent.id, {
      tweetId: deletedTweet.id,
      tweetText: deletedTweet.content,
      rating: 'down',
      generatedAt: '2026-04-01T00:00:00.000Z',
      intentSummary: 'Inferred intent',
      source: 'queue_delete',
      userProvidedReason: false,
    });

    const response = await PATCH(
      new Request('http://localhost/api/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletionReason: 'Too promotional' }),
      }) as any,
      { params: Promise.resolve({ id: agent.id, tweetId: deletedTweet.id }) }
    );

    expect(response.status).toBe(200);

    const feedback = await getFeedback(agent.id);
    const matching = feedback.filter((entry) => entry.tweetId === deletedTweet.id);
    expect(matching.length).toBe(1);
    expect(matching[0].reason).toBe('Too promotional');
    expect(matching[0].userProvidedReason).toBe(true);
  });

  it('stores inferred feedback when a deleted-from-X tweet is skipped', async () => {
    const agent = await createAgent({
      handle: 'queue-delete-from-x-skip',
      name: 'Queue Delete From X Skip',
      soulMd: '# soul',
    } as any);
    const deletedTweet = await createTweet({
      agentId: agent.id,
      content: 'tweet skipped after deletion',
      type: 'original',
      status: 'deleted_from_x',
      topic: 'AI',
      xTweetId: 'x-456',
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const response = await PATCH(
      new Request('http://localhost/api/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletionReason: 'skipped' }),
      }) as any,
      { params: Promise.resolve({ id: agent.id, tweetId: deletedTweet.id }) }
    );

    expect(response.status).toBe(200);

    const updatedTweet = await getTweet(deletedTweet.id);
    expect(updatedTweet?.deletionReason).toBe('skipped');

    const feedback = await getFeedback(agent.id);
    expect(feedback.some((entry) =>
      entry.tweetId === deletedTweet.id &&
      entry.userProvidedReason === false &&
      entry.intentSummary === `Inferred intent for: ${deletedTweet.content}`
    )).toBe(true);
  });
});
