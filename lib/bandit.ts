import type {
  ContentStyleMode,
  ContentSourceLane,
  FeedbackEntry,
  LearningSignal,
  LearningSignalType,
  OutcomeEpisode,
  Tweet,
  TweetPerformance,
  TweetHookType,
  TweetSpecificityType,
  TweetStructureType,
  TweetToneType,
} from './types';
import type { SourcePlannerPlan } from './source-planner';
import { buildOutcomeEpisodes, computePerformanceLiftReward } from './outcome-rewards';
import { extractCandidateFeatureTags, extractStructureType } from './tweet-features';
import { buildShitpoastSlotSet, SHITPOAST_STYLE_MODE, STANDARD_STYLE_MODE } from './style-mode';
import { collapsePerformanceSnapshotsWithStats } from './performance-history';
import { assessHistoricalWinner, historicalPerformanceEvidenceWeight } from './winner-learning';

export type BanditLengthBucket = 'short' | 'medium' | 'long';
export type BanditTrainingSource = 'autopilot' | 'mixed';
export type BanditArmFamily = 'format' | 'topic' | 'length' | 'hook' | 'tone' | 'specificity' | 'structure';

export interface BanditPriorArm {
  arm: string;
  pulls: number;
  rewardSum: number;
  failures: number;
  meanReward: number;
}

export interface BanditGlobalPrior {
  updatedAt: string;
  sourceAccounts: number;
  totalSamples: number;
  families: Record<BanditArmFamily, BanditPriorArm[]>;
}

export interface BanditArmScore {
  arm: string;
  family: BanditArmFamily;
  pulls: number;
  localPulls: number;
  /** Weighted pulls backed by measured X performance (final-stage episodes or performance rows); approvals and thumbs never count here. Optional only so hand-built arms elsewhere stay valid; buildArmScores always sets it. */
  outcomePulls?: number;
  globalPulls: number;
  priorPulls: number;
  successes: number;
  failures: number;
  meanReward: number;
  globalMeanReward: number;
  explorationBonus: number;
  uncertainty: number;
  alpha: number;
  beta: number;
  ucbScore: number;
  thompsonScore: number;
  coldStart: boolean;
  source: 'local_evidence' | 'global_prior' | 'mixed';
  localShare: number;
}

export interface BanditPolicy {
  trainingSource: BanditTrainingSource;
  totalPulls: number;
  successThreshold: number;
  globalPriorWeight: number;
  localEvidenceWeight: number;
  formatArms: BanditArmScore[];
  topicArms: BanditArmScore[];
  lengthArms: BanditArmScore[];
  hookArms: BanditArmScore[];
  toneArms: BanditArmScore[];
  specificityArms: BanditArmScore[];
  structureArms: BanditArmScore[];
  summary: string[];
  evidence?: {
    performanceRows: number;
    uniquePerformancePosts: number;
    collapsedSnapshots: number;
    operatorWrittenPosts: number;
    systemWrittenPosts: number;
    qualityDiscountedSystemPosts: number;
  };
}

export interface BanditSlotPlan {
  slot: number;
  mode: 'exploit' | 'explore';
  holdout: boolean;
  sourceLane: ContentSourceLane;
  styleMode: ContentStyleMode;
  format: string;
  topic: string;
  length: BanditLengthBucket;
  hook: TweetHookType | string;
  tone: TweetToneType | string;
  specificity: TweetSpecificityType | string;
  structure: TweetStructureType | string;
  coverageCluster: string;
  trendTopicId: string | null;
  trendHeadline: string | null;
  ideaSeedBrief: string | null;
  rationale: string;
}

interface BanditObservation {
  family: BanditArmFamily;
  arm: string;
  reward: number;
  weight: number;
  /** One evidence event (episode, performance row, feedback entry) fans out to up to seven family observations; this id groups them. */
  eventId: string;
  /** True when the reward is derived from measured X performance rather than operator approval/thumbs alone. */
  outcomeBacked: boolean;
}

interface BuildBanditPolicyOptions {
  performanceHistory: TweetPerformance[];
  feedback: FeedbackEntry[];
  signals: LearningSignal[];
  allTweets: Tweet[];
  allowedFormats: string[];
  candidateTopics: string[];
  baseline?: { avgLikes: number; avgRetweets: number } | null;
  globalPrior?: BanditGlobalPrior | null;
}

interface BuildBanditSlotPlanOptions {
  count: number;
  explorationRate: number;
  biasTopics?: string[];
  sourcePlan?: SourcePlannerPlan | null;
  shitpoastEnabled?: boolean;
}

const DEFAULT_MEAN_REWARD = 0.52;
const DEFAULT_PRIOR_PULLS = 2;
const GLOBAL_PRIOR_CAP = 16;
const BANDIT_HALF_LIFE_DAYS = 21;
// Final-stage (performance-backed) episode rewards blend the immediate and
// delayed components instead of consuming the clamped additive total. With
// the total, approval (0.85) + posting (0.32) saturates the immediate term at
// 1.0 and a -0.6 lift flop still mapped to ~0.6, so approved posts could never
// register as bandit failures. delayedTotal is scaled by the lift ceiling.
const FINAL_STAGE_IMMEDIATE_WEIGHT = 0.2;
const FINAL_STAGE_DELAYED_WEIGHT = 0.8;
const DELAYED_REWARD_SCALE = 0.8;
const BANDIT_FAILURE_REWARD = 0.35;
const EXPLOIT_LESSON_MIN_OUTCOME_PULLS = 3;
const EXPLOIT_LESSON_MIN_MEAN_REWARD = 0.55;
// A feedback entry is skipped when the same tweet's episode already carries
// the signal that recorded the same click, so one operator decision is
// observed once (episode wins). Entries for hard-deleted tweets, or whose
// episode lacks a matching signal, are still observed.
const FEEDBACK_COVERING_SIGNALS: Record<FeedbackEntry['rating'], LearningSignalType[]> = {
  down: ['deleted_from_x', 'deleted_from_queue', 'taste_less_like_this'],
  up: ['taste_more_like_this', 'approved_without_edit'],
};
const ALL_HOOKS: TweetHookType[] = ['question', 'bold_claim', 'data_point', 'story', 'observation', 'contrarian', 'listicle', 'callout', 'prediction', 'confession', 'how_to'];
const ALL_TONES: TweetToneType[] = ['sarcastic', 'earnest', 'analytical', 'provocative', 'educational', 'casual', 'urgent', 'playful'];
const ALL_SPECIFICITY: TweetSpecificityType[] = ['abstract', 'concrete', 'data_driven', 'tactical', 'story_led'];
const ALL_STRUCTURES: TweetStructureType[] = ['single_punch', 'stacked_lines', 'argument', 'story_arc', 'list', 'question_led', 'comparison', 'manifesto'];

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function recencyWeight(ts: string): number {
  const ageMs = Math.max(0, Date.now() - new Date(ts).getTime());
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return Math.pow(0.5, ageDays / BANDIT_HALF_LIFE_DAYS);
}

