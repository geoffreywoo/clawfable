import { createHash } from 'node:crypto';
import type { Tweet, TweetPerformance, TweetStatus } from './types';
import { significantResearchTokens } from './research-utils';
import { collapsePerformanceSnapshots } from './performance-history';
import { buildPerformanceSignalBaseline, computeRelativeSpreadSignal, isMaturePerformance } from './performance-signals';

export const ORIGINAL_REPETITION_POLICY_VERSION = 'original-repetition-2026-10-22-v1';

/** Product defaults, not a numeric instruction attributed to the owner. */
export interface OriginalRepetitionPolicy {
  version: typeof ORIGINAL_REPETITION_POLICY_VERSION;
  minimumDaysBetweenReturns: number;
  minimumInterveningOriginals: number;
  maximumReturnsPerPosts: number;
  minimumMatureHours: number;
  minimumMatureBaselinePosts: number;
  viralLikesMultiple: number;
  minimumViralLikes: number;
  fallbackViralLikesThreshold: number;
  minimumRelativeSpreadScore: number;
  maximumComparators: number;
  maximumPostCharacters: number;
  maximumContextCharacters: number;
}

const POLICY: OriginalRepetitionPolicy = Object.freeze({
  version: ORIGINAL_REPETITION_POLICY_VERSION,
  minimumDaysBetweenReturns: 14,
  minimumInterveningOriginals: 20,
  maximumReturnsPerPosts: 10,
  minimumMatureHours: 18,
  minimumMatureBaselinePosts: 5,
  viralLikesMultiple: 3,
  minimumViralLikes: 10,
  fallbackViralLikesThreshold: 30,
  minimumRelativeSpreadScore: 0.78,
  maximumComparators: 24,
  maximumPostCharacters: 1200,
  maximumContextCharacters: 20_000,
});

export interface OriginalViralEvidence {
  source: 'official_x_performance_history';
  snapshotId: string;
  xTweetId: string;
  postedAt: string;
  checkedAt: string;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  quotes?: number;
  bookmarks?: number;
  baselineLikes: number;
  baselinePosts: number;
  viralLikesThreshold: number;
  measuredRelativeSpread: number;
  metricCoverage: number;
  criterion: 'mature_likes_breakout' | 'mature_relative_spread';
}

interface RepetitionFamily {
  tweetIds: string[];
  latestPostedAt: string | null;
  latestPostStatus: 'posted' | 'deleted_from_x' | null;
  interveningOriginals: number;
  queuedTweetIds: string[];
}

export interface OriginalRepetitionComparator {
  tweetId: string;
  xTweetId?: string;
  content: string;
  contentHash: string;
  status: TweetStatus;
  postedAt: string | null;
  reuseEligible: boolean;
  eligibilityReasons: string[];
  family: RepetitionFamily;
  viralEvidence?: OriginalViralEvidence;
}

export type OriginalRepetitionComparedPost = Omit<OriginalRepetitionComparator, 'content'>;

interface OriginalRepetitionHistory {
  viralLikesThreshold: number;
  originalCount: number;
  queuedCount: number;
  deletedCount: number;
  recentOriginals: Array<{ tweetId: string; postedAt: string; returning: boolean }>;
  queuedReturnIds: string[];
  omittedOversizePosts: number;
  omittedComparatorCount: number;
}

export interface OriginalRepetitionContext {
  version: typeof ORIGINAL_REPETITION_POLICY_VERSION;
  observedAt: string;
  queryHash: string;
  policy: OriginalRepetitionPolicy;
  history: OriginalRepetitionHistory;
  comparators: OriginalRepetitionComparator[];
}

/** Model comparison data; full proof metadata stays in the durable server context. */
export function compactOriginalRepetitionContext(context: OriginalRepetitionContext) {
  return {
    version: context.version,
    observedAt: context.observedAt,
    policy: context.policy,
    history: { viralLikesThreshold: context.history.viralLikesThreshold, originalCount: context.history.originalCount,
      queuedCount: context.history.queuedCount, deletedCount: context.history.deletedCount,
      omittedOversizePosts: context.history.omittedOversizePosts, omittedComparatorCount: context.history.omittedComparatorCount },
    comparators: context.comparators.map(post => ({ tweetId: post.tweetId, content: post.content, status: post.status,
      postedAt: post.postedAt, reuseEligible: post.reuseEligible, eligibilityReasons: post.eligibilityReasons })),
  };
}

