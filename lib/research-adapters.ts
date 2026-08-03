import type {
  ResearchAgenda,
  ResearchFeedConfig,
  ResearchSourceType,
  SourceClaim,
  SourceDocument,
  SourceTrustTier,
} from './types';
import type { TrendingTopic } from './trending';
import { lookup } from 'node:dns/promises';
import {
  canonicalizeResearchUrl,
  extractDeterministicClaims,
  extractResearchEntities,
  parseSyndicationFeed,
  significantResearchTokens,
  stableResearchId,
  stripResearchMarkup,
} from './research-utils';

const DEFAULT_FETCH_TIMEOUT_MS = 12_000;
const MAX_FEED_BYTES = 2_000_000;
const MAX_FETCH_REDIRECTS = 3;
const MAX_DOCUMENTS_PER_ADAPTER = 40;
const DEFAULT_OFFICIAL_HOST_ALLOWLIST = [
  'anthropic.com',
  'arxiv.org',
  'github.com',
  'nasa.gov',
  'openai.com',
  'sec.gov',
];

export const DEFAULT_RESEARCH_FEEDS: ResearchFeedConfig[] = [
  {
    id: 'nasa-technology',
    url: 'https://www.nasa.gov/technology/feed/',
    publisher: 'NASA Technology',
    trustTier: 'primary',
    topics: ['space', 'robotics', 'science', 'energy', 'materials'],
    sourceType: 'official',
  },
  {
    id: 'nasa-jpl',
    url: 'https://www.nasa.gov/centers-and-facilities/jpl/feed/',
    publisher: 'NASA Jet Propulsion Laboratory',
    trustTier: 'primary',
    topics: ['space', 'robotics', 'science', 'energy', 'materials'],
    sourceType: 'official',
  },
];

export const DEFAULT_RESEARCH_GITHUB_REPOSITORIES = [
  'openai/openai-python',
  'anthropics/anthropic-sdk-typescript',
  'vercel/next.js',
];

export interface ResearchAdapterContext {
  agentId: string;
  agenda: ResearchAgenda;
  trending: TrendingTopic[];
  fetchImpl?: typeof fetch;
  now?: Date;
}

export interface ResearchAdapterResult {
  sourceType: ResearchSourceType;
  documents: SourceDocument[];
  errors: string[];
}

function hostMatches(hostname: string, allowed: string): boolean {
  return hostname === allowed || hostname.endsWith(`.${allowed}`);
}

function privateNetworkHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized.endsWith('.local')
    || normalized === '::1'
    || normalized === '0.0.0.0'
    || /^127\./.test(normalized)
    || /^10\./.test(normalized)
    || /^192\.168\./.test(normalized)
    || /^169\.254\./.test(normalized)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(normalized)
    || /^::ffff:(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(normalized)
    || /^(?:fc|fd|fe80):/i.test(normalized);
}

function researchUrlIssue(value: string, officialOnly: boolean): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid URL';
  }
  if (url.protocol !== 'https:') return 'HTTPS is required';
  if (url.username || url.password) return 'embedded credentials are not allowed';
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (privateNetworkHost(hostname)) return 'private network hosts are not allowed';
  if (officialOnly) {
    const configured = (process.env.RESEARCH_OFFICIAL_HOST_ALLOWLIST || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (![...DEFAULT_OFFICIAL_HOST_ALLOWLIST, ...configured].some((allowed) => hostMatches(hostname, allowed))) {
      return 'official source host is not allowlisted';
    }
  }
  return null;
}

export function getResearchFeedUrlIssue(feed: Pick<ResearchFeedConfig, 'url' | 'sourceType' | 'trustTier'>): string | null {
  return researchUrlIssue(feed.url, feed.sourceType === 'official' || feed.trustTier === 'primary');
}

