import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { runAutopilot } from '@/lib/autopilot';
import { addCronLogEntry } from '@/lib/kv-storage';

// POST /api/agents/[id]/protocol/run — manually trigger autopilot for one agent
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const result = await runAutopilot(agent);

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

    return NextResponse.json(result);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Autopilot run failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
