/**
 * Current-event discovery for generation.
 *
 * X supplies primary commentary from the account's network. Hacker News adds
 * a second, public source for startup and technology stories. Every accepted
 * item is time-bounded and keeps source provenance for downstream prompts.
 */

import type { TwitterKeys } from './twitter-client';
import {
  discoverNetworkTopicIntelligence,
  type NetworkTopicDiscoveryOptions,
  type NetworkTopicEvidence,
  type NetworkTopicIntelligenceState,
} from './network-topic-intelligence';

export type TrendingSourceType = 'x' | 'hacker_news';

export interface TrendingTopic {
  id: number;
  headline: string;
  source: string;
  relevanceScore: number;
  category: string;
  timestamp: string;
  tweetCount: number;
  topTweet?: {
    id: string;
    text: string;
    likes: number;
    author: string;
    retweets?: number;
    replies?: number;
    quotes?: number;
    bookmarks?: number;
  };
  sourceType?: TrendingSourceType;
  sourceUrl?: string | null;
  publisher?: string | null;
  isPrimarySource?: boolean;
  sourceCount?: number;
  engagementScore?: number;
  sourceQuality?: number;
  discoveryMethod?: 'followed_network' | 'publisher_feed' | 'manual';
  networkTopicId?: string | null;
  networkMomentumScore?: number | null;
  networkMomentumDelta?: number | null;
  networkBreakoutScore?: number | null;
  networkVelocityScore?: number | null;
  topicConfidence?: number | null;
  topicWhyNow?: string | null;
  observedAt?: string | null;
  evidence?: NetworkTopicEvidence[];
}

export function getTrendingTopicStableId(topic: Pick<TrendingTopic, 'id' | 'networkTopicId'>): string {
  return topic.networkTopicId || String(topic.id);
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
      'linux', 'technology',
    ],
  },
};

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

