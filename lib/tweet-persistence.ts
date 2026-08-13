import { createTweet, getTweets } from './kv-storage';
import { withDecisionProvenanceSummary } from './decision-provenance';
import type { CreateTweetInput, Tweet } from './types';
import type { RankedPublishingCandidate as RankedProtocolTweet } from './publishing-candidate';

export type GeneratedTweetStatus = 'preview' | 'draft' | 'queued';

export async function createTweetFromGeneratedCandidate(
  agentId: string,
  item: RankedProtocolTweet,
  options: {
    status: GeneratedTweetStatus;
    topic?: string | null;
    type?: 'original' | 'reply' | 'quote';
    followupForTweetId?: string | null;
    replyConversationId?: string | null;
  },
): Promise<Tweet> {
  if (item.draftCandidateId) {
    const existing = (await getTweets(agentId)).find((tweet) => (
      tweet.draftCandidateId === item.draftCandidateId
      && tweet.generationIdempotencyKey === (item.generationIdempotencyKey ?? null)
    ));
    if (existing) return withDecisionProvenanceSummary(existing);
  }
  const data: CreateTweetInput = {
    agentId,
    content: item.content,
    type: options.type || 'original',
    status: options.status,
    format: item.format || null,
    topic: options.topic ?? item.targetTopic ?? 'general',
    rationale: item.rationale,
    generationModelStack: item.generationModelStack ?? null,
    generationProvider: item.generationProvider ?? null,
    generationModel: item.generationModel ?? null,
    judgeProvider: item.judgeProvider ?? null,
    judgeModel: item.judgeModel ?? null,
    qualityPolicyVersion: item.qualityPolicyVersion ?? null,
    voiceCorpusVersion: item.voiceCorpusVersion ?? null,
    finalCriticProvider: item.finalCriticProvider ?? null,
    finalCriticModel: item.finalCriticModel ?? null,
    finalCriticVerdict: item.finalCriticVerdict ?? null,
    finalCriticScores: item.finalCriticScores ?? null,
    finalCriticVersion: item.finalCriticVersion ?? null,
    sourceBrief: item.sourceBrief ?? null,
    sourceEvidenceTexts: item.sourceEvidenceTexts ?? null,
    pipelineVersion: item.pipelineVersion ?? null,
    generationSurface: item.generationSurface ?? 'original',
    generationTriggerId: item.generationTriggerId ?? null,
    generationIdempotencyKey: item.generationIdempotencyKey ?? null,
    contentProvenance: 'generated_v2',
    generationRunId: item.generationRunId ?? null,
    storyClusterId: item.storyClusterId ?? null,
    ideaId: item.ideaId ?? null,
    draftCandidateId: item.draftCandidateId ?? null,
    parentTweetId: item.parentTweetId ?? null,
    parentIdeaId: item.parentIdeaId ?? null,
    parentDraftCandidateId: item.parentDraftCandidateId ?? null,
    evidenceReferences: item.evidenceReferences ?? null,
    generationEvidenceReferences: item.generationEvidenceReferences ?? null,
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
    followupForTweetId: options.followupForTweetId ?? null,
    replyConversationId: options.replyConversationId ?? null,
    trendFitScore: item.trendFitScore ?? null,
    xTweetId: null,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
  };
  const tweet = await createTweet(data);
  return withDecisionProvenanceSummary(tweet);
}
