import { createHash } from 'node:crypto';
import type { Tweet, TweetPerformance } from './types';

export const EDITORIAL_TOPIC_LEARNING_VERSION = 'editorial-topic-outcomes-1';
const DAY = 86_400_000;
const WINDOW_DAYS = 90;
const MINIMUM_MATURE_HOURS = 18;
const MINIMUM_BASELINE_POSTS = 5;
const MINIMUM_TOPIC_POSTS = 2;
const PRIOR_POSTS = 4;
const MAXIMUM_ADJUSTMENT = .12;

/** A subject-allocation prior, never author identity, factual evidence or approval. */
export interface EditorialTopicOutcomePrior {
  id: string;
  topic: string;
  topicKey: string;
  sampleCount: number;
  baselinePostCount: number;
  baselineEngagement: number;
  observedEngagement: number;
  smoothedEngagement: number;
  confidence: number;
  adjustment: number;
  evidenceIds: string[];
  xTweetIds: string[];
  latestMeasuredAt: string;
  positiveBoostSuppressed?: 'recently_committed';
}

export interface EditorialTopicOutcomeLearning {
  version: typeof EDITORIAL_TOPIC_LEARNING_VERSION;
  id: string;
  generatedAt: string;
  windowDays: number;
  minimumMatureHours: number;
  baseline: { postCount: number; meanEngagement: number; evidenceIds: string[] };
  topics: EditorialTopicOutcomePrior[];
}

