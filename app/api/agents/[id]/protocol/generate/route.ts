import { NextRequest, NextResponse } from 'next/server';
import { getAnalysis, createTweet } from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { generateViralBatch } from '@/lib/viral-generator';
import { decodeKeys } from '@/lib/twitter-client';
import { fetchTrendingFromFollowing } from '@/lib/trending';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// POST /api/agents/[id]/protocol/generate — generate viral content via Claude
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    const analysis = await getAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'Run account analysis first' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const count = Math.min(body.count || 5, 20);

    const voiceProfile = parseSoulMd(agent.name, agent.soulMd);

    // Fetch trending topics from following graph if connected
    let trending = null;
    if (agent.isConnected && agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret && agent.xUserId) {
      try {
        const keys = decodeKeys({
          apiKey: agent.apiKey,
          apiSecret: agent.apiSecret,
          accessToken: agent.accessToken,
          accessSecret: agent.accessSecret,
        });
        trending = await fetchTrendingFromFollowing(keys, agent.xUserId);
      } catch {
        // Continue without trending data
      }
    }

    const batch = await generateViralBatch(voiceProfile, analysis, count, trending);

    if (batch.length === 0) {
      return NextResponse.json({ error: 'Generation failed — no tweets produced' }, { status: 500 });
    }

    // Store as draft tweets
    const tweets = await Promise.all(
      batch.map((item) =>
        createTweet({
          agentId: id,
          content: item.content,
          type: 'original',
          status: 'draft',
          topic: item.targetTopic,
          xTweetId: null,
          scheduledAt: null,
        }).then((tweet) => ({
          ...tweet,
          format: item.format,
          rationale: item.rationale,
        }))
      )
    );

    return NextResponse.json({ tweets, analysis: { contentFingerprint: analysis.contentFingerprint } });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