function sourceSignalWeight(source: TweetPerformance['source']): number {
  if (source === 'manual') return 2;
  if (source === 'timeline') return 1.25;
  return 1;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value) && value !== 'unknown'))];
}

function sortExploit(arms: BanditArmScore[]): BanditArmScore[] {
  return [...arms].sort((a, b) =>
    b.meanReward - a.meanReward ||
    b.localShare - a.localShare ||
    b.thompsonScore - a.thompsonScore ||
    a.arm.localeCompare(b.arm)
  );
}

function sortExplore(arms: BanditArmScore[]): BanditArmScore[] {
  return [...arms].sort((a, b) =>
    b.uncertainty - a.uncertainty ||
    Number(b.coldStart) - Number(a.coldStart) ||
    b.thompsonScore - a.thompsonScore ||
    a.arm.localeCompare(b.arm)
  );
}

function sortCaution(arms: BanditArmScore[]): BanditArmScore[] {
  return [...arms].sort((a, b) =>
    b.failures - a.failures ||
    a.meanReward - b.meanReward ||
    a.arm.localeCompare(b.arm)
  );
}

export function getLengthBucketFromText(content: string): BanditLengthBucket {
  const length = content.length;
  if (length < 200) return 'short';
  if (length < 500) return 'medium';
  return 'long';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function performanceReward(
  entry: TweetPerformance,
  baseline?: { avgLikes: number; avgRetweets: number } | null,
  history: TweetPerformance[] = [],
): number {
  const lift = computePerformanceLiftReward(entry, baseline, history);
  return clamp((lift + 1) / 2, 0.05, 0.98);
}

function buildFamilyObservation(
  family: BanditArmFamily,
  arm: string | null | undefined,
  reward: number,
  weight: number,
  event: { eventId: string; outcomeBacked: boolean },
): BanditObservation | null {
  const normalized = arm?.trim();
  if (!normalized || normalized === 'unknown') return null;
  return { family, arm: normalized, reward, weight, eventId: event.eventId, outcomeBacked: event.outcomeBacked };
}

/**
 * Maps an outcome episode onto the bandit's [0.02, 0.98] reward scale.
 * Immediate-stage episodes (no performance yet) keep the additive total.
 * Final-stage episodes let the measured outcome dominate so flops on approved
 * posts fall at or below the failure threshold and strong lifts land near the
 * top. An explicit operator rejection (live deletion, "less like this") caps
 * the reward: it is the terminal verdict on the post, and the approval that
 * preceded it must not outvote it now that the paired feedback entry is no
 * longer observed separately.
 */
export function episodeBanditReward(episode: Pick<OutcomeEpisode, 'stage' | 'reward'>): number {
  const { reward, stage } = episode;
  const base = stage === 'final'
    ? (FINAL_STAGE_IMMEDIATE_WEIGHT * reward.immediateTotal)
      + (FINAL_STAGE_DELAYED_WEIGHT * clamp(reward.delayedTotal / DELAYED_REWARD_SCALE, -1, 1))
    : reward.total;
  const capped = reward.deletionPenalty < 0 ? Math.min(base, reward.deletionPenalty) : base;
  return clamp((clamp(capped, -1, 1) + 1) / 2, 0.02, 0.98);
}

function collectEpisodeObservations(
  episodes: OutcomeEpisode[],
  allTweets: Tweet[],
  performanceHistory: TweetPerformance[] = [],
): BanditObservation[] {
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  const performanceByTweetId = new Map(performanceHistory.filter((entry) => entry.tweetId).map((entry) => [String(entry.tweetId), entry]));
  const performanceByXId = new Map(performanceHistory.filter((entry) => entry.xTweetId).map((entry) => [String(entry.xTweetId), entry]));
  const observations: BanditObservation[] = [];

  for (const episode of episodes) {
    const tweet = tweetById.get(String(episode.tweetId));
    const historicalEntry = performanceByTweetId.get(String(episode.tweetId))
      || (episode.xTweetId ? performanceByXId.get(String(episode.xTweetId)) : null);
    const reward = episodeBanditReward(episode);
    // Applied symmetrically to wins and losses: discounting only wins made
    // pattern-flagged styles unlearnable even when they kept outperforming.
    const qualityEvidenceWeight = historicalEntry
      ? historicalPerformanceEvidenceWeight(historicalEntry)
      : 1;
    const weight = recencyWeight(episode.observedAt)
      * (episode.stage === 'final' ? 1.1 : 0.9)
      * qualityEvidenceWeight;
    const length = getLengthBucketFromText(tweet?.content || '');
    const tags = episode.featureTags;
    const event = { eventId: `episode:${episode.tweetId}`, outcomeBacked: episode.stage === 'final' };

    observations.push(
      buildFamilyObservation('format', episode.format, reward, weight, event),
      buildFamilyObservation('topic', episode.topic, reward, weight, event),
      buildFamilyObservation('length', length, reward, weight, event),
      buildFamilyObservation('hook', tags.hook, reward, weight, event),
      buildFamilyObservation('tone', tags.tone, reward, weight, event),
      buildFamilyObservation('specificity', tags.specificity, reward, weight, event),
      buildFamilyObservation('structure', tags.structure, reward, weight, event),
    );
  }

  return observations.filter((entry): entry is BanditObservation => Boolean(entry));
}

function collectFallbackPerformanceObservations(
  performanceHistory: TweetPerformance[],
  coveredTweetIds: Set<string>,
  baseline?: { avgLikes: number; avgRetweets: number } | null,
): BanditObservation[] {
  const observations: BanditObservation[] = [];

  for (const entry of performanceHistory) {
    if (entry.tweetId && coveredTweetIds.has(String(entry.tweetId))) continue;
    const reward = performanceReward(entry, baseline, performanceHistory);
    const qualityEvidenceWeight = historicalPerformanceEvidenceWeight(entry);
    const weight = recencyWeight(entry.checkedAt)
      * sourceSignalWeight(entry.source)
      * qualityEvidenceWeight;
    const featureTags = extractCandidateFeatureTags(entry.content, {
      topic: entry.topic,
      thesisHint: entry.thesis,
    });
    const structure = entry.structure || extractStructureType(entry.content);
    const event = { eventId: `performance:${entry.xTweetId || entry.tweetId}`, outcomeBacked: true };

    observations.push(
      buildFamilyObservation('format', entry.format, reward, weight, event),
      buildFamilyObservation('topic', entry.topic, reward, weight, event),
      buildFamilyObservation('length', getLengthBucketFromText(entry.content), reward, weight, event),
      buildFamilyObservation('hook', entry.hook || featureTags.hook, reward, weight, event),
      buildFamilyObservation('tone', entry.tone || featureTags.tone, reward, weight, event),
      buildFamilyObservation('specificity', entry.specificity || featureTags.specificity, reward, weight, event),
      buildFamilyObservation('structure', structure, reward, weight, event),
    );
  }

  return observations.filter((entry): entry is BanditObservation => Boolean(entry));
}

function collectFeedbackObservations(
  feedback: FeedbackEntry[],
  allTweets: Tweet[],
  episodeSignalsByTweetId: Map<string, Set<LearningSignalType>> = new Map(),
): BanditObservation[] {
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  const observations: BanditObservation[] = [];

  feedback.forEach((entry, index) => {
    if (entry.rating !== 'down' && entry.rating !== 'up') return;
    // Live deletions and taste calibration write a feedback entry AND a
    // learning signal while the Tweet survives, so the episode already
    // observes that click; observing the entry too counted it twice.
    const episodeSignals = entry.tweetId ? episodeSignalsByTweetId.get(String(entry.tweetId)) : undefined;
    if (episodeSignals && FEEDBACK_COVERING_SIGNALS[entry.rating].some((signal) => episodeSignals.has(signal))) return;
    // A queue rejection hard-deletes the Tweet record, and first-batch
    // preview thumbs are saved without a tweetId at all. Both previously
    // dropped the operator's vote here entirely. The feedback entry keeps
    // the draft text, so style arms can still be observed from it; only
    // format/topic (not derivable from text alone) are skipped when no
    // Tweet record is found.
    const tweet = entry.tweetId ? tweetById.get(String(entry.tweetId)) : undefined;
    const content = tweet?.content || entry.tweetText || '';
    if (!content.trim()) return;
    // Thumbs-up is observed too: without it the bandit only ever learned what
    // the operator disliked and had no direct signal about what they endorsed.
    // Positive votes carry slightly less weight than negative ones because an
    // approval is cheaper to give than a rejection.
    const weight = recencyWeight(entry.generatedAt)
      * (entry.userProvidedReason ? 1.2 : 1)
      * (entry.rating === 'up' ? 0.85 : 1);
    const reward = entry.rating === 'up' ? 0.9 : 0.02;
    const featureTags = tweet?.featureTags || extractCandidateFeatureTags(content, {
      topic: tweet?.topic,
      thesisHint: tweet?.thesis,
    });
    const event = { eventId: `feedback:${index}`, outcomeBacked: false };
    observations.push(
      buildFamilyObservation('format', tweet?.format, reward, weight, event),
      buildFamilyObservation('topic', tweet?.topic, reward, weight, event),
      buildFamilyObservation('length', getLengthBucketFromText(content), reward, weight, event),
      buildFamilyObservation('hook', featureTags.hook, reward, weight, event),
      buildFamilyObservation('tone', featureTags.tone, reward, weight, event),
      buildFamilyObservation('specificity', featureTags.specificity, reward, weight, event),
      buildFamilyObservation('structure', featureTags.structure, reward, weight, event),
    );
  });

  return observations.filter((entry): entry is BanditObservation => Boolean(entry));
}

/**
 * Human-readable "what's working" lessons from arms with real local evidence,
 * for injection into the generation prompt via personalization memory. Only
 * arms with enough performance-backed pulls and an above-baseline mean reward
 * qualify: the prompt presents these as live outcome evidence, so approvals
 * and thumbs-up alone (which also raise localPulls) must never promote an
 * arm that has not yet been measured on X.
 */
export function summarizeBanditExploitLessons(
  policy: Pick<BanditPolicy, 'formatArms' | 'hookArms' | 'toneArms' | 'structureArms'> | null | undefined,
  limit = 4,
): string[] {
  if (!policy) return [];
  const families: Array<{ label: string; arms: BanditArmScore[] }> = [
    { label: 'Format', arms: policy.formatArms || [] },
    { label: 'Hook', arms: policy.hookArms || [] },
    { label: 'Tone', arms: policy.toneArms || [] },
    { label: 'Structure', arms: policy.structureArms || [] },
  ];
  const lessons: Array<{ line: string; strength: number }> = [];
  for (const { label, arms } of families) {
    const proven = arms
      .filter((arm) => (arm.outcomePulls || 0) >= EXPLOIT_LESSON_MIN_OUTCOME_PULLS && arm.meanReward >= EXPLOIT_LESSON_MIN_MEAN_REWARD)
      .sort((left, right) => right.meanReward - left.meanReward)[0];
    if (!proven) continue;
    const outcomePulls = proven.outcomePulls || 0;
    lessons.push({
      line: `${label} "${proven.arm}" is earning ${Math.round(proven.meanReward * 100)}% mean reward across ${Math.round(outcomePulls)} recent posts with outcome data. Lean into it when the idea fits.`,
      strength: proven.meanReward * Math.min(1, outcomePulls / 6),
    });
  }
  return lessons
    .sort((left, right) => right.strength - left.strength)
    .slice(0, limit)
    .map((lesson) => lesson.line);
}

/**
 * True when the arm lacks meaningful local outcome evidence. Used to flag
 * exploration holdouts: drafts on under-tested arms get the experimentHoldout
 * marker so the reward path shields them from lift punishment while the
 * learning loop gathers the data it is missing.
 */
export function isUnderTestedBanditArm(
  policy: Pick<BanditPolicy, 'formatArms' | 'hookArms'> | null | undefined,
  family: 'format' | 'hook',
  arm: string | null | undefined,
): boolean {
  if (!policy || !arm) return false;
  const arms = family === 'format' ? policy.formatArms : policy.hookArms;
  const match = (arms || []).find((entry) => entry.arm === arm);
  return Boolean(match && (match.coldStart || match.localPulls < 3));
}

function buildPriorLookup(prior: BanditGlobalPrior | null | undefined, family: BanditArmFamily): Map<string, BanditPriorArm> {
  return new Map((prior?.families[family] || []).map((entry) => [entry.arm, entry]));
}

function createDefaultGlobalPrior(): BanditGlobalPrior {
  return {
    updatedAt: new Date().toISOString(),
    sourceAccounts: 0,
    totalSamples: 0,
    families: {
      format: [],
      topic: [],
      length: [],
      hook: [],
      tone: [],
      specificity: [],
      structure: [],
    },
  };
}

function buildArmScores(
  family: BanditArmFamily,
  candidates: string[],
  observations: BanditObservation[],
  globalPrior: BanditGlobalPrior | null | undefined,
): BanditArmScore[] {
  const priorLookup = buildPriorLookup(globalPrior, family);
  const grouped = new Map<string, { pulls: number; outcomePulls: number; rewardSum: number; failures: number }>();
  for (const candidate of candidates) {
    grouped.set(candidate, { pulls: 0, outcomePulls: 0, rewardSum: 0, failures: 0 });
  }

  for (const observation of observations) {
    if (observation.family !== family) continue;
    const current = grouped.get(observation.arm) || { pulls: 0, outcomePulls: 0, rewardSum: 0, failures: 0 };
    current.pulls += observation.weight;
    if (observation.outcomeBacked) current.outcomePulls += observation.weight;
    current.rewardSum += observation.reward * observation.weight;
    if (observation.reward <= BANDIT_FAILURE_REWARD) current.failures += observation.weight;
    grouped.set(observation.arm, current);
  }

  return [...grouped.entries()]
    .map(([arm, local]) => {
      const priorArm = priorLookup.get(arm);
      const globalPulls = Math.min(GLOBAL_PRIOR_CAP, priorArm?.pulls || 0);
      const priorPulls = DEFAULT_PRIOR_PULLS + (globalPulls * 0.45);
      const globalMeanReward = priorArm?.meanReward ?? DEFAULT_MEAN_REWARD;
      const alpha = 1 + local.rewardSum + (globalMeanReward * priorPulls);
      const beta = 1 + Math.max(0, local.pulls - local.rewardSum) + ((1 - globalMeanReward) * priorPulls) + (local.failures * 0.2);
      const meanReward = alpha / Math.max(alpha + beta, 1);
      const uncertainty = Math.sqrt((alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1)));
      const loserPenalty = Math.min(0.12, local.failures * 0.04);
      const explorationBonus = uncertainty * (local.pulls === 0 ? 1.25 : 1);
      const thompsonScore = meanReward + explorationBonus - loserPenalty;
      const localShare = local.pulls / Math.max(local.pulls + priorPulls, 1);
      const source: BanditArmScore['source'] =
        local.pulls <= 0.2
          ? 'global_prior'
          : globalPulls > 0
            ? 'mixed'
            : 'local_evidence';

      return {
        arm,
        family,
        pulls: Number(local.pulls.toFixed(3)),
        localPulls: Number(local.pulls.toFixed(3)),
        outcomePulls: Number(local.outcomePulls.toFixed(3)),
        globalPulls: Number(globalPulls.toFixed(3)),
        priorPulls: Number(priorPulls.toFixed(3)),
        successes: Number(local.rewardSum.toFixed(3)),
        failures: Number(local.failures.toFixed(3)),
        meanReward: Number(meanReward.toFixed(4)),
        globalMeanReward: Number(globalMeanReward.toFixed(4)),
        explorationBonus: Number(explorationBonus.toFixed(4)),
        uncertainty: Number(uncertainty.toFixed(4)),
        alpha: Number(alpha.toFixed(4)),
        beta: Number(beta.toFixed(4)),
        ucbScore: Number(thompsonScore.toFixed(4)),
        thompsonScore: Number(thompsonScore.toFixed(4)),
        coldStart: local.pulls === 0,
        source,
        localShare: Number(localShare.toFixed(4)),
      };
    })
    .sort((a, b) =>
      b.thompsonScore - a.thompsonScore ||
      b.meanReward - a.meanReward ||
      a.arm.localeCompare(b.arm)
    );
}

