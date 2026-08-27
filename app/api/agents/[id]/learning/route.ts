import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getAgentLearningSnapshot } from '@/lib/dashboard-data';

// GET /api/agents/[id]/learning
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    return NextResponse.json(await getAgentLearningSnapshot(agent));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch learning snapshot' }, { status: 500 });
  }
}
