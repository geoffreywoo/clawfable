import { NextRequest, NextResponse } from 'next/server';
import { addLearningSignal, getTweet } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { metadataWithStyleMode } from '@/lib/style-mode';
import { validateLearningSignalRequest } from '@/lib/request-validation';

// POST /api/agents/[id]/learning-signal
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);
    const body = await request.json();
    const parsed = validateLearningSignalRequest(body);
    if (!parsed.ok || !parsed.value) {
      return NextResponse.json({ error: parsed.error || 'Invalid learning signal' }, { status: 400 });
    }
    const { tweetId, xTweetId, signalType, surface, rewardDelta, reason, inferred, metadata } = parsed.value;

    let tweet: Awaited<ReturnType<typeof getTweet>> | null = null;
    if (tweetId) {
      tweet = await getTweet(String(tweetId));
      if (!tweet || String(tweet.agentId) !== String(id)) {
        return NextResponse.json({ error: 'Tweet not found' }, { status: 404 });
      }
    }

    const signal = await addLearningSignal(id, {
      tweetId: tweetId ? String(tweetId) : undefined,
      xTweetId: xTweetId ? String(xTweetId) : undefined,
      signalType,
      surface,
      rewardDelta,
      reason,
      inferred,
      metadata: tweet ? metadataWithStyleMode(tweet, metadata || {}) : metadata || undefined,
    });

    return NextResponse.json(signal);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to save learning signal';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