function toCandidateList(values: Array<string | null | undefined>): string[] {
  return unique(values);
}

/**
 * Per-account engagement baseline for global-prior reward normalization. With
 * fewer than 5 rows the account keeps the default constant baseline — a tiny
 * sample should not define "normal" for that account.
 */
function accountBaselineFromHistory(
  history: TweetPerformance[],
): { avgLikes: number; avgRetweets: number } | null {
  if (history.length < 5) return null;
  const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    avgLikes: Math.max(1, avg(history.map((entry) => entry.likes || 0))),
    avgRetweets: Math.max(0, avg(history.map((entry) => entry.retweets || 0))),
  };
}

export function buildBanditGlobalPrior({
  performanceHistory,
  accountHistories,
  sourceAccounts = 0,
}: {
  /** Legacy flat history; scored against the default constant baseline. */
  performanceHistory?: TweetPerformance[];
  /** One history per account; each account's rewards are normalized against its own baseline so a large account's ordinary post and a small account's breakout stop scoring identically. */
  accountHistories?: TweetPerformance[][];
  sourceAccounts?: number;
}): BanditGlobalPrior {
  const prior = createDefaultGlobalPrior();
  const groups = accountHistories && accountHistories.length > 0
    ? accountHistories
    : [performanceHistory || []];
  const totals = new Map<string, { pulls: number; rewardSum: number; failures: number }>();
  let totalSamples = 0;

  for (const group of groups) {
    const uniqueHistory = collapsePerformanceSnapshotsWithStats(group).entries;
    totalSamples += uniqueHistory.length;
    const baseline = accountHistories && accountHistories.length > 0
      ? accountBaselineFromHistory(uniqueHistory)
      : null;
    const observations = collectFallbackPerformanceObservations(uniqueHistory, new Set(), baseline);
    for (const observation of observations) {
      const key = `${observation.family}::${observation.arm}`;
      const current = totals.get(key) || { pulls: 0, rewardSum: 0, failures: 0 };
      current.pulls += observation.weight;
      current.rewardSum += observation.reward * observation.weight;
      if (observation.reward <= BANDIT_FAILURE_REWARD) current.failures += observation.weight;
      totals.set(key, current);
    }
  }

  for (const [key, stats] of totals.entries()) {
    const [family, arm] = key.split('::') as [BanditArmFamily, string];
    prior.families[family].push({
      arm,
      pulls: Number(stats.pulls.toFixed(3)),
      rewardSum: Number(stats.rewardSum.toFixed(3)),
      failures: Number(stats.failures.toFixed(3)),
      meanReward: Number((stats.rewardSum / Math.max(stats.pulls, 1)).toFixed(4)),
    });
  }

  for (const family of Object.keys(prior.families) as BanditArmFamily[]) {
    prior.families[family].sort((a, b) => b.meanReward - a.meanReward || b.pulls - a.pulls || a.arm.localeCompare(b.arm));
  }

  prior.sourceAccounts = sourceAccounts;
  prior.totalSamples = totalSamples;
  return prior;
}

