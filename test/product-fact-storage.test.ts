import { describe, expect, it } from 'vitest';
import { getProductFacts, upsertProductFact } from '@/lib/kv-storage';

describe('ProductFact immutable storage', () => {
  it('keeps every version but exposes only the newest active unexpired fact', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const first = await upsertProductFact({
      statement: `Initial product fact ${suffix}`,
      provenanceUrl: 'https://www.clawfable.com/',
      provenanceLabel: 'Product page',
      verifiedByUserId: 'owner-storage',
      verifiedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const second = await upsertProductFact({
      id: first.familyId,
      statement: `Reverified product fact ${suffix}`,
      provenanceUrl: 'https://www.clawfable.com/',
      provenanceLabel: 'Product page',
      verifiedByUserId: 'owner-storage',
      verifiedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const history = (await getProductFacts({ includeExpired: true })).filter((fact) => fact.familyId === first.familyId);
    const active = (await getProductFacts()).filter((fact) => fact.familyId === first.familyId);
    expect(history.map((fact) => fact.version)).toEqual([2, 1]);
    expect(first.id).not.toBe(second.id);
    expect(active).toEqual([expect.objectContaining({ id: second.id, version: 2 })]);

    await upsertProductFact({
      id: first.familyId,
      statement: `Disabled product fact ${suffix}`,
      provenanceUrl: 'https://www.clawfable.com/',
      provenanceLabel: 'Product page',
      verifiedByUserId: 'owner-storage',
      verifiedAt: '2026-08-03T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      active: false,
    });
    expect((await getProductFacts()).some((fact) => fact.familyId === first.familyId)).toBe(false);
  });
});