const round = (value: number) => Number(value.toFixed(6));
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
/** Exact normalized topic labels only. Content overlap never establishes interest. */
export function editorialTopicKey(topic: string): string {
  return topic.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function optionalCount(value: unknown): boolean {
  return value === undefined || value === null || count(value);
}
function isEvaluation(tweet: Tweet): boolean {
  return tweet.experimentHoldout === true || tweet.assessmentReceipt?.evaluationOnly === true;
}

/**
 * Derive a bounded prior from actual official performance rows joined to this
 * account's published originals. Choose one latest valid mature snapshot per
 * exact X ID; never merge metric maxima, project early metrics or use wasViral.
 * No provider/model calls, storage writes, text inspection or new topic creation.
 */
export function buildEditorialTopicOutcomeLearning({ tweets, performance, now = Date.now() }: {
  tweets: Tweet[];
  performance: TweetPerformance[];
  now?: number;
}): EditorialTopicOutcomeLearning {
  if (!Number.isFinite(now)) throw new Error('editorial_topic_learning_invalid_time');
  const owners = new Set(tweets.map(tweet => String(tweet.agentId)).filter(Boolean));
  if (owners.size > 1) throw new Error('editorial_topic_learning_account_mismatch');
  // Any conflicting lifecycle row wins over a stale posted copy of the same ID.
  const allByXId = new Map<string, Tweet[]>();
  for (const tweet of tweets) {
    if (typeof tweet.xTweetId !== 'string' || !/^[1-9]\d{0,29}$/.test(tweet.xTweetId)) continue;
    const entries = allByXId.get(tweet.xTweetId) || [];
    entries.push(tweet);
    allByXId.set(tweet.xTweetId, entries);
  }
  const ownedOriginals = new Map<string, Tweet>();
  for (const [xTweetId, entries] of allByXId) {
    if (entries.some(tweet => tweet.status !== 'posted' || tweet.type !== 'original'
      || Boolean(tweet.quarantinedAt) || isEvaluation(tweet))) continue;
    const ids = new Set(entries.map(tweet => String(tweet.id)));
    if (ids.size !== 1) continue;
    ownedOriginals.set(xTweetId, entries[0]);
  }
  type Sample = { xTweetId: string; topic: string; topicKey: string; checkedAt: string; checked: number;
    postedAt: string; score: number; evidenceId: string };
  const latest = new Map<string, Sample>();
  for (const row of performance) {
    if (typeof row.xTweetId !== 'string') continue;
    const original = ownedOriginals.get(row.xTweetId);
    if (!original || row.tweetId && String(row.tweetId) !== String(original.id)) continue;
    if (!['autopilot', 'manual', 'timeline'].includes(row.source) || row.experimentHoldout === true
      || row.referenceType === 'replied_to' || row.referenceType === 'retweeted') continue;
    const posted = Date.parse(row.postedAt), checked = Date.parse(row.checkedAt);
    const originalPosted = Date.parse(original.postedAt || '');
    if (!Number.isFinite(posted) || !Number.isFinite(checked) || !Number.isFinite(originalPosted)
      || posted > now || checked > now || originalPosted > now
      || Math.abs(posted - originalPosted) > 2000
      || posted < now - WINDOW_DAYS * DAY || originalPosted < now - WINDOW_DAYS * DAY
      || checked - posted < MINIMUM_MATURE_HOURS * 3_600_000
      || checked - originalPosted < MINIMUM_MATURE_HOURS * 3_600_000) continue;
    if (![row.likes, row.retweets, row.replies, row.impressions].every(count)
      || !optionalCount(row.quotes) || !optionalCount(row.bookmarks)
      || typeof row.engagementRate !== 'number' || !Number.isFinite(row.engagementRate) || row.engagementRate < 0) continue;
    const topic = typeof original.topic === 'string' && original.topic.trim()
      ? original.topic.trim() : typeof row.topic === 'string' ? row.topic.trim() : '';
    const key = editorialTopicKey(topic);
    const usableTopic = topic.length <= 160 && !['', 'unknown', 'general'].includes(key);
    // This is observed spread, not a forecast or a sticky viral classification.
    const score = row.likes + row.retweets * 3 + row.replies * 2 + (row.quotes || 0) * 5 + (row.bookmarks || 0) * 4;
    if (!Number.isSafeInteger(score)) continue;
    const evidenceId = `topic-outcome:${digest([original.agentId, original.id, row.xTweetId, original.postedAt,
      usableTopic ? key : '', row.postedAt, row.checkedAt,
      row.likes, row.retweets, row.replies, row.quotes ?? null, row.bookmarks ?? null, row.impressions])}`;
    const sample: Sample = { xTweetId: row.xTweetId, topic: usableTopic ? topic : '', topicKey: usableTopic ? key : '',
      postedAt: row.postedAt, checkedAt: row.checkedAt, checked, score, evidenceId };
    const previous = latest.get(row.xTweetId);
    // Deterministic tie-break; contradictory same-time snapshots cannot choose
    // the largest engagement just because a ledger happened to list it first.
    if (!previous || checked > previous.checked || checked === previous.checked && evidenceId < previous.evidenceId)
      latest.set(row.xTweetId, sample);
  }
  const samples = [...latest.values()].sort((a, b) => a.xTweetId.localeCompare(b.xTweetId));
  const baselineEvidenceIds = samples.map(row => row.evidenceId);
  const learningId = `topic-learning:${digest([EDITORIAL_TOPIC_LEARNING_VERSION, baselineEvidenceIds])}`;
  const baseline = samples.length ? samples.reduce((sum, row) => sum + row.score, 0) / samples.length : 0;
  const grouped = new Map<string, Sample[]>();
  for (const sample of samples) {
    if (!sample.topicKey) continue;
    const group = grouped.get(sample.topicKey) || [];
    group.push(sample); grouped.set(sample.topicKey, group);
  }
  const topics: EditorialTopicOutcomePrior[] = samples.length < MINIMUM_BASELINE_POSTS ? []
    : [...grouped.entries()].filter(([, rows]) => rows.length >= MINIMUM_TOPIC_POSTS).map(([topicKey, rows]) => {
      const total = rows.reduce((sum, row) => sum + row.score, 0);
      const smoothed = (total + baseline * PRIOR_POSTS) / (rows.length + PRIOR_POSTS);
      const confidence = rows.length / (rows.length + PRIOR_POSTS);
      // Smoothing already shrinks sparse data toward the account baseline.
      // One doubling/halving cannot contribute more than the bounded .12.
      const adjustment = Math.max(-MAXIMUM_ADJUSTMENT, Math.min(MAXIMUM_ADJUSTMENT,
        Math.log2((smoothed + 1) / (baseline + 1)) * .12));
      const evidenceIds = rows.map(row => row.evidenceId);
      return { id: `topic-prior:${digest([EDITORIAL_TOPIC_LEARNING_VERSION, topicKey, learningId, evidenceIds])}`,
        topic: [...rows].sort((a, b) => b.checked - a.checked || a.evidenceId.localeCompare(b.evidenceId))[0].topic,
        topicKey, sampleCount: rows.length, baselinePostCount: samples.length, baselineEngagement: round(baseline),
        observedEngagement: round(total / rows.length), smoothedEngagement: round(smoothed), confidence: round(confidence),
        adjustment: round(adjustment), evidenceIds, xTweetIds: rows.map(row => row.xTweetId),
        latestMeasuredAt: [...rows].sort((a, b) => b.checked - a.checked)[0].checkedAt };
    }).sort((a, b) => b.adjustment - a.adjustment || a.topicKey.localeCompare(b.topicKey));
  return { version: EDITORIAL_TOPIC_LEARNING_VERSION,
    id: learningId,
    generatedAt: new Date(now).toISOString(), windowDays: WINDOW_DAYS, minimumMatureHours: MINIMUM_MATURE_HOURS,
    baseline: { postCount: samples.length, meanEngagement: round(baseline), evidenceIds: baselineEvidenceIds }, topics };
}

/** Apply only to a topic already established by the ordinary account selector. */
export function editorialTopicOutcomePriorFor(learning: EditorialTopicOutcomeLearning | null | undefined,
  topic: string, recentlyCommitted = false): EditorialTopicOutcomePrior | undefined {
  if (learning?.version !== EDITORIAL_TOPIC_LEARNING_VERSION || learning.baseline.postCount < MINIMUM_BASELINE_POSTS) return undefined;
  const prior = learning?.topics.find(row => row.topicKey === editorialTopicKey(topic));
  if (!prior || prior.sampleCount < MINIMUM_TOPIC_POSTS || !Number.isFinite(prior.adjustment)) return undefined;
  const adjustment = Math.max(-MAXIMUM_ADJUSTMENT, Math.min(MAXIMUM_ADJUSTMENT, prior.adjustment));
  return { ...prior, evidenceIds: [...prior.evidenceIds], xTweetIds: [...prior.xTweetIds],
    adjustment, ...(recentlyCommitted && adjustment > 0
      ? { adjustment: 0, positiveBoostSuppressed: 'recently_committed' as const } : {}) };
}
