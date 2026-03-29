import { NextRequest, NextResponse } from 'next/server';
import { searchRecentTweets, decodeKeys } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/twitter/search?q=query
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
      return NextResponse.json({ error: 'Twitter API not configured for this agent' }, { status: 503 });
    }

    const query = request.nextUrl.searchParams.get('q');
    if (!query) return NextResponse.json({ error: 'Query parameter q required' }, { status: 400 });

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const results = await searchRecentTweets(keys, query, 20);
    return NextResponse.json(results);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to search tweets';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
