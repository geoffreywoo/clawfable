import { NextRequest, NextResponse } from 'next/server';
import { createTweet } from '@/lib/kv-storage';
import { getToneFromSummary, getRandomReply } from '@/lib/tweet-templates';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// POST /api/agents/[id]/generate-reply
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

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
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    return NextResponse.json(tweet);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to generate reply' }, { status: 500 });
  }
}
