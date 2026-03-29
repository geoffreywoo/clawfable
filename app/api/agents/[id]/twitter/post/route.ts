import { NextRequest, NextResponse } from 'next/server';
import { getAgent, updateTweet } from '@/lib/kv-storage';
import { postTweet, replyToTweet, decodeKeys } from '@/lib/twitter-client';

// POST /api/agents/[id]/twitter/post
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const agent = await getAgent(id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
      return NextResponse.json({ error: 'Twitter API not configured for this agent' }, { status: 503 });
    }

    const body = await request.json();
    const { content, replyToId, tweetId: dbTweetId } = body;
    if (!content) return NextResponse.json({ error: 'Content required' }, { status: 400 });

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    let result: { tweetUrl: string; tweetId: string; username: string };
    if (replyToId) {
      result = await replyToTweet(keys, content, replyToId);
    } else {
      result = await postTweet(keys, content);
    }

    if (dbTweetId) {
      await updateTweet(String(dbTweetId), { status: 'posted', xTweetId: result.tweetId });
    }

    return NextResponse.json({ success: true, tweetUrl: result.tweetUrl, tweetId: result.tweetId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to post tweet';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