export interface OriginalRepetitionAssessment {
  verdict: 'fresh' | 'repeat' | 'uncertain';
  matchedTweetIds: string[];
  explanation: string;
}

export interface OriginalRepetitionProof {
  version: typeof ORIGINAL_REPETITION_POLICY_VERSION;
  observedAt: string;
  contentHash: string;
  contextHash: string;
  queryHash: string;
  policy: OriginalRepetitionPolicy;
  history: OriginalRepetitionHistory;
  assessment: OriginalRepetitionAssessment;
  comparedPosts: OriginalRepetitionComparedPost[];
  matchedPosts: OriginalRepetitionComparedPost[];
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : NaN;
const validId = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value === value.trim() && value.length <= 200;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown): value is number => nonnegative(value) && Number.isInteger(value);
const unique = (values: string[]) => [...new Set(values)];
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const normalizedCopy = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function comparedPost(comparator: OriginalRepetitionComparator): OriginalRepetitionComparedPost {
  const { content: _content, ...post } = comparator;
  return structuredClone(post);
}

function contextHash(context: Pick<OriginalRepetitionContext, 'version' | 'observedAt' | 'queryHash' | 'policy' | 'history'> & {
  comparedPosts: OriginalRepetitionComparedPost[];
}): string {
  return hash({ version: context.version, observedAt: context.observedAt, queryHash: context.queryHash,
    policy: context.policy, history: context.history, comparedPosts: context.comparedPosts });
}

export function parseOriginalRepetitionAssessment(value: unknown): OriginalRepetitionAssessment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as OriginalRepetitionAssessment;
  if (Object.keys(row).some(key => !['verdict', 'matchedTweetIds', 'explanation'].includes(key))
    || !['fresh', 'repeat', 'uncertain'].includes(row.verdict)
    || !Array.isArray(row.matchedTweetIds) || row.matchedTweetIds.length > POLICY.maximumComparators
    || !row.matchedTweetIds.every(validId) || unique(row.matchedTweetIds).length !== row.matchedTweetIds.length
    || typeof row.explanation !== 'string' || !row.explanation.trim() || row.explanation.length > 1500
    || row.verdict === 'fresh' && row.matchedTweetIds.length !== 0
    || row.verdict === 'repeat' && row.matchedTweetIds.length === 0) return null;
  return { verdict: row.verdict, matchedTweetIds: [...row.matchedTweetIds], explanation: row.explanation };
}

function isValidHistory(value: OriginalRepetitionHistory): boolean {
  return Boolean(value && nonnegative(value.viralLikesThreshold) && value.viralLikesThreshold > 0
    && count(value.originalCount) && count(value.queuedCount) && count(value.deletedCount)
    && count(value.omittedOversizePosts) && count(value.omittedComparatorCount)
    && Array.isArray(value.recentOriginals) && value.recentOriginals.length < POLICY.maximumReturnsPerPosts
    && value.recentOriginals.every(row => validId(row.tweetId) && Number.isFinite(date(row.postedAt)) && typeof row.returning === 'boolean')
    && Array.isArray(value.queuedReturnIds) && value.queuedReturnIds.every(validId)
    && unique(value.queuedReturnIds).length === value.queuedReturnIds.length);
}

