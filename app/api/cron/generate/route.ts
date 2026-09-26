import { reconcileAiProviderAttempts } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { getAgents, getProtocolSettings, resetReadCache } from '@/lib/kv-storage';
import { durableGenerationEnabled } from '@/lib/generation-job';
import { refillQueue } from '@/lib/autopilot';
import { getReliableGenerationStatus } from '@/lib/reliable-generation-status';
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const error = getInternalRequestAuthError(request,process.env.CRON_SECRET);
  if (error) return NextResponse.json({error:error.message},{status:error.status});
  resetReadCache();
  const results = [];
  for (const agent of await getAgents()) {
    const settings = await getProtocolSettings(agent.id);
    if (!settings.enabled || !agent.isConnected || !durableGenerationEnabled(agent.id,settings)) continue;
    try {
      await reconcileAiProviderAttempts(agent.id);
      const queued = await refillQueue(agent,settings.minQueueSize,{}, {generationWorker:true});
      results.push({agentId:agent.id,queued,...await getReliableGenerationStatus(agent.id)});
    } catch (e) { results.push({agentId:agent.id,error:e instanceof Error ? e.message:'generation_failed'}); }
  }
  return NextResponse.json({results});
}
