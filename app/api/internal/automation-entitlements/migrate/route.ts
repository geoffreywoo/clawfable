import { NextRequest, NextResponse } from 'next/server';
import { getInternalRequestAuthError } from '@/lib/internal-request-auth';
import {
  getAgentOwnerId,
  getAgents,
  getProtocolSettings,
  getQueuedTweets,
  quarantineAgentAutomation,
  resetReadCache,
} from '@/lib/kv-storage';
import {
  getAgentAutomationEntitlement,
  getAutomationExemptAgentIds,
  isAgentAutomationExempt,
} from '@/lib/automation-entitlement';

const APPLY_CONFIRMATION = 'DISABLE_NON_PAYING_AUTOMATION';

function generatedQueueItem(tweet: Awaited<ReturnType<typeof getQueuedTweets>>[number]): boolean {
  return tweet.contentProvenance !== 'operator_written' || Boolean(
    tweet.pipelineVersion
    || tweet.generationRunId
    || tweet.generationProvider
    || tweet.generationModel,
  );
}

export async function POST(request: NextRequest) {
  const authError = getInternalRequestAuthError(request, process.env.CRON_SECRET);
  if (authError) return NextResponse.json({ error: authError.message }, { status: authError.status });

  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dryRun !== false;
  if (!dryRun && body?.confirmation !== APPLY_CONFIRMATION) {
    return NextResponse.json({ error: `confirmation must equal ${APPLY_CONFIRMATION}` }, { status: 400 });
  }

  resetReadCache();
  const agents = await getAgents();
  const configuredExemptionIds = getAutomationExemptAgentIds();
  const exemptions = agents.filter((agent) => isAgentAutomationExempt(agent.id));
  if (!dryRun && (
    configuredExemptionIds.length !== 1
    || exemptions.length !== 1
    || configuredExemptionIds[0] !== exemptions[0]?.id
    || !['geoffwoo', 'geoffreywoo'].includes(exemptions[0].handle.replace(/^@/, '').toLowerCase())
  )) {
    return NextResponse.json({
      error: 'Apply requires exactly one configured exemption ID and it must resolve to the canonical Geoffrey agent.',
      configuredExemptionIds,
      exemptions: exemptions.map((agent) => ({ id: agent.id, handle: agent.handle })),
    }, { status: 409 });
  }
  if (!dryRun) {
    const canonicalEntitlement = await getAgentAutomationEntitlement(exemptions[0].id, { agent: exemptions[0] });
    if (!canonicalEntitlement.eligible) {
      return NextResponse.json({
        error: 'Apply aborted because the canonical Geoffrey exemption is not operationally eligible.',
        agentId: exemptions[0].id,
        entitlement: canonicalEntitlement,
      }, { status: 409 });
    }
  }

  const results = [];
  for (const agent of agents) {
    const [ownerId, settings, queued, entitlement] = await Promise.all([
      getAgentOwnerId(agent.id),
      getProtocolSettings(agent.id),
      getQueuedTweets(agent.id),
      getAgentAutomationEntitlement(agent.id, { agent }),
    ]);
    const generatedQuarantined = queued.filter(generatedQueueItem).length;
    const operatorDraftsReturned = queued.length - generatedQuarantined;
    let applied = null as Awaited<ReturnType<typeof quarantineAgentAutomation>> | null;
    if (!dryRun && !entitlement.eligible) {
      applied = await quarantineAgentAutomation(agent.id, `Automation disabled: ${entitlement.reason}`);
    }
    results.push({
      agentId: agent.id,
      handle: agent.handle,
      ownerId,
      entitlement,
      previouslyEnabled: Boolean(settings.enabled || settings.autoReply || settings.proactiveReplies || settings.proactiveLikes || settings.autoFollow),
      queuedDrafts: queued.length,
      wouldQuarantineGenerated: entitlement.eligible ? 0 : generatedQuarantined,
      wouldReturnOperatorDrafts: entitlement.eligible ? 0 : operatorDraftsReturned,
      applied,
    });
  }

  return NextResponse.json({
    dryRun,
    applyConfirmation: APPLY_CONFIRMATION,
    agentsScanned: results.length,
    eligibleAgents: results.filter((result) => result.entitlement.eligible).length,
    blockedAgents: results.filter((result) => !result.entitlement.eligible).length,
    generatedDraftsToQuarantine: results.reduce((sum, result) => sum + result.wouldQuarantineGenerated, 0),
    operatorDraftsToReturn: results.reduce((sum, result) => sum + result.wouldReturnOperatorDrafts, 0),
    results,
  });
}
