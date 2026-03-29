import { NextRequest, NextResponse } from 'next/server';
import { TRENDING_TOPICS } from '@/lib/tweet-templates';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/topics
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    return NextResponse.json(TRENDING_TOPICS);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch topics' }, { status: 500 });
  }
}
