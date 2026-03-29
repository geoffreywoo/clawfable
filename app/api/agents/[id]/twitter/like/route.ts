import { NextRequest, NextResponse } from 'next/server';
import { getMe, likeTweet, decodeKeys } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// POST /api/agents/[id]/twitter/like
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
      return NextResponse.json({ error: 'Twitter API not configured for this agent' }, { status: 503 });
    }

    const body = await request.json();
    const { tweetId } = body;
    if (!tweetId) return NextResponse.json({ error: 'tweetId required' }, { status: 400 });

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const me = await getMe(keys);
    const result = await likeTweet(keys, me.id, tweetId);
    return NextResponse.json({ success: true, liked: result.liked });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to like tweet';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