export function isLowSignalXCommentary(text: string): boolean {
  const normalized = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (/^(?:lol|lmao)\b/.test(normalized)) return true;
  if (/\b(?:called worse by better|ruler and microsoft paint)\b/.test(normalized)) return true;
  return /\bwould(?:n['’]?t|\s+not) be surprised\b/.test(normalized)
    && /\b(?:crumbles?|never makes it|worth (?:a lot |much )?less)\b/.test(normalized);
}

export function normalizeHackerNewsHeadline(title: string): string {
  return title
    .trim()
    .replace(/\bfor\s+[–—]\s*(?=\$\d)/gi, 'for about ');
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

/**
 * Compatibility wrapper for callers that only need current topics. Production
 * refresh paths should use discoverCurrentTrends so the momentum state persists.
 */
export async function fetchTrendingFromFollowing(
  keys: TwitterKeys,
  userId: string,
  options: NetworkTopicDiscoveryOptions = {},
): Promise<TrendingTopic[]> {
  return (await discoverNetworkTopicIntelligence(keys, userId, options)).topics;
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
      const headline = normalizeHackerNewsHeadline(item.title || '');
      const category = classifyTrendCategory(headline);
      if (!category || !isCurrentTrendTimestamp(timestamp)) return null;
      const sourceAssessment = hackerNewsSourceAssessment(item.url);
      if (sourceAssessment.quality < 0.4) return null;
      const sourceUrl = item.url || `https://news.ycombinator.com/item?id=${item.id}`;
      const publisher = sourcePublisher(item.url);
      const engagementScore = (item.score || 0) + (item.descendants || 0) * 1.5;
      return {
        id: 0,
        headline,
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

  const addTopic = (topic: TrendingTopic): boolean => {
    if (selected.includes(topic)) return false;
    const sourceUrl = normalizedSourceUrl(topic.sourceUrl);
    const duplicate = selected.some((item) => {
      const sameUrl = sourceUrl && sourceUrl === normalizedSourceUrl(item.sourceUrl);
      return sameUrl || (item.category === topic.category && topicSimilarity(item.headline, topic.headline) >= 0.72);
    });
    if (duplicate) return false;

    const author = topic.topTweet?.author?.toLowerCase() || '';
    const authorLimit = topic.discoveryMethod === 'followed_network' ? 4 : 2;
    if (author && (authorCounts.get(author) || 0) >= authorLimit) return false;

    selected.push(topic);
    const sourceType = topic.sourceType || 'x';
    sourceCounts.set(sourceType, (sourceCounts.get(sourceType) || 0) + 1);
    if (author) authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
    return true;
  };

  // The followed graph is the primary discovery surface. Publisher feeds can
  // corroborate or fill gaps, but should not crowd out the subjects learned
  // from accounts the user intentionally follows.
  const followedNetwork = candidates.filter((topic) => topic.discoveryMethod === 'followed_network');
  const followedNetworkFloor = Math.min(followedNetwork.length, Math.ceil(limit * 0.67));
  for (const topic of followedNetwork) {
    addTopic(topic);
    if (selected.filter((item) => item.discoveryMethod === 'followed_network').length >= followedNetworkFloor) break;
  }

  for (const topic of candidates) {
    if (selected.length >= limit) break;
    if (selected.includes(topic)) continue;
    const sourceType = topic.sourceType || 'x';
    const sourceCount = sourceCounts.get(sourceType) || 0;
    const otherSourceAvailable = candidates.some((item) => (item.sourceType || 'x') !== sourceType);
    if (otherSourceAvailable && sourceCount >= Math.max(2, Math.ceil(limit * 0.67))) continue;
    addTopic(topic);
  }

  if (selected.length < limit) {
    for (const topic of candidates) {
      addTopic(topic);
      if (selected.length >= limit) break;
    }
  }

  return selected.map((topic, index) => ({ ...topic, id: index + 1 }));
}

export interface CurrentTrendDiscoveryResult {
  topics: TrendingTopic[];
  networkState: NetworkTopicIntelligenceState | null;
  networkRefreshed: boolean;
  networkError: unknown | null;
  sampledNetworkAccounts: number;
  networkCandidateTweets: number;
  networkPartialFailures: number;
}

/**
 * Production discovery path. A failure in one source does not erase current
 * data from the other source; if both fail, the X error remains authoritative.
 * Callers persist networkState so later refreshes can measure acceleration.
 */
export async function discoverCurrentTrends(
  keys: TwitterKeys,
  userId: string,
  options: {
    previousNetworkState?: NetworkTopicIntelligenceState | null;
    fetchImpl?: typeof fetch;
    network?: Omit<NetworkTopicDiscoveryOptions, 'previousState'>;
  } = {},
): Promise<CurrentTrendDiscoveryResult> {
  const [xResult, hackerNewsResult] = await Promise.allSettled([
    discoverNetworkTopicIntelligence(keys, userId, {
      ...(options.network || {}),
      previousState: options.previousNetworkState || null,
    }),
    fetchHackerNewsTopics(options.fetchImpl || fetch),
  ]);
  const xTopics = xResult.status === 'fulfilled' ? xResult.value.topics : [];
  const hackerNewsTopics = hackerNewsResult.status === 'fulfilled' ? hackerNewsResult.value : [];
  const merged = mergeTrendingTopics([xTopics, hackerNewsTopics]);
  if (merged.length > 0) {
    return {
      topics: merged,
      networkState: xResult.status === 'fulfilled'
        ? xResult.value.state
        : options.previousNetworkState || null,
      networkRefreshed: xResult.status === 'fulfilled',
      networkError: xResult.status === 'rejected' ? xResult.reason : xResult.value.sourceError,
      sampledNetworkAccounts: xResult.status === 'fulfilled' ? xResult.value.sampledAccounts : 0,
      networkCandidateTweets: xResult.status === 'fulfilled' ? xResult.value.candidateTweets : 0,
      networkPartialFailures: xResult.status === 'fulfilled' ? xResult.value.partialFailureCount : 0,
    };
  }
  if (xResult.status === 'rejected') throw xResult.reason;
  if (hackerNewsResult.status === 'rejected') throw hackerNewsResult.reason;
  return {
    topics: [],
    networkState: xResult.value.state,
    networkRefreshed: true,
    networkError: xResult.value.sourceError,
    sampledNetworkAccounts: xResult.value.sampledAccounts,
    networkCandidateTweets: xResult.value.candidateTweets,
    networkPartialFailures: xResult.value.partialFailureCount,
  };
}

/** Compatibility wrapper for callers that do not persist topic history. */
export async function fetchCurrentTrends(
  keys: TwitterKeys,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TrendingTopic[]> {
  return (await discoverCurrentTrends(keys, userId, { fetchImpl })).topics;
}
