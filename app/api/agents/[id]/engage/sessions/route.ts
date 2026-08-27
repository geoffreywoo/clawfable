import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildEngagementDraft, nextSessionState } from '@/lib/engagement';
import {
  createEngagementSession,
  getActiveEngagementSession,
  getDraftEngagementSession,
  getEngagementSession,
  getTweet,
  updateEngagementSession,
  updateTweet,
} from '@/lib/kv-storage';
import type {
  EngagementAction,
  EngagementActionType,
  EngagementCandidate,
  EngagementDraft,
} from '@/lib/types';

function normalizeCandidate(candidate: Partial<EngagementCandidate> | null | undefined, agentId: string): EngagementCandidate | null {
  if (
    !candidate
    || String(candidate.agentId) !== String(agentId)
    || typeof candidate.tweetId !== 'string'
    || typeof candidate.tweetUrl !== 'string'
    || typeof candidate.authorHandle !== 'string'
    || typeof candidate.text !== 'string'
    || typeof candidate.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: String(candidate.id || `${candidate.source || 'feed'}:${candidate.tweetId}`),
    agentId: String(candidate.agentId),
    source: ['pasted', 'trend', 'relationship', 'reply_mined'].includes(String(candidate.source))
      ? candidate.source as EngagementCandidate['source']
      : 'feed',
    tweetId: String(candidate.tweetId),
    tweetUrl: candidate.tweetUrl,
    authorId: candidate.authorId ? String(candidate.authorId) : null,
    authorHandle: candidate.authorHandle.replace(/^@/, ''),
    authorName: typeof candidate.authorName === 'string' ? candidate.authorName : null,
    text: candidate.text.trim(),
    likes: Number(candidate.likes || 0),
    createdAt: candidate.createdAt,
    topic: typeof candidate.topic === 'string' ? candidate.topic : null,
    networkCluster: candidate.networkCluster ?? null,
    opportunityType: candidate.opportunityType,
    relationshipReason: candidate.relationshipReason ?? null,
    score: Number(candidate.score || 0),
    scoreReason: typeof candidate.scoreReason === 'string' ? candidate.scoreReason : '',
  };
}

function actionKey(action: { type: EngagementActionType; candidate: { tweetId: string } }): string {
  return `${action.type}:${action.candidate.tweetId}`;
}

async function normalizeDraft(agentId: string, draft: Partial<EngagementDraft> | null | undefined): Promise<EngagementDraft | null> {
  if (!draft || typeof draft.tweetId !== 'string') return null;

  const stored = await getTweet(String(draft.tweetId));
  if (!stored || String(stored.agentId) !== String(agentId)) {
    throw new Error('Reply draft tweet not found');
  }

  let latest = stored;
  if (typeof draft.content === 'string' && draft.content.trim() && draft.content !== stored.content) {
    latest = await updateTweet(stored.id, { content: draft.content.trim() });
  }

  return buildEngagementDraft(latest);
}

async function normalizeAction(
  rawAction: Partial<EngagementAction>,
  agentId: string,
  existingActions: Map<string, EngagementAction>,
): Promise<EngagementAction> {
  const type = rawAction.type === 'reply' ? 'reply' : rawAction.type === 'like' ? 'like' : null;
  const candidate = normalizeCandidate(rawAction.candidate, agentId);
  if (!type || !candidate) {
    throw new Error('Each engagement action needs a valid type and candidate');
  }

  const existing = existingActions.get(String(rawAction.id || actionKey({ type, candidate })))
    || existingActions.get(actionKey({ type, candidate }))
    || null;
  const draft = type === 'reply'
    ? await normalizeDraft(agentId, rawAction.draft)
    : null;

  return {
    id: existing?.id || String(rawAction.id || crypto.randomUUID()),
    type,
    status: 'pending',
    candidate,
    draft,
    resultTweetId: null,
    resultTweetUrl: null,
    proof: null,
    failureReason: null,
    startedAt: null,
    completedAt: null,
  };
}

// POST /api/agents/[id]/engage/sessions
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await requireAgentAccess(id);
    const body = await request.json();
    const requestedSessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
    const rawActions = Array.isArray(body?.actions) ? body.actions : [];

    const [activeSession, draftSession, requestedSession] = await Promise.all([
      getActiveEngagementSession(id),
      getDraftEngagementSession(id),
      requestedSessionId ? getEngagementSession(requestedSessionId) : Promise.resolve(null),
    ]);
    const workingSession = requestedSession || draftSession;

    if (requestedSession && String(requestedSession.agentId) !== String(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (activeSession && activeSession.id !== workingSession?.id && activeSession.state !== 'draft') {
      return NextResponse.json({
        error: 'Finish or abort the active Engage session before creating another one',
      }, { status: 409 });
    }

    const existingActions = new Map<string, EngagementAction>();
    for (const action of workingSession?.actions || []) {
      existingActions.set(action.id, action);
      existingActions.set(actionKey(action), action);
    }

    const actions = await Promise.all(
      rawActions.map((action) => normalizeAction(action as Partial<EngagementAction>, id, existingActions))
    );

    const session = workingSession
      ? await updateEngagementSession(workingSession.id, {
          actions,
          state: nextSessionState(actions, 'draft'),
          lastError: null,
          approvedAt: null,
          startedAt: null,
          completedAt: null,
          abortedAt: null,
        })
      : await createEngagementSession({
          agentId: id,
          state: nextSessionState(actions, 'draft'),
          actions,
          machineLabel: null,
          approvedAt: null,
          startedAt: null,
          completedAt: null,
          abortedAt: null,
          lastError: null,
        });

    return NextResponse.json({ session });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to save Engage session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
