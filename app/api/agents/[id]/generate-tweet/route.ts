import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  createTweet,
  deleteTweet,
  getAnalysis,
  getPreviewTweets,
} from '@/lib/kv-storage';
import { generateViralBatch } from '@/lib/viral-generator';
import { normalizeGeneratedTweetContent } from '@/lib/tweet-text';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';
import { getGeneratedTweetIssue } from '@/lib/survivability';
import { generateText } from '@/lib/ai';
import { validateGenerationRequest } from '@/lib/request-validation';
import { createTweetFromGeneratedCandidate } from '@/lib/tweet-persistence';
import {
  formatSingleTweetStyleForPrompt,
  formatSingleTweetTopicForPrompt,
  getSingleTweetFallbackMaxTokens,
} from '@/lib/single-tweet-prompt';

// POST /api/agents/[id]/generate-tweet
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    // Rate limit: 20 generations per hour per agent
    const allowed = await checkRateLimit(id, 'generate', 20);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = validateGenerationRequest(body, { maxCount: 5, requireTopicOrCount: true });
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

    if (isPreviewRequest) {
      const analysis = await getAnalysis(id);
      if (!analysis) {
        return NextResponse.json({ error: 'Run account analysis before generating preview tweets' }, { status: 400 });
      }

      const { voiceProfile, learnings, style, recentPosts, allTweets, memory, ideaAtoms = [], signals = [] } = await buildGenerationContext(agent, {
        negativeLimit: 10,
        directiveLimit: 10,
      });
      const existingPreviewTweets = await getPreviewTweets(id);

      if (replaceTweetId && !existingPreviewTweets.some((tweet) => tweet.id === replaceTweetId)) {
        return NextResponse.json({ error: 'Preview tweet not found' }, { status: 404 });
      }

      const previewCount = batchCount ?? 1;
      const batch = await generateViralBatch(voiceProfile, analysis, previewCount, null, learnings, agent.soulMd, style, recentPosts, allTweets, memory, ideaAtoms, signals);
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

      return NextResponse.json({ tweets });
    }

    const analysis = await getAnalysis(id);
    const { voiceProfile, learnings, style, recentPosts, allTweets, memory, ideaAtoms = [], signals = [] } = await buildGenerationContext(agent, {
      negativeLimit: 10,
      directiveLimit: 10,
    });

    // Use the shared generator if analysis exists, with the topic as trending context
    if (analysis) {
      const topicContext = headline || topic || 'general';
      // Create a minimal trending topic so the generator targets this specific topic
      const fakeTrending = [{
        id: 0,
        headline: topicContext,
        source: 'Feed',
        relevanceScore: 95,
        category: topic || 'default',
        timestamp: new Date().toISOString(),
        tweetCount: 1,
        topTweet: { id: 'manual-topic', text: topicContext, likes: 0, author: agent.handle },
      }];

      const batch = await generateViralBatch(voiceProfile, analysis, 1, fakeTrending, learnings, agent.soulMd, style, recentPosts, allTweets, memory, ideaAtoms, signals);
      if (batch.length > 0) {
        const item = batch[0];
        const generationIssue = getGeneratedTweetIssue(item.content);
        if (generationIssue) {
          return NextResponse.json({ error: generationIssue }, { status: 502 });
        }
        const tweet = await createTweetFromGeneratedCandidate(id, item, { status: 'draft', topic: topicContext });
        return NextResponse.json(tweet);
      }
    }

    // Fallback: simple one-shot generation without analysis
    const topicText = headline || topic || 'AI and technology';
    const promptTopic = formatSingleTweetTopicForPrompt(topicText);

    const response = await generateText({
      task: 'tweet_generation',
      tier: 'quality',
      maxTokens: getSingleTweetFallbackMaxTokens(topicText.length),
      system: `You are a tweet ghostwriter. Voice: ${voiceProfile.tone}. Style: ${formatSingleTweetStyleForPrompt(voiceProfile.communicationStyle)}. Write a single tweet about the given topic. Vary the length naturally — short punchy takes or longer structured posts. No hashtags. Be specific and opinionated.`,
      prompt: `Write one tweet about: ${promptTopic}`,
    });

    const content = normalizeGeneratedTweetContent(
      response.text
        .trim()
        .replace(/^["']|["']$/g, '') // strip wrapping quotes
    );

    const generationIssue = getGeneratedTweetIssue(content, response.stopReason);
    if (generationIssue) {
      return NextResponse.json({ error: generationIssue }, { status: 502 });
    }

    const tweet = await createTweet({
      agentId: id,
      content,
      type: 'original',
      status: 'draft',
      topic: topicText,
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });
    return NextResponse.json(tweet);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to generate tweet';
    console.error('generate-tweet error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
