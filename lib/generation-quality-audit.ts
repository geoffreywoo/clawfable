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
  PUBLISHING_V2_CONTROL_MODEL_STACK,
  PUBLISHING_V2_MODEL_STACK,
  getModelChainForTask,
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
} from './kv-storage';
import { clampPostsPerDay } from './survivability';
import { loadGenerationV2Metrics } from './generation-v2-metrics';
import {
  buildGenerationBriefsV2,
  getStoryEditorialRejectionCodesV2,
  getStoryGenerationPlanningRejectionCodesV2,
} from './generation-v2';
import { getGeneratedPublishIssue } from './generation-origin';
import { hasAiModelPricing } from './ai-pricing';
import {
  enrichTrendingTopics,
  getOperatorTopicSignalRejectionCodes,
  selectOperatorTopicSignals,
} from './source-planner';
import {
  PUBLISHING_V2_CONTEXTUAL_FINAL_CRITIC_VERSION,
  PUBLISHING_V2_CONTEXTUAL_QUALITY_POLICY_VERSION,
  PUBLISHING_V2_FINAL_CRITIC_VERSION,
  PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN,
  PUBLISHING_V2_MIN_FINAL_QUALITY_MARGIN,
  PUBLISHING_V2_QUALITY_POLICY_VERSION,
} from './publishing-quality-policy';

export const GENERATION_QUALITY_AUDIT_VERSION = 12;

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

const QUALITY_MARGIN_HEADROOM_FLOOR = PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN + 0.02;

type AuditIdentity = ReturnType<typeof buildAgentIdentityAudit>;
type AuditGenerationV2 = Awaited<ReturnType<typeof loadGenerationV2Metrics>>;

