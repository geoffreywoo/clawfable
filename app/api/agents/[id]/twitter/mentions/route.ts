import { NextRequest, NextResponse } from 'next/server';
import { createMention, getMentions } from '@/lib/kv-storage';
import { getMentionsFromTwitter, decodeKeys } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/twitter/mentions
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
      return NextResponse.json({ error: 'Twitter API not configured for this agent' }, { status: 503 });
    }

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    // Get stored mentions for dedup + sinceId
    const stored = await getMentions(id);
    const storedTweetIds = new Set(stored.map((m) => String(m.tweetId)).filter(Boolean));
    const latestTweetId = stored.length > 0 ? String(stored[0].tweetId) : undefined;

    let rawMentions: Awaited<ReturnType<typeof getMentionsFromTwitter>> = [];
    try {
      rawMentions = await getMentionsFromTwitter(keys, String(agent.xUserId), latestTweetId);
    } catch (apiErr) {
      // Mention timeline may not be available on Free tier
      const msg = apiErr instanceof Error ? apiErr.message : '';
      if (msg.includes('403') || msg.includes('Rate limit')) {
        return NextResponse.json(stored);
      }
      throw apiErr;
    }

    // Only store new mentions (dedup by tweetId)
    let added = 0;
    for (const m of rawMentions) {
      if (storedTweetIds.has(String(m.id))) continue;
      await createMention({
        agentId: id,
        author: String(m.authorName || m.authorId),
        authorHandle: `@${String(m.authorUsername || m.authorId)}`,
        content: m.text,
        tweetId: m.id,
        engagementLikes: 0,
        engagementRetweets: 0,
        createdAt: m.createdAt,
      });
      added++;
    }

    // Return fresh sorted list
    const all = await getMentions(id);
    return NextResponse.json(all);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to fetch mentions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
