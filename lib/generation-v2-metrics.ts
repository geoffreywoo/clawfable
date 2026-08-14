import type {
  DraftCandidate,
  GenerationRunTrace,
  IdeaCandidate,
  LearningSignal,
  ResearchRefreshState,
  Tweet,
  TweetPerformance,
  VoiceCorpusSnapshot,
} from './types';
import { summarizeGenerationUsage } from './generation-usage';
import { PUBLISHING_V2_QUALITY_POLICY_VERSION } from './publishing-quality-policy';
import {
  getDraftCandidates,
  getGenerationRuns,
  getIdeaCandidates,
  getLearningSignals,
  getPerformanceHistory,
  getResearchRefreshState,
  getTweets,
  getVoiceCorpusSnapshot,
} from './kv-storage';

export const V1_AUDITED_BASELINE = { medianImpressions: 1117, medianLikes: 7 };
export const OPERATOR_TEXT_AUDITED_BASELINE = { medianImpressions: 2840, medianLikes: 18 };

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2))
    : sorted[middle];
}

function maturePostSnapshots(entries: TweetPerformance[]): TweetPerformance[] {
  const byPost = new Map<string, TweetPerformance>();
  for (const entry of entries) {
    const ageMs = Date.parse(entry.checkedAt) - Date.parse(entry.postedAt);
    const mature = ageMs >= 24 * 60 * 60 * 1000
      || entry.performanceCheckpoint === 'full_24h'
      || entry.performanceCheckpoint === 'late';
    if (!mature) continue;
    const key = entry.xTweetId || entry.tweetId;
    if (!key) continue;
    const current = byPost.get(key);
    if (!current) {
      byPost.set(key, entry);
      continue;
    }
    const target = 24 * 60 * 60 * 1000;
    const currentDistance = Math.abs((Date.parse(current.checkedAt) - Date.parse(current.postedAt)) - target);
    const nextDistance = Math.abs(ageMs - target);
    if (nextDistance < currentDistance) byPost.set(key, entry);
  }
  return [...byPost.values()];
}

function isV2Signal(signal: LearningSignal, v2TweetIds: Set<string>): boolean {
  return signal.metadata?.pipelineVersion === 'v2'
    || Boolean(signal.tweetId && v2TweetIds.has(signal.tweetId));
}

function latestTerminalSignals(signals: LearningSignal[]): LearningSignal[] {
  const terminal = new Set<LearningSignal['signalType']>([
    'approved_without_edit',
    'edited_before_queue',
    'edited_before_post',
    'deleted_from_queue',
    'deleted_from_x',
    'x_post_succeeded',
  ]);
  const byTweet = new Map<string, LearningSignal>();
  for (const signal of [...signals].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))) {
    if (!signal.tweetId || !terminal.has(signal.signalType)) continue;
    byTweet.set(signal.tweetId, signal);
  }
  return [...byTweet.values()];
}

function sumStage(runs: GenerationRunTrace[], key: string): number {
  return runs.reduce((sum, run) => sum + (run.stageCounts[key] || 0), 0);
}

function sumRejections(runs: GenerationRunTrace[], pattern: RegExp): number {
  return runs.reduce((sum, run) => sum + Object.entries(run.rejectionCounts)
    .filter(([key]) => pattern.test(key))
    .reduce((count, [, value]) => count + value, 0), 0);
}