function compactText(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function secFilingClaims(title: string, excerpt: string, canonicalUrl: string): SourceClaim[] {
  const match = title.match(/^([A-Z0-9][A-Z0-9 /-]{0,24}?)\s+-\s+(.+)$/i);
  if (!match) return extractDeterministicClaims(title, excerpt);
  const form = match[1].toUpperCase();
  const subject = match[2]
    .replace(/\(\d{6,}\)/g, '')
    .replace(/\((?:Subject|Filed by|Filer)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!subject) return extractDeterministicClaims(title, excerpt);
  const filedAt = excerpt.match(/\bFiled:\s*(\d{4}-\d{2}-\d{2})\b/i)?.[1] || null;
  const text = `${subject} filed SEC form ${form}${filedAt ? ` on ${filedAt}` : ''}.`;
  return [{
    id: stableResearchId('claim', canonicalUrl, form, subject, filedAt || ''),
    text,
    kind: 'announcement',
    confidence: 0.92,
    entities: extractResearchEntities(subject),
  }];
}

const LOW_SIGNAL_SEC_FORM = /^(?:13F|424B|NPORT|N-PX|UPLOAD|CORRESP)\b/i;
const GENERIC_SEC_MATCH_TOKENS = new Set([
  'company', 'companies', 'corp', 'corporation', 'finance', 'financial', 'filed',
  'filer', 'market', 'markets', 'startup', 'startups', 'subject', 'tech', 'technology',
]);

function secEntryMatchesAgenda(
  entry: { title: string; excerpt: string },
  agenda: ResearchAgenda,
): boolean {
  const form = entry.title.split(/\s+-\s+/, 1)[0] || '';
  if (LOW_SIGNAL_SEC_FORM.test(form)) return false;
  const desired = new Set(significantResearchTokens([
    ...agenda.queries,
    ...agenda.pinnedQuestions,
    ...Object.keys(agenda.domainWeights),
  ].join(' ')).filter((token) => !GENERIC_SEC_MATCH_TOKENS.has(token)));
  if (desired.size === 0) return false;
  return significantResearchTokens(entry.title).some((token) => desired.has(token));
}

function safePublishedAt(value: string | null | undefined, now: Date): string {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) && parsed <= now.getTime() + 24 * 60 * 60 * 1000
    ? new Date(parsed).toISOString()
    : '1970-01-01T00:00:00.000Z';
}

function agendaTokens(agenda: ResearchAgenda): Set<string> {
  return new Set(significantResearchTokens([
    ...agenda.queries,
    ...agenda.pinnedQuestions,
    ...Object.keys(agenda.domainWeights),
  ].join(' ')));
}

function entryMatchesAgenda(
  title: string,
  excerpt: string,
  configuredTopics: string[],
  agenda: ResearchAgenda,
  allowConfiguredTopicMatch = true,
): boolean {
  const desired = agendaTokens(agenda);
  if (desired.size === 0) return true;
  const contentTokens = significantResearchTokens(`${title} ${excerpt}`);
  if (contentTokens.some((token) => desired.has(token))) return true;
  return allowConfiguredTopicMatch
    && significantResearchTokens(configuredTopics.join(' ')).some((token) => desired.has(token));
}

async function assertPublicDns(url: URL, fetchImpl: typeof fetch): Promise<void> {
  if (fetchImpl !== fetch) return;
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => privateNetworkHost(entry.address))) {
    throw new Error('resolved address is not public');
  }
}

async function responseTextWithinLimit(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_FEED_BYTES) throw new Error('feed exceeds size limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error('feed exceeds size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchText(
  initialUrl: string,
  fetchImpl: typeof fetch,
  headers: HeadersInit = {},
  officialOnly = false,
): Promise<string> {
  let url = new URL(initialUrl);
  for (let redirect = 0; redirect <= MAX_FETCH_REDIRECTS; redirect++) {
    const issue = researchUrlIssue(url.toString(), officialOnly);
    if (issue) throw new Error(issue);
    await assertPublicDns(url, fetchImpl);
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*;q=0.5',
        'User-Agent': process.env.CLAWFABLE_RESEARCH_USER_AGENT || 'Clawfable research bot (contact@clawfable.com)',
        ...headers,
      },
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'manual',
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect response is missing a location');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return responseTextWithinLimit(response);
  }
  throw new Error('too many redirects');
}

function feedDocument({
  agentId,
  sourceType,
  feed,
  entry,
  now,
  query = null,
}: {
  agentId: string;
  sourceType: 'rss_atom' | 'official' | 'sec_edgar' | 'arxiv' | 'github_releases';
  feed: Pick<ResearchFeedConfig, 'publisher' | 'trustTier' | 'topics'>;
  entry: { title: string; url: string; publishedAt: string; excerpt: string };
  now: Date;
  query?: string | null;
}): SourceDocument {
  const canonicalUrl = canonicalizeResearchUrl(entry.url) || entry.url;
  const title = compactText(entry.title, 300);
  const excerpt = compactText(entry.excerpt, 1200);
  const entities = extractResearchEntities(`${title}. ${excerpt}`);
  const publishedAt = safePublishedAt(entry.publishedAt, now);
  const claims = sourceType === 'sec_edgar'
    ? secFilingClaims(title, excerpt, canonicalUrl)
    : extractDeterministicClaims(title, excerpt);
  return {
    schemaVersion: 2,
    id: stableResearchId('source', canonicalUrl),
    agentId,
    sourceType,
    canonicalUrl,
    title,
    publisher: feed.publisher,
    publishedAt,
    fetchedAt: now.toISOString(),
    trustTier: feed.trustTier,
    isPrimary: feed.trustTier === 'primary',
    excerpt,
    contentHash: stableResearchId('content', title, excerpt),
    entities,
    claims,
    topics: feed.topics,
    query,
    metadata: { publishedAtKnown: publishedAt !== '1970-01-01T00:00:00.000Z' },
  };
}

