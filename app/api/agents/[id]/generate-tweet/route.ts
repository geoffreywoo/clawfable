import { NextRequest, NextResponse } from 'next/server';
import { getAgent, createTweet } from '@/lib/kv-storage';
import { getToneFromSummary, getRandomTake } from '@/lib/tweet-templates';

// POST /api/agents/[id]/generate-tweet
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const agent = await getAgent(id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const body = await request.json();
    const { topic, headline } = body;
    if (!topic && !headline) {
      return NextResponse.json({ error: 'topic or headline required' }, { status: 400 });
    }

    const tone = getToneFromSummary(agent.soulSummary);
    const content = getRandomTake(tone, topic || headline || 'default');
    const tweet = await createTweet({
      agentId: id,
      content,
      type: 'original',
      status: 'draft',
      topic: headline || topic || null,
      xTweetId: null,
      scheduledAt: null,
    });
    return NextResponse.json(tweet);
  } catch {
    return NextResponse.json({ error: 'Failed to generate tweet' }, { status: 500 });
  }
}
