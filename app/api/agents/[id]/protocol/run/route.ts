import { NextRequest, NextResponse } from 'next/server';
import { getAccessibleAgentCount } from '@/lib/account-access';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { runAutopilot } from '@/lib/autopilot';
import { addCronLogEntry, addPostLogEntry, getProtocolSettings } from '@/lib/kv-storage';
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
    if (settings.enabled) {
      await runAutopilotWatchdog(agent, settings);
    }
    const result = await runAutopilot(agent);
    if (settings.enabled) {
      await refreshAutopilotHealth(agent, undefined, { clearExternalBlockers: result.action === 'posted' });
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
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BillingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Autopilot run failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
