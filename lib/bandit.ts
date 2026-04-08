import type { FeedbackEntry, Tweet, TweetPerformance } from './types';

export type BanditLengthBucket = 'short' | 'medium' | 'long';
export type BanditTrainingSource = 'autopilot' | 'mixed';

export interface BanditArmScore {
  arm: string;
  pulls: number;
  successes: number;
  failures: number;
  meanReward: number;
  explorationBonus: number;
  ucbScore: number;
  coldStart: boolean;
}

export interface BanditPolicy {
  trainingSource: BanditTrainingSource;
  totalPulls: number;
  successThreshold: number;
  formatArms: BanditArmScore[];
  topicArms: BanditArmScore[];
  lengthArms: BanditArmScore[];
  summary: string[];
}

export interface BanditSlotPlan {
  slot: number;
  mode: 'exploit' | 'explore';
  format: string;
  topic: string;
  length: BanditLengthBucket;
  rationale: string;
}

interface BanditObservation {
  arm: string;
  reward: number;
  weight: number;
}

interface BuildBanditPolicyOptions {
  performanceHistory: TweetPerformance[];
  feedback: FeedbackEntry[];
  allTweets: Tweet[];
  allowedFormats: string[];
  candidateTopics: string[];
}

interface BuildBanditSlotPlanOptions {
  count: number;
  explorationRate: number;
  biasTopics?: string[];
}

interface MutableArmStats {
  pulls: number;
  rewardSum: number;
  failures: number;
}

const PRIOR_PULLS = 2;
const PRIOR_REWARD_SUM = 1;
const BANDIT_HALF_LIFE_DAYS = 21;

function weightedScore(entry: TweetPerformance): number {
  return entry.likes + entry.retweets + (entry.replies * 2);
}

function recencyWeight(ts: string): number {
  const ageMs = Math.max(0, Date.now() - new Date(ts).getTime());
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return Math.pow(0.5, ageDays / BANDIT_HALF_LIFE_DAYS);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function getLengthBucketFromText(content: string): BanditLengthBucket {
  const length = content.length;
  if (length < 200) return 'short';
  if (length < 500) return 'medium';
  return 'long';
}

function toCandidateList(values: Array<string | null | undefined>): string[] {
  return [...new Set(values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => value.toLowerCase() !== 'unknown'))];
}

function buildArmScores(candidates: string[], observations: BanditObservation[]): BanditArmScore[] {
  const stats = new Map<string, MutableArmStats>();
  for (const candidate of candidates) {
    stats.set(candidate, { pulls: 0, rewardSum: 0, failures: 0 });
  }

  for (const observation of observations) {
    const arm = observation.arm;
    if (!stats.has(arm)) {
      stats.set(arm, { pulls: 0, rewardSum: 0, failures: 0 });
    }
    const current = stats.get(arm)!;
    current.pulls += observation.weight;
    current.rewardSum += observation.reward * observation.weight;
    if (observation.reward === 0) current.failures += observation.weight;
  }

  const totalPulls = [...stats.values()].reduce((sum, entry) => sum + entry.pulls, 0);
  const denominatorBase = Math.log(totalPulls + stats.size + 1);

  return [...stats.entries()]
    .map(([arm, stat]) => {
      const coldStart = stat.pulls === 0;
      const effectivePulls = stat.pulls + PRIOR_PULLS;
      const meanReward = (stat.rewardSum + PRIOR_REWARD_SUM) / effectivePulls;
      const explorationBonus = Math.sqrt((2 * denominatorBase) / effectivePulls);
      return {
        arm,
        pulls: Number(stat.pulls.toFixed(3)),
        successes: Number(stat.rewardSum.toFixed(3)),
        failures: Number(stat.failures.toFixed(3)),
        meanReward: Number(meanReward.toFixed(4)),
        explorationBonus: Number(explorationBonus.toFixed(4)),
        ucbScore: Number((meanReward + explorationBonus).toFixed(4)),
        coldStart,
      };
    })
    .sort((a, b) => b.ucbScore - a.ucbScore || b.meanReward - a.meanReward || a.arm.localeCompare(b.arm));
}

