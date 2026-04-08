import { NextRequest, NextResponse } from 'next/server';
import { createTweet } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getAgentQueueFeed } from '@/lib/dashboard-data';

// GET /api/agents/[id]/queue
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    return NextResponse.json(await getAgentQueueFeed(id));
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 });
  }
}

// POST /api/agents/[id]/queue
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const body = await request.json();
    const { content, topic, type } = body;
    if (!content) return NextResponse.json({ error: 'Content required' }, { status: 400 });

    const tweet = await createTweet({
      agentId: id,
      content,
      type: type || 'original',
      status: 'queued',
      topic: topic || null,
      xTweetId: null,
      quoteTweetId: body.quoteTweetId || null,
      quoteTweetAuthor: body.quoteTweetAuthor || null,
      scheduledAt: null,
    });
    return NextResponse.json(tweet);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to add to queue' }, { status: 500 });
  }
}