export function buildBanditPolicy({
  performanceHistory,
  feedback,
  signals,
  allTweets,
  allowedFormats,
  candidateTopics,
  baseline,
  globalPrior,
}: BuildBanditPolicyOptions): BanditPolicy {
  const collapsed = collapsePerformanceSnapshotsWithStats(performanceHistory);
  const uniqueHistory = collapsed.entries;
  const autopilotHistory = uniqueHistory.filter((entry) => entry.source === 'autopilot');
  const operatorHistory = uniqueHistory.filter((entry) => entry.source !== 'autopilot');
  const trainingHistory = operatorHistory.length > 0
    ? uniqueHistory
    : autopilotHistory.length >= 10
      ? autopilotHistory
      : uniqueHistory;
  const trainingSource: BanditTrainingSource = operatorHistory.length === 0 && autopilotHistory.length >= 10 ? 'autopilot' : 'mixed';
  const qualityDiscountedSystemHistory = autopilotHistory.filter((entry) =>
    assessHistoricalWinner(entry).evidenceWeight < 1
  );

  const scoreThreshold = median(trainingHistory.map((entry) => entry.likes + (entry.retweets * 2) + (entry.replies * 1.5)));
  const baselineScore = baseline ? Math.max(1, baseline.avgLikes + (baseline.avgRetweets * 2)) : 0;
  const successThreshold = Math.max(1, scoreThreshold || 0, baselineScore);

  const episodes = buildOutcomeEpisodes({
    agentId: allTweets[0]?.agentId || 'agent',
    tweets: allTweets,
    signals,
    performanceHistory: uniqueHistory,
    baseline,
  });
  // Every tweet with an episode is covered: its performance lift is already
  // inside the episode reward. Excluding manual tweets here double-counted
  // the identical outcome (episode + x2-weighted fallback observation) and,
  // because the fallback re-extracts feature tags from posted text, could
  // train different arms with the same outcome. Manual emphasis still
  // applies via sourceSignalWeight for rows with no episode (e.g. timeline
  // imports predating Clawfable).
  const coveredTweetIds = new Set(episodes.map((episode) => String(episode.tweetId)));
  const episodeSignalsByTweetId = new Map(episodes.map((episode) => [String(episode.tweetId), new Set(episode.signals)]));
  const observations = [
    ...collectEpisodeObservations(episodes, allTweets, uniqueHistory),
    ...collectFallbackPerformanceObservations(uniqueHistory, coveredTweetIds, baseline),
    ...collectFeedbackObservations(feedback, allTweets, episodeSignalsByTweetId),
  ];
  // Each event fans out to up to seven family observations; the learning tab
  // reads totalPulls as "how many things has the bandit seen", so count events.
  const totalPulls = new Set(observations.map((observation) => observation.eventId)).size;

  const formatCandidates = toCandidateList([...allowedFormats, ...trainingHistory.map((entry) => entry.format)]);
  const topicCandidates = toCandidateList([...candidateTopics, ...trainingHistory.map((entry) => entry.topic)]);
  const lengthCandidates: BanditLengthBucket[] = ['short', 'medium', 'long'];
  const hookCandidates = toCandidateList([...ALL_HOOKS, ...trainingHistory.map((entry) => entry.hook)]);
  const toneCandidates = toCandidateList([...ALL_TONES, ...trainingHistory.map((entry) => entry.tone)]);
  const specificityCandidates = toCandidateList([...ALL_SPECIFICITY, ...trainingHistory.map((entry) => entry.specificity)]);
  const structureCandidates = toCandidateList([...ALL_STRUCTURES, ...trainingHistory.map((entry) => entry.structure || extractStructureType(entry.content))]);

  const formatArms = buildArmScores('format', formatCandidates, observations, globalPrior);
  const topicArms = buildArmScores('topic', topicCandidates, observations, globalPrior);
  const lengthArms = buildArmScores('length', lengthCandidates, observations, globalPrior);
  const hookArms = buildArmScores('hook', hookCandidates, observations, globalPrior);
  const toneArms = buildArmScores('tone', toneCandidates, observations, globalPrior);
  const specificityArms = buildArmScores('specificity', specificityCandidates, observations, globalPrior);
  const structureArms = buildArmScores('structure', structureCandidates, observations, globalPrior);

  const allArmGroups = [formatArms, topicArms, lengthArms, hookArms, toneArms, specificityArms, structureArms];
  const localEvidenceWeight = Number((
    allArmGroups.flat().reduce((sum, arm) => sum + arm.localShare, 0) /
    Math.max(allArmGroups.flat().length, 1)
  ).toFixed(4));
  const globalPriorWeight = Number((1 - localEvidenceWeight).toFixed(4));

  const exploitFormat = sortExploit(formatArms)[0];
  const exploreFormat = sortExplore(formatArms).find((arm) => arm.coldStart) || sortExplore(formatArms)[0];
  const exploitTopic = sortExploit(topicArms)[0];
  const exploreTopic = sortExplore(topicArms).find((arm) => arm.coldStart) || sortExplore(topicArms)[0];
  const exploitHook = sortExploit(hookArms)[0];
  const exploreHook = sortExplore(hookArms).find((arm) => arm.coldStart) || sortExplore(hookArms)[0];

  const summary = [
    `Learning evidence: ${collapsed.uniquePosts} unique posts (${operatorHistory.length} operator, ${autopilotHistory.length} system); ${collapsed.collapsedSnapshots} repeated checkpoints collapsed`,
    qualityDiscountedSystemHistory.length > 0
      ? `Quality-adjusted ${qualityDiscountedSystemHistory.length} system post${qualityDiscountedSystemHistory.length === 1 ? '' : 's'} with obsolete generated patterns; discount applies to wins and losses symmetrically`
      : '',
    exploitFormat ? `Exploit format: ${exploitFormat.arm} (${Math.round(exploitFormat.meanReward * 100)}% reward)` : '',
    exploitTopic ? `Exploit topic: ${exploitTopic.arm} (${Math.round(exploitTopic.meanReward * 100)}% reward)` : '',
    exploreFormat ? `Explore format: ${exploreFormat.arm}` : '',
    exploreTopic ? `Explore topic: ${exploreTopic.arm}` : '',
    exploitHook ? `Exploit hook: ${exploitHook.arm}` : '',
    exploreHook ? `Explore hook: ${exploreHook.arm}` : '',
    `Local evidence weight: ${Math.round(localEvidenceWeight * 100)}%`,
    `Global prior weight: ${Math.round(globalPriorWeight * 100)}%`,
  ].filter(Boolean);

  return {
    trainingSource,
    totalPulls,
    successThreshold,
    globalPriorWeight,
    localEvidenceWeight,
    formatArms,
    topicArms,
    lengthArms,
    hookArms,
    toneArms,
    specificityArms,
    structureArms,
    summary,
    evidence: {
      performanceRows: collapsed.inputRows,
      uniquePerformancePosts: collapsed.uniquePosts,
      collapsedSnapshots: collapsed.collapsedSnapshots,
      operatorWrittenPosts: operatorHistory.length,
      systemWrittenPosts: autopilotHistory.length,
      qualityDiscountedSystemPosts: qualityDiscountedSystemHistory.length,
    },
  };
}

