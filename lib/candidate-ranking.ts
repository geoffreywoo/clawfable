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
  IdeaAtom,
  MediaExperimentType,
  PersonalizationMemory,
  PostPortfolioRole,
  PromptStrategy,
  Tweet,
  TweetPerformance,
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
  scoreConversationValue,
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
  ideaAtoms?: IdeaAtom[];
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function clampSigned(value: number, min = -1, max = 1): number {
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

function weightedEngagement(entry: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies'>): number {
  return entry.likes + (entry.retweets * 2) + (entry.replies * 1.5);
}

function scorePerformanceAnchorQuality(entry: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies'>): number {
  return clamp(0.42 + Math.min(0.42, weightedEngagement(entry) / 180));
}

function featureAnchorMatch(
  featureTags: CandidateFeatureTags,
  entry: Pick<TweetPerformance, 'hook' | 'tone' | 'specificity' | 'structure'>,
): number {
  let score = 0;
  if (entry.hook && String(entry.hook).toLowerCase() === featureTags.hook.toLowerCase()) score += 0.3;
  if (entry.tone && String(entry.tone).toLowerCase() === featureTags.tone.toLowerCase()) score += 0.24;
  if (entry.specificity && String(entry.specificity).toLowerCase() === featureTags.specificity.toLowerCase()) score += 0.24;
  if (entry.structure && String(entry.structure).toLowerCase() === featureTags.structure.toLowerCase()) score += 0.22;
  return clamp(score);
}

function scoreOperatorAnchorFit(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  context: CandidateRankingContext,
): number {
  const positiveAnchors = getPositiveOperatorAnchors(context);
  const negativeAnchors = context.learnings?.worstPerformers || [];

  if (positiveAnchors.length === 0 && negativeAnchors.length === 0) return 0;

  let strongestBoost = 0;
  for (const anchor of positiveAnchors.slice(0, 12)) {
    const similarity = ideaSimilarity(
      { content: candidate.content, thesis: featureTags.thesis, topic: candidate.targetTopic },
      { content: anchor.content, thesis: anchor.thesis, topic: anchor.topic },
    );
    const featureMatch = featureAnchorMatch(featureTags, anchor);
    const topicMatch = normalizeTopic(anchor.topic) === normalizeTopic(candidate.targetTopic) ? 1 : 0;
    const anchorFit = clamp((similarity * 0.58) + (featureMatch * 0.28) + (topicMatch * 0.14));
    if (anchorFit < 0.28) continue;

    const quality = scorePerformanceAnchorQuality(anchor);
    strongestBoost = Math.max(strongestBoost, anchorFit * (0.08 + quality * 0.16));
  }

  let strongestPenalty = 0;
  for (const anchor of negativeAnchors.slice(0, 10)) {
    const similarity = ideaSimilarity(
      { content: candidate.content, thesis: featureTags.thesis, topic: candidate.targetTopic },
      { content: anchor.content, thesis: anchor.thesis, topic: anchor.topic },
    );
    const featureMatch = featureAnchorMatch(featureTags, anchor);
    const topicMatch = normalizeTopic(anchor.topic) === normalizeTopic(candidate.targetTopic) ? 1 : 0;
    const anchorFit = clamp((similarity * 0.66) + (featureMatch * 0.22) + (topicMatch * 0.12));
    if (anchorFit < 0.34) continue;

    strongestPenalty = Math.max(strongestPenalty, anchorFit * 0.2);
  }

  return clampSigned(strongestBoost - strongestPenalty, -0.22, 0.22);
}

function getPositiveOperatorAnchors(context: CandidateRankingContext): TweetPerformance[] {
  const operatorReference = context.learnings?.operatorVoiceReference;
  return [
    ...(operatorReference?.pinnedExamples || []),
    ...(operatorReference?.bestPerformers || []),
    ...(!operatorReference?.bestPerformers?.length && !operatorReference?.pinnedExamples?.length
      ? (context.learnings?.bestPerformers || [])
      : []),
  ];
}

function scoreOperatorAnchorCopyRisk(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  context: CandidateRankingContext,
): number {
  const positiveAnchors = getPositiveOperatorAnchors(context);
  if (positiveAnchors.length === 0) return 0;

  let strongestRisk = 0;
  for (const anchor of positiveAnchors.slice(0, 12)) {
    const duplicate = isNearDuplicate(candidate.content, [anchor.content], 0.82);
    if (!duplicate.isDuplicate) continue;

    const thesisSimilarity = ideaSimilarity(
      { content: candidate.content, thesis: featureTags.thesis, topic: candidate.targetTopic },
      { content: anchor.content, thesis: anchor.thesis, topic: anchor.topic },
    );
    const similarity = duplicate.similarity || 0.82;
    const sameTopic = normalizeTopic(anchor.topic) === normalizeTopic(candidate.targetTopic);
    const risk = clamp(
      0.46 +
      ((similarity - 0.82) * 1.35) +
      (thesisSimilarity >= 0.7 ? 0.14 : 0) +
      (sameTopic ? 0.08 : 0),
    );
    strongestRisk = Math.max(strongestRisk, risk);
  }

  return strongestRisk;
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

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function hasNumericSpecificity(text: string): boolean {
  return /\b\d+([.,]\d+)?\s?(%|x|k|m|b)?\b|\$\d/i.test(text);
}

const PHRASE_REUSE_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'because',
  'before',
  'being',
  'between',
  'every',
  'from',
  'have',
  'into',
  'just',
  'more',
  'most',
  'over',
  'that',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'when',
  'where',
  'which',
  'while',
  'with',
  'without',
  'your',
]);

function normalizePhraseWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][a-z0-9_]+/g, ' ')
    .match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
}

function isDistinctivePhraseWindow(words: string[]): boolean {
  const distinctive = words.filter((word) =>
    /\d/.test(word) ||
    (word.length >= 5 && !PHRASE_REUSE_STOPWORDS.has(word))
  );
  return distinctive.length >= 2;
}

function buildDistinctivePhrases(text: string): Map<string, number> {
  const words = normalizePhraseWords(text);
  const phrases = new Map<string, number>();

  for (const size of [7, 6, 5]) {
    if (words.length < size) continue;
    for (let index = 0; index <= words.length - size; index++) {
      const window = words.slice(index, index + size);
      if (!isDistinctivePhraseWindow(window)) continue;
      phrases.set(window.join(' '), size);
    }
  }

  return phrases;
}

function scorePhraseReuseRisk(candidate: RankableProtocolTweet, context: CandidateRankingContext): number {
  const candidatePhrases = buildDistinctivePhrases(candidate.content);
  if (candidatePhrases.size === 0) return 0;

  const sourceTexts = [
    ...context.recentPosts,
    ...context.allTweets
      .filter((tweet) => ['draft', 'preview', 'queued', 'posted'].includes(tweet.status))
      .slice(0, 40)
      .map((tweet) => tweet.content),
  ].filter((text) => text.trim() && text.trim() !== candidate.content.trim());

  let strongestRisk = 0;

  for (const sourceText of sourceTexts) {
    const sourcePhrases = buildDistinctivePhrases(sourceText);
    if (sourcePhrases.size === 0) continue;

    let matched = 0;
    let sourceRisk = 0;
    for (const [phrase, size] of candidatePhrases) {
      if (!sourcePhrases.has(phrase)) continue;
      matched += 1;
      sourceRisk = Math.max(sourceRisk, size === 7 ? 0.62 : size === 6 ? 0.5 : 0.36);
    }

    if (matched >= 2) sourceRisk += 0.1;
    if (matched >= 4) sourceRisk += 0.08;
    strongestRisk = Math.max(strongestRisk, sourceRisk);
  }

  return clamp(strongestRisk);
}

function extractQuotedMemoryPhrases(items: string[]): string[] {
  const phrases: string[] = [];
  for (const item of items) {
    for (const match of item.matchAll(/["']([^"']{4,80})["']/g)) {
      phrases.push(match[1].trim().toLowerCase());
    }
  }
  return phrases;
}

