import type {
  AgentLearnings,
  CandidateFeatureTags,
  CandidateCriticScores,
  CandidateJudgeBreakdown,
  CandidateScoreProvenance,
  ActionRewardBreakdown,
  AudienceSegment,
  CreativeLane,
  ContentSourceLane,
  ContentStyleMode,
  MediaExperimentType,
  PersonalizationMemory,
  PostPortfolioRole,
  PromptStrategy,
  Tweet,
  AutonomyMode,
} from './types';
import type { VoiceProfile } from './soul-parser';
import type { ContentStyleConfig } from './viral-generator';
import { getLengthBucketFromText } from './bandit';
import { isNearDuplicate } from './survivability';
import { buildCoverageCluster, extractCandidateFeatureTags, ideaSimilarity } from './tweet-features';
import { normalizeContentStyleMode, SHITPOAST_STYLE_MODE } from './style-mode';
import {
  buildCriticScores,
  getAuthorityProofIssue,
  inferAudienceSegment,
  inferPromptStrategy,
  scoreReplyPotential,
  scoreSlopRisk,
} from './virality-signals';
import {
  buildMediaBrief,
  inferMediaExperimentType,
  inferPortfolioRole,
  normalizeMediaExperimentType,
  normalizePortfolioRole,
} from './growth-engine';

