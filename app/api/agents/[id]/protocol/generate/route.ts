import { NextRequest, NextResponse } from 'next/server';
import { getAnalysis } from '@/lib/kv-storage';
import { generateViralBatch } from '@/lib/viral-generator';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';
import { getGeneratedTweetIssue } from '@/lib/survivability';
import { validateGenerationRequest } from '@/lib/request-validation';
import { createTweetFromGeneratedCandidate } from '@/lib/tweet-persistence';

// POST /api/agents/[id]/protocol/generate — generate viral content via the shared AI layer
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
    const parsed = validateGenerationRequest(body, { maxCount: 20 });
    if (!parsed.ok || !parsed.value) {
      return NextResponse.json({ error: parsed.error || 'Invalid generation request' }, { status: 400 });
    }
    const count = parsed.value.count ?? 5;

    const { voiceProfile, learnings, style, recentPosts, allTweets, memory, ideaAtoms = [], signals = [] } = await buildGenerationContext(agent, {
      negativeLimit: 10,
      directiveLimit: 10,
    });

    const batch = await generateViralBatch(voiceProfile, analysis, count, null, learnings, agent.soulMd, style, recentPosts, allTweets, memory, ideaAtoms, signals);
    const completeBatch = batch.filter((item) => !getGeneratedTweetIssue(item.content));

    if (completeBatch.length === 0) {
      return NextResponse.json({ error: 'Generation failed — no tweets produced' }, { status: 500 });
    }

    // Store as draft tweets
    const tweets = await Promise.all(
      completeBatch.map((item) =>
        createTweetFromGeneratedCandidate(id, item, { status: 'draft', topic: item.targetTopic }).then((tweet) => ({
          ...tweet,
          format: tweet.format || item.format,
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
