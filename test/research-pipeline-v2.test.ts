import { describe, expect, it } from 'vitest';
import { buildResearchAgenda, clusterAndQualifySources } from '@/lib/research-pipeline';
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
      learnings: null,
      performance: [{
        tweetId: 'tweet-1', xTweetId: 'x-1', content: 'vertical AI buyers', format: 'observation', topic: 'vertical AI',
        postedAt: now.toISOString(), checkedAt: now.toISOString(), likes: 20, retweets: 2, replies: 3,
        impressions: 3000, engagementRate: 0.01, wasViral: false, source: 'manual',
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
    expect(built.blockedTopics).toContain('mineral explainers');
    expect(built).not.toHaveProperty('evidence');
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
