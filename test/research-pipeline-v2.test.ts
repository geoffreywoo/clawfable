import { describe, expect, it } from 'vitest';
import {
  buildResearchAgenda,
  clusterAndQualifySources,
  isResearchDocumentEligibleForClustering,
  selectSourceDocumentsForEnrichment,
} from '@/lib/research-pipeline';
import type { ResearchAgenda, SourceDocument } from '@/lib/types';

const now = new Date('2026-08-01T12:00:00.000Z');

function source(overrides: Partial<SourceDocument> & Pick<SourceDocument, 'id' | 'title' | 'publisher'>): SourceDocument {
  return {
    schemaVersion: 2,
    agentId: 'agent-1',
    sourceType: 'rss_atom',
    canonicalUrl: `https://example.com/${overrides.id}`,
    publishedAt: '2026-08-01T10:00:00.000Z',
    fetchedAt: now.toISOString(),
    trustTier: 'trusted',
    isPrimary: false,
    excerpt: 'A startup buyer changed product behavior because cost and timing improved.',
    contentHash: `hash-${overrides.id}`,
    entities: ['Acme'],
    claims: [{
      id: `claim-${overrides.id}`,
      text: 'Acme reported a concrete product and buyer change.',
      kind: 'fact',
      confidence: 0.8,
      entities: ['Acme'],
    }],
    topics: ['AI startups'],
    query: 'AI startups',
    metadata: {},
    ...overrides,
  };
}

const agenda: ResearchAgenda = {
  schemaVersion: 2,
  agentId: 'agent-1',
  queries: ['AI startups', 'semiconductor markets'],
  pinnedQuestions: [],
  blockedTopics: [],
  blockedStoryKeys: [],
  domainWeights: { ai: 1, startups: 0.9, semiconductor: 0.7 },
  rssFeeds: [],
  githubRepositories: [],
  updatedAt: now.toISOString(),
};

