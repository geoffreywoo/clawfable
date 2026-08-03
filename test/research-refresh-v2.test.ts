import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchAgenda, ResearchRefreshState, SourceDocument, StoryCluster } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  acquireResearchRefreshLock: vi.fn(),
  replaceLegacySemanticBackfillBlocks: vi.fn(),
  getFeedback: vi.fn(),
  getLearnings: vi.fn(),
  getPerformanceHistory: vi.fn(),
  getResearchAgenda: vi.fn(),
  getResearchRefreshState: vi.fn(),
  getSemanticBlocks: vi.fn(),
  getStoryClusters: vi.fn(),
  getTrendingCacheSnapshot: vi.fn(),
  getTweets: vi.fn(),
  releaseResearchRefreshLock: vi.fn(),
  saveResearchAgenda: vi.fn(),
  saveResearchRefreshState: vi.fn(),
  upsertSourceDocuments: vi.fn(),
  upsertStoryClusters: vi.fn(),
  fetchArxiv: vi.fn(),
  fetchConfiguredFeeds: vi.fn(),
  fetchGithubReleases: vi.fn(),
  fetchNewsSearch: vi.fn(),
  fetchSecEdgar: vi.fn(),
  fetchUsgsPublications: vi.fn(),
  sourceDocumentsFromTrending: vi.fn(),
  refreshAgentTopicIntelligence: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  generateText: vi.fn(),
  hasTextGenerationProvider: () => false,
}));

vi.mock('@/lib/kv-storage', () => ({
  acquireResearchRefreshLock: mocks.acquireResearchRefreshLock,
  replaceLegacySemanticBackfillBlocks: mocks.replaceLegacySemanticBackfillBlocks,
  getFeedback: mocks.getFeedback,
  getLearnings: mocks.getLearnings,
  getPerformanceHistory: mocks.getPerformanceHistory,
  getResearchAgenda: mocks.getResearchAgenda,
  getResearchRefreshState: mocks.getResearchRefreshState,
  getSemanticBlocks: mocks.getSemanticBlocks,
  getStoryClusters: mocks.getStoryClusters,
  getTrendingCacheSnapshot: mocks.getTrendingCacheSnapshot,
  getTweets: mocks.getTweets,
  releaseResearchRefreshLock: mocks.releaseResearchRefreshLock,
  saveResearchAgenda: mocks.saveResearchAgenda,
  saveResearchRefreshState: mocks.saveResearchRefreshState,
  upsertSourceDocuments: mocks.upsertSourceDocuments,
  upsertStoryClusters: mocks.upsertStoryClusters,
}));

vi.mock('@/lib/research-adapters', () => ({
  DEFAULT_RESEARCH_FEEDS: [],
  DEFAULT_RESEARCH_GITHUB_REPOSITORIES: [],
  fetchArxiv: mocks.fetchArxiv,
  fetchConfiguredFeeds: mocks.fetchConfiguredFeeds,
  fetchGithubReleases: mocks.fetchGithubReleases,
  fetchNewsSearch: mocks.fetchNewsSearch,
  fetchSecEdgar: mocks.fetchSecEdgar,
  fetchUsgsPublications: mocks.fetchUsgsPublications,
  isLowSignalSecFilingTitle: (title: string) => /^424B\d*\b/i.test(title),
  sourceDocumentsFromTrending: mocks.sourceDocumentsFromTrending,
}));

vi.mock('@/lib/topic-intelligence-refresh', () => ({
  refreshAgentTopicIntelligence: mocks.refreshAgentTopicIntelligence,
}));

import { refreshAgentResearch } from '@/lib/research-pipeline';
import { buildResearchSemanticKey, stableResearchId } from '@/lib/research-utils';

const nowIso = '2026-08-01T20:00:00.000Z';
const agenda: ResearchAgenda = {
  schemaVersion: 2,
  agentId: 'agent-1',
  queries: ['AI startups'],
  operatorTopics: ['AI startups'],
  pinnedQuestions: [],
  blockedTopics: [],
  blockedStoryKeys: [],
  domainWeights: { ai: 1, startup: 0.8 },
  rssFeeds: [],
  githubRepositories: [],
  updatedAt: nowIso,
};

function document(id: string, sourceType: SourceDocument['sourceType'] = 'official'): SourceDocument {
  return {
    schemaVersion: 2,
    id,
    agentId: 'agent-1',
    sourceType,
    canonicalUrl: `https://example.com/${id}`,
    title: 'AI startup inference costs change company formation',
    publisher: id,
    publishedAt: nowIso,
    fetchedAt: nowIso,
    trustTier: 'primary',
    isPrimary: true,
    excerpt: 'A concrete AI startup cost change affects founders and products.',
    contentHash: `hash-${id}`,
    entities: ['AI Startup'],
    claims: [{ id: `claim-${id}`, text: 'AI inference costs changed startup product economics.', kind: 'measurement', confidence: 0.9, entities: ['AI Startup'] }],
    topics: ['AI startups'],
    query: null,
    metadata: {},
  };
}