function scoreMemoryAlignment(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  context: CandidateRankingContext,
): number {
  const text = candidate.content.toLowerCase();
  const avoidItems = [
    ...(context.memory.neverDoThisAgain || []),
    ...(context.memory.identityConstraints || []),
    ...context.voiceProfile.antiGoals.map((goal) => `Never: ${goal}`),
  ];
  const reinforceItems = [
    ...(context.memory.alwaysDoMoreOfThis || []),
    ...(context.memory.operatorHiddenPreferences || []),
    ...(context.memory.editTransformations || []),
    ...(context.memory.weeklyChanges || []),
  ];
  const avoid = avoidItems.join(' ').toLowerCase();
  const reinforce = reinforceItems.join(' ').toLowerCase();

  let penalty = 0;
  let boost = 0;

  if (
    hasAnyTerm(avoid, ['generic', 'vague', 'abstract', 'surface-level', 'surface level', 'thin'])
    && (featureTags.specificity === 'abstract' || featureTags.riskFlags.includes('thin') || candidate.content.length < 70)
  ) {
    penalty += 0.22;
  }

  if (
    hasAnyTerm(avoid, ['hype', 'overhype', 'buzzword', 'salesy', 'promotional', 'promo'])
    && (featureTags.riskFlags.includes('salesy') || /\b(revolutionary|game changer|unlock|10x|viral|crushing it)\b/i.test(candidate.content))
  ) {
    penalty += 0.2;
  }

  if (
    hasAnyTerm(avoid, ['cringe', 'performative', 'try-hard', 'try hard', 'clickbait', 'engagement bait', 'shouty'])
    && (
      featureTags.riskFlags.includes('shouty_caps')
      || featureTags.riskFlags.includes('overexcited')
      || scoreReplyPotential(candidate.content, featureTags) > 0.78
    )
  ) {
    penalty += 0.18;
  }

  if (
    hasAnyTerm(avoid, ['link', 'hashtag', 'cta', 'call to action', 'sell', 'subscribe', 'dm me'])
    && (
      featureTags.riskFlags.includes('link')
      || featureTags.riskFlags.includes('hashtag')
      || featureTags.riskFlags.includes('salesy')
    )
  ) {
    penalty += 0.18;
  }

  if (hasAnyTerm(avoid, ['no question', 'avoid question', 'question hooks']) && featureTags.hook === 'question') {
    penalty += 0.14;
  }

  if (hasAnyTerm(avoid, ['no thread', 'avoid thread', 'listicle', 'numbered list']) && featureTags.structure === 'list') {
    penalty += 0.12;
  }

  for (const phrase of extractQuotedMemoryPhrases(avoidItems)) {
    if (text.includes(phrase)) penalty += 0.2;
  }

  if (
    hasAnyTerm(reinforce, ['specific', 'specificity', 'numbers', 'data', 'evidence', 'example', 'concrete'])
    && (
      ['concrete', 'data_driven', 'tactical', 'story_led'].includes(featureTags.specificity)
      || hasNumericSpecificity(candidate.content)
    )
  ) {
    boost += 0.08;
  }

  if (hasAnyTerm(reinforce, ['tighten', 'shorter', 'concise']) && candidate.content.length <= 240) {
    boost += 0.05;
  }

  if (hasAnyTerm(reinforce, ['deeper', 'longer', 'developed argument']) && candidate.content.length >= 180) {
    boost += 0.05;
  }

  if (hasAnyTerm(reinforce, ['question-led', 'question led', 'question hook']) && featureTags.hook === 'question') {
    boost += 0.07;
  }

  if (hasAnyTerm(reinforce, ['line-break', 'line break', 'structure', 'readability']) && candidate.content.includes('\n')) {
    boost += 0.05;
  }

  if (hasAnyTerm(reinforce, ['contrarian']) && featureTags.hook === 'contrarian') boost += 0.04;
  if (hasAnyTerm(reinforce, ['story']) && featureTags.structure === 'story_arc') boost += 0.04;
  if (hasAnyTerm(reinforce, ['comparison']) && featureTags.structure === 'comparison') boost += 0.04;
  if (hasAnyTerm(reinforce, ['tactical']) && featureTags.specificity === 'tactical') boost += 0.04;

  return clampSigned(boost - penalty, -0.45, 0.25);
}

