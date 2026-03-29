import { NextRequest, NextResponse } from 'next/server';
import { getAgent, updateAgent, deleteAgent, getTweets, getMentions } from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';

// GET /api/agents/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const agent = await getAgent(id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    return NextResponse.json({
      id: agent.id,
      handle: agent.handle,
      name: agent.name,
      soulMd: agent.soulMd,
      soulSummary: agent.soulSummary,
      isConnected: agent.isConnected,
      xUserId: agent.xUserId,
      setupStep: agent.setupStep || 'ready',
      createdAt: agent.createdAt,
      hasKeys: !!(agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret),
    });
  } catch {
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
    const body = await request.json();
    const { name, soulMd, handle } = body;
    const existing = await getAgent(id);
    if (!existing) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (handle !== undefined) updates.handle = handle.replace(/^@/, '').trim();
    if (soulMd !== undefined) {
      updates.soulMd = soulMd;
      const profile = parseSoulMd(name ?? existing.name, soulMd);
      updates.soulSummary = profile.summary;
      // Advance setup if on soul step
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
  } catch {
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
    await deleteAgent(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
