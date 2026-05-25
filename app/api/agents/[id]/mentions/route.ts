import { NextRequest, NextResponse } from 'next/server';
import { getRecentMentions } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/mentions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 100);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, Math.floor(requestedLimit))) : 100;
    const mentions = await getRecentMentions(id, limit);
    return NextResponse.json(mentions);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch mentions' }, { status: 500 });
  }
}
