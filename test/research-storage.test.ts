import { describe, expect, it } from 'vitest';
import {
  acquireResearchRefreshLock,
  getSourceDocuments,
  releaseResearchRefreshLock,
  upsertSourceDocuments,
} from '@/lib/kv-storage';
import type { SourceDocument } from '@/lib/types';

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
});
