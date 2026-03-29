import { NextRequest, NextResponse } from 'next/server';
import { getAgent, createTweet } from '@/lib/kv-storage';
import { getToneFromSummary, getRandomReply } from '@/lib/tweet-templates';

// POST /api/agents/[id]/generate-reply
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const agent = await getAgent(id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const body = await request.json();
    const { content, authorHandle } = body;
    if (!content || !authorHandle) {
      return NextResponse.json({ error: 'content and authorHandle required' }, { status: 400 });
    }

    const tone = getToneFromSummary(agent.soulSummary);
    const replyContent = getRandomReply(tone, authorHandle);
    const tweet = await createTweet({
      agentId: id,
      content: replyContent,
      type: 'reply',
      status: 'draft',
      topic: `Reply to ${authorHandle}`,
      xTweetId: null,
      scheduledAt: null,
    });
    return NextResponse.json(tweet);
  } catch {
    return NextResponse.json({ error: 'Failed to generate reply' }, { status: 500 });
  }
}
