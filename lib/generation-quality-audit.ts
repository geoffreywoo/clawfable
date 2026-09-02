import type {
  AccountAnalysis,
  Agent,
  AudienceVoiceComplaint,
  CandidateJudgeBreakdown,
  Tweet,
  VoiceCorpusEntry,
} from './types';
import { getTrendingTopicStableId, type TrendingTopic } from './trending';
import { buildAgentIdentityAudit } from './agent-identity';
import {
  getModelChainForTask,
  PUBLISHING_V2_CONTROL_MODEL_STACK,
  PUBLISHING_V2_GPT_CONTROL_MODEL_STACK,
  resolvePublishingV2ModelStacks,
} from './ai';
import { buildGenerationContext } from './generation-context';
import {
  getAudienceVoiceComplaints,
  getAnalysis,
  getQueuedTweets,
  getTopicIntelligenceState,
  getTrendingCache,
  getTweets,
  getVoiceCorpusSnapshot,
  getSourceDocuments,
  getStoryClusters,
  getResearchAgenda,
  getSemanticBlocks,
  getIdeaCandidates,
  getPostLog,
} from './kv-storage';
import { clampPostsPerDay, getAutopostPolicyIssue, effectivePostsPerDay as capAutomatedPostsPerDay } from './survivability';
import { loadGenerationV2Metrics } from './generation-v2-metrics';
import {
  buildFailedStoryAttemptDiagnosticsV2,
  buildGenerationBriefsV2,
  getOperatorTopicSignalAttemptDecisionV2,
  getStoryEditorialRejectionCodesV2,
  getStoryGenerationPlanningRejectionCodesV2,
  isEligibleOperatorTopicCueSourceV2,
  isGenericInvestorSelectionTemplateV2,
  shouldTryV2SubtractiveTailRepair,
} from './generation-v2';
import { getGeneratedPublishIssue } from './generation-origin';
import { hasAiModelPricing } from './ai-pricing';
import {
  classifyGeoffreyTopicDomain,
  enrichTrendingTopics,
  isGeoffreyDeepTechnicalTopic,
  getOperatorTopicSignalRejectionCodes,
  selectOperatorTopicSignals,
} from './source-planner';
import {
  PUBLISHING_V2_CONTEXTUAL_FINAL_CRITIC_VERSION,
  PUBLISHING_V2_CONTEXTUAL_QUALITY_POLICY_VERSION,
  PUBLISHING_V2_FINAL_CRITIC_VERSION,
  PUBLISHING_V2_GEOFFREY_AUTOPOST_QUALITY_MARGIN,
  PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN,
  PUBLISHING_V2_MIN_FINAL_QUALITY_MARGIN,
  PUBLISHING_V2_QUALITY_POLICY_VERSION,
} from './publishing-quality-policy';
import {
  getVoiceCorpusTextSurfaceExclusions,
  VOICE_CORPUS_SCHEMA_VERSION,
} from './voice-corpus';
import { ACCOUNT_TOPIC_POLICY_VERSION, getAccountTopicPolicyIssue } from './account-topic-policy';
import { GEOFFREY_AI_HORIZON_POLICY_VERSION } from './account-taste';
import {
  GEOFFREY_COMPANY_AMPLIFICATION_POLICY_VERSION,
  GEOFFREY_PREFERRED_AUTONOMOUS_COMPANIES,
  GEOFFREY_SUPPRESSED_AUTONOMOUS_COMPANIES,
  getGeoffreyCompanyAmplificationIssue,
} from './geoffrey-company-amplification';
import {
  GEOFFREY_COMPANY_LED_WINDOW,
  GEOFFREY_CONTENT_MIX_POLICY_VERSION,
  GEOFFREY_MAX_COMPANY_LED_IN_WINDOW,
  GEOFFREY_MAX_STANDING_PROMOTION_IN_WINDOW,
  GEOFFREY_STANDING_PROMOTION_WINDOW,
  evaluateGeoffreyQueueContentMix,
  isCompanyLedGeoffreyPost,
  isStandingCompanyPromotionGeoffreyPost,
} from './geoffrey-content-mix';
import { FRONTIER_FORECAST_LEARNING_VERSION } from './frontier-forecast-learning';
import {
  ANTIFUND_PORTFOLIO_COMPANIES,
  ANTIFUND_AUTONOMOUS_PROMOTION_COMPANIES,
  ANTIFUND_PROMOTION_COMPANIES,
  ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION,
  ANTIFUND_PORTFOLIO_POLICY_VERSION,
  ANTIFUND_PORTFOLIO_SNAPSHOT_EXPIRES_AT,
  ANTIFUND_PORTFOLIO_SNAPSHOT_VERSION,
  ANTIFUND_PORTFOLIO_SOURCE_URL,
  buildAntiFundPortfolioContext,
  findAntiFundPortfolioCompanies,
  findSingleAntiFundPortfolioCompany,
  getAntiFundAutonomousPromotionPolicyIssue,
  getAntiFundPortfolioPolicyIssue,
  isAntiFundPortfolioBriefDue,
} from './antifund-portfolio';
import {
  CURATED_X_ENTITY_REGISTRY,
  CURATED_X_ENTITY_REGISTRY_VERSION,
  ENTITY_MENTION_POLICY_VERSION,
  getCuratedEntityMentionPolicyIssue,
  usedCuratedVerifiedMentionHandles,
} from './entity-mentions';

export const GENERATION_QUALITY_AUDIT_VERSION = 48;

export type GenerationAuditFindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type GenerationAuditFindingScope = 'live_state' | 'current_policy' | 'historical_window';

export interface GenerationAuditFinding {
  code: string;
  severity: GenerationAuditFindingSeverity;
  scope: GenerationAuditFindingScope;
  title: string;
  evidence: Record<string, unknown>;
  action: string;
}

const FINDING_SEVERITY_ORDER: Record<GenerationAuditFindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const QUALITY_MARGIN_HEADROOM_FLOOR = PUBLISHING_V2_GEOFFREY_AUTOPOST_QUALITY_MARGIN;

type AuditIdentity = ReturnType<typeof buildAgentIdentityAudit>;
type AuditGenerationV2 = Awaited<ReturnType<typeof loadGenerationV2Metrics>>;
type AuditGenerationLineage = AuditGenerationV2['lineage'];

