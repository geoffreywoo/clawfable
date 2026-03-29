import { NextRequest, NextResponse } from 'next/server';
import { updateTweet, deleteTweet } from '@/lib/kv-storage';

// PATCH /api/agents/[id]/queue/[tweetId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tweetId: string }> }
) {
  const { tweetId } = await params;
  try {
    const body = await request.json();
    const { content, status, scheduledAt } = body;
    const updates: Record<string, unknown> = {};
    if (content !== undefined) updates.content = content;
    if (status !== undefined) updates.status = status;
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt;
    const updated = await updateTweet(tweetId, updates as Parameters<typeof updateTweet>[1]);
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update tweet';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/agents/[id]/queue/[tweetId]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; tweetId: string }> }
) {
  const { tweetId } = await params;
  try {
    await deleteTweet(tweetId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete tweet' }, { status: 500 });
  }
}
