import { NextRequest, NextResponse } from 'next/server';
import { getAccessibleAgentCount } from '@/lib/account-access';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { runAutopilot } from '@/lib/autopilot';
import { acquireAutopilotLock, addCronLogEntry, addOutcomeEvent, addPostLogEntry, getProtocolSettings, releaseAutopilotLock } from '@/lib/kv-storage';
import { refreshAutopilotHealth, runAutopilotWatchdog } from '@/lib/autopilot-health';
import { assertCanUseAutopilot, BillingError } from '@/lib/billing';

// POST /api/agents/[id]/protocol/run — manually trigger autopilot for one agent
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { user, agent } = await requireAgentAccess(id);
    const agentCount = await getAccessibleAgentCount(user);
    assertCanUseAutopilot(user, agentCount);
    const settings = await getProtocolSettings(id);
    const runId = `manual:${Date.now()}:${id}`;
    const lock = await acquireAutopilotLock(id, runId, 8 * 60, 'manual');
    if (!lock.acquired) {
      const reason = lock.lock
        ? `Autopilot already running since ${lock.lock.acquiredAt}; lock expires ${lock.lock.expiresAt}.`
        : 'Autopilot already running.';
      await addPostLogEntry(id, {
        agentId: id,
        tweetId: '',
        xTweetId: '',
        content: '',
        format: 'autopilot_lock',
        topic: 'autopilot',
        postedAt: new Date().toISOString(),
        source: 'manual',
        action: 'skipped',
        reason,
        runId,
        skipReason: 'lock_held',
      });
      await addOutcomeEvent(id, {
        eventType: 'skipped',
        source: 'manual',
        idempotencyKey: `${runId}:lock_held`,
        reason,
        metadata: { skipReason: 'lock_held' },
      }).catch(() => null);
      return NextResponse.json({ agentId: id, action: 'skipped', reason, runId }, { status: 409 });
    }
    let result;
    try {
      if (settings.enabled) {
        await runAutopilotWatchdog(agent, settings);
      }
      result = await runAutopilot(agent);
      if (settings.enabled) {
        await refreshAutopilotHealth(agent, undefined, { clearExternalBlockers: result.action === 'posted' });
      }
    } finally {
      await releaseAutopilotLock(id, lock.owner).catch(() => false);
    }

    // Log to cron log so it shows in the dashboard
    await addCronLogEntry({
      timestamp: new Date().toISOString(),
      mentionsRefreshed: 0,
      autopilotProcessed: 1,
      results: [{
        agentId: result.agentId,
        action: result.action,
        reason: `[manual] ${result.reason}`,
        content: result.content,
        repliesSent: result.repliesSent,
        runId,
      }],
    });

    if (result.action === 'error') {
      await addPostLogEntry(id, {
        agentId: id,
        tweetId: result.tweetId || '',
        xTweetId: result.xTweetId || '',
        content: result.content || '',
        format: result.format || 'manual_run_error',
        topic: result.topic || '',
        postedAt: new Date().toISOString(),
        source: 'manual',
        action: result.action,
        reason: `[manual] ${result.reason}`,
        runId,
        errorCode: 'manual_run',
      });
    }

    return NextResponse.json({ ...result, runId });
  } catch (err) {
    if (err instanceof BillingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Autopilot run failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