function isValidComparedPost(post: OriginalRepetitionComparedPost): boolean {
  const evidence = post?.viralEvidence;
  return Boolean(post && validId(post.tweetId) && validHash(post.contentHash)
    && (!post.xTweetId || validId(post.xTweetId))
    && ['queued', 'posted', 'deleted_from_x'].includes(post.status)
    && (post.postedAt === null || Number.isFinite(date(post.postedAt)))
    && typeof post.reuseEligible === 'boolean' && Array.isArray(post.eligibilityReasons)
    && post.eligibilityReasons.length > 0 && post.eligibilityReasons.every(reason => typeof reason === 'string' && reason.length > 0)
    && post.family && Array.isArray(post.family.tweetIds) && post.family.tweetIds.includes(post.tweetId)
    && post.family.tweetIds.every(validId) && unique(post.family.tweetIds).length === post.family.tweetIds.length
    && (post.family.latestPostedAt === null || Number.isFinite(date(post.family.latestPostedAt)))
    && (post.family.latestPostStatus === null || ['posted', 'deleted_from_x'].includes(post.family.latestPostStatus))
    && (post.family.latestPostedAt === null) === (post.family.latestPostStatus === null)
    && count(post.family.interveningOriginals) && Array.isArray(post.family.queuedTweetIds) && post.family.queuedTweetIds.every(validId)
    && unique(post.family.queuedTweetIds).length === post.family.queuedTweetIds.length
    && post.family.queuedTweetIds.every(id => post.family.tweetIds.includes(id))
    && (!evidence || (evidence.source === 'official_x_performance_history' && validId(evidence.snapshotId)
      && validId(evidence.xTweetId) && evidence.xTweetId === post.xTweetId
      && Number.isFinite(date(evidence.postedAt)) && Number.isFinite(date(evidence.checkedAt))
      && Number.isFinite(date(post.postedAt)) && Math.abs(date(evidence.postedAt) - date(post.postedAt)) <= 2000
      && date(evidence.checkedAt) - date(evidence.postedAt) >= POLICY.minimumMatureHours * 60 * 60 * 1000
      && ['likes', 'retweets', 'replies', 'impressions', 'baselineLikes', 'baselinePosts', 'measuredRelativeSpread', 'metricCoverage']
        .every(key => nonnegative(evidence[key]))
      && nonnegative(evidence.viralLikesThreshold) && evidence.viralLikesThreshold > 0
      && count(evidence.baselinePosts) && evidence.baselinePosts >= POLICY.minimumMatureBaselinePosts
      && evidence.measuredRelativeSpread <= 1 && evidence.metricCoverage <= 1
      && (evidence.quotes === undefined || nonnegative(evidence.quotes))
      && (evidence.bookmarks === undefined || nonnegative(evidence.bookmarks))
      && (evidence.criterion === 'mature_likes_breakout'
        ? evidence.likes >= Math.max(evidence.viralLikesThreshold, POLICY.minimumViralLikes, evidence.baselineLikes * POLICY.viralLikesMultiple)
        : evidence.criterion === 'mature_relative_spread' && evidence.measuredRelativeSpread >= POLICY.minimumRelativeSpreadScore)))
    && (!post.reuseEligible || (post.status === 'posted' && Boolean(evidence) && post.family.latestPostStatus === 'posted' && post.family.queuedTweetIds.length === 0
      && same(post.eligibilityReasons, ['mature_viral_proof_and_spacing_met'])
      && post.family.interveningOriginals >= POLICY.minimumInterveningOriginals)));
}

function clearsFamilySpacing(post: OriginalRepetitionComparedPost, observedAt: number): boolean {
  return post.status === 'posted' && validId(post.xTweetId) && Number.isFinite(date(post.postedAt))
    && post.family.latestPostStatus === 'posted' && Boolean(post.family.latestPostedAt)
    && observedAt - date(post.family.latestPostedAt) >= POLICY.minimumDaysBetweenReturns * 24 * 60 * 60 * 1000
    && post.family.interveningOriginals >= POLICY.minimumInterveningOriginals && post.family.queuedTweetIds.length === 0;
}

