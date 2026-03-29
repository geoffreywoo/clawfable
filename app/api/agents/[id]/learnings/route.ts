import { NextRequest, NextResponse } from 'next/server';
import { getLearnings } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/learnings
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const learnings = await getLearnings(id);
    return NextResponse.json(learnings ?? null);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch learnings' }, { status: 500 });
  }
}
