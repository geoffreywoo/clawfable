import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  deleteTweet,
  getAnalysis,
  getPreviewTweets,
  getTrendingCache,
} from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';
import { getGeneratedTweetIssue } from '@/lib/survivability';
import { PUBLISHING_V2_MODEL_STACK } from '@/lib/ai';
import type { TrendingTopic } from '@/lib/trending';
import { readJsonObjectBody, validateGenerationRequest } from '@/lib/request-validation';
import { createTweetFromGeneratedCandidate } from '@/lib/tweet-persistence';
import { generatePublishingBatchV2 } from '@/lib/publishing-v2';
import { getAgentAutomationEntitlement } from '@/lib/automation-entitlement';

// POST /api/agents/[id]/generate-tweet
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    const body = await readJsonObjectBody(request);
    if (!body.ok || !body.value) {
      return NextResponse.json({ error: body.error || 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = validateGenerationRequest(body.value, { maxCount: 5, requireTopicOrCount: true });
    if (!parsed.ok || !parsed.value) {
      return NextResponse.json({ error: parsed.error || 'Invalid generation request' }, { status: 400 });
    }
    const {
      topic,
      headline,
      count: batchCount,
      replaceTweetId,
    } = parsed.value;
    const isPreviewRequest = batchCount !== undefined && !topic && !headline;
    if (!isPreviewRequest && !batchCount && !topic && !headline) {
      return NextResponse.json({ error: 'topic or headline required' }, { status: 400 });
    }

    // Rate limits are consumed only after the request has validated, so a
    // rejected body never burns a generation or free-preview slot.
    const allowed = await checkRateLimit(id, 'generate', 20);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 });
    }
    const entitlement = await getAgentAutomationEntitlement(id, { agent });
    if (!entitlement.eligible && !(await checkRateLimit(id, 'unpaid_preview_generation', 5))) {
      return NextResponse.json({ error: 'Free preview limit reached. Try again later.' }, { status: 429 });
    }
    // Free previews are clamped to two drafts (mirrors protocol/generate) and
    // flagged with previewLimited instead of rejecting the first batch outright.
    const previewLimited = !entitlement.eligible;

    if (isPreviewRequest) {
      const analysis = await getAnalysis(id);
      if (!analysis) {
        return NextResponse.json({ error: 'Run account analysis before generating preview tweets' }, { status: 400 });
      }

      const { voiceProfile, learnings, style, recentPosts, allTweets, memory, signals = [] } = await buildGenerationContext(agent, {
        negativeLimit: 10,
        directiveLimit: 10,
      });
      const existingPreviewTweets = await getPreviewTweets(id);

      if (replaceTweetId && !existingPreviewTweets.some((tweet) => tweet.id === replaceTweetId)) {
        return NextResponse.json({ error: 'Preview tweet not found' }, { status: 404 });
      }

      const requestedCount = batchCount ?? 1;
      const previewCount = previewLimited ? Math.min(requestedCount, 2) : requestedCount;
      const cachedTrending = await getTrendingCache(id);
      const trending = Array.isArray(cachedTrending) ? cachedTrending as TrendingTopic[] : null;
      const batch = await generatePublishingBatchV2({
        agentId: id,
        count: previewCount,
        request: {
          surface: 'original',
          triggerId: replaceTweetId ? `preview-replace:${replaceTweetId}` : `preview:${Date.now()}`,
        },
        voiceProfile,
        analysis,
        learnings,
        style,
        recentPosts,
        allTweets,
        memory,
        signals,
        trending,
        modelStack: PUBLISHING_V2_MODEL_STACK,
        mode: 'preview',
        entitlement,
      });
      const tweets = [];
      for (const item of batch) {
        if (getGeneratedTweetIssue(item.content)) continue;
        const tweet = await createTweetFromGeneratedCandidate(id, item, { status: 'preview', topic: item.targetTopic || 'general' });
        tweets.push(tweet);
      }

      if (tweets.length === 0) {
        return NextResponse.json({ error: 'Generation failed — all preview drafts were incomplete' }, { status: 502 });
      }

      const stalePreviewIds = replaceTweetId
        ? [replaceTweetId]
        : existingPreviewTweets.map((tweet) => tweet.id);
      await Promise.all(stalePreviewIds.map((tweetId) => deleteTweet(tweetId)));

      return NextResponse.json({ tweets, previewLimited });
    }

    const analysis = await getAnalysis(id);
    const { voiceProfile, learnings, style, recentPosts, allTweets, memory, signals = [] } = await buildGenerationContext(agent, {
      negativeLimit: 10,
      directiveLimit: 10,
    });

    if (analysis) {
      const topicContext = headline || topic || 'general';
      const batch = await generatePublishingBatchV2({
        agentId: id,
        count: 1,
        request: {
          surface: 'original',
          triggerId: replaceTweetId ? `manual-replace:${replaceTweetId}` : `manual:${Date.now()}`,
          requestedTopic: topicContext,
        },
        voiceProfile,
        analysis,
        learnings,
        style,
        recentPosts,
        allTweets,
        memory,
        signals,
        trending: null,
        modelStack: PUBLISHING_V2_MODEL_STACK,
        mode: entitlement.eligible ? 'manual' : 'preview',
        entitlement,
      });
      if (batch.length > 0) {
        const item = batch[0];
        const generationIssue = getGeneratedTweetIssue(item.content);
        if (generationIssue) {
          return NextResponse.json({ error: generationIssue }, { status: 502 });
        }
        const tweet = await createTweetFromGeneratedCandidate(id, item, {
          status: entitlement.eligible ? 'draft' : 'preview',
          topic: topicContext,
        });
        return NextResponse.json({ ...tweet, previewLimited: !entitlement.eligible });
      }
      return NextResponse.json({ error: 'No draft cleared the evidence, originality, and voice gates.' }, { status: 422 });
    }

    return NextResponse.json({ error: 'Run account analysis before generating V2 drafts.' }, { status: 400 });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to generate tweet';
    console.error('generate-tweet error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