/** Receipt validation does not make a new performance or semantic judgment. */
export function isValidOriginalRepetitionProof(value: unknown): value is OriginalRepetitionProof {
  const proof = value as OriginalRepetitionProof;
  if (!proof || proof.version !== ORIGINAL_REPETITION_POLICY_VERSION || !Number.isFinite(date(proof.observedAt))
    || !validHash(proof.contentHash) || !validHash(proof.contextHash) || !validHash(proof.queryHash)
    || !same(proof.policy, POLICY) || !isValidHistory(proof.history)
    || !Array.isArray(proof.comparedPosts) || proof.comparedPosts.length > POLICY.maximumComparators
    || !proof.comparedPosts.every(post => isValidComparedPost(post)
      && (!post.viralEvidence || date(post.viralEvidence.checkedAt) <= date(proof.observedAt))
      && (!post.viralEvidence || post.viralEvidence.viralLikesThreshold === proof.history.viralLikesThreshold)
      && (!post.family.latestPostedAt || date(post.family.latestPostedAt) <= date(proof.observedAt)))
    || unique(proof.comparedPosts.map(post => post.tweetId)).length !== proof.comparedPosts.length
    || !Array.isArray(proof.matchedPosts) || !parseOriginalRepetitionAssessment(proof.assessment)
    || proof.assessment.verdict === 'uncertain') return false;
  if (proof.contextHash !== contextHash(proof)) return false;
  const matched = proof.assessment.matchedTweetIds.map(id => proof.comparedPosts.find(post => post.tweetId === id));
  if (matched.some(post => !post) || !same(matched, proof.matchedPosts)) return false;
  // One measured winner can anchor the take family. Later returns need not
  // independently go viral, but every matched original must clear the live
  // family's spacing and publication boundaries.
  return proof.assessment.verdict === 'fresh' || matched.some(post => post.reuseEligible && Boolean(post.viralEvidence))
    && matched.every(post => clearsFamilySpacing(post, date(proof.observedAt)))
    && proof.history.queuedReturnIds.length === 0 && !proof.history.recentOriginals.some(post => post.returning);
}

function storedProofValue(tweet: Pick<Tweet, 'assessmentReceipt'> & Record<string, unknown>): unknown {
  const receipt = tweet.assessmentReceipt as (Tweet['assessmentReceipt'] & { repetition?: unknown }) | undefined;
  const decision = receipt?.editorialDecision as typeof receipt.editorialDecision & { repetition?: unknown };
  if (decision?.repetition !== undefined) return decision.repetition;
  if (receipt?.repetition !== undefined) return receipt.repetition;
  return tweet.originalRepetition;
}

function storedProof(tweet: Pick<Tweet, 'assessmentReceipt'> & { content?: string } & Record<string, unknown>): OriginalRepetitionProof | null {
  const value = storedProofValue(tweet);
  return isValidOriginalRepetitionProof(value) && (typeof tweet.content !== 'string' || value.contentHash === hash(tweet.content)) ? value : null;
}

function originalRows(tweets: Tweet[]): Tweet[] {
  const byId = new Map<string, Tweet>();
  for (const tweet of tweets) {
    if (!validId(tweet?.id) || tweet.type !== 'original' || typeof tweet.content !== 'string' || !tweet.content.trim()
      || !['queued', 'posted', 'deleted_from_x'].includes(tweet.status) || tweet.status === 'queued' && Boolean(tweet.quarantinedAt)) continue;
    if (!byId.has(tweet.id)) byId.set(tweet.id, tweet);
  }
  return [...byId.values()];
}

function published(tweet: Tweet, now: number): boolean {
  return ['posted', 'deleted_from_x'].includes(tweet.status) && validId(tweet.xTweetId)
    && Number.isFinite(date(tweet.postedAt)) && date(tweet.postedAt) <= now;
}

function buildFamilies(rows: Tweet[]): Map<string, Set<string>> {
  const edges = new Map(rows.map(tweet => [tweet.id, new Set([tweet.id])]));
  for (const tweet of rows) {
    const proof = storedProof(tweet as Tweet & Record<string, unknown>);
    if (proof?.assessment.verdict !== 'repeat') continue;
    for (const post of proof.matchedPosts) {
      if (!edges.has(post.tweetId)) edges.set(post.tweetId, new Set([post.tweetId]));
      edges.get(tweet.id)!.add(post.tweetId);
      edges.get(post.tweetId)!.add(tweet.id);
    }
  }
  const result = new Map<string, Set<string>>();
  for (const id of edges.keys()) {
    if (result.has(id)) continue;
    const family = new Set<string>(), pending = [id];
    while (pending.length) {
      const next = pending.pop()!;
      if (family.has(next)) continue;
      family.add(next);
      for (const linked of edges.get(next) || []) if (!family.has(linked)) pending.push(linked);
    }
    for (const member of family) result.set(member, family);
  }
  return result;
}