export function sourceDocumentsFromTrending(
  agentId: string,
  topics: TrendingTopic[],
  now = new Date(),
): SourceDocument[] {
  return topics.flatMap((topic) => {
    const sourceType: 'hacker_news' | 'x' = topic.sourceType === 'hacker_news' ? 'hacker_news' : 'x';
    const evidence = sourceType === 'x' && topic.evidence?.length
      ? topic.evidence.map((entry) => ({
          url: entry.sourceUrl,
          text: entry.text,
          publisher: `@${entry.author.replace(/^@/, '')}`,
          publishedAt: entry.createdAt,
          primary: entry.isPrimarySource === true,
          tweetId: entry.tweetId,
        }))
      : [{
          url: topic.sourceUrl || '',
          text: topic.topTweet?.text || topic.topicWhyNow || topic.headline,
          publisher: topic.publisher || topic.source || (sourceType === 'x' ? 'X' : 'Hacker News'),
          publishedAt: topic.observedAt || topic.timestamp,
          primary: topic.isPrimarySource === true,
          tweetId: topic.topTweet?.id || null,
        }];
    return evidence.flatMap((entry) => {
      const canonicalUrl = canonicalizeResearchUrl(entry.url);
      if (!canonicalUrl) return [];
      const excerpt = compactText(entry.text, 1200);
      const title = compactText(topic.headline, 300);
      const entities = [...new Set([...(topic.entities || []), ...extractResearchEntities(`${title}. ${excerpt}`)])].slice(0, 12);
      const publishedAt = safePublishedAt(entry.publishedAt, now);
      return [{
        schemaVersion: 2 as const,
        id: stableResearchId('source', canonicalUrl),
        agentId,
        sourceType,
        canonicalUrl,
        title,
        publisher: entry.publisher,
        publishedAt,
        fetchedAt: now.toISOString(),
        trustTier: entry.primary ? 'primary' as const : 'community' as const,
        isPrimary: entry.primary,
        excerpt,
        contentHash: stableResearchId('content', title, excerpt),
        entities,
        claims: sourceType === 'x'
          ? extractDeterministicClaims(excerpt, '')
          : extractDeterministicClaims(title, excerpt),
        topics: [topic.category, topic.semanticDomain || ''].filter(Boolean),
        query: null,
        metadata: {
          trendTopicId: topic.networkTopicId || String(topic.id),
          sourceTweetId: entry.tweetId,
          sourceCount: topic.sourceCount || evidence.length,
          sourceQuality: topic.sourceQuality ?? null,
          networkMomentum: topic.networkMomentumScore ?? null,
          operatorEngagement: topic.operatorEngagementScore ?? null,
          publishedAtKnown: publishedAt !== '1970-01-01T00:00:00.000Z',
        },
      }];
    });
  }).filter((document, index, documents) => documents.findIndex((entry) => entry.id === document.id) === index);
}

