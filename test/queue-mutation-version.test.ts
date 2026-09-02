import { describe, expect, it, vi } from 'vitest';
import {
  createAgent,
  createTweet,
  getQueueVersion,
} from '@/lib/kv-storage';

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => ({
    user: { id: 'user-1' },
    agent: { id, name: `Agent ${id}`, handle: `agent${id}`, soulMd: '# soul' },
  })),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

vi.mock('@/lib/delete-intent', () => ({
  inferDeleteIntent: vi.fn(async ({ tweetText }: { tweetText: string }) => `Inferred intent for: ${tweetText}`),
}));

vi.mock('@/lib/automation-entitlement', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation-entitlement')>('@/lib/automation-entitlement');
  return {
    ...actual,
    assertAgentAutomationEntitlement: vi.fn(async () => ({
      source: 'agent_exemption',
      eligible: true,
      reason: 'test exemption',
      verifiedAt: new Date().toISOString(),
      paidThrough: null,
      paidInvoiceId: null,
      paidAmountCents: null,
      paidCurrency: null,
    })),
  };
});

import { DELETE, PATCH } from '@/app/api/agents/[id]/queue/[tweetId]/route';

async function seedAgentWithDraft(handle: string, status: 'queued' | 'draft' = 'queued') {
  const agent = await createAgent({
    handle,
    name: `Agent ${handle}`,
    soulMd: '# soul',
  } as any);
  const tweet = await createTweet({
    agentId: agent.id,
    content: 'Support queue went from 40 tickets a day to 6 after we rewrote the refund flow.',
    type: 'original',
    status,
    topic: 'operations',
    xTweetId: null,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
    contentProvenance: 'operator_written',
  });
  return { agent, tweet };
}

describe('queue mutation version counter', () => {
  it('bumps the queue version when the operator deletes a queued draft', async () => {
    const { agent, tweet } = await seedAgentWithDraft('queue-version-delete');
    const before = await getQueueVersion(agent.id);

    const response = await DELETE(
      new Request('http://localhost/api/queue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Wrong claim about the refund flow' }),
      }) as any,
      { params: Promise.resolve({ id: agent.id, tweetId: tweet.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(await getQueueVersion(agent.id)).toBeGreaterThan(before);
  });

  it('bumps the queue version when the operator edits a queued draft', async () => {
    const { agent, tweet } = await seedAgentWithDraft('queue-version-edit');
    const before = await getQueueVersion(agent.id);

    const response = await PATCH(
      new Request('http://localhost/api/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Support queue went from 40 tickets a day to 6 after we rewrote the refund emails.' }),
      }) as any,
      { params: Promise.resolve({ id: agent.id, tweetId: tweet.id }) },
    );

    expect(response.status).toBe(200);
    expect(await getQueueVersion(agent.id)).toBeGreaterThan(before);
  });

  it('leaves the queue version alone when a draft that was never queued is deleted', async () => {
    const { agent, tweet } = await seedAgentWithDraft('queue-version-untouched', 'draft');
    const before = await getQueueVersion(agent.id);

    const response = await DELETE(
      new Request('http://localhost/api/queue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Not the angle I want' }),
      }) as any,
      { params: Promise.resolve({ id: agent.id, tweetId: tweet.id }) },
    );

    expect(response.status).toBe(200);
    expect(await getQueueVersion(agent.id)).toBe(before);
  });
});
