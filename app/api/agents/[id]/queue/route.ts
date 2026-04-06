import { NextRequest, NextResponse } from 'next/server';
import { getQueuedTweets, getTweets, createTweet } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/queue
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const queued = await getQueuedTweets(id);
    // Include tweets deleted from X in last 7 days that need feedback (no reason yet)
    const allTweets = await getTweets(id);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const deletedFromX = allTweets.filter((t) =>
      t.status === 'deleted_from_x' &&
      !t.deletionReason &&
      new Date(t.createdAt).getTime() > sevenDaysAgo
    );
    return NextResponse.json([...deletedFromX, ...queued]);
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
