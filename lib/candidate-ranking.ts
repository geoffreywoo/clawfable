import type { AgentLearnings, PersonalizationMemory, Tweet, AutonomyMode } from './types';
import type { VoiceProfile } from './soul-parser';
import type { ContentStyleConfig } from './viral-generator';
import { getLengthBucketFromText } from './bandit';
import { isNearDuplicate } from './survivability';

export interface RankableProtocolTweet {
  content: string;
  format: string;
  targetTopic: string;
  rationale: string;
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

function countRecentMatches(allTweets: Tweet[], key: 'topic' | 'format', value: string): number {
  return allTweets
    .filter((tweet) => ['draft', 'preview', 'queued', 'posted'].includes(tweet.status))
    .slice(0, 20)
    .filter((tweet) => normalizeTopic(key === 'topic' ? tweet.topic : tweet.format) === normalizeTopic(value))
    .length;
}

function scoreVoiceMatch(
  candidate: RankableProtocolTweet,
  voiceProfile: VoiceProfile,
  learnings: AgentLearnings | null,
): number {
  let score = 0.45;
  const normalizedTopic = normalizeTopic(candidate.targetTopic);
  const normalizedFormat = normalizeFormat(candidate.format);

  if (voiceProfile.topics.some((topic) => normalizeTopic(topic) === normalizedTopic)) {
    score += 0.18;
  }

  const topicRankIndex = learnings?.topicRankings.findIndex((entry) => normalizeTopic(entry.topic) === normalizedTopic) ?? -1;
  if (topicRankIndex >= 0) {
    score += 0.18 * scoreRankPosition(topicRankIndex, learnings?.topicRankings.length || 1);
  }

  const formatRankIndex = learnings?.formatRankings.findIndex((entry) => normalizeFormat(entry.format) === normalizedFormat) ?? -1;
  if (formatRankIndex >= 0) {
    score += 0.16 * scoreRankPosition(formatRankIndex, learnings?.formatRankings.length || 1);
  }

  if (voiceProfile.antiGoals.some((goal) => goal.length > 6 && candidate.content.toLowerCase().includes(goal.toLowerCase()))) {
    score -= 0.35;
  }

  return clamp(score);
}

function scoreNovelty(candidate: RankableProtocolTweet, recentPosts: string[], allTweets: Tweet[]): number {
  if (recentPosts.some((post) => isNearDuplicate(candidate.content, [post]).isDuplicate)) {
    return 0.05;
  }

  let score = 0.82;
  const topicMatches = countRecentMatches(allTweets, 'topic', candidate.targetTopic);
  const formatMatches = countRecentMatches(allTweets, 'format', candidate.format);
  score -= Math.min(topicMatches, 4) * 0.08;
  score -= Math.min(formatMatches, 4) * 0.05;
  return clamp(score);
}

function scorePredictedEngagement(candidate: RankableProtocolTweet, context: CandidateRankingContext): number {
  const normalizedTopic = normalizeTopic(candidate.targetTopic);
  const normalizedFormat = normalizeFormat(candidate.format);
  const lengthBucket = getLengthBucketFromText(candidate.content);
  const formatArm = context.style.banditPolicy?.formatArms.find((arm) => normalizeFormat(arm.arm) === normalizedFormat);
  const topicArm = context.style.banditPolicy?.topicArms.find((arm) => normalizeTopic(arm.arm) === normalizedTopic);
  const lengthArm = context.style.banditPolicy?.lengthArms.find((arm) => arm.arm === lengthBucket);

  const banditScore = (
    (formatArm?.meanReward ?? 0.5) * 0.45 +
    (topicArm?.meanReward ?? 0.5) * 0.35 +
    (lengthArm?.meanReward ?? 0.5) * 0.2
  );

  const topicRankIndex = context.learnings?.topicRankings.findIndex((entry) => normalizeTopic(entry.topic) === normalizedTopic) ?? -1;
  const formatRankIndex = context.learnings?.formatRankings.findIndex((entry) => normalizeFormat(entry.format) === normalizedFormat) ?? -1;
  const rankingBoost = (
    scoreRankPosition(topicRankIndex, context.learnings?.topicRankings.length || 1) * 0.12 +
    scoreRankPosition(formatRankIndex, context.learnings?.formatRankings.length || 1) * 0.12
  );

  return clamp(banditScore + rankingBoost);
}

function scoreFreshness(candidate: RankableProtocolTweet, context: CandidateRankingContext): number {
  let score = 0.35;
  const normalizedTopic = normalizeTopic(candidate.targetTopic);
  const normalizedFormat = normalizeFormat(candidate.format);

  if (context.memory.topicsWithMomentum.some((topic) => normalizeTopic(topic) === normalizedTopic)) {
    score += 0.28;
  }
  if (context.style.exploration.underusedTopics.some((topic) => normalizeTopic(topic) === normalizedTopic)) {
    score += 0.2;
  }
  if (context.style.exploration.underusedFormats.some((format) => normalizeFormat(format) === normalizedFormat)) {
    score += 0.16;
  }
  if (context.style.bias.momentumTopic && normalizeTopic(context.style.bias.momentumTopic) === normalizedTopic) {
    score += 0.18;
  }
  if (context.style.bias.scheduledTopic && normalizeTopic(context.style.bias.scheduledTopic) === normalizedTopic) {
    score += 0.1;
  }

  const topicMatches = countRecentMatches(context.allTweets, 'topic', candidate.targetTopic);
  score -= Math.min(topicMatches, 3) * 0.08;
  return clamp(score);
}

function scorePolicyRisk(candidate: RankableProtocolTweet): number {
  let risk = 0.12;
  const text = candidate.content;
  const lowercase = text.toLowerCase();

  if (/https?:\/\//.test(text) || /(?:x|twitter)\.com\//i.test(text)) risk += 0.3;
  if (/#\w+/.test(text)) risk += 0.18;
  if ((text.match(/!/g) || []).length >= 2) risk += 0.08;
  if ((text.match(/\b[A-Z]{4,}\b/g) || []).length >= 2) risk += 0.12;
  if (/^(i think|here'?s|the thing is|in my opinion)/i.test(text)) risk += 0.18;
  if (/(sign up|buy now|subscribe|dm me|join now)/i.test(lowercase)) risk += 0.18;
  if (text.length < 25 || text.length > 3500) risk += 0.12;

  return clamp(risk);
}

function scoreRepetitionRisk(candidate: RankableProtocolTweet, context: CandidateRankingContext): number {
  let risk = context.recentPosts.some((post) => isNearDuplicate(candidate.content, [post]).isDuplicate) ? 0.75 : 0.18;
  const topicMatches = countRecentMatches(context.allTweets, 'topic', candidate.targetTopic);
  const formatMatches = countRecentMatches(context.allTweets, 'format', candidate.format);
  risk += Math.min(topicMatches, 4) * 0.08;
  risk += Math.min(formatMatches, 4) * 0.05;
  return clamp(risk);
}

function inferGenerationMode(
  candidate: RankableProtocolTweet,
  context: CandidateRankingContext,
  confidence: number,
  policyRisk: number,
): AutonomyMode {
  const normalizedTopic = normalizeTopic(candidate.targetTopic);
  const normalizedFormat = normalizeFormat(candidate.format);
  const isExplorationBet =
    context.style.exploration.underusedTopics.some((topic) => normalizeTopic(topic) === normalizedTopic) ||
    context.style.exploration.underusedFormats.some((format) => normalizeFormat(format) === normalizedFormat) ||
    Boolean(context.style.banditPolicy?.formatArms.find((arm) => normalizeFormat(arm.arm) === normalizedFormat)?.coldStart) ||
    Boolean(context.style.banditPolicy?.topicArms.find((arm) => normalizeTopic(arm.arm) === normalizedTopic)?.coldStart);

  if (isExplorationBet) return 'explore';
  if (confidence >= 0.72 && policyRisk <= 0.22) return 'safe';
  return 'balanced';
}

export function getAutonomyConfidenceThreshold(mode: AutonomyMode): number {
  if (mode === 'safe') return 0.68;
  if (mode === 'explore') return 0.42;
  return 0.56;
}

export function rankGeneratedTweets(
  candidates: RankableProtocolTweet[],
  context: CandidateRankingContext,
): RankedProtocolTweet[] {
  const ranked = candidates.map((candidate) => {
    const voiceScore = scoreVoiceMatch(candidate, context.voiceProfile, context.learnings);
    const noveltyScore = scoreNovelty(candidate, context.recentPosts, context.allTweets);
    const predictedEngagementScore = scorePredictedEngagement(candidate, context);
    const freshnessScore = scoreFreshness(candidate, context);
    const repetitionRiskScore = scoreRepetitionRisk(candidate, context);
    const policyRiskScore = scorePolicyRisk(candidate);

    let confidenceScore = clamp(
      voiceScore * 0.27 +
      noveltyScore * 0.18 +
      predictedEngagementScore * 0.24 +
      freshnessScore * 0.15 +
      (1 - repetitionRiskScore) * 0.1 +
      (1 - policyRiskScore) * 0.06
    );

    if (context.style.autonomyMode === 'safe') {
      confidenceScore = clamp(confidenceScore + ((1 - policyRiskScore) * 0.08) - (repetitionRiskScore * 0.05));
    } else if (context.style.autonomyMode === 'explore') {
      confidenceScore = clamp(confidenceScore + (freshnessScore * 0.06) - (policyRiskScore * 0.03));
    }

    const generationMode = inferGenerationMode(candidate, context, confidenceScore, policyRiskScore);
    const candidateScore = Math.round(clamp(
      voiceScore * 0.24 +
      noveltyScore * 0.18 +
      predictedEngagementScore * 0.22 +
      freshnessScore * 0.14 +
      (1 - repetitionRiskScore) * 0.12 +
      (1 - policyRiskScore) * 0.1
    ) * 100);

    return {
      ...candidate,
      generationMode,
      candidateScore,
      confidenceScore: Number(confidenceScore.toFixed(3)),
      voiceScore: Number(voiceScore.toFixed(3)),
      noveltyScore: Number(noveltyScore.toFixed(3)),
      predictedEngagementScore: Number(predictedEngagementScore.toFixed(3)),
      freshnessScore: Number(freshnessScore.toFixed(3)),
      repetitionRiskScore: Number(repetitionRiskScore.toFixed(3)),
      policyRiskScore: Number(policyRiskScore.toFixed(3)),
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
  const usedCombos = new Set<string>();

  for (const candidate of ranked) {
    const combo = `${normalizeFormat(candidate.format)}::${normalizeTopic(candidate.targetTopic)}`;
    const nearDuplicate = selected.some((item) => isNearDuplicate(item.content, [candidate.content]).isDuplicate);
    if (nearDuplicate) continue;

    if (usedCombos.has(combo) && selected.length < count - 1) {
      continue;
    }

    selected.push(candidate);
    usedCombos.add(combo);
    if (selected.length === count) break;
  }

  if (selected.length < count) {
    for (const candidate of ranked) {
      if (selected.some((item) => item.content === candidate.content)) continue;
      selected.push(candidate);
      if (selected.length === count) break;
    }
  }

  return selected;
}