describe('research refresh orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowIso));
    mocks.acquireResearchRefreshLock.mockResolvedValue({ acquired: true, owner: 'lock-owner', lock: null });
    mocks.releaseResearchRefreshLock.mockResolvedValue(true);
    mocks.getResearchRefreshState.mockResolvedValue(null);
    mocks.getResearchAgenda.mockResolvedValue(agenda);
    mocks.getLearnings.mockResolvedValue(null);
    mocks.getPerformanceHistory.mockResolvedValue([]);
    mocks.getFeedback.mockResolvedValue([]);
    mocks.getTweets.mockResolvedValue([]);
    mocks.getSemanticBlocks.mockResolvedValue([]);
    mocks.getStoryClusters.mockResolvedValue([]);
    mocks.getTrendingCacheSnapshot.mockResolvedValue({ data: [] });
    mocks.saveResearchAgenda.mockResolvedValue(undefined);
    mocks.saveResearchRefreshState.mockResolvedValue(undefined);
    mocks.replaceLegacySemanticBackfillBlocks.mockImplementation(async (_agentId, blocks) => [
      ...blocks,
      ...(await mocks.getSemanticBlocks()).filter((block: { id: string }) => !block.id.startsWith('semantic-block-backfill-')),
    ]);
    mocks.upsertSourceDocuments.mockImplementation(async (_agentId, documents) => documents);
    mocks.upsertStoryClusters.mockImplementation(async (_agentId, clusters) => clusters);
    mocks.sourceDocumentsFromTrending.mockReturnValue([]);
    mocks.fetchConfiguredFeeds.mockImplementation(async (_context, lane) => ({
      sourceType: lane,
      documents: lane === 'official' ? [document('official-1')] : [document('rss-1', 'rss_atom')],
      errors: lane === 'rss_atom' ? ['rss-1: temporary outage'] : [],
    }));
    mocks.fetchSecEdgar.mockResolvedValue({ sourceType: 'sec_edgar', documents: [], errors: ['sec_edgar: unavailable'] });
    mocks.fetchArxiv.mockResolvedValue({ sourceType: 'arxiv', documents: [], errors: [] });
    mocks.fetchGithubReleases.mockResolvedValue({ sourceType: 'github_releases', documents: [document('github-1', 'github_releases')], errors: [] });
    mocks.fetchNewsSearch.mockResolvedValue({ sourceType: 'news_search', documents: [], errors: [] });
    mocks.fetchUsgsPublications.mockResolvedValue({ sourceType: 'official_publications', documents: [], errors: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores successful adapters during a partial outage and advances only successful schedules', async () => {
    const result = await refreshAgentResearch({
      id: 'agent-1', handle: 'geoffwoo', name: 'Geoffrey', soulMd: '# AI startups', isConnected: 0,
    } as any);

    expect(result).toMatchObject({ attempted: true, busy: false, documentsFetched: 3, documentsStored: 3 });
    expect(result.errors).toEqual(expect.arrayContaining(['rss-1: temporary outage', 'sec_edgar: unavailable']));
    const finalState = mocks.saveResearchRefreshState.mock.calls.at(-1)?.[1] as ResearchRefreshState;
    expect(finalState.adapterRefreshedAt).toEqual(expect.objectContaining({
      official: nowIso,
      arxiv: nowIso,
      github_releases: nowIso,
    }));
    expect(finalState.adapterRefreshedAt).not.toHaveProperty('rss_atom');
    expect(finalState.adapterRefreshedAt).not.toHaveProperty('sec_edgar');
    expect(mocks.replaceLegacySemanticBackfillBlocks).toHaveBeenCalledWith('agent-1', []);
    expect(mocks.releaseResearchRefreshLock).toHaveBeenCalledWith('agent-1', 'lock-owner');
  });

  it('replaces only malformed legacy backfill blocks and preserves structured V2 feedback', async () => {
    const structured = {
      schemaVersion: 2,
      id: 'semantic-block-structured',
      agentId: 'agent-1',
      scope: 'copy',
      semanticKey: 'stiff:packaged:writing',
      topic: 'AI startups',
      storyClusterId: null,
      ideaId: 'idea-1',
      reasonCode: 'bad_writing',
      reason: 'Sounds packaged.',
      permanent: false,
      blockedUntil: '2026-09-01T00:00:00.000Z',
      createdAt: nowIso,
    } as const;
    mocks.getSemanticBlocks.mockResolvedValue([structured, { ...structured, id: 'semantic-block-backfill-old', semanticKey: 'wrong:rationale:key' }]);
    mocks.getFeedback.mockResolvedValue([{
      tweetText: 'does any fighter actually want this merger?',
      rating: 'down',
      generatedAt: nowIso,
      reason: 'Bad premise. Do not regenerate this PFL/MVP angle.',
      source: 'queue_delete',
      userProvidedReason: true,
    }]);

    await refreshAgentResearch({
      id: 'agent-1', handle: 'geoffwoo', name: 'Geoffrey', soulMd: '# AI startups', isConnected: 0,
    } as any);

    const replacement = await mocks.replaceLegacySemanticBackfillBlocks.mock.results[0]?.value;
    expect(replacement).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'semantic-block-structured' }),
      expect.objectContaining({ id: expect.stringContaining('semantic-block-backfill-') }),
    ]));
    expect(replacement).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticKey: 'wrong:rationale:key' }),
    ]));
  });

  it('does not refetch or re-age cached evidence while every adapter is still fresh', async () => {
    const cached = document('cached-1');
    const semanticKey = buildResearchSemanticKey(cached.title, cached.entities);
    const existingCluster = {
      schemaVersion: 2,
      id: stableResearchId('story', semanticKey),
      agentId: 'agent-1',
      semanticKey,
      title: cached.title,
      summary: cached.claims[0].text,
      topic: 'AI startups',
      entities: cached.entities,
      sourceDocumentIds: [cached.id],
      qualifiedClaimIds: [cached.claims[0].id],
      primarySourceCount: 1,
      independentSourceCount: 1,
      evidenceQualified: true,
      scores: { identityFit: 0.8, evidenceStrength: 0.8, consequence: 0.7, freshness: 0.8, novelty: 0.8, networkMomentum: 0, total: 0.75 },
      firstSeenAt: '2026-07-31T20:00:00.000Z',
      lastSeenAt: '2026-08-01T16:00:00.000Z',
      blockedUntil: null,
      blockReason: null,
    } satisfies StoryCluster;
    const adapterRefreshedAt = Object.fromEntries(
      ['x', 'hacker_news', 'rss_atom', 'news_search', 'official', 'official_publications', 'sec_edgar', 'arxiv', 'github_releases'].map((sourceType) => [sourceType, nowIso]),
    );
    mocks.getResearchRefreshState.mockResolvedValue({
      schemaVersion: 2,
      agentId: 'agent-1',
      lastStartedAt: nowIso,
      lastCompletedAt: nowIso,
      adapterRefreshedAt,
      documentsFetched: 1,
      storiesQualified: 1,
      partialFailures: [],
      semanticBackfillVersion: 1,
    });
    mocks.getStoryClusters.mockResolvedValue([existingCluster]);
    mocks.upsertSourceDocuments.mockResolvedValue([cached]);

    const result = await refreshAgentResearch({
      id: 'agent-1', handle: 'geoffwoo', name: 'Geoffrey', soulMd: '# AI startups', isConnected: 1,
    } as any);

    expect(result.documentsFetched).toBe(0);
    expect(mocks.refreshAgentTopicIntelligence).not.toHaveBeenCalled();
    expect(mocks.fetchConfiguredFeeds).not.toHaveBeenCalled();
    expect(mocks.fetchNewsSearch).not.toHaveBeenCalled();
    expect(mocks.fetchSecEdgar).not.toHaveBeenCalled();
    expect(mocks.fetchArxiv).not.toHaveBeenCalled();
    expect(mocks.fetchGithubReleases).not.toHaveBeenCalled();
    expect(mocks.fetchUsgsPublications).not.toHaveBeenCalled();
    expect(mocks.sourceDocumentsFromTrending).not.toHaveBeenCalled();
    const storedClusters = mocks.upsertStoryClusters.mock.calls[0]?.[1] as StoryCluster[];
    expect(storedClusters[0].lastSeenAt).toBe(existingCluster.lastSeenAt);
  });

  it('returns immediately when another refresh owns the idempotency lock', async () => {
    mocks.acquireResearchRefreshLock.mockResolvedValue({ acquired: false, owner: 'other', lock: {} });

    const result = await refreshAgentResearch({ id: 'agent-1' } as any);

    expect(result).toMatchObject({ attempted: false, refreshed: false, busy: true });
    expect(mocks.getResearchAgenda).not.toHaveBeenCalled();
    expect(mocks.releaseResearchRefreshLock).not.toHaveBeenCalled();
  });
});
