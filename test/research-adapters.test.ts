import { describe, expect, it, vi } from 'vitest';
import {
  fetchArxiv,
  fetchConfiguredFeeds,
  fetchGithubReleases,
  getResearchFeedUrlIssue,
  fetchSecEdgar,
  sourceDocumentsFromTrending,
} from '@/lib/research-adapters';
import type { ResearchAgenda } from '@/lib/types';

const now = new Date('2026-08-01T12:00:00.000Z');
const agenda: ResearchAgenda = {
  schemaVersion: 2,
  agentId: 'agent-1',
  queries: ['AI startups'],
  pinnedQuestions: [],
  blockedTopics: [],
  blockedStoryKeys: [],
  domainWeights: { ai: 1, startups: 0.8 },
  rssFeeds: [],
  githubRepositories: [],
  updatedAt: now.toISOString(),
};

function atom(title = 'AI startup release', url = 'https://example.com/release'): string {
  return `<feed><entry><title>${title}</title><link href="${url}"/><updated>2026-08-01T10:00:00Z</updated><summary>The startup released an AI product for buyers.</summary></entry></feed>`;
}

describe('research adapters', () => {
  it('rejects private feed targets and non-allowlisted primary-source hosts', () => {
    expect(getResearchFeedUrlIssue({ url: 'http://127.0.0.1/feed', trustTier: 'trusted' })).toBe('HTTPS is required');
    expect(getResearchFeedUrlIssue({ url: 'https://192.168.1.4/feed', trustTier: 'trusted' })).toBe('private network hosts are not allowed');
    expect(getResearchFeedUrlIssue({ url: 'https://random.example/feed', trustTier: 'primary', sourceType: 'official' })).toBe('official source host is not allowlisted');
    expect(getResearchFeedUrlIssue({ url: 'https://www.sec.gov/news/feed', trustTier: 'primary', sourceType: 'official' })).toBeNull();
  });

  it('converts source-backed network topics and drops URL-less chatter', () => {
    const documents = sourceDocumentsFromTrending('agent-1', [{
      id: 1,
      headline: 'AI startup buyers change procurement behavior',
      source: 'Hacker News',
      sourceType: 'hacker_news',
      sourceUrl: 'https://example.com/story?utm_source=hn',
      relevanceScore: 90,
      category: 'startups',
      timestamp: now.toISOString(),
      tweetCount: 1,
      topTweet: { id: '1', text: 'The procurement result is concrete.', likes: 4, author: 'builder' },
    }, {
      id: 2,
      headline: 'Unsupported chatter',
      source: 'X',
      relevanceScore: 80,
      category: 'ai',
      timestamp: now.toISOString(),
      tweetCount: 1,
      topTweet: { id: '2', text: 'Rumor only', likes: 1, author: 'anon' },
    }] as any, now);

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      canonicalUrl: 'https://example.com/story',
      sourceType: 'hacker_news',
      trustTier: 'community',
      isPrimary: false,
    });
  });

  it('keeps per-post X provenance instead of promoting a whole topic to primary', () => {
    const documents = sourceDocumentsFromTrending('agent-1', [{
      id: 3,
      headline: 'AI infrastructure changes startup economics',
      source: '@secondary, @builder',
      sourceType: 'x',
      sourceUrl: 'https://x.com/secondary/status/1',
      isPrimarySource: true,
      relevanceScore: 90,
      category: 'startups',
      timestamp: now.toISOString(),
      tweetCount: 2,
      topTweet: { id: '1', text: 'Secondary commentary', likes: 10, author: 'secondary' },
      evidence: [{
        tweetId: '1', author: 'secondary', text: 'Secondary commentary', createdAt: now.toISOString(),
        sourceUrl: 'https://x.com/secondary/status/1', likes: 10, retweets: 1, replies: 1, quotes: 0,
        bookmarks: 0, weightedEngagement: 12, authorBaseline: 3, breakoutMultiple: 4,
        engagementVelocity: 1, viralScore: 0.8, isPrimarySource: false,
      }, {
        tweetId: '2', author: 'builder', text: 'We launched the infrastructure product.', createdAt: now.toISOString(),
        sourceUrl: 'https://x.com/builder/status/2', likes: 8, retweets: 1, replies: 1, quotes: 0,
        bookmarks: 0, weightedEngagement: 10, authorBaseline: 3, breakoutMultiple: 3,
        engagementVelocity: 1, viralScore: 0.7, isPrimarySource: true,
      }],
    }] as any, now);

    expect(documents).toHaveLength(2);
    expect(documents.find((document) => document.publisher === '@secondary')).toMatchObject({
      isPrimary: false,
      trustTier: 'community',
      claims: [expect.objectContaining({ text: expect.stringContaining('Secondary commentary') })],
    });
    expect(documents.find((document) => document.publisher === '@builder')).toMatchObject({ isPrimary: true, trustTier: 'primary' });
  });

  it('isolates a failed feed while preserving successful configured feeds', async () => {
    const configured = {
      ...agenda,
      rssFeeds: [
        { id: 'good', url: 'https://feeds.example.com/good.xml', publisher: 'Example', trustTier: 'trusted' as const, topics: ['ai'] },
        { id: 'bad', url: 'https://feeds.example.com/bad.xml', publisher: 'Bad', trustTier: 'trusted' as const, topics: ['ai'] },
      ],
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('bad.xml')) return new Response('unavailable', { status: 503, statusText: 'Unavailable' });
      return new Response(atom(), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await fetchConfiguredFeeds({ agentId: 'agent-1', agenda: configured, trending: [], fetchImpl, now });

    expect(result.documents.some((document) => document.publisher === 'Example')).toBe(true);
    expect(result.errors.some((error) => error.includes('bad'))).toBe(true);
  });

  it('revalidates redirects and enforces a bounded response size', async () => {
    const configured = {
      ...agenda,
      rssFeeds: [
        { id: 'redirect', url: 'https://feeds.example.com/redirect.xml', publisher: 'Redirect', trustTier: 'trusted' as const, topics: ['ai'] },
        { id: 'oversized', url: 'https://feeds.example.com/oversized.xml', publisher: 'Oversized', trustTier: 'trusted' as const, topics: ['ai'] },
      ],
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('redirect.xml')) {
        return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private-feed' } });
      }
      return new Response('too large', { status: 200, headers: { 'content-length': '3000000' } });
    }) as unknown as typeof fetch;

    const result = await fetchConfiguredFeeds(
      { agentId: 'agent-1', agenda: configured, trending: [], fetchImpl, now },
      'rss_atom',
    );

    expect(result.documents).toEqual([]);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('private network hosts are not allowed'),
      expect.stringContaining('feed exceeds size limit'),
    ]));
  });

  it('normalizes SEC, arXiv, and GitHub primary-source feeds', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('sec.gov')) return new Response(atom('AI startup files new market disclosure', 'https://www.sec.gov/Archives/example'), { status: 200 });
      if (value.includes('arxiv.org')) return new Response(atom('AI agents reduce inference cost', 'https://arxiv.org/abs/2608.00001'), { status: 200 });
      if (value.includes('github.com')) return new Response(atom('AI SDK release', `${value.replace('/releases.atom', '')}/releases/tag/v2`), { status: 200 });
      return new Response('missing', { status: 404 });
    }) as unknown as typeof fetch;
    const context = { agentId: 'agent-1', agenda, trending: [], fetchImpl, now };
    const [sec, arxiv, github] = await Promise.all([
      fetchSecEdgar(context),
      fetchArxiv(context),
      fetchGithubReleases(context),
    ]);

    expect(sec.documents[0]).toMatchObject({ sourceType: 'sec_edgar', trustTier: 'primary', isPrimary: true });
    expect(arxiv.documents[0]).toMatchObject({ sourceType: 'arxiv', query: 'AI startups', isPrimary: true });
    expect(github.documents).toHaveLength(3);
    expect(github.documents.every((document) => document.sourceType === 'github_releases' && document.isPrimary)).toBe(true);
  });
});