export function buildBanditPolicy({
  performanceHistory,
  feedback,
  allTweets,
  allowedFormats,
  candidateTopics,
}: BuildBanditPolicyOptions): BanditPolicy {
  const autopilotHistory = performanceHistory.filter((entry) => entry.source === 'autopilot');
  const trainingHistory = autopilotHistory.length >= 10 ? autopilotHistory : performanceHistory;
  const trainingSource: BanditTrainingSource = autopilotHistory.length >= 10 ? 'autopilot' : 'mixed';

  const scoreThreshold = median(trainingHistory.map(weightedScore));
  const successThreshold = scoreThreshold > 0 ? scoreThreshold : 1;

  const tweetById = new Map(allTweets.map((tweet) => [String(tweet.id), tweet]));
  const formatObservations: BanditObservation[] = [];
  const topicObservations: BanditObservation[] = [];
  const lengthObservations: BanditObservation[] = [];

  for (const entry of trainingHistory) {
    const reward = weightedScore(entry) >= successThreshold ? 1 : 0;
    const weight = recencyWeight(entry.checkedAt);
    const lengthBucket = getLengthBucketFromText(entry.content);
    if (entry.format && entry.format !== 'unknown') {
      formatObservations.push({ arm: entry.format, reward, weight });
    }
    if (entry.topic && entry.topic !== 'unknown') {
      topicObservations.push({ arm: entry.topic, reward, weight });
    }
    lengthObservations.push({ arm: lengthBucket, reward, weight });
  }

  for (const entry of feedback) {
    if (entry.rating !== 'down' || !entry.tweetId) continue;
    const tweet = tweetById.get(String(entry.tweetId));
    if (!tweet) continue;
    const weight = recencyWeight(entry.generatedAt) * (entry.userProvidedReason ? 1.25 : 1);
    const lengthBucket = getLengthBucketFromText(tweet.content);
    if (tweet.format && tweet.format !== 'unknown') {
      formatObservations.push({ arm: tweet.format, reward: 0, weight });
    }
    if (tweet.topic && tweet.topic !== 'unknown') {
      topicObservations.push({ arm: tweet.topic, reward: 0, weight });
    }
    lengthObservations.push({ arm: lengthBucket, reward: 0, weight });
  }

  const formatCandidates = toCandidateList([
    ...allowedFormats,
    ...trainingHistory.map((entry) => entry.format),
  ]);
  const topicCandidates = toCandidateList([
    ...candidateTopics,
    ...trainingHistory.map((entry) => entry.topic),
  ]);
  const lengthCandidates: BanditLengthBucket[] = ['short', 'medium', 'long'];

  const formatArms = buildArmScores(formatCandidates, formatObservations);
  const topicArms = buildArmScores(topicCandidates, topicObservations);
  const lengthArms = buildArmScores(lengthCandidates, lengthObservations);
  const exploitFormat = sortExploit(formatArms)[0];
  const exploitTopic = sortExploit(topicArms)[0];
  const exploreFormat = sortExplore(formatArms).find((arm) => arm.coldStart) || sortExplore(formatArms)[0];
  const exploreTopic = sortExplore(topicArms).find((arm) => arm.coldStart) || sortExplore(topicArms)[0];

  const summary = [
    exploitFormat ? `Exploit format: ${exploitFormat.arm} (${Math.round(exploitFormat.meanReward * 100)}% reward)` : '',
    exploitTopic ? `Exploit topic: ${exploitTopic.arm} (${Math.round(exploitTopic.meanReward * 100)}% reward)` : '',
    exploreFormat ? `Explore format: ${exploreFormat.arm}` : '',
    exploreTopic ? `Explore topic: ${exploreTopic.arm}` : '',
  ].filter(Boolean);

  return {
    trainingSource,
    totalPulls: trainingHistory.length,
    successThreshold,
    formatArms,
    topicArms,
    lengthArms,
    summary,
  };
}

