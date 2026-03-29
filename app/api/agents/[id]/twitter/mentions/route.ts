import { NextRequest, NextResponse } from 'next/server';
import { getAgent, createMention, getMentions } from '@/lib/kv-storage';
import { getMe, getMentionsFromTwitter, decodeKeys } from '@/lib/twitter-client';

// GET /api/agents/[id]/twitter/mentions
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const agent = await getAgent(id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

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
    const rawMentions = await getMentionsFromTwitter(keys, me.id);

    for (const m of rawMentions) {
      await createMention({
        agentId: id,
        author: m.authorId,
        authorHandle: `@${m.authorId}`,
        content: m.text,
        tweetId: m.id,
        engagementLikes: 0,
        engagementRetweets: 0,
      });
    }

    return NextResponse.json(await getMentions(id));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch mentions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
