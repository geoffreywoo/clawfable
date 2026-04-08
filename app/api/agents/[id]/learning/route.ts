import { NextRequest, NextResponse } from 'next/server';
import {
  getBaseline,
  getFeedback,
  getLearningSignals,
  getPerformanceHistory,
} from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';
import { buildLearningSnapshot } from '@/lib/learning-snapshot';

// GET /api/agents/[id]/learning
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    const [context, signals, feedback, performanceHistory, baseline] = await Promise.all([
      buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 }),
      getLearningSignals(id, 250),
      getFeedback(id),
      getPerformanceHistory(id, 200),
      getBaseline(id),
    ]);

    const snapshot = buildLearningSnapshot({
      settings: context.settings,
      learnings: context.learnings,
      memory: context.memory,
      banditPolicy: context.style.banditPolicy,
      signals,
      feedback,
      allTweets: context.allTweets,
      performanceHistory,
      baseline,
    });

    return NextResponse.json(snapshot);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch learning snapshot' }, { status: 500 });
  }
}
