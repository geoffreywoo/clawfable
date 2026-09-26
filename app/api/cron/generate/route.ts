import { reconcileAiProviderAttempts } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import { getAgents, getProtocolSettings, resetReadCache } from '@/lib/kv-storage';
import { durableGenerationEnabled, getGenerationJob } from '@/lib/generation-job';
import { refillQueue } from '@/lib/autopilot';
import { getAiBudgetSummary } from '@/lib/ai-budget';
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
      const job = await getGenerationJob(agent.id);
      results.push({agentId:agent.id,queued,job:job ? {id:job.id,stage:job.stage,status:job.status,blocker:job.blocker,nextAttemptAt:job.nextAttemptAt}:null,budget:await getAiBudgetSummary(agent.id)});
    } catch (e) { results.push({agentId:agent.id,error:e instanceof Error ? e.message:'generation_failed'}); }
  }
  return NextResponse.json({results});
}
