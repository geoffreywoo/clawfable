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
const DEEP_TIMELINE_LIMIT = 600;
const DEEP_CLASSIFICATION_BACKLOG_LIMIT = 300;

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
      classificationRuns.push(await checkPerformance(
        agent,
        index === 0
          ? {
              timelineLimit: DEEP_TIMELINE_LIMIT,
              classificationBacklogLimit: DEEP_CLASSIFICATION_BACKLOG_LIMIT,
            }
          : undefined,
      ));
    }

    const learnings = await buildLearnings(agent);
    const corpus = learnings.voiceCorpus || null;
    const queueRefresh = await refreshQueuedTweetsForCurrentQualityPolicy(agent);
    const queueAfterRefresh = await getQueuedTweets(id);
    const activeQueueAfterRefresh = queueAfterRefresh.filter((tweet) => (
      tweet.status === 'queued' && !tweet.quarantinedAt
    ));
    const refillRequested = refill && corpus?.active
      ? Math.max(0, targetQueueDepth - activeQueueAfterRefresh.length)
      : 0;
    let refillAdded = 0;
    let consecutiveEmptyAttempts = 0;
    const refillAttempts: Array<{ requested: number; added: number }> = [];
    const maxRefillAttempts = Math.min(5, Math.max(1, Math.ceil(refillRequested / 2) + 1));
    while (refillRequested - refillAdded > 0 && refillAttempts.length < maxRefillAttempts) {
      const remaining = refillRequested - refillAdded;
      const attemptAdded = await refillQueue(agent, remaining);
      refillAttempts.push({ requested: remaining, added: attemptAdded });
      refillAdded += attemptAdded;
      consecutiveEmptyAttempts = attemptAdded > 0 ? 0 : consecutiveEmptyAttempts + 1;
      if (consecutiveEmptyAttempts >= 2) break;
      if (refillRequested - refillAdded > 0) resetReadCache();
    }
    const queueAfter = await getQueuedTweets(id);
    const activeQueueAfter = queueAfter.filter((tweet) => (
      tweet.status === 'queued' && !tweet.quarantinedAt
    ));
    const audit = await buildGenerationQualityAudit(agent);

    return NextResponse.json({
      agentId: id,
      classificationRuns,
      classificationScope: {
        timelineLimit: DEEP_TIMELINE_LIMIT,
        firstPassBacklogLimit: DEEP_CLASSIFICATION_BACKLOG_LIMIT,
        batchSize: 20,
        maxConcurrency: 3,
      },
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
        attempts: refillAttempts,
        finalDepth: activeQueueAfter.length,
        artifactCount: queueAfter.length,
        tweetIds: activeQueueAfter.map((tweet) => tweet.id),
      },
      audit,
    });
  } finally {
    await releaseAutopilotLock(id, lock.owner).catch(() => false);
  }
}
