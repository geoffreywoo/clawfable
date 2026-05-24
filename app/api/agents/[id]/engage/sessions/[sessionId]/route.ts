import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { nextSessionState } from '@/lib/engagement';
import { getEngagementSession, updateEngagementSession } from '@/lib/kv-storage';

function ensureSessionAgent(sessionAgentId: string, agentId: string) {
  return String(sessionAgentId) === String(agentId);
}

// GET /api/agents/[id]/engage/sessions/[sessionId]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  const { id, sessionId } = await params;

  try {
    await requireAgentAccess(id);
    const session = await getEngagementSession(sessionId);
    if (!session || !ensureSessionAgent(session.agentId, id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json(session);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to fetch Engage session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/agents/[id]/engage/sessions/[sessionId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  const { id, sessionId } = await params;

  try {
    await requireAgentAccess(id);
    const session = await getEngagementSession(sessionId);
    if (!session || !ensureSessionAgent(session.agentId, id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const body = await request.json();
    const action = typeof body?.action === 'string' ? body.action : '';
    const now = new Date().toISOString();

    if (action === 'approve') {
      if (session.actions.length === 0) {
        return NextResponse.json({ error: 'Add at least one action before approval' }, { status: 400 });
      }

      if (session.state === 'running') {
        return NextResponse.json({ error: 'Session is already running' }, { status: 409 });
      }

      const approved = await updateEngagementSession(session.id, {
        state: 'approved',
        approvedAt: now,
        abortedAt: null,
        completedAt: null,
        lastError: null,
        actions: session.actions.map((entry) => ({
          ...entry,
          status: entry.status === 'aborted' ? 'pending' : entry.status,
          failureReason: entry.status === 'aborted' ? null : entry.failureReason,
          startedAt: entry.status === 'aborted' ? null : entry.startedAt,
          completedAt: entry.status === 'aborted' ? null : entry.completedAt,
        })),
      });
      return NextResponse.json(approved);
    }

    if (action === 'abort') {
      const aborted = await updateEngagementSession(session.id, {
        state: 'aborted',
        abortedAt: now,
        completedAt: now,
        actions: session.actions.map((entry) => ({
          ...entry,
          status: entry.status === 'succeeded' || entry.status === 'failed' || entry.status === 'skipped'
            ? entry.status
            : 'aborted',
          completedAt: entry.completedAt || now,
          failureReason: entry.failureReason || (entry.status === 'pending' || entry.status === 'running'
            ? 'Operator aborted the session'
            : null),
        })),
      });
      return NextResponse.json(aborted);
    }

    if (action === 'clear-failed') {
      const remaining = session.actions.filter((entry) => !['failed', 'skipped', 'aborted'].includes(entry.status));
      const nextState = remaining.length === 0
        ? 'succeeded'
        : nextSessionState(remaining, session.state === 'failed' ? 'approved' : session.state);
      const cleared = await updateEngagementSession(session.id, {
        actions: remaining,
        state: nextState,
        lastError: null,
        completedAt: nextState === 'succeeded' ? now : null,
      });
      return NextResponse.json(cleared);
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to update Engage session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
