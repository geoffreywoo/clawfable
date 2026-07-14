/**
 * Current-event discovery for generation.
 *
 * X supplies primary commentary from the account's network. Hacker News adds
 * a second, public source for startup and technology stories. Every accepted
 * item is time-bounded and keeps source provenance for downstream prompts.
 */

import type { TwitterKeys } from './twitter-client';
import { getFollowing, getUserTimeline } from './twitter-client';
import { isInvalidTwitterCredentialError, isRateLimitTwitterError, isTransientTwitterError } from './twitter-debug';

export type TrendingSourceType = 'x' | 'hacker_news';

export interface TrendingTopic {
  id: number;
  headline: string;
  source: string;
  relevanceScore: number;
  category: string;
  timestamp: string;
  tweetCount: number;
  topTweet?: { id: string; text: string; likes: number; author: string };
  sourceType?: TrendingSourceType;
  sourceUrl?: string | null;
  publisher?: string | null;
  isPrimarySource?: boolean;
  sourceCount?: number;
  engagementScore?: number;
  sourceQuality?: number;
}

type TopicCluster = {
  priority: number;
  keywords: string[];
};

const TOPIC_CLUSTERS: Record<string, TopicCluster> = {
  compute: {
    priority: 12,
    keywords: [
      'asic', 'asics', 'gpu', 'gpus', 'hbm', 'semiconductor', 'semiconductors', 'chip', 'chips',
      'wafer', 'foundry', 'inference chip', 'inference compute', 'memory bandwidth', 'interconnect',
      'nvidia', 'amd', 'broadcom', 'cerebras', 'tenstorrent', 'tsmc', 'data center', 'datacenter',
    ],
  },
  robotics: {
    priority: 11,
    keywords: [
      'robot', 'robots', 'robotic', 'robotics', 'humanoid', 'actuator', 'actuators', 'servo',
      'autonomous vehicle', 'industrial automation', 'machine vision',
    ],
  },
  energy: {
    priority: 11,
    keywords: [
      'fusion', 'fission', 'nuclear', 'reactor', 'reactors', 'tokamak', 'stellarator', 'tritium',
      'grid', 'transformer', 'transformers', 'transmission', 'substation', 'battery', 'batteries',
      'geothermal', 'solar', 'power plant', 'energy storage',
    ],
  },
  manufacturing: {
    priority: 10,
    keywords: [
      'manufacturing', 'factory', 'factories', 'industrial base', 'supply chain', 'reshoring',
      'reindustrialization', 're-industrialization', 'rare earth', 'rare earths', 'critical minerals',
      'tungsten', 'gallium', 'germanium', 'graphite', 'magnet', 'magnets', 'refining', 'sintering',
    ],
  },
  space: {
    priority: 10,
    keywords: [
      'spacecraft', 'satellite', 'satellites', 'rocket', 'rockets', 'orbital', 'orbit', 'payload',
      'spacex', 'starship', 'launch vehicle', 'lunar', 'moon mission', 'mars mission',
    ],
  },
  venture: {
    priority: 9,
    keywords: [
      'venture capital', 'seed round', 'series a', 'series b', 'series c', 'funding round',
      'raised', 'raises', 'fundraise', 'fundraising', 'valuation', 'term sheet', 'acquired',
      'acquisition', 'portfolio company',
    ],
  },
  startups: {
    priority: 8,
    keywords: [
      'startup', 'startups', 'founder', 'founders', 'cofounder', 'co-founder', 'y combinator', 'yc',
      'show hn', 'product launch', 'launched a company', 'new company',
    ],
  },
  ai: {
    priority: 8,
    keywords: [
      'artificial intelligence', 'machine learning', 'foundation model', 'language model', 'llm', 'llms',
      'ai agent', 'ai agents', 'agentic ai', 'openai', 'chatgpt', 'gpt', 'anthropic', 'claude',
      'gemini', 'deepmind', 'mistral', 'llama', 'model training', 'model inference',
    ],
  },
  frontier_science: {
    priority: 7,
    keywords: [
      'quantum computing', 'quantum computer', 'biotech', 'biotechnology', 'synthetic biology',
      'gene editing', 'crispr', 'drug discovery', 'materials science', 'superconductor',
    ],
  },
  tech: {
    priority: 4,
    keywords: [
      'software', 'open source', 'database', 'browser', 'compiler', 'programming language', 'developer',
      'developers', 'cloud computing', 'cybersecurity', 'security vulnerability', 'github', 'api', 'apis',
      'linux', 'apple', 'microsoft', 'google', 'amazon', 'meta', 'technology',
    ],
  },
};

