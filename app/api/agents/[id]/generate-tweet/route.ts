import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  createTweet,
  deleteTweet,
  getAnalysis,
  getPreviewTweets,
  getRecentNegativeFeedback,
  getStyleSignals,
} from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { generateViralBatch } from '@/lib/viral-generator';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

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
    const {
      topic,
      headline,
      count: batchCount,
      replaceTweetId,
    } = body as { topic?: string; headline?: string; count?: number; replaceTweetId?: string };
    const isPreviewRequest = batchCount !== undefined && !topic && !headline;

    if (!isPreviewRequest && !batchCount && !topic && !headline) {
      return NextResponse.json({ error: 'topic or headline required' }, { status: 400 });
    }

    if (isPreviewRequest) {
      const analysis = await getAnalysis(id);
      if (!analysis) {
        return NextResponse.json({ error: 'Run account analysis before generating preview tweets' }, { status: 400 });
      }

      const voiceProfile = parseSoulMd(agent.name, agent.soulMd);
      const existingPreviewTweets = await getPreviewTweets(id);

      if (replaceTweetId && !existingPreviewTweets.some((tweet) => tweet.id === replaceTweetId)) {
        return NextResponse.json({ error: 'Preview tweet not found' }, { status: 404 });
      }

      // Enhance voice profile with style signals and feedback
      const [styleSignals, negatives] = await Promise.all([
        getStyleSignals(id),
        getRecentNegativeFeedback(id),
      ]);

      if (styleSignals?.rawExtraction) {
        voiceProfile.communicationStyle += `\nStyle analysis: ${styleSignals.rawExtraction}`;
      }
      if (negatives.length > 0) {
        voiceProfile.communicationStyle += `\n\n## RECENT OPERATOR REJECTIONS (avoid similar content)\n${negatives.map(n => `- "${n}"`).join('\n')}`;
      }

      const requestedCount = typeof batchCount === 'number' ? batchCount : 1;
      const previewCount = Math.min(Math.max(Math.floor(requestedCount), 1), 5);
      const batch = await generateViralBatch(voiceProfile, analysis, previewCount, null, null, agent.soulMd);
      const tweets = [];
      for (const item of batch) {
        const tweet = await createTweet({
          agentId: id,
          content: item.content,
          type: 'original',
          status: 'preview',
          topic: item.targetTopic || 'general',
          xTweetId: null,
          quoteTweetId: null,
          quoteTweetAuthor: null,
          scheduledAt: null,
        });
        tweets.push(tweet);
      }

      const stalePreviewIds = replaceTweetId
        ? [replaceTweetId]
        : existingPreviewTweets.map((tweet) => tweet.id);
      await Promise.all(stalePreviewIds.map((tweetId) => deleteTweet(tweetId)));

      return NextResponse.json({ tweets });
    }

    const analysis = await getAnalysis(id);
    const voiceProfile = parseSoulMd(agent.name, agent.soulMd);

    // Enhance voice profile with style signals and feedback
    const [styleSignals, negatives] = await Promise.all([
      getStyleSignals(id),
      getRecentNegativeFeedback(id),
    ]);

    if (styleSignals?.rawExtraction) {
      voiceProfile.communicationStyle += `\nStyle analysis: ${styleSignals.rawExtraction}`;
    }
    if (negatives.length > 0) {
      voiceProfile.communicationStyle += `\n\n## RECENT OPERATOR REJECTIONS (avoid similar content)\n${negatives.map(n => `- "${n}"`).join('\n')}`;
    }

    // Use Claude if analysis exists, with the topic as trending context
    if (analysis) {
      const topicContext = headline || topic || 'general';
      // Create a minimal trending topic so Claude generates about this specific topic
      const fakeTrending = [{
        id: 0,
        headline: topicContext,
        source: 'Feed',
        relevanceScore: 95,
        category: topic || 'default',
        timestamp: new Date().toISOString(),
        tweetCount: 1,
        topTweet: null as any,
      }];

      const batch = await generateViralBatch(voiceProfile, analysis, 1, fakeTrending, null, agent.soulMd);
      if (batch.length > 0) {
        const item = batch[0];
        const tweet = await createTweet({
          agentId: id,
          content: item.content,
          type: 'original',
          status: 'draft',
          topic: topicContext,
          xTweetId: null,
          quoteTweetId: null,
          quoteTweetAuthor: null,
          scheduledAt: null,
        });
        return NextResponse.json(tweet);
      }
    }

    // Fallback: simple Claude call without analysis
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic();
    const topicText = headline || topic || 'AI and technology';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are a tweet ghostwriter. Voice: ${voiceProfile.tone}. Style: ${voiceProfile.communicationStyle}. Write a single tweet about the given topic. Vary the length naturally — short punchy takes or longer structured posts. No hashtags. Be specific and opinionated.`,
      messages: [{ role: 'user', content: `Write one tweet about: ${topicText}` }],
    });

    const content = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, ''); // strip wrapping quotes

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
