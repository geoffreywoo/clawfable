import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { runAutopilot } from '@/lib/autopilot';

// POST /api/agents/[id]/protocol/run — manually trigger autopilot for one agent
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const result = await runAutopilot(agent);
    return NextResponse.json(result);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Autopilot run failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