const RELEVANT_ACCOUNT_TERMS = [
  'startup', 'founder', 'venture', 'investor', 'investment', 'technology', 'software', 'hardware',
  'artificial intelligence', 'machine learning', 'robotics', 'manufacturing', 'industrial', 'energy',
  'nuclear', 'fusion', 'space', 'science', 'research', 'engineer', 'journalist', 'reporter', 'news',
  'semiconductor', 'biotech', 'deep tech', 'frontier tech',
];

const TREND_MAX_AGE_HOURS = 72;
const HN_TOP_STORY_LIMIT = 36;
const HN_API_ROOT = 'https://hacker-news.firebaseio.com/v0';
const LOW_TRUST_NEWS_DOMAINS = [
  'supercarblondie.com',
];
const TRUSTED_REPORTING_DOMAINS = [
  'reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'techcrunch.com', 'theinformation.com',
  'semianalysis.com', 'ieee.org', 'nature.com', 'science.org', 'hpcwire.com', 'crunchbase.com',
  'axios.com',
];
const PRIMARY_TECHNICAL_DOMAINS = [
  'github.com', 'arxiv.org', 'openai.com', 'anthropic.com', 'deepmind.google', 'nvidia.com',
  'amd.com', 'tsmc.com', 'energy.gov', 'nasa.gov', 'sec.gov',
];

interface RawTweet {
  id: string;
  text: string;
  likes: number;
  retweets: number;
  author: string;
  createdAt: string;
  sourceQuality: number;
}

interface HackerNewsItem {
  id: number;
  by?: string;
  descendants?: number;
  dead?: boolean;
  deleted?: boolean;
  score?: number;
  time?: number;
  title?: string;
  type?: string;
  url?: string;
}

type FollowingAccount = Awaited<ReturnType<typeof getFollowing>>[number];

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsKeyword(text: string, keyword: string): boolean {
  const normalizedText = ` ${normalizeForMatching(text)} `;
  const normalizedKeyword = normalizeForMatching(keyword);
  return Boolean(normalizedKeyword) && normalizedText.includes(` ${normalizedKeyword} `);
}

export function classifyTrendCategory(text: string): string | null {
  const matches = Object.entries(TOPIC_CLUSTERS)
    .map(([category, cluster]) => ({
      category,
      priority: cluster.priority,
      hits: cluster.keywords.filter((keyword) => containsKeyword(text, keyword)).length,
    }))
    .filter((match) => match.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.priority - a.priority || a.category.localeCompare(b.category));

  return matches[0]?.category || null;
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trendAgeHours(timestamp: string, now = Date.now()): number {
  const parsed = parseTimestamp(timestamp);
  if (!parsed) return Number.POSITIVE_INFINITY;
  return (now - parsed) / (60 * 60 * 1000);
}

export function isCurrentTrendTimestamp(timestamp: string, now = Date.now()): boolean {
  const ageHours = trendAgeHours(timestamp, now);
  return ageHours >= -0.25 && ageHours <= TREND_MAX_AGE_HOURS;
}

function buildHeadline(text: string): string {
  let clean = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^(@\w+\s*)+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length > 180) {
    clean = `${clean.slice(0, 180).replace(/\s\S*$/, '')}...`;
  }
  return clean;
}

function topicTokenSet(value: string): Set<string> {
  return new Set(
    normalizeForMatching(value)
      .split(' ')
      .filter((token) => token.length >= 4 && !['about', 'after', 'before', 'their', 'there', 'these', 'this', 'with'].includes(token)),
  );
}

function topicSimilarity(a: string, b: string): number {
  const left = topicTokenSet(a);
  const right = topicTokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.max(1, Math.min(left.size, right.size));
}

