import { NextRequest, NextResponse } from 'next/server';
import { createTweet, getAnalysis, getStyleSignals, getRecentNegativeFeedback, checkRateLimit } from '@/lib/kv-storage';
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
    const { topic, headline, count: batchCount } = body as { topic?: string; headline?: string; count?: number };

    // Batch mode skips topic requirement (preview uses no topic)
    if (!batchCount && !topic && !headline) {
      return NextResponse.json({ error: 'topic or headline required' }, { status: 400 });
    }

    // Batch mode for preview: generate multiple tweets in one call
    if (batchCount && batchCount > 1) {
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
        voiceProfile.communicationStyle += `\n\n## REJECTED DRAFTS (avoid similar content)\n${negatives.map(n => `- "${n}"`).join('\n')}`;
      }

      const n = Math.min(batchCount, 5);
      if (analysis) {
        const batch = await generateViralBatch(voiceProfile, analysis, n, null, null, agent.soulMd);
        const tweets = [];
        for (const item of batch) {
          const tweet = await createTweet({
            agentId: id,
            content: item.content,
            type: item.quoteTweetId ? 'quote' : 'original',
            status: 'draft',
            topic: item.targetTopic || 'general',
            xTweetId: null,
            quoteTweetId: item.quoteTweetId || null,
            quoteTweetAuthor: item.quoteTweetAuthor || null,
            scheduledAt: null,
          });
          tweets.push(tweet);
        }
        return NextResponse.json({ tweets });
      }

      // Fallback for batch without analysis
      return NextResponse.json({ tweets: [] });
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
      voiceProfile.communicationStyle += `\n\n## REJECTED DRAFTS (avoid similar content)\n${negatives.map(n => `- "${n}"`).join('\n')}`;
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
          type: item.quoteTweetId ? 'quote' : 'original',
          status: 'draft',
          topic: topicContext,
          xTweetId: null,
          quoteTweetId: item.quoteTweetId || null,
          quoteTweetAuthor: item.quoteTweetAuthor || null,
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
