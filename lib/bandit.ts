import type {
  ContentSourceLane,
  FeedbackEntry,
  LearningSignal,
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
}

export interface BanditSlotPlan {
  slot: number;
  mode: 'exploit' | 'explore';
  sourceLane: ContentSourceLane;
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
  rationale: string;
}

interface BanditObservation {
  family: BanditArmFamily;
  arm: string;
  reward: number;
  weight: number;
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
}

const DEFAULT_MEAN_REWARD = 0.52;
const DEFAULT_PRIOR_PULLS = 2;
const GLOBAL_PRIOR_CAP = 16;
const BANDIT_HALF_LIFE_DAYS = 21;
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
): number {
  const lift = computePerformanceLiftReward(entry, baseline);
  return clamp((lift + 1) / 2, 0.05, 0.98);
}

function buildFamilyObservation(family: BanditArmFamily, arm: string | null | undefined, reward: number, weight: number): BanditObservation | null {
  const normalized = arm?.trim();
  if (!normalized || normalized === 'unknown') return null;
  return { family, arm: normalized, reward, weight };
}

function collectEpisodeObservations(episodes: OutcomeEpisode[], allTweets: Tweet[]): BanditObservation[] {
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  const observations: BanditObservation[] = [];

  for (const episode of episodes) {
    const tweet = tweetById.get(String(episode.tweetId));
    const reward = clamp((episode.reward.total + 1) / 2, 0.02, 0.98);
    const weight = recencyWeight(episode.observedAt) * (episode.stage === 'final' ? 1.1 : 0.9);
    const length = getLengthBucketFromText(tweet?.content || '');
    const tags = episode.featureTags;

    observations.push(
      buildFamilyObservation('format', episode.format, reward, weight),
      buildFamilyObservation('topic', episode.topic, reward, weight),
      buildFamilyObservation('length', length, reward, weight),
      buildFamilyObservation('hook', tags.hook, reward, weight),
      buildFamilyObservation('tone', tags.tone, reward, weight),
      buildFamilyObservation('specificity', tags.specificity, reward, weight),
      buildFamilyObservation('structure', tags.structure, reward, weight),
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
    const reward = performanceReward(entry, baseline);
    const weight = recencyWeight(entry.checkedAt);
    const featureTags = extractCandidateFeatureTags(entry.content, {
      topic: entry.topic,
      thesisHint: entry.thesis,
    });
    const structure = entry.structure || extractStructureType(entry.content);

    observations.push(
      buildFamilyObservation('format', entry.format, reward, weight),
      buildFamilyObservation('topic', entry.topic, reward, weight),
      buildFamilyObservation('length', getLengthBucketFromText(entry.content), reward, weight),
      buildFamilyObservation('hook', entry.hook || featureTags.hook, reward, weight),
      buildFamilyObservation('tone', entry.tone || featureTags.tone, reward, weight),
      buildFamilyObservation('specificity', entry.specificity || featureTags.specificity, reward, weight),
      buildFamilyObservation('structure', structure, reward, weight),
    );
  }

  return observations.filter((entry): entry is BanditObservation => Boolean(entry));
}

function collectFeedbackObservations(
  feedback: FeedbackEntry[],
  allTweets: Tweet[],
): BanditObservation[] {
  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  const observations: BanditObservation[] = [];

  for (const entry of feedback) {
    if (entry.rating !== 'down' || !entry.tweetId) continue;
    const tweet = tweetById.get(String(entry.tweetId));
    if (!tweet) continue;
    const weight = recencyWeight(entry.generatedAt) * (entry.userProvidedReason ? 1.2 : 1);
    const reward = 0.02;
    const featureTags = tweet.featureTags || extractCandidateFeatureTags(tweet.content, {
      topic: tweet.topic,
      thesisHint: tweet.thesis,
    });
    observations.push(
      buildFamilyObservation('format', tweet.format, reward, weight),
      buildFamilyObservation('topic', tweet.topic, reward, weight),
      buildFamilyObservation('length', getLengthBucketFromText(tweet.content), reward, weight),
      buildFamilyObservation('hook', featureTags.hook, reward, weight),
      buildFamilyObservation('tone', featureTags.tone, reward, weight),
      buildFamilyObservation('specificity', featureTags.specificity, reward, weight),
      buildFamilyObservation('structure', featureTags.structure, reward, weight),
    );
  }

  return observations.filter((entry): entry is BanditObservation => Boolean(entry));
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
  const grouped = new Map<string, { pulls: number; rewardSum: number; failures: number }>();
  for (const candidate of candidates) {
    grouped.set(candidate, { pulls: 0, rewardSum: 0, failures: 0 });
  }

  for (const observation of observations) {
    if (observation.family !== family) continue;
    const current = grouped.get(observation.arm) || { pulls: 0, rewardSum: 0, failures: 0 };
    current.pulls += observation.weight;
    current.rewardSum += observation.reward * observation.weight;
    if (observation.reward <= 0.35) current.failures += observation.weight;
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

export function buildBanditGlobalPrior({
  performanceHistory,
  sourceAccounts = 0,
}: {
  performanceHistory: TweetPerformance[];
  sourceAccounts?: number;
}): BanditGlobalPrior {
  const prior = createDefaultGlobalPrior();
  const observations = collectFallbackPerformanceObservations(performanceHistory, new Set(), null);
  const totals = new Map<string, { pulls: number; rewardSum: number; failures: number }>();

  for (const observation of observations) {
    const key = `${observation.family}::${observation.arm}`;
    const current = totals.get(key) || { pulls: 0, rewardSum: 0, failures: 0 };
    current.pulls += observation.weight;
    current.rewardSum += observation.reward * observation.weight;
    if (observation.reward <= 0.35) current.failures += observation.weight;
    totals.set(key, current);
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
  prior.totalSamples = performanceHistory.length;
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
  const autopilotHistory = performanceHistory.filter((entry) => entry.source === 'autopilot');
  const trainingHistory = autopilotHistory.length >= 10 ? autopilotHistory : performanceHistory;
  const trainingSource: BanditTrainingSource = autopilotHistory.length >= 10 ? 'autopilot' : 'mixed';

  const scoreThreshold = median(trainingHistory.map((entry) => entry.likes + (entry.retweets * 2) + (entry.replies * 1.5)));
  const baselineScore = baseline ? Math.max(1, baseline.avgLikes + (baseline.avgRetweets * 2)) : 0;
  const successThreshold = Math.max(1, scoreThreshold || 0, baselineScore);

  const episodes = buildOutcomeEpisodes({
    agentId: allTweets[0]?.agentId || 'agent',
    tweets: allTweets,
    signals,
    performanceHistory,
    baseline,
  });
  const coveredTweetIds = new Set(episodes.map((episode) => String(episode.tweetId)));
  const observations = [
    ...collectEpisodeObservations(episodes, allTweets),
    ...collectFallbackPerformanceObservations(performanceHistory, coveredTweetIds, baseline),
    ...collectFeedbackObservations(feedback, allTweets),
  ];

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
    totalPulls: observations.length,
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

function createSyntheticArm(
  family: BanditArmFamily,
  arm: string,
): BanditArmScore {
  return {
    arm,
    family,
    pulls: 0,
    localPulls: 0,
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

export function buildBanditSlotPlan(
  policy: BanditPolicy | null | undefined,
  {
    count,
    explorationRate,
    biasTopics = [],
    sourcePlan = null,
  }: BuildBanditSlotPlanOptions,
): BanditSlotPlan[] {
  if (!policy || count <= 0) return [];

  const exploreCount = count >= 4 ? Math.max(1, Math.round((count * explorationRate) / 100)) : 0;
  const modes = buildModeSequence(count, exploreCount);
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

  for (let slot = 0; slot < count; slot++) {
    const sourceSlot = sourcePlan?.slots[slot] || null;
    const mode = sourceSlot?.mode || modes[slot];
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

    let combo = `${format.arm}::${topic.arm}::${length.arm}::${hook.arm}::${structure.arm}`;
    usedPrimaryCombos.add(`${format.arm}::${topic.arm}::${length.arm}`);
    if (usedCombos.has(combo)) {
      combo = `${combo}::${slot + 1}`;
    }
    usedCombos.add(combo);
    usedFamilies.format.add(format.arm);
    usedFamilies.topic.add(topic.arm);
    usedFamilies.length.add(length.arm);
    usedFamilies.hook.add(hook.arm);
    usedFamilies.tone.add(tone.arm);
    usedFamilies.specificity.add(specificity.arm);
    usedFamilies.structure.add(structure.arm);

    const sourceLane = sourceSlot?.sourceLane || (mode === 'explore' ? 'core_explore_fallback' : 'manual_core_exploit');
    const baseRationale = mode === 'explore'
      ? `Explore ${format.arm}/${topic.arm}/${hook.arm}. Uncertainty is still high, so this slot buys information while staying on-brand.`
      : `Exploit ${format.arm}/${topic.arm}/${hook.arm}. Local reward and posterior mean both support this combination.`;
    const rationale = sourceSlot
      ? `${sourceSlot.plannerReason} ${baseRationale}`
      : baseRationale;

    plans.push({
      slot: slot + 1,
      mode,
      sourceLane,
      format: format.arm,
      topic: topic.arm,
      length: (length.arm as BanditLengthBucket) || 'medium',
      hook: hook.arm,
      tone: tone.arm,
      specificity: specificity.arm,
      structure: structure.arm,
      coverageCluster: `${topic.arm.toLowerCase()}:${hook.arm.toLowerCase()}:${structure.arm.toLowerCase()}`,
      trendTopicId: sourceSlot?.trendTopicId || null,
      trendHeadline: sourceSlot?.trendHeadline || null,
      rationale,
    });
  }

  return plans.slice(0, count);
}