describe('research agenda and story qualification', () => {
  it('derives search queries from operator topics and keeps explicit blocks separate from evidence', () => {
    const built = buildResearchAgenda({
      agent: { id: 'agent-1', name: 'Geoffrey', handle: 'geoffwoo', soulMd: '# Topics\n- AI hardware\n- startups' } as any,
      voiceProfile: {
        tone: 'direct',
        topics: ['AI hardware', 'startups'],
        antiGoals: [],
        communicationStyle: 'plain',
        summary: 'founder and investor',
      },
      learnings: {
        manualTopicProfile: [{
          topic: 'startups',
          angle: 'run similar max book leopold except do not leverage',
          weight: 1,
          sampleCount: 4,
          avgEngagement: 18,
          topTweets: [],
        }],
      } as any,
      performance: [{
        tweetId: 'tweet-1', xTweetId: 'x-1', content: 'vertical AI buyers', format: 'observation', topic: 'vertical AI',
        postedAt: now.toISOString(), checkedAt: now.toISOString(), likes: 20, retweets: 2, replies: 3,
        impressions: 3000, engagementRate: 0.01, wasViral: false, source: 'manual',
        thesis: 'day jakepaul journey march antifund commas https',
      }, {
        tweetId: '', xTweetId: 'x-unknown', content: 'unverified timeline post', format: 'observation', topic: 'unverified timeline topic',
        postedAt: now.toISOString(), checkedAt: now.toISOString(), likes: 200, retweets: 20, replies: 30,
        impressions: 30000, engagementRate: 0.01, wasViral: true, source: 'timeline', authorshipProvenance: 'timeline_unmatched',
      }, {
        tweetId: 'generated-1', xTweetId: 'x-generated', content: 'known generated post', format: 'observation', topic: 'generated topic',
        postedAt: now.toISOString(), checkedAt: now.toISOString(), likes: 200, retweets: 20, replies: 30,
        impressions: 30000, engagementRate: 0.01, wasViral: true, source: 'manual', authorshipProvenance: 'known_clawfable_generated',
      }],
      feedback: [{
        tweetId: 'tweet-2', tweetText: 'another generic mineral explainer', rating: 'down', generatedAt: now.toISOString(),
        reason: 'Do not regenerate this angle', source: 'queue_delete', userProvidedReason: true,
      }],
      tweets: [{ id: 'tweet-2', content: 'another generic mineral explainer', topic: 'mineral explainers' } as any],
      current: { ...agenda, pinnedQuestions: ['What changed in inference economics?'] },
    });

    expect(built.queries).toEqual(expect.arrayContaining(['What changed in inference economics?', 'AI hardware', 'vertical AI']));
    expect(built.queries).not.toContain('unverified timeline topic');
    expect(built.queries).not.toContain('generated topic');
    expect(built.queries).not.toContain('day jakepaul journey march antifund commas https');
    expect(built.queries).not.toContain('run similar max book leopold except do not leverage');
    expect(built.blockedTopics).toContain('mineral explainers');
    expect(built).not.toHaveProperty('evidence');
  });

  it('puts native discovery ahead of most frontier searches without dropping the frontier portfolio', () => {
    const built = buildResearchAgenda({
      agent: { id: 'agent-1', name: 'geoffreywoo', handle: 'geoffreywoo', soulMd: '' } as any,
      voiceProfile: {
        tone: 'analyst',
        topics: ['crypto', 'tech', 'startup'],
        antiGoals: [],
        communicationStyle: 'short and direct',
        summary: 'You are geoffreywoo.',
      },
      learnings: null,
      performance: [],
      feedback: [],
      tweets: [],
    });

    expect(built.queries.slice(0, 4)).toEqual([
      'technology products software developers startups companies',
      'startup founders funding acquisitions products customers',
      'inference ASIC HBM bandwidth rack power tokens per watt',
      'hybrid bonding alignment yield chiplets',
    ]);
    expect(built.queries).toEqual(expect.arrayContaining(['crypto', 'tech', 'startup']));
    expect(built.queries.filter((query) => /(?:inference|bonding|robot|transformer|tungsten|antimony|gallium|graphite|fluorspar)/i.test(query)).length).toBeLessThanOrEqual(12);
  });

  it('puts freshly engaged operator subjects into the live research agenda', () => {
    const built = buildResearchAgenda({
      agent: { id: 'agent-1', name: 'geoffwoo', handle: 'geoffwoo', soulMd: '' } as any,
      voiceProfile: {
        tone: 'direct',
        topics: ['AI', 'startups'],
        antiGoals: [],
        communicationStyle: 'short and direct',
        summary: 'founder and investor',
      },
      learnings: null,
      performance: [],
      feedback: [],
      tweets: [],
      current: { ...agenda, operatorTopics: ['OpenAI, Brad Lightcap in ai compute'] },
      operatorTopicSignals: [
        'Cognition AI in ai compute',
        'Trajectory, Sequoia in ai compute',
      ],
    });

    expect(built.operatorTopics).toEqual([
      'Cognition AI in ai compute',
      'Trajectory, Sequoia in ai compute',
      'OpenAI, Brad Lightcap in ai compute',
    ]);
    expect(built.queries.slice(0, 3)).toEqual(built.operatorTopics);
  });

  it('deduplicates stale operator subjects before they consume bounded search capacity', () => {
    const built = buildResearchAgenda({
      agent: { id: 'agent-1', name: 'geoffwoo', handle: 'geoffwoo', soulMd: '' } as any,
      voiceProfile: {
        tone: 'direct',
        topics: ['AI', 'startups'],
        antiGoals: [],
        communicationStyle: 'short and direct',
        summary: 'founder and investor',
      },
      learnings: null,
      performance: [],
      feedback: [],
      tweets: [],
      current: {
        ...agenda,
        operatorTopics: [
          'Polymarket, Modal, Databricks in finance investing',
          'Trajectory, Sequoia, AI Agenda in ai compute',
          'OpenAI, Brad Lightcap in ai compute',
        ],
      },
      operatorTopicSignals: [
        'Polymarket, Modal, Databricks in startups markets',
        'Trajectory, Sequoia in ai compute',
        'Cognition AI in ai compute',
      ],
    });

    expect(built.operatorTopics).toEqual([
      'Polymarket, Modal, Databricks in startups markets',
      'Trajectory, Sequoia in ai compute',
      'Cognition AI in ai compute',
      'OpenAI, Brad Lightcap in ai compute',
    ]);
    expect(built.queries.slice(0, 4)).toEqual(built.operatorTopics);
  });

  it('removes a blocked frontier angle without suppressing the broader source portfolio', () => {
    const built = buildResearchAgenda({
      agent: { id: 'agent-1', name: 'geoffreywoo', handle: 'geoffreywoo', soulMd: '' } as any,
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI', 'startups'],
        antiGoals: [],
        communicationStyle: 'short and direct',
        summary: 'You are geoffreywoo.',
      },
      learnings: null,
      performance: [],
      feedback: [],
      tweets: [],
      semanticBlocks: [{
        schemaVersion: 2,
        id: 'block-graphite-angle',
        agentId: 'agent-1',
        scope: 'idea',
        semanticKey: 'and:apparently:battery:digging:graphite:independence:means',
        topic: null,
        storyClusterId: null,
        ideaId: null,
        reasonCode: 'duplicate',
        reason: 'Do not repeat the mine-versus-processing graphite angle.',
        permanent: true,
        blockedUntil: null,
        createdAt: now.toISOString(),
      }],
    });

    expect(built.queries.some((query) => /graphite/i.test(query))).toBe(false);
    expect(built.queries).toEqual(expect.arrayContaining([
      'inference ASIC HBM bandwidth rack power tokens per watt',
      'acid grade fluorspar hydrofluoric acid semiconductor etch',
      'AI',
      'startups',
    ]));
  });

  it('qualifies a primary source or two independent sources, but not unsupported chatter', () => {
    const clusters = clusterAndQualifySources({
      agentId: 'agent-1',
      agenda,
      now,
      documents: [
        source({ id: 'primary', title: 'Acme launches an AI inference chip for startup buyers', publisher: 'Acme', trustTier: 'primary', isPrimary: true }),
        source({ id: 'secondary-a', title: 'Beta AI agents change customer support buying behavior', publisher: 'Publication A', entities: ['Beta'] }),
        source({ id: 'secondary-b', title: 'Beta AI agent changes customer support buyer behavior', publisher: 'Publication B', entities: ['Beta'] }),
        source({ id: 'chatter', title: 'Unverified quantum battery rumor spreads online', publisher: 'Forum', trustTier: 'community', entities: ['Quantum Battery'], topics: ['energy'] }),
      ],
    });

    expect(clusters.find((cluster) => cluster.sourceDocumentIds.includes('primary'))?.evidenceQualified).toBe(true);
    expect(clusters.find((cluster) => cluster.sourceDocumentIds.includes('secondary-a'))).toMatchObject({
      independentSourceCount: 2,
      evidenceQualified: true,
    });
    expect(clusters.find((cluster) => cluster.sourceDocumentIds.includes('secondary-a'))?.qualifiedClaimIds).toHaveLength(2);
    expect(clusters.find((cluster) => cluster.sourceDocumentIds.includes('chatter'))?.evidenceQualified).toBe(false);
  });

  it('uses learned semantic domains to qualify named live AI product stories', () => {
    const clusters = clusterAndQualifySources({
      agentId: 'agent-1',
      agenda,
      now,
      documents: [
        source({
          id: 'named-ai-product',
          title: 'Cognition ships a new model in Devin after a benchmark jump',
          excerpt: 'Cognition made the model available in Devin and reported higher benchmark performance.',
          publisher: 'Cognition',
          trustTier: 'primary',
          isPrimary: true,
          topics: ['AI products'],
          entities: ['Cognition', 'Devin'],
        }),
        source({
          id: 'unrelated-ocean',
          title: 'Researchers catalog a new deep ocean current',
          excerpt: 'The expedition cataloged a current in the southern ocean.',
          publisher: 'Ocean Institute',
          trustTier: 'primary',
          isPrimary: true,
          topics: ['ocean science'],
          entities: ['Ocean Institute'],
        }),
      ],
    });

    const ai = clusters.find((cluster) => cluster.sourceDocumentIds.includes('named-ai-product'))!;
    const unrelated = clusters.find((cluster) => cluster.sourceDocumentIds.includes('unrelated-ocean'))!;
    expect(ai.scores.identityFit).toBeGreaterThanOrEqual(0.68);
    expect(ai.scores.consequence).toBeGreaterThanOrEqual(0.48);
    expect(unrelated.scores.identityFit).toBeLessThan(0.55);
  });

  it('does not treat stale or one-token arXiv matches as current identity evidence', () => {
    const arxivAgenda = {
      ...agenda,
      queries: [
        'hybrid bonding alignment yield chiplets',
        'robot actuator life duty cycle field service',
        'inference ASIC HBM bandwidth rack power tokens per watt',
      ],
      domainWeights: { hybrid: 1, bonding: 1, alignment: 0.8, chiplet: 0.8 },
    };
    const clusters = clusterAndQualifySources({
      agentId: 'agent-1',
      agenda: arxivAgenda,
      now,
      documents: [
        source({
          id: 'stale-query',
          sourceType: 'arxiv',
          query: 'startup',
          title: 'A startup portfolio optimization paper',
          publisher: 'arXiv',
          trustTier: 'primary',
          isPrimary: true,
        }),
        source({
          id: 'one-token',
          sourceType: 'arxiv',
          query: arxivAgenda.queries[0],
          title: 'Hybrid portfolio optimization methods',
          excerpt: 'A hybrid statistical method evaluates portfolios.',
          publisher: 'arXiv',
          trustTier: 'primary',
          isPrimary: true,
        }),
        source({
          id: 'aligned-query',
          sourceType: 'arxiv',
          query: arxivAgenda.queries[0],
          title: 'Hybrid bonding alignment for chiplet systems',
          excerpt: 'The paper measures hybrid bonding alignment and package yield.',
          publisher: 'arXiv',
          trustTier: 'primary',
          isPrimary: true,
        }),
      ],
    });

    expect(clusters.find((cluster) => cluster.sourceDocumentIds.includes('stale-query'))?.scores.identityFit).toBeLessThan(0.55);
    expect(clusters.find((cluster) => cluster.sourceDocumentIds.includes('one-token'))?.scores.identityFit).toBeLessThan(0.55);
    expect(clusters.find((cluster) => cluster.sourceDocumentIds.includes('aligned-query'))?.scores.identityFit).toBeGreaterThanOrEqual(0.55);
  });

  it('does not treat two unrelated claims as corroboration merely because their story titles cluster', () => {
    const clusters = clusterAndQualifySources({
      agentId: 'agent-1',
      agenda,
      now,
      documents: [
        source({
          id: 'gamma-a',
          title: 'Gamma startup changes AI market behavior',
          publisher: 'Publication A',
          entities: ['Gamma'],
          claims: [{ id: 'claim-gamma-a', text: 'Gamma hired a new chief executive.', kind: 'fact', confidence: 0.8, entities: ['Gamma'] }],
        }),
        source({
          id: 'gamma-b',
          title: 'Gamma startup changes AI market behavior today',
          publisher: 'Publication B',
          entities: ['Gamma'],
          claims: [{ id: 'claim-gamma-b', text: 'Gamma opened an office in Berlin.', kind: 'fact', confidence: 0.8, entities: ['Gamma'] }],
        }),
      ],
    });

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ independentSourceCount: 2, evidenceQualified: false, qualifiedClaimIds: [] });
  });

  it('clusters independently corroborated story paraphrases with shared named entities', () => {
    const clusters = clusterAndQualifySources({
      agentId: 'agent-1',
      agenda: { ...agenda, queries: ['Trajectory, Sequoia in ai compute'] },
      now,
      documents: [
        source({
          id: 'trajectory-network',
          sourceType: 'x',
          title: 'Trajectory, a startup that helps businesses customize open-source models, reportedly raised new funding from Sequoia at a $300 million valuation shortly after its prior round.',
          publisher: '@steph_palazzolo',
          entities: ['Trajectory', 'Sequoia'],
          topics: ['AI startups'],
          claims: [{
            id: 'claim-trajectory-network',
            text: 'Trajectory raised new funding from Sequoia at a $300 million valuation shortly after its prior round.',
            kind: 'measurement',
            confidence: 0.8,
            entities: ['Trajectory', 'Sequoia'],
          }],
        }),
        source({
          id: 'trajectory-news',
          sourceType: 'news_search',
          title: 'Trajectory, Founded by Ex-Google and Apple Researchers, Raises Funding From Sequoia in Back-to-Back Round',
          publisher: 'The Information',
          entities: ['Trajectory', 'Sequoia'],
          topics: ['AI startups'],
          claims: [{
            id: 'claim-trajectory-news',
            text: 'Trajectory raised funding from Sequoia at a $300 million valuation in a back-to-back round.',
            kind: 'measurement',
            confidence: 0.8,
            entities: ['Trajectory', 'Sequoia'],
          }],
        }),
      ],
    });

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      independentSourceCount: 2,
      evidenceQualified: true,
      qualifiedClaimIds: expect.arrayContaining([
        'claim-trajectory-network',
        'claim-trajectory-news',
      ]),
    });
  });

  it('assigns zero freshness when a source has no trustworthy publication timestamp', () => {
    const [cluster] = clusterAndQualifySources({
      agentId: 'agent-1',
      agenda,
      now,
      documents: [source({
        id: 'undated',
        title: 'Undated AI startup archive item',
        publisher: 'Acme',
        trustTier: 'primary',
        isPrimary: true,
        publishedAt: '1970-01-01T00:00:00.000Z',
      })],
    });

    expect(cluster.scores.freshness).toBe(0);
  });

  it('keeps durable primary publications useful longer than event feeds', () => {
    const publishedAt = '2026-04-01T12:00:00.000Z';
    const [official] = clusterAndQualifySources({
      agentId: 'agent-1',
      agenda,
      now,
      documents: [source({
        id: 'usgs-report',
        sourceType: 'official_publications',
        title: 'AI mineral supply costs change startup market timing',
        publisher: 'U.S. Geological Survey',
        trustTier: 'primary',
        isPrimary: true,
        publishedAt,
      })],
    });
    const [news] = clusterAndQualifySources({
      agentId: 'agent-1',
      agenda,
      now,
      documents: [source({
        id: 'old-news',
        sourceType: 'news_search',
        title: 'AI mineral supply costs change startup market timing',
        publisher: 'Publication',
        publishedAt,
      })],
    });

    expect(official.scores.freshness).toBeGreaterThan(0.5);
    expect(news.scores.freshness).toBe(0);
  });

  it('spreads source enrichment capacity across adapters', () => {
    const documents = [
      source({ id: 'x-1', sourceType: 'x', title: 'X one', publisher: 'X' }),
      source({ id: 'x-2', sourceType: 'x', title: 'X two', publisher: 'X' }),
      source({ id: 'news', sourceType: 'news_search', title: 'News', publisher: 'News' }),
      source({ id: 'usgs', sourceType: 'official_publications', title: 'USGS', publisher: 'USGS' }),
      source({ id: 'arxiv', sourceType: 'arxiv', title: 'arXiv', publisher: 'arXiv' }),
    ];

    expect(selectSourceDocumentsForEnrichment(documents, 4).map((document) => document.id)).toEqual([
      'x-1', 'news', 'usgs', 'arxiv',
    ]);
  });

  it('keeps routine SEC cache entries out of clustering', () => {
    expect(isResearchDocumentEligibleForClustering(source({
      id: 'routine-sec',
      sourceType: 'sec_edgar',
      title: '424B2 - Morgan Stanley Finance LLC (Filer)',
      publisher: 'SEC',
    }))).toBe(false);
    expect(isResearchDocumentEligibleForClustering(source({
      id: 'material-sec',
      sourceType: 'sec_edgar',
      title: '8-K - Acme AI Infrastructure, Inc. (Filer)',
      publisher: 'SEC',
    }))).toBe(true);
  });

  it('blocks political drift and explicit source/topic exclusions before generation', () => {
    const clusters = clusterAndQualifySources({
      agentId: 'agent-1',
      agenda: { ...agenda, blockedTopics: ['semiconductor markets'] },
      now,
      documents: [
        source({ id: 'politics', title: 'President election campaign announces an AI policy', publisher: 'Official', isPrimary: true, trustTier: 'primary', topics: ['politics'], entities: ['President'] }),
        source({ id: 'chips', title: 'Semiconductor market pricing changes startup costs', publisher: 'Chipmaker', isPrimary: true, trustTier: 'primary', topics: ['semiconductor markets'], entities: ['Chipmaker'] }),
      ],
    });

    expect(clusters.find((cluster) => cluster.sourceDocumentIds.includes('politics'))).toMatchObject({
      evidenceQualified: false,
      blockReason: 'Political drift lacks operator evidence.',
    });
    expect(clusters.find((cluster) => cluster.sourceDocumentIds.includes('chips'))?.blockReason).toBe('Blocked by the research agenda.');
  });
});
