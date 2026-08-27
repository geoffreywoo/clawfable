import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  getProductFacts: vi.fn(),
  getUser: vi.fn(),
  upsertProductFact: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getProductFacts: routeMocks.getProductFacts,
  getUser: routeMocks.getUser,
  upsertProductFact: routeMocks.upsertProductFact,
}));

import { POST } from '@/app/api/internal/product-facts/route';

function request(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/internal/product-facts', {
    method: 'POST',
    headers: {
      authorization: 'Bearer cron-test',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      statement: 'Clawfable publishes through an evidence-to-idea V2 workflow.',
      provenanceUrl: 'https://www.clawfable.com/',
      provenanceLabel: 'Clawfable product page',
      verifiedByUserId: 'owner-1',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ...overrides,
    }),
  });
}

describe('ProductFact API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-test';
    routeMocks.getUser.mockResolvedValue({ id: 'owner-1' });
    routeMocks.upsertProductFact.mockImplementation(async (value) => ({ id: '1:v1', familyId: '1', version: 1, ...value }));
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('requires an existing owner as the verifier', async () => {
    routeMocks.getUser.mockResolvedValue(null);
    const response = await POST(request() as any);

    expect(response.status).toBe(400);
    expect(routeMocks.upsertProductFact).not.toHaveBeenCalled();
  });

  it('persists qualified owner-verified facts with an expiry', async () => {
    const response = await POST(request() as any);

    expect(response.status).toBe(200);
    expect(routeMocks.upsertProductFact).toHaveBeenCalledWith(expect.objectContaining({
      verifiedByUserId: 'owner-1',
      active: true,
      provenanceUrl: 'https://www.clawfable.com/',
    }));
  });
});