export async function fetchConfiguredFeeds(
  context: ResearchAdapterContext,
  lane: 'all' | 'rss_atom' | 'official' = 'all',
): Promise<ResearchAdapterResult> {
  const fetchImpl = context.fetchImpl || fetch;
  const now = context.now || new Date();
  const configuredFeeds = [...DEFAULT_RESEARCH_FEEDS, ...context.agenda.rssFeeds]
    .filter((feed, index, entries) => entries.findIndex((item) => item.url === feed.url) === index)
    .filter((feed) => lane === 'all' || (feed.sourceType || 'rss_atom') === lane);
  const feeds = configuredFeeds.filter((feed) => !getResearchFeedUrlIssue(feed));
  const documents: SourceDocument[] = [];
  const errors: string[] = configuredFeeds.flatMap((feed) => {
    const issue = getResearchFeedUrlIssue(feed);
    return issue ? [`${feed.id}: ${issue}`] : [];
  });

  const results = await Promise.allSettled(feeds.map(async (feed) => {
    const xml = await fetchText(
      feed.url,
      fetchImpl,
      {},
      feed.sourceType === 'official' || feed.trustTier === 'primary',
    );
    return parseSyndicationFeed(xml, 20)
      .filter((entry) => entryMatchesAgenda(entry.title, entry.excerpt, feed.topics, context.agenda))
      .map((entry) => feedDocument({
        agentId: context.agentId,
        sourceType: feed.sourceType || 'rss_atom',
        feed,
        entry,
        now,
      }));
  }));

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') documents.push(...result.value);
    else errors.push(`${feeds[index]?.id || 'feed'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  });
  return {
    sourceType: lane === 'official' ? 'official' : 'rss_atom',
    documents: documents.slice(0, MAX_DOCUMENTS_PER_ADAPTER),
    errors,
  };
}

export async function fetchSecEdgar(
  context: ResearchAdapterContext,
): Promise<ResearchAdapterResult> {
  const fetchImpl = context.fetchImpl || fetch;
  const now = context.now || new Date();
  const url = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&count=80&output=atom';
  try {
    const xml = await fetchText(url, fetchImpl, {}, true);
    const feed = {
      publisher: 'U.S. Securities and Exchange Commission',
      trustTier: 'primary' as SourceTrustTier,
      topics: ['markets', 'startups', 'finance', 'companies'],
    };
    const documents = parseSyndicationFeed(xml, 80)
      .filter((entry) => secEntryMatchesAgenda(entry, context.agenda))
      .slice(0, 20)
      .map((entry) => feedDocument({
        agentId: context.agentId,
        sourceType: 'sec_edgar',
        feed,
        entry,
        now,
      }));
    return { sourceType: 'sec_edgar', documents, errors: [] };
  } catch (error) {
    return {
      sourceType: 'sec_edgar',
      documents: [],
      errors: [`sec_edgar: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function arxivQueryUrl(query: string): string {
  const search = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .slice(0, 3)
    .map((term) => `all:${term.replace(/[^a-zA-Z0-9+_.-]/g, '')}`)
    .filter((term) => term.length > 4)
    .join('+AND+');
  return `https://export.arxiv.org/api/query?search_query=${search || 'all:technology'}&start=0&max_results=8&sortBy=submittedDate&sortOrder=descending`;
}

export async function fetchArxiv(
  context: ResearchAdapterContext,
): Promise<ResearchAdapterResult> {
  const fetchImpl = context.fetchImpl || fetch;
  const now = context.now || new Date();
  const queries = context.agenda.queries.slice(0, 3);
  const feed = {
    publisher: 'arXiv',
    // The paper is the primary source for its own reported result; downstream
    // qualification still keeps model-extracted claims tied to the abstract.
    trustTier: 'primary' as SourceTrustTier,
    topics: ['research', 'science', 'technology'],
  };
  const documents: SourceDocument[] = [];
  const errors: string[] = [];
  const results = await Promise.allSettled(queries.map(async (query) => {
    const xml = await fetchText(arxivQueryUrl(query), fetchImpl, {}, true);
    return parseSyndicationFeed(xml, 8).map((entry) => feedDocument({
      agentId: context.agentId,
      sourceType: 'arxiv',
      feed,
      entry,
      now,
      query,
    }));
  }));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') documents.push(...result.value);
    else errors.push(`arxiv:${queries[index] || 'query'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  });
  return { sourceType: 'arxiv', documents: documents.slice(0, MAX_DOCUMENTS_PER_ADAPTER), errors };
}

export async function fetchGithubReleases(
  context: ResearchAdapterContext,
): Promise<ResearchAdapterResult> {
  const fetchImpl = context.fetchImpl || fetch;
  const now = context.now || new Date();
  const repositories = [...DEFAULT_RESEARCH_GITHUB_REPOSITORIES, ...context.agenda.githubRepositories]
    .map((repository) => repository.replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, ''))
    .filter((repository) => /^[\w.-]+\/[\w.-]+$/.test(repository))
    .filter((repository, index, entries) => entries.indexOf(repository) === index)
    .slice(0, 12);
  const documents: SourceDocument[] = [];
  const errors: string[] = [];
  const results = await Promise.allSettled(repositories.map(async (repository) => {
    const xml = await fetchText(`https://github.com/${repository}/releases.atom`, fetchImpl, {}, true);
    const feed = {
      publisher: repository,
      trustTier: 'primary' as SourceTrustTier,
      topics: ['software', 'ai', 'developer tools', ...significantResearchTokens(repository)],
    };
    return parseSyndicationFeed(xml, 8).map((entry) => feedDocument({
      agentId: context.agentId,
      sourceType: 'github_releases',
      feed,
      entry: { ...entry, excerpt: stripResearchMarkup(entry.excerpt, 1200) },
      now,
      query: repository,
    }));
  }));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') documents.push(...result.value);
    else errors.push(`github:${repositories[index] || 'repository'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  });
  return { sourceType: 'github_releases', documents: documents.slice(0, MAX_DOCUMENTS_PER_ADAPTER), errors };
}

export async function runExternalResearchAdapters(
  context: ResearchAdapterContext,
): Promise<ResearchAdapterResult[]> {
  return Promise.all([
    fetchConfiguredFeeds(context),
    fetchSecEdgar(context),
    fetchArxiv(context),
    fetchGithubReleases(context),
  ]);
}