function normalizedSourceUrl(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim().toLowerCase();
  }
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function hackerNewsSourceAssessment(url: string | undefined): { quality: number; primary: boolean } {
  if (!url) return { quality: 0.5, primary: false };
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return { quality: 0.42, primary: false };
  }
  if (LOW_TRUST_NEWS_DOMAINS.some((domain) => domainMatches(hostname, domain))) {
    return { quality: 0.18, primary: false };
  }
  const primary = PRIMARY_TECHNICAL_DOMAINS.some((domain) => domainMatches(hostname, domain))
    || hostname.endsWith('.gov')
    || hostname.endsWith('.edu');
  if (primary) return { quality: 0.88, primary: true };
  if (TRUSTED_REPORTING_DOMAINS.some((domain) => domainMatches(hostname, domain))) {
    return { quality: 0.76, primary: false };
  }
  return { quality: 0.56, primary: false };
}

function accountRelevanceScore(account: FollowingAccount): number {
  const profile = `${account.name || ''} ${account.username || ''} ${account.description || ''}`;
  const hits = RELEVANT_ACCOUNT_TERMS.filter((term) => containsKeyword(profile, term)).length;
  if (hits === 0) return 0;
  return hits * 20 + Math.log10(Math.max(10, account.followersCount || 0)) * 4 + (account.verified ? 2 : 0);
}

function pickRelevantAccounts(accounts: FollowingAccount[], limit = 15): FollowingAccount[] {
  const scored = accounts
    .map((account) => ({
      account,
      score: accountRelevanceScore(account),
      category: classifyTrendCategory(`${account.name || ''} ${account.description || ''}`) || 'general',
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.account.followersCount || 0) - (a.account.followersCount || 0));

  if (scored.length === 0) {
    return [...accounts]
      .sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0))
      .slice(0, limit);
  }

  const selected: FollowingAccount[] = [];
  const categoryCounts = new Map<string, number>();
  for (const item of scored) {
    if ((categoryCounts.get(item.category) || 0) >= 4) continue;
    selected.push(item.account);
    categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
    if (selected.length >= limit) break;
  }
  for (const item of scored) {
    if (selected.includes(item.account)) continue;
    selected.push(item.account);
    if (selected.length >= limit) break;
  }
  return selected;
}

function pickRepresentativeTimelineFailure(errors: unknown[]): unknown | null {
  return (
    errors.find(isInvalidTwitterCredentialError)
    || errors.find(isRateLimitTwitterError)
    || errors.find(isTransientTwitterError)
    || errors[0]
    || null
  );
}

function scoreXTopic(tweet: RawTweet, category: string, now = Date.now()): number {
  const ageHours = Math.max(0.5, trendAgeHours(tweet.createdAt, now));
  const engagement = tweet.likes + tweet.retweets * 2;
  const velocity = engagement / ageHours;
  const freshness = clamp(1 - ageHours / TREND_MAX_AGE_HOURS);
  const categoryPriority = TOPIC_CLUSTERS[category]?.priority || 1;
  return Math.min(99, Math.round(
    34
    + freshness * 24
    + Math.min(22, Math.log2(engagement + 1) * 2.5)
    + Math.min(12, Math.log2(velocity + 1) * 2)
    + Math.min(7, categoryPriority * 0.55)
    + tweet.sourceQuality * 4,
  ));
}

/**
 * Fetch recent, relevant posts from the account's following graph.
 * Old pinned posts and unrelated high-engagement posts are deliberately dropped.
 */
