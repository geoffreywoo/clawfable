import { describe, expect, it } from 'vitest';
import { GET as nextActionGET } from '@/app/api/browser-companion/actions/next/route';
import { POST as reportActionPOST } from '@/app/api/browser-companion/actions/[actionId]/report/route';
import {
  addAgentToUser,
  createAgent,
  createBrowserCompanionPairing,
  createEngagementSession,
  createTweet,
  getEngagementSession,
  getLearningSignals,
  getOrCreateUser,
  getPostLog,
  getTweet,
} from '@/lib/kv-storage';

function makeLikeAction(tweetId: string) {
  return {
    id: `action-like-${tweetId}`,
    type: 'like' as const,
    status: 'pending' as const,
    candidate: {
      id: `feed:${tweetId}`,
      agentId: 'placeholder',
      source: 'feed' as const,
      tweetId,
      tweetUrl: `https://x.com/test/status/${tweetId}`,
      authorId: null,
      authorHandle: 'builder',
      authorName: null,
      text: 'AI agents are now competing on workflow quality.',
      likes: 220,
      createdAt: new Date().toISOString(),
      topic: 'agents',
      score: 82,
      scoreReason: 'high velocity · strong voice match',
    },
    draft: null,
    resultTweetId: null,
    resultTweetUrl: null,
    proof: null,
    failureReason: null,
    startedAt: null,
    completedAt: null,
  };
}

describe('browser companion routes', () => {
  it('scopes claimed work to the pairing owner', async () => {
    const owner = await getOrCreateUser('browser-owner-1', 'browserowner', 'Browser Owner');
    const outsider = await getOrCreateUser('browser-owner-2', 'browseroutsider', 'Browser Outsider');

    const ownerAgent = await createAgent({
      handle: 'browser-owner-agent',
      name: 'Browser Owner Agent',
      soulMd: '# soul',
    } as any);
    const outsiderAgent = await createAgent({
      handle: 'browser-outsider-agent',
      name: 'Browser Outsider Agent',
      soulMd: '# soul',
    } as any);

    await addAgentToUser(owner.id, ownerAgent.id);
    await addAgentToUser(outsider.id, outsiderAgent.id);

    await createEngagementSession({
      agentId: outsiderAgent.id,
      state: 'approved',
      actions: [
        {
          ...makeLikeAction('scope-1'),
          candidate: {
            ...makeLikeAction('scope-1').candidate,
            agentId: outsiderAgent.id,
          },
        },
      ],
      machineLabel: null,
      approvedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      abortedAt: null,
      lastError: null,
    });

    const pairing = await createBrowserCompanionPairing(owner.id, 'Owner laptop');
    const response = await nextActionGET(new Request('http://localhost/api/browser-companion/actions/next', {
      headers: {
        Authorization: `Bearer ${pairing.token}`,
      },
    }) as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.action).toBeNull();
  });

  it('claims an approved like and reports it back into learning and logs', async () => {
    const user = await getOrCreateUser('browser-user-3', 'browsergood', 'Browser Good');
    const agent = await createAgent({
      handle: 'browser-good-agent',
      name: 'Browser Good Agent',
      soulMd: '# soul',
    } as any);
    await addAgentToUser(user.id, agent.id);

    const session = await createEngagementSession({
      agentId: agent.id,
      state: 'approved',
      actions: [
        {
          ...makeLikeAction('success-1'),
          candidate: {
            ...makeLikeAction('success-1').candidate,
            agentId: agent.id,
          },
        },
      ],
      machineLabel: null,
      approvedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      abortedAt: null,
      lastError: null,
    });

    const pairing = await createBrowserCompanionPairing(user.id, 'Ops Mac');
    const nextResponse = await nextActionGET(new Request('http://localhost/api/browser-companion/actions/next', {
      headers: {
        Authorization: `Bearer ${pairing.token}`,
      },
    }) as any);
    const nextData = await nextResponse.json();

    expect(nextResponse.status).toBe(200);
    expect(nextData.action?.id).toBe('action-like-success-1');
    expect(nextData.sessionId).toBe(session.id);

    const reportResponse = await reportActionPOST(
      new Request(`http://localhost/api/browser-companion/actions/${nextData.action.id}/report`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pairing.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: session.id,
          status: 'succeeded',
          proof: {
            type: 'screenshot',
            localPath: '/tmp/like-proof.png',
            capturedAt: new Date().toISOString(),
          },
        }),
      }) as any,
      { params: Promise.resolve({ actionId: nextData.action.id }) }
    );
    const reportData = await reportResponse.json();

    expect(reportResponse.status).toBe(200);
    expect(reportData.session.state).toBe('succeeded');

    const [signals, postLog, updatedSession] = await Promise.all([
      getLearningSignals(agent.id, 20),
      getPostLog(agent.id, 20),
      getEngagementSession(session.id),
    ]);

    expect(signals.some((signal) =>
      signal.signalType === 'tweet_liked'
      && signal.surface === 'engage'
      && signal.xTweetId === 'success-1'
    )).toBe(true);
    expect(postLog.some((entry) =>
      entry.format === 'engage_like'
      && entry.reason?.includes('@builder')
    )).toBe(true);
    expect(updatedSession?.actions[0].status).toBe('succeeded');
  });

  it('records the root target when a browser companion reply succeeds', async () => {
    const user = await getOrCreateUser('browser-user-4', 'browserreply', 'Browser Reply');
    const agent = await createAgent({
      handle: 'browser-reply-agent',
      name: 'Browser Reply Agent',
      soulMd: '# soul',
    } as any);
    await addAgentToUser(user.id, agent.id);
    const draft = await createTweet({
      agentId: agent.id,
      content: 'workflow quality beats demo quality',
      type: 'reply',
      status: 'draft',
      topic: 'engage',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: 'builder',
      scheduledAt: null,
    });

    const replyAction = {
      ...makeLikeAction('root-target-1'),
      id: 'action-reply-root-target-1',
      type: 'reply' as const,
      candidate: {
        ...makeLikeAction('root-target-1').candidate,
        agentId: agent.id,
      },
      draft: {
        tweetId: draft.id,
        content: draft.content,
        originalContent: draft.content,
        edited: false,
        updatedAt: draft.createdAt,
      },
    };
    const session = await createEngagementSession({
      agentId: agent.id,
      state: 'approved',
      actions: [replyAction],
      machineLabel: null,
      approvedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      abortedAt: null,
      lastError: null,
    });

    const pairing = await createBrowserCompanionPairing(user.id, 'Ops Mac');
    const reportResponse = await reportActionPOST(
      new Request(`http://localhost/api/browser-companion/actions/${replyAction.id}/report`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pairing.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: session.id,
          status: 'succeeded',
          resultTweetId: 'posted-reply-1',
          resultTweetUrl: 'https://x.com/browserreply/status/posted-reply-1',
        }),
      }) as any,
      { params: Promise.resolve({ actionId: replyAction.id }) }
    );
    const updatedDraft = await getTweet(draft.id);

    expect(reportResponse.status).toBe(200);
    expect(updatedDraft?.status).toBe('posted');
    expect(updatedDraft?.xTweetId).toBe('posted-reply-1');
    expect(updatedDraft?.followupForTweetId).toBe('root-target-1');
    expect(updatedDraft?.replyConversationId).toBe('root-target-1');
  });
});