function familyState(id: string, rows: Tweet[], families: Map<string, Set<string>>, now: number): RepetitionFamily {
  const members = families.get(id) || new Set([id]);
  const familyRows = rows.filter(tweet => members.has(tweet.id));
  const latest = familyRows.filter(tweet => published(tweet, now)).sort((a, b) => date(b.postedAt) - date(a.postedAt))[0];
  const latestAt = latest?.postedAt || null;
  return { tweetIds: [...members].sort(), latestPostedAt: latestAt, latestPostStatus: latest ? latest.status as 'posted' | 'deleted_from_x' : null,
    interveningOriginals: latestAt ? rows.filter(tweet => published(tweet, now) && date(tweet.postedAt) > date(latestAt) && !members.has(tweet.id)).length : 0,
    queuedTweetIds: familyRows.filter(tweet => tweet.status === 'queued').map(tweet => tweet.id).sort() };
}

function validPerformance(row: TweetPerformance, now: number): boolean {
  return validId(row.xTweetId) && typeof row.content === 'string' && Boolean(row.content.trim())
    && ['manual', 'autopilot', 'timeline'].includes(row.source) && !row.referenceType && row.isTextComplete !== false
    && isMaturePerformance(row) && date(row.checkedAt) <= now && date(row.postedAt) <= now
    && ['likes', 'retweets', 'replies', 'impressions', 'engagementRate'].every(key => nonnegative(row[key]))
    && (row.quotes === undefined || nonnegative(row.quotes)) && (row.bookmarks === undefined || nonnegative(row.bookmarks));
}