function pickUnusedArm(
  ranking: BanditArmScore[],
  used: Set<string>,
  fallback: string,
): BanditArmScore {
  return ranking.find((arm) => !used.has(arm.arm)) || ranking[0] || {
    arm: fallback,
    family: 'format',
    pulls: 0,
    localPulls: 0,
    outcomePulls: 0,
    globalPulls: 0,
    priorPulls: DEFAULT_PRIOR_PULLS,
    successes: 0,
    failures: 0,
    meanReward: DEFAULT_MEAN_REWARD,
    globalMeanReward: DEFAULT_MEAN_REWARD,
    explorationBonus: 0.25,
    uncertainty: 0.25,
    alpha: 1,
    beta: 1,
    ucbScore: DEFAULT_MEAN_REWARD,
    thompsonScore: DEFAULT_MEAN_REWARD,
    coldStart: true,
    source: 'global_prior',
    localShare: 0,
  };
}

function pickPreferredArm(
  ranking: BanditArmScore[],
  preferredArms: string[],
  fallback: BanditArmScore,
): BanditArmScore {
  for (const preferred of preferredArms) {
    const arm = ranking.find((entry) => entry.arm.toLowerCase() === preferred.toLowerCase());
    if (arm) return arm;
  }
  return fallback;
}

function createSyntheticArm(
  family: BanditArmFamily,
  arm: string,
): BanditArmScore {
  return {
    arm,
    family,
    pulls: 0,
    localPulls: 0,
    outcomePulls: 0,
    globalPulls: 0,
    priorPulls: DEFAULT_PRIOR_PULLS,
    successes: 0,
    failures: 0,
    meanReward: DEFAULT_MEAN_REWARD,
    globalMeanReward: DEFAULT_MEAN_REWARD,
    explorationBonus: 0.25,
    uncertainty: 0.25,
    alpha: 1,
    beta: 1,
    ucbScore: DEFAULT_MEAN_REWARD,
    thompsonScore: DEFAULT_MEAN_REWARD,
    coldStart: true,
    source: 'global_prior',
    localShare: 0,
  };
}

