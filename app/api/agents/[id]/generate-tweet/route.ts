import { NextRequest, NextResponse } from 'next/server';
import { createTweet, getAnalysis } from '@/lib/kv-storage';
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

    const body = await request.json();
    const { topic, headline } = body;
    if (!topic && !headline) {
      return NextResponse.json({ error: 'topic or headline required' }, { status: 400 });
    }

    const analysis = await getAnalysis(id);
    const voiceProfile = parseSoulMd(agent.name, agent.soulMd);

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

      const batch = await generateViralBatch(voiceProfile, analysis, 1, fakeTrending);
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
      max_tokens: 300,
      system: `You are a tweet ghostwriter. Voice: ${voiceProfile.tone}. Style: ${voiceProfile.communicationStyle}. Write a single tweet about the given topic. Under 280 characters. No hashtags. Be specific and opinionated.`,
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
      content: content.slice(0, 280),
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
    return NextResponse.json({ error: 'Failed to generate tweet' }, { status: 500 });
  }
}