export async function fetchTrendingFromFollowing(
  keys: TwitterKeys,
  userId: string,
): Promise<TrendingTopic[]> {
  const following = await getFollowing(keys, userId, 500);
  const topAccounts = pickRelevantAccounts(following, 15);
  const allTweets: RawTweet[] = [];
  const batchSize = 5;
  let failedTimelineFetches = 0;
  const timelineErrors: unknown[] = [];

  for (let index = 0; index < topAccounts.length; index += batchSize) {
    const batch = topAccounts.slice(index, index + batchSize);
    const results = await Promise.allSettled(
      batch.map((account) =>
        getUserTimeline(keys, account.id, 10).then((tweets) =>
          tweets.map((tweet) => ({
            id: tweet.id,
            text: tweet.text,
            likes: tweet.likes,
            retweets: tweet.retweets,
            author: account.username,
            createdAt: tweet.createdAt,
            sourceQuality: account.verified ? 0.72 : 0.62,
          })),
        ),
      ),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') allTweets.push(...result.value);
      else {
        failedTimelineFetches++;
        timelineErrors.push(result.reason);
      }
    }
  }

  if (allTweets.length === 0) {
    if (topAccounts.length > 0 && failedTimelineFetches > 0) {
      const representativeError = pickRepresentativeTimelineFailure(timelineErrors);
      if (representativeError) throw representativeError;
      throw new Error(`Unable to fetch followed-account timelines from X (${failedTimelineFetches}/${topAccounts.length} failed).`);
    }
    return [];
  }

  return allTweets
    .filter((tweet) => isCurrentTrendTimestamp(tweet.createdAt))
    .map((tweet): TrendingTopic | null => {
      const category = classifyTrendCategory(tweet.text);
      const headline = buildHeadline(tweet.text);
      if (!category || headline.length < 15) return null;
      const engagementScore = tweet.likes + tweet.retweets * 2;
      return {
        id: 0,
        headline,
        source: `@${tweet.author}`,
        relevanceScore: scoreXTopic(tweet, category),
        category,
        timestamp: tweet.createdAt,
        tweetCount: 1,
        topTweet: { id: tweet.id, text: tweet.text, likes: tweet.likes, author: tweet.author },
        sourceType: 'x',
        sourceUrl: `https://x.com/${tweet.author}/status/${tweet.id}`,
        publisher: `@${tweet.author}`,
        isPrimarySource: false,
        sourceCount: 1,
        engagementScore,
        sourceQuality: tweet.sourceQuality,
      };
    })
    .filter((topic): topic is TrendingTopic => Boolean(topic))
    .sort((a, b) => b.relevanceScore - a.relevanceScore || b.timestamp.localeCompare(a.timestamp))
    .slice(0, 24)
    .map((topic, index) => ({ ...topic, id: index + 1 }));
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch, timeoutMs = 4500): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Source request failed (${response.status})`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function sourcePublisher(url: string | undefined): string {
  if (!url) return 'Hacker News';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Hacker News';
  }
}

function scoreHackerNewsTopic(item: HackerNewsItem, category: string, sourceQuality: number, now = Date.now()): number {
  const timestamp = new Date((item.time || 0) * 1000).toISOString();
  const ageHours = Math.max(0.5, trendAgeHours(timestamp, now));
  const engagement = (item.score || 0) + (item.descendants || 0) * 1.5;
  const freshness = clamp(1 - ageHours / TREND_MAX_AGE_HOURS);
  const velocity = engagement / ageHours;
  const categoryPriority = TOPIC_CLUSTERS[category]?.priority || 1;
  return Math.min(96, Math.round(
    36
    + freshness * 24
    + Math.min(20, Math.log2(engagement + 1) * 2.2)
    + Math.min(10, Math.log2(velocity + 1) * 1.8)
    + Math.min(6, categoryPriority * 0.45)
    + sourceQuality * 6,
  ));
}

/** Fetch timely startup and technology headlines from the official Hacker News API. */
export async function fetchHackerNewsTopics(
  fetchImpl: typeof fetch = fetch,
): Promise<TrendingTopic[]> {
  const ids = await fetchJson<number[]>(`${HN_API_ROOT}/topstories.json`, fetchImpl);
  const results = await Promise.allSettled(
    ids.slice(0, HN_TOP_STORY_LIMIT).map((id) => fetchJson<HackerNewsItem>(`${HN_API_ROOT}/item/${id}.json`, fetchImpl)),
  );

  const topics = results
    .filter((result): result is PromiseFulfilledResult<HackerNewsItem> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((item) => item && item.type === 'story' && !item.dead && !item.deleted && item.title && item.time)
    .map((item): TrendingTopic | null => {
      const timestamp = new Date((item.time || 0) * 1000).toISOString();
      const category = classifyTrendCategory(item.title || '');
      if (!category || !isCurrentTrendTimestamp(timestamp)) return null;
      const sourceAssessment = hackerNewsSourceAssessment(item.url);
      if (sourceAssessment.quality < 0.4) return null;
      const sourceUrl = item.url || `https://news.ycombinator.com/item?id=${item.id}`;
      const publisher = sourcePublisher(item.url);
      const engagementScore = (item.score || 0) + (item.descendants || 0) * 1.5;
      return {
        id: 0,
        headline: (item.title || '').trim(),
        source: `Hacker News / ${publisher}`,
        relevanceScore: scoreHackerNewsTopic(item, category, sourceAssessment.quality),
        category,
        timestamp,
        tweetCount: 0,
        sourceType: 'hacker_news',
        sourceUrl,
        publisher,
        isPrimarySource: sourceAssessment.primary,
        sourceCount: 1,
        engagementScore: Math.round(engagementScore),
        sourceQuality: sourceAssessment.quality,
      };
    })
    .filter((topic): topic is TrendingTopic => Boolean(topic));

  return topics
    .sort((a, b) => b.relevanceScore - a.relevanceScore || b.timestamp.localeCompare(a.timestamp))
    .slice(0, 16)
    .map((topic, index) => ({ ...topic, id: index + 1 }));
}

