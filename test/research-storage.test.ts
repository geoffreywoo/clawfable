import { describe, expect, it } from 'vitest';
import {
  acquireResearchRefreshLock,
  addSemanticBlock,
  getSemanticBlocks,
  getSourceDocuments,
  replaceLegacySemanticBackfillBlocks,
  releaseResearchRefreshLock,
  upsertSourceDocuments,
} from '@/lib/kv-storage';
import type { SemanticBlock, SourceDocument } from '@/lib/types';

function document(agentId: string, excerpt: string): SourceDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: 'source-stable-id',
    agentId,
    sourceType: 'official',
    canonicalUrl: 'https://www.nasa.gov/technology/example',
    title: 'NASA technology update',
    publisher: 'NASA Technology',
    publishedAt: now,
    fetchedAt: now,
    trustTier: 'primary',
    isPrimary: true,
    excerpt,
    contentHash: `hash-${excerpt}`,
    entities: ['NASA'],
    claims: [{ id: 'claim-1', text: excerpt, kind: 'fact', confidence: 0.9, entities: ['NASA'] }],
    topics: ['technology'],
    query: null,
    metadata: {},
  };
}

describe('research cache storage', () => {
  it('is idempotent by stable source ID and replaces refreshed content', async () => {
    const agentId = `research-storage-${Date.now()}`;
    await upsertSourceDocuments(agentId, [document(agentId, 'The original supported claim is long enough.')]);
    await upsertSourceDocuments(agentId, [document(agentId, 'The refreshed supported claim is long enough.')]);

    const stored = await getSourceDocuments(agentId);
    expect(stored).toHaveLength(1);
    expect(stored[0].excerpt).toBe('The refreshed supported claim is long enough.');
  });

  it('prevents overlapping cron refreshes and only lets the owner release the lock', async () => {
    const agentId = `research-lock-${Date.now()}`;
    const first = await acquireResearchRefreshLock(agentId, 'owner-a', 60);
    const second = await acquireResearchRefreshLock(agentId, 'owner-b', 60);

    expect(first.acquired).toBe(true);
    expect(second).toMatchObject({ acquired: false, owner: 'owner-b', lock: expect.objectContaining({ owner: 'owner-a' }) });
    await expect(releaseResearchRefreshLock(agentId, 'owner-b')).resolves.toBe(false);
    await expect(releaseResearchRefreshLock(agentId, 'owner-a')).resolves.toBe(true);
  });

  it('replaces only legacy backfill blocks while preserving structured feedback', async () => {
    const agentId = `research-blocks-${Date.now()}`;
    const block = (id: string, semanticKey: string): SemanticBlock => ({
      schemaVersion: 2,
      id,
      agentId,
      scope: 'idea',
      semanticKey,
      topic: 'AI startups',
      storyClusterId: null,
      ideaId: null,
      reasonCode: 'bad_premise',
      reason: 'Rejected premise.',
      permanent: true,
      blockedUntil: null,
      createdAt: new Date().toISOString(),
    });
    await addSemanticBlock(agentId, block('semantic-block-structured', 'structured:key'));
    await addSemanticBlock(agentId, block('semantic-block-backfill-old', 'malformed:rationale:key'));

    const replacement = block('semantic-block-backfill-new', 'rejected:draft:key');
    await replaceLegacySemanticBackfillBlocks(agentId, [replacement]);

    expect(await getSemanticBlocks(agentId, true)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'semantic-block-structured', semanticKey: 'structured:key' }),
      expect.objectContaining({ id: 'semantic-block-backfill-new', semanticKey: 'rejected:draft:key' }),
    ]));
    expect(await getSemanticBlocks(agentId, true)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'semantic-block-backfill-old' }),
    ]));
  });
});
