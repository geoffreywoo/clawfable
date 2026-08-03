import { NextRequest, NextResponse } from 'next/server';
import {
  refillQueue,
  refreshQueuedTweetsForCurrentQualityPolicy,
} from '@/lib/autopilot';
import { buildGenerationQualityAudit } from '@/lib/generation-quality-audit';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import {
  acquireAutopilotLock,
  getAgent,
  getQueuedTweets,
  releaseAutopilotLock,
  resetReadCache,
} from '@/lib/kv-storage';
import { buildLearnings, checkPerformance } from '@/lib/performance';
import { AutomationEntitlementError, assertAgentAutomationEntitlement, entitlementErrorResponse } from '@/lib/automation-entitlement';

const MAX_CLASSIFICATION_PASSES = 5;
const MAX_TARGET_QUEUE_DEPTH = 8;

export const maxDuration = 800;

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
  try {
    await assertAgentAutomationEntitlement(id, { agent });
  } catch (error) {
    if (error instanceof AutomationEntitlementError) {
      return NextResponse.json(entitlementErrorResponse(error), { status: error.status });
    }
    throw error;
  }

  const body = await request.json().catch(() => ({}));
  const classificationPasses = Number(body?.classificationPasses ?? MAX_CLASSIFICATION_PASSES);
  const targetQueueDepth = Number(body?.targetQueueDepth ?? 2);
  const refill = body?.refill !== false;
  if (
    !Number.isInteger(classificationPasses)
    || classificationPasses < 1
    || classificationPasses > MAX_CLASSIFICATION_PASSES
  ) {
    return NextResponse.json({
      error: `classificationPasses must be an integer from 1 to ${MAX_CLASSIFICATION_PASSES}`,
    }, { status: 400 });
  }
  if (
    !Number.isInteger(targetQueueDepth)
    || targetQueueDepth < 0
    || targetQueueDepth > MAX_TARGET_QUEUE_DEPTH
  ) {
    return NextResponse.json({
      error: `targetQueueDepth must be an integer from 0 to ${MAX_TARGET_QUEUE_DEPTH}`,
    }, { status: 400 });
  }

  const owner = `internal-generation-quality-refresh:${Date.now()}:${id}`;
  const lock = await acquireAutopilotLock(id, owner, 20 * 60, 'manual');
  if (!lock.acquired) {
    return NextResponse.json({
      error: 'Autopilot is already running.',
      lock: lock.lock ? { acquiredAt: lock.lock.acquiredAt, expiresAt: lock.lock.expiresAt } : null,
    }, { status: 409 });
  }

  try {
    const classificationRuns: number[] = [];
    for (let index = 0; index < classificationPasses; index++) {
      classificationRuns.push(await checkPerformance(agent));
    }

    const learnings = await buildLearnings(agent);
    const corpus = learnings.voiceCorpus || null;
    const queueRefresh = await refreshQueuedTweetsForCurrentQualityPolicy(agent);
    const queueAfterRefresh = await getQueuedTweets(id);
    const refillRequested = refill && corpus?.active
      ? Math.max(0, targetQueueDepth - queueAfterRefresh.length)
      : 0;
    const refillAdded = refillRequested > 0
      ? await refillQueue(agent, refillRequested)
      : 0;
    const queueAfter = await getQueuedTweets(id);
    const audit = await buildGenerationQualityAudit(agent);

    return NextResponse.json({
      agentId: id,
      classificationRuns,
      corpus: corpus ? {
        version: corpus.version,
        snapshotId: corpus.snapshotId,
        active: corpus.active,
        eligibleAnchorCount: corpus.anchorCount,
        targetAnchorCount: corpus.targetAnchorCount,
        minimumAnchorCount: corpus.minimumAnchorCount,
        excludedCount: corpus.excludedCount,
      } : null,
      queueRefresh,
      refill: {
        enabled: refill,
        requested: refillRequested,
        added: refillAdded,
        finalDepth: queueAfter.length,
        tweetIds: queueAfter.map((tweet) => tweet.id),
      },
      audit,
    });
  } finally {
    await releaseAutopilotLock(id, lock.owner).catch(() => false);
  }
}