export function mergeTrendingTopics(topicGroups: TrendingTopic[][], limit = 12): TrendingTopic[] {
  const candidates = topicGroups
    .flat()
    .filter((topic) => isCurrentTrendTimestamp(topic.timestamp))
    .sort((a, b) => b.relevanceScore - a.relevanceScore || b.timestamp.localeCompare(a.timestamp));
  const selected: TrendingTopic[] = [];
  const sourceCounts = new Map<string, number>();
  const authorCounts = new Map<string, number>();

  for (const topic of candidates) {
    const sourceType = topic.sourceType || 'x';
    const sourceUrl = normalizedSourceUrl(topic.sourceUrl);
    const duplicate = selected.some((item) => {
      const sameUrl = sourceUrl && sourceUrl === normalizedSourceUrl(item.sourceUrl);
      return sameUrl || (item.category === topic.category && topicSimilarity(item.headline, topic.headline) >= 0.72);
    });
    if (duplicate) continue;

    const sourceCount = sourceCounts.get(sourceType) || 0;
    const otherSourceAvailable = candidates.some((item) => (item.sourceType || 'x') !== sourceType);
    if (otherSourceAvailable && sourceCount >= Math.max(2, Math.ceil(limit * 0.67))) continue;

    const author = topic.topTweet?.author?.toLowerCase() || '';
    if (author && (authorCounts.get(author) || 0) >= 2) continue;

    selected.push(topic);
    sourceCounts.set(sourceType, sourceCount + 1);
    if (author) authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
    if (selected.length >= limit) break;
  }

  if (selected.length < limit) {
    for (const topic of candidates) {
      if (selected.includes(topic)) continue;
      const sourceUrl = normalizedSourceUrl(topic.sourceUrl);
      const duplicate = selected.some((item) => {
        const sameUrl = sourceUrl && sourceUrl === normalizedSourceUrl(item.sourceUrl);
        return sameUrl || (item.category === topic.category && topicSimilarity(item.headline, topic.headline) >= 0.72);
      });
      if (duplicate) continue;
      const author = topic.topTweet?.author?.toLowerCase() || '';
      if (author && (authorCounts.get(author) || 0) >= 2) continue;
      selected.push(topic);
      if (author) authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
      if (selected.length >= limit) break;
    }
  }

  return selected.map((topic, index) => ({ ...topic, id: index + 1 }));
}

/**
 * Production discovery path. A failure in one source does not erase current
 * data from the other source; if both fail, the X error remains authoritative.
 */
export async function fetchCurrentTrends(
  keys: TwitterKeys,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TrendingTopic[]> {
  const [xResult, hackerNewsResult] = await Promise.allSettled([
    fetchTrendingFromFollowing(keys, userId),
    fetchHackerNewsTopics(fetchImpl),
  ]);
  const xTopics = xResult.status === 'fulfilled' ? xResult.value : [];
  const hackerNewsTopics = hackerNewsResult.status === 'fulfilled' ? hackerNewsResult.value : [];
  const merged = mergeTrendingTopics([xTopics, hackerNewsTopics]);
  if (merged.length > 0) return merged;
  if (xResult.status === 'rejected') throw xResult.reason;
  if (hackerNewsResult.status === 'rejected') throw hackerNewsResult.reason;
  return [];
}
