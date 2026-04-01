import { NextRequest, NextResponse } from 'next/server';
import { deleteTweet, getTweet, saveFeedback, updateTweet } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { inferDeleteIntent } from '@/lib/delete-intent';

// PATCH /api/agents/[id]/queue/[tweetId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tweetId: string }> }
) {
  const { id, tweetId } = await params;
  try {
    await requireAgentAccess(id);
    const tweet = await getTweet(String(tweetId));
    if (!tweet || String(tweet.agentId) !== String(id)) {
      return NextResponse.json({ error: 'Tweet not found' }, { status: 404 });
    }

    const body = await request.json();
    const { content, status, scheduledAt } = body;
    const updates: Record<string, unknown> = {};
    if (content !== undefined) updates.content = content;
    if (status !== undefined) {
      if (!['draft', 'queued', 'posted'].includes(status)) {
        return NextResponse.json({ error: 'Invalid tweet status' }, { status: 400 });
      }
      updates.status = status;
    }
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt;
    const updated = await updateTweet(tweetId, updates as Parameters<typeof updateTweet>[1]);
    return NextResponse.json(updated);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to update tweet';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/agents/[id]/queue/[tweetId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tweetId: string }> }
) {
  const { id, tweetId } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const tweet = await getTweet(String(tweetId));
    if (!tweet || String(tweet.agentId) !== String(id)) {
      return NextResponse.json({ error: 'Tweet not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const userReason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const intentSummary = userReason || await inferDeleteIntent({
      agentName: agent.name,
      soulMd: agent.soulMd,
      tweetText: tweet.content,
    });

    await saveFeedback(id, {
      tweetText: tweet.content,
      rating: 'down',
      generatedAt: new Date().toISOString(),
      reason: userReason || undefined,
      intentSummary,
      source: 'queue_delete',
      userProvidedReason: !!userReason,
    });

    await deleteTweet(tweetId);
    return NextResponse.json({
      success: true,
      feedbackSource: userReason ? 'user' : 'inferred',
      intentSummary,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to delete tweet' }, { status: 500 });
  }
}
