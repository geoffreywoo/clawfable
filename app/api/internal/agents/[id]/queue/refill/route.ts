import { NextRequest, NextResponse } from 'next/server';
import { refillQueue } from '@/lib/autopilot';
import {
  acquireAutopilotLock,
  getAgent,
  getQueuedTweets,
  releaseAutopilotLock,
} from '@/lib/kv-storage';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';

const MAX_REFILL_COUNT = 20;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }

  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

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
    const added = await refillQueue(agent, requestedCount);
    const queueAfter = await getQueuedTweets(id);
    return NextResponse.json({
      agentId: id,
      requested: requestedCount,
      added,
      queueDepthBefore: queueBefore.length,
      queueDepthAfter: queueAfter.length,
      generatedModels: [...new Set(queueAfter.slice(0, Math.max(added, 0)).map((tweet) => tweet.generationModel).filter(Boolean))],
      queuedTweetIds: queueAfter.map((tweet) => tweet.id),
    });
  } finally {
    await releaseAutopilotLock(id, lock.owner).catch(() => false);
  }
}