export function buildOriginalRepetitionContext(input: {
  tweets: Tweet[]; performance: TweetPerformance[]; query: string; now?: number; viralLikesThreshold?: number;
}): OriginalRepetitionContext {
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now) || typeof input.query !== 'string') throw new Error('original_repetition_invalid_input');
  const viralLikesThreshold = nonnegative(input.viralLikesThreshold) && input.viralLikesThreshold > 0
    ? input.viralLikesThreshold : POLICY.fallbackViralLikesThreshold;
  const rows = originalRows(input.tweets), families = buildFamilies(rows);
  const ownerIds = new Set(rows.map(row => row.agentId).filter(Boolean));
  if (ownerIds.size > 1) throw new Error('original_repetition_account_mismatch');
  const ownerId = [...ownerIds][0];
  // Filter before collapse: an early projected viral flag cannot mature by merge.
  const measured = collapsePerformanceSnapshots(input.performance.filter(row => validPerformance(row, now)
    && (!(row as TweetPerformance & { agentId?: string }).agentId || (row as TweetPerformance & { agentId?: string }).agentId === ownerId)));
  const baseline = buildPerformanceSignalBaseline(measured);
  const publishedRows = rows.filter(tweet => published(tweet, now)).sort((a, b) => date(b.postedAt) - date(a.postedAt) || a.id.localeCompare(b.id));
  const queuedReturnIds = rows.filter(tweet => tweet.status === 'queued' && storedProof(tweet as Tweet & Record<string, unknown>)?.assessment.verdict === 'repeat').map(tweet => tweet.id).sort();
  const recentOriginals = publishedRows.slice(0, POLICY.maximumReturnsPerPosts - 1).map(tweet => ({
    tweetId: tweet.id, postedAt: tweet.postedAt!, returning: storedProof(tweet as Tweet & Record<string, unknown>)?.assessment.verdict === 'repeat',
  }));
  const comparators = rows.map((tweet): OriginalRepetitionComparator => {
    const family = familyState(tweet.id, rows, families, now);
    const metric = measured.find(entry => entry.xTweetId === tweet.xTweetId && entry.content === tweet.content
      && (!entry.tweetId || entry.tweetId === tweet.id)
      && Number.isFinite(date(tweet.postedAt)) && Math.abs(date(entry.postedAt) - date(tweet.postedAt)) <= 2000);
    const spread = metric ? computeRelativeSpreadSignal(metric, baseline) : null;
    const likesBreakout = metric && metric.likes >= Math.max(viralLikesThreshold, POLICY.minimumViralLikes, baseline.likes * POLICY.viralLikesMultiple);
    const proven = metric && baseline.sampleCount >= POLICY.minimumMatureBaselinePosts && !spread.projectedTo24Hours
      && (likesBreakout || spread.score >= POLICY.minimumRelativeSpreadScore);
    const reasons: string[] = [];
    if (tweet.status !== 'posted' || !published(tweet, now)) reasons.push(tweet.status === 'queued' ? 'queued_take_reserved' : tweet.status === 'deleted_from_x' ? 'deleted_post_not_reusable' : 'publication_time_unavailable');
    if (!proven) reasons.push('mature_viral_evidence_unavailable');
    if (!family.latestPostedAt || now - date(family.latestPostedAt) < POLICY.minimumDaysBetweenReturns * 24 * 60 * 60 * 1000) reasons.push('minimum_spacing_not_met');
    if (family.latestPostStatus === 'deleted_from_x') reasons.push('latest_return_deleted');
    if (family.interveningOriginals < POLICY.minimumInterveningOriginals) reasons.push('minimum_intervening_originals_not_met');
    if (family.queuedTweetIds.length) reasons.push('same_take_already_queued');
    if (queuedReturnIds.length || recentOriginals.some(post => post.returning)) reasons.push('return_share_reserved');
    const viralEvidence: OriginalViralEvidence | undefined = proven ? {
      source: 'official_x_performance_history', snapshotId: `performance:${metric.xTweetId}:${metric.checkedAt}`,
      xTweetId: metric.xTweetId, postedAt: metric.postedAt, checkedAt: metric.checkedAt,
      likes: metric.likes, retweets: metric.retweets, replies: metric.replies, impressions: metric.impressions,
      ...(metric.quotes === undefined ? {} : { quotes: metric.quotes }), ...(metric.bookmarks === undefined ? {} : { bookmarks: metric.bookmarks }),
      baselineLikes: baseline.likes, baselinePosts: baseline.sampleCount, viralLikesThreshold, measuredRelativeSpread: spread.score,
      metricCoverage: spread.metricCoverage, criterion: likesBreakout ? 'mature_likes_breakout' : 'mature_relative_spread',
    } : undefined;
    return { tweetId: tweet.id, ...(tweet.xTweetId ? { xTweetId: tweet.xTweetId } : {}), content: tweet.content,
      contentHash: hash(tweet.content), status: tweet.status, postedAt: Number.isFinite(date(tweet.postedAt)) ? tweet.postedAt! : null,
      reuseEligible: reasons.length === 0, eligibilityReasons: reasons.length ? reasons : ['mature_viral_proof_and_spacing_met'], family,
      ...(viralEvidence ? { viralEvidence } : {}) };
  });
  const eligible = comparators.filter(row => row.content.length <= POLICY.maximumPostCharacters);
  const byId = new Map(rows.map(row => [row.id, row]));
  const recent = [...eligible].sort((a, b) => date(byId.get(b.tweetId)?.postedAt || byId.get(b.tweetId)?.createdAt) - date(byId.get(a.tweetId)?.postedAt || byId.get(a.tweetId)?.createdAt) || a.tweetId.localeCompare(b.tweetId));
  const recencyRank = new Map(recent.map((row, index) => [row.tweetId, index]));
  // BM25 ranks rare shared terms above repeated account-wide filler. This is
  // retrieval only: neither terms nor scores can declare two takes duplicates.
  // Compare the actual public copy. Generated topic/thesis metadata can be
  // missing or revised, and must not displace a relevant historical sentence.
  const terms = new Map(eligible.map(row => [row.tweetId, significantResearchTokens(row.content)]));
  const frequencies = new Map<string, number>();
  for (const document of terms.values()) for (const term of new Set(document)) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  const averageLength = Math.max(1, [...terms.values()].reduce((sum, document) => sum + document.length, 0) / Math.max(1, terms.size));
  const queryTerms = new Set(significantResearchTokens(input.query));
  const scores = new Map(eligible.map(row => {
    const document = terms.get(row.tweetId)!, termCounts = new Map<string, number>();
    for (const term of document) termCounts.set(term, (termCounts.get(term) || 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const frequency = termCounts.get(term) || 0, documentsWithTerm = frequencies.get(term) || 0;
      const inverseFrequency = Math.log(1 + (eligible.length - documentsWithTerm + 0.5) / (documentsWithTerm + 0.5));
      score += inverseFrequency * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * document.length / averageLength));
    }
    return [row.tweetId, score] as const;
  }));
  const relevant = [...eligible].sort((a, b) => scores.get(b.tweetId)! - scores.get(a.tweetId)! || recencyRank.get(a.tweetId)! - recencyRank.get(b.tweetId)!);
  const winners = relevant.filter(row => row.reuseEligible).slice(0, 4);
  // Keep two recent commitments visible and spend the remaining comparison
  // slots on relevant history. Proven hits fill unused relevance capacity.
  const candidates = [...recent.slice(0, 2), ...relevant.filter(row => scores.get(row.tweetId)! > 0).slice(0, 22), ...winners, ...relevant];
  const context: OriginalRepetitionContext = {
    version: ORIGINAL_REPETITION_POLICY_VERSION, observedAt: new Date(now).toISOString(), queryHash: hash(input.query), policy: { ...POLICY },
    history: { viralLikesThreshold, originalCount: publishedRows.length, queuedCount: rows.filter(row => row.status === 'queued').length,
      deletedCount: rows.filter(row => row.status === 'deleted_from_x').length, recentOriginals, queuedReturnIds,
      omittedOversizePosts: comparators.length - eligible.length, omittedComparatorCount: eligible.length }, comparators: [],
  };
  for (const row of candidates) {
    if (context.comparators.length >= POLICY.maximumComparators) break;
    if (context.comparators.some(existing => existing.tweetId === row.tweetId)) continue;
    const next = { ...context, comparators: [...context.comparators, row], history: { ...context.history, omittedComparatorCount: eligible.length - context.comparators.length - 1 } };
    if (JSON.stringify(next).length <= POLICY.maximumContextCharacters) {
      context.comparators.push(row);
      context.history.omittedComparatorCount = eligible.length - context.comparators.length;
    }
  }
  return context;
}

