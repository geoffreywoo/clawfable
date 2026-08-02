import { NextRequest, NextResponse } from 'next/server';
import { GEOFFREY_PRIMARY_MODEL_STACK } from '@/lib/ai';
import { isGeoffreyAccount } from '@/lib/account-taste';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { getAgents, getProtocolSettings, resetReadCache } from '@/lib/kv-storage';
import { refreshAgentResearch } from '@/lib/research-pipeline';

export const maxDuration = 800;

export async function GET(request: NextRequest) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }

  resetReadCache();
  const agents = await getAgents();
  const results = [];
  const additionalHandles = (process.env.RESEARCH_V2_AGENT_HANDLES || '')
    .split(',')
    .map((handle) => handle.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  for (const agent of agents) {
    const settings = await getProtocolSettings(agent.id);
    if (!settings.enabled || (!isGeoffreyAccount(agent.handle) && !additionalHandles.includes(agent.handle.toLowerCase()))) continue;
    results.push(await refreshAgentResearch(agent, {
      modelStack: isGeoffreyAccount(agent.handle) ? GEOFFREY_PRIMARY_MODEL_STACK : 'standard',
    }));
  }

  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    agentsAttempted: results.length,
    documentsFetched: results.reduce((sum, result) => sum + result.documentsFetched, 0),
    storiesQualified: results.reduce((sum, result) => sum + result.storiesQualified, 0),
    partialFailures: results.flatMap((result) => result.errors.map((error) => ({ agentId: result.agentId, error }))),
    results,
  });
}
