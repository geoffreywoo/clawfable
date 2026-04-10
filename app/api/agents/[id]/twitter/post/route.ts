import { NextRequest, NextResponse } from 'next/server';
import { addLearningSignal, getTweet, updateTweet } from '@/lib/kv-storage';
import { postTweet, replyToTweet, decodeKeys } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { getTweetCompletenessIssue } from '@/lib/survivability';

// POST /api/agents/[id]/twitter/post
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let dbTweetId: string | null = null;
  let existingTweet = null as Awaited<ReturnType<typeof getTweet>> | null;
  let isReply = false;
  try {
    const { agent } = await requireAgentAccess(id);

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
      return NextResponse.json({ error: 'Twitter API not configured for this agent' }, { status: 503 });
    }

    const body = await request.json();
    const { content, replyToId, tweetId } = body;
    dbTweetId = tweetId ? String(tweetId) : null;
    if (!content) return NextResponse.json({ error: 'Content required' }, { status: 400 });
    existingTweet = dbTweetId ? await getTweet(String(dbTweetId)) : null;
    isReply = existingTweet?.type === 'reply' || Boolean(replyToId);

    const completenessIssue = getTweetCompletenessIssue(String(content));
    if (completenessIssue) {
      const quarantineReason = `${completenessIssue} Draft quarantined until reviewed.`;
      if (dbTweetId) {
        await updateTweet(dbTweetId, {
          quarantinedAt: new Date().toISOString(),
          quarantineReason,
        });
        await addLearningSignal(id, {
          tweetId: dbTweetId,
          signalType: isReply ? 'reply_rejected' : 'x_post_rejected',
          surface: isReply ? 'mentions' : 'manual_post',
          rewardDelta: -0.75,
          reason: quarantineReason,
        });
      }
      return NextResponse.json({ error: completenessIssue }, { status: 422 });
    }

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    let result: { tweetUrl: string; tweetId: string; username: string };
    if (replyToId) {
      result = await replyToTweet(keys, content, replyToId);
    } else {
      result = await postTweet(keys, content);
    }

    if (dbTweetId) {
      const updated = await updateTweet(String(dbTweetId), { status: 'posted', xTweetId: result.tweetId, postedAt: new Date().toISOString() });
      await addLearningSignal(id, {
        tweetId: String(dbTweetId),
        xTweetId: result.tweetId,
        signalType: updated.type === 'reply' ? 'reply_posted' : 'x_post_succeeded',
        surface: updated.type === 'reply' ? 'mentions' : 'manual_post',
        rewardDelta: 0.72,
        metadata: {
          confidenceScore: updated.confidenceScore ?? null,
          candidateScore: updated.candidateScore ?? null,
          generationMode: updated.generationMode ?? null,
          wasEdited: (existingTweet?.editCount ?? 0) > 0,
        },
      });
    }

    return NextResponse.json({ success: true, tweetUrl: result.tweetUrl, tweetId: result.tweetId });
  } catch (err) {
    if (dbTweetId) {
      const message = err instanceof Error ? err.message : 'Failed to post tweet';
      await updateTweet(dbTweetId, {
        quarantinedAt: new Date().toISOString(),
        quarantineReason: message,
      }).catch(() => null);
      await addLearningSignal(id, {
        tweetId: dbTweetId,
        signalType: isReply ? 'reply_rejected' : 'x_post_rejected',
        surface: isReply ? 'mentions' : 'manual_post',
        rewardDelta: -0.75,
        reason: message,
      }).catch(() => null);
    }
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to post tweet';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
