import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, User } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  getAgentOwnerId: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getAgent: mocks.getAgent,
  getAgentOwnerId: mocks.getAgentOwnerId,
  getUser: mocks.getUser,
}));

import { getAgentAutomationEntitlement } from '@/lib/automation-entitlement';

const agent: Agent = {
  id: 'agent-paid',
  handle: 'paidbuilder',
  name: 'Paid Builder',
  soulMd: '# SOUL',
  soulSummary: null,
  apiKey: null,
  apiSecret: null,
  accessToken: null,
  accessSecret: null,
  isConnected: 0,
  xUserId: null,
  soulPublic: 1,
  setupStep: 'ready',
  createdAt: '2026-08-01T00:00:00.000Z',
};

function paidUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-paid',
    username: 'paidbuilder',
    name: 'Paid Builder',
    stripeCustomerId: 'cus_paid',
    stripeSubscriptionId: 'sub_paid',
    billingEmail: 'paid@example.com',
    billingStatus: 'active',
    plan: 'pro',
    currentPeriodEnd: '2026-09-01T00:00:00.000Z',
    billingVerifiedAt: '2026-08-02T00:00:00.000Z',
    paidThrough: '2026-09-01T00:00:00.000Z',
    lastPaidInvoiceId: 'in_paid',
    lastPaidInvoiceSubscriptionId: 'sub_paid',
    lastPaidInvoiceAt: '2026-08-01T00:00:00.000Z',
    lastPaidAmountCents: 9900,
    lastPaidCurrency: 'usd',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('automation entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgent.mockResolvedValue(agent);
    mocks.getAgentOwnerId.mockResolvedValue('user-paid');
    mocks.getUser.mockResolvedValue(paidUser());
  });

  afterEach(() => {
    delete process.env.AUTOMATION_EXEMPT_AGENT_IDS;
  });

  it('grants only an exact agent-id exemption after verifying ownership exists', async () => {
    process.env.AUTOMATION_EXEMPT_AGENT_IDS = 'other-agent,agent-paid';

    const entitlement = await getAgentAutomationEntitlement('agent-paid', {
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(entitlement).toMatchObject({ source: 'agent_exemption', eligible: true });
    expect(mocks.getAgent).toHaveBeenCalledWith('agent-paid');
    expect(mocks.getAgentOwnerId).toHaveBeenCalledWith('agent-paid');
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('fails closed when an exempt agent has no owner', async () => {
    process.env.AUTOMATION_EXEMPT_AGENT_IDS = 'agent-paid';
    mocks.getAgentOwnerId.mockResolvedValue(null);

    const entitlement = await getAgentAutomationEntitlement(agent.id, {
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(entitlement).toMatchObject({ source: 'none', eligible: false });
    expect(entitlement.reason).toContain('owner is missing');
  });

  it('fails closed when the agent owner is missing', async () => {
    mocks.getAgentOwnerId.mockResolvedValue(null);

    const entitlement = await getAgentAutomationEntitlement(agent.id, {
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(entitlement).toMatchObject({ source: 'none', eligible: false });
    expect(entitlement.reason).toContain('owner is missing');
  });

  it('rejects trials and KV-only paid flags without invoice proof', async () => {
    mocks.getUser.mockResolvedValue(paidUser({
      billingStatus: 'trialing',
      lastPaidInvoiceId: null,
      lastPaidInvoiceSubscriptionId: null,
      lastPaidInvoiceAt: null,
      lastPaidAmountCents: null,
      paidThrough: null,
    }));

    const entitlement = await getAgentAutomationEntitlement(agent.id, {
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(entitlement.eligible).toBe(false);
    expect(entitlement.reason).toContain('Trials do not include');
  });

  it('rejects an invoice from a different subscription', async () => {
    mocks.getUser.mockResolvedValue(paidUser({ lastPaidInvoiceSubscriptionId: 'sub_old' }));

    const entitlement = await getAgentAutomationEntitlement(agent.id, {
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(entitlement.eligible).toBe(false);
    expect(entitlement.reason).toContain('does not match');
  });

  it('rejects payment that does not cover the reconciled billing period', async () => {
    mocks.getUser.mockResolvedValue(paidUser({ paidThrough: '2026-08-15T00:00:00.000Z' }));

    const entitlement = await getAgentAutomationEntitlement(agent.id, {
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(entitlement.eligible).toBe(false);
    expect(entitlement.reason).toContain('does not cover');
  });

  it('keeps verified entitlement only through the paid period', async () => {
    const current = await getAgentAutomationEntitlement(agent.id, {
      now: new Date('2026-08-02T12:00:00.000Z'),
    });
    const expired = await getAgentAutomationEntitlement(agent.id, {
      now: new Date('2026-09-02T00:00:00.000Z'),
    });

    expect(current).toMatchObject({
      source: 'stripe_paid',
      eligible: true,
      paidInvoiceId: 'in_paid',
      paidInvoiceSubscriptionId: 'sub_paid',
      paidAmountCents: 9900,
    });
    expect(expired).toMatchObject({ source: 'none', eligible: false });
  });
});
