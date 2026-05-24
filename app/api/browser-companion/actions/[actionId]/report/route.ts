import { NextRequest, NextResponse } from 'next/server';
import { getAccessibleAgentIds } from '@/lib/account-access';
import { BrowserCompanionAuthError, requireBrowserCompanionPairing } from '@/lib/browser-companion';
import { findSessionAction, nextSessionState } from '@/lib/engagement';
import {
  addLearningSignal,
  addPostLogEntry,
  getAgent,
  getEngagementSession,
  getUser,
  updateBrowserCompanionPairing,
  updateEngagementSession,
  updateTweet,
} from '@/lib/kv-storage';
import type { EngagementAction, EngagementProof } from '@/lib/types';

type ReportStatus = 'progress' | 'succeeded' | 'failed' | 'skipped' | 'aborted';

function normalizeProof(proof: Partial<EngagementProof> | null | undefined): EngagementProof | null {
  if (!proof || (proof.type !== 'screenshot' && proof.type !== 'dom')) return null;
  return {
    type: proof.type,
    localPath: typeof proof.localPath === 'string' ? proof.localPath : null,
    note: typeof proof.note === 'string' ? proof.note : null,
    capturedAt: typeof proof.capturedAt === 'string' ? proof.capturedAt : new Date().toISOString(),
  };
}

async function recordActionOutcome(
  agentId: string,
  action: EngagementAction,
  status: Exclude<ReportStatus, 'progress' | 'aborted'>,
  failureReason: string | null,
  resultTweetId: string | null,
  resultTweetUrl: string | null,
) {
  const now = new Date().toISOString();
  const reason = failureReason || null;

  if (status === 'succeeded') {
    if (action.type === 'reply' && action.draft) {
      await updateTweet(action.draft.tweetId, {
        status: 'posted',
        xTweetId: resultTweetId,
        postedAt: now,
      });

      await addLearningSignal(agentId, {
        tweetId: action.draft.tweetId,
        xTweetId: resultTweetId || action.candidate.tweetId,
        signalType: 'reply_posted',
        surface: 'engage',
        rewardDelta: 0.34,
        metadata: {
          targetHandle: action.candidate.authorHandle,
          targetTweetId: action.candidate.tweetId,
        },
      });
      await addPostLogEntry(agentId, {
        agentId,
        tweetId: action.draft.tweetId,
        xTweetId: resultTweetId || '',
        content: action.draft.content,
        format: 'engage_reply',
        topic: action.candidate.topic || 'engage',
        postedAt: now,
        source: 'manual',
        action: 'posted',
        reason: `Engage reply posted to @${action.candidate.authorHandle}`,
      });
      return;
    }

    await addLearningSignal(agentId, {
      xTweetId: action.candidate.tweetId,
      signalType: 'tweet_liked',
      surface: 'engage',
      rewardDelta: 0.12,
      metadata: {
        targetHandle: action.candidate.authorHandle,
        targetTweetId: action.candidate.tweetId,
      },
    });
    await addPostLogEntry(agentId, {
      agentId,
      tweetId: action.candidate.tweetId,
      xTweetId: action.candidate.tweetId,
      content: action.candidate.text,
      format: 'engage_like',
      topic: action.candidate.topic || 'engage',
      postedAt: now,
      source: 'manual',
      action: 'posted',
      reason: `Engage like completed for @${action.candidate.authorHandle}`,
    });
    return;
  }

  if (status === 'failed') {
    if (action.type === 'reply' && action.draft) {
      await addLearningSignal(agentId, {
        tweetId: action.draft.tweetId,
        xTweetId: action.candidate.tweetId,
        signalType: 'reply_rejected',
        surface: 'engage',
        rewardDelta: -0.45,
        reason: reason || undefined,
        metadata: {
          targetHandle: action.candidate.authorHandle,
          targetTweetId: action.candidate.tweetId,
        },
      });
      await addPostLogEntry(agentId, {
        agentId,
        tweetId: action.draft.tweetId,
        xTweetId: '',
        content: action.draft.content,
        format: 'engage_reply_error',
        topic: action.candidate.topic || 'engage',
        postedAt: now,
        source: 'manual',
        action: 'error',
        reason: reason || `Engage reply failed for @${action.candidate.authorHandle}`,
      });
      return;
    }

    await addLearningSignal(agentId, {
      xTweetId: action.candidate.tweetId,
      signalType: 'tweet_like_failed',
      surface: 'engage',
      rewardDelta: -0.22,
      reason: reason || undefined,
      metadata: {
        targetHandle: action.candidate.authorHandle,
        targetTweetId: action.candidate.tweetId,
      },
    });
    await addPostLogEntry(agentId, {
      agentId,
      tweetId: action.candidate.tweetId,
      xTweetId: action.candidate.tweetId,
      content: action.candidate.text,
      format: 'engage_like_error',
      topic: action.candidate.topic || 'engage',
      postedAt: now,
      source: 'manual',
      action: 'error',
      reason: reason || `Engage like failed for @${action.candidate.authorHandle}`,
    });
    return;
  }

  await addPostLogEntry(agentId, {
    agentId,
    tweetId: action.draft?.tweetId || action.candidate.tweetId,
    xTweetId: resultTweetId || action.candidate.tweetId,
    content: action.draft?.content || action.candidate.text,
    format: action.type === 'reply' ? 'engage_reply' : 'engage_like',
    topic: action.candidate.topic || 'engage',
    postedAt: now,
    source: 'manual',
    action: 'skipped',
    reason: reason || (action.type === 'reply' ? 'Engage reply skipped' : 'Engage like skipped'),
  });
  void resultTweetUrl;
}