function prioritizeArms(
  ranking: BanditArmScore[],
  used: Set<string>,
  preferredArm?: string | null,
): BanditArmScore[] {
  const preferred = preferredArm
    ? ranking.find((arm) => arm.arm.toLowerCase() === preferredArm.toLowerCase())
    : null;
  const remaining = preferred ? ranking.filter((arm) => arm.arm !== preferred.arm) : ranking.slice();
  const unused = remaining.filter((arm) => !used.has(arm.arm));
  const seen = remaining.filter((arm) => used.has(arm.arm));

  return preferred ? [preferred, ...unused, ...seen] : [...unused, ...seen];
}

function selectPrimaryEnvelope(
  rankings: {
    format: BanditArmScore[];
    topic: BanditArmScore[];
    length: BanditArmScore[];
  },
  usedFamilies: {
    format: Set<string>;
    topic: Set<string>;
    length: Set<string>;
  },
  usedPrimaryCombos: Set<string>,
  preferredTopic?: string | null,
): {
  format: BanditArmScore;
  topic: BanditArmScore;
  length: BanditArmScore;
} {
  const formats = prioritizeArms(rankings.format, usedFamilies.format).slice(0, Math.max(1, Math.min(4, rankings.format.length)));
  const topics = prioritizeArms(rankings.topic, usedFamilies.topic, preferredTopic).slice(0, Math.max(1, Math.min(5, rankings.topic.length)));
  const lengths = prioritizeArms(rankings.length, usedFamilies.length).slice(0, Math.max(1, Math.min(3, rankings.length.length)));

  let best: {
    format: BanditArmScore;
    topic: BanditArmScore;
    length: BanditArmScore;
    score: number;
  } | null = null;

  for (let fi = 0; fi < formats.length; fi++) {
    for (let ti = 0; ti < topics.length; ti++) {
      for (let li = 0; li < lengths.length; li++) {
        const format = formats[fi];
        const topic = topics[ti];
        const length = lengths[li];
        const key = `${format.arm}::${topic.arm}::${length.arm}`;
        const score = (usedPrimaryCombos.has(key) ? 100 : 0)
          + (usedFamilies.format.has(format.arm) ? 9 : 0)
          + (usedFamilies.topic.has(topic.arm) ? 6 : 0)
          + (usedFamilies.length.has(length.arm) ? 3 : 0)
          + (fi * 3)
          + (ti * 2)
          + li;

        if (!best || score < best.score) {
          best = { format, topic, length, score };
        }
      }
    }
  }

  return best || {
    format: pickUnusedArm(rankings.format, usedFamilies.format, 'hot_take'),
    topic: pickUnusedArm(rankings.topic, usedFamilies.topic, 'general'),
    length: pickUnusedArm(rankings.length, usedFamilies.length, 'medium'),
  };
}