function scoreIdeaGraphFit(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  context: CandidateRankingContext,
): number {
  const atoms = context.ideaAtoms || [];
  if (atoms.length === 0) return 0;

  const candidateIdea = {
    content: candidate.content,
    thesis: featureTags.thesis,
    topic: candidate.targetTopic,
  };
  const candidateText = candidate.content.toLowerCase();
  let strongestBoost = 0;
  let strongestPenalty = 0;
  const now = Date.now();

  for (const atom of atoms.slice(0, 40)) {
    const similarity = ideaSimilarity(candidateIdea, {
      content: atom.example || atom.claim,
      thesis: atom.claim,
      topic: atom.topic,
    });
    if (similarity < 0.34) continue;

    const generated = Math.max(atom.performance.generated || 0, 1);
    const queuedRate = (atom.performance.queued || 0) / generated;
    const postedRate = (atom.performance.posted || 0) / generated;
    const rejectionRate = (atom.performance.rejected || 0) / generated;
    const avgReward = clampSigned(atom.performance.avgReward || 0);
    const lastUsedAt = atom.lastUsedAt || atom.updatedAt || atom.createdAt;
    const lastUsedMs = lastUsedAt ? new Date(lastUsedAt).getTime() : Number.NaN;
    const daysSinceUse = Number.isFinite(lastUsedMs)
      ? Math.max(0, (now - lastUsedMs) / (24 * 60 * 60 * 1000))
      : 999;
    const recentReusePressure = clamp((10 - Math.min(daysSinceUse, 10)) / 10);
    const saturationPressure = clamp((generated - Math.max(3, atom.performance.posted || 0)) / 12);
    const provenStrength = clamp((postedRate * 0.42) + (queuedRate * 0.22) + (Math.max(0, avgReward) * 0.36));
    const rejectionStrength = clamp((rejectionRate * 0.58) + (Math.max(0, -avgReward) * 0.32));
    const overusedWithoutProof = generated >= 4 && (atom.performance.posted || 0) <= 1
      ? clamp((generated - Math.max(atom.performance.posted || 0, atom.performance.queued || 0)) / generated)
      : 0;
    const staleUnproven = daysSinceUse >= 60 && (atom.performance.posted || 0) === 0 && avgReward <= 0
      ? clamp((daysSinceUse - 45) / 90)
      : 0;

    let boost = similarity * (0.04 + (provenStrength * 0.16));
    let penalty = similarity * (
      (rejectionStrength * 0.24) +
      (overusedWithoutProof * 0.1) +
      (recentReusePressure * saturationPressure * 0.34) +
      (staleUnproven * 0.16)
    );

    const normalizedClaim = atom.claim.toLowerCase();
    if (normalizedClaim.length >= 24 && candidateText.includes(normalizedClaim)) {
      penalty += 0.12;
    }
    if (atom.riskNote && similarity >= 0.52) {
      penalty += 0.04;
    }

    strongestBoost = Math.max(strongestBoost, boost);
    strongestPenalty = Math.max(strongestPenalty, penalty);
  }

  return clampSigned(strongestBoost - strongestPenalty, -0.28, 0.2);
}

function readTweetScore(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value) : null;
}

function getPredictedOutcome(tweet: Tweet): number | null {
  return readTweetScore(tweet.predictedEngagementScore)
    ?? readTweetScore(tweet.rewardPrediction)
    ?? readTweetScore(tweet.confidenceScore)
    ?? (typeof tweet.candidateScore === 'number' ? clamp(tweet.candidateScore / 100) : null);
}

function getObservedOutcome(tweet: Tweet): number | null {
  if (typeof tweet.rewardBreakdown?.total === 'number' && Number.isFinite(tweet.rewardBreakdown.total)) {
    return clamp((tweet.rewardBreakdown.total + 1) / 2);
  }

  if (tweet.status === 'deleted_from_x') return 0.08;
  if (tweet.status === 'posted') return null;
  return null;
}

