import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { decodeKeys } from '@/lib/twitter-client';
import { fetchTrendingFromFollowing } from '@/lib/trending';

// GET /api/agents/[id]/topics — fetch trending topics from following graph
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    // If connected, pull real trending topics from the following graph
    if (agent.isConnected && agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret && agent.xUserId) {
      const keys = decodeKeys({
        apiKey: agent.apiKey,
        apiSecret: agent.apiSecret,
        accessToken: agent.accessToken,
        accessSecret: agent.accessSecret,
      });

      try {
        const topics = await fetchTrendingFromFollowing(keys, agent.xUserId);
        if (topics.length > 0) {
          return NextResponse.json(topics);
        }
      } catch {
        // Fall through to static topics on API error
      }
    }

    // No data available
    return NextResponse.json([]);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch topics' }, { status: 500 });
  }
}
