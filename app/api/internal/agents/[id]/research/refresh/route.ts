import { NextRequest, NextResponse } from 'next/server';
import { GEOFFREY_PRIMARY_MODEL_STACK } from '@/lib/ai';
import { isGeoffreyAccount } from '@/lib/account-taste';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { getAgent, resetReadCache } from '@/lib/kv-storage';
import { refreshAgentResearch } from '@/lib/research-pipeline';

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

  const result = await refreshAgentResearch(agent, {
    force: true,
    modelStack: isGeoffreyAccount(agent.handle) ? GEOFFREY_PRIMARY_MODEL_STACK : 'standard',
  });
  return NextResponse.json(result, { status: result.busy ? 409 : 200 });
}