export function assessOriginalRepetition(input: {
  context: OriginalRepetitionContext; assessment: unknown; content: string;
}): { proof: OriginalRepetitionProof | null; issue: string | null } {
  const assessment = parseOriginalRepetitionAssessment(input.assessment), context = input.context;
  if (!assessment || typeof input.content !== 'string' || !input.content.trim() || !context
    || context.version !== ORIGINAL_REPETITION_POLICY_VERSION || !same(context.policy, POLICY) || !isValidHistory(context.history)
    || !Number.isFinite(date(context.observedAt)) || !validHash(context.queryHash) || !Array.isArray(context.comparators)
    || context.comparators.length > POLICY.maximumComparators || JSON.stringify(context).length > POLICY.maximumContextCharacters
    || context.comparators.some(post => typeof post.content !== 'string' || post.content.length > POLICY.maximumPostCharacters
      || post.contentHash !== hash(post.content) || !isValidComparedPost(post))
    || unique(context.comparators.map(post => post.tweetId)).length !== context.comparators.length) {
    return { proof: null, issue: 'Original take comparison is missing or malformed; a valid editorial assessment is required.' };
  }
  const comparedPosts = context.comparators.map(comparedPost);
  const matchedPosts = assessment.matchedTweetIds.flatMap(id => comparedPosts.filter(post => post.tweetId === id));
  const proof: OriginalRepetitionProof = { version: ORIGINAL_REPETITION_POLICY_VERSION, observedAt: context.observedAt,
    contentHash: hash(input.content), queryHash: context.queryHash, policy: structuredClone(context.policy), history: structuredClone(context.history),
    contextHash: contextHash({ ...context, comparedPosts }), assessment, comparedPosts, matchedPosts };
  let issue: string | null = null;
  if (assessment.verdict === 'uncertain') issue = 'The editorial assessment could not establish that this take is fresh or an eligible spaced viral return.';
  else if (matchedPosts.length !== assessment.matchedTweetIds.length) issue = 'The editorial assessment names an unknown previous post.';
  else if (!isValidOriginalRepetitionProof(proof)) issue = 'This take repeats a previous post without mature viral proof and the required spacing or return capacity.';
  return { proof, issue };
}

