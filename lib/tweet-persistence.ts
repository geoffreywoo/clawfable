import { createTweet } from './kv-storage';
import { withDecisionProvenanceSummary } from './decision-provenance';
import type { CreateTweetInput, Tweet } from './types';
import type { RankedProtocolTweet } from './candidate-ranking';

export type GeneratedTweetStatus = 'preview' | 'draft' | 'queued';

export async function createTweetFromGeneratedCandidate(
  agentId: string,
  item: RankedProtocolTweet,
  options: {
    status: GeneratedTweetStatus;
    topic?: string | null;
  },
): Promise<Tweet> {
  const data: CreateTweetInput = {
    agentId,
    content: item.content,
    type: 'original',
    status: options.status,
    format: item.format || null,
    topic: options.topic ?? item.targetTopic ?? 'general',
    rationale: item.rationale,
    generationMode: item.generationMode,
    candidateScore: item.candidateScore,
    confidenceScore: item.confidenceScore,
    voiceScore: item.voiceScore,
    noveltyScore: item.noveltyScore,
    predictedEngagementScore: item.predictedEngagementScore,
    freshnessScore: item.freshnessScore,
    repetitionRiskScore: item.repetitionRiskScore,
    policyRiskScore: item.policyRiskScore,
    surpriseScore: item.surpriseScore,
    creativeRiskScore: item.creativeRiskScore,
    slopScore: item.slopScore,
    replyBaitScore: item.replyBaitScore,
    hookType: item.featureTags?.hook ?? null,
    toneType: item.featureTags?.tone ?? null,
    specificityType: item.featureTags?.specificity ?? null,
    structureType: item.featureTags?.structure ?? null,
    thesis: item.featureTags?.thesis ?? null,
    coverageCluster: item.coverageCluster ?? null,
    featureTags: item.featureTags ?? null,
    judgeScore: item.judgeScore ?? null,
    judgeBreakdown: item.judgeBreakdown ?? null,
    judgeNotes: item.judgeNotes ?? null,
    mutationRound: item.mutationRound ?? null,
    rewardPrediction: item.rewardPrediction ?? null,
    globalPriorWeight: item.globalPriorWeight ?? null,
    localPriorWeight: item.localPriorWeight ?? null,
    scoreProvenance: item.scoreProvenance ?? null,
    sourceLane: item.sourceLane ?? null,
    styleMode: item.styleMode ?? 'standard',
    creativeLane: item.creativeLane ?? null,
    targetAudienceSegment: item.targetAudienceSegment ?? null,
    segmentHypothesis: item.segmentHypothesis ?? null,
    promptStrategy: item.promptStrategy ?? null,
    criticScores: item.criticScores ?? null,
    actionRewardPrediction: item.actionRewardPrediction ?? null,
    draftExperimentId: item.draftExperimentId ?? null,
    experimentBatchId: item.experimentBatchId ?? null,
    experimentHypothesis: item.experimentHypothesis ?? null,
    experimentHoldout: item.experimentHoldout ?? null,
    promptVariant: item.promptVariant ?? null,
    trendTopicId: item.trendTopicId ?? null,
    trendHeadline: item.trendHeadline ?? null,
    mediaExperimentType: item.mediaExperimentType ?? null,
    mediaBrief: item.mediaBrief ?? null,
    portfolioRole: item.portfolioRole ?? null,
    relationshipTargetHandle: item.relationshipTargetHandle ?? null,
    trendFitScore: item.trendFitScore ?? null,
    xTweetId: null,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
  };
  const tweet = await createTweet(data);
  return withDecisionProvenanceSummary(tweet);
}
