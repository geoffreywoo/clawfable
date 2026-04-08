import { NextRequest, NextResponse } from 'next/server';
import {
  createTweet,
  getAnalysis,
} from '@/lib/kv-storage';
import { generateViralBatch } from '@/lib/viral-generator';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';

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

    const { voiceProfile, learnings, style, recentPosts, allTweets, memory } = await buildGenerationContext(agent, {
      negativeLimit: 10,
      directiveLimit: 10,
    });

    const batch = await generateViralBatch(voiceProfile, analysis, count, null, learnings, agent.soulMd, style, recentPosts, allTweets, memory);

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
          format: item.format || null,
          topic: item.targetTopic,
          rationale: item.rationale,
          generationMode: item.generationMode,
          candidateScore: item.candidateScore,
          confidenceScore: item.confidenceScore,
          voiceScore: item.voiceScore,
          noveltyScore: item.noveltyScore,
          predictedEngagementScore: item.predictedEngagementScore,
          freshnessScore: item.freshnessScore,
          repetitionRiskScore: item.repetitionRiskScore,
          policyRiskScore: item.policyRiskScore,
          xTweetId: null,
          quoteTweetId: null,
          quoteTweetAuthor: null,
          scheduledAt: null,
        }).then((tweet) => ({
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
