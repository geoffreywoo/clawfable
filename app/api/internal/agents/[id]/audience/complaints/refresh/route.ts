import { NextRequest, NextResponse } from 'next/server';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import {
  backfillAudienceVoiceComplaints,
  createMention,
  getAgent,
  getTweets,
  resetReadCache,
} from '@/lib/kv-storage';
import { decodeKeys, fetchTweetById } from '@/lib/twitter-client';

const MAX_TWEET_IDS = 20;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }

  resetReadCache();
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (!agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
    return NextResponse.json({ error: 'X API credentials are not configured.' }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const tweetIds = [...new Set(
    (Array.isArray(body?.tweetIds) ? body.tweetIds : [])
      .map((value: unknown) => String(value || '').trim())
      .filter((value: string) => /^\d{8,25}$/.test(value)),
  )].slice(0, MAX_TWEET_IDS) as string[];
  if (tweetIds.length === 0) {
    return NextResponse.json({ error: 'tweetIds must contain at least one X tweet ID.' }, { status: 400 });
  }

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });
  const [fetched, storedTweets] = await Promise.all([
    Promise.all(tweetIds.map((tweetId) => fetchTweetById(keys, tweetId))),
    getTweets(id),
  ]);
  const storedParentIds = new Set(storedTweets.map((tweet) => String(tweet.xTweetId || '')).filter(Boolean));
  const replies = fetched.filter((tweet): tweet is NonNullable<typeof tweet> => (
    Boolean(tweet?.inReplyToId) && storedParentIds.has(String(tweet?.inReplyToId || ''))
  ));
  for (const tweet of replies) {
    await createMention({
      agentId: id,
      author: tweet.authorUsername || tweet.authorId,
      authorHandle: tweet.authorUsername ? `@${tweet.authorUsername}` : tweet.authorId,
      content: tweet.text,
      tweetId: tweet.id,
      conversationId: tweet.inReplyToId,
      inReplyToTweetId: tweet.inReplyToId,
      engagementLikes: tweet.likes,
      engagementRetweets: 0,
      createdAt: tweet.createdAt,
    });
  }
  const backfill = await backfillAudienceVoiceComplaints(id, 1000);

  return NextResponse.json({
    agentId: id,
    requested: tweetIds.length,
    fetched: fetched.filter(Boolean).length,
    parentLinkedReplies: replies.length,
    missingOrIneligibleTweetIds: tweetIds.filter((tweetId) => !replies.some((tweet) => tweet.id === tweetId)),
    complaints: backfill,
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
