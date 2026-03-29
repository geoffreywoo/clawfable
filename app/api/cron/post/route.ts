import { NextRequest, NextResponse } from 'next/server';
import { getAgents, getProtocolSettings } from '@/lib/kv-storage';
import { runAutopilot } from '@/lib/autopilot';
import type { AutopilotResult } from '@/lib/autopilot';

// GET /api/cron/post — called by Vercel Cron
// Runs autopilot for all agents with autopilot enabled.
// Protected by CRON_SECRET env var.
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const agents = await getAgents();
    const results: AutopilotResult[] = [];

    for (const agent of agents) {
      const settings = await getProtocolSettings(agent.id);
      if (!settings.enabled) continue;

      const result = await runAutopilot(agent);
      results.push(result);
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      processed: results.length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cron failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