function scoreOutcomeCalibration(
  candidate: RankableProtocolTweet,
  featureTags: CandidateFeatureTags,
  coverageCluster: string,
  context: CandidateRankingContext,
): number {
  let weightedError = 0;
  let evidenceWeight = 0;

  for (const tweet of context.allTweets.slice(0, 80)) {
    const observed = getObservedOutcome(tweet);
    const predicted = getPredictedOutcome(tweet);
    if (observed === null || predicted === null) continue;

    const tweetFeatureTags = tweet.featureTags || (
      tweet.hookType && tweet.toneType && tweet.specificityType && tweet.structureType
        ? {
            hook: tweet.hookType,
            tone: tweet.toneType,
            specificity: tweet.specificityType,
            structure: tweet.structureType,
            thesis: tweet.thesis || buildCoverageCluster(tweet.content, tweet.topic).split(':').slice(1).join(':'),
            riskFlags: [],
          }
        : extractCandidateFeatureTags(tweet.content, { topic: tweet.topic, thesisHint: tweet.thesis })
    );
    const tweetCluster = tweet.coverageCluster || buildCoverageCluster(tweet.content, tweet.topic, tweetFeatureTags.thesis);
    const similarity = ideaSimilarity(
      { content: candidate.content, thesis: featureTags.thesis, topic: candidate.targetTopic },
      { content: tweet.content, thesis: tweetFeatureTags.thesis, topic: tweet.topic },
    );

    let weight = 0;
    const semanticMatch = tweetCluster.toLowerCase() === coverageCluster.toLowerCase() || similarity >= 0.24;

    if (tweetCluster.toLowerCase() === coverageCluster.toLowerCase()) weight += 0.64;
    if (similarity >= 0.24) weight += similarity * 0.42;
    if (normalizeTopic(tweet.topic) === normalizeTopic(candidate.targetTopic)) weight += 0.16;
    if (normalizeFormat(tweet.format) === normalizeFormat(candidate.format)) weight += 0.12;
    if (String(tweetFeatureTags.hook).toLowerCase() === featureTags.hook.toLowerCase()) weight += 0.07;
    if (String(tweetFeatureTags.tone).toLowerCase() === featureTags.tone.toLowerCase()) weight += 0.05;
    if (String(tweetFeatureTags.specificity).toLowerCase() === featureTags.specificity.toLowerCase()) weight += 0.06;
    if (String(tweetFeatureTags.structure).toLowerCase() === featureTags.structure.toLowerCase()) weight += 0.06;
    if (tweet.status === 'deleted_from_x') weight += 0.1;
    if (!semanticMatch) weight *= 0.45;

    if (weight < 0.34) continue;
    const error = clampSigned(observed - predicted);
    weightedError += error * Math.min(weight, 1.35);
    evidenceWeight += Math.min(weight, 1.35);
  }

  if (evidenceWeight < 0.8) return 0;
  return clampSigned((weightedError / evidenceWeight) * 0.72, -0.28, 0.2);
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

function inferHistoricalPortfolioRole(tweet: Tweet): PostPortfolioRole {
  return normalizePortfolioRole(tweet.portfolioRole || inferPortfolioRole({
    content: tweet.content,
    format: tweet.format,
    creativeLane: tweet.creativeLane,
    sourceLane: tweet.sourceLane,
    mediaExperimentType: normalizeMediaExperimentType(tweet.mediaExperimentType),
  }));
}

function scorePortfolioDiversity(
  role: PostPortfolioRole,
  context: CandidateRankingContext,
): number {
  const recentRoles = context.allTweets
    .filter((tweet) => ['draft', 'preview', 'queued', 'posted'].includes(tweet.status))
    .slice(0, 24)
    .map(inferHistoricalPortfolioRole);

  if (recentRoles.length < 3) return 0;

  const roleCount = recentRoles.filter((recentRole) => recentRole === role).length;
  const roleShare = roleCount / recentRoles.length;
  let score = 0;

  if (roleCount === 0) score += 0.08;
  if (roleCount === 1 && recentRoles.length >= 8) score += 0.04;
  if (roleShare >= 0.5) score -= 0.18;
  else if (roleShare >= 0.38) score -= 0.1;
  if (roleCount >= 5) score -= 0.08;

  if (role === 'relationship' && context.style.relationshipQueueEnabled === false) score -= 0.12;
  if (role === 'media' && (context.style.mediaExperimentRate ?? 15) <= 0) score -= 0.1;

  return clampSigned(score, -0.26, 0.12);
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
  conversationQuality,
  slopScore,
  audienceScore,
  creativeRiskScore,
}: {
  rewardPrediction: number;
  replyPotential: number;
  conversationQuality: number;
  slopScore: number;
  audienceScore: number;
  creativeRiskScore: number;
}): ActionRewardBreakdown {
  const likeReward = clamp((rewardPrediction * 0.24) + (audienceScore * 0.08), 0, 0.42);
  const repostReward = clamp((rewardPrediction * 0.18) + ((1 - slopScore) * 0.06), 0, 0.36);
  const qualityAdjustedReplyPotential = replyPotential * conversationQuality;
  const replyReward = clamp(qualityAdjustedReplyPotential * 0.28, 0, 0.32);
  const impressionReward = clamp((rewardPrediction * 0.12) + (qualityAdjustedReplyPotential * 0.08), 0, 0.28);
  const engagementRateReward = clamp((rewardPrediction * 0.12) + ((1 - slopScore) * 0.05), 0, 0.25);
  const baitRisk = replyPotential > 0.55 ? (1 - conversationQuality) * 0.12 : 0;
  const negativeFeedbackRisk = clamp((slopScore * 0.16) + (creativeRiskScore * 0.12) + baitRisk, 0, 0.28);
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

function scoreJudgeBreakdown(breakdown: CandidateJudgeBreakdown): number {
  const weighted = (
    breakdown.voiceFit * 0.28 +
    breakdown.clarity * 0.18 +
    breakdown.novelty * 0.18 +
    breakdown.audienceFit * 0.2 +
    breakdown.policySafety * 0.16
  );
  const weakDimensionPenalty = (
    Math.max(0, 0.58 - breakdown.voiceFit) * 0.36 +
    Math.max(0, 0.56 - breakdown.clarity) * 0.24 +
    Math.max(0, 0.5 - breakdown.novelty) * 0.18 +
    Math.max(0, 0.56 - breakdown.audienceFit) * 0.22 +
    Math.max(0, 0.72 - breakdown.policySafety) * 0.32
  );

  return clamp(weighted - weakDimensionPenalty);
}

function scoreJudge(candidate: RankableProtocolTweet): number {
  if (candidate.judgeBreakdown) {
    const breakdownScore = scoreJudgeBreakdown(candidate.judgeBreakdown);
    if (typeof candidate.judgeScore === 'number') {
      return clamp(Math.min(candidate.judgeScore, breakdownScore + 0.04));
    }
    return breakdownScore;
  }
  if (typeof candidate.judgeScore === 'number') return clamp(candidate.judgeScore);
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
    const portfolioDiversityScore = scorePortfolioDiversity(portfolioRole, context);
    const mediaExperimentScore = scoreMediaExperimentPerformance(mediaExperimentType, portfolioRole, context, featureTags);
    const relationshipScore = scoreRelationshipTarget(relationshipTargetHandle, portfolioRole, context);
    const judgeScore = scoreJudge(candidate);
    const repetitionRiskScore = scoreRepetitionRisk(candidate, featureTags, context);
    const policyRiskScore = scorePolicyRisk(candidate, featureTags);
    const slopScore = scoreSlopRisk(candidate.content, featureTags);
    const replyBaitScore = scoreReplyPotential(candidate.content, featureTags);
    const conversationQualityScore = scoreConversationValue(candidate.content, featureTags);
    const surpriseScore = scoreSurprise(candidate, featureTags, context, noveltyScore, repetitionRiskScore);
    const creativeRiskScore = scoreCreativeRisk(candidate, featureTags, voiceScore, policyRiskScore, surpriseScore, repetitionRiskScore);
    const styleMode = normalizeContentStyleMode(candidate.styleMode);
    const styleModeScore = scoreStyleMode(candidate, featureTags, policyRiskScore);
    const styleModeAdjustment = getStyleModePerformanceAdjustment(styleMode, context);
    const viralTakeScore = scoreViralTakePotential(candidate, featureTags, policyRiskScore);
    const authorityProofIssue = getAuthorityProofIssue(candidate.content);
    const authorityProofPenalty = authorityProofIssue ? 0.36 : 0;
    const memoryAlignmentScore = scoreMemoryAlignment(candidate, featureTags, context);
    const ideaGraphScore = scoreIdeaGraphFit(candidate, featureTags, context);
    const outcomeCalibrationScore = scoreOutcomeCalibration(candidate, featureTags, coverageCluster, context);
    const operatorAnchorScore = scoreOperatorAnchorFit(candidate, featureTags, context);
    const anchorCopyRiskScore = scoreOperatorAnchorCopyRisk(candidate, featureTags, context);
    const phraseReuseRiskScore = scorePhraseReuseRisk(candidate, context);
    const holdoutScore = candidate.experimentHoldout ? clamp((surpriseScore * 0.7) + ((1 - creativeRiskScore) * 0.3)) : 0;
    const riskPenalty = clamp(
      (policyRiskScore * 0.44) +
      (repetitionRiskScore * 0.24) +
      (creativeRiskScore * 0.18) +
      (slopScore * 0.14) +
      authorityProofPenalty +
      (memoryAlignmentScore < 0 ? Math.abs(memoryAlignmentScore) * 0.28 : 0) +
      (ideaGraphScore < 0 ? Math.abs(ideaGraphScore) * 0.2 : 0) +
      (outcomeCalibrationScore < 0 ? Math.abs(outcomeCalibrationScore) * 0.22 : 0) +
      (operatorAnchorScore < 0 ? Math.abs(operatorAnchorScore) * 0.18 : 0) +
      (portfolioDiversityScore < 0 ? Math.abs(portfolioDiversityScore) * 0.18 : 0) +
      (anchorCopyRiskScore * 0.32) +
      (phraseReuseRiskScore * 0.24) +
      (replyBaitScore > 0.55 ? (1 - conversationQualityScore) * 0.16 : 0)
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
      portfolioDiversity: Number((portfolioDiversityScore * 0.12).toFixed(3)),
      mediaExperiment: Number((mediaExperimentScore * 0.03).toFixed(3)),
      relationship: Number((relationshipScore * 0.025).toFixed(3)),
      ideaGraph: Number((ideaGraphScore * 0.1).toFixed(3)),
      memoryAlignment: Number((memoryAlignmentScore * 0.16).toFixed(3)),
      outcomeCalibration: Number((outcomeCalibrationScore * 0.14).toFixed(3)),
      conversationQuality: Number(((conversationQualityScore - 0.5) * 0.08).toFixed(3)),
      operatorAnchor: Number((operatorAnchorScore * 0.14).toFixed(3)),
      anchorCopyRisk: Number((-anchorCopyRiskScore * 0.12).toFixed(3)),
      phraseReuseRisk: Number((-phraseReuseRiskScore * 0.1).toFixed(3)),
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
      portfolioDiversityScore * 0.22 +
      mediaExperimentScore * 0.025 +
      relationshipScore * 0.025 +
      judgeScore * 0.2 +
      viralTakeScore * 0.1 +
      (replyBaitScore * conversationQualityScore) * 0.06 +
      (conversationQualityScore - 0.5) * 0.06 +
      (1 - repetitionRiskScore) * 0.08 +
      (1 - policyRiskScore) * 0.08 +
      (1 - slopScore) * 0.08 +
      (styleMode === SHITPOAST_STYLE_MODE ? styleModeScore * 0.05 : 0) +
      ideaGraphScore * 0.1 +
      memoryAlignmentScore * 0.16 +
      outcomeCalibrationScore * 0.18 +
      operatorAnchorScore * 0.16 +
      (-anchorCopyRiskScore * 0.22) +
      (-phraseReuseRiskScore * 0.18) +
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
      (scoreProvenance.portfolioDiversity || 0) +
      (scoreProvenance.mediaExperiment || 0) +
      (scoreProvenance.relationship || 0) +
      (scoreProvenance.ideaGraph || 0) +
      (scoreProvenance.memoryAlignment || 0) +
      (scoreProvenance.outcomeCalibration || 0) +
      (scoreProvenance.conversationQuality || 0) +
      (scoreProvenance.operatorAnchor || 0) +
      (scoreProvenance.anchorCopyRisk || 0) +
      (scoreProvenance.phraseReuseRisk || 0) +
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
      conversationQuality: conversationQualityScore,
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
  const selectedRoles = new Map<PostPortfolioRole, number>();
  const maxShitpoast = options.maxShitpoast ?? Number.POSITIVE_INFINITY;
  const minHoldouts = options.minHoldouts ?? (count >= 4 ? 1 : 0);
  const maxSamePortfolioRole = Math.max(1, Math.ceil(count * 0.5));
  let shitpoastSelected = 0;

  const canSelect = (candidate: RankedProtocolTweet, enforcePortfolioDiversity = false) => {
    if (candidate.styleMode === SHITPOAST_STYLE_MODE && shitpoastSelected >= maxShitpoast) return false;
    if (
      enforcePortfolioDiversity &&
      selected.length < count - 1 &&
      (selectedRoles.get(candidate.portfolioRole) || 0) >= maxSamePortfolioRole
    ) {
      return false;
    }
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
    selectedRoles.set(candidate.portfolioRole, (selectedRoles.get(candidate.portfolioRole) || 0) + 1);
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
    if (!canSelect(candidate, true)) continue;
    addCandidate(candidate);
  }

  for (const candidate of ranked) {
    if (selected.includes(candidate)) continue;
    if (!canSelect(candidate, true)) continue;
    addCandidate(candidate);
    if (selected.length === count) break;
  }

  for (const candidate of ranked) {
    if (selected.length === count) break;
    if (selected.includes(candidate)) continue;
    if (!canSelect(candidate)) continue;
    addCandidate(candidate);
    if (selected.length === count) break;
  }

  return selected;
}
