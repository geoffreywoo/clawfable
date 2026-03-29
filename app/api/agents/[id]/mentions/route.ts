import { NextRequest, NextResponse } from 'next/server';
import { getMentions } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/mentions
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const mentions = await getMentions(id);
    return NextResponse.json(mentions);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch mentions' }, { status: 500 });
  }
}
