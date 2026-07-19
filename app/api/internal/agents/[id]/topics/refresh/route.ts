import { NextRequest, NextResponse } from 'next/server';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import {
  acquireAutopilotLock,
  getAgent,
  getTopicIntelligenceState,
  releaseAutopilotLock,
  resetReadCache,
} from '@/lib/kv-storage';
import { refreshAgentTopicIntelligence } from '@/lib/topic-intelligence-refresh';
import { formatActionError } from '@/lib/twitter-debug';
import { getTrendingTopicStableId } from '@/lib/trending';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }

  resetReadCache();
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const owner = `internal-topic-refresh:${Date.now()}:${id}`;
  const lock = await acquireAutopilotLock(id, owner, 5 * 60, 'manual');
  if (!lock.acquired) {
    return NextResponse.json({
      error: 'Autopilot is already running.',
      lock: lock.lock ? { acquiredAt: lock.lock.acquiredAt, expiresAt: lock.lock.expiresAt } : null,
    }, { status: 409 });
  }

  try {
    const result = await refreshAgentTopicIntelligence(agent, { force: true });
    const state = await getTopicIntelligenceState(id);
    const networkTopics = result.topics
      .filter((topic) => topic.discoveryMethod === 'followed_network')
      .map((topic) => ({
        id: getTrendingTopicStableId(topic),
        label: topic.category,
        summary: topic.headline,
        momentum: topic.networkMomentumScore || 0,
        momentumDelta: topic.networkMomentumDelta || 0,
        confidence: topic.topicConfidence || 0,
        sourceAuthors: [...new Set((topic.evidence || []).map((evidence) => `@${evidence.author}`))],
        sourcePosts: (topic.evidence || []).slice(0, 4).map((evidence) => ({
          author: `@${evidence.author}`,
          url: evidence.sourceUrl,
          breakoutMultiple: evidence.breakoutMultiple,
          viralScore: evidence.viralScore,
          text: evidence.text.slice(0, 320),
        })),
      }));

    return NextResponse.json({
      agentId: id,
      handle: `@${agent.handle}`,
      attempted: result.attempted,
      refreshed: result.refreshed,
      busy: result.busy,
      networkError: result.error
        ? formatActionError(result.error, 'refresh_topic_intelligence', { handle: `@${agent.handle}` })
        : null,
      observedAt: state?.observedAt || null,
      refreshSequence: state?.refreshSequence || 0,
      source: state?.followGraphSource || null,
      sourceComplete: state?.sourceComplete !== false,
      activeAuthors: state?.activeAuthorCount || 0,
      sampledAccounts: result.sampledNetworkAccounts,
      candidateTweets: result.networkCandidateTweets,
      partialFailures: result.networkPartialFailures,
      networkTopics,
    });
  } finally {
    await releaseAutopilotLock(id, lock.owner).catch(() => false);
  }
}
