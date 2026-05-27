import { NextRequest, NextResponse } from 'next/server';
import { addPostLogEntry, createMention, getRecentMentions, invalidateAgentConnection } from '@/lib/kv-storage';
import { getMentionsFromTwitter, decodeKeys, getLatestTwitterTweetIdCursor } from '@/lib/twitter-client';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { formatActionError, getTwitterRateLimitResetAt, isInvalidTwitterCredentialError, isRateLimitTwitterError, isTransientTwitterError } from '@/lib/twitter-debug';

// GET /api/agents/[id]/twitter/mentions
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    if (!agent.isConnected || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
      return NextResponse.json({ error: 'Twitter API not configured for this agent' }, { status: 503 });
    }

    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    // Get stored mentions for dedup + sinceId
    const stored = await getRecentMentions(id, 500);
    const storedTweetIds = new Set(stored.map((m) => String(m.tweetId)).filter(Boolean));
    const latestTweetId = getLatestTwitterTweetIdCursor(stored);

    let rawMentions: Awaited<ReturnType<typeof getMentionsFromTwitter>> = [];
    try {
      rawMentions = await getMentionsFromTwitter(keys, String(agent.xUserId), latestTweetId);
    } catch (apiErr) {
      if (isInvalidTwitterCredentialError(apiErr)) {
        await invalidateAgentConnection(id);
        await addPostLogEntry(id, {
          agentId: id,
          tweetId: '',
          xTweetId: '',
          content: '',
          format: 'manual_mentions_error',
          topic: 'mentions',
          postedAt: new Date().toISOString(),
          source: 'manual',
          action: 'error',
          reason: `X credentials rejected by X. Agent disconnected, reconnect in Settings. ${formatActionError(apiErr, 'fetch_mentions', {
            handle: `@${agent.handle}`,
            xUserId: agent.xUserId,
          })}`,
        }).catch(() => null);
        return NextResponse.json({
          error: 'X credentials rejected by X. Agent disconnected, reconnect in Settings.',
          mentions: stored,
        }, { status: 401 });
      }

      const rateLimited = isRateLimitTwitterError(apiErr);
      if (rateLimited || isTransientTwitterError(apiErr)) {
        const resetAt = rateLimited ? getTwitterRateLimitResetAt(apiErr) : null;
        const retryMessage = rateLimited
          ? `X mention refresh rate limited${resetAt ? ` until ${resetAt}` : ''}. Try again after the reset.`
          : 'Temporary X mention refresh failure. Try again in a few minutes.';
        await addPostLogEntry(id, {
          agentId: id,
          tweetId: '',
          xTweetId: '',
          content: '',
          format: 'manual_mentions_error',
          topic: 'mentions',
          postedAt: new Date().toISOString(),
          source: 'manual',
          action: 'error',
          reason: `${retryMessage} ${formatActionError(apiErr, 'fetch_mentions', {
            handle: `@${agent.handle}`,
            xUserId: agent.xUserId,
          })}`,
          errorCode: rateLimited ? 'x_rate_limit' : 'x_transient',
        }).catch(() => null);
        return NextResponse.json({
          error: retryMessage,
          mentions: stored,
        }, { status: rateLimited ? 429 : 503 });
      }

      // Mention timeline may not be available on Free tier
      const msg = apiErr instanceof Error ? apiErr.message : '';
      if (msg.includes('403')) {
        return NextResponse.json(stored);
      }
      throw apiErr;
    }

    // Only store new mentions (dedup by tweetId)
    let added = 0;
    for (const m of rawMentions) {
      if (storedTweetIds.has(String(m.id))) continue;
      await createMention({
        agentId: id,
        author: String(m.authorName || m.authorId),
        authorHandle: `@${String(m.authorUsername || m.authorId)}`,
        content: m.text,
        tweetId: m.id,
        conversationId: m.conversationId || null,
        inReplyToTweetId: m.inReplyToTweetId || null,
        engagementLikes: 0,
        engagementRetweets: 0,
        createdAt: m.createdAt,
      });
      added++;
    }

    // Return fresh sorted list
    const all = await getRecentMentions(id, 100);
    return NextResponse.json(all);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to fetch mentions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
