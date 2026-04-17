import type {
  AgentLearnings,
  CandidateFeatureTags,
  CandidateJudgeBreakdown,
  CandidateScoreProvenance,
  PersonalizationMemory,
  Tweet,
  AutonomyMode,
} from './types';
import type { VoiceProfile } from './soul-parser';
import type { ContentStyleConfig } from './viral-generator';
import { getLengthBucketFromText } from './bandit';
import { isNearDuplicate } from './survivability';
import { buildCoverageCluster, extractCandidateFeatureTags, ideaSimilarity } from './tweet-features';

export interface RankableProtocolTweet {
  content: string;
  format: string;
  targetTopic: string;
  rationale: string;
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
    const voiceScore = scoreVoiceMatch(candidate, context.voiceProfile, context.learnings, featureTags);
    const noveltyScore = scoreNovelty(candidate, featureTags, context.recentPosts, context.allTweets);
    const rewardPrediction = scorePredictedReward(candidate, context, featureTags);
    const freshnessScore = scoreFreshness(candidate, featureTags, context);
    const judgeScore = scoreJudge(candidate);
    const repetitionRiskScore = scoreRepetitionRisk(candidate, featureTags, context);
    const policyRiskScore = scorePolicyRisk(candidate, featureTags);
    const riskPenalty = clamp((policyRiskScore * 0.6) + (repetitionRiskScore * 0.4));

    const scoreProvenance: CandidateScoreProvenance = {
      localPrior: Number((rewardPrediction.local * 0.24).toFixed(3)),
      globalPrior: Number((rewardPrediction.global * 0.1).toFixed(3)),
      judge: Number((judgeScore * 0.18).toFixed(3)),
      predictedReward: Number((rewardPrediction.reward * 0.18).toFixed(3)),
      noveltyCoverage: Number((((noveltyScore + freshnessScore) / 2) * 0.16).toFixed(3)),
      riskPenalty: Number((riskPenalty * 0.14).toFixed(3)),
    };

    let confidenceScore = clamp(
      voiceScore * 0.2 +
      noveltyScore * 0.16 +
      rewardPrediction.reward * 0.2 +
      freshnessScore * 0.08 +
      judgeScore * 0.2 +
      (1 - repetitionRiskScore) * 0.08 +
      (1 - policyRiskScore) * 0.08
    );

    if (context.style.autonomyMode === 'safe') {
      confidenceScore = clamp(confidenceScore + ((1 - policyRiskScore) * 0.08) - (repetitionRiskScore * 0.05));
    } else if (context.style.autonomyMode === 'explore') {
      confidenceScore = clamp(confidenceScore + (freshnessScore * 0.08) - (policyRiskScore * 0.02));
    }

    const candidateScore = Math.round(clamp(
      scoreProvenance.localPrior +
      scoreProvenance.globalPrior +
      voiceScore * 0.16 +
      scoreProvenance.predictedReward +
      scoreProvenance.judge +
      scoreProvenance.noveltyCoverage +
      (1 - scoreProvenance.riskPenalty)
    ) * 100);

    return {
      ...candidate,
      generationMode: inferGenerationMode(candidate, featureTags, context, confidenceScore, policyRiskScore),
      candidateScore,
      confidenceScore: Number(confidenceScore.toFixed(3)),
      voiceScore: Number(voiceScore.toFixed(3)),
      noveltyScore: Number(noveltyScore.toFixed(3)),
      predictedEngagementScore: Number(rewardPrediction.reward.toFixed(3)),
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
): RankedProtocolTweet[] {
  const selected: RankedProtocolTweet[] = [];
  const usedClusters = new Set<string>();

  for (const candidate of ranked) {
    const cluster = candidate.coverageCluster || buildCoverageCluster(candidate.content, candidate.targetTopic, candidate.featureTags?.thesis);
    const nearDuplicate = selected.some((item) =>
      isNearDuplicate(item.content, [candidate.content]).isDuplicate
      || ideaSimilarity(
        { content: item.content, thesis: item.featureTags.thesis, topic: item.targetTopic },
        { content: candidate.content, thesis: candidate.featureTags.thesis, topic: candidate.targetTopic },
      ) >= 0.5
    );
    if (nearDuplicate) continue;

    if (usedClusters.has(cluster) && selected.length < count - 1) {
      continue;
    }

    selected.push(candidate);
    usedClusters.add(cluster);
    if (selected.length === count) break;
  }

  return selected;
}
