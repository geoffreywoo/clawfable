import { NextRequest, NextResponse } from 'next/server';
import { PUBLISHING_V2_MODEL_STACK } from '@/lib/ai';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { getAgents, getProtocolSettings, resetReadCache } from '@/lib/kv-storage';
import { refreshAgentResearch } from '@/lib/research-pipeline';
import { refreshDynamicIdeaSeeds } from '@/lib/seed-synthesis';
import { getAgentAutomationEntitlement } from '@/lib/automation-entitlement';

export const maxDuration = 800;

export async function GET(request: NextRequest) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }

  resetReadCache();
  const agents = await getAgents();
  const results = [];
  for (const agent of agents) {
    const settings = await getProtocolSettings(agent.id);
    if (!settings.enabled) continue;
    const entitlement = await getAgentAutomationEntitlement(agent.id, { agent });
    if (!entitlement.eligible) continue;
    const result = await refreshAgentResearch(agent, {
      modelStack: PUBLISHING_V2_MODEL_STACK,
    });
    results.push(result);
    // Distill fresh idea seeds from the corpus that was just refreshed. A
    // failed synthesis must never fail the research cycle.
    if (result.refreshed) {
      await refreshDynamicIdeaSeeds(agent).catch(() => null);
    }
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
