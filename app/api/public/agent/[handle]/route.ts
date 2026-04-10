import { NextRequest, NextResponse } from 'next/server';
import { getAgentByHandle, getLearnings, getPerformanceHistory } from '@/lib/kv-storage';
import { getPresetSoulProfile } from '@/lib/open-source-souls';

// GET /api/public/agent/[handle] — public agent profile, no auth required
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  try {
    const preset = getPresetSoulProfile(handle);
    if (preset) {
      return NextResponse.json(preset);
    }

    const agent = await getAgentByHandle(handle);
    if (!agent || agent.setupStep !== 'ready' || agent.soulPublic === 0) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const [learnings, perfHistory] = await Promise.all([
      getLearnings(agent.id),
      getPerformanceHistory(agent.id, 50),
    ]);

    // Top tweets by engagement (public data only, no API keys)
    const topTweets = perfHistory
      .sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets))
      .slice(0, 5)
      .map((t) => ({
        content: t.content,
        likes: t.likes,
        retweets: t.retweets,
        format: t.format,
        topic: t.topic,
        postedAt: t.postedAt,
      }));

    return NextResponse.json({
      handle: agent.handle,
      name: agent.name,
      soulMd: agent.soulMd,
      soulSummary: agent.soulSummary,
      totalTracked: learnings?.totalTracked ?? 0,
      avgLikes: learnings?.avgLikes ?? 0,
      avgRetweets: learnings?.avgRetweets ?? 0,
      sourceType: 'live',
      category: 'live agent',
      xHandle: agent.handle,
      formatRankings: learnings?.formatRankings?.slice(0, 5) ?? [],
      topicRankings: learnings?.topicRankings?.slice(0, 5) ?? [],
      insights: learnings?.insights ?? [],
      topTweets,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 });
  }
}