interface AuditFindingInput {
  identity: AuditIdentity;
  autopost: {
    enabled: boolean;
    minQueueSize: number;
  };
  corpus: {
    active: boolean;
    anchorCount: number;
    targetAnchorCount: number;
    minimumAnchorCount: number;
    corpusPurity: number | null;
    knownGeneratedAnchorCount: number;
  } | null;
  queue: {
    qualityEligibleCount: number;
    items: Array<{
      id: string;
      qualityEligible: boolean;
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
  };
  generationV2: AuditGenerationV2;
  complaints: {
    total: number;
    affectedPostRate: number | null;
  };
  modelPricing: {
    activeComplete: boolean;
    missingModels: string[];
  };
  sources: {
    editorialEligibleCount: number;
    generationEligibleCount: number;
  };
}

export function buildGenerationAuditFindings(input: AuditFindingInput): GenerationAuditFinding[] {
  const findings: GenerationAuditFinding[] = [];
  const add = (finding: GenerationAuditFinding) => findings.push(finding);

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

export async function buildGenerationQualityAudit(agent: Agent) {
  const pipelineVersion = 'v2' as const;
  const [context, queue, corpus, complaints, allTweets, trendingValue, topicIntelligence, generationV2, sourceDocuments, storyClusters, researchAgenda, semanticBlocks, recentIdeas, analysis] = await Promise.all([
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
  ]);
  const trending = Array.isArray(trendingValue) ? trendingValue as TrendingTopic[] : [];
  const activeModelStack = PUBLISHING_V2_MODEL_STACK;
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
    PUBLISHING_V2_CONTROL_MODEL_STACK,
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
  const effectivePostsPerDay = Math.min(5, configuredPostsPerDay);
  const queueItems = queue.map((tweet) => {
    const originIssue = getGeneratedPublishIssue(tweet);
    const qualityIssues = [originIssue, tweet.quarantineReason].filter((value): value is string => Boolean(value));
    return {
      id: tweet.id,
      xTweetId: tweet.xTweetId,
      topic: tweet.topic,
      sourceLane: tweet.sourceLane || null,
      trendTopicId: tweet.trendTopicId || null,
      sourceEvidenceCount: tweet.sourceEvidenceTexts?.length || 0,
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
  const normalizedHandle = agent.handle.replace(/^@/, '').toLowerCase();
  const storyEditorialOptions = {
    minConsequence: ['geoffwoo', 'geoffreywoo'].includes(normalizedHandle) ? 0.55 : undefined,
  };
  const storyDecisions = storyClusters.map((story) => ({
    story,
    rejectionCodes: getStoryEditorialRejectionCodesV2(story, storyEditorialOptions),
    planningRejectionCodes: getStoryGenerationPlanningRejectionCodesV2(story, {
      ...storyEditorialOptions,
      blocks: semanticBlocks,
      committedTweets: allTweets.filter((tweet) => ['queued', 'posted', 'deleted_from_x'].includes(tweet.status)),
      recentIdeas,
      qualityPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
    }),
  }));
  const enrichedOperatorTopics = enrichTrendingTopics(
    trending,
    context.voiceProfile,
    context.learnings,
    context.style.trendTolerance,
  );
  const operatorTopicSignalDecisions = enrichedOperatorTopics.map((topic) => ({
    topic,
    rejectionCodes: getOperatorTopicSignalRejectionCodes(topic),
  }));
  const selectedOperatorTopicSignals = selectOperatorTopicSignals(
    trending,
    context.voiceProfile,
    context.learnings,
    context.style.trendTolerance,
    12,
  );
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
    blocks: semanticBlocks,
    recentIdeas,
    seedRotationKey: `audit:${agent.id}:${PUBLISHING_V2_QUALITY_POLICY_VERSION}`,
  });
  const nextBriefLaneCounts = countBy(nextBriefPlan.map((brief) => (
    brief.evidenceMode === 'verified_source'
      ? 'verified_source'
      : brief.trendTopicId
        ? 'operator_engaged_subject'
        : 'durable_operator_topic'
  )));
  const operatorTopicTaste = (context.learnings?.manualTopicProfile || []).map((cluster) => {
    const topTweets = cluster.topTweets || [];
    const cleanSubjectCueSources = topTweets.filter((tweet) => (
      tweet.authorshipProvenance !== 'known_clawfable_generated'
      && tweet.voiceCorpusDispositions?.includes('diction_anchor')
    ));
    return {
      topic: cluster.topic,
      sampleCount: cluster.sampleCount,
      averageEngagement: cluster.avgEngagement,
      topTweetCount: topTweets.length,
      cleanSubjectCueSourceCount: cleanSubjectCueSources.length,
      excludedFromExactSubjectReuseCount: topTweets.length - cleanSubjectCueSources.length,
    };
  });
  const autopostSummary = {
    enabled: context.settings.enabled,
    configuredPostsPerDay,
    effectivePostsPerDay,
    maxOriginalsPerRolling24Hours: 5,
    minQueueSize: context.settings.minQueueSize,
    refillBatchLimit: 2,
    refillCanIterateUntilMinimum: true,
  };
  const corpusSummary = corpus ? {
    snapshotId: corpus.snapshotId,
    schemaVersion: corpus.version,
    active: corpus.active,
    generatedAt: corpus.generatedAt,
    targetAnchorCount: corpus.targetAnchorCount,
    minimumAnchorCount: corpus.minimumAnchorCount,
    anchorCount: corpus.anchorCount,
    corpusPurity: anchors.length > 0
      ? Number(((anchors.length - generatedAnchors.length) / anchors.length).toFixed(4))
      : null,
    knownGeneratedAnchorCount: generatedAnchors.length,
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
    stageThroughput: {
      ideasGenerated: currentIdeasGenerated,
      ideasEligible: currentIdeasEligible,
      ideasSelected: currentIdeasSelected,
      draftsGenerated: currentDraftsGenerated,
      draftsEligible: currentDraftsEligible,
      draftsSelected: currentDraftsSelected,
      providerAttempts: currentProviderAttempts,
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
    modelPricing: {
      activeComplete: modelPricingCoverage.every((target) => target.priced),
      missingModels: modelPricingCoverage.filter((target) => !target.priced).map((target) => target.model),
    },
    sources: {
      editorialEligibleCount: storyDecisions.filter((decision) => decision.rejectionCodes.length === 0).length,
      generationEligibleCount: storyDecisions.filter((decision) => decision.planningRejectionCodes.length === 0).length,
    },
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
      qualityPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
      finalCriticVersion: PUBLISHING_V2_FINAL_CRITIC_VERSION,
      generationQualityMarginFloor: PUBLISHING_V2_MIN_FINAL_QUALITY_MARGIN,
      autopostQualityMarginFloor: PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN,
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
    corpus: corpusSummary,
    queue: queueSummary,
    sources: {
      nextBriefPlan: {
        deterministicSeedPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
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
          exactSubjectCueCount: brief.personalTopicSignals?.length || 0,
          exactSubjectCueProvenance: (brief.personalTopicSignals?.length || 0) > 0
            ? 'clean_diction_anchors'
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
      shadowControlStack: PUBLISHING_V2_CONTROL_MODEL_STACK,
      shadowComparison: {
        isolatedVariable: 'primary_writer',
        defaultWriter: primaryWriting,
        controlWriter: shadowControlWriting,
        sharedIdeaGenerator: primaryIdeaGeneration,
        sharedIdeaJudge: primaryIdeaJudge,
        sharedCopyJudge: primaryCopyJudge,
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
