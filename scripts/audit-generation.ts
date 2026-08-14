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
  console.log(`research documents=${audit.sources.documentCount} stories=${audit.sources.storyCount} evidence-qualified=${audit.sources.evidenceQualifiedStoryCount} generation-eligible=${audit.sources.generationEligibleStoryCount}`);
  console.log(`source planning unavailable-after-editorial=${audit.sources.generationPlanning.unavailableAfterEditorialQualification.length} top-reasons=${audit.sources.generationPlanning.rejectionReasonCounts.slice(0, 5).map((entry) => `${entry.value}:${entry.count}`).join(',') || 'none'}`);
  console.log(`next briefs=${audit.sources.nextBriefPlan.briefCount} preview=${audit.sources.nextBriefPlan.previewKind} exact-live-forecast=${audit.sources.nextBriefPlan.predictsExactNextLiveRun} lanes=${Object.entries(audit.sources.nextBriefPlan.laneCounts).map(([lane, count]) => `${lane}:${count}`).join(',') || 'none'}`);
  console.log(`next subjects=${audit.sources.nextBriefPlan.briefs.map((brief) => `${brief.evidenceMode}:${brief.topic}`).join(' | ') || 'none'}`);
  console.log(`exact subject cues eligible=${audit.sources.operatorTopicTaste.reduce((sum, topic) => sum + topic.cleanSubjectCueSourceCount, 0)} diction=${audit.sources.operatorTopicTaste.reduce((sum, topic) => sum + topic.dictionAnchorCueSourceCount, 0)} topic-only=${audit.sources.operatorTopicTaste.reduce((sum, topic) => sum + topic.broaderTopicSignalCueSourceCount, 0)} excluded=${audit.sources.operatorTopicTaste.reduce((sum, topic) => sum + topic.excludedFromExactSubjectReuseCount, 0)}`);
  console.log(`operator topic signals eligible=${audit.sources.operatorTopicSignals.eligibleCount} selected=${audit.sources.operatorTopicSignals.selectedCount} rejected=${audit.sources.warmedNetworkTopicCount - audit.sources.operatorTopicSignals.eligibleCount}`);
  console.log(`voice corpus=${audit.corpus?.active ? 'ready' : 'not ready'} anchors=${audit.corpus?.anchorCount || 0}/${audit.corpus?.targetAnchorCount || 0} purity=${audit.corpus?.corpusPurity ?? 'n/a'}`);
  console.log(`current policy=${audit.generationV2.currentPolicyWindow.qualityPolicyVersion} runs=${audit.generationV2.currentPolicyWindow.runCount} selection-rate=${audit.generationV2.currentPolicyWindow.selectionYield ?? 'n/a'} selected/run=${audit.generationV2.currentPolicyWindow.selectedDraftsPerRun ?? 'n/a'}`);
  console.log(`models active=${audit.models.activeStack} writer=${audit.models.preferred.generation?.provider || 'none'}:${audit.models.preferred.generation?.model || 'none'} critic=${audit.models.preferred.finalCritic?.provider || 'none'}:${audit.models.preferred.finalCritic?.model || 'none'} control=${audit.models.shadowControlStack || 'none'} control-writer=${audit.models.shadowComparison?.controlWriter?.provider || 'none'}:${audit.models.shadowComparison?.controlWriter?.model || 'none'}`);
  console.log(`writer shadow evidence runs=${audit.models.shadowEvidence.runCount} groups=${audit.models.shadowEvidence.groups.map((group) => `${group.model} generated=${group.generatedCount} judged=${group.finalCriticCount} selected=${group.selectedCount} margin=${group.averageQualityMargin ?? 'n/a'} native=${group.averageNativeVoice ?? 'n/a'} cringe=${group.averageCringeRisk ?? 'n/a'}`).join(' | ') || 'none'}`);
  console.log(`fallbacks writer=${audit.models.generationFallbackCount} judge=${audit.models.judgeFallbackCount} final-critic=${audit.models.finalCriticFallbackCount}`);
  console.log(`throughput drafts=${audit.generationV2.sample.drafts} draft-to-queue=${audit.generationV2.conversions.draftToQueue ?? 'n/a'} calls/selected=${audit.generationV2.compute.modelCallsPerSelectedDraft ?? 'n/a'} input-tokens/selected=${audit.generationV2.compute.inputTokensPerSelectedDraft ?? 'n/a'}`);
  console.log(`current throughput ideas=${audit.generationV2.currentPolicyWindow.stageThroughput.ideasGenerated}/${audit.generationV2.currentPolicyWindow.stageThroughput.ideasEligible}/${audit.generationV2.currentPolicyWindow.stageThroughput.ideasSelected} drafts=${audit.generationV2.currentPolicyWindow.stageThroughput.draftsGenerated}/${audit.generationV2.currentPolicyWindow.stageThroughput.draftsEligible}/${audit.generationV2.currentPolicyWindow.stageThroughput.draftsSelected} provider-attempts=${audit.generationV2.currentPolicyWindow.stageThroughput.providerAttempts}`);
  console.log(`portfolio fallbacks reserve=${audit.generationV2.currentPolicyWindow.stageThroughput.reserveIdeaCandidates}/${audit.generationV2.currentPolicyWindow.stageThroughput.reserveIdeaPortfolioRejected}/${audit.generationV2.currentPolicyWindow.stageThroughput.reserveIdeaSelected} alternate=${audit.generationV2.currentPolicyWindow.stageThroughput.alternateIdeaCandidates}/${audit.generationV2.currentPolicyWindow.stageThroughput.alternateIdeaPortfolioRejected}/${audit.generationV2.currentPolicyWindow.stageThroughput.alternateIdeaTargets} format=candidates/portfolio-rejected/used`);
  console.log(`writer outcomes=${audit.generationV2.currentPolicyWindow.writerOutcomes.groups.map((group) => `${group.phase}:${group.model} generated=${group.generatedCount} judged=${group.finalCriticCount} selected=${group.selectedCount} margin=${group.averageQualityMargin ?? 'n/a'}`).join(' | ') || 'none'}`);
  console.log(`rescue targets=${audit.generationV2.currentPolicyWindow.writerOutcomes.rescue.targetCount} generated=${audit.generationV2.currentPolicyWindow.writerOutcomes.rescue.generatedCount} selected=${audit.generationV2.currentPolicyWindow.writerOutcomes.rescue.selectedCount} margin-delta=${audit.generationV2.currentPolicyWindow.writerOutcomes.rescue.averageQualityMarginDelta ?? 'n/a'}`);
  console.log(`incidents current=${audit.generationV2.quality.currentPolicyFactualIncidentCount} historical=${audit.generationV2.quality.historicalFactualIncidentCount} complaints=${audit.complaints.total}`);
  console.log(`operator baseline=${audit.generationV2.performance.operatorBaselineSource} posts=${audit.generationV2.sample.rollingOperatorPosts} median-impressions=${audit.generationV2.performance.operatorBaselineImpressions}`);
  console.log(`cost status=${audit.generationV2.compute.costDataStatus} estimated-usd=${audit.generationV2.compute.estimatedCostUsd ?? 'n/a'} active-pricing=${audit.models.pricingCoverage.complete ? 'complete' : 'missing'}`);
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
