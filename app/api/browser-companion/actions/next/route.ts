import { NextRequest, NextResponse } from 'next/server';
import { getAccessibleAgentIds } from '@/lib/account-access';
import { requireBrowserCompanionPairing, BrowserCompanionAuthError } from '@/lib/browser-companion';
import {
  getActiveEngagementSession,
  getAgent,
  getUser,
  updateBrowserCompanionPairing,
  updateEngagementSession,
} from '@/lib/kv-storage';

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
  } catch (err) {
    const status = err instanceof BrowserCompanionAuthError ? 401 : 500;
    const message = err instanceof Error ? err.message : 'Failed to fetch next browser action';
    return NextResponse.json({ error: message }, { status });
  }
}
