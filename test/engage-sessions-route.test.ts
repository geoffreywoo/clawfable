import { describe, expect, it, vi } from 'vitest';
import {
  createAgent,
  createEngagementSession,
  createTweet,
  getEngagementSession,
  getLearningSignals,
  getTweet,
} from '@/lib/kv-storage';
import type { EngagementAction, EngagementCandidate } from '@/lib/types';

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => ({
    user: { id: 'user-1' },
    agent: { id, handle: 'engage-agent', name: 'Engage Agent', soulMd: '# soul' },
  })),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

import { POST } from '@/app/api/agents/[id]/engage/sessions/route';

function candidate(agentId: string, tweetId: string): EngagementCandidate {
  return {
    id: `feed:${tweetId}`,
    agentId,
    source: 'feed',
    tweetId,
    tweetUrl: `https://x.com/builder/status/${tweetId}`,
    authorId: null,
    authorHandle: 'builder',
    authorName: null,
    text: 'AI agents are moving from demos to production.',
    likes: 40,
    createdAt: new Date().toISOString(),
    topic: 'agents',
    networkCluster: null,
    opportunityType: undefined,
    relationshipReason: null,
    score: 0.6,
    scoreReason: 'test',
  } as EngagementCandidate;
}

async function createReplyDraft(agentId: string, overrides: Record<string, unknown> = {}) {
  return createTweet({
    agentId,
    content: 'Production agents need a rollback owner before they need more evals.',
    type: 'reply',
    status: 'draft',
    topic: 'agents',
    pipelineVersion: 'v2',
    contentProvenance: 'generated_v2',
    generationSurface: 'reply',
    xTweetId: null,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
    ...overrides,
  } as any);
}

function sessionsRequest(body: string): Request {
  return new Request('http://localhost/api/engage/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('engage sessions route', () => {
  it('turns an edit of a V2 reply draft into an operator-written child with an edit signal', async () => {
    const agent = await createAgent({ handle: 'engage-agent', name: 'Engage Agent', soulMd: '# soul' } as any);
    const stored = await createReplyDraft(agent.id);
    const edited = 'Production agents need a rollback owner first. Evals come second.';

    const response = await POST(
      sessionsRequest(JSON.stringify({
        actions: [{
          type: 'reply',
          candidate: candidate(agent.id, '900'),
          draft: { tweetId: stored.id, content: edited },
        }],
      })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const draft = data.session.actions[0].draft;
    expect(draft.tweetId).not.toBe(stored.id);
    expect(draft.content).toBe(edited);

    const child = await getTweet(draft.tweetId);
    expect(child).toMatchObject({
      contentProvenance: 'operator_written',
      parentTweetId: stored.id,
      status: 'draft',
      type: 'reply',
      content: edited,
    });
    expect((await getTweet(stored.id))?.status).toBe('quarantined');

    const signals = await getLearningSignals(agent.id);
    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ tweetId: child?.id, signalType: 'edited_before_post', surface: 'engage' }),
    ]));
  });

  it('keeps succeeded actions settled when the session is re-synced with a new action', async () => {
    const agent = await createAgent({ handle: 'engage-settled-agent', name: 'Engage Agent', soulMd: '# soul' } as any);
    const posted = await createReplyDraft(agent.id, { status: 'posted', xTweetId: '111' });
    const now = new Date().toISOString();
    const succeeded: EngagementAction = {
      id: 'action-succeeded',
      type: 'reply',
      status: 'succeeded',
      candidate: candidate(agent.id, '901'),
      draft: {
        tweetId: posted.id,
        content: posted.content,
        originalContent: posted.content,
        edited: false,
        updatedAt: now,
      },
      resultTweetId: '111',
      resultTweetUrl: 'https://x.com/engage/status/111',
      proof: null,
      failureReason: null,
      startedAt: now,
      completedAt: now,
    };
    const session = await createEngagementSession({
      agentId: agent.id,
      state: 'approved',
      actions: [succeeded],
      machineLabel: null,
      approvedAt: now,
      startedAt: null,
      completedAt: null,
      abortedAt: null,
      lastError: null,
    });

    const response = await POST(
      sessionsRequest(JSON.stringify({
        sessionId: session.id,
        actions: [succeeded, { type: 'like', candidate: candidate(agent.id, '902') }],
      })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.session.actions).toHaveLength(2);
    expect(data.session.actions[0]).toMatchObject({
      id: 'action-succeeded',
      status: 'succeeded',
      resultTweetId: '111',
      completedAt: now,
    });
    expect(data.session.actions[1]).toMatchObject({ type: 'like', status: 'pending' });
    expect((await getEngagementSession(session.id))?.actions[0].status).toBe('succeeded');
  });

  it('refuses to rewrite the action list of a running session', async () => {
    const agent = await createAgent({ handle: 'engage-running-agent', name: 'Engage Agent', soulMd: '# soul' } as any);
    const now = new Date().toISOString();
    const session = await createEngagementSession({
      agentId: agent.id,
      state: 'running',
      actions: [{
        id: 'action-running',
        type: 'like',
        status: 'running',
        candidate: candidate(agent.id, '903'),
        draft: null,
        resultTweetId: null,
        resultTweetUrl: null,
        proof: null,
        failureReason: null,
        startedAt: now,
        completedAt: null,
      }],
      machineLabel: null,
      approvedAt: now,
      startedAt: now,
      completedAt: null,
      abortedAt: null,
      lastError: null,
    });

    const response = await POST(
      sessionsRequest(JSON.stringify({
        sessionId: session.id,
        actions: [{ type: 'like', candidate: candidate(agent.id, '904') }],
      })) as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('engage_session_running');
    expect((await getEngagementSession(session.id))?.state).toBe('running');
  });

  it('answers 400 for a malformed JSON body', async () => {
    const agent = await createAgent({ handle: 'engage-json-agent', name: 'Engage Agent', soulMd: '# soul' } as any);

    const response = await POST(
      sessionsRequest('{') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Invalid JSON body');
  });
});
