import { NextRequest, NextResponse } from 'next/server';
import { updateAgent, deleteAgent, saveFeedback, logFunnelEvent } from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { isSetupStep } from '@/lib/setup-state';
import { buildAgentDetail } from '@/lib/dashboard-data';

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
    const body = await request.json();

    // Handle feedback action
    if (body.action === 'feedback' && body.feedback) {
      await saveFeedback(id, body.feedback);
      return NextResponse.json({ success: true });
    }

    // Handle funnel event action
    if (body.action === 'funnel_event' && body.event) {
      await logFunnelEvent(id, body.event, body.meta);
      return NextResponse.json({ success: true });
    }

    const { name, soulMd, handle, setupStep, soulPublic } = body;

    const updates: Record<string, unknown> = {};
    if (soulPublic !== undefined) updates.soulPublic = soulPublic ? 1 : 0;
    if (setupStep !== undefined) {
      if (!isSetupStep(setupStep) || setupStep === 'ready') {
        return NextResponse.json({ error: 'Invalid setup step update' }, { status: 400 });
      }
      updates.setupStep = setupStep;
    }
    if (name !== undefined) updates.name = name;
    if (handle !== undefined) updates.handle = handle.replace(/^@/, '').trim();
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
