import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getAgentTopics, refreshAgentTopics } from '@/lib/dashboard-data';

// GET /api/agents/[id]/topics — fetch trending topics from following graph
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const shouldRefresh = request.nextUrl.searchParams.get('refresh') === '1';

    if (shouldRefresh) {
      const topics = await refreshAgentTopics(agent);
      return NextResponse.json(topics);
    }

    return NextResponse.json(await getAgentTopics(agent));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch topics' }, { status: 500 });
  }
}
