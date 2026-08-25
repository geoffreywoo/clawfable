import { describe, expect, it, vi } from 'vitest';
import {
  fetchArxiv,
  fetchConfiguredFeeds,
  fetchGithubReleases,
  fetchNewsSearch,
  fetchUsgsPublications,
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

  it('treats an official portfolio company X post as first-party evidence', () => {
    const [document] = sourceDocumentsFromTrending('agent-1', [{
      id: 4,
      headline: 'Etched ships an inference rack',
      source: '@Etched',
      sourceType: 'x',
      sourceUrl: 'https://x.com/Etched/status/4',
      relevanceScore: 95,
      category: 'ai',
      timestamp: now.toISOString(),
      tweetCount: 1,
      evidence: [{
        tweetId: '4', author: 'Etched', authorName: 'Etched', authorVerified: true, text: 'We shipped our first rack to Jane Street.', createdAt: now.toISOString(),
        sourceUrl: 'https://x.com/Etched/status/4', likes: 100, retweets: 20, replies: 5, quotes: 4,
        bookmarks: 10, weightedEngagement: 139, authorBaseline: 30, breakoutMultiple: 4.6,
        engagementVelocity: 3, viralScore: 0.9, isPrimarySource: false,
      }],
    }] as any, now);

    expect(document).toMatchObject({
      publisher: '@Etched',
      isPrimary: true,
      trustTier: 'primary',
      metadata: expect.objectContaining({
        portfolioCompanyId: 'etched',
        portfolioPrimaryReason: 'official_company_x_account',
        sourceAuthorHandle: 'Etched',
        sourceAuthorName: 'Etched',
        sourceAuthorVerified: true,
      }),
    });
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

  it('turns SEC index metadata into an explicit filing claim', async () => {
    const xml = '<feed><entry><title>SCHEDULE 13D/A - Hyperscale Data, Inc. (0000896493) (Filed by)</title><link href="https://www.sec.gov/Archives/edgar/data/896493/example-index.htm"/><updated>2026-08-01T10:00:00Z</updated><summary>Filed: 2026-08-01 AccNo: 0000000000-00-000001 Size: 10 KB</summary></entry></feed>';
    const fetchImpl = vi.fn(async () => new Response(xml, { status: 200 })) as unknown as typeof fetch;
    const result = await fetchSecEdgar({
      agentId: 'agent-1',
      agenda: { ...agenda, queries: ['hyperscale data'] },
      trending: [],
      fetchImpl,
      now,
    });

    expect(result.documents[0]?.claims).toEqual([
      expect.objectContaining({
        kind: 'announcement',
        confidence: 0.92,
        text: 'Hyperscale Data, Inc. filed SEC form SCHEDULE 13D/A on 2026-08-01.',
      }),
    ]);
  });

  it('drops routine SEC forms that only match generic finance terms', async () => {
    const xml = '<feed><entry><title>424B2 - Morgan Stanley Finance LLC (0001666268) (Filer)</title><link href="https://www.sec.gov/Archives/edgar/data/1666268/example-index.htm"/><updated>2026-08-01T10:00:00Z</updated><summary>Filed: 2026-08-01 AccNo: 0000000000-00-000001 Size: 469 KB</summary></entry></feed>';
    const fetchImpl = vi.fn(async () => new Response(xml, { status: 200 })) as unknown as typeof fetch;
    const result = await fetchSecEdgar({
      agentId: 'agent-1',
      agenda: { ...agenda, queries: ['finance markets'] },
      trending: [],
      fetchImpl,
      now,
    });

    expect(result.documents).toEqual([]);
  });

  it('discovers fresh query-matched news without promoting it to primary evidence', async () => {
    const xml = `<rss><channel>
      <item><title>Chiplet hybrid bonding yield improves at production scale - Fabrication Weekly</title><link>https://news.google.com/rss/articles/story-1</link><pubDate>Fri, 31 Jul 2026 10:00:00 GMT</pubDate><description>Chiplet hybrid bonding yield improved in a new production process. Fabrication Weekly</description></item>
      <item><title>Unrelated sports result - Sports Desk</title><link>https://news.google.com/rss/articles/story-2</link><pubDate>Fri, 31 Jul 2026 10:00:00 GMT</pubDate><description>A match ended.</description></item>
    </channel></rss>`;
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(xml, { status: 200 }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const query = 'hybrid bonding alignment yield chiplets';
    const result = await fetchNewsSearch({
      agentId: 'agent-1',
      agenda: { ...agenda, queries: [query] },
      trending: [],
      fetchImpl,
      now,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('when%3A14d');
    expect(result.errors).toEqual([]);
    expect(result.documents).toEqual([
      expect.objectContaining({
        sourceType: 'news_search',
        publisher: 'Fabrication Weekly',
        title: 'Chiplet hybrid bonding yield improves at production scale',
        trustTier: 'community',
        isPrimary: false,
        query,
      }),
    ]);
  });

  it('quotes engaged named subjects instead of diluting company searches with domain labels', async () => {
    const xml = `<rss><channel>
      <item><title>Cognition AI discusses a new financing round - Startup Ledger</title><link>https://news.google.com/rss/articles/cognition-story</link><pubDate>Fri, 31 Jul 2026 10:00:00 GMT</pubDate><description>Cognition AI is discussing a new financing round. Startup Ledger</description></item>
    </channel></rss>`;
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(xml, { status: 200 }));
    const query = 'Cognition AI in ai compute';
    const result = await fetchNewsSearch({
      agentId: 'agent-1',
      agenda: { ...agenda, queries: [query] },
      trending: [],
      fetchImpl: fetchMock as unknown as typeof fetch,
      now,
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get('q')).toBe('"Cognition AI" when:14d');
    expect(result.documents).toEqual([
      expect.objectContaining({
        title: 'Cognition AI discusses a new financing round',
        publisher: 'Startup Ledger',
        query,
      }),
    ]);
  });

  it('retrieves canonical primary records from the USGS publications API', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({
      records: [{
        indexId: 'ofr20261018',
        displayTitle: 'Production of mineral commodities and infrastructure in China',
        publicationDate: '2026-06-12',
        docAbstract: '<p>China produced 98 percent of global gallium supply and held major tungsten processing capacity.</p>',
        doi: '10.3133/ofr20261018',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const query = 'USGS tungsten mineral commodity summary';
    const result = await fetchUsgsPublications({
      agentId: 'agent-1',
      agenda: { ...agenda, queries: [query] },
      trending: [],
      fetchImpl,
      now,
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain('q=tungsten');
    expect(result.errors).toEqual([]);
    expect(result.documents).toEqual([
      expect.objectContaining({
        sourceType: 'official_publications',
        canonicalUrl: 'https://pubs.usgs.gov/publication/ofr20261018',
        publisher: 'U.S. Geological Survey',
        trustTier: 'primary',
        isPrimary: true,
        query,
      }),
    ]);
    expect(result.documents[0].excerpt).not.toContain('<p>');
  });
});
