import { expect, it } from 'vitest';
import { clusterAndQualifySources, isResearchDocumentEligibleForClustering } from '@/lib/research-pipeline';
import { upsertStoryClusters, getStoryClusters, upsertSourceDocuments } from '@/lib/kv-storage';
import { buildSubjectPacket } from '@/lib/subject-packet';
import { isCurrentSourceEvidence } from '@/lib/source-validity';
import { buildGenerationBriefsV2, prioritizeCurrentInterestBriefsV2, getSourceAttributionIssueV2 } from '@/lib/generation-v2';
import { sourceDocumentsFromTrending } from '@/lib/research-adapters';
import type { SourceDocument, ResearchAgenda } from '@/lib/types';

const now = Date.parse('2026-09-27T10:00:00Z');
const topic = { id: 'topic-1', networkTopicId: 'network-1', headline: 'Acme revenue milestone', category: 'AI startups',
  timestamp: new Date(now).toISOString(), observedAt: new Date(now).toISOString(), sourceType: 'x',
  evidence: [{ sourceUrl: 'https://x.com/acme/status/123', text: 'Acme has reached $100 million in annualized revenue.',
    author: 'acme', authorVerified: true, isPrimarySource: true, createdAt: new Date(now-3600000).toISOString(), tweetId: '123' }] } as any;
const source = () => sourceDocumentsFromTrending('retention-test', [topic], new Date(now))[0];
const agenda: ResearchAgenda = { schemaVersion: 2, agentId: 'retention-test', rssFeeds: [], githubRepositories: [], updatedAt: new Date(now).toISOString(), queries: ['Acme revenue AI startups'], pinnedQuestions: [], blockedTopics: [], blockedStoryKeys: [], domainWeights: { ai: 1 } };

it('preserves the source-to-story-to-subject path across research-only and failed refreshes without renewing expiry', async () => {
  const document = source();
  let previous = [];
  for (const [offset, observed] of [[0, new Set([document.id])], [3600000, new Set<string>()], [2*3600000, new Set<string>()]] as const) {
    const documents = [document].filter(d => isResearchDocumentEligibleForClustering(d, observed, true, now+offset));
    const stories = clusterAndQualifySources({ agentId: 'retention-test', documents, agenda, existingClusters: previous,
      blocks: [], observedDocumentIds: observed, now: new Date(now+offset) });
    await upsertStoryClusters('retention-test', stories);
    previous = await getStoryClusters('retention-test');
    expect(previous).toHaveLength(1);
    expect(previous[0].evidenceQualified).toBe(true);
    expect(previous[0].lastSeenAt).toBe(new Date(now).toISOString());
    const packet = buildSubjectPacket({ title: previous[0].title, sourceDocumentIds: [document.id],
      evidenceMode: 'verified_source', evidence: [{ sourceDocumentId: document.id, claim: document.claims[0].text }],
      storyClusterId: previous[0].id, identityScore: .9 } as any, documents, now+offset);
    expect(packet.sourceIds).toEqual([document.id]);
    expect(packet.supportedFacts[0]).toBe(`@acme says: ${document.claims[0].text}`);
    expect(Date.parse(packet.expiresAt)).toBe(now + 24*3600000);
  }
  expect(isResearchDocumentEligibleForClustering(document, new Set(), false, now+3600000)).toBe(false);
});

it('expires and withdraws evidence even on a successful refresh and respects an earlier source expiry', () => {
  const doc = source();
  expect(isCurrentSourceEvidence(doc, now+24*3600000)).toBe(false);
  expect(isCurrentSourceEvidence({ ...doc, metadata: { ...doc.metadata, contradictedAt: new Date(now).toISOString() } }, now)).toBe(false);
  expect(isCurrentSourceEvidence({ ...doc, metadata: { ...doc.metadata, withdrawn: true } }, now)).toBe(false);
  expect(isCurrentSourceEvidence({ ...doc, metadata: { ...doc.metadata, expiresAt: new Date(now+1).toISOString() } }, now+2)).toBe(false);
  expect(isCurrentSourceEvidence({ ...doc, metadata: { observedAt: 'bad' } }, now)).toBe(false);
  const refetched = sourceDocumentsFromTrending('retention-test', [topic], new Date(now+20*3600000))[0];
  expect(refetched.metadata.expiresAt).toBe(doc.metadata.expiresAt);
});

it('compares a sourced packet and a distinct current-interest packet without funding extra writers', () => {
  const briefs = [{ id: 'opinion', trendTopicId: 't1' }, { id: 'research', storyClusterId: 's1' }, { id: 'another', storyClusterId: 's2' }];
  const selected = prioritizeCurrentInterestBriefsV2(briefs, 'run', true).slice(0, 2);
  expect(selected.some(b => b.storyClusterId)).toBe(true);
  expect(new Set(selected.map(b => b.id)).size).toBe(2);
  expect(selected.some(b => b.id === 'opinion')).toBe(true);
});

it('joins an interested subject to its qualified story by source topic identity', () => {
  const document = source();
  const stories = clusterAndQualifySources({ agentId: 'retention-test', documents: [document], agenda, existingClusters: [], blocks: [], now: new Date(now) });
  stories[0].scores = { identityFit: .9, evidenceStrength: .9, consequence: .9, freshness: .9, novelty: .9, networkMomentum: .9, total: .9 };
  const briefs = buildGenerationBriefsV2({ count: 1, durable: true, stories, documents: [document],
    voiceProfile: { tone: 'direct', topics: ['AI', 'startups', 'Acme revenue milestone'], antiGoals: [], communicationStyle: 'concise', summary: 'A startup founder.' },
    analysis: { engagementPatterns: { topTopics: ['AI', 'startups'] } } as any, learnings: null,
    style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'moderate', exploration: { underusedTopics: [] } } as any,
    trending: [{ ...topic, category: 'Acme revenue milestone', discoveryMethod: 'followed_network',
      relevanceScore: 95, networkMomentumScore: .9, operatorEngagementScore: .9, operatorEngagedSourceCount: 1,
      topicConfidence: .95, topicUncertainty: 'low', semanticDomain: 'ai_compute', entities: ['Acme'],
      entityRoles: [{ name: 'Acme', role: 'company' }], sourceCount: 1 }], allTweets: [], now: new Date(now) });
  const brief = briefs.find(b => b.trendTopicId === 'network-1');
  expect(brief?.evidenceMode).toBe('verified_source');
  expect(brief?.sourceDocumentIds).toEqual([document.id]);
  expect(brief?.evidence[0].claim).toContain('@acme says:');
});


it('does not silently clear an explicit withdrawal on refetch', async () => {
  const doc = { ...source(), fetchedAt: new Date().toISOString(), metadata: { ...source().metadata, withdrawn: true } };
  await upsertSourceDocuments('13', [doc]);
  const retained = await upsertSourceDocuments('13', [{ ...doc, metadata: {} }]);
  expect(retained.find(d => d.id === doc.id)?.metadata.withdrawn).toBe(true);
});

it('requires attribution for primary company claims even from a verified X account', () => {
  expect(getSourceAttributionIssueV2('Acme reached $100 million revenue.', [source()], true)).toContain('attribution');
  expect(getSourceAttributionIssueV2('@acme says it reached $100 million revenue.', [source()], true)).toBeNull();
});
