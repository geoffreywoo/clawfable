import { NextRequest, NextResponse } from 'next/server';
import { getAccessibleAgentIds } from '@/lib/account-access';
import { requireBrowserCompanionPairing, BrowserCompanionAuthError } from '@/lib/browser-companion';
import {
  addLearningSignal,
  addPostLogEntry,
  getActiveEngagementSession,
  getAgent,
  getUser,
  updateBrowserCompanionPairing,
  updateEngagementSession,
} from '@/lib/kv-storage';
import { nextSessionState } from '@/lib/engagement';
import { findPostedReplyForConversation } from '@/lib/reply-conversation-guard';
import { areRepliesDisabled, REPLY_AUTOMATION_DISABLED_REASON } from '@/lib/reply-safety';

async function findNextSession(agentIds: string[]) {
  const sessions = await Promise.all(agentIds.map(async (agentId) => ({
    agent: await getAgent(agentId),
    session: await getActiveEngagementSession(agentId),
  })));

  return sessions
    .filter((entry): entry is { agent: NonNullable<typeof entry.agent>; session: NonNullable<typeof entry.session> } => !!entry.agent && !!entry.session)
    .filter((entry) =>
      ['approved', 'running'].includes(entry.session.state)
      && entry.session.actions.some((action) => action.status === 'pending')
    )
    .sort((a, b) => new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime())[0] || null;
}

// GET /api/browser-companion/actions/next
export async function GET(request: NextRequest) {
  try {
    const pairing = await requireBrowserCompanionPairing(request);
    const owner = await getUser(pairing.ownerUserId);
    if (!owner) {
      throw new BrowserCompanionAuthError('Pairing owner not found');
    }

    const candidateAgentIds = pairing.currentAgentId
      ? [pairing.currentAgentId]
      : await getAccessibleAgentIds(owner);

    for (let attempt = 0; attempt < 20; attempt++) {
      const next = await findNextSession(candidateAgentIds);

      if (!next) {
        if (pairing.currentAgentId) {
          await updateBrowserCompanionPairing(pairing.id, {
            currentAgentId: null,
            currentAgentHandle: null,
          });
        }
        return NextResponse.json({ action: null });
      }

      const pendingIndex = next.session.actions.findIndex((action) => action.status === 'pending');
      if (pendingIndex === -1) {
        return NextResponse.json({ action: null });
      }

      const pendingAction = next.session.actions[pendingIndex];
      if (pendingAction.type === 'reply') {
        if (areRepliesDisabled()) {
          const now = new Date().toISOString();
          const actions = next.session.actions.map((action, index) => (
            index === pendingIndex
              ? {
                  ...action,
                  status: 'skipped' as const,
                  failureReason: REPLY_AUTOMATION_DISABLED_REASON,
                  completedAt: now,
                }
              : action
          ));
          const state = nextSessionState(actions, next.session.state);
          await updateEngagementSession(next.session.id, {
            actions,
            state,
            completedAt: ['succeeded', 'failed', 'aborted'].includes(state) ? now : null,
            lastError: null,
          });
          await addLearningSignal(next.agent.id, {
            tweetId: pendingAction.draft?.tweetId,
            xTweetId: pendingAction.candidate.tweetId,
            signalType: 'reply_rejected',
            surface: 'engage',
            rewardDelta: -0.25,
            reason: REPLY_AUTOMATION_DISABLED_REASON,
            inferred: true,
            metadata: {
              qualityGate: 'reply_emergency_disabled',
              targetTweetId: pendingAction.candidate.tweetId,
            },
          }).catch(() => null);
          await addPostLogEntry(next.agent.id, {
            agentId: next.agent.id,
            tweetId: pendingAction.draft?.tweetId || '',
            xTweetId: '',
            content: pendingAction.draft?.content || pendingAction.candidate.text,
            format: 'engage_reply_emergency_disabled',
            topic: pendingAction.candidate.topic || 'engage',
            postedAt: now,
            source: 'manual',
            action: 'skipped',
            reason: REPLY_AUTOMATION_DISABLED_REASON,
          }).catch(() => null);
          continue;
        }

        const duplicate = await findPostedReplyForConversation(
          next.agent.id,
          pendingAction.candidate.tweetId,
          pendingAction.draft?.tweetId || null,
        );
        if (duplicate) {
          const now = new Date().toISOString();
          const reason = `Engage reply claim gate: already replied to root ${pendingAction.candidate.tweetId}${duplicate.xTweetId ? ` via ${duplicate.xTweetId}` : ''}.`;
          const actions = next.session.actions.map((action, index) => (
            index === pendingIndex
              ? {
                  ...action,
                  status: 'skipped' as const,
                  failureReason: reason,
                  completedAt: now,
                }
              : action
          ));
          const state = nextSessionState(actions, next.session.state);
          await updateEngagementSession(next.session.id, {
            actions,
            state,
            completedAt: ['succeeded', 'failed', 'aborted'].includes(state) ? now : null,
            lastError: null,
          });
          await addLearningSignal(next.agent.id, {
            tweetId: pendingAction.draft?.tweetId,
            xTweetId: pendingAction.candidate.tweetId,
            signalType: 'reply_rejected',
            surface: 'engage',
            rewardDelta: -0.18,
            reason,
            inferred: true,
            metadata: {
              qualityGate: 'duplicate_reply_conversation',
              targetTweetId: pendingAction.candidate.tweetId,
              duplicateSource: duplicate.source,
              existingXTweetId: duplicate.xTweetId,
            },
          }).catch(() => null);
          await addPostLogEntry(next.agent.id, {
            agentId: next.agent.id,
            tweetId: pendingAction.draft?.tweetId || '',
            xTweetId: '',
            content: pendingAction.draft?.content || pendingAction.candidate.text,
            format: 'engage_reply_duplicate_gate',
            topic: pendingAction.candidate.topic || 'engage',
            postedAt: now,
            source: 'manual',
            action: 'skipped',
            reason,
          }).catch(() => null);
          continue;
        }
      }

      const now = new Date().toISOString();
      const updatedSession = await updateEngagementSession(next.session.id, {
        state: 'running',
        startedAt: next.session.startedAt || now,
        actions: next.session.actions.map((action, index) => (
          index === pendingIndex
            ? {
                ...action,
                status: 'running',
                startedAt: action.startedAt || now,
              }
            : action
        )),
      });

      const claimedAction = updatedSession.actions[pendingIndex];
      const updatedPairing = await updateBrowserCompanionPairing(pairing.id, {
        currentAgentId: next.agent.id,
        currentAgentHandle: next.agent.handle,
      });

      return NextResponse.json({
        pairing: {
          id: updatedPairing.id,
          machineLabel: updatedPairing.machineLabel,
          currentAgentId: updatedPairing.currentAgentId,
          currentAgentHandle: updatedPairing.currentAgentHandle,
        },
        sessionId: updatedSession.id,
        agent: {
          id: next.agent.id,
          handle: next.agent.handle,
          name: next.agent.name,
        },
        action: claimedAction,
      });
    }

    if (pairing.currentAgentId) {
      await updateBrowserCompanionPairing(pairing.id, {
        currentAgentId: null,
        currentAgentHandle: null,
      });
    }
    return NextResponse.json({
      action: null,
      error: 'Too many duplicate pending actions skipped in one poll.',
    }, { status: 409 });
  } catch (err) {
    const status = err instanceof BrowserCompanionAuthError ? 401 : 500;
    const message = err instanceof Error ? err.message : 'Failed to fetch next browser action';
    return NextResponse.json({ error: message }, { status });
  }
}