export function buildGenerationV2Metrics({
  runs,
  ideas,
  drafts,
  tweets,
  signals,
  performance,
  voiceCorpus = null,
  researchState = null,
  now = new Date(),
}: {
  runs: GenerationRunTrace[];
  ideas: IdeaCandidate[];
  drafts: DraftCandidate[];
  tweets: Tweet[];
  signals: LearningSignal[];
  performance: TweetPerformance[];
  voiceCorpus?: VoiceCorpusSnapshot | null;
  researchState?: ResearchRefreshState | null;
  now?: Date;
}) {
  const completedRuns = runs.filter((run) => run.status !== 'running' && run.mode !== 'preview');
  const liveRunIds = new Set(completedRuns.map((run) => run.id));
  const v2TweetIds = new Set(tweets.filter((tweet) => tweet.pipelineVersion === 'v2').map((tweet) => tweet.id));
  const v2Signals = signals.filter((signal) => isV2Signal(signal, v2TweetIds));
  const terminal = latestTerminalSignals(v2Signals);
  const editedTweetIds = new Set(v2Signals
    .filter((signal) => signal.signalType === 'edited_before_queue' || signal.signalType === 'edited_before_post')
    .map((signal) => signal.tweetId)
    .filter((id): id is string => Boolean(id)));
  const cleanAccepted = terminal.filter((signal) => (
    signal.signalType === 'approved_without_edit'
    || (signal.signalType === 'x_post_succeeded' && signal.tweetId && !editedTweetIds.has(signal.tweetId))
  ));
  const deletes = terminal.filter((signal) => signal.signalType === 'deleted_from_queue' || signal.signalType === 'deleted_from_x');
  const v2TweetsById = new Map(tweets.filter((tweet) => tweet.pipelineVersion === 'v2').map((tweet) => [tweet.id, tweet]));
  const signalPolicyVersion = (signal: LearningSignal): string | null => (
    typeof signal.metadata?.qualityPolicyVersion === 'string'
      ? signal.metadata.qualityPolicyVersion
      : signal.tweetId
        ? v2TweetsById.get(signal.tweetId)?.qualityPolicyVersion || null
        : null
  );
  const factualIncidents = v2Signals.filter((signal) => signal.metadata?.feedbackReasonCode === 'factual_risk');
  const currentPolicyFactualIncidents = factualIncidents.filter((signal) => (
    signalPolicyVersion(signal) === PUBLISHING_V2_QUALITY_POLICY_VERSION
  ));
  const policyIncidents = v2Signals.filter((signal) => (
    signal.signalType === 'x_post_rejected' && signal.metadata?.errorClass === 'policy'
  ));
  const currentPolicyPolicyIncidents = policyIncidents.filter((signal) => (
    signalPolicyVersion(signal) === PUBLISHING_V2_QUALITY_POLICY_VERSION
  ));
  const liveIdeas = ideas.filter((idea) => liveRunIds.has(idea.generationRunId));
  const liveDrafts = drafts.filter((draft) => liveRunIds.has(draft.generationRunId));
  const selectedDrafts = liveDrafts.filter((draft) => ['selected', 'queued', 'posted', 'edited', 'deleted'].includes(draft.status));
  const survivedDrafts = liveDrafts.filter((draft) => draft.status === 'queued' || draft.status === 'posted');
  const ideasById = new Map(ideas.map((idea) => [idea.id, idea]));
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));
  const tweetsByDraftId = new Map(tweets
    .filter((tweet) => tweet.pipelineVersion === 'v2' && tweet.draftCandidateId)
    .map((tweet) => [tweet.draftCandidateId as string, tweet]));
  const maturePerformance = maturePostSnapshots(performance.filter((entry) => (
    Boolean(entry.tweetId && v2TweetsById.has(entry.tweetId))
  )));
  const currentPolicyMaturePerformance = maturePostSnapshots(performance.filter((entry) => {
    const tweet = entry.tweetId ? v2TweetsById.get(entry.tweetId) : null;
    return tweet?.qualityPolicyVersion === PUBLISHING_V2_QUALITY_POLICY_VERSION;
  }));
  const matureV1Performance = maturePostSnapshots(performance.filter((entry) => (
    entry.source === 'autopilot' && (!entry.tweetId || !v2TweetsById.has(entry.tweetId))
  )));
  const corpusByXId = new Map((voiceCorpus?.entries || []).map((entry) => [entry.xTweetId, entry]));
  const rollingOperatorPerformance = maturePostSnapshots(performance.filter((entry) => {
    const corpusEntry = corpusByXId.get(String(entry.xTweetId || ''));
    const corpusQualified = Boolean(
      corpusEntry
      && corpusEntry.provenance !== 'known_clawfable_generated'
      && corpusEntry.provenance !== 'unknown'
      && corpusEntry.authorshipConfidence >= 0.8
      && corpusEntry.dispositions.includes('topic_signal')
      && !corpusEntry.dispositions.some((disposition) => ['mechanics_only', 'negative', 'excluded'].includes(disposition)),
    );
    const storedQualified = entry.authorshipProvenance !== 'known_clawfable_generated'
      && (entry.source === 'manual' || entry.authorshipProvenance === 'operator_composed');
    return (corpusQualified || storedQualified)
      && entry.hasMedia !== true
      && entry.isTextComplete !== false;
  }))
    .sort((left, right) => Date.parse(right.postedAt) - Date.parse(left.postedAt))
    .slice(0, 50);
  const modelCalls = [
    ...(researchState?.modelCalls || []),
    ...completedRuns.flatMap((run) => run.modelCalls),
  ];
  const usage = summarizeGenerationUsage(modelCalls);
  const sourceDocuments = sumStage(completedRuns, 'sourceDocuments');
  const qualifiedStories = sumStage(completedRuns, 'qualifiedStories');
  const researchBriefs = sumStage(completedRuns, 'researchBriefs');
  const briefs = sumStage(completedRuns, 'briefs');
  const ideasGenerated = sumStage(completedRuns, 'ideasGenerated');
  const ideasSelected = sumStage(completedRuns, 'ideasSelected');
  const draftsGenerated = sumStage(completedRuns, 'draftsGenerated');
  const draftsEligible = sumStage(completedRuns, 'draftsEligible');
  const draftsSelected = sumStage(completedRuns, 'draftsSelected');
  const briefsWithEligibleIdeas = sumStage(completedRuns, 'briefsWithEligibleIdeas');
  const ideasWithEligibleDrafts = sumStage(completedRuns, 'ideasWithEligibleDrafts');
  const repeatPattern = /semantic_repeat|duplicate|blocked_(?:idea|story|topic)|recent_copy_duplicate/;
  const semanticRepeatFailures = [...liveIdeas, ...liveDrafts].filter((candidate) => (
    (candidate.rejectionCodes || []).some((code) => repeatPattern.test(code))
  )).length || sumRejections(completedRuns, repeatPattern);
  const cleanAcceptance = ratio(cleanAccepted.length, terminal.length);
  const deleteRate = ratio(deletes.length, terminal.length);
  const repeatRate = ratio(semanticRepeatFailures, ideasGenerated + draftsGenerated);
  const medianImpressions = median(maturePerformance.map((entry) => entry.impressions));
  const medianLikes = median(maturePerformance.map((entry) => entry.likes));
  const v2QualityAdjustedGrowth = median(maturePerformance
    .map((entry) => entry.qualityAdjustedGrowthScore)
    .filter((value): value is number => typeof value === 'number'));
  const v1QualityAdjustedGrowth = median(matureV1Performance
    .map((entry) => entry.qualityAdjustedGrowthScore)
    .filter((value): value is number => typeof value === 'number'));
  const qualityAdjustedGrowthNoRegression = v2QualityAdjustedGrowth === null || v1QualityAdjustedGrowth === null
    ? null
    : v2QualityAdjustedGrowth >= v1QualityAdjustedGrowth;
  const rollingOperatorMedianImpressions = median(rollingOperatorPerformance.map((entry) => entry.impressions));
  const rollingOperatorMedianLikes = median(rollingOperatorPerformance.map((entry) => entry.likes));
  const operatorBaselineSource = rollingOperatorPerformance.length >= 20 ? 'rolling' : 'audited_static';
  const operatorBaselineImpressions = operatorBaselineSource === 'rolling'
    ? rollingOperatorMedianImpressions!
    : OPERATOR_TEXT_AUDITED_BASELINE.medianImpressions;
  const operatorBaselineLikes = operatorBaselineSource === 'rolling'
    ? rollingOperatorMedianLikes!
    : OPERATOR_TEXT_AUDITED_BASELINE.medianLikes;
  const currentPolicyMedianImpressions = median(currentPolicyMaturePerformance.map((entry) => entry.impressions));
  const currentPolicyMedianLikes = median(currentPolicyMaturePerformance.map((entry) => entry.likes));
  const selectedDraftCount = Math.max(0, draftsSelected);

  return {
    schemaVersion: 2,
    generatedAt: now.toISOString(),
    sample: {
      runs: completedRuns.length,
      ideas: liveIdeas.length,
      drafts: liveDrafts.length,
      terminalQueueDecisions: terminal.length,
      maturePosts: maturePerformance.length,
      currentPolicyMaturePosts: currentPolicyMaturePerformance.length,
      rollingOperatorPosts: rollingOperatorPerformance.length,
    },
    conversions: {
      researchBriefsPerRun: ratio(researchBriefs, completedRuns.length),
      sourceDocumentsAvailablePerRun: ratio(sourceDocuments, completedRuns.length),
      qualifiedStoriesAvailablePerRun: ratio(qualifiedStories, completedRuns.length),
      briefToIdea: ratio(briefsWithEligibleIdeas, briefs),
      ideaToDraft: ratio(ideasWithEligibleDrafts, ideasSelected),
      draftToQueue: ratio(draftsSelected, draftsEligible),
      cleanQueueSurvival: ratio(survivedDrafts.length, selectedDrafts.length),
      runsWithSelectionRate: ratio(completedRuns.filter((run) => (run.stageCounts.draftsSelected || 0) > 0).length, completedRuns.length),
      selectedDraftsPerRun: ratio(draftsSelected, completedRuns.length),
    },
    quality: {
      cleanAcceptance,
      editRate: ratio(editedTweetIds.size, terminal.length),
      userDeleteRate: deleteRate,
      semanticRepeatRate: repeatRate,
      factualIncidentCount: factualIncidents.length,
      historicalFactualIncidentCount: factualIncidents.length,
      currentPolicyFactualIncidentCount: currentPolicyFactualIncidents.length,
      unversionedFactualIncidentCount: factualIncidents.filter((signal) => !signalPolicyVersion(signal)).length,
      policyIncidentCount: policyIncidents.length,
      currentPolicyPolicyIncidentCount: currentPolicyPolicyIncidents.length,
      deleteReasons: Object.fromEntries(v2Signals
        .filter((signal) => signal.signalType === 'deleted_from_queue' || signal.signalType === 'deleted_from_x')
        .reduce((counts, signal) => {
          const key = String(signal.metadata?.feedbackReasonCode || 'unclassified');
          counts.set(key, (counts.get(key) || 0) + 1);
          return counts;
        }, new Map<string, number>())),
    },
    compute: {
      modelCalls: modelCalls.length,
      providerAttempts: usage.providerAttempts,
      fallbackAttempts: usage.fallbackAttempts,
      timeoutAttempts: usage.timeoutAttempts,
      unknownTokenAttempts: usage.unknownTokenAttempts,
      unknownCostAttempts: usage.unknownCostAttempts,
      unknownCostCalls: usage.unknownCostCalls,
      costDataStatus: usage.costDataStatus,
      totalInputTokens: usage.totalInputTokens,
      totalOutputTokens: usage.totalOutputTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      modelCallsPerSelectedDraft: ratio(modelCalls.length, selectedDraftCount),
      inputTokensPerSelectedDraft: ratio(usage.totalInputTokens, selectedDraftCount),
      outputTokensPerSelectedDraft: ratio(usage.totalOutputTokens, selectedDraftCount),
      averageRunLatencyMs: completedRuns.length > 0
        ? Math.round(completedRuns.reduce((sum, run) => sum + (run.durationMs || 0), 0) / completedRuns.length)
        : null,
      stageLatencyMs: Object.fromEntries(['source_enrichment', 'idea_generation', 'idea_judgment', 'tweet_writing', 'copy_judgment'].map((stage) => {
        const values = modelCalls.filter((call) => call.stage === stage).map((call) => call.durationMs);
        return [stage, values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null];
      })),
    },
    lineage: completedRuns.slice(0, 50).map((run) => ({
      generationRunId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      mode: run.mode || null,
      surface: run.surface || null,
      triggerId: run.triggerId || null,
      qualityPolicyVersion: run.qualityPolicyVersion || null,
      voiceCorpusVersion: run.voiceCorpusVersion || null,
      selectedDraftIds: run.selectedDraftIds,
      sourceDocumentIds: run.sourceDocumentIds,
      storyClusterIds: run.storyClusterIds,
      stageCounts: run.stageCounts,
      rejectionCounts: run.rejectionCounts,
      ideas: run.ideaCandidateIds.flatMap((id) => {
        const idea = ideasById.get(id);
        return idea ? [{
          ideaId: idea.id,
          storyClusterId: idea.storyClusterId,
          claim: idea.claim,
          evidenceIds: idea.evidenceIds,
          status: idea.status,
          rejectionCodes: idea.rejectionCodes,
        }] : [];
      }),
      drafts: run.draftCandidateIds.flatMap((id) => {
        const draft = draftsById.get(id);
        if (!draft) return [];
        const tweet = tweetsByDraftId.get(id);
        return [{
          draftCandidateId: draft.id,
          ideaId: draft.ideaId,
          parentDraftId: draft.parentDraftId || null,
          content: draft.content,
          status: draft.status,
          rejectionCodes: draft.rejectionCodes,
          mutationRound: draft.mutationRound || 0,
          generationProvider: draft.generationProvider,
          generationModel: draft.generationModel,
          judgeProvider: draft.judgeProvider,
          judgeModel: draft.judgeModel,
          judgeScore: draft.judgeScore,
          judgeBreakdown: draft.judgeBreakdown || null,
          judgeNotes: draft.judgeNotes || null,
          tweetId: tweet?.id || null,
          evidenceReferences: tweet?.evidenceReferences || [],
        }];
      }),
    })),
    performance: {
      medianImpressions,
      medianLikes,
      reachVsV1: medianImpressions === null ? null : Number((medianImpressions / V1_AUDITED_BASELINE.medianImpressions).toFixed(3)),
      likesVsV1: medianLikes === null ? null : Number((medianLikes / V1_AUDITED_BASELINE.medianLikes).toFixed(3)),
      reachVsOperator: medianImpressions === null ? null : Number((medianImpressions / OPERATOR_TEXT_AUDITED_BASELINE.medianImpressions).toFixed(3)),
      likesVsOperator: medianLikes === null ? null : Number((medianLikes / OPERATOR_TEXT_AUDITED_BASELINE.medianLikes).toFixed(3)),
      currentPolicyMedianImpressions,
      currentPolicyMedianLikes,
      currentPolicyReachVsOperator: currentPolicyMedianImpressions === null
        ? null
        : Number((currentPolicyMedianImpressions / operatorBaselineImpressions).toFixed(3)),
      currentPolicyLikesVsOperator: currentPolicyMedianLikes === null
        ? null
        : Number((currentPolicyMedianLikes / operatorBaselineLikes).toFixed(3)),
      operatorBaselineSource,
      operatorBaselineImpressions,
      operatorBaselineLikes,
      v2QualityAdjustedGrowth,
      v1QualityAdjustedGrowth,
      qualityAdjustedGrowthNoRegression,
      rollingOperatorMedianImpressions,
      rollingOperatorMedianLikes,
    },
    gates: {
      acceptanceSampleReady: terminal.length >= 30,
      cleanAcceptancePassed: cleanAcceptance !== null && cleanAcceptance >= 0.6,
      deleteRatePassed: deleteRate !== null && deleteRate <= 0.2,
      semanticRepeatPassed: repeatRate !== null && repeatRate <= 0.05,
      incidentFree: currentPolicyFactualIncidents.length === 0 && currentPolicyPolicyIncidents.length === 0,
      performanceSampleReady: maturePerformance.length >= 20,
      currentPolicyPerformanceSampleReady: currentPolicyMaturePerformance.length >= 20,
      performancePassed: maturePerformance.length >= 20
        && medianImpressions !== null
        && medianLikes !== null
        && medianImpressions >= V1_AUDITED_BASELINE.medianImpressions * 1.5
        && medianLikes >= V1_AUDITED_BASELINE.medianLikes * 1.5
        && qualityAdjustedGrowthNoRegression !== false,
      operatorBaselineTargetPassed: maturePerformance.length >= 50
        && rollingOperatorPerformance.length >= 20
        && medianImpressions !== null
        && medianLikes !== null
        && rollingOperatorMedianImpressions !== null
        && rollingOperatorMedianLikes !== null
        && medianImpressions >= rollingOperatorMedianImpressions * 0.8
        && medianLikes >= rollingOperatorMedianLikes * 0.8,
    },
  };
}

export async function loadGenerationV2Metrics(agentId: string) {
  const [runs, ideas, drafts, tweets, signals, performance, researchState, voiceCorpus] = await Promise.all([
    getGenerationRuns(agentId, 250),
    getIdeaCandidates(agentId, 2000),
    getDraftCandidates(agentId, 2000),
    getTweets(agentId),
    getLearningSignals(agentId, 250),
    getPerformanceHistory(agentId, 2000),
    getResearchRefreshState(agentId),
    getVoiceCorpusSnapshot(agentId),
  ]);
  return buildGenerationV2Metrics({ runs, ideas, drafts, tweets, signals, performance, researchState, voiceCorpus });
}