export function buildGenerationQueueHandoffAudit(runs: AuditGenerationLineage) {
  const selectedDrafts = runs.flatMap((run) => {
    const selectedDraftIds = new Set(run.selectedDraftIds || []);
    return run.drafts
      .filter((draft) => selectedDraftIds.has(draft.draftCandidateId))
      .map((draft) => ({
        generationRunId: run.generationRunId,
        draftCandidateId: draft.draftCandidateId,
        content: draft.content,
        tweetId: draft.tweetId,
      }));
  });
  const persistedSelectedDrafts = selectedDrafts.filter((draft) => Boolean(draft.tweetId));
  const unpersistedSelectedDrafts = selectedDrafts.filter((draft) => !draft.tweetId);
  const rejectionReasonCounts = runs.reduce<Record<string, number>>((counts, run) => {
    for (const [code, count] of Object.entries(run.rejectionCounts || {})) {
      if (!code.startsWith('queue_') || !Number.isFinite(count) || count <= 0) continue;
      counts[code] = (counts[code] || 0) + count;
    }
    return counts;
  }, {});
  return {
    selectedDrafts,
    persistedSelectedDrafts,
    unpersistedSelectedDrafts,
    rejectionReasonCounts,
    queueHandoffRate: selectedDrafts.length > 0
      ? Number((persistedSelectedDrafts.length / selectedDrafts.length).toFixed(4))
      : null,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

export function buildGenerationWriterOutcomeAudit(runs: AuditGenerationLineage) {
  const ideaContextById = new Map(runs.flatMap((run) => (run.ideas || []).map((idea) => [
    idea.ideaId,
    {
      topic: idea.topic || null,
      creativeSeedId: idea.creativeSeedId || null,
    },
  ] as const)));
  const entries = runs.flatMap((run) => {
    const selectedIds = new Set(run.selectedDraftIds || []);
    return run.drafts.map((draft) => {
      const ideaContext = ideaContextById.get(draft.ideaId);
      const topicText = `${ideaContext?.topic || ''} ${draft.content}`.trim();
      return {
        ...draft,
        generationRunId: run.generationRunId,
        phase: (draft.mutationRound || 0) > 0 ? 'rescue' as const : 'initial' as const,
        selected: selectedIds.has(draft.draftCandidateId),
        topic: ideaContext?.topic || null,
        creativeSeedId: ideaContext?.creativeSeedId || null,
        topicDomain: classifyGeoffreyTopicDomain(topicText),
        deepTechnical: isGeoffreyDeepTechnicalTopic(topicText),
        ideaTopicDomain: classifyGeoffreyTopicDomain(ideaContext?.topic || topicText),
        ideaDeepTechnical: isGeoffreyDeepTechnicalTopic(ideaContext?.topic || topicText),
      };
    });
  });
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = [
      entry.phase,
      entry.generationModelStack || 'unknown',
      modelKey(entry.generationProvider, entry.generationModel),
    ].join('|');
    grouped.set(key, [...(grouped.get(key) || []), entry]);
  }
  const groups = [...grouped.entries()].map(([key, candidates]) => {
    const [phase, modelStack, model] = key.split('|');
    const judged = candidates.filter((candidate) => typeof candidate.judgeScore === 'number');
    const selected = candidates.filter((candidate) => candidate.selected);
    return {
      phase,
      modelStack,
      model,
      generatedCount: candidates.length,
      finalCriticCount: judged.length,
      selectedCount: selected.length,
      selectionRate: ratio(selected.length, candidates.length),
      averageJudgeScore: average(judged.map((candidate) => candidate.judgeScore as number)),
      averageQualityMargin: average(judged
        .map((candidate) => candidate.judgeBreakdown?.qualityMargin)
        .filter((value): value is number => typeof value === 'number')),
      averageNativeVoice: average(judged
        .map((candidate) => candidate.judgeBreakdown?.nativeVoice)
        .filter((value): value is number => typeof value === 'number')),
      averageCringeRisk: average(judged
        .map((candidate) => candidate.judgeBreakdown?.cringeRisk)
        .filter((value): value is number => typeof value === 'number')),
      averageTrajectoryConviction: average(judged
        .map((candidate) => candidate.judgeBreakdown?.trajectoryConviction)
        .filter((value): value is number => typeof value === 'number')),
      averageForecastGrounding: average(judged
        .map((candidate) => candidate.judgeBreakdown?.forecastGrounding)
        .filter((value): value is number => typeof value === 'number')),
      averageExponentialIntuition: average(judged
        .map((candidate) => candidate.judgeBreakdown?.exponentialIntuition)
        .filter((value): value is number => typeof value === 'number')),
      topRejectionCodes: topCounts(candidates.flatMap((candidate) => candidate.rejectionCodes || []), 8),
    };
  }).sort((left, right) => (
    left.phase.localeCompare(right.phase)
    || right.generatedCount - left.generatedCount
    || left.model.localeCompare(right.model)
  ));
  const byId = new Map(entries.map((entry) => [entry.draftCandidateId, entry]));
  const initialEntries = entries.filter((entry) => entry.phase === 'initial');
  const initialIdeas = [...new Map(initialEntries.map((entry) => [entry.ideaId, entry])).values()];
  const finalCriticIdeas = [...new Map(initialEntries
    .filter((entry) => typeof entry.judgeScore === 'number')
    .map((entry) => [entry.ideaId, entry])).values()];
  const selectedInitialIdeas = [...new Map(initialEntries
    .filter((entry) => entry.selected)
    .map((entry) => [entry.ideaId, entry])).values()];
  const topicGroups = new Map<string, typeof initialEntries>();
  for (const entry of initialEntries) {
    topicGroups.set(entry.topicDomain, [...(topicGroups.get(entry.topicDomain) || []), entry]);
  }
  const topicDomains = [...topicGroups.entries()].map(([domain, candidates]) => {
    const judged = candidates.filter((candidate) => typeof candidate.judgeScore === 'number');
    const selected = candidates.filter((candidate) => candidate.selected);
    return {
      domain,
      generatedCount: candidates.length,
      finalCriticCount: judged.length,
      selectedCount: selected.length,
      averageQualityMargin: average(judged
        .map((candidate) => candidate.judgeBreakdown?.qualityMargin)
        .filter((value): value is number => typeof value === 'number')),
    };
  }).sort((left, right) => (
    right.generatedCount - left.generatedCount
    || right.finalCriticCount - left.finalCriticCount
    || left.domain.localeCompare(right.domain)
  ));
  const finalCriticIdeaIds = new Set(finalCriticIdeas.map((entry) => entry.ideaId));
  const selectedInitialIdeaIds = new Set(selectedInitialIdeas.map((entry) => entry.ideaId));
  const ideaTopicGroups = new Map<string, typeof initialIdeas>();
  for (const entry of initialIdeas) {
    ideaTopicGroups.set(entry.ideaTopicDomain, [...(ideaTopicGroups.get(entry.ideaTopicDomain) || []), entry]);
  }
  const ideaTopicDomains = [...ideaTopicGroups.entries()].map(([domain, candidates]) => ({
    domain,
    ideaCount: candidates.length,
    finalCriticIdeaCount: candidates.filter((candidate) => finalCriticIdeaIds.has(candidate.ideaId)).length,
    selectedIdeaCount: candidates.filter((candidate) => selectedInitialIdeaIds.has(candidate.ideaId)).length,
  })).sort((left, right) => (
    right.ideaCount - left.ideaCount
    || right.finalCriticIdeaCount - left.finalCriticIdeaCount
    || left.domain.localeCompare(right.domain)
  ));
  const deepTechnicalGenerated = initialEntries.filter((entry) => entry.deepTechnical);
  const finalCriticEntries = initialEntries.filter((entry) => typeof entry.judgeScore === 'number');
  const deepTechnicalFinalCritic = finalCriticEntries.filter((entry) => entry.deepTechnical);
  const selectedInitialEntries = initialEntries.filter((entry) => entry.selected);
  const deepTechnicalSelected = selectedInitialEntries.filter((entry) => entry.deepTechnical);
  const deepTechnicalIdeas = initialIdeas.filter((entry) => entry.ideaDeepTechnical);
  const deepTechnicalFinalCriticIdeas = finalCriticIdeas.filter((entry) => entry.ideaDeepTechnical);
  const deepTechnicalSelectedIdeas = selectedInitialIdeas.filter((entry) => entry.ideaDeepTechnical);
  const pairedRescues = entries.flatMap((entry) => {
    if (entry.phase !== 'rescue' || !entry.parentDraftId) return [];
    const parent = byId.get(entry.parentDraftId);
    const parentMargin = parent?.judgeBreakdown?.qualityMargin;
    const rescueMargin = entry.judgeBreakdown?.qualityMargin;
    if (typeof parentMargin !== 'number' || typeof rescueMargin !== 'number') return [];
    return [{
      parentDraftId: entry.parentDraftId,
      rescueDraftId: entry.draftCandidateId,
      qualityMarginDelta: Number((rescueMargin - parentMargin).toFixed(4)),
    }];
  });
  const nearMisses = entries
    .filter((entry) => !entry.selected && typeof entry.judgeBreakdown?.qualityMargin === 'number')
    .sort((left, right) => (
      (right.judgeBreakdown?.qualityMargin || 0) - (left.judgeBreakdown?.qualityMargin || 0)
    ))
    .slice(0, 8)
    .map((entry) => ({
      generationRunId: entry.generationRunId,
      draftCandidateId: entry.draftCandidateId,
      parentDraftId: entry.parentDraftId || null,
      phase: entry.phase,
      modelStack: entry.generationModelStack || null,
      model: modelKey(entry.generationProvider, entry.generationModel),
      topic: entry.topic,
      topicDomain: entry.topicDomain,
      creativeSeedId: entry.creativeSeedId,
      deepTechnical: entry.deepTechnical,
      judgeScore: entry.judgeScore,
      qualityMargin: entry.judgeBreakdown?.qualityMargin || null,
      nativeVoice: entry.judgeBreakdown?.nativeVoice || null,
      casualStartupFit: entry.judgeBreakdown?.casualStartupFit || null,
      novelty: entry.judgeBreakdown?.novelty || null,
      cringeRisk: entry.judgeBreakdown?.cringeRisk || null,
      rejectionCodes: entry.rejectionCodes,
      judgeNotes: entry.judgeNotes || null,
      content: entry.content,
    }));
  const rescueEntries = entries.filter((entry) => entry.phase === 'rescue');
  const selectedRescues = rescueEntries.filter((entry) => entry.selected);
  const genericInvestorTemplates = entries.filter((entry) => (
    isGenericInvestorSelectionTemplateV2(entry.content)
  ));
  const finishedCriticNearMisses = entries.filter((entry) => (
    !entry.selected
    && (
      entry.rejectionCodes?.includes('copy_judge_diagnosis_conflict')
      || (
        entry.rejectionCodes?.length === 1
        && entry.rejectionCodes[0] === 'final_quality_margin'
      )
    )
    && typeof entry.judgeScore === 'number'
    && typeof entry.judgeBreakdown?.qualityMargin === 'number'
    && /\b(?:no substantive rewrite is needed|no rewrite is needed|already fully formed)\b/i.test(entry.judgeNotes || '')
  ));
  return {
    groups,
    topicMix: {
      generatedCount: initialEntries.length,
      finalCriticCount: finalCriticEntries.length,
      selectedCount: selectedInitialEntries.length,
      deepTechnicalGeneratedCount: deepTechnicalGenerated.length,
      deepTechnicalFinalCriticCount: deepTechnicalFinalCritic.length,
      deepTechnicalSelectedCount: deepTechnicalSelected.length,
      deepTechnicalGeneratedShare: ratio(deepTechnicalGenerated.length, initialEntries.length),
      deepTechnicalFinalCriticShare: ratio(deepTechnicalFinalCritic.length, finalCriticEntries.length),
      deepTechnicalSelectedShare: ratio(deepTechnicalSelected.length, selectedInitialEntries.length),
      domains: topicDomains,
      ideaCount: initialIdeas.length,
      finalCriticIdeaCount: finalCriticIdeas.length,
      selectedIdeaCount: selectedInitialIdeas.length,
      deepTechnicalIdeaCount: deepTechnicalIdeas.length,
      deepTechnicalFinalCriticIdeaCount: deepTechnicalFinalCriticIdeas.length,
      deepTechnicalSelectedIdeaCount: deepTechnicalSelectedIdeas.length,
      deepTechnicalIdeaShare: ratio(deepTechnicalIdeas.length, initialIdeas.length),
      deepTechnicalFinalCriticIdeaShare: ratio(deepTechnicalFinalCriticIdeas.length, finalCriticIdeas.length),
      deepTechnicalSelectedIdeaShare: ratio(deepTechnicalSelectedIdeas.length, selectedInitialIdeas.length),
      ideaDomains: ideaTopicDomains,
    },
    templateRisks: {
      genericInvestorSelectionCount: genericInvestorTemplates.length,
      genericInvestorSelectionRate: ratio(genericInvestorTemplates.length, entries.length),
      examples: genericInvestorTemplates.slice(0, 6).map((entry) => ({
        generationRunId: entry.generationRunId,
        draftCandidateId: entry.draftCandidateId,
        content: entry.content,
      })),
    },
    rescue: {
      targetCount: runs.reduce((sum, run) => sum
        + (run.stageCounts.preflightRescueTargets || 0)
        + (run.stageCounts.postcriticRescueRunnableTargets
          ?? run.stageCounts.postcriticRescueEligibleTargets
          ?? run.stageCounts.postcriticRescueTargets
          ?? 0)
        + (run.stageCounts.postcriticTrimTargets || 0), 0),
      suppressedTargetCount: runs.reduce((sum, run) => sum
        + (run.stageCounts.preflightRescueSuppressedNegativeValue || 0)
        + (run.stageCounts.postcriticRescueSuppressedNegativeValue || 0), 0),
      capacityDeferredTargetCount: runs.reduce((sum, run) => sum
        + (run.stageCounts.postcriticRescueCapacityDeferredTargets || 0), 0),
      generatedCount: rescueEntries.length,
      finalCriticCount: rescueEntries.filter((entry) => typeof entry.judgeScore === 'number').length,
      selectedCount: selectedRescues.length,
      selectionRate: ratio(selectedRescues.length, rescueEntries.length),
      pairedComparisonCount: pairedRescues.length,
      averageQualityMarginDelta: average(pairedRescues.map((entry) => entry.qualityMarginDelta)),
      pairedComparisons: pairedRescues.slice(0, 20),
    },
    criticCalibration: {
      finishedNearMissCount: finishedCriticNearMisses.length,
      examples: finishedCriticNearMisses.slice(0, 6).map((entry) => ({
        generationRunId: entry.generationRunId,
        draftCandidateId: entry.draftCandidateId,
        judgeScore: entry.judgeScore,
        qualityMargin: entry.judgeBreakdown?.qualityMargin || null,
        nativeVoice: entry.judgeBreakdown?.nativeVoice || null,
        casualStartupFit: entry.judgeBreakdown?.casualStartupFit || null,
        cringeRisk: entry.judgeBreakdown?.cringeRisk || null,
        judgeNotes: entry.judgeNotes || null,
        content: entry.content,
      })),
    },
    nearMisses,
  };
}

interface AuditFindingInput {
  identity: AuditIdentity;
  autopost: {
    enabled: boolean;
    minQueueSize: number;
  };
  corpus: {
    schemaVersion: number;
    expectedSchemaVersion: number;
    active: boolean;
    anchorCount: number;
    targetAnchorCount: number;
    minimumAnchorCount: number;
    corpusPurity: number | null;
    knownGeneratedAnchorCount: number;
    surfaceRiskAnchorCount: number;
    surfaceRiskAnchors: Array<{
      xTweetId: string;
      reasons: string[];
      content: string;
    }>;
  } | null;
  queue: {
    qualityEligibleCount: number;
    items: Array<{
      id: string;
      qualityEligible: boolean;
      qualityIssues?: string[];
      scores: CandidateJudgeBreakdown | null;
      content: string;
    }>;
  };
  currentPolicyWindow: {
    qualityPolicyVersion: string;
    runCount: number;
    runsWithSelectedDrafts: number;
    selectedDraftCount: number;
    selectionYield: number | null;
    persistedSelectedDraftCount?: number;
    unpersistedSelectedDraftCount?: number;
    queueHandoffRate?: number | null;
    unpersistedDrafts?: Array<{
      generationRunId: string;
      draftCandidateId: string;
      content: string;
    }>;
    queueRejectionReasonCounts?: Record<string, number>;
    writerOutcomes?: ReturnType<typeof buildGenerationWriterOutcomeAudit>;
    stageThroughput?: {
      ideasSelected: number;
      draftsGenerated?: number;
      draftsEligible: number;
      draftsSelected: number;
      criticSelectionRate: number | null;
    };
  };
  generationV2: AuditGenerationV2;
  complaints: {
    total: number;
    affectedPostRate: number | null;
  };
  learning?: {
    totalTracked: number;
    forecastProfileVersion: string | null;
    eligiblePosts: number;
    forecastPosts: number;
    directShareMetricCoverage: number;
    aggressiveForecastShare: number;
    exponentialMechanismShare: number;
  };
  modelPricing: {
    activeComplete: boolean;
    missingModels: string[];
  };
  modelShadow?: {
    activeStack: string;
    groups: ReturnType<typeof buildGenerationWriterOutcomeAudit>['groups'];
  };
  sources: {
    editorialEligibleCount: number;
    generationEligibleCount: number;
    activeEditorialCooldownAttemptCount?: number;
    suppressedEditorialCooldownAttemptCount?: number;
    warmedNetworkTopicCount?: number;
    operatorTopicSignalEligibleCount?: number;
    operatorTopicSignalRejectionCounts?: Array<{ value: string; count: number }>;
  };
  portfolio?: {
    briefDue: boolean;
    nextBriefCount: number;
    queuePolicyIssueCount: number;
    queuedCount: number;
    postedLast7Count: number;
  };
  contentMix?: {
    queuePolicyIssueCount: number;
    queuedCompanyLedCount: number;
    queuedStandingPromotionCount: number;
    nextBriefCompanyLedCount: number;
    postedLast5CompanyLedCount: number;
    postedLast10StandingPromotionCount: number;
  };
}

export function buildGenerationAuditFindings(input: AuditFindingInput): GenerationAuditFinding[] {
  const findings: GenerationAuditFinding[] = [];
  const add = (finding: GenerationAuditFinding) => findings.push(finding);
  const sourceCopyRejectionCount = input.currentPolicyWindow.writerOutcomes?.groups
    ?.filter((group) => group.phase === 'initial')
    .flatMap((group) => group.topRejectionCodes || [])
    .filter((entry) => entry.value === 'final_source_copy_risk')
    .reduce((sum, entry) => sum + entry.count, 0) || 0;

  if ((input.contentMix?.queuePolicyIssueCount || 0) > 0) {
    add({
      code: 'company_content_mix_queue_failure',
      severity: 'critical',
      scope: 'live_state',
      title: 'The active queue is over the company-led content ceiling',
      evidence: input.contentMix || {},
      action: 'Excess company-led drafts are deferred until the mix window clears; refill with standalone ideas before the next autonomous post.',
    });
  }
  if ((input.contentMix?.nextBriefCompanyLedCount || 0) > GEOFFREY_MAX_COMPANY_LED_IN_WINDOW) {
    add({
      code: 'company_content_mix_generation_plan_failure',
      severity: 'high',
      scope: 'current_policy',
      title: 'The next generation plan over-allocates named companies',
      evidence: input.contentMix || {},
      action: 'Keep at most one company-led brief and let the remaining briefs begin from behaviors, markets, people, or predictions.',
    });
  }
  if (
    (input.contentMix?.postedLast5CompanyLedCount || 0) > GEOFFREY_MAX_COMPANY_LED_IN_WINDOW
    || (input.contentMix?.postedLast10StandingPromotionCount || 0) > GEOFFREY_MAX_STANDING_PROMOTION_IN_WINDOW
  ) {
    add({
      code: 'company_content_mix_historical_breach',
      severity: 'medium',
      scope: 'historical_window',
      title: 'Recent originals over-indexed on companies or explicit promotion',
      evidence: input.contentMix || {},
      action: 'Publish only standalone ideas until the rolling company and promotion windows return under their ceilings.',
    });
  }

  if (
    input.learning
    && input.learning.totalTracked > 0
    && input.learning.forecastProfileVersion !== FRONTIER_FORECAST_LEARNING_VERSION
  ) {
    add({
      code: 'frontier_forecast_learning_stale',
      severity: 'high',
      scope: 'live_state',
      title: 'AI and robotics forecast learning is missing or stale',
      evidence: input.learning,
      action: 'Rebuild learnings under the current forecast policy before treating historical performance as generation guidance.',
    });
  }
  if (input.learning && input.learning.eligiblePosts >= 10 && input.learning.directShareMetricCoverage < 0.25) {
    add({
      code: 'frontier_forecast_share_metrics_sparse',
      severity: 'medium',
      scope: 'historical_window',
      title: 'Forecast learning has sparse quote and bookmark coverage',
      evidence: input.learning,
      action: 'Keep collecting direct quote and bookmark metrics; do not infer shareability from likes alone.',
    });
  }
  if (input.learning && input.learning.forecastPosts >= 4 && input.learning.aggressiveForecastShare < 0.4) {
    add({
      code: 'frontier_forecast_posture_too_timid',
      severity: 'medium',
      scope: 'historical_window',
      title: 'The historical AI and robotics forecast mix is too timid',
      evidence: input.learning,
      action: 'Increase owned 6-12 month calls while preserving the final grounding and native-voice gates.',
    });
  }
  if (input.learning && input.learning.forecastPosts >= 4 && input.learning.exponentialMechanismShare < 0.3) {
    add({
      code: 'frontier_forecast_exponential_logic_sparse',
      severity: 'medium',
      scope: 'historical_window',
      title: 'Few historical forecasts identify a nonlinear threshold',
      evidence: input.learning,
      action: 'Prefer capability, cost, reliability, fleet-data, or adoption thresholds with a concrete second-order consequence.',
    });
  }

  if ((input.portfolio?.queuePolicyIssueCount || 0) > 0) {
    add({
      code: 'portfolio_company_queue_policy_failure',
      severity: 'critical',
      scope: 'live_state',
      title: 'Queued portfolio-company copy violates the constructive promotion policy',
      evidence: input.portfolio || {},
      action: 'Quarantine the affected queue entries, preserve the rejection receipt, and refill only through the current portfolio policy.',
    });
  }
  if (input.portfolio?.briefDue && input.portfolio.nextBriefCount === 0) {
    add({
      code: 'portfolio_company_brief_lane_empty',
      severity: 'high',
      scope: 'live_state',
      title: 'The next generation plan is missing a due portfolio-company brief',
      evidence: input.portfolio,
      action: 'Restore one rotating non-sports Anti Fund portfolio subject without relaxing evidence, voice, or anti-slop gates.',
    });
  }

  if (input.identity.status !== 'verified') {
    add({
      code: `identity_${input.identity.status}`,
      severity: ['drifted', 'credentials_missing'].includes(input.identity.status) ? 'high' : 'medium',
      scope: 'live_state',
      title: 'Connected X identity is not currently verified',
      evidence: {
        status: input.identity.status,
        storedHandle: input.identity.storedHandle,
        verifiedHandle: input.identity.verifiedHandle,
        connected: input.identity.connected,
        credentialsPresent: input.identity.credentialsPresent,
      },
      action: 'Reconcile the agent against X API v2 /users/me before trusting handle-based routing.',
    });
  } else if ((input.identity.verificationAgeHours || 0) > 30 * 24) {
    add({
      code: 'identity_verification_stale',
      severity: 'low',
      scope: 'live_state',
      title: 'Connected X identity verification is stale',
      evidence: {
        verifiedAt: input.identity.verifiedAt,
        verificationAgeHours: input.identity.verificationAgeHours,
      },
      action: 'Run the protected identity reconciliation again.',
    });
  }

  if (input.autopost.enabled && input.queue.qualityEligibleCount < input.autopost.minQueueSize) {
    add({
      code: 'queue_below_minimum',
      severity: input.queue.qualityEligibleCount === 0 ? 'critical' : 'high',
      scope: 'live_state',
      title: 'Autopost queue is below its configured minimum',
      evidence: {
        eligibleDrafts: input.queue.qualityEligibleCount,
        minimumQueueSize: input.autopost.minQueueSize,
        deficit: input.autopost.minQueueSize - input.queue.qualityEligibleCount,
      },
      action: 'Fix current-policy generation yield; do not relax voice or anti-slop gates to fill the deficit.',
    });
  }

  const blockedAccountTopicQueueItems = input.queue.items.filter((item) => (
    (item.qualityIssues || []).some((issue) => /account topic policy excludes sports/i.test(issue))
  ));
  if (blockedAccountTopicQueueItems.length > 0) {
    add({
      code: 'account_topic_policy_queue_artifacts',
      severity: 'high',
      scope: 'live_state',
      title: 'Queued artifacts violate the current account topic policy',
      evidence: {
        count: blockedAccountTopicQueueItems.length,
        items: blockedAccountTopicQueueItems.slice(0, 8).map((item) => ({
          id: item.id,
          content: item.content,
          qualityIssues: item.qualityIssues,
        })),
      },
      action: 'Quarantine the blocked drafts and refill from permitted operator topics.',
    });
  }

  const eligibleWithMargins = input.queue.items
    .filter((item) => item.qualityEligible && typeof item.scores?.qualityMargin === 'number')
    .map((item) => ({
      id: item.id,
      content: item.content,
      qualityMargin: item.scores!.qualityMargin as number,
    }))
    .sort((left, right) => left.qualityMargin - right.qualityMargin);
  const thinnest = eligibleWithMargins[0];
  if (thinnest && thinnest.qualityMargin < QUALITY_MARGIN_HEADROOM_FLOOR) {
    add({
      code: 'queue_quality_headroom_thin',
      severity: 'high',
      scope: 'live_state',
      title: 'An eligible draft barely clears the aggregate quality floor',
      evidence: {
        tweetId: thinnest.id,
        qualityMargin: thinnest.qualityMargin,
        hardFloor: PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN,
        recommendedAuditHeadroom: QUALITY_MARGIN_HEADROOM_FLOOR,
        content: thinnest.content,
      },
      action: 'Require manual review or replacement for threshold-hugging drafts while voice quality is under scrutiny.',
    });
  }

  if (!input.corpus?.active) {
    add({
      code: 'voice_corpus_inactive',
      severity: 'critical',
      scope: 'live_state',
      title: 'Native voice corpus is not active',
      evidence: { corpusPresent: Boolean(input.corpus) },
      action: 'Keep autonomous original posting paused until a pure minimum corpus is active.',
    });
  } else {
    if (
      input.corpus.schemaVersion < input.corpus.expectedSchemaVersion
      || input.corpus.surfaceRiskAnchorCount > 0
    ) {
      add({
        code: 'voice_corpus_surface_policy_stale',
        severity: 'high',
        scope: 'live_state',
        title: 'Native diction corpus contains weak standalone writing evidence',
        evidence: {
          schemaVersion: input.corpus.schemaVersion,
          expectedSchemaVersion: input.corpus.expectedSchemaVersion,
          surfaceRiskAnchorCount: input.corpus.surfaceRiskAnchorCount,
          examples: input.corpus.surfaceRiskAnchors.slice(0, 6),
        },
        action: 'Rebuild the corpus with current standalone-text rules before using it for diction scoring or generation.',
      });
    }
    if (input.corpus.knownGeneratedAnchorCount > 0 || input.corpus.corpusPurity !== 1) {
      add({
        code: 'voice_corpus_contaminated',
        severity: 'critical',
        scope: 'live_state',
        title: 'Native diction corpus contains generated or impure anchors',
        evidence: {
          corpusPurity: input.corpus.corpusPurity,
          knownGeneratedAnchorCount: input.corpus.knownGeneratedAnchorCount,
        },
        action: 'Replace the snapshot atomically after excluding every generated or uncertain diction anchor.',
      });
    }
    if (input.corpus.anchorCount < input.corpus.targetAnchorCount) {
      add({
        code: 'voice_corpus_below_target',
        severity: input.corpus.anchorCount < input.corpus.minimumAnchorCount ? 'critical' : 'medium',
        scope: 'live_state',
        title: 'Native diction corpus has limited coverage',
        evidence: {
          anchorCount: input.corpus.anchorCount,
          minimumAnchorCount: input.corpus.minimumAnchorCount,
          targetAnchorCount: input.corpus.targetAnchorCount,
        },
        action: 'Classify more high-confidence operator posts across topics and rhythms without lowering authorship confidence.',
      });
    }
  }

  if (input.currentPolicyWindow.runCount >= 3 && (input.currentPolicyWindow.selectionYield || 0) < 0.25) {
    add({
      code: 'current_policy_generation_yield_low',
      severity: 'high',
      scope: 'current_policy',
      title: 'Current-policy generation rarely produces a selectable draft',
      evidence: input.currentPolicyWindow,
      action: 'Inspect stage rejection codes and improve brief quality or writer diversity before spending more critic calls.',
    });
  }

  const stageThroughput = input.currentPolicyWindow.stageThroughput;
  const precriticDraftYield = (stageThroughput?.draftsGenerated || 0) > 0
    ? (stageThroughput?.draftsEligible || 0) / (stageThroughput?.draftsGenerated || 1)
    : null;
  if (
    input.currentPolicyWindow.runCount >= 2
    && (stageThroughput?.draftsGenerated || 0) >= 16
    && precriticDraftYield !== null
    && precriticDraftYield < 0.2
  ) {
    add({
      code: 'current_policy_precritic_attrition_high',
      severity: 'high',
      scope: 'current_policy',
      title: 'Most current-policy drafts fail before model judgment',
      evidence: {
        runCount: input.currentPolicyWindow.runCount,
        draftsGenerated: stageThroughput?.draftsGenerated || 0,
        draftsEligible: stageThroughput?.draftsEligible || 0,
        precriticDraftYield: Number(precriticDraftYield.toFixed(4)),
        initialWriterGroups: input.currentPolicyWindow.writerOutcomes?.groups.filter((group) => group.phase === 'initial') || [],
      },
      action: 'Repair subject selection, approved public moves, and primary-writer allocation before increasing generation volume; keep deterministic voice gates fixed.',
    });
  }
  if (
    input.currentPolicyWindow.runCount >= 2
    && (stageThroughput?.ideasSelected || 0) >= 4
    && (stageThroughput?.draftsEligible || 0) >= 4
    && stageThroughput?.draftsSelected === 0
  ) {
    const nearMisses = input.currentPolicyWindow.writerOutcomes?.nearMisses.slice(0, 5) || [];
    const hasSubtractiveTrim = nearMisses.some((nearMiss) => (
      shouldTryV2SubtractiveTailRepair(
        nearMiss.rejectionCodes,
        nearMiss.judgeNotes,
        nearMiss.qualityMargin,
        nearMiss.content,
      )
    ));
    add({
      code: 'current_policy_idea_to_copy_gap',
      severity: 'high',
      scope: 'current_policy',
      title: 'Approved ideas are reaching the critic but not becoming publishable copy',
      evidence: {
        runCount: input.currentPolicyWindow.runCount,
        stageThroughput,
        initialWriterGroups: input.currentPolicyWindow.writerOutcomes?.groups.filter((group) => group.phase === 'initial') || [],
        nearMisses,
      },
      action: hasSubtractiveTrim
        ? 'Rejudge deletion-only tails from the strongest margin-only draft, then spend writing capacity on fresh primary variants rather than generative repair; keep the final quality floor fixed.'
        : 'Tighten public-move eligibility and replace abstract comparison theses before writing; keep the final quality floor fixed.',
    });
  }

  const templateRisks = input.currentPolicyWindow.writerOutcomes?.templateRisks;
  if (
    input.currentPolicyWindow.runCount >= 2
    && (templateRisks?.genericInvestorSelectionCount || 0) >= 2
  ) {
    add({
      code: 'current_policy_investor_template_repeated',
      severity: 'high',
      scope: 'current_policy',
      title: 'Current-policy drafts repeat a generic investor-selection wrapper',
      evidence: templateRisks || {},
      action: 'Reject category-level "the startup/company I would back" openings before judgment and state the actual decision criterion directly.',
    });
  }

  const topicMix = input.currentPolicyWindow.writerOutcomes?.topicMix;
  const concentratedDomain = topicMix?.domains.find((domain) => (
    topicMix.generatedCount >= 20
    && domain.generatedCount / Math.max(1, topicMix.generatedCount) > 0.5
    && domain.selectedCount === 0
  ));
  if (concentratedDomain) {
    add({
      code: 'current_policy_zero_yield_topic_concentration',
      severity: 'high',
      scope: 'current_policy',
      title: 'Most writing capacity is concentrated in a topic domain with no selections',
      evidence: {
        generatedCount: topicMix?.generatedCount || 0,
        selectedCount: topicMix?.selectedCount || 0,
        concentratedDomain,
        domains: topicMix?.domains || [],
      },
      action: 'Keep operator-engaged briefs distinct by semantic domain and rotate the remaining slots through permitted startup, investing, culture, health, and technology lanes before writing.',
    });
  }

  const rescueOutcomes = input.currentPolicyWindow.writerOutcomes?.rescue;
  if (
    input.currentPolicyWindow.runCount >= 2
    && (rescueOutcomes?.generatedCount || 0) >= 4
    && rescueOutcomes?.selectedCount === 0
  ) {
    add({
      code: 'current_policy_rescue_yield_zero',
      severity: 'high',
      scope: 'current_policy',
      title: 'Current-policy rescue writing spends calls without saving drafts',
      evidence: {
        runCount: input.currentPolicyWindow.runCount,
        ...rescueOutcomes,
        writerGroups: input.currentPolicyWindow.writerOutcomes?.groups || [],
        nearMisses: input.currentPolicyWindow.writerOutcomes?.nearMisses.slice(0, 5) || [],
      },
      action: 'Use paired evidence to stop negative-value rewrites; spend the next call on a new one-sided idea or initial draft while keeping the final quality floor fixed.',
    });
  }

  const criticCalibration = input.currentPolicyWindow.writerOutcomes?.criticCalibration;
  if ((criticCalibration?.finishedNearMissCount || 0) > 0) {
    add({
      code: 'current_policy_critic_score_conflict',
      severity: 'medium',
      scope: 'current_policy',
      title: 'Final-critic language and aggregate eligibility disagree',
      evidence: criticCalibration || {},
      action: 'Evaluate the deterministic taste dimensions on the fixed native-versus-bad set; do not auto-pass, repeatedly rescore, or lower the quality floor.',
    });
  }

  const fableShadow = input.modelShadow?.activeStack === PUBLISHING_V2_GPT_CONTROL_MODEL_STACK
    ? input.modelShadow.groups.find((group) => (
      group.phase === 'initial'
      && group.modelStack === PUBLISHING_V2_CONTROL_MODEL_STACK
    ))
    : null;
  if (
    fableShadow
    && fableShadow.generatedCount >= 20
    && fableShadow.selectedCount === 0
  ) {
    add({
      code: 'historical_fable_shadow_yield_zero',
      severity: 'medium',
      scope: 'historical_window',
      title: 'Fable matched writing did not earn continued live sampling',
      evidence: fableShadow,
      action: 'Keep the Fable writer lane disabled until its model or prompt materially changes; spend all three initial variants on the active GPT writer while retaining the historical comparison.',
    });
  }

  if ((input.currentPolicyWindow.unpersistedSelectedDraftCount || 0) > 0) {
    const rejectionReasonCounts = input.currentPolicyWindow.queueRejectionReasonCounts || {};
    const rejectionCodes = Object.keys(rejectionReasonCounts);
    const intentionalSafetyCodes = new Set([
      'queue_recent_copy_duplicate',
      'queue_recent_semantic_duplicate',
      'queue_autopost_policy',
      'queue_claim_evidence',
      'queue_unearned_authority',
      'queue_incomplete_copy',
    ]);
    const safetyRejection = rejectionCodes.length > 0
      && rejectionCodes.every((code) => intentionalSafetyCodes.has(code));
    add({
      code: safetyRejection ? 'current_policy_queue_safety_rejection' : 'current_policy_queue_handoff_loss',
      severity: safetyRejection
        ? 'medium'
        : input.currentPolicyWindow.persistedSelectedDraftCount === 0 ? 'critical' : 'high',
      scope: 'current_policy',
      title: safetyRejection
        ? 'Queue safety rejected a final-critic selection'
        : 'Final-critic selections were lost before queue persistence',
      evidence: {
        selectedDraftCount: input.currentPolicyWindow.selectedDraftCount,
        persistedSelectedDraftCount: input.currentPolicyWindow.persistedSelectedDraftCount || 0,
        unpersistedSelectedDraftCount: input.currentPolicyWindow.unpersistedSelectedDraftCount,
        queueHandoffRate: input.currentPolicyWindow.queueHandoffRate ?? null,
        rejectionReasonCounts,
        drafts: input.currentPolicyWindow.unpersistedDrafts || [],
      },
      action: safetyRejection
        ? 'Move the recorded duplicate or policy boundary earlier in idea and draft eligibility so model judgment is not spent on copy the queue must reject.'
        : 'Inspect queue rejection receipts in the generation trace and repair the post-critic enqueue gate; do not spend more model calls until approved drafts can persist.',
    });
  }

  if (input.sources.editorialEligibleCount > 0 && input.sources.generationEligibleCount === 0) {
    add({
      code: 'source_briefs_exhausted',
      severity: 'high',
      scope: 'live_state',
      title: 'No editorially valid source story is currently available to generation',
      evidence: input.sources,
      action: 'Refresh qualified primary sources and inspect semantic-memory, commitment, and editorial-cooldown exclusions; keep source-free opinions inside factual-restraint gates.',
    });
  }

  if (
    input.currentPolicyWindow.runCount > 0
    && sourceCopyRejectionCount >= 3
    && input.currentPolicyWindow.selectedDraftCount === 0
  ) {
    add({
      code: 'current_policy_source_wording_collision',
      severity: 'high',
      scope: 'current_policy',
      title: 'Verified-source drafts are echoing source prose before criticism',
      evidence: {
        qualityPolicyVersion: input.currentPolicyWindow.qualityPolicyVersion,
        sourceCopyRejectionCount,
        selectedDraftCount: input.currentPolicyWindow.selectedDraftCount,
      },
      action: 'Keep the source-copy gate. Make idea and writer prompts paraphrase the approved factual atom in independent syntax before attribution.',
    });
  }

  if (
    (input.sources.warmedNetworkTopicCount || 0) >= 20
    && (input.sources.operatorTopicSignalEligibleCount || 0) === 0
  ) {
    add({
      code: 'network_idea_lane_empty',
      severity: 'high',
      scope: 'live_state',
      title: 'The warmed network feed is not producing any eligible idea subjects',
      evidence: {
        warmedNetworkTopicCount: input.sources.warmedNetworkTopicCount || 0,
        operatorTopicSignalEligibleCount: input.sources.operatorTopicSignalEligibleCount || 0,
        topRejectionReasons: input.sources.operatorTopicSignalRejectionCounts || [],
      },
      action: 'Repair network subject extraction and semantic classification using stored source decisions; do not admit low-confidence or off-core prose as voice evidence.',
    });
  } else if (
    (input.sources.warmedNetworkTopicCount || 0) >= 8
    && (input.sources.operatorTopicSignalEligibleCount || 0) < 4
  ) {
    add({
      code: 'network_operator_topic_pool_thin',
      severity: 'medium',
      scope: 'live_state',
      title: 'Operator-engaged topic supply is too thin for repeated autonomous batches',
      evidence: {
        warmedNetworkTopicCount: input.sources.warmedNetworkTopicCount || 0,
        operatorTopicSignalEligibleCount: input.sources.operatorTopicSignalEligibleCount || 0,
        topRejectionReasons: input.sources.operatorTopicSignalRejectionCounts || [],
      },
      action: 'Refresh a deeper official liked-post window and reserve topic-classifier capacity for distinct engaged subjects; keep those posts out of diction and factual evidence.',
    });
  }

  if (input.generationV2.quality.currentPolicyFactualIncidentCount > 0) {
    add({
      code: 'current_policy_factual_incidents',
      severity: 'high',
      scope: 'current_policy',
      title: 'The active policy contains factual-risk incidents',
      evidence: {
        currentPolicyFactualIncidentCount: input.generationV2.quality.currentPolicyFactualIncidentCount,
        historicalFactualIncidentCount: input.generationV2.quality.historicalFactualIncidentCount,
        terminalQueueDecisions: input.generationV2.sample.terminalQueueDecisions,
      },
      action: 'Review incident-linked drafts and block the active source, premise, or claim failure before further autonomous posting.',
    });
  }

  if (input.generationV2.gates.acceptanceSampleReady && !input.generationV2.gates.deleteRatePassed) {
    add({
      code: 'historical_delete_rate_high',
      severity: 'medium',
      scope: 'historical_window',
      title: 'Operator deletion rate remains above target',
      evidence: {
        userDeleteRate: input.generationV2.quality.userDeleteRate,
        targetMaximum: 0.2,
        terminalQueueDecisions: input.generationV2.sample.terminalQueueDecisions,
        deleteReasons: input.generationV2.quality.deleteReasons,
      },
      action: 'Turn the leading delete reasons into explicit brief and copy constraints, then measure only new-policy decisions.',
    });
  }

  if (input.generationV2.gates.acceptanceSampleReady && !input.generationV2.gates.semanticRepeatPassed) {
    add({
      code: 'historical_semantic_repeat_rate_high',
      severity: 'medium',
      scope: 'historical_window',
      title: 'Semantic repetition remains above target',
      evidence: {
        semanticRepeatRate: input.generationV2.quality.semanticRepeatRate,
        targetMaximum: 0.05,
        ideas: input.generationV2.sample.ideas,
        drafts: input.generationV2.sample.drafts,
      },
      action: 'Tighten story memory and opening/premise diversity before drafting, where rejection is cheaper.',
    });
  }

  if (
    input.generationV2.gates.currentPolicyPerformanceSampleReady
    && (
      (input.generationV2.performance.currentPolicyReachVsOperator || 0) < 0.8
      || (input.generationV2.performance.currentPolicyLikesVsOperator || 0) < 0.8
    )
  ) {
    add({
      code: 'current_policy_performance_below_operator',
      severity: 'medium',
      scope: 'current_policy',
      title: 'Active-policy posts trail the operator baseline',
      evidence: {
        maturePosts: input.generationV2.sample.currentPolicyMaturePosts,
        reachVsOperator: input.generationV2.performance.currentPolicyReachVsOperator,
        likesVsOperator: input.generationV2.performance.currentPolicyLikesVsOperator,
        operatorBaselineSource: input.generationV2.performance.operatorBaselineSource,
      },
      action: 'Use operator posts for diction and personal topic taste, then optimize spread mechanics only after native-voice gates pass.',
    });
  }

  if (input.complaints.total > 0) {
    add({
      code: 'audience_voice_complaints_present',
      severity: 'high',
      scope: 'historical_window',
      title: 'Stored audience replies contain high-confidence voice complaints',
      evidence: {
        complaintCount: input.complaints.total,
        affectedPostRate: input.complaints.affectedPostRate,
      },
      action: 'Inspect affected parent drafts by model, source lane, and policy version; keep complaints out of diction and topic learning.',
    });
  }

  if (input.generationV2.compute.costDataStatus !== 'complete') {
    const activePricingMissing = input.modelPricing.missingModels.length > 0;
    add({
      code: 'generation_cost_attribution_incomplete',
      severity: 'low',
      scope: 'historical_window',
      title: activePricingMissing
        ? 'An active model is missing pricing metadata'
        : 'Historical model usage lacks complete token accounting',
      evidence: {
        costDataStatus: input.generationV2.compute.costDataStatus,
        modelCalls: input.generationV2.compute.modelCalls,
        unknownTokenAttempts: input.generationV2.compute.unknownTokenAttempts,
        unknownCostCalls: input.generationV2.compute.unknownCostCalls,
        estimatedCostUsd: input.generationV2.compute.estimatedCostUsd,
        activeModelPricingComplete: input.modelPricing.activeComplete,
        missingActiveModels: input.modelPricing.missingModels,
      },
      action: activePricingMissing
        ? 'Add pricing metadata for every active and fallback model so quality gains can be compared with spend.'
        : 'Keep historical totals marked partial; monitor current-policy calls, whose active and fallback models all have pricing metadata.',
    });
  }

  return findings.sort((left, right) => (
    FINDING_SEVERITY_ORDER[left.severity] - FINDING_SEVERITY_ORDER[right.severity]
    || left.code.localeCompare(right.code)
  ));
}

function countBy(values: Array<string | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function modelKey(provider: string | null | undefined, model: string | null | undefined): string {
  return `${provider || 'unknown'}:${model || 'unknown'}`;
}

function topCounts(values: string[], limit = 12): Array<{ value: string; count: number }> {
  return Object.entries(countBy(values))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function summarizeCorpusEntry(entry: VoiceCorpusEntry) {
  return {
    xTweetId: entry.xTweetId,
    tweetId: entry.tweetId,
    provenance: entry.provenance,
    authorshipConfidence: entry.authorshipConfidence,
    dispositions: entry.dispositions,
    nativeScore: entry.nativeScore,
    slopScore: entry.slopScore,
    generatedPatternRisk: entry.generatedPatternRisk,
    selectionScore: entry.selectionScore,
    selectionReasons: entry.selectionReasons,
    exclusionReasons: entry.exclusionReasons,
    topic: entry.topic,
    content: entry.content,
  };
}

function summarizeComplaintParents(complaints: AudienceVoiceComplaint[]) {
  const parents = new Map<string, {
    parentXTweetId: string;
    parentTweetId: string | null;
    count: number;
    tags: Set<string>;
    authors: Set<string>;
    generationProvider: AudienceVoiceComplaint['generationProvider'];
    generationModel: string | null;
    sourceLane: AudienceVoiceComplaint['sourceLane'];
    qualityPolicyVersion: string | null;
    latestAt: string;
  }>();

  for (const complaint of complaints) {
    const current = parents.get(complaint.parentXTweetId) || {
      parentXTweetId: complaint.parentXTweetId,
      parentTweetId: complaint.parentTweetId,
      count: 0,
      tags: new Set<string>(),
      authors: new Set<string>(),
      generationProvider: complaint.generationProvider,
      generationModel: complaint.generationModel,
      sourceLane: complaint.sourceLane,
      qualityPolicyVersion: complaint.qualityPolicyVersion,
      latestAt: complaint.createdAt,
    };
    current.count += 1;
    complaint.tags.forEach((tag) => current.tags.add(tag));
    current.authors.add(complaint.authorHandle);
    if (complaint.createdAt > current.latestAt) current.latestAt = complaint.createdAt;
    parents.set(complaint.parentXTweetId, current);
  }

  return [...parents.values()]
    .sort((left, right) => right.latestAt.localeCompare(left.latestAt))
    .map((entry) => ({
      ...entry,
      tags: [...entry.tags].sort(),
      uniqueAuthors: entry.authors.size,
      authors: [...entry.authors].sort(),
    }));
}

function generatedPostedTweets(tweets: Tweet[]): Tweet[] {
  return tweets.filter((tweet) => (
    Boolean(tweet.xTweetId)
    && ['posted', 'deleted_from_x'].includes(tweet.status)
    && Boolean(tweet.generationProvider || tweet.generationModel || tweet.qualityPolicyVersion)
  ));
}

export function buildAutopostPostingRateAudit(
  tweets: Tweet[],
  qualityPolicyVersion: string,
  now = new Date(),
) {
  const nowMs = now.getTime();
  const postedOriginals = tweets.filter((tweet) => {
    const postedAt = Date.parse(tweet.postedAt || '');
    return tweet.type === 'original'
      && Boolean(tweet.xTweetId)
      && ['posted', 'deleted_from_x'].includes(tweet.status)
      && Number.isFinite(postedAt)
      && postedAt <= nowMs;
  });
  const inWindow = (tweet: Tweet, windowMs: number) => (
    nowMs - Date.parse(tweet.postedAt || '') <= windowMs
  );
  const last24Hours = postedOriginals.filter((tweet) => inWindow(tweet, 24 * 60 * 60 * 1000));
  const last7Days = postedOriginals.filter((tweet) => inWindow(tweet, 7 * 24 * 60 * 60 * 1000));
  const lastOriginal = [...postedOriginals]
    .sort((left, right) => Date.parse(right.postedAt || '') - Date.parse(left.postedAt || ''))[0] || null;
  return {
    postedOriginalsLast24Hours: last24Hours.length,
    postsRemainingInRolling24Hours: Math.max(0, 5 - last24Hours.length),
    postedOriginalsLast7Days: last7Days.length,
    averageOriginalsPerDayLast7Days: Number((last7Days.length / 7).toFixed(3)),
    currentPolicyOriginalsLast7Days: last7Days.filter((tweet) => (
      tweet.qualityPolicyVersion === qualityPolicyVersion
    )).length,
    lastOriginal: lastOriginal ? {
      tweetId: lastOriginal.id,
      xTweetId: lastOriginal.xTweetId,
      postedAt: lastOriginal.postedAt,
      source: lastOriginal.contentProvenance || null,
      model: lastOriginal.generationModel || null,
      qualityPolicyVersion: lastOriginal.qualityPolicyVersion || null,
      content: lastOriginal.content,
    } : null,
  };
}

export async function buildGenerationQualityAudit(agent: Agent) {
  const pipelineVersion = 'v2' as const;
  const [context, queue, corpus, complaints, allTweets, trendingValue, topicIntelligence, generationV2, sourceDocuments, storyClusters, researchAgenda, semanticBlocks, recentIdeas, analysis, postLog] = await Promise.all([
    buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 }),
    getQueuedTweets(agent.id),
    getVoiceCorpusSnapshot(agent.id),
    getAudienceVoiceComplaints(agent.id, 1000),
    getTweets(agent.id),
    getTrendingCache(agent.id),
    getTopicIntelligenceState(agent.id),
    loadGenerationV2Metrics(agent.id),
    getSourceDocuments(agent.id, 300),
    getStoryClusters(agent.id, 200),
    getResearchAgenda(agent.id),
    getSemanticBlocks(agent.id),
    getIdeaCandidates(agent.id, 300),
    getAnalysis(agent.id),
    getPostLog(agent.id, 200),
  ]);
  const trending = Array.isArray(trendingValue) ? trendingValue as TrendingTopic[] : [];
  const modelStackAssignment = resolvePublishingV2ModelStacks(agent.handle);
  const activeModelStack = modelStackAssignment.activeStack;
  const writerShadowRuns = generationV2.lineage.filter((run) => {
    if (run.mode !== 'live' || (run.surface || 'original') !== 'original') return false;
    const stacks = new Set(run.drafts
      .filter((draft) => (draft.mutationRound || 0) === 0)
      .map((draft) => draft.generationModelStack));
    return stacks.has(PUBLISHING_V2_CONTROL_MODEL_STACK)
      && stacks.has(PUBLISHING_V2_GPT_CONTROL_MODEL_STACK);
  }).slice(0, 12);
  const writerShadowEvidence = buildGenerationWriterOutcomeAudit(writerShadowRuns).groups
    .filter((group) => group.phase === 'initial');
  const ideaGenerationChain = getModelChainForTask(
    'idea_generation',
    'quality',
    activeModelStack,
  );
  const ideaJudgeChain = getModelChainForTask(
    'idea_judgment',
    'quality',
    activeModelStack,
  );
  const writingChain = getModelChainForTask(
    'tweet_writing',
    'quality',
    activeModelStack,
  );
  const copyJudgeChain = getModelChainForTask(
    'copy_judgment',
    'quality',
    activeModelStack,
  );
  const shadowControlWritingChain = getModelChainForTask(
    'tweet_writing',
    'quality',
    modelStackAssignment.shadowStack,
  );
  const primaryIdeaGeneration = ideaGenerationChain[0];
  const primaryIdeaJudge = ideaJudgeChain[0];
  const primaryWriting = writingChain[0];
  const primaryCopyJudge = copyJudgeChain[0];
  const shadowControlWriting = shadowControlWritingChain[0];
  const configuredModelTargets = [
    ...ideaGenerationChain,
    ...ideaJudgeChain,
    ...writingChain,
    ...copyJudgeChain,
    ...shadowControlWritingChain,
  ].filter((target, index, targets) => (
    targets.findIndex((candidate) => candidate.provider === target.provider && candidate.model === target.model) === index
  ));
  const modelPricingCoverage = configuredModelTargets.map((target) => ({
    ...target,
    priced: hasAiModelPricing(target.model),
  }));
  const configuredPostsPerDay = clampPostsPerDay(context.settings.postsPerDay);
  const effectivePostsPerDay = capAutomatedPostsPerDay(configuredPostsPerDay);
  const normalizedHandle = agent.handle.replace(/^@/, '').toLowerCase();
  const isGeoffrey = ['geoffwoo', 'geoffreywoo'].includes(normalizedHandle);
  const activeQueueForContentMix = queue.filter((tweet) => (
    tweet.status === 'queued' && !tweet.quarantinedAt
  ));
  const queueContentMixDecisions = isGeoffrey
    ? evaluateGeoffreyQueueContentMix(activeQueueForContentMix, allTweets)
    : new Map();
  const queueItems = queue.map((tweet) => {
    const originIssue = getGeneratedPublishIssue(tweet, {
      currentVoiceCorpusVersion: corpus?.snapshotId || null,
    });
    const accountTopicIssue = getAccountTopicPolicyIssue(
      agent.handle,
      `${tweet.topic || ''} ${tweet.content}`,
      null,
      tweet.portfolioCompanyContext,
    );
    const companyAmplificationIssue = getGeoffreyCompanyAmplificationIssue(
      agent.handle,
      `${tweet.topic || ''} ${tweet.content}`,
    );
    const portfolioCompanyIssue = isGeoffrey || tweet.portfolioCompanyContext
      ? getAntiFundPortfolioPolicyIssue(tweet.content, tweet.portfolioCompanyContext)
      : null;
    const autonomousPromotionIssue = isGeoffrey
      ? getAntiFundAutonomousPromotionPolicyIssue(tweet.portfolioCompanyContext)
      : null;
    const contentMixDecision = isGeoffrey
      ? queueContentMixDecisions.get(String(tweet.id)) || null
      : null;
    const mentionPolicyIssue = getCuratedEntityMentionPolicyIssue(tweet.content)
      || getAutopostPolicyIssue(tweet.content, {
        allowedMentions: [
          agent.handle,
          ...(tweet.allowedMentionHandles || []),
          ...usedCuratedVerifiedMentionHandles(tweet.content),
        ],
      });
    const matchedPortfolioCompanies = findAntiFundPortfolioCompanies(
      `${tweet.topic || ''} ${tweet.content}`,
    );
    const qualityIssues = [
      accountTopicIssue,
      companyAmplificationIssue,
      portfolioCompanyIssue,
      autonomousPromotionIssue,
      contentMixDecision?.issue || null,
      mentionPolicyIssue,
      originIssue,
      tweet.quarantineReason,
    ]
      .filter((value): value is string => Boolean(value));
    return {
      id: tweet.id,
      xTweetId: tweet.xTweetId,
      topic: tweet.topic,
      sourceLane: tweet.sourceLane || null,
      trendTopicId: tweet.trendTopicId || null,
      sourceEvidenceCount: tweet.sourceEvidenceTexts?.length || 0,
      portfolioCompanyContext: tweet.portfolioCompanyContext || null,
      portfolioCompanyMatches: matchedPortfolioCompanies.map((company) => company.id),
      accountTopicIssue,
      companyAmplificationIssue,
      portfolioCompanyIssue,
      autonomousPromotionIssue,
      companyLed: contentMixDecision?.companyLed ?? isCompanyLedGeoffreyPost(tweet),
      standingPromotion: contentMixDecision?.standingPromotion
        ?? isStandingCompanyPromotionGeoffreyPost(tweet),
      contentMixPolicyVersion: isGeoffrey ? GEOFFREY_CONTENT_MIX_POLICY_VERSION : null,
      contentMixIssue: contentMixDecision?.issue || null,
      mentionPolicyIssue,
      allowedMentionHandles: tweet.allowedMentionHandles || [],
      curatedMentionHandles: usedCuratedVerifiedMentionHandles(tweet.content),
      qualityEligible: qualityIssues.length === 0 && !tweet.quarantinedAt,
      qualityIssues,
      scores: tweet.finalCriticScores || null,
      generationModelStack: tweet.generationModelStack || null,
      generationProvider: tweet.generationProvider || null,
      generationModel: tweet.generationModel || null,
      judgeProvider: tweet.judgeProvider || null,
      judgeModel: tweet.judgeModel || null,
      finalCriticProvider: tweet.finalCriticProvider || null,
      finalCriticModel: tweet.finalCriticModel || null,
      finalCriticVerdict: tweet.finalCriticVerdict || null,
      finalCriticVersion: tweet.finalCriticVersion || null,
      qualityPolicyVersion: tweet.qualityPolicyVersion || null,
      voiceCorpusVersion: tweet.voiceCorpusVersion || null,
      status: tweet.status,
      quarantinedAt: tweet.quarantinedAt || null,
      quarantineReason: tweet.quarantineReason || null,
      content: tweet.content,
    };
  });
  const anchors = corpus?.entries.filter((entry) => entry.dispositions.includes('diction_anchor')) || [];
  const generatedAnchors = anchors.filter((entry) => entry.provenance === 'known_clawfable_generated');
  const complaintParents = summarizeComplaintParents(complaints);
  const postedGenerated = generatedPostedTweets(allTweets);
  const activeQueueItems = queueItems.filter((item) => item.status === 'queued' && !item.quarantinedAt);
  const identity = buildAgentIdentityAudit(agent);
  const storyEditorialOptions = {
    minConsequence: ['geoffwoo', 'geoffreywoo'].includes(normalizedHandle) ? 0.55 : undefined,
  };
  const failedStoryAttemptDiagnostics = buildFailedStoryAttemptDiagnosticsV2(recentIdeas);
  const storyDecisions = storyClusters.map((story) => {
    const storyText = `${story.topic} ${story.title} ${story.entities.join(' ')}`;
    const portfolioCompany = findSingleAntiFundPortfolioCompany(storyText, {
      exactEntities: story.entities,
    });
    const accountTopicBlocked = getAccountTopicPolicyIssue(
      agent.handle,
      storyText,
      null,
      portfolioCompany ? buildAntiFundPortfolioContext(portfolioCompany, 'live_development') : null,
    );
    const companyAmplificationBlocked = getGeoffreyCompanyAmplificationIssue(
      agent.handle,
      storyText,
    );
    return {
      story,
      rejectionCodes: uniqueStrings([
        ...getStoryEditorialRejectionCodesV2(story, storyEditorialOptions),
        accountTopicBlocked ? 'account_topic_blocked' : null,
        companyAmplificationBlocked ? 'company_amplification_blocked' : null,
      ]),
      planningRejectionCodes: uniqueStrings([
        ...getStoryGenerationPlanningRejectionCodesV2(story, {
          ...storyEditorialOptions,
          blocks: semanticBlocks,
          committedTweets: allTweets.filter((tweet) => ['queued', 'posted', 'deleted_from_x'].includes(tweet.status)),
          recentIdeas,
        }),
        accountTopicBlocked ? 'account_topic_blocked' : null,
        companyAmplificationBlocked ? 'company_amplification_blocked' : null,
      ]),
    };
  });
  const enrichedOperatorTopics = enrichTrendingTopics(
    trending,
    context.voiceProfile,
    context.learnings,
    context.style.trendTolerance,
  );
  const operatorTopicSignalDecisions = enrichedOperatorTopics.map((topic) => ({
    topic,
    rejectionCodes: uniqueStrings([
      ...getOperatorTopicSignalRejectionCodes(topic),
      getAccountTopicPolicyIssue(
        agent.handle,
        `${topic.category} ${topic.headline} ${topic.topTweet?.text || ''}`,
        topic.semanticDomain,
      ) ? 'account_topic_blocked' : null,
      getGeoffreyCompanyAmplificationIssue(
        agent.handle,
        `${topic.category} ${topic.headline} ${topic.topTweet?.text || ''}`,
      ) ? 'company_amplification_blocked' : null,
    ]),
  }));
  const selectedOperatorTopicSignals = selectOperatorTopicSignals(
    trending,
    context.voiceProfile,
    context.learnings,
    context.style.trendTolerance,
    12,
  );
  const operatorTopicSignalPlanningDecisions = selectedOperatorTopicSignals.map((signal) => ({
    id: signal.id,
    subject: signal.subject,
    domain: signal.domain,
    attempt: getOperatorTopicSignalAttemptDecisionV2(signal.id, recentIdeas),
  }));
  const auditAnalysis: AccountAnalysis = analysis || {
    agentId: agent.id,
    analyzedAt: '',
    tweetCount: 0,
    viralTweets: [],
    engagementPatterns: {
      avgLikes: 0,
      avgRetweets: 0,
      avgReplies: 0,
      avgImpressions: 0,
      topHours: [],
      topFormats: [],
      topTopics: [],
      viralThreshold: 0,
    },
    followingProfile: {
      totalFollowing: 0,
      topAccounts: [],
      categories: [],
    },
    contentFingerprint: '',
    warnings: ['No saved account analysis was available for the predictive brief audit.'],
  };
  const nextBriefPlan = buildGenerationBriefsV2({
    count: 2,
    stories: storyClusters,
    documents: sourceDocuments,
    voiceProfile: context.voiceProfile,
    analysis: auditAnalysis,
    learnings: context.learnings,
    style: context.style,
    trending,
    allTweets,
    signals: context.signals,
    blocks: semanticBlocks,
    recentIdeas,
    seedRotationKey: `audit:${agent.id}:${PUBLISHING_V2_QUALITY_POLICY_VERSION}`,
  });
  const nextBriefLaneCounts = countBy(nextBriefPlan.map((brief) => (
    brief.portfolioCompanyContext
      ? 'portfolio_company'
      : brief.evidenceMode === 'verified_source'
      ? 'verified_source'
      : brief.trendTopicId
        ? 'operator_engaged_subject'
        : 'durable_operator_topic'
  )));
  const portfolioBriefDue = isGeoffrey && isAntiFundPortfolioBriefDue(allTweets, context.signals);
  const portfolioNextBriefs = nextBriefPlan.filter((brief) => Boolean(brief.portfolioCompanyContext));
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const postedLast7 = allTweets.filter((tweet) => {
    if (tweet.type === 'reply' || !tweet.xTweetId || !['posted', 'deleted_from_x'].includes(tweet.status)) return false;
    const postedAt = Date.parse(tweet.postedAt || tweet.createdAt);
    return Number.isFinite(postedAt) && postedAt >= sevenDaysAgo;
  });
  const recentPublishedOriginals = allTweets
    .filter((tweet) => (
      tweet.type !== 'reply'
      && Boolean(tweet.xTweetId)
      && ['posted', 'deleted_from_x'].includes(tweet.status)
    ))
    .sort((left, right) => (
      Date.parse(right.postedAt || right.createdAt) - Date.parse(left.postedAt || left.createdAt)
    ));
  const contentMixSummary = {
    policyVersion: GEOFFREY_CONTENT_MIX_POLICY_VERSION,
    companyLedWindow: GEOFFREY_COMPANY_LED_WINDOW,
    maxCompanyLedInWindow: GEOFFREY_MAX_COMPANY_LED_IN_WINDOW,
    standingPromotionWindow: GEOFFREY_STANDING_PROMOTION_WINDOW,
    maxStandingPromotionInWindow: GEOFFREY_MAX_STANDING_PROMOTION_IN_WINDOW,
    queuePolicyIssueCount: queueItems.filter((item) => Boolean(item.contentMixIssue)).length,
    queuedCompanyLedCount: activeQueueItems.filter((item) => item.companyLed).length,
    queuedCompanyLedShare: ratio(
      activeQueueItems.filter((item) => item.companyLed).length,
      activeQueueItems.length,
    ),
    queuedStandingPromotionCount: activeQueueItems.filter((item) => item.standingPromotion).length,
    nextBriefCompanyLedCount: nextBriefPlan.filter((brief) => isCompanyLedGeoffreyPost({
      content: `${brief.title} ${brief.summary} ${(brief.personalTopicSignals || []).join(' ')}`,
      topic: brief.topic,
      portfolioCompanyContext: brief.portfolioCompanyContext,
    })).length,
    postedLast5CompanyLedCount: recentPublishedOriginals
      .slice(0, GEOFFREY_COMPANY_LED_WINDOW)
      .filter(isCompanyLedGeoffreyPost).length,
    postedLast10StandingPromotionCount: recentPublishedOriginals
      .slice(0, GEOFFREY_STANDING_PROMOTION_WINDOW)
      .filter(isStandingCompanyPromotionGeoffreyPost).length,
    postedLast7CompanyLedCount: postedLast7.filter(isCompanyLedGeoffreyPost).length,
    postedLast7CompanyLedShare: ratio(
      postedLast7.filter(isCompanyLedGeoffreyPost).length,
      postedLast7.length,
    ),
  };
  const portfolioPostedLast7 = postedLast7.flatMap((tweet) => {
    const matches = tweet.portfolioCompanyContext
      ? [tweet.portfolioCompanyContext.companyId]
      : findAntiFundPortfolioCompanies(`${tweet.topic || ''} ${tweet.content}`).map((company) => company.id);
    return matches.length > 0 ? [{ tweet, companyIds: matches }] : [];
  });
  const portfolioQueueItems = queueItems.filter((item) => (
    Boolean(item.portfolioCompanyContext) || item.portfolioCompanyMatches.length > 0
  ));
  const portfolioSummary = {
    policyVersion: ANTIFUND_PORTFOLIO_POLICY_VERSION,
    snapshotVersion: ANTIFUND_PORTFOLIO_SNAPSHOT_VERSION,
    snapshotExpiresAt: ANTIFUND_PORTFOLIO_SNAPSHOT_EXPIRES_AT,
    sourceUrl: ANTIFUND_PORTFOLIO_SOURCE_URL,
    companyCount: ANTIFUND_PORTFOLIO_COMPANIES.length,
    generationEligibleCompanyCount: ANTIFUND_AUTONOMOUS_PROMOTION_COMPANIES.length,
    promotionPolicyVersion: ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION,
    flagshipPromotionCompanies: ANTIFUND_PROMOTION_COMPANIES.map((company) => company.name),
    autonomousPromotionCompanies: ANTIFUND_AUTONOMOUS_PROMOTION_COMPANIES.map((company) => company.name),
    promotionExcludedCompanies: ANTIFUND_PORTFOLIO_COMPANIES
      .filter((company) => company.promotionTier === 'excluded')
      .map((company) => company.name),
    standardCompaniesExcludedFromAutomaticPromotion: ANTIFUND_PORTFOLIO_COMPANIES
      .filter((company) => company.promotionTier === 'standard')
      .map((company) => company.name),
    sportsAdjacentCompanies: ANTIFUND_PORTFOLIO_COMPANIES.filter((company) => company.sportsAdjacent).map((company) => company.name),
    sportsPortfolioRule: 'Betr and Kings League require a company-business angle; unrelated games, athletes, players, scores, matchups, and picks remain blocked.',
    briefDue: portfolioBriefDue,
    nextBriefCount: portfolioNextBriefs.length,
    nextBriefCompanies: portfolioNextBriefs.map((brief) => brief.portfolioCompanyContext?.companyName).filter(Boolean),
    queuedCount: portfolioQueueItems.length,
    queueShare: ratio(portfolioQueueItems.length, activeQueueItems.length),
    queuePolicyIssueCount: portfolioQueueItems.filter((item) => Boolean(
      item.portfolioCompanyIssue || item.autonomousPromotionIssue,
    )).length,
    queuedCompanyCounts: countBy(portfolioQueueItems.flatMap((item) => (
      item.portfolioCompanyContext
        ? [item.portfolioCompanyContext.companyId]
        : item.portfolioCompanyMatches
    ))),
    postedLast7Count: portfolioPostedLast7.length,
    postedLast7Share: ratio(portfolioPostedLast7.length, postedLast7.length),
    postedLast7GeneratedCount: portfolioPostedLast7.filter(({ tweet }) => tweet.contentProvenance === 'generated_v2').length,
    postedLast7CompanyCounts: countBy(portfolioPostedLast7.flatMap((entry) => entry.companyIds)),
  };
  const operatorTopicTaste = (context.learnings?.manualTopicProfile || []).map((cluster) => {
    const topTweets = cluster.topTweets || [];
    const cleanSubjectCueSources = topTweets.filter((tweet) => (
      isEligibleOperatorTopicCueSourceV2(tweet, context.voiceProfile)
    ));
    const dictionAnchorCueSourceCount = cleanSubjectCueSources.filter((tweet) => (
      tweet.voiceCorpusDispositions?.includes('diction_anchor')
    )).length;
    return {
      topic: cluster.topic,
      sampleCount: cluster.sampleCount,
      averageEngagement: cluster.avgEngagement,
      topTweetCount: topTweets.length,
      cleanSubjectCueSourceCount: cleanSubjectCueSources.length,
      dictionAnchorCueSourceCount,
      broaderTopicSignalCueSourceCount: cleanSubjectCueSources.length - dictionAnchorCueSourceCount,
      excludedFromExactSubjectReuseCount: topTweets.length - cleanSubjectCueSources.length,
    };
  });
  const postingRateAudit = buildAutopostPostingRateAudit(
    allTweets,
    PUBLISHING_V2_QUALITY_POLICY_VERSION,
  );
  const autopostSummary = {
    enabled: context.settings.enabled,
    configuredPostsPerDay,
    effectivePostsPerDay,
    maxOriginalsPerRolling24Hours: 5,
    minQueueSize: context.settings.minQueueSize,
    refillBatchLimit: 2,
    refillCanIterateUntilMinimum: true,
    ...postingRateAudit,
  };
  const corpusSurfaceRiskAnchors = anchors.flatMap((entry) => {
    const reasons = getVoiceCorpusTextSurfaceExclusions(entry.content);
    return reasons.length > 0 ? [{
      xTweetId: entry.xTweetId,
      reasons,
      content: entry.content,
    }] : [];
  });
  const accountBlockedAnchors = anchors.filter((entry) => {
    const content = `${entry.topic} ${entry.content}`;
    const portfolioCompany = findSingleAntiFundPortfolioCompany(content);
    return getAccountTopicPolicyIssue(
      agent.handle,
      content,
      null,
      portfolioCompany ? buildAntiFundPortfolioContext(portfolioCompany, 'constructive_conviction') : null,
    );
  });
  const corpusSummary = corpus ? {
    snapshotId: corpus.snapshotId,
    schemaVersion: corpus.version,
    expectedSchemaVersion: VOICE_CORPUS_SCHEMA_VERSION,
    active: corpus.active,
    generatedAt: corpus.generatedAt,
    targetAnchorCount: corpus.targetAnchorCount,
    minimumAnchorCount: corpus.minimumAnchorCount,
    anchorCount: corpus.anchorCount,
    corpusPurity: anchors.length > 0
      ? Number(((anchors.length - generatedAnchors.length) / anchors.length).toFixed(4))
      : null,
    knownGeneratedAnchorCount: generatedAnchors.length,
    accountBlockedAnchorCount: accountBlockedAnchors.length,
    accountBlockedAnchors: accountBlockedAnchors.slice(0, 12).map(summarizeCorpusEntry),
    surfaceRiskAnchorCount: corpusSurfaceRiskAnchors.length,
    surfaceRiskAnchors: corpusSurfaceRiskAnchors.slice(0, 12),
    dispositionCounts: countBy(corpus.entries.flatMap((entry) => entry.dispositions)),
    provenanceCounts: countBy(corpus.entries.map((entry) => entry.provenance)),
    topExclusionReasons: topCounts(corpus.entries.flatMap((entry) => entry.exclusionReasons)),
    anchors: anchors.map(summarizeCorpusEntry),
  } : null;
  const queueSummary = {
    depth: activeQueueItems.length,
    artifactCount: queueItems.length,
    quarantinedCount: queueItems.length - activeQueueItems.length,
    qualityEligibleCount: activeQueueItems.filter((item) => item.qualityEligible).length,
    skippedByQualityCount: queueItems.filter((item) => !item.qualityEligible).length,
    policyVersionCounts: countBy(queueItems.map((item) => item.qualityPolicyVersion)),
    corpusVersionCounts: countBy(queueItems.map((item) => item.voiceCorpusVersion)),
    finalCriticVerdicts: countBy(queueItems.map((item) => item.finalCriticVerdict)),
    items: queueItems,
  };
  const complaintSummary = {
    total: complaints.length,
    affectedParentCount: complaintParents.length,
    generatedPostedDenominator: postedGenerated.length,
    affectedPostRate: postedGenerated.length > 0
      ? Number((complaintParents.length / postedGenerated.length).toFixed(4))
      : null,
    rateDefinition: 'unique parent posts with a high-confidence voice complaint / stored generated posts with an X id',
    byModel: countBy(complaints.map((complaint) => modelKey(complaint.generationProvider, complaint.generationModel))),
    bySourceLane: countBy(complaints.map((complaint) => complaint.sourceLane)),
    byPolicyVersion: countBy(complaints.map((complaint) => complaint.qualityPolicyVersion)),
    byTag: countBy(complaints.flatMap((complaint) => complaint.tags)),
    affectedParents: complaintParents,
    metricsOnly: true,
  };
  const currentPolicyRuns = generationV2.lineage.filter((run) => (
    run.qualityPolicyVersion === PUBLISHING_V2_QUALITY_POLICY_VERSION
    && run.mode === 'live'
    && (run.surface || 'original') === 'original'
  ));
  const runsWithSelectedDrafts = currentPolicyRuns.filter((run) => (
    (run.stageCounts.draftsSelected || 0) > 0
  )).length;
  const sumCurrentStage = (key: string) => currentPolicyRuns.reduce(
    (sum, run) => sum + (run.stageCounts[key] || 0),
    0,
  );
  const currentIdeasGenerated = sumCurrentStage('ideasGenerated');
  const currentIdeasEligible = sumCurrentStage('ideasEligible');
  const currentIdeasSelected = sumCurrentStage('ideasSelected');
  const currentDraftsGenerated = sumCurrentStage('draftsGenerated');
  const currentDraftsEligible = sumCurrentStage('draftsEligible');
  const currentDraftsSelected = sumCurrentStage('draftsSelected');
  const currentProviderAttempts = sumCurrentStage('providerAttempts');
  const currentReserveIdeaCandidates = sumCurrentStage('reserveIdeaCandidates');
  const currentReserveIdeaPortfolioRejected = sumCurrentStage('reserveIdeaPortfolioRejected');
  const currentReserveIdeaSelected = sumCurrentStage('reserveIdeaSelected');
  const currentAlternateIdeaCandidates = sumCurrentStage('alternateIdeaCandidates');
  const currentAlternateIdeaPortfolioRejected = sumCurrentStage('alternateIdeaPortfolioRejected');
  const currentAlternateIdeaTargets = sumCurrentStage('alternateIdeaTargets');
  const queueHandoff = buildGenerationQueueHandoffAudit(currentPolicyRuns);
  const writerOutcomes = buildGenerationWriterOutcomeAudit(currentPolicyRuns);
  const refillCandidateRejections = postLog.filter((entry) => (
    entry.format === 'refill_candidate_rejected'
    && entry.qualityPolicyVersion === PUBLISHING_V2_QUALITY_POLICY_VERSION
  ));
  const currentPolicyWindow = {
    qualityPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
    runCount: currentPolicyRuns.length,
    runsWithSelectedDrafts,
    emptySelectionRunCount: currentPolicyRuns.length - runsWithSelectedDrafts,
    selectedDraftCount: currentDraftsSelected,
    selectionYield: currentPolicyRuns.length > 0
      ? Number((runsWithSelectedDrafts / currentPolicyRuns.length).toFixed(4))
      : null,
    latestRunAt: currentPolicyRuns[0]?.startedAt || null,
    selectedDraftsPerRun: currentPolicyRuns.length > 0
      ? Number((currentDraftsSelected / currentPolicyRuns.length).toFixed(4))
      : null,
    persistedSelectedDraftCount: queueHandoff.persistedSelectedDrafts.length,
    unpersistedSelectedDraftCount: queueHandoff.unpersistedSelectedDrafts.length,
    queueHandoffRate: queueHandoff.queueHandoffRate,
    unpersistedDrafts: queueHandoff.unpersistedSelectedDrafts.slice(0, 10).map(({ tweetId: _tweetId, ...draft }) => draft),
    queueRejectionReasonCounts: queueHandoff.rejectionReasonCounts,
    writerOutcomes,
    refillCandidateRejections: {
      recentCount: refillCandidateRejections.length,
      reasonCounts: topCounts(refillCandidateRejections.map((entry) => String(entry.reason || 'unknown').split(':')[0])),
      recent: refillCandidateRejections.slice(0, 20).map((entry) => ({
        draftCandidateId: entry.draftCandidateId || null,
        generationRunId: entry.runId || null,
        topic: entry.topic,
        reason: entry.reason || null,
        model: entry.model || null,
        qualityPolicyVersion: entry.qualityPolicyVersion || null,
        rejectedAt: entry.postedAt,
        content: entry.content,
      })),
    },
    stageThroughput: {
      ideasGenerated: currentIdeasGenerated,
      ideasEligible: currentIdeasEligible,
      ideasSelected: currentIdeasSelected,
      draftsGenerated: currentDraftsGenerated,
      draftsEligible: currentDraftsEligible,
      draftsSelected: currentDraftsSelected,
      providerAttempts: currentProviderAttempts,
      reserveIdeaCandidates: currentReserveIdeaCandidates,
      reserveIdeaPortfolioRejected: currentReserveIdeaPortfolioRejected,
      reserveIdeaSelected: currentReserveIdeaSelected,
      alternateIdeaCandidates: currentAlternateIdeaCandidates,
      alternateIdeaPortfolioRejected: currentAlternateIdeaPortfolioRejected,
      alternateIdeaTargets: currentAlternateIdeaTargets,
      ideaEligibilityRate: currentIdeasGenerated > 0
        ? Number((currentIdeasEligible / currentIdeasGenerated).toFixed(4))
        : null,
      selectedIdeaToEligibleDraftRate: currentIdeasSelected > 0
        ? Number((currentDraftsEligible / currentIdeasSelected).toFixed(4))
        : null,
      criticSelectionRate: currentDraftsEligible > 0
        ? Number((currentDraftsSelected / currentDraftsEligible).toFixed(4))
        : null,
      providerAttemptsPerSelectedDraft: currentDraftsSelected > 0
        ? Number((currentProviderAttempts / currentDraftsSelected).toFixed(4))
        : null,
    },
  };
  const findingItems = buildGenerationAuditFindings({
    identity,
    autopost: autopostSummary,
    corpus: corpusSummary,
    queue: queueSummary,
    currentPolicyWindow,
    generationV2,
    complaints: complaintSummary,
    learning: isGeoffrey ? {
      totalTracked: context.learnings?.totalTracked || 0,
      forecastProfileVersion: context.learnings?.frontierForecastProfile?.version || null,
      eligiblePosts: context.learnings?.frontierForecastProfile?.eligiblePosts || 0,
      forecastPosts: context.learnings?.frontierForecastProfile?.forecastPosts || 0,
      directShareMetricCoverage: context.learnings?.frontierForecastProfile?.directShareMetricCoverage || 0,
      aggressiveForecastShare: context.learnings?.frontierForecastProfile?.aggressiveForecastShare || 0,
      exponentialMechanismShare: context.learnings?.frontierForecastProfile?.exponentialMechanismShare || 0,
    } : undefined,
    modelPricing: {
      activeComplete: modelPricingCoverage.every((target) => target.priced),
      missingModels: modelPricingCoverage.filter((target) => !target.priced).map((target) => target.model),
    },
    modelShadow: {
      activeStack: activeModelStack,
      groups: writerShadowEvidence,
    },
    sources: {
      editorialEligibleCount: storyDecisions.filter((decision) => decision.rejectionCodes.length === 0).length,
      generationEligibleCount: storyDecisions.filter((decision) => decision.planningRejectionCodes.length === 0).length,
      activeEditorialCooldownAttemptCount: failedStoryAttemptDiagnostics.activeAttempts.length,
      suppressedEditorialCooldownAttemptCount: failedStoryAttemptDiagnostics.suppressedByViablePremise.length,
      warmedNetworkTopicCount: trending.length,
      operatorTopicSignalEligibleCount: operatorTopicSignalDecisions.filter((decision) => decision.rejectionCodes.length === 0).length,
      operatorTopicSignalRejectionCounts: topCounts(operatorTopicSignalDecisions.flatMap((decision) => decision.rejectionCodes)),
    },
    portfolio: portfolioSummary,
    contentMix: isGeoffrey ? contentMixSummary : undefined,
  });
  const findingCounts = {
    critical: findingItems.filter((finding) => finding.severity === 'critical').length,
    high: findingItems.filter((finding) => finding.severity === 'high').length,
    medium: findingItems.filter((finding) => finding.severity === 'medium').length,
    low: findingItems.filter((finding) => finding.severity === 'low').length,
  };

  return {
    auditVersion: GENERATION_QUALITY_AUDIT_VERSION,
    generatedAt: new Date().toISOString(),
    agentId: agent.id,
    handle: `@${agent.handle}`,
    identity,
    findings: {
      status: findingCounts.critical > 0
        ? 'critical'
        : findingCounts.high > 0
          ? 'degraded'
          : findingCounts.medium > 0
            ? 'needs_attention'
            : 'healthy',
      counts: findingCounts,
      items: findingItems,
    },
    policy: {
      pipelineVersion,
      accountTopicPolicyVersion: ACCOUNT_TOPIC_POLICY_VERSION,
      blockedTopicDomains: ['sports_competition'],
      companyAmplificationPolicyVersion: GEOFFREY_COMPANY_AMPLIFICATION_POLICY_VERSION,
      contentMixPolicyVersion: GEOFFREY_CONTENT_MIX_POLICY_VERSION,
      companyLedWindow: GEOFFREY_COMPANY_LED_WINDOW,
      maxCompanyLedInWindow: GEOFFREY_MAX_COMPANY_LED_IN_WINDOW,
      standingPromotionWindow: GEOFFREY_STANDING_PROMOTION_WINDOW,
      maxStandingPromotionInWindow: GEOFFREY_MAX_STANDING_PROMOTION_IN_WINDOW,
      suppressedAutonomousCompanies: [...GEOFFREY_SUPPRESSED_AUTONOMOUS_COMPANIES],
      preferredAutonomousCompanies: [...GEOFFREY_PREFERRED_AUTONOMOUS_COMPANIES],
      portfolioCompanyPolicyVersion: ANTIFUND_PORTFOLIO_POLICY_VERSION,
      portfolioCompanyPromotionPolicyVersion: ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION,
      portfolioCompanySnapshotVersion: ANTIFUND_PORTFOLIO_SNAPSHOT_VERSION,
      geoffreyAIFutureHorizonPolicyVersion: GEOFFREY_AI_HORIZON_POLICY_VERSION,
      frontierForecastLearningVersion: FRONTIER_FORECAST_LEARNING_VERSION,
      qualityPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
      entityMentionPolicyVersion: ENTITY_MENTION_POLICY_VERSION,
      curatedEntityRegistryVersion: CURATED_X_ENTITY_REGISTRY_VERSION,
      curatedEntityRegistryCount: CURATED_X_ENTITY_REGISTRY.length,
      finalCriticVersion: PUBLISHING_V2_FINAL_CRITIC_VERSION,
      generationQualityMarginFloor: PUBLISHING_V2_MIN_FINAL_QUALITY_MARGIN,
      autopostQualityMarginFloor: ['geoffwoo', 'geoffreywoo'].includes(normalizedHandle)
        ? PUBLISHING_V2_GEOFFREY_AUTOPOST_QUALITY_MARGIN
        : PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN,
      baseAutopostQualityMarginFloor: PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN,
      recommendedAuditHeadroom: QUALITY_MARGIN_HEADROOM_FLOOR,
      contextualQualityPolicyVersion: PUBLISHING_V2_CONTEXTUAL_QUALITY_POLICY_VERSION,
      contextualFinalCriticVersion: PUBLISHING_V2_CONTEXTUAL_FINAL_CRITIC_VERSION,
      currentVoiceCorpusVersion: corpus?.snapshotId || null,
      autopostActivation: {
        activated: true,
        source: 'v2_only',
        configuredVersion: 'v2',
        requiresExplicitProductionActivation: false,
      },
    },
    autopost: autopostSummary,
    learning: {
      updatedAt: context.learnings?.updatedAt || null,
      totalTracked: context.learnings?.totalTracked || 0,
      refreshIntervalHours: isGeoffrey ? 3 : 24,
      topicRankings: context.learnings?.topicRankings || [],
      frontierForecast: context.learnings?.frontierForecastProfile || null,
    },
    corpus: corpusSummary,
    queue: queueSummary,
    contentMix: isGeoffrey ? contentMixSummary : null,
    portfolio: portfolioSummary,
    sources: {
      nextBriefPlan: {
        deterministicSeedPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
        previewKind: 'representative_deterministic',
        predictsExactNextLiveRun: false,
        liveRunSeedSource: 'generation_run_id',
        requestedDraftCount: 2,
        briefCount: nextBriefPlan.length,
        laneCounts: nextBriefLaneCounts,
        briefs: nextBriefPlan.map((brief) => ({
          id: brief.id,
          topic: brief.topic,
          sourceLane: brief.sourceLane,
          evidenceMode: brief.evidenceMode,
          storyClusterId: brief.storyClusterId,
          trendTopicId: brief.trendTopicId,
          operatorTopicContext: brief.operatorTopicContext || null,
          portfolioCompanyContext: brief.portfolioCompanyContext || null,
          exactSubjectCueCount: brief.personalTopicSignals?.length || 0,
          exactSubjectCues: (brief.personalTopicSignals || []).map((signal) => signal.replace(/:/g, ' ')),
          exactSubjectCueProvenance: (brief.personalTopicSignals?.length || 0) > 0
            ? 'high_confidence_operator_topic_signals'
            : null,
          exactSubjectCueLearningUse: (brief.personalTopicSignals?.length || 0) > 0
            ? 'subject_only_no_wording_or_premise'
            : null,
          creativeSeedId: brief.creativeSeed?.id || null,
        })),
      },
      operatorTopicTaste,
      documentCount: sourceDocuments.length,
      storyCount: storyClusters.length,
      qualifiedStoryCount: storyClusters.filter((story) => story.evidenceQualified && !story.blockedUntil && !story.blockReason).length,
      evidenceQualifiedStoryCount: storyClusters.filter((story) => story.evidenceQualified && !story.blockedUntil && !story.blockReason).length,
      generationEligibleStoryCount: storyDecisions.filter((decision) => decision.planningRejectionCodes.length === 0).length,
      blockedStoryCount: storyClusters.filter((story) => Boolean(story.blockedUntil || story.blockReason)).length,
      sourceTypeCounts: countBy(sourceDocuments.map((document) => document.sourceType)),
      trustTierCounts: countBy(sourceDocuments.map((document) => document.trustTier)),
      publisherCounts: countBy(sourceDocuments.map((document) => document.publisher)),
      agenda: researchAgenda ? {
        updatedAt: researchAgenda.updatedAt,
        queryCount: researchAgenda.queries.length,
        operatorTopicCount: researchAgenda.operatorTopics?.length || 0,
        pinnedQuestionCount: researchAgenda.pinnedQuestions.length,
        blockedTopicCount: researchAgenda.blockedTopics.length,
        feedCount: researchAgenda.rssFeeds.length,
        githubRepositoryCount: researchAgenda.githubRepositories.length,
      } : null,
      accepted: storyDecisions.filter((decision) => decision.rejectionCodes.length === 0).map(({ story }) => ({
        id: story.id,
        headline: story.title,
        topic: story.topic,
        semanticKey: story.semanticKey,
        sourceDocumentIds: story.sourceDocumentIds,
        primarySourceCount: story.primarySourceCount,
        independentSourceCount: story.independentSourceCount,
        scores: story.scores,
      })),
      generationPlanning: {
        eligibleCount: storyDecisions.filter((decision) => decision.planningRejectionCodes.length === 0).length,
        editorialCooldown: {
          ttlHours: failedStoryAttemptDiagnostics.cooldownMs / (60 * 60 * 1000),
          activeAttemptCount: failedStoryAttemptDiagnostics.activeAttempts.length,
          suppressedByViablePremiseCount: failedStoryAttemptDiagnostics.suppressedByViablePremise.length,
          activeAttempts: failedStoryAttemptDiagnostics.activeAttempts.slice(0, 12).map((attempt) => ({
            storyClusterId: attempt.storyClusterId,
            generationRunId: attempt.generationRunId,
            qualityPolicyVersion: attempt.qualityPolicyVersion,
            topic: attempt.topic,
            failedAt: attempt.failedAt,
            failureCodes: attempt.failureCodes,
          })),
          suppressedByViablePremise: failedStoryAttemptDiagnostics.suppressedByViablePremise.slice(0, 12).map((attempt) => ({
            storyClusterId: attempt.storyClusterId,
            generationRunId: attempt.generationRunId,
            qualityPolicyVersion: attempt.qualityPolicyVersion,
            topic: attempt.topic,
            failedAt: attempt.failedAt,
            failureCodes: attempt.failureCodes,
            viableIdeaIds: attempt.viableIdeaIds,
          })),
        },
        rejectionReasonCounts: topCounts(storyDecisions
          .filter((decision) => decision.rejectionCodes.length === 0)
          .flatMap((decision) => decision.planningRejectionCodes)),
        eligible: storyDecisions
          .filter((decision) => decision.planningRejectionCodes.length === 0)
          .map(({ story }) => ({
            id: story.id,
            headline: story.title,
            topic: story.topic,
            scores: story.scores,
          })),
        unavailableAfterEditorialQualification: storyDecisions
          .filter((decision) => decision.rejectionCodes.length === 0 && decision.planningRejectionCodes.length > 0)
          .map(({ story, planningRejectionCodes }) => ({
            id: story.id,
            headline: story.title,
            topic: story.topic,
            rejectionCodes: planningRejectionCodes,
          })),
      },
      rejected: storyDecisions.filter((decision) => decision.rejectionCodes.length > 0).map(({ story, rejectionCodes }) => ({
        id: story.id,
        headline: story.title,
        topic: story.topic,
        semanticKey: story.semanticKey,
        sourceDocumentIds: story.sourceDocumentIds,
        evidenceQualified: story.evidenceQualified,
        blockReason: story.blockReason,
        blockedUntil: story.blockedUntil,
        rejectionCodes,
        primarySourceCount: story.primarySourceCount,
        independentSourceCount: story.independentSourceCount,
      })),
      warmedNetworkTopicCount: trending.length,
      operatorTopicSignals: {
        eligibleCount: operatorTopicSignalDecisions.filter((decision) => decision.rejectionCodes.length === 0).length,
        selectedCount: selectedOperatorTopicSignals.length,
        selected: selectedOperatorTopicSignals,
        planningEligibleCount: operatorTopicSignalPlanningDecisions.filter((decision) => decision.attempt.eligible).length,
        attemptDispositionCounts: countBy(operatorTopicSignalPlanningDecisions.map((decision) => (
          decision.attempt.disposition
        ))),
        planningDecisions: operatorTopicSignalPlanningDecisions,
        rejectedReasonCounts: topCounts(operatorTopicSignalDecisions.flatMap((decision) => decision.rejectionCodes)),
        rejected: operatorTopicSignalDecisions
          .filter((decision) => decision.rejectionCodes.length > 0)
          .slice(0, 40)
          .map(({ topic, rejectionCodes }) => ({
            id: getTrendingTopicStableId(topic),
            category: topic.category,
            headline: topic.headline,
            semanticDomain: topic.semanticDomain,
            entities: topic.entities || [],
            operatorEngagementScore: topic.operatorEngagementScore || 0,
            topicConfidence: topic.topicConfidence || 0,
            identityFit: topic.fitScores.identityFit,
            rejectionCodes,
          })),
      },
      intelligence: topicIntelligence ? {
        observedAt: topicIntelligence.observedAt,
        sourceComplete: topicIntelligence.sourceComplete !== false,
        partialFailureCount: topicIntelligence.partialFailureCount || 0,
        sourceTweetCount: topicIntelligence.sourceTweetCount,
        trackedTopicCount: topicIntelligence.topics.length,
        trackedViralTweetCount: topicIntelligence.viralTweets.length,
      } : null,
    },
    models: {
      activeStack: activeModelStack,
      pipelineVersion,
      routingReason: modelStackAssignment.reason,
      shadowControlStack: modelStackAssignment.shadowStack,
      shadowComparison: {
        isolatedVariable: 'primary_writer',
        samplingDesign: activeModelStack === PUBLISHING_V2_GPT_CONTROL_MODEL_STACK
          ? 'three independent GPT one-draft calls with separate native register anchors; matched Fable control retired after zero-yield production audit'
          : 'one control variant on the highest-ranked selected idea',
        defaultWriter: primaryWriting,
        controlWriter: shadowControlWriting,
        sharedIdeaGenerator: primaryIdeaGeneration,
        sharedIdeaJudge: primaryIdeaJudge,
        sharedCopyJudge: primaryCopyJudge,
      },
      shadowEvidence: {
        runCount: writerShadowRuns.length,
        policyVersions: [...new Set(writerShadowRuns.map((run) => run.qualityPolicyVersion))].slice(0, 12),
        groups: writerShadowEvidence,
        caveat: 'Observational production comparison. Writer variants did not have identical shapes or sample sizes; judge scores cover only drafts that passed deterministic preflight.',
      },
      pricingCoverage: {
        complete: modelPricingCoverage.every((target) => target.priced),
        targets: modelPricingCoverage,
      },
      strictFallbackStack: null,
      preferred: {
        ideaGeneration: primaryIdeaGeneration,
        ideaJudge: primaryIdeaJudge,
        generation: primaryWriting,
        judge: primaryCopyJudge,
        finalCritic: primaryCopyJudge,
      },
      stackUsage: countBy(queueItems.map((item) => item.generationModelStack)),
      generationUsage: countBy(queueItems.map((item) => modelKey(item.generationProvider, item.generationModel))),
      judgeUsage: countBy(queueItems.map((item) => modelKey(item.judgeProvider, item.judgeModel))),
      finalCriticUsage: countBy(queueItems.map((item) => modelKey(item.finalCriticProvider, item.finalCriticModel))),
      generationFallbackCount: queueItems.filter((item) => (
        item.generationProvider !== primaryWriting?.provider || item.generationModel !== primaryWriting?.model
      )).length,
      judgeFallbackCount: queueItems.filter((item) => (
        item.judgeProvider !== primaryCopyJudge?.provider || item.judgeModel !== primaryCopyJudge?.model
      )).length,
      finalCriticFallbackCount: queueItems.filter((item) => (
        item.finalCriticProvider !== primaryCopyJudge?.provider || item.finalCriticModel !== primaryCopyJudge?.model
      )).length,
    },
    generationV2: {
      ...generationV2,
      currentPolicyWindow,
    },
    complaints: complaintSummary,
  };
}
