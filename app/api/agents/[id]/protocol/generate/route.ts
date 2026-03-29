import { NextRequest, NextResponse } from 'next/server';
import { getAnalysis, createTweet } from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { generateViralBatch } from '@/lib/viral-generator';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// POST /api/agents/[id]/protocol/generate — generate viral content
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
    const batch = generateViralBatch(voiceProfile, analysis, count);

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
