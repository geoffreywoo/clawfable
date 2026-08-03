import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentAutomationEntitlement: vi.fn(),
  getAgentOwnerId: vi.fn(),
  getAgents: vi.fn(),
  getProtocolSettings: vi.fn(),
  getQueuedTweets: vi.fn(),
  quarantineAgentAutomation: vi.fn(),
  resetReadCache: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getAgentOwnerId: mocks.getAgentOwnerId,
  getAgents: mocks.getAgents,
  getProtocolSettings: mocks.getProtocolSettings,
  getQueuedTweets: mocks.getQueuedTweets,
  quarantineAgentAutomation: mocks.quarantineAgentAutomation,
  resetReadCache: mocks.resetReadCache,
}));
vi.mock('@/lib/automation-entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/automation-entitlement')>();
  return { ...actual, getAgentAutomationEntitlement: mocks.getAgentAutomationEntitlement };
});

import { POST } from '@/app/api/internal/automation-entitlements/migrate/route';

function request(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/internal/automation-entitlements/migrate', {
    method: 'POST',
    headers: {
      authorization: 'Bearer cron-test',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('automation entitlement migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-test';
    process.env.AUTOMATION_EXEMPT_AGENT_IDS = '13';
    mocks.getAgents.mockResolvedValue([
      { id: '13', handle: 'geoffreywoo' },
      { id: '14', handle: 'unpaid-agent' },
    ]);
    mocks.getAgentOwnerId.mockImplementation(async (id: string) => `owner-${id}`);
    mocks.getProtocolSettings.mockResolvedValue({ enabled: true, autoReply: true });
    mocks.getQueuedTweets.mockImplementation(async (id: string) => id === '14' ? [
      { id: 'generated', contentProvenance: 'generated_v2', pipelineVersion: 'v2' },
      { id: 'operator', contentProvenance: 'operator_written' },
    ] : []);
    mocks.getAgentAutomationEntitlement.mockImplementation(async (id: string) => ({
      source: id === '13' ? 'agent_exemption' : 'none',
      eligible: id === '13',
      reason: id === '13' ? 'exact exemption' : 'payment required',
      verifiedAt: new Date().toISOString(),
      paidThrough: null,
      paidInvoiceId: null,
      paidInvoiceSubscriptionId: null,
      paidAmountCents: null,
      paidCurrency: null,
    }));
    mocks.quarantineAgentAutomation.mockResolvedValue({ generatedQuarantined: 1, operatorDraftsReturned: 1 });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.AUTOMATION_EXEMPT_AGENT_IDS;
  });

  it('defaults to dry-run and reports queue changes without applying them', async () => {
    const response = await POST(request() as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      dryRun: true,
      eligibleAgents: 1,
      blockedAgents: 1,
      generatedDraftsToQuarantine: 1,
      operatorDraftsToReturn: 1,
    });
    expect(mocks.quarantineAgentAutomation).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and applies only to blocked agents', async () => {
    const rejected = await POST(request({ dryRun: false }) as any);
    expect(rejected.status).toBe(400);

    const response = await POST(request({
      dryRun: false,
      confirmation: 'DISABLE_NON_PAYING_AUTOMATION',
    }) as any);
    expect(response.status).toBe(200);
    expect(mocks.quarantineAgentAutomation).toHaveBeenCalledTimes(1);
    expect(mocks.quarantineAgentAutomation).toHaveBeenCalledWith('14', expect.stringContaining('payment required'));
  });

  it('refuses apply when the exact exemption is not canonical Geoffrey', async () => {
    process.env.AUTOMATION_EXEMPT_AGENT_IDS = '14';
    const response = await POST(request({
      dryRun: false,
      confirmation: 'DISABLE_NON_PAYING_AUTOMATION',
    }) as any);

    expect(response.status).toBe(409);
    expect(mocks.quarantineAgentAutomation).not.toHaveBeenCalled();
  });

  it('refuses apply when an extra nonexistent exemption id is configured', async () => {
    process.env.AUTOMATION_EXEMPT_AGENT_IDS = '13,999';
    const response = await POST(request({
      dryRun: false,
      confirmation: 'DISABLE_NON_PAYING_AUTOMATION',
    }) as any);

    expect(response.status).toBe(409);
    expect(mocks.quarantineAgentAutomation).not.toHaveBeenCalled();
  });

  it('aborts before mutation when the canonical exemption is not eligible', async () => {
    mocks.getAgentAutomationEntitlement.mockResolvedValue({
      source: 'none',
      eligible: false,
      reason: 'Agent owner is missing.',
      verifiedAt: null,
      paidThrough: null,
      paidInvoiceId: null,
      paidInvoiceSubscriptionId: null,
      paidAmountCents: null,
      paidCurrency: null,
    });

    const response = await POST(request({
      dryRun: false,
      confirmation: 'DISABLE_NON_PAYING_AUTOMATION',
    }) as any);

    expect(response.status).toBe(409);
    expect(mocks.quarantineAgentAutomation).not.toHaveBeenCalled();
  });
});
