import { describe, expect, it, vi } from 'vitest';
import { createAgent, createTweet, getAgent, getFeedback } from '@/lib/kv-storage';

vi.mock('@/lib/auth', async () => {
  const kv = await vi.importActual<typeof import('@/lib/kv-storage')>('@/lib/kv-storage');
  return {
    requireAgentAccess: vi.fn(async (id: string) => ({
      user: { id: 'user-1' },
      agent: await kv.getAgent(id),
    })),
    handleAuthError: vi.fn((err: unknown) => {
      throw err;
    }),
  };
});

import { PATCH } from '@/app/api/agents/[id]/route';

function patchRequest(body: string): Request {
  return new Request('http://localhost/api/agents/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

async function makeAgent(handle: string, extra: Record<string, unknown> = {}) {
  return createAgent({
    handle,
    name: `Agent ${handle}`,
    soulMd: '# soul',
    isConnected: 0,
    ...extra,
  } as any);
}

describe('agent PATCH route', () => {
  it('rejects feedback entries without a rating target instead of persisting them', async () => {
    const agent = await makeAgent('feedback-invalid-agent');

    const response = await PATCH(
      patchRequest(JSON.stringify({
        action: 'feedback',
        feedback: { rating: 'down', generatedAt: '2026-09-01T00:00:00Z' },
      })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/tweetText or tweetId/);
    expect(await getFeedback(agent.id)).toEqual([]);
  });

  it('resolves preview feedback text from tweetId and stamps generatedAt server-side', async () => {
    const agent = await makeAgent('feedback-tweet-id-agent');
    const preview = await createTweet({
      agentId: agent.id,
      content: 'Preview draft the operator rated.',
      type: 'original',
      status: 'preview',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const response = await PATCH(
      patchRequest(JSON.stringify({
        action: 'feedback',
        feedback: { tweetId: preview.id, rating: 'up', source: 'preview_feedback', generatedAt: 'not-a-date' },
      })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(response.status).toBe(200);
    const stored = await getFeedback(agent.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      tweetId: preview.id,
      tweetText: 'Preview draft the operator rated.',
      rating: 'up',
      source: 'preview_feedback',
    });
    expect(Number.isFinite(Date.parse(stored[0].generatedAt))).toBe(true);
  });

  it('refuses feedback pointing at another agent\'s tweet', async () => {
    const owner = await makeAgent('feedback-owner-agent');
    const other = await makeAgent('feedback-other-agent');
    const foreign = await createTweet({
      agentId: owner.id,
      content: 'Belongs to a different agent.',
      type: 'original',
      status: 'preview',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const response = await PATCH(
      patchRequest(JSON.stringify({ action: 'feedback', feedback: { tweetId: foreign.id, rating: 'down' } })) as any,
      { params: Promise.resolve({ id: other.id }) },
    );

    expect(response.status).toBe(400);
    expect(await getFeedback(other.id)).toEqual([]);
  });

  it('maps a handle collision to 409 with the duplicate agent id', async () => {
    const taken = await makeAgent('taken-handle');
    const agent = await makeAgent('renaming-agent');

    const response = await PATCH(
      patchRequest(JSON.stringify({ handle: '@Taken-Handle' })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toMatchObject({ code: 'agent_handle_conflict', duplicateAgentId: taken.id });
    expect((await getAgent(agent.id))?.handle).toBe('renaming-agent');
  });

  it('refuses to rename a connected agent away from its verified X handle', async () => {
    const agent = await makeAgent('verifiedhandle', {
      isConnected: 1,
      xIdentityVerifiedHandle: 'verifiedhandle',
    });

    const response = await PATCH(
      patchRequest(JSON.stringify({ handle: 'somebodyelse', soulMd: '# updated soul' })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toMatchObject({ code: 'handle_locked_to_x_identity', verifiedHandle: 'verifiedhandle' });
    const stored = await getAgent(agent.id);
    expect(stored?.handle).toBe('verifiedhandle');
    expect(stored?.soulMd).toBe('# soul');
  });

  it('still accepts the verified handle itself on a connected agent', async () => {
    const agent = await makeAgent('keptverified', {
      isConnected: 1,
      xIdentityVerifiedHandle: 'keptverified',
    });

    const response = await PATCH(
      patchRequest(JSON.stringify({ handle: '@KeptVerified', name: 'Renamed display' })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(response.status).toBe(200);
    expect((await getAgent(agent.id))?.name).toBe('Renamed display');
  });

  it('answers 400 for malformed JSON and non-string fields', async () => {
    const agent = await makeAgent('malformed-json-agent');

    const malformed = await PATCH(
      patchRequest('{') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toBe('Invalid JSON body');

    const badHandle = await PATCH(
      patchRequest(JSON.stringify({ handle: 42 })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    expect(badHandle.status).toBe(400);
  });
});
