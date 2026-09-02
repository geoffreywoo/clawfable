import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgents: vi.fn(),
  getProtocolSettings: vi.fn(),
  resetReadCache: vi.fn(),
  refreshAgentResearch: vi.fn(),
  refreshDynamicIdeaSeeds: vi.fn(),
  getAgentAutomationEntitlement: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getAgents: mocks.getAgents,
  getProtocolSettings: mocks.getProtocolSettings,
  resetReadCache: mocks.resetReadCache,
}));

vi.mock('@/lib/research-pipeline', () => ({
  refreshAgentResearch: mocks.refreshAgentResearch,
}));

vi.mock('@/lib/seed-synthesis', () => ({
  refreshDynamicIdeaSeeds: mocks.refreshDynamicIdeaSeeds,
}));

vi.mock('@/lib/automation-entitlement', () => ({
  getAgentAutomationEntitlement: mocks.getAgentAutomationEntitlement,
}));

import { GET } from '@/app/api/cron/research/route';

describe('cron research isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.getAgents.mockResolvedValue([
      { id: 'agent-1', handle: 'first', name: 'First' },
      { id: 'agent-2', handle: 'second', name: 'Second' },
    ]);
    mocks.getProtocolSettings.mockResolvedValue({ enabled: true });
    mocks.getAgentAutomationEntitlement.mockResolvedValue({ eligible: true, reason: 'ok' });
    mocks.refreshDynamicIdeaSeeds.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('records one agent\'s research failure and keeps refreshing the remaining agents', async () => {
    mocks.refreshAgentResearch
      .mockRejectedValueOnce(new Error('research lock write failed'))
      .mockResolvedValueOnce({
        agentId: 'agent-2',
        attempted: true,
        refreshed: true,
        busy: false,
        documentsFetched: 3,
        documentsStored: 3,
        storiesStored: 1,
        storiesQualified: 1,
        errors: [],
      });

    const response = await GET(new Request('http://localhost/api/cron/research', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }) as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.refreshAgentResearch).toHaveBeenCalledTimes(2);
    expect(mocks.refreshAgentResearch.mock.calls[1][0]).toMatchObject({ id: 'agent-2' });
    expect(data.agentsAttempted).toBe(2);
    expect(data.documentsFetched).toBe(3);
    expect(data.partialFailures).toEqual([{ agentId: 'agent-1', error: 'research lock write failed' }]);
    expect(data.results[0]).toMatchObject({ agentId: 'agent-1', attempted: true, refreshed: false });
    expect(mocks.refreshDynamicIdeaSeeds).toHaveBeenCalledTimes(1);
    expect(mocks.refreshDynamicIdeaSeeds.mock.calls[0][0]).toMatchObject({ id: 'agent-2' });
  });
});
