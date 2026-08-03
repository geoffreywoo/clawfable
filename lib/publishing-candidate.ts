import type {
  ActionRewardBreakdown,
  AudienceSegment,
  AutonomyMode,
  CandidateCriticScores,
  CandidateFeatureTags,
  CandidateJudgeBreakdown,
  CandidateScoreProvenance,
  ContentSourceLane,
  ContentStyleMode,
  CreativeLane,
  GenerationEvidenceReference,
  GenerationModelStackId,
  GenerationPipelineVersion,
  GenerationSurface,
  MediaExperimentType,
  PostPortfolioRole,
  PromptStrategy,
  TweetEvidenceReference,
} from './types';

export interface PublishingCandidate {
  content: string;
  format: string;
  targetTopic: string;
  rationale: string;
  generationModelStack?: GenerationModelStackId | null;
  generationProvider?: 'openai' | 'anthropic' | 'local' | null;
  generationModel?: string | null;
  judgeProvider?: 'openai' | 'anthropic' | null;
  judgeModel?: string | null;
  qualityPolicyVersion?: string | null;
  voiceCorpusVersion?: string | null;
  finalCriticProvider?: 'openai' | 'anthropic' | null;
  finalCriticModel?: string | null;
  finalCriticVerdict?: 'allow' | 'review' | 'block' | null;
  finalCriticScores?: CandidateJudgeBreakdown | null;
  finalCriticVersion?: string | null;
  sourceBrief?: string | null;
  sourceEvidenceTexts?: string[] | null;
  pipelineVersion?: GenerationPipelineVersion | null;
  generationSurface?: GenerationSurface | null;
  generationTriggerId?: string | null;
  generationIdempotencyKey?: string | null;
  contentProvenance?: 'operator_written' | 'generated_v2' | 'historical_v1' | null;
  generationRunId?: string | null;
  storyClusterId?: string | null;
  ideaId?: string | null;
  draftCandidateId?: string | null;
  parentTweetId?: string | null;
  parentIdeaId?: string | null;
  parentDraftCandidateId?: string | null;
  evidenceReferences?: TweetEvidenceReference[] | null;
  generationEvidenceReferences?: GenerationEvidenceReference[] | null;
  sourceLane?: ContentSourceLane | null;
  styleMode?: ContentStyleMode | null;
  trendTopicId?: string | null;
  trendHeadline?: string | null;
  creativeLane?: CreativeLane | null;
  draftExperimentId?: string | null;
  experimentBatchId?: string | null;
  experimentHypothesis?: string | null;
  experimentHoldout?: boolean | null;
  promptVariant?: string | null;
  targetAudienceSegment?: AudienceSegment | null;
  segmentHypothesis?: string | null;
  promptStrategy?: PromptStrategy | null;
  mediaExperimentType?: MediaExperimentType | null;
  mediaBrief?: string | null;
  portfolioRole?: PostPortfolioRole | null;
  relationshipTargetHandle?: string | null;
  trendFitScore?: number | null;
  criticScores?: CandidateCriticScores | null;
  actionRewardPrediction?: ActionRewardBreakdown | null;
  featureTags?: CandidateFeatureTags | null;
  coverageCluster?: string | null;
  judgeScore?: number | null;
  judgeBreakdown?: CandidateJudgeBreakdown | null;
  judgeNotes?: string | null;
  mutationRound?: number | null;
}

export interface RankedPublishingCandidate extends PublishingCandidate {
  generationMode: AutonomyMode;
  candidateScore: number;
  confidenceScore: number;
  voiceScore: number;
  noveltyScore: number;
  surpriseScore: number;
  creativeRiskScore: number;
  slopScore: number;
  replyBaitScore: number;
  predictedEngagementScore: number;
  freshnessScore: number;
  repetitionRiskScore: number;
  policyRiskScore: number;
  featureTags: CandidateFeatureTags;
  judgeScore: number | null;
  judgeBreakdown: CandidateJudgeBreakdown | null;
  judgeNotes: string | null;
  mutationRound: number | null;
  coverageCluster: string;
  rewardPrediction: number;
  globalPriorWeight: number;
  localPriorWeight: number;
  scoreProvenance: CandidateScoreProvenance;
  styleMode: ContentStyleMode;
  creativeLane: CreativeLane;
  draftExperimentId: string;
  experimentBatchId: string | null;
  experimentHypothesis: string;
  experimentHoldout: boolean;
  promptVariant: string;
  targetAudienceSegment: AudienceSegment;
  segmentHypothesis: string;
  promptStrategy: PromptStrategy;
  mediaExperimentType: MediaExperimentType;
  mediaBrief: string | null;
  portfolioRole: PostPortfolioRole;
  relationshipTargetHandle: string | null;
  trendFitScore: number | null;
  criticScores: CandidateCriticScores;
  actionRewardPrediction: ActionRewardBreakdown;
}
