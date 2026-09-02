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
import { createOperatorChildDraft, isImmutableGeneratedDraft } from '@/lib/draft-lineage';
import { readJsonObjectBody } from '@/lib/request-validation';
import { getTweetCompletenessIssue } from '@/lib/survivability';
import type {
  EngagementAction,
  EngagementActionType,
  EngagementCandidate,
  EngagementDraft,
} from '@/lib/types';

class EngageRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'EngageRequestError';
    this.status = status;
  }
}

const SETTLED_ACTION_STATUSES = new Set<EngagementAction['status']>(['running', 'succeeded', 'failed', 'skipped', 'aborted']);

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
    throw new EngageRequestError('Reply draft tweet not found', 404);
  }

  let latest = stored;
  const nextContent = typeof draft.content === 'string' ? draft.content.trim() : '';
  if (nextContent && nextContent !== stored.content) {
    const completenessIssue = getTweetCompletenessIssue(nextContent);
    if (completenessIssue) {
      throw new EngageRequestError(completenessIssue, 422);
    }
    // V2 reply drafts are immutable: the edit becomes an operator-written
    // child (with its edit learning signal) and the action points at the child.
    latest = isImmutableGeneratedDraft(stored)
      ? await createOperatorChildDraft(stored, nextContent, { status: 'draft', surface: 'engage' })
      : await updateTweet(stored.id, { content: nextContent });
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
    throw new EngageRequestError('Each engagement action needs a valid type and candidate', 400);
  }

  const existing = existingActions.get(String(rawAction.id || actionKey({ type, candidate })))
    || existingActions.get(actionKey({ type, candidate }))
    || null;
  // An action that already ran keeps its outcome; re-syncing the session
  // must never put a posted reply back in the companion's queue.
  if (existing && SETTLED_ACTION_STATUSES.has(existing.status)) {
    return existing;
  }
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
    const parsedBody = await readJsonObjectBody(request);
    if (!parsedBody.ok || !parsedBody.value) {
      return NextResponse.json({ error: parsedBody.error || 'Invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody.value;
    const requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    const rawActions = Array.isArray(body.actions) ? body.actions : [];

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

    if (workingSession?.state === 'running') {
      return NextResponse.json({
        error: 'This Engage session is running. Wait for it to finish or abort it before changing its actions.',
        code: 'engage_session_running',
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
    if (err instanceof EngageRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to save Engage session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