function buildModeSequence(count: number, exploreCount: number): Array<'exploit' | 'explore'> {
  const modes: Array<'exploit' | 'explore'> = Array.from({ length: count }, () => 'exploit');
  if (exploreCount <= 0) return modes;

  const step = count / exploreCount;
  for (let index = 0; index < exploreCount; index++) {
    const slot = Math.min(count - 1, Math.floor((index + 0.5) * step));
    modes[slot] = 'explore';
  }
  return modes;
}

function buildHoldoutSlots(count: number, exploreCount: number): Set<number> {
  if (count < 8 || exploreCount <= 0) return new Set();
  const holdoutCount = Math.max(1, Math.round(count * 0.12));
  const slots = new Set<number>();
  const step = count / holdoutCount;
  for (let index = 0; index < holdoutCount; index++) {
    slots.add(Math.min(count, Math.max(1, Math.round((index + 0.75) * step))));
  }
  return slots;
}

export function buildBanditSlotPlan(
  policy: BanditPolicy | null | undefined,
  {
    count,
    explorationRate,
    biasTopics = [],
    sourcePlan = null,
    shitpoastEnabled = false,
  }: BuildBanditSlotPlanOptions,
): BanditSlotPlan[] {
  if (!policy || count <= 0) return [];

  const exploreCount = count >= 4 ? Math.max(1, Math.round((count * explorationRate) / 100)) : 0;
  const modes = buildModeSequence(count, exploreCount);
  const holdoutSlots = buildHoldoutSlots(count, exploreCount);
  const exploit = {
    format: sortExploit(policy.formatArms),
    topic: sortExploit(policy.topicArms),
    length: sortExploit(policy.lengthArms),
    hook: sortExploit(policy.hookArms),
    tone: sortExploit(policy.toneArms),
    specificity: sortExploit(policy.specificityArms),
    structure: sortExploit(policy.structureArms),
  };
  const explore = {
    format: sortExplore(policy.formatArms),
    topic: sortExplore(policy.topicArms),
    length: sortExplore(policy.lengthArms),
    hook: sortExplore(policy.hookArms),
    tone: sortExplore(policy.toneArms),
    specificity: sortExplore(policy.specificityArms),
    structure: sortExplore(policy.structureArms),
  };

  const usedCombos = new Set<string>();
  const usedPrimaryCombos = new Set<string>();
  const usedFamilies = {
    format: new Set<string>(),
    topic: new Set<string>(),
    length: new Set<string>(),
    hook: new Set<string>(),
    tone: new Set<string>(),
    specificity: new Set<string>(),
    structure: new Set<string>(),
  };
  let biasIndex = 0;
  const normalizedBiasTopics = unique(biasTopics);
  const plans: BanditSlotPlan[] = [];
  const shitpoastSlots = buildShitpoastSlotSet(count, shitpoastEnabled);

  for (let slot = 0; slot < count; slot++) {
    const sourceSlot = sourcePlan?.slots[slot] || null;
    const holdout = holdoutSlots.has(slot + 1);
    const mode = holdout ? 'explore' : (sourceSlot?.mode || modes[slot]);
    const styleMode = shitpoastSlots.has(slot + 1) ? SHITPOAST_STYLE_MODE : STANDARD_STYLE_MODE;
    const familyRankings = mode === 'explore' ? explore : exploit;
    const preferredTopic = sourceSlot?.targetTopic || (biasIndex < normalizedBiasTopics.length ? normalizedBiasTopics[biasIndex] : null);
    const envelope = selectPrimaryEnvelope(
      {
        format: familyRankings.format,
        topic: familyRankings.topic,
        length: familyRankings.length,
      },
      {
        format: usedFamilies.format,
        topic: usedFamilies.topic,
        length: usedFamilies.length,
      },
      usedPrimaryCombos,
      preferredTopic,
    );
    let format = envelope.format;
    let topic = envelope.topic;
    if (sourceSlot?.targetTopic) {
      topic = familyRankings.topic.find((arm) => arm.arm.toLowerCase() === sourceSlot.targetTopic.toLowerCase())
        || createSyntheticArm('topic', sourceSlot.targetTopic);
    }
    if (preferredTopic) {
      biasIndex++;
    }
    let length = envelope.length;
    const preferredPrimaryCombo = `${format.arm}::${topic.arm}::${length.arm}`;
    if (usedPrimaryCombos.has(preferredPrimaryCombo)) {
      const retryEnvelope = selectPrimaryEnvelope(
        {
          format: familyRankings.format,
          topic: familyRankings.topic,
          length: familyRankings.length,
        },
        {
          format: usedFamilies.format,
          topic: usedFamilies.topic,
          length: usedFamilies.length,
        },
        usedPrimaryCombos,
      );
      format = retryEnvelope.format;
      topic = retryEnvelope.topic;
      length = retryEnvelope.length;
    }
    const hook = pickUnusedArm(familyRankings.hook, usedFamilies.hook, 'bold_claim');
    const tone = pickUnusedArm(familyRankings.tone, usedFamilies.tone, 'analytical');
    const specificity = pickUnusedArm(familyRankings.specificity, usedFamilies.specificity, 'concrete');
    const structure = pickUnusedArm(familyRankings.structure, usedFamilies.structure, 'single_punch');
    if (styleMode === SHITPOAST_STYLE_MODE) {
      format = pickPreferredArm(familyRankings.format, ['hot_take', 'short_punch', 'observation'], format);
      length = pickPreferredArm(familyRankings.length, ['short', 'medium'], length);
    }
    const selectedHook = styleMode === SHITPOAST_STYLE_MODE
      ? pickPreferredArm(familyRankings.hook, ['contrarian', 'bold_claim', 'confession', 'callout', 'prediction', 'observation'], hook)
      : hook;
    const selectedTone = styleMode === SHITPOAST_STYLE_MODE
      ? pickPreferredArm(familyRankings.tone, ['provocative', 'playful', 'sarcastic', 'casual'], tone)
      : tone;
    const selectedStructure = styleMode === SHITPOAST_STYLE_MODE
      ? pickPreferredArm(familyRankings.structure, ['single_punch', 'stacked_lines', 'comparison', 'manifesto'], structure)
      : structure;

    let combo = `${format.arm}::${topic.arm}::${length.arm}::${selectedHook.arm}::${selectedStructure.arm}`;
    usedPrimaryCombos.add(`${format.arm}::${topic.arm}::${length.arm}`);
    if (usedCombos.has(combo)) {
      combo = `${combo}::${slot + 1}`;
    }
    usedCombos.add(combo);
    usedFamilies.format.add(format.arm);
    usedFamilies.topic.add(topic.arm);
    usedFamilies.length.add(length.arm);
    usedFamilies.hook.add(selectedHook.arm);
    usedFamilies.tone.add(selectedTone.arm);
    usedFamilies.specificity.add(specificity.arm);
    usedFamilies.structure.add(selectedStructure.arm);

    const sourceLane = sourceSlot?.sourceLane || (mode === 'explore' ? 'core_explore_fallback' : 'manual_core_exploit');
    const baseRationale = mode === 'explore'
      ? `Explore ${format.arm}/${topic.arm}/${selectedHook.arm}. Uncertainty is still high, so this slot buys information while staying on-brand.`
      : `Exploit ${format.arm}/${topic.arm}/${selectedHook.arm}. Local reward and posterior mean both support this combination.`;
    const rationale = sourceSlot
      ? `${sourceSlot.plannerReason} ${baseRationale}`
      : baseRationale;
    const styleRationale = styleMode === SHITPOAST_STYLE_MODE
      ? `${rationale} Style mode: shitpoast. Raise the punch and weirdness without increasing policy risk.`
      : rationale;

    plans.push({
      slot: slot + 1,
      mode,
      holdout,
      sourceLane,
      styleMode,
      format: format.arm,
      topic: topic.arm,
      length: (length.arm as BanditLengthBucket) || 'medium',
      hook: selectedHook.arm,
      tone: selectedTone.arm,
      specificity: specificity.arm,
      structure: selectedStructure.arm,
      coverageCluster: `${topic.arm.toLowerCase()}:${selectedHook.arm.toLowerCase()}:${selectedStructure.arm.toLowerCase()}`,
      trendTopicId: sourceSlot?.trendTopicId || null,
      trendHeadline: sourceSlot?.trendHeadline || null,
      ideaSeedBrief: sourceSlot?.ideaSeedBrief || null,
      rationale: holdout
        ? `${styleRationale} Holdout: deliberately preserve this under-tested creative bet so the policy can learn instead of only exploiting today's winners.`
        : styleRationale,
    });
  }

  return plans.slice(0, count);
}
