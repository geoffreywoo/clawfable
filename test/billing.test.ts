import { describe, expect, it } from 'vitest';
import { assertCanCreateAgent, assertCanUseAutopilot, BillingError, getBillingSummary } from '@/lib/billing';
import type { User } from '@/lib/types';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'geoffreywoo',
    name: 'Geoffrey Woo',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingEmail: null,
    billingStatus: 'free',
    plan: 'free',
    currentPeriodEnd: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('billing entitlements', () => {
  it('treats free users as single-agent and manual-only', () => {
    const summary = getBillingSummary(makeUser(), 1);

    expect(summary.label).toBe('Free');
    expect(summary.maxAgents).toBe(1);
    expect(summary.canCreateAgent).toBe(false);
    expect(summary.canUseAutopilot).toBe(false);
  });

  it('unlocks multi-agent automation for active pro subscriptions', () => {
    const summary = getBillingSummary(makeUser({
      plan: 'pro',
      billingStatus: 'active',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    }), 3);

    expect(summary.label).toBe('Pro');
    expect(summary.isPaid).toBe(true);
    expect(summary.maxAgents).toBe(5);
    expect(summary.canCreateAgent).toBe(true);
    expect(summary.canUseAutopilot).toBe(true);
  });

  it('falls back to free entitlements when a paid plan is canceled', () => {
    const summary = getBillingSummary(makeUser({
      plan: 'pro',
      billingStatus: 'canceled',
      stripeCustomerId: 'cus_123',
    }), 1);

    expect(summary.label).toBe('Pro');
    expect(summary.isPaid).toBe(false);
    expect(summary.maxAgents).toBe(1);
    expect(summary.canUseAutopilot).toBe(false);
  });

  it('throws when a free user exceeds the agent cap', () => {
    expect(() => assertCanCreateAgent(makeUser(), 1)).toThrowError(BillingError);
  });

  it('throws when a free user tries to use automation', () => {
    expect(() => assertCanUseAutopilot(makeUser(), 1)).toThrowError(BillingError);
  });
});
