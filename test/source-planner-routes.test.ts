import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => { throw err; }),
  getAccessibleAgentCount: vi.fn(),
  getProtocolSettings: vi.fn(),
  updateProtocolSettings: vi.fn(),
  getPostLog: vi.fn(),
  getAnalysis: vi.fn(),
  saveBaseline: vi.fn(),
  getManualExampleCuration: vi.fn(),
  updateManualExampleCuration: vi.fn(),
  buildLearnings: vi.fn(),
  clampPostsPerDay: vi.fn((value: number) => value),
  assertCanUseAutopilot: vi.fn(),
  getBillingSummary: vi.fn(() => ({ canUseAutopilot: true })),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: mocks.requireAgentAccess,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/account-access', () => ({
  getAccessibleAgentCount: mocks.getAccessibleAgentCount,
}));

vi.mock('@/lib/kv-storage', () => ({
  getProtocolSettings: mocks.getProtocolSettings,
  updateProtocolSettings: mocks.updateProtocolSettings,
  getPostLog: mocks.getPostLog,
  getAnalysis: mocks.getAnalysis,
  saveBaseline: mocks.saveBaseline,
  getManualExampleCuration: mocks.getManualExampleCuration,
  updateManualExampleCuration: mocks.updateManualExampleCuration,
}));

vi.mock('@/lib/performance', () => ({
  buildLearnings: mocks.buildLearnings,
}));

vi.mock('@/lib/survivability', () => ({
  clampPostsPerDay: mocks.clampPostsPerDay,
}));

vi.mock('@/lib/billing', () => ({
  BillingError: class BillingError extends Error {
    status: number;
    code: string;

    constructor(message: string, status = 403, code = 'billing_error') {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  assertCanUseAutopilot: mocks.assertCanUseAutopilot,
  getBillingSummary: mocks.getBillingSummary,
}));

import { PATCH as protocolSettingsPATCH } from '@/app/api/agents/[id]/protocol/settings/route';
import { GET as manualExamplesGET, PATCH as manualExamplesPATCH } from '@/app/api/agents/[id]/learning/manual-examples/route';

describe('source planner routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentAccess.mockResolvedValue({
      user: {
        id: 'user-1',
        username: 'planner-user',
        name: 'Planner User',
        plan: 'pro',
      },
      agent: {
        id: 'agent-1',
        handle: 'planner-agent',
        name: 'Planner Agent',
        soulMd: '# soul',
      },
    });
    mocks.getAccessibleAgentCount.mockResolvedValue(1);
    mocks.getAnalysis.mockResolvedValue(null);
    mocks.updateProtocolSettings.mockImplementation(async (_id: string, updates: Record<string, unknown>) => updates);
    mocks.getManualExampleCuration.mockResolvedValue({
      pinnedXTweetIds: ['x-1'],
      blockedXTweetIds: ['x-2'],
      updatedAt: '2026-04-18T00:00:00.000Z',
    });
    mocks.updateManualExampleCuration.mockImplementation(async (_id: string, updates: Record<string, unknown>) => ({
      pinnedXTweetIds: updates.pinnedXTweetIds ?? [],
      blockedXTweetIds: updates.blockedXTweetIds ?? [],
      updatedAt: '2026-04-18T01:00:00.000Z',
    }));
    mocks.buildLearnings.mockResolvedValue({
      agentId: 'agent-1',
      updatedAt: '2026-04-18T01:00:00.000Z',
      totalTracked: 0,
      avgLikes: 0,
      avgRetweets: 0,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
    });
  });

  it('clamps planner settings and keeps valid trend tolerance values', async () => {
    const response = await protocolSettingsPATCH(new Request('http://localhost/api/protocol/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trendMixTarget: 133.7,
        trendTolerance: 'aggressive',
      }),
    }) as any, { params: Promise.resolve({ id: 'agent-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.updateProtocolSettings).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      trendMixTarget: 100,
      trendTolerance: 'aggressive',
    }));
  });

  it('drops invalid trend tolerance values from protocol settings updates', async () => {
    const response = await protocolSettingsPATCH(new Request('http://localhost/api/protocol/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trendMixTarget: -12,
        trendTolerance: 'wild-west',
      }),
    }) as any, { params: Promise.resolve({ id: 'agent-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.updateProtocolSettings).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      trendMixTarget: 0,
    }));
    expect(mocks.updateProtocolSettings.mock.calls[0]?.[1]).not.toHaveProperty('trendTolerance');
  });

  it('returns manual example curation for the authenticated agent', async () => {
    const response = await manualExamplesGET(
      new Request('http://localhost/api/manual-examples') as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.pinnedXTweetIds).toEqual(['x-1']);
    expect(data.blockedXTweetIds).toEqual(['x-2']);
  });

  it('merges pin and block mutations, then rebuilds learnings', async () => {
    const response = await manualExamplesPATCH(new Request('http://localhost/api/manual-examples', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: ['x-3', 'x-2'],
        unpin: ['x-1'],
        block: ['x-4'],
        unblock: ['x-2'],
      }),
    }) as any, { params: Promise.resolve({ id: 'agent-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.updateManualExampleCuration).toHaveBeenCalledWith('agent-1', {
      pinnedXTweetIds: ['x-3', 'x-2'],
      blockedXTweetIds: ['x-4'],
    });
    expect(mocks.buildLearnings).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-1' }));
    expect(data.curation.pinnedXTweetIds).toEqual(['x-3', 'x-2']);
    expect(data.curation.blockedXTweetIds).toEqual(['x-4']);
  });
});