function uniquePreservingOrder(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sortExploit(arms: BanditArmScore[]): BanditArmScore[] {
  return [...arms].sort((a, b) =>
    b.meanReward - a.meanReward || b.pulls - a.pulls || b.ucbScore - a.ucbScore || a.arm.localeCompare(b.arm)
  );
}

function sortExplore(arms: BanditArmScore[]): BanditArmScore[] {
  return [...arms].sort((a, b) =>
    b.ucbScore - a.ucbScore || a.pulls - b.pulls || b.meanReward - a.meanReward || a.arm.localeCompare(b.arm)
  );
}

function pickArm(
  ranking: BanditArmScore[],
  used: Set<string>,
  fallback: string,
): BanditArmScore {
  const fresh = ranking.find((arm) => !used.has(arm.arm));
  return fresh || ranking[0] || {
    arm: fallback,
    pulls: 0,
    successes: 0,
    failures: 0,
    meanReward: 0.5,
    explorationBonus: 0,
    ucbScore: 0.5,
    coldStart: true,
  };
}

function buildArmOrder(
  ranking: BanditArmScore[],
  used: Set<string>,
  fallback: string,
): BanditArmScore[] {
  const ordered: BanditArmScore[] = [];
  const seen = new Set<string>();
  const fallbackArm = pickArm(ranking, new Set<string>(), fallback);

  for (const candidate of [...ranking.filter((arm) => !used.has(arm.arm)), ...ranking, fallbackArm]) {
    if (seen.has(candidate.arm)) continue;
    seen.add(candidate.arm);
    ordered.push(candidate);
  }

  return ordered;
}

function buildModeSequence(count: number, exploreCount: number): Array<'exploit' | 'explore'> {
  const modes: Array<'exploit' | 'explore'> = [];
  for (let i = 0; i < count; i++) {
    modes.push('exploit');
  }
  if (exploreCount <= 0) return modes;

  const step = count / exploreCount;
  for (let i = 0; i < exploreCount; i++) {
    const index = Math.min(count - 1, Math.floor((i + 0.5) * step));
    modes[index] = 'explore';
  }
  return modes;
}

export function buildBanditSlotPlan(
  policy: BanditPolicy | null | undefined,
  {
    count,
    explorationRate,
    biasTopics = [],
  }: BuildBanditSlotPlanOptions,
): BanditSlotPlan[] {
  if (!policy || count <= 0) return [];

  const exploreCount = count >= 4 ? Math.max(1, Math.round((count * explorationRate) / 100)) : 0;
  const modes = buildModeSequence(count, exploreCount);
  const exploitFormats = sortExploit(policy.formatArms);
  const exploitTopics = sortExploit(policy.topicArms);
  const exploitLengths = sortExploit(policy.lengthArms);
  const exploreFormats = sortExplore(policy.formatArms);
  const exploreTopics = sortExplore(policy.topicArms);
  const exploreLengths = sortExplore(policy.lengthArms);
  const priorityTopics = uniquePreservingOrder(biasTopics);

  const usedCombos = new Set<string>();
  const usedFormats = new Set<string>();
  const usedTopics = new Set<string>();
  const usedLengths = new Set<string>();
  let priorityTopicIndex = 0;

  const plans: BanditSlotPlan[] = [];
  for (let slot = 0; slot < count; slot++) {
    const mode = modes[slot];
    const formatCandidates = buildArmOrder(
      mode === 'explore' ? exploreFormats : exploitFormats,
      usedFormats,
      exploitFormats[0]?.arm || 'hot_take',
    );
    let topicCandidates = buildArmOrder(
      mode === 'explore' ? exploreTopics : exploitTopics,
      usedTopics,
      exploitTopics[0]?.arm || 'general',
    );
    if (priorityTopicIndex < priorityTopics.length) {
      const desired = priorityTopics[priorityTopicIndex];
      priorityTopicIndex++;
      const desiredArm = (policy.topicArms.find((arm) => arm.arm.toLowerCase() === desired.toLowerCase()) || {
        arm: desired,
        pulls: 0,
        successes: 0,
        failures: 0,
        meanReward: 0.5,
        explorationBonus: 0.75,
        ucbScore: 1.25,
        coldStart: true,
      });
      topicCandidates = [desiredArm, ...topicCandidates.filter((arm) => arm.arm.toLowerCase() !== desired.toLowerCase())];
    }
    const lengthCandidates = buildArmOrder(
      mode === 'explore' ? exploreLengths : exploitLengths,
      usedLengths,
      exploitLengths[0]?.arm || 'medium',
    );

    let chosenFormatArm = formatCandidates[0];
    let chosenTopicArm = topicCandidates[0];
    let chosenLengthArm = lengthCandidates[0];
    let combo = `${chosenFormatArm.arm}::${chosenTopicArm.arm}::${chosenLengthArm.arm}`;

    for (const formatCandidate of formatCandidates) {
      let found = false;
      for (const topicCandidate of topicCandidates) {
        for (const lengthCandidate of lengthCandidates) {
          const candidateCombo = `${formatCandidate.arm}::${topicCandidate.arm}::${lengthCandidate.arm}`;
          if (usedCombos.has(candidateCombo)) continue;
          chosenFormatArm = formatCandidate;
          chosenTopicArm = topicCandidate;
          chosenLengthArm = lengthCandidate;
          combo = candidateCombo;
          found = true;
          break;
        }
        if (found) break;
      }
      if (found) break;
    }

    usedCombos.add(combo);
    usedFormats.add(chosenFormatArm.arm);
    usedTopics.add(chosenTopicArm.arm);
    usedLengths.add(chosenLengthArm.arm);

    const rationale = mode === 'explore'
      ? `Explore ${chosenFormatArm.arm} on ${chosenTopicArm.arm}. UCB favors this under-tested arm at ${chosenFormatArm.ucbScore.toFixed(2)}.`
      : `Exploit ${chosenFormatArm.arm} on ${chosenTopicArm.arm}. Mean reward is ${Math.round(chosenFormatArm.meanReward * 100)}% with ${chosenFormatArm.pulls.toFixed(1)} pulls.`;

    plans.push({
      slot: slot + 1,
      mode,
      format: chosenFormatArm.arm,
      topic: chosenTopicArm.arm,
      length: (chosenLengthArm.arm as BanditLengthBucket) || 'medium',
      rationale,
    });
  }

  return plans;
}