export interface RankableProtocolTweet {
  content: string;
  format: string;
  targetTopic: string;
  rationale: string;
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

export interface RankedProtocolTweet extends RankableProtocolTweet {
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
  sourceLane?: ContentSourceLane | null;
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
  trendTopicId?: string | null;
  trendHeadline?: string | null;
}

export interface CandidateRankingContext {
  voiceProfile: VoiceProfile;
  learnings: AgentLearnings | null;
  style: ContentStyleConfig;
  recentPosts: string[];
  allTweets: Tweet[];
  memory: PersonalizationMemory;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeTopic(value: string | null | undefined): string {
  return (value || 'general').trim().toLowerCase();
}

function normalizeFormat(value: string | null | undefined): string {
  return (value || 'unknown').trim().toLowerCase();
}

function normalizeCreativeLane(value: CreativeLane | string | null | undefined): CreativeLane {
  switch (value) {
    case 'contrarian_angle':
    case 'story_example':
    case 'teaching_threadlet':
    case 'weird_memetic':
    case 'trend_riff':
    case 'operator_take':
      return value;
    default:
      return 'operator_take';
  }
}

function stableExperimentId(candidate: RankableProtocolTweet, coverageCluster: string): string {
  const seed = `${candidate.experimentBatchId || 'batch'}:${coverageCluster}:${candidate.content}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }
  return `exp-${Math.abs(hash).toString(36)}`;
}

function buildExperimentHypothesis(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  lane: CreativeLane,
  holdout: boolean,
): string {
  const laneLabel = lane.replace(/_/g, ' ');
  const holdoutLabel = holdout ? ' holdout' : '';
  return `Test whether a ${laneLabel}${holdoutLabel} using ${featureTags.hook.replace(/_/g, ' ')} / ${featureTags.structure.replace(/_/g, ' ')} on ${candidate.targetTopic || 'general'} earns approval and above-baseline engagement.`;
}

function scoreRankPosition(index: number, total: number): number {
  if (index < 0 || total <= 0) return 0.5;
  return clamp(1 - (index / Math.max(total, 1)) * 0.7, 0.2, 1);
}

function countRecentMatches(allTweets: Tweet[], key: 'topic' | 'format' | 'cluster', value: string): number {
  return allTweets
    .filter((tweet) => ['draft', 'preview', 'queued', 'posted'].includes(tweet.status))
    .slice(0, 30)
    .filter((tweet) => {
      if (key === 'cluster') return (tweet.coverageCluster || '').toLowerCase() === value.toLowerCase();
      const candidate = key === 'topic' ? tweet.topic : tweet.format;
      return normalizeTopic(candidate) === normalizeTopic(value);
    })
    .length;
}

function countRecentFeatureMatches(allTweets: Tweet[], key: 'hook' | 'tone' | 'structure' | 'specificity', value: string): number {
  return allTweets
    .filter((tweet) => ['draft', 'preview', 'queued', 'posted'].includes(tweet.status))
    .slice(0, 40)
    .filter((tweet) => {
      if (key === 'hook') return String(tweet.hookType || '').toLowerCase() === value.toLowerCase();
      if (key === 'tone') return String(tweet.toneType || '').toLowerCase() === value.toLowerCase();
      if (key === 'structure') return String(tweet.structureType || '').toLowerCase() === value.toLowerCase();
      return String(tweet.specificityType || '').toLowerCase() === value.toLowerCase();
    })
    .length;
}

function getBanditArmScore(
  context: CandidateRankingContext,
  family: 'format' | 'topic' | 'length' | 'hook' | 'tone' | 'specificity' | 'structure',
  arm: string,
) {
  const ranking = family === 'format'
    ? context.style.banditPolicy?.formatArms
    : family === 'topic'
      ? context.style.banditPolicy?.topicArms
      : family === 'length'
        ? context.style.banditPolicy?.lengthArms
        : family === 'hook'
          ? context.style.banditPolicy?.hookArms
          : family === 'tone'
            ? context.style.banditPolicy?.toneArms
            : family === 'specificity'
              ? context.style.banditPolicy?.specificityArms
              : context.style.banditPolicy?.structureArms;

  return ranking?.find((entry) => entry.arm.toLowerCase() === arm.toLowerCase()) || null;
}

function computePriorBlend(
  context: CandidateRankingContext,
  featureTags: CandidateFeatureTags,
  candidate: RankableProtocolTweet,
): { local: number; global: number } {
  const lengthBucket = getLengthBucketFromText(candidate.content);
  const families = [
    getBanditArmScore(context, 'format', candidate.format),
    getBanditArmScore(context, 'topic', candidate.targetTopic),
    getBanditArmScore(context, 'length', lengthBucket),
    getBanditArmScore(context, 'hook', featureTags.hook),
    getBanditArmScore(context, 'tone', featureTags.tone),
    getBanditArmScore(context, 'specificity', featureTags.specificity),
    getBanditArmScore(context, 'structure', featureTags.structure),
  ].filter(Boolean);

  if (families.length === 0) {
    return { local: 0.5, global: 0.5 };
  }

  const local = families.reduce((sum, arm) => sum + (arm!.meanReward * arm!.localShare), 0) / families.length;
  const global = families.reduce((sum, arm) => sum + (arm!.globalMeanReward * (1 - arm!.localShare)), 0) / families.length;
  return {
    local: clamp(local),
    global: clamp(global),
  };
}

function scoreVoiceMatch(
  candidate: RankableProtocolTweet,
  voiceProfile: VoiceProfile,
  learnings: AgentLearnings | null,
  featureTags: CandidateFeatureTags,
): number {
  let score = 0.42;
  const normalizedTopic = normalizeTopic(candidate.targetTopic);
  const normalizedFormat = normalizeFormat(candidate.format);

  if (voiceProfile.topics.some((topic) => normalizeTopic(topic) === normalizedTopic)) {
    score += 0.14;
  }

  const topicRankIndex = learnings?.topicRankings.findIndex((entry) => normalizeTopic(entry.topic) === normalizedTopic) ?? -1;
  if (topicRankIndex >= 0) {
    score += 0.16 * scoreRankPosition(topicRankIndex, learnings?.topicRankings.length || 1);
  }

  const formatRankIndex = learnings?.formatRankings.findIndex((entry) => normalizeFormat(entry.format) === normalizedFormat) ?? -1;
  if (formatRankIndex >= 0) {
    score += 0.14 * scoreRankPosition(formatRankIndex, learnings?.formatRankings.length || 1);
  }

  if (learnings?.styleFingerprint?.topHooks.some((hook) => hook.toLowerCase() === featureTags.hook.toLowerCase())) {
    score += 0.07;
  }

  if (learnings?.styleFingerprint?.topTones.some((tone) => tone.toLowerCase() === featureTags.tone.toLowerCase())) {
    score += 0.07;
  }

  if (learnings?.operatorVoiceReference?.styleFingerprint.topHooks.some((hook) => hook.toLowerCase() === featureTags.hook.toLowerCase())) {
    score += 0.06;
  }

  if (learnings?.operatorVoiceReference?.styleFingerprint.topTones.some((tone) => tone.toLowerCase() === featureTags.tone.toLowerCase())) {
    score += 0.06;
  }

  if (voiceProfile.antiGoals.some((goal) => goal.length > 6 && candidate.content.toLowerCase().includes(goal.toLowerCase()))) {
    score -= 0.35;
  }

  return clamp(score);
}

function scoreNovelty(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  recentPosts: string[],
  allTweets: Tweet[],
): number {
  if (recentPosts.some((post) => isNearDuplicate(candidate.content, [post]).isDuplicate)) {
    return 0.05;
  }

  let score = 0.84;
  const topicMatches = countRecentMatches(allTweets, 'topic', candidate.targetTopic);
  const formatMatches = countRecentMatches(allTweets, 'format', candidate.format);
  const clusterMatches = countRecentMatches(allTweets, 'cluster', buildCoverageCluster(candidate.content, candidate.targetTopic, featureTags.thesis));
  score -= Math.min(topicMatches, 4) * 0.08;
  score -= Math.min(formatMatches, 4) * 0.05;
  score -= Math.min(clusterMatches, 3) * 0.12;

  for (const tweet of allTweets.slice(0, 15)) {
    const similarity = ideaSimilarity(
      { content: candidate.content, thesis: featureTags.thesis, topic: candidate.targetTopic },
      { content: tweet.content, thesis: tweet.thesis, topic: tweet.topic },
    );
    if (similarity >= 0.65) {
      score -= 0.18;
      break;
    }
  }

  return clamp(score);
}

function scorePredictedReward(
  candidate: RankableProtocolTweet,
  context: CandidateRankingContext,
  featureTags: CandidateFeatureTags,
): { reward: number; local: number; global: number } {
  const priorBlend = computePriorBlend(context, featureTags, candidate);
  const topicRankIndex = context.learnings?.topicRankings.findIndex((entry) => normalizeTopic(entry.topic) === normalizeTopic(candidate.targetTopic)) ?? -1;
  const formatRankIndex = context.learnings?.formatRankings.findIndex((entry) => normalizeFormat(entry.format) === normalizeFormat(candidate.format)) ?? -1;
  const rankingBoost = (
    scoreRankPosition(topicRankIndex, context.learnings?.topicRankings.length || 1) * 0.08 +
    scoreRankPosition(formatRankIndex, context.learnings?.formatRankings.length || 1) * 0.08
  );
  const reward = clamp((priorBlend.local * 0.58) + (priorBlend.global * 0.34) + rankingBoost);

  return {
    reward,
    local: clamp(priorBlend.local),
    global: clamp(priorBlend.global),
  };
}

function scoreFreshness(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  context: CandidateRankingContext,
): number {
  let score = 0.35;
  const normalizedTopic = normalizeTopic(candidate.targetTopic);
  const normalizedFormat = normalizeFormat(candidate.format);

  if (context.memory.topicsWithMomentum.some((topic) => normalizeTopic(topic) === normalizedTopic)) {
    score += 0.2;
  }
  if (context.style.exploration.underusedTopics.some((topic) => normalizeTopic(topic) === normalizedTopic)) {
    score += 0.16;
  }
  if (context.style.exploration.underusedFormats.some((format) => normalizeFormat(format) === normalizedFormat)) {
    score += 0.14;
  }
  if (context.style.bias.momentumTopic && normalizeTopic(context.style.bias.momentumTopic) === normalizedTopic) {
    score += 0.16;
  }
  if (featureTags.hook === 'prediction' || featureTags.hook === 'contrarian') {
    score += 0.06;
  }
  if (featureTags.structure === 'comparison' || featureTags.structure === 'story_arc') {
    score += 0.05;
  }

  const topicMatches = countRecentMatches(context.allTweets, 'topic', candidate.targetTopic);
  score -= Math.min(topicMatches, 3) * 0.07;
  return clamp(score);
}

function scoreSurprise(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  context: CandidateRankingContext,
  noveltyScore: number,
  repetitionRiskScore: number,
): number {
  let score = 0.28;
  const lane = normalizeCreativeLane(candidate.creativeLane);
  const hookMatches = countRecentFeatureMatches(context.allTweets, 'hook', featureTags.hook);
  const toneMatches = countRecentFeatureMatches(context.allTweets, 'tone', featureTags.tone);
  const structureMatches = countRecentFeatureMatches(context.allTweets, 'structure', featureTags.structure);
  const topicMatches = countRecentMatches(context.allTweets, 'topic', candidate.targetTopic);

  score += noveltyScore * 0.22;
  score += (1 - Math.min(1, hookMatches / 8)) * 0.12;
  score += (1 - Math.min(1, toneMatches / 8)) * 0.08;
  score += (1 - Math.min(1, structureMatches / 8)) * 0.1;
  score += (1 - Math.min(1, topicMatches / 10)) * 0.08;

  if (['contrarian', 'prediction', 'confession', 'callout'].includes(featureTags.hook)) score += 0.1;
  if (['story_arc', 'comparison', 'manifesto', 'stacked_lines'].includes(featureTags.structure)) score += 0.08;
  if (['data_driven', 'story_led', 'tactical'].includes(featureTags.specificity)) score += 0.07;
  if (lane === 'weird_memetic') score += 0.16;
  if (lane === 'contrarian_angle') score += 0.11;
  if (lane === 'story_example') score += 0.09;
  if (lane === 'trend_riff') score += 0.06;
  if (candidate.experimentHoldout) score += 0.1;
  if (repetitionRiskScore > 0.45) score -= 0.18;

  return clamp(score);
}

function scoreCreativeRisk(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  voiceScore: number,
  policyRiskScore: number,
  surpriseScore: number,
  repetitionRiskScore: number,
): number {
  let risk = 0.12;
  const lane = normalizeCreativeLane(candidate.creativeLane);
  risk += policyRiskScore * 0.42;
  risk += Math.max(0, 0.66 - voiceScore) * 0.42;
  risk += Math.max(0, surpriseScore - 0.72) * 0.22;
  risk += repetitionRiskScore * 0.16;
  if (lane === 'weird_memetic') risk += 0.1;
  if (lane === 'trend_riff' && candidate.sourceLane === 'trend_adjacent_explore') risk += 0.06;
  if (featureTags.riskFlags.includes('absolute_claim')) risk += 0.06;
  if (featureTags.riskFlags.includes('shouty_caps') || featureTags.riskFlags.includes('overexcited')) risk += 0.08;
  return clamp(risk);
}

function scoreSourceLane(
  candidate: RankableProtocolTweet,
  context: CandidateRankingContext,
  featureTags: CandidateFeatureTags,
): number {
  const lane = candidate.sourceLane || 'manual_core_exploit';
  const normalizedTopic = normalizeTopic(candidate.targetTopic);
  const manualTopics = context.learnings?.manualTopicProfile?.map((cluster) => normalizeTopic(cluster.topic)) || [];
  const acceptedTrends = context.style.sourcePlan?.acceptedTrends || [];

  if (lane === 'manual_core_exploit') {
    let score = 0.45;
    if (manualTopics.includes(normalizedTopic)) score += 0.22;
    if (context.learnings?.operatorVoiceReference?.styleFingerprint.topHooks.some((hook) => hook.toLowerCase() === featureTags.hook.toLowerCase())) {
      score += 0.12;
    }
    if (context.learnings?.operatorVoiceReference?.styleFingerprint.topTones.some((tone) => tone.toLowerCase() === featureTags.tone.toLowerCase())) {
      score += 0.1;
    }
    return clamp(score);
  }

  if (lane === 'trend_aligned_exploit' || lane === 'trend_adjacent_explore') {
    const match = acceptedTrends.find((trend) =>
      String(trend.id) === String(candidate.trendTopicId || '')
      || normalizeTopic(trend.category) === normalizedTopic
    );
    let score = match ? 0.56 : 0.22;
    if (match?.sourceLane === lane) score += 0.2;
    if (match?.fitScores.manual && match.fitScores.manual > 0.4) score += 0.08;
    if (lane === 'trend_adjacent_explore' && context.style.autonomyMode === 'explore') score += 0.06;
    return clamp(score);
  }

  let score = 0.34;
  if (context.style.exploration.underusedTopics.some((topic) => normalizeTopic(topic) === normalizedTopic)) {
    score += 0.18;
  }
  if (context.style.exploration.underusedFormats.some((format) => normalizeFormat(format) === normalizeFormat(candidate.format))) {
    score += 0.12;
  }
  return clamp(score);
}

function scoreAudienceSegment(
  candidate: RankableProtocolTweet,
  context: CandidateRankingContext,
  segment: AudienceSegment,
): number {
  let score = 0.46;
  const normalizedTopic = normalizeTopic(candidate.targetTopic);
  const manualTopicMatch = context.learnings?.manualTopicProfile?.find((cluster) =>
    normalizeTopic(cluster.topic) === normalizedTopic
    || cluster.angle.toLowerCase().includes(segment.replace(/_/g, ' '))
  );
  if (manualTopicMatch) score += 0.16;

  const learned = context.learnings?.audienceSegmentPerformance?.find((entry) => entry.segment === segment);
  if (learned && learned.posts > 0) {
    score += Math.min(0.18, learned.avgEngagement / 160);
    score += Math.min(0.1, learned.wins / Math.max(learned.posts, 1) * 0.1);
  }

  if (context.voiceProfile.topics.some((topic) => normalizeTopic(topic) === normalizedTopic)) score += 0.08;
  if (context.memory.audienceSegmentLessons?.some((lesson) => lesson.toLowerCase().includes(segment.replace(/_/g, ' ')))) score += 0.06;
  if (segment === 'generalists' && candidate.content.length > 420) score -= 0.08;
  if (segment === 'reply_regulars') score += 0.05;

  return clamp(score);
}

function scorePromptStrategyPerformance(
  strategy: PromptStrategy,
  context: CandidateRankingContext,
): number {
  let score = 0.5;
  const learned = context.learnings?.promptStrategyPerformance?.find((entry) => entry.strategy === strategy);
  if (learned && learned.posts > 0) {
    score += Math.min(0.16, learned.avgEngagement / 180);
    score += Math.min(0.1, learned.wins / Math.max(learned.posts, 1) * 0.1);
  }
  if (context.memory.promptStrategyLessons?.some((lesson) => lesson.toLowerCase().includes(strategy.replace(/_/g, ' ')))) score += 0.06;
  return clamp(score);
}

function scorePortfolioRolePerformance(
  role: PostPortfolioRole,
  context: CandidateRankingContext,
): number {
  let score = 0.48;
  const learned = context.learnings?.portfolioRolePerformance?.find((entry) => entry.role === role);
  if (learned && learned.posts > 0) {
    score += Math.min(0.18, learned.avgEngagement / 180);
    score += Math.min(0.08, learned.wins / Math.max(learned.posts, 1) * 0.12);
  }
  if (context.memory.portfolioLessons?.some((lesson) => lesson.toLowerCase().includes(role.replace(/_/g, ' ')))) score += 0.07;
  if (role === 'reply_bait') score += 0.03;
  if (role === 'relationship' && context.style.relationshipQueueEnabled !== false) score += 0.04;
  return clamp(score);
}

function scoreMediaExperimentPerformance(
  type: MediaExperimentType,
  role: PostPortfolioRole,
  context: CandidateRankingContext,
  featureTags: CandidateFeatureTags,
): number {
  let score = type === 'text_only' ? 0.5 : 0.42;
  const learned = context.learnings?.mediaExperimentPerformance?.find((entry) => entry.type === type);
  if (learned && learned.posts > 0) {
    score += Math.min(0.16, learned.avgEngagement / 180);
    score += Math.min(0.08, learned.wins / Math.max(learned.posts, 1) * 0.12);
  }
  if (context.memory.mediaExperimentLessons?.some((lesson) => lesson.toLowerCase().includes(type.replace(/_/g, ' ')))) score += 0.06;
  if (type !== 'text_only' && role === 'media') score += 0.12;
  if (type === 'screenshot' && ['data_driven', 'tactical'].includes(featureTags.specificity)) score += 0.08;
  if (type === 'meme' && ['weird_memetic', 'contrarian_angle'].includes(String(featureTags.hook))) score += 0.04;
  return clamp(score);
}

function scoreRelationshipTarget(
  handle: string | null | undefined,
  role: PostPortfolioRole,
  context: CandidateRankingContext,
): number {
  if (!handle && role !== 'relationship') return 0.5;
  let score = role === 'relationship' ? 0.52 : 0.44;
  const normalized = (handle || '').replace(/^@/, '').toLowerCase();
  const learned = normalized
    ? context.learnings?.topRelationshipHandles?.find((entry) => entry.handle.toLowerCase() === normalized)
    : null;
  if (learned) {
    score += Math.min(0.18, learned.avgEngagement / 160);
    score += Math.min(0.08, learned.interactions * 0.02);
  }
  if (context.memory.relationshipLessons?.some((lesson) => normalized && lesson.toLowerCase().includes(`@${normalized}`))) score += 0.08;
  return clamp(score);
}

function buildSegmentHypothesis(
  candidate: RankableProtocolTweet,
  segment: AudienceSegment,
  strategy: PromptStrategy,
): string {
  return candidate.segmentHypothesis
    || `Aim ${strategy.replace(/_/g, ' ')} framing at ${segment.replace(/_/g, ' ')} and measure reply quality plus engagement lift.`;
}

function predictActionRewards({
  rewardPrediction,
  replyPotential,
  slopScore,
  audienceScore,
  creativeRiskScore,
}: {
  rewardPrediction: number;
  replyPotential: number;
  slopScore: number;
  audienceScore: number;
  creativeRiskScore: number;
}): ActionRewardBreakdown {
  const likeReward = clamp((rewardPrediction * 0.24) + (audienceScore * 0.08), 0, 0.42);
  const repostReward = clamp((rewardPrediction * 0.18) + ((1 - slopScore) * 0.06), 0, 0.36);
  const replyReward = clamp(replyPotential * 0.28, 0, 0.32);
  const impressionReward = clamp((rewardPrediction * 0.12) + (replyPotential * 0.08), 0, 0.28);
  const engagementRateReward = clamp((rewardPrediction * 0.12) + ((1 - slopScore) * 0.05), 0, 0.25);
  const negativeFeedbackRisk = clamp((slopScore * 0.16) + (creativeRiskScore * 0.12), 0, 0.28);
  const total = clamp(
    likeReward + replyReward + repostReward + impressionReward + engagementRateReward - negativeFeedbackRisk,
    -0.6,
    0.8,
  );

  return {
    likeReward: Number(likeReward.toFixed(3)),
    replyReward: Number(replyReward.toFixed(3)),
    repostReward: Number(repostReward.toFixed(3)),
    impressionReward: Number(impressionReward.toFixed(3)),
    engagementRateReward: Number(engagementRateReward.toFixed(3)),
    profileClickReward: 0,
    followReward: 0,
    negativeFeedbackRisk: Number(negativeFeedbackRisk.toFixed(3)),
    total: Number(total.toFixed(3)),
  };
}

function getStyleModePerformanceAdjustment(
  mode: ContentStyleMode,
  context: CandidateRankingContext,
): number {
  if (mode !== SHITPOAST_STYLE_MODE) return 0;
  const perf = context.learnings?.styleModePerformance?.find((entry) => entry.mode === SHITPOAST_STYLE_MODE);
  if (!perf || perf.posts < 3) return 0;

  const rejectionLoad = (perf.rejections + perf.deletes) / Math.max(perf.approvals + perf.posts + perf.rejections + perf.deletes, 1);
  const winRate = perf.wins / Math.max(perf.posts, 1);
  return clamp((winRate * 0.08) - (rejectionLoad * 0.16), -0.12, 0.08);
}

function scoreStyleMode(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  policyRiskScore: number,
): number {
  const mode = normalizeContentStyleMode(candidate.styleMode);
  if (mode !== SHITPOAST_STYLE_MODE) return 0.5;

  let score = 0.38;
  const normalizedFormat = normalizeFormat(candidate.format);
  if (['hot_take', 'short_punch', 'observation'].includes(normalizedFormat)) score += 0.16;
  if (['contrarian', 'bold_claim', 'confession', 'callout', 'prediction', 'observation'].includes(featureTags.hook)) score += 0.18;
  if (['provocative', 'playful', 'sarcastic', 'casual'].includes(featureTags.tone)) score += 0.14;
  if (['single_punch', 'stacked_lines', 'comparison', 'manifesto'].includes(featureTags.structure)) score += 0.1;
  if (featureTags.specificity !== 'abstract') score += 0.08;
  if (candidate.content.length <= 280) score += 0.06;
  if (policyRiskScore > 0.28) score -= 0.18;
  if (featureTags.riskFlags.includes('absolute_claim') || featureTags.riskFlags.includes('shouty_caps')) score -= 0.08;

  return clamp(score);
}

function scoreViralTakePotential(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  policyRiskScore: number,
): number {
  const text = candidate.content;
  const lower = text.toLowerCase();
  const normalizedFormat = normalizeFormat(candidate.format);
  let score = 0.38;

  if (['hot_take', 'short_punch', 'observation'].includes(normalizedFormat)) score += 0.13;
  if (['contrarian', 'bold_claim', 'callout', 'prediction', 'confession'].includes(featureTags.hook)) score += 0.16;
  if (['provocative', 'sarcastic', 'playful', 'analytical'].includes(featureTags.tone)) score += 0.08;
  if (['concrete', 'data_driven', 'tactical', 'story_led'].includes(featureTags.specificity)) score += 0.12;
  if (/\b(most people|everyone|nobody|founders|operators|investors)\b.+\b(wrong|misread|underestimate|overrate|miss)\b/i.test(text)) score += 0.1;
  if (/\b(not|isn't|aren't)\b.{0,80}\b(but|it's|it is|because)\b/i.test(text) || /\bvs\b| versus | compared to /i.test(text)) score += 0.06;
  if (/\b\d+[%x]?\b|\$\d/.test(text)) score += 0.05;
  if (text.length >= 60 && text.length <= 360) score += 0.06;
  if (text.length > 1200) score -= 0.05;
  if (featureTags.riskFlags.includes('thin')) score -= 0.08;
  if (featureTags.riskFlags.includes('salesy')) score -= 0.12;
  if (policyRiskScore >= 0.35) score -= 0.2;

  return clamp(score);
}

function scoreJudge(candidate: RankableProtocolTweet): number {
  if (typeof candidate.judgeScore === 'number') return clamp(candidate.judgeScore);
  if (candidate.judgeBreakdown) {
    return clamp(
      candidate.judgeBreakdown.voiceFit * 0.28 +
      candidate.judgeBreakdown.clarity * 0.18 +
      candidate.judgeBreakdown.novelty * 0.18 +
      candidate.judgeBreakdown.audienceFit * 0.2 +
      candidate.judgeBreakdown.policySafety * 0.16
    );
  }
  return 0.5;
}

function scorePolicyRisk(candidate: RankableProtocolTweet, featureTags: CandidateFeatureTags): number {
  let risk = 0.1;
  const text = candidate.content;
  const lowercase = text.toLowerCase();

  if (featureTags.riskFlags.includes('link')) risk += 0.3;
  if (featureTags.riskFlags.includes('hashtag')) risk += 0.18;
  if (featureTags.riskFlags.includes('shouty_caps')) risk += 0.12;
  if (featureTags.riskFlags.includes('salesy')) risk += 0.18;
  if (featureTags.riskFlags.includes('absolute_claim')) risk += 0.12;
  if (featureTags.riskFlags.includes('thin')) risk += 0.1;
  if (/^(i think|here'?s|the thing is|in my opinion)/i.test(text)) risk += 0.16;
  if (/(sign up|buy now|subscribe|dm me|join now)/i.test(lowercase)) risk += 0.16;
  if (typeof candidate.judgeBreakdown?.policySafety === 'number') {
    risk += Math.max(0, 1 - candidate.judgeBreakdown.policySafety) * 0.18;
  }

  return clamp(risk);
}

function scoreRepetitionRisk(candidate: RankableProtocolTweet, featureTags: CandidateFeatureTags, context: CandidateRankingContext): number {
  let risk = context.recentPosts.some((post) => isNearDuplicate(candidate.content, [post]).isDuplicate) ? 0.78 : 0.16;
  const topicMatches = countRecentMatches(context.allTweets, 'topic', candidate.targetTopic);
  const formatMatches = countRecentMatches(context.allTweets, 'format', candidate.format);
  const clusterMatches = countRecentMatches(context.allTweets, 'cluster', buildCoverageCluster(candidate.content, candidate.targetTopic, featureTags.thesis));
  risk += Math.min(topicMatches, 4) * 0.08;
  risk += Math.min(formatMatches, 4) * 0.05;
  risk += Math.min(clusterMatches, 3) * 0.12;

  for (const tweet of context.allTweets.slice(0, 12)) {
    risk += ideaSimilarity(
      { content: candidate.content, thesis: featureTags.thesis, topic: candidate.targetTopic },
      { content: tweet.content, thesis: tweet.thesis, topic: tweet.topic },
    ) * 0.18;
  }

  return clamp(risk);
}

function inferGenerationMode(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  context: CandidateRankingContext,
  confidence: number,
  policyRisk: number,
): AutonomyMode {
  const normalizedTopic = normalizeTopic(candidate.targetTopic);
  const normalizedFormat = normalizeFormat(candidate.format);
  const isExplorationBet =
    context.style.exploration.underusedTopics.some((topic) => normalizeTopic(topic) === normalizedTopic) ||
    context.style.exploration.underusedFormats.some((format) => normalizeFormat(format) === normalizedFormat) ||
    Boolean(getBanditArmScore(context, 'hook', featureTags.hook)?.coldStart) ||
    Boolean(getBanditArmScore(context, 'structure', featureTags.structure)?.coldStart);

  if (isExplorationBet) return 'explore';
  if (confidence >= 0.74 && policyRisk <= 0.22) return 'safe';
  return 'balanced';
}

export function getAutonomyConfidenceThreshold(mode: AutonomyMode): number {
  if (mode === 'safe') return 0.7;
  if (mode === 'explore') return 0.44;
  return 0.58;
}

export function rankGeneratedTweets(
  candidates: RankableProtocolTweet[],
  context: CandidateRankingContext,
): RankedProtocolTweet[] {
  const ranked = candidates.map((candidate) => {
    const featureTags = candidate.featureTags || extractCandidateFeatureTags(candidate.content, {
      topic: candidate.targetTopic,
    });
    const coverageCluster = candidate.coverageCluster || buildCoverageCluster(candidate.content, candidate.targetTopic, featureTags.thesis);
    const creativeLane = normalizeCreativeLane(candidate.creativeLane);
    const targetAudienceSegment = candidate.targetAudienceSegment || inferAudienceSegment(candidate.content, candidate.targetTopic);
    const promptStrategy = candidate.promptStrategy || inferPromptStrategy({
      creativeLane,
      sourceLane: candidate.sourceLane,
      featureTags,
      content: candidate.content,
    });
    const initialMediaType = normalizeMediaExperimentType(candidate.mediaExperimentType);
    const portfolioRole = normalizePortfolioRole(candidate.portfolioRole || inferPortfolioRole({
      content: candidate.content,
      format: candidate.format,
      creativeLane,
      sourceLane: candidate.sourceLane,
      mediaExperimentType: initialMediaType,
    }));
    const mediaExperimentType = candidate.mediaExperimentType
      ? initialMediaType
      : inferMediaExperimentType({
          content: candidate.content,
          portfolioRole,
          mediaExperimentRate: context.style.mediaExperimentRate ?? 15,
        });
    const mediaBrief = candidate.mediaBrief || buildMediaBrief({
      content: candidate.content,
      topic: candidate.targetTopic,
      mediaExperimentType,
    });
    const relationshipTargetHandle = candidate.relationshipTargetHandle
      ? candidate.relationshipTargetHandle.replace(/^@/, '').trim().slice(0, 24)
      : null;
    const voiceScore = scoreVoiceMatch(candidate, context.voiceProfile, context.learnings, featureTags);
    const noveltyScore = scoreNovelty(candidate, featureTags, context.recentPosts, context.allTweets);
    const rewardPrediction = scorePredictedReward(candidate, context, featureTags);
    const freshnessScore = scoreFreshness(candidate, featureTags, context);
    const sourceLaneScore = scoreSourceLane(candidate, context, featureTags);
    const audienceScore = scoreAudienceSegment(candidate, context, targetAudienceSegment);
    const promptStrategyScore = scorePromptStrategyPerformance(promptStrategy, context);
    const portfolioScore = scorePortfolioRolePerformance(portfolioRole, context);
    const mediaExperimentScore = scoreMediaExperimentPerformance(mediaExperimentType, portfolioRole, context, featureTags);
    const relationshipScore = scoreRelationshipTarget(relationshipTargetHandle, portfolioRole, context);
    const judgeScore = scoreJudge(candidate);
    const repetitionRiskScore = scoreRepetitionRisk(candidate, featureTags, context);
    const policyRiskScore = scorePolicyRisk(candidate, featureTags);
    const slopScore = scoreSlopRisk(candidate.content, featureTags);
    const replyBaitScore = scoreReplyPotential(candidate.content, featureTags);
    const surpriseScore = scoreSurprise(candidate, featureTags, context, noveltyScore, repetitionRiskScore);
    const creativeRiskScore = scoreCreativeRisk(candidate, featureTags, voiceScore, policyRiskScore, surpriseScore, repetitionRiskScore);
    const styleMode = normalizeContentStyleMode(candidate.styleMode);
    const styleModeScore = scoreStyleMode(candidate, featureTags, policyRiskScore);
    const styleModeAdjustment = getStyleModePerformanceAdjustment(styleMode, context);
    const viralTakeScore = scoreViralTakePotential(candidate, featureTags, policyRiskScore);
    const authorityProofIssue = getAuthorityProofIssue(candidate.content);
    const authorityProofPenalty = authorityProofIssue ? 0.36 : 0;
    const holdoutScore = candidate.experimentHoldout ? clamp((surpriseScore * 0.7) + ((1 - creativeRiskScore) * 0.3)) : 0;
    const riskPenalty = clamp(
      (policyRiskScore * 0.44) +
      (repetitionRiskScore * 0.24) +
      (creativeRiskScore * 0.18) +
      (slopScore * 0.14) +
      authorityProofPenalty
    );

    const scoreProvenance: CandidateScoreProvenance = {
      localPrior: Number((rewardPrediction.local * 0.24).toFixed(3)),
      globalPrior: Number((rewardPrediction.global * 0.1).toFixed(3)),
      judge: Number((judgeScore * 0.18).toFixed(3)),
      predictedReward: Number((rewardPrediction.reward * 0.18).toFixed(3)),
      noveltyCoverage: Number((((noveltyScore + freshnessScore + sourceLaneScore) / 3) * 0.16).toFixed(3)),
      creativity: Number((surpriseScore * 0.08).toFixed(3)),
      holdout: Number((holdoutScore * 0.05).toFixed(3)),
      antiSlop: Number(((1 - slopScore) * 0.06).toFixed(3)),
      authorityProof: authorityProofIssue ? Number((authorityProofPenalty * 0.14).toFixed(3)) : 0,
      audienceSegment: Number((audienceScore * 0.05).toFixed(3)),
      promptStrategy: Number((promptStrategyScore * 0.04).toFixed(3)),
      portfolio: Number((portfolioScore * 0.04).toFixed(3)),
      mediaExperiment: Number((mediaExperimentScore * 0.03).toFixed(3)),
      relationship: Number((relationshipScore * 0.025).toFixed(3)),
      riskPenalty: Number((riskPenalty * 0.14).toFixed(3)),
    };

    let confidenceScore = clamp(
      voiceScore * 0.2 +
      noveltyScore * 0.16 +
      rewardPrediction.reward * 0.2 +
      freshnessScore * 0.08 +
      sourceLaneScore * 0.08 +
      audienceScore * 0.06 +
      portfolioScore * 0.04 +
      mediaExperimentScore * 0.025 +
      relationshipScore * 0.025 +
      judgeScore * 0.2 +
      viralTakeScore * 0.1 +
      replyBaitScore * 0.04 +
      (1 - repetitionRiskScore) * 0.08 +
      (1 - policyRiskScore) * 0.08 +
      (1 - slopScore) * 0.08 +
      (styleMode === SHITPOAST_STYLE_MODE ? styleModeScore * 0.05 : 0) +
      styleModeAdjustment
    );

    confidenceScore = clamp(
      confidenceScore -
      (creativeRiskScore * 0.08) -
      (slopScore * 0.1) -
      (authorityProofPenalty * 0.16)
    );

    if (context.style.autonomyMode === 'safe') {
      confidenceScore = clamp(confidenceScore + ((1 - policyRiskScore) * 0.08) - (repetitionRiskScore * 0.05));
    } else if (context.style.autonomyMode === 'explore') {
      confidenceScore = clamp(confidenceScore + (freshnessScore * 0.08) + (surpriseScore * 0.04) - (policyRiskScore * 0.02));
    }

    const candidateScore = Math.round(clamp(
      scoreProvenance.localPrior +
      scoreProvenance.globalPrior +
      voiceScore * 0.16 +
      (styleMode === SHITPOAST_STYLE_MODE ? styleModeScore * 0.08 : 0) +
      viralTakeScore * 0.06 +
      scoreProvenance.predictedReward +
      scoreProvenance.judge +
      scoreProvenance.noveltyCoverage +
      (scoreProvenance.creativity || 0) +
      (scoreProvenance.holdout || 0) +
      (scoreProvenance.antiSlop || 0) +
      (scoreProvenance.audienceSegment || 0) +
      (scoreProvenance.promptStrategy || 0) +
      (scoreProvenance.portfolio || 0) +
      (scoreProvenance.mediaExperiment || 0) +
      (scoreProvenance.relationship || 0) +
      (1 - scoreProvenance.riskPenalty)
    ) * 100);
    const draftExperimentId = candidate.draftExperimentId || stableExperimentId(candidate, coverageCluster);
    const experimentHoldout = candidate.experimentHoldout === true;
    const promptVariant = candidate.promptVariant || creativeLane;
    const experimentHypothesis = candidate.experimentHypothesis || buildExperimentHypothesis(candidate, featureTags, creativeLane, experimentHoldout);
    const segmentHypothesis = buildSegmentHypothesis(candidate, targetAudienceSegment, promptStrategy);
    const actionRewardPrediction = candidate.actionRewardPrediction || predictActionRewards({
      rewardPrediction: rewardPrediction.reward,
      replyPotential: replyBaitScore,
      slopScore,
      audienceScore,
      creativeRiskScore,
    });
    const criticScores = candidate.criticScores || buildCriticScores({
      voiceScore,
      judgeScore,
      noveltyScore,
      audienceScore,
      slopScore,
      policyRiskScore,
      replyPotential: replyBaitScore,
    });

    return {
      ...candidate,
      generationMode: inferGenerationMode(candidate, featureTags, context, confidenceScore, policyRiskScore),
      candidateScore,
      confidenceScore: Number(confidenceScore.toFixed(3)),
      voiceScore: Number(voiceScore.toFixed(3)),
      noveltyScore: Number(noveltyScore.toFixed(3)),
      surpriseScore: Number(surpriseScore.toFixed(3)),
      creativeRiskScore: Number(creativeRiskScore.toFixed(3)),
      slopScore: Number(slopScore.toFixed(3)),
      replyBaitScore: Number(replyBaitScore.toFixed(3)),
      predictedEngagementScore: Number(clamp((rewardPrediction.reward * 0.62) + (viralTakeScore * 0.25) + (replyBaitScore * 0.13)).toFixed(3)),
      freshnessScore: Number(freshnessScore.toFixed(3)),
      repetitionRiskScore: Number(repetitionRiskScore.toFixed(3)),
      policyRiskScore: Number(policyRiskScore.toFixed(3)),
      featureTags,
      judgeScore: candidate.judgeScore ?? null,
      judgeBreakdown: candidate.judgeBreakdown ?? null,
      judgeNotes: candidate.judgeNotes ?? null,
      mutationRound: candidate.mutationRound ?? null,
      coverageCluster,
      rewardPrediction: Number(rewardPrediction.reward.toFixed(3)),
      globalPriorWeight: Number(context.style.banditPolicy?.globalPriorWeight.toFixed(3) || 0),
      localPriorWeight: Number(context.style.banditPolicy?.localEvidenceWeight.toFixed(3) || 0),
      scoreProvenance,
      sourceLane: candidate.sourceLane ?? null,
      styleMode,
      creativeLane,
      draftExperimentId,
      experimentBatchId: candidate.experimentBatchId ?? null,
      experimentHypothesis,
      experimentHoldout,
      promptVariant,
      targetAudienceSegment,
      segmentHypothesis,
      promptStrategy,
      mediaExperimentType,
      mediaBrief,
      portfolioRole,
      relationshipTargetHandle,
      trendFitScore: typeof candidate.trendFitScore === 'number' ? candidate.trendFitScore : null,
      criticScores,
      actionRewardPrediction,
      trendTopicId: candidate.trendTopicId ?? null,
      trendHeadline: candidate.trendHeadline ?? null,
    };
  });

  return ranked.sort((a, b) =>
    b.candidateScore - a.candidateScore ||
    b.confidenceScore - a.confidenceScore ||
    a.policyRiskScore - b.policyRiskScore ||
    a.content.localeCompare(b.content)
  );
}

export function selectTopRankedTweets(
  ranked: RankedProtocolTweet[],
  count: number,
  options: { maxShitpoast?: number; minHoldouts?: number } = {},
): RankedProtocolTweet[] {
  const selected: RankedProtocolTweet[] = [];
  const usedClusters = new Set<string>();
  const maxShitpoast = options.maxShitpoast ?? Number.POSITIVE_INFINITY;
  const minHoldouts = options.minHoldouts ?? (count >= 4 ? 1 : 0);
  let shitpoastSelected = 0;

  const canSelect = (candidate: RankedProtocolTweet) => {
    if (candidate.styleMode === SHITPOAST_STYLE_MODE && shitpoastSelected >= maxShitpoast) return false;
    const cluster = candidate.coverageCluster || buildCoverageCluster(candidate.content, candidate.targetTopic, candidate.featureTags?.thesis);
    const nearDuplicate = selected.some((item) =>
      isNearDuplicate(item.content, [candidate.content]).isDuplicate
      || ideaSimilarity(
        { content: item.content, thesis: item.featureTags.thesis, topic: item.targetTopic },
        { content: candidate.content, thesis: candidate.featureTags.thesis, topic: candidate.targetTopic },
      ) >= 0.5
    );
    if (nearDuplicate) return false;

    if (usedClusters.has(cluster) && selected.length < count - 1) {
      return false;
    }
    return true;
  };

  const addCandidate = (candidate: RankedProtocolTweet) => {
    const cluster = candidate.coverageCluster || buildCoverageCluster(candidate.content, candidate.targetTopic, candidate.featureTags?.thesis);
    selected.push(candidate);
    usedClusters.add(cluster);
    if (candidate.styleMode === SHITPOAST_STYLE_MODE) shitpoastSelected++;
  };

  const holdoutCandidates = ranked
    .filter((candidate) => candidate.experimentHoldout && candidate.policyRiskScore <= 0.34 && candidate.creativeRiskScore <= 0.56)
    .sort((a, b) =>
      b.surpriseScore - a.surpriseScore ||
      b.candidateScore - a.candidateScore
    );

  for (const candidate of holdoutCandidates) {
    if (selected.length >= Math.min(count, minHoldouts)) break;
    if (!canSelect(candidate)) continue;
    addCandidate(candidate);
  }

  for (const candidate of ranked) {
    if (selected.includes(candidate)) continue;
    if (!canSelect(candidate)) continue;
    addCandidate(candidate);
    if (selected.length === count) break;
  }

  return selected;
}