/** Recheck an approved return against live publication lineage without buying another judgment. */
export function getOriginalRepetitionPublishIssue(candidate: {
  id?: string; content: string; assessmentReceipt?: Tweet['assessmentReceipt'];
}, history: Tweet[], now = Date.now()): string | null {
  // Releases do not invalidate already paid legacy queue entries retroactively.
  // New-policy receipt creation is responsible for requiring a new proof.
  if (storedProofValue(candidate as typeof candidate & Record<string, unknown>) === undefined) return null;
  const proof = storedProof(candidate as typeof candidate & Record<string, unknown>);
  if (!proof || proof.contentHash !== hash(candidate.content)) return 'Original take comparison is missing, changed or not approved.';
  if (!Number.isFinite(now) || date(proof.observedAt) > now) return 'Original take comparison has an invalid observation time.';
  const matchingQueueIds = history.filter(tweet => tweet.status === 'queued' && tweet.content === candidate.content
    && same(storedProof(tweet as Tweet & Record<string, unknown>), proof)).map(tweet => tweet.id);
  const selfIds = candidate.id ? [candidate.id] : matchingQueueIds.length === 1 ? matchingQueueIds : [];
  const rows = originalRows(history).filter(tweet => !selfIds.includes(tweet.id));
  const normalizedCandidate = normalizedCopy(candidate.content);
  if (rows.some(tweet => normalizedCopy(tweet.content) === normalizedCandidate)) return 'Exact previous copy cannot be republished through a returning-take exception.';
  if (proof.assessment.verdict !== 'repeat') return null;
  const families = buildFamilies(rows), recent = rows.filter(tweet => published(tweet, now))
    .sort((a, b) => date(b.postedAt) - date(a.postedAt)).slice(0, POLICY.maximumReturnsPerPosts - 1);
  if (recent.some(tweet => storedProof(tweet as Tweet & Record<string, unknown>)?.assessment.verdict === 'repeat')
    || rows.some(tweet => tweet.status === 'queued' && storedProof(tweet as Tweet & Record<string, unknown>)?.assessment.verdict === 'repeat')) {
    return 'Another returning take occupies the one-in-ten return allowance.';
  }
  for (const match of proof.matchedPosts) {
    const previous = rows.find(tweet => tweet.id === match.tweetId);
    if (!previous || hash(previous.content) !== match.contentHash || previous.status !== 'posted' || !published(previous, now)) {
      return 'The matched original is missing, changed, deleted or no longer an eligible published post.';
    }
    const family = familyState(previous.id, rows, families, now);
    if (family.latestPostStatus === 'deleted_from_x') return 'The latest returning take was deleted; it cannot authorize another return.';
    if (family.queuedTweetIds.length || !family.latestPostedAt
      || now - date(family.latestPostedAt) < POLICY.minimumDaysBetweenReturns * 24 * 60 * 60 * 1000
      || family.interveningOriginals < POLICY.minimumInterveningOriginals) return 'The returning take no longer clears live spacing or queue reservation.';
  }
  return null;
}
