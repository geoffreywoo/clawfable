import { NextRequest, NextResponse } from 'next/server';
import { refillQueue } from '@/lib/autopilot';
import {
  acquireAutopilotLock,
  getAgent,
  getQueuedTweets,
  releaseAutopilotLock,
  resetReadCache,
} from '@/lib/kv-storage';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { AutomationEntitlementError, assertAgentAutomationEntitlement, entitlementErrorResponse } from '@/lib/automation-entitlement';

const MAX_REFILL_COUNT = 20;

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
  const requestedCount = Number(body?.count ?? 10);
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_REFILL_COUNT) {
    return NextResponse.json({ error: `count must be an integer from 1 to ${MAX_REFILL_COUNT}` }, { status: 400 });
  }

  const owner = `internal-refill:${Date.now()}:${id}`;
  const lock = await acquireAutopilotLock(id, owner, 15 * 60, 'manual');
  if (!lock.acquired) {
    return NextResponse.json({
      error: 'Autopilot is already running.',
      lock: lock.lock ? { acquiredAt: lock.lock.acquiredAt, expiresAt: lock.lock.expiresAt } : null,
    }, { status: 409 });
  }

  try {
    const queueBefore = await getQueuedTweets(id);
    let added = 0;
    let consecutiveEmptyAttempts = 0;
    const attempts: Array<{ requested: number; added: number }> = [];
    const maxAttempts = Math.min(10, Math.max(1, Math.ceil(requestedCount / 2) + 1));
    while (added < requestedCount && attempts.length < maxAttempts) {
      const remaining = requestedCount - added;
      const attemptAdded = await refillQueue(agent, remaining);
      attempts.push({ requested: remaining, added: attemptAdded });
      added += attemptAdded;
      consecutiveEmptyAttempts = attemptAdded > 0 ? 0 : consecutiveEmptyAttempts + 1;
      if (consecutiveEmptyAttempts >= 2) break;
      if (added < requestedCount) resetReadCache();
    }
    const queueAfter = await getQueuedTweets(id);
    return NextResponse.json({
      agentId: id,
      requested: requestedCount,
      added,
      attempts,
      queueDepthBefore: queueBefore.length,
      queueDepthAfter: queueAfter.length,
      generatedModels: [...new Set(queueAfter.slice(0, Math.max(added, 0)).map((tweet) => tweet.generationModel).filter(Boolean))],
      queuedTweetIds: queueAfter.map((tweet) => tweet.id),
    });
  } finally {
    await releaseAutopilotLock(id, lock.owner).catch(() => false);
  }
}
