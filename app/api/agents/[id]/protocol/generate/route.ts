import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getAnalysis, getTrendingCache } from '@/lib/kv-storage';
import { generatePublishingBatchV2 } from '@/lib/publishing-v2';
import { resolvePublishingV2ModelStacks } from '@/lib/ai';
import type { TrendingTopic } from '@/lib/trending';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';
import { getGeneratedTweetIssue } from '@/lib/survivability';
import { validateGenerationRequest } from '@/lib/request-validation';
import { createTweetFromGeneratedCandidate } from '@/lib/tweet-persistence';
import { getAgentAutomationEntitlement } from '@/lib/automation-entitlement';

// POST /api/agents/[id]/protocol/generate - generate V2 preview or paid draft content.
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
    const parsed = validateGenerationRequest(body, { maxCount: 5 });
    if (!parsed.ok || !parsed.value) {
      return NextResponse.json({ error: parsed.error || 'Invalid generation request' }, { status: 400 });
    }
    const entitlement = await getAgentAutomationEntitlement(id, { agent });
    const requestedCount = parsed.value.count ?? 5;
    const count = entitlement.eligible ? requestedCount : Math.min(2, requestedCount);
    if (!entitlement.eligible && !(await checkRateLimit(id, 'unpaid_preview_generation', 5))) {
      return NextResponse.json({ error: 'Free preview limit reached. Try again later.' }, { status: 429 });
    }

    const { voiceProfile, learnings, style, recentPosts, allTweets, memory, signals = [] } = await buildGenerationContext(agent, {
      negativeLimit: 10,
      directiveLimit: 10,
    });

    const cachedTrending = await getTrendingCache(id);
    const trending = Array.isArray(cachedTrending) ? cachedTrending as TrendingTopic[] : null;
    const batch = await generatePublishingBatchV2({
      agentId: id,
      count,
      request: {
        surface: 'original',
        triggerId: `protocol:${Date.now()}`,
        requestedTopic: parsed.value.topic || parsed.value.headline || null,
      },
      voiceProfile,
      analysis,
      learnings,
      style,
      recentPosts,
      allTweets,
      memory,
      signals,
      trending,
      modelStack: resolvePublishingV2ModelStacks(agent.handle).activeStack,
      mode: entitlement.eligible ? 'manual' : 'preview',
      entitlement,
    });
    const completeBatch = batch.filter((item) => !getGeneratedTweetIssue(item.content));

    if (completeBatch.length === 0) {
      return NextResponse.json({
        error: 'No ideas cleared the evidence, originality, and voice gates. Try again after the research cache refreshes.',
      }, { status: 422 });
    }

    // Store as draft tweets
    const tweets = await Promise.all(
      completeBatch.map((item) =>
        createTweetFromGeneratedCandidate(id, item, { status: entitlement.eligible ? 'draft' : 'preview', topic: item.targetTopic }).then((tweet) => ({
          ...tweet,
          format: tweet.format || item.format,
          rationale: item.rationale,
        }))
      )
    );

    return NextResponse.json({
      tweets,
      previewLimited: !entitlement.eligible,
      analysis: { contentFingerprint: analysis.contentFingerprint },
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