// POST /api/browser-companion/actions/[actionId]/report
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  const { actionId } = await params;

  try {
    const pairing = await requireBrowserCompanionPairing(request);
    const body = await request.json();
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const status = typeof body?.status === 'string' ? body.status as ReportStatus : null;
    const failureReason = typeof body?.failureReason === 'string' ? body.failureReason : null;
    const resultTweetId = typeof body?.resultTweetId === 'string' ? body.resultTweetId : null;
    const resultTweetUrl = typeof body?.resultTweetUrl === 'string' ? body.resultTweetUrl : null;
    const proof = normalizeProof(body?.proof as Partial<EngagementProof> | undefined);

    if (!sessionId || !status) {
      return NextResponse.json({ error: 'sessionId and status are required' }, { status: 400 });
    }

    const [owner, session] = await Promise.all([
      getUser(pairing.ownerUserId),
      getEngagementSession(sessionId),
    ]);
    if (!owner || !session) {
      throw new BrowserCompanionAuthError('Session not found');
    }

    const allowedAgentIds = await getAccessibleAgentIds(owner);
    if (!allowedAgentIds.includes(session.agentId)) {
      throw new BrowserCompanionAuthError('Session not scoped to this pairing');
    }

    const agent = await getAgent(session.agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const located = findSessionAction(session, actionId);
    if (!located) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const updatedAction: EngagementAction = {
      ...located.action,
      proof: proof || located.action.proof,
      resultTweetId: resultTweetId || located.action.resultTweetId,
      resultTweetUrl: resultTweetUrl || located.action.resultTweetUrl,
      failureReason: failureReason || located.action.failureReason,
      completedAt: ['succeeded', 'failed', 'skipped', 'aborted'].includes(status) ? now : located.action.completedAt,
    };

    if (status === 'progress') {
      updatedAction.status = 'running';
      updatedAction.startedAt = located.action.startedAt || now;
    } else if (status === 'succeeded' || status === 'failed' || status === 'skipped' || status === 'aborted') {
      updatedAction.status = status;
      updatedAction.startedAt = located.action.startedAt || now;
    }

    const actions = session.actions.map((entry, index) => index === located.index ? updatedAction : entry);
    const nextState = status === 'progress'
      ? 'running'
      : nextSessionState(actions, session.state === 'approved' ? 'running' : session.state);

    const updatedSession = await updateEngagementSession(session.id, {
      actions,
      state: nextState,
      startedAt: session.startedAt || now,
      completedAt: ['succeeded', 'failed', 'aborted'].includes(nextState) ? now : null,
      lastError: status === 'failed' ? failureReason : nextState === 'failed' ? updatedAction.failureReason : null,
    });

    if (status === 'succeeded' || status === 'failed' || status === 'skipped') {
      await recordActionOutcome(agent.id, updatedAction, status, failureReason, resultTweetId, resultTweetUrl);
    }

    if (['succeeded', 'failed', 'aborted'].includes(updatedSession.state) && pairing.currentAgentId === agent.id) {
      await updateBrowserCompanionPairing(pairing.id, {
        currentAgentId: null,
        currentAgentHandle: null,
      });
    }

    return NextResponse.json({ session: updatedSession });
  } catch (err) {
    const status = err instanceof BrowserCompanionAuthError ? 401 : 500;
    const message = err instanceof Error ? err.message : 'Failed to report browser action';
    return NextResponse.json({ error: message }, { status });
  }
}
