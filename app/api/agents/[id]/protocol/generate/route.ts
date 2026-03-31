import { NextRequest, NextResponse } from 'next/server';
import {
  createTweet,
  getAnalysis,
  getLearnings,
  getProtocolSettings,
  getRecentNegativeFeedback,
  getStyleSignals,
  getTweets,
} from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { generateViralBatch } from '@/lib/viral-generator';
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

    const [styleSignals, negatives] = await Promise.all([
      getStyleSignals(id),
      getRecentNegativeFeedback(id),
    ]);

    if (styleSignals?.rawExtraction) {
      voiceProfile.communicationStyle += `\nStyle analysis: ${styleSignals.rawExtraction}`;
    }
    if (negatives.length > 0) {
      voiceProfile.communicationStyle += `\n\n## RECENT OPERATOR REJECTIONS (avoid similar content)\n${negatives.map((item) => `- "${item}"`).join('\n')}`;
    }

    const learnings = await getLearnings(id);
    const settings = await getProtocolSettings(id);
    const style = {
      lengthMix: settings.lengthMix || { short: 30, medium: 30, long: 40 },
      enabledFormats: settings.enabledFormats || [],
    };
    // Get recent posts to avoid repetition
    const allTweets = await getTweets(id);
    const recentPosts = allTweets
      .filter((t) => t.status === 'posted' || t.status === 'queued')
      .slice(0, 15)
      .map((t) => t.content);

    const batch = await generateViralBatch(voiceProfile, analysis, count, null, learnings, agent.soulMd, style, recentPosts);

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
          quoteTweetId: null,
          quoteTweetAuthor: null,
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
