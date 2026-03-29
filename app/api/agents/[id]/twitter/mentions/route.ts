import { NextRequest, NextResponse } from 'next/server';
import { createMention, getMentions } from '@/lib/kv-storage';
import { getMe, getMentionsFromTwitter, decodeKeys } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/twitter/mentions
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
      return NextResponse.json({ error: 'Twitter API not configured for this agent' }, { status: 503 });
    }

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const me = await getMe(keys);

    let rawMentions: Awaited<ReturnType<typeof getMentionsFromTwitter>> = [];
    try {
      rawMentions = await getMentionsFromTwitter(keys, me.id);
    } catch (apiErr) {
      // Mention timeline may not be available on Free tier
      const msg = apiErr instanceof Error ? apiErr.message : '';
      if (msg.includes('403') || msg.includes('Rate limit')) {
        return NextResponse.json(await getMentions(id));
      }
      throw apiErr;
    }

    for (const m of rawMentions) {
      await createMention({
        agentId: id,
        author: String(m.authorId),
        authorHandle: `@${String(m.authorId)}`,
        content: m.text,
        tweetId: m.id,
        engagementLikes: 0,
        engagementRetweets: 0,
      });
    }

    return NextResponse.json(await getMentions(id));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to fetch mentions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
