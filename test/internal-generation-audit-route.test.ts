import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildGenerationQualityAudit: vi.fn(),
  getAgent: vi.fn(),
  resetReadCache: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getAgent: mocks.getAgent,
  resetReadCache: mocks.resetReadCache,
}));

vi.mock('@/lib/generation-quality-audit', () => ({
  buildGenerationQualityAudit: mocks.buildGenerationQualityAudit,
}));

import { GET } from '@/app/api/internal/agents/[id]/generation/audit/route';

function request(secret = 'test-cron-secret'): Request {
  return new Request('http://localhost/api/internal/agents/13/generation/audit', {
    method: 'GET',
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('internal generation quality audit route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.getAgent.mockResolvedValue({ id: '13', handle: 'geoffwoo' });
    mocks.buildGenerationQualityAudit.mockResolvedValue({
      auditVersion: 1,
      agentId: '13',
      handle: '@geoffwoo',
      policy: { qualityPolicyVersion: 'geoffwoo-quality-v6', currentVoiceCorpusVersion: 'voice-corpus-v1-test' },
      corpus: { active: true, corpusPurity: 1, anchorCount: 40 },
      queue: { depth: 3, qualityEligibleCount: 2, skippedByQualityCount: 1 },
      sources: { accepted: [], rejected: [] },
      models: { generationFallbackCount: 0, finalCriticFallbackCount: 1 },
      complaints: { total: 2, affectedParentCount: 1, metricsOnly: true },
    });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('requires internal authentication', async () => {
    const response = await GET(request('wrong-secret') as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.buildGenerationQualityAudit).not.toHaveBeenCalled();
  });

  it('returns the protected read-only quality audit without caching', async () => {
    const response = await GET(request() as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.buildGenerationQualityAudit).toHaveBeenCalledWith(expect.objectContaining({ id: '13' }));
    expect(data).toMatchObject({
      policy: { qualityPolicyVersion: 'geoffwoo-quality-v6' },
      corpus: { active: true, corpusPurity: 1 },
      queue: { qualityEligibleCount: 2 },
      complaints: { metricsOnly: true },
    });
  });
});
