import { NextRequest, NextResponse } from 'next/server';
import {
  AgentHandleConflictError,
  updateAgent,
  deleteAgent,
  getTweet,
  saveFeedback,
  logFunnelEvent,
} from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { isSetupStep } from '@/lib/setup-state';
import { buildAgentDetail } from '@/lib/dashboard-data';
import { normalizeUsername } from '@/lib/internal-accounts';
import { readJsonObjectBody, validateFeedbackEntry } from '@/lib/request-validation';

// GET /api/agents/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    return NextResponse.json(await buildAgentDetail(agent));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 });
  }
}

// PATCH /api/agents/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent: existing } = await requireAgentAccess(id);
    const parsedBody = await readJsonObjectBody(request);
    if (!parsedBody.ok || !parsedBody.value) {
      return NextResponse.json({ error: parsedBody.error || 'Invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody.value;

    // Handle feedback action
    if (body.action === 'feedback') {
      const feedback = validateFeedbackEntry(body.feedback);
      if (!feedback.ok || !feedback.value) {
        return NextResponse.json({ error: feedback.error || 'Invalid feedback entry' }, { status: 400 });
      }
      let tweetText = feedback.value.tweetText;
      if (!tweetText && feedback.value.tweetId) {
        const tweet = await getTweet(feedback.value.tweetId);
        if (!tweet || String(tweet.agentId) !== String(id)) {
          return NextResponse.json({ error: 'Feedback tweetId does not belong to this agent' }, { status: 400 });
        }
        tweetText = tweet.content;
      }
      if (!tweetText) {
        return NextResponse.json({ error: 'Feedback needs tweetText or tweetId' }, { status: 400 });
      }
      await saveFeedback(id, {
        tweetId: feedback.value.tweetId,
        tweetText,
        rating: feedback.value.rating,
        generatedAt: new Date().toISOString(),
        reason: feedback.value.reason,
        intentSummary: feedback.value.intentSummary,
        source: feedback.value.source,
      });
      return NextResponse.json({ success: true });
    }

    // Handle funnel event action
    if (body.action === 'funnel_event' && body.event) {
      await logFunnelEvent(id, body.event as Parameters<typeof logFunnelEvent>[1], body.meta as Parameters<typeof logFunnelEvent>[2]);
      return NextResponse.json({ success: true });
    }

    const { setupStep, soulPublic } = body;
    const name = typeof body.name === 'string' ? body.name : undefined;
    const handle = typeof body.handle === 'string' ? body.handle : undefined;
    const soulMd = typeof body.soulMd === 'string' ? body.soulMd : undefined;
    if (body.name !== undefined && name === undefined) {
      return NextResponse.json({ error: 'name must be a string' }, { status: 400 });
    }
    if (body.handle !== undefined && handle === undefined) {
      return NextResponse.json({ error: 'handle must be a string' }, { status: 400 });
    }
    if (body.soulMd !== undefined && soulMd === undefined) {
      return NextResponse.json({ error: 'soulMd must be a string' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (soulPublic !== undefined) updates.soulPublic = soulPublic ? 1 : 0;
    if (setupStep !== undefined) {
      if (!isSetupStep(setupStep) || setupStep === 'ready') {
        return NextResponse.json({ error: 'Invalid setup step update' }, { status: 400 });
      }
      updates.setupStep = setupStep;
    }
    if (name !== undefined) updates.name = name;
    if (handle !== undefined) {
      const nextHandle = handle.replace(/^@/, '').trim();
      const lockedHandle = existing.isConnected === 1
        ? normalizeUsername(existing.xIdentityVerifiedHandle || existing.handle)
        : null;
      if (lockedHandle && normalizeUsername(nextHandle) !== lockedHandle) {
        return NextResponse.json({
          error: `This agent's handle follows its connected X account (@${lockedHandle}). Disconnect X before renaming it.`,
          code: 'handle_locked_to_x_identity',
          verifiedHandle: lockedHandle,
        }, { status: 400 });
      }
      updates.handle = nextHandle;
    }
    if (soulMd !== undefined) {
      updates.soulMd = soulMd;
      const profile = parseSoulMd(name ?? existing.name, soulMd);
      updates.soulSummary = profile.summary;
      if (existing.setupStep === 'soul') {
        updates.setupStep = 'analyze';
      }
    }

    const updated = await updateAgent(id, updates as Parameters<typeof updateAgent>[1]);
    return NextResponse.json({
      id: updated.id,
      handle: updated.handle,
      name: updated.name,
      soulMd: updated.soulMd,
      soulSummary: updated.soulSummary,
      isConnected: updated.isConnected,
    });
  } catch (err) {
    if (err instanceof AgentHandleConflictError) {
      return NextResponse.json({
        error: err.message,
        code: 'agent_handle_conflict',
        duplicateAgentId: err.existingAgentId,
      }, { status: 409 });
    }
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}

// DELETE /api/agents/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    await deleteAgent(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
