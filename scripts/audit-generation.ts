import { buildGenerationQualityAudit } from '../lib/generation-quality-audit';
import { getAgent, getAgentByHandle } from '../lib/kv-storage';

function readArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

async function main() {
  const agentId = readArg('--agent-id');
  const handle = readArg('--handle')?.replace(/^@/, '') || null;
  const agent = agentId
    ? await getAgent(agentId)
    : handle
      ? await getAgentByHandle(handle)
      : null;

  if (!agent) {
    throw new Error('Pass --agent-id <id> or --handle <handle> for an existing agent.');
  }

  const audit = await buildGenerationQualityAudit(agent);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }

  console.log(`V2 generation audit for @${agent.handle} (${audit.generatedAt})`);
  console.log(`identity=${audit.identity.status} verified=${audit.identity.verifiedHandle || 'none'} source=${audit.identity.verificationSource || 'none'}`);
  console.log(`queue=${audit.queue.depth} eligible=${audit.queue.qualityEligibleCount} quarantined=${audit.queue.skippedByQualityCount}`);
  console.log(`research documents=${audit.sources.documentCount} stories=${audit.sources.storyCount} qualified=${audit.sources.qualifiedStoryCount}`);
  console.log(`voice corpus=${audit.corpus?.active ? 'ready' : 'not ready'} anchors=${audit.corpus?.anchorCount || 0}/${audit.corpus?.targetAnchorCount || 0} purity=${audit.corpus?.corpusPurity ?? 'n/a'}`);
  console.log(`current policy=${audit.generationV2.currentPolicyWindow.qualityPolicyVersion} runs=${audit.generationV2.currentPolicyWindow.runCount} selection-rate=${audit.generationV2.currentPolicyWindow.selectionYield ?? 'n/a'} selected/run=${audit.generationV2.currentPolicyWindow.selectedDraftsPerRun ?? 'n/a'}`);
  console.log(`throughput drafts=${audit.generationV2.sample.drafts} draft-to-queue=${audit.generationV2.conversions.draftToQueue ?? 'n/a'} calls/selected=${audit.generationV2.compute.modelCallsPerSelectedDraft ?? 'n/a'} input-tokens/selected=${audit.generationV2.compute.inputTokensPerSelectedDraft ?? 'n/a'}`);
  console.log(`incidents current=${audit.generationV2.quality.currentPolicyFactualIncidentCount} historical=${audit.generationV2.quality.historicalFactualIncidentCount} complaints=${audit.complaints.total}`);
  console.log(`operator baseline=${audit.generationV2.performance.operatorBaselineSource} posts=${audit.generationV2.sample.rollingOperatorPosts} median-impressions=${audit.generationV2.performance.operatorBaselineImpressions}`);
  console.log(`cost status=${audit.generationV2.compute.costDataStatus} estimated-usd=${audit.generationV2.compute.estimatedCostUsd ?? 'n/a'}`);
  console.log(`audit status=${audit.findings.status} critical=${audit.findings.counts.critical} high=${audit.findings.counts.high} medium=${audit.findings.counts.medium} low=${audit.findings.counts.low}`);
  for (const finding of audit.findings.items) {
    console.log(`[${finding.severity.toUpperCase()}] ${finding.title} (${finding.scope}:${finding.code})`);
    console.log(`  next: ${finding.action}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
