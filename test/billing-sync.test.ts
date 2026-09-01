import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getStripe: vi.fn(),
  getUser: vi.fn(),
  getUserAgentIds: vi.fn(),
  getUserIdByStripeCustomer: vi.fn(),
  getUserIdByStripeSubscription: vi.fn(),
  getUsers: vi.fn(),
  linkStripeCustomerToUser: vi.fn(),
  linkStripeSubscriptionToUser: vi.fn(),
  quarantineAgentAutomation: vi.fn(),
  unlinkStripeSubscription: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getUser: mocks.getUser,
  getUserAgentIds: mocks.getUserAgentIds,
  getUserIdByStripeCustomer: mocks.getUserIdByStripeCustomer,
  getUserIdByStripeSubscription: mocks.getUserIdByStripeSubscription,
  getUsers: mocks.getUsers,
  linkStripeCustomerToUser: mocks.linkStripeCustomerToUser,
  linkStripeSubscriptionToUser: mocks.linkStripeSubscriptionToUser,
  quarantineAgentAutomation: mocks.quarantineAgentAutomation,
  unlinkStripeSubscription: mocks.unlinkStripeSubscription,
  updateUser: mocks.updateUser,
}));

vi.mock('@/lib/stripe', () => ({ getStripe: mocks.getStripe }));
vi.mock('@/lib/automation-entitlement', () => ({ isAgentAutomationExempt: () => false }));

import {
  handleStripeChargeRefunded,
  handleStripePaymentFailed,
  handleStripeSubscriptionDeleted,
  reconcileStripeBilling,
  syncStripePaidInvoice,
  syncStripeSubscription,
} from '@/lib/billing-sync';

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user-paid',
    username: 'paid',
    name: 'Paid User',
    stripeCustomerId: 'cus_paid',
    stripeSubscriptionId: 'sub_paid',
    billingEmail: null,
    billingStatus: 'active',
    plan: 'pro',
    currentPeriodEnd: '2026-09-01T00:00:00.000Z',
    billingVerifiedAt: '2026-08-01T00:00:00.000Z',
    paidThrough: '2026-09-01T00:00:00.000Z',
    lastPaidInvoiceId: 'in_paid',
    lastPaidInvoiceSubscriptionId: 'sub_paid',
    lastPaidInvoiceAt: '2026-08-01T00:00:00.000Z',
    lastPaidAmountCents: 9900,
    lastPaidCurrency: 'usd',
    lastRefundedInvoiceId: null,
    lastRefundedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_paid',
    customer: 'cus_paid',
    status: 'active',
    created: 1,
    items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1788220800 }] },
    latest_invoice: null,
    ...overrides,
  } as any;
}

function stripeSubscriptions(values: any[], error?: Error) {
  return {
    subscriptions: {
      list: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          if (error) throw error;
          for (const value of values) yield value;
        },
      })),
    },
  };
}

describe('Stripe billing reconciliation', () => {
  let currentUser: User;

  beforeEach(() => {
    vi.clearAllMocks();
    // Fixtures are dated around a 2026-09-01 period end; pin the clock so
    // eligibility checks against "now" do not rot once that date passes.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-15T12:00:00.000Z') });
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro';
    currentUser = user();
    mocks.getUser.mockImplementation(async () => currentUser);
    mocks.getUsers.mockImplementation(async () => [currentUser]);
    mocks.updateUser.mockImplementation(async (_id: string, updates: Partial<User>) => {
      currentUser = { ...currentUser, ...updates };
      return currentUser;
    });
    mocks.getUserAgentIds.mockResolvedValue(['agent-paid']);
    mocks.getUserIdByStripeCustomer.mockResolvedValue(currentUser.id);
    mocks.getUserIdByStripeSubscription.mockResolvedValue(currentUser.id);
    mocks.quarantineAgentAutomation.mockResolvedValue({ generatedQuarantined: 0, operatorDraftsReturned: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  });

  it('records a non-zero invoice and its exact paid period', async () => {
    currentUser = user({
      paidThrough: null,
      lastPaidInvoiceId: null,
      lastPaidInvoiceSubscriptionId: null,
      lastPaidInvoiceAt: null,
      lastPaidAmountCents: null,
    });
    await syncStripePaidInvoice({
      id: 'in_new',
      customer: 'cus_paid',
      amount_paid: 9900,
      currency: 'usd',
      parent: { subscription_details: { subscription: 'sub_paid' } },
      lines: { data: [{ period: { end: 1788220800 } }] },
      status_transitions: { paid_at: 1785542400 },
    } as any);

    expect(currentUser).toMatchObject({
      lastPaidInvoiceId: 'in_new',
      lastPaidInvoiceSubscriptionId: 'sub_paid',
      lastPaidAmountCents: 9900,
      paidThrough: '2026-09-01T00:00:00.000Z',
    });
    expect(mocks.quarantineAgentAutomation).not.toHaveBeenCalled();
  });

  it('keeps a full refund authoritative when the paid webhook is replayed', async () => {
    await handleStripeChargeRefunded({
      id: 'ch_refunded',
      customer: 'cus_paid',
      invoice: 'in_paid',
      amount: 9900,
      amount_refunded: 9900,
    } as any);

    expect(currentUser).toMatchObject({
      billingStatus: 'unpaid',
      paidThrough: null,
      lastPaidAmountCents: 0,
      lastRefundedInvoiceId: 'in_paid',
    });
    mocks.quarantineAgentAutomation.mockClear();
    await syncStripePaidInvoice({
      id: 'in_paid',
      customer: 'cus_paid',
      amount_paid: 9900,
      currency: 'usd',
      parent: { subscription_details: { subscription: 'sub_paid' } },
      lines: { data: [{ period: { end: 1788220800 } }] },
      status_transitions: { paid_at: 1785542400 },
    } as any);

    expect(currentUser.lastRefundedInvoiceId).toBe('in_paid');
    expect(currentUser.paidThrough).toBeNull();
    expect(mocks.quarantineAgentAutomation).toHaveBeenCalledOnce();
  });

  it('ignores a stale paid invoice instead of replacing the current paid period', async () => {
    await syncStripePaidInvoice({
      id: 'in_old',
      customer: 'cus_paid',
      amount_paid: 4900,
      currency: 'usd',
      parent: { subscription_details: { subscription: 'sub_old' } },
      lines: { data: [{ period: { end: 1785542400 } }] },
      status_transitions: { paid_at: 1782864000 },
    } as any);

    expect(currentUser).toMatchObject({
      stripeSubscriptionId: 'sub_paid',
      lastPaidInvoiceId: 'in_paid',
      paidThrough: '2026-09-01T00:00:00.000Z',
      lastPaidAmountCents: 9900,
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('records an old refund without revoking the current paid invoice', async () => {
    await handleStripeChargeRefunded({
      id: 'ch_old_refund',
      customer: 'cus_paid',
      invoice: 'in_old',
      amount: 4900,
      amount_refunded: 4900,
    } as any);

    expect(currentUser).toMatchObject({
      billingStatus: 'active',
      lastPaidInvoiceId: 'in_paid',
      paidThrough: '2026-09-01T00:00:00.000Z',
      lastPaidAmountCents: 9900,
      lastRefundedInvoiceId: 'in_old',
    });
    expect(mocks.quarantineAgentAutomation).not.toHaveBeenCalled();
  });

  it('fails closed for active subscriptions without current invoice proof', async () => {
    currentUser = user({
      lastPaidInvoiceId: null,
      lastPaidInvoiceSubscriptionId: null,
      lastPaidInvoiceAt: null,
      lastPaidAmountCents: null,
      paidThrough: null,
    });
    await syncStripeSubscription('cus_paid', subscription());

    expect(currentUser.plan).toBe('pro');
    expect(mocks.quarantineAgentAutomation).toHaveBeenCalledWith(
      'agent-paid',
      expect.stringContaining('paid Stripe invoice'),
    );
  });

  it('resets DB-only paid records when Stripe has no subscription', async () => {
    mocks.getStripe.mockReturnValue(stripeSubscriptions([]));
    const result = await reconcileStripeBilling();

    expect(result).toEqual({ usersChecked: 1, subscriptionsFound: 0, usersReset: 1 });
    expect(currentUser).toMatchObject({
      plan: 'free',
      billingStatus: 'free',
      stripeSubscriptionId: null,
      paidThrough: null,
    });
    expect(mocks.quarantineAgentAutomation).toHaveBeenCalledOnce();
  });

  it('applies the latest paid invoice before enforcing reconciliation', async () => {
    currentUser = user({
      paidThrough: null,
      lastPaidInvoiceId: null,
      lastPaidInvoiceSubscriptionId: null,
      lastPaidInvoiceAt: null,
      lastPaidAmountCents: null,
    });
    const latestInvoice = {
      id: 'in_reconciled',
      customer: 'cus_paid',
      status: 'paid',
      amount_paid: 9900,
      currency: 'usd',
      parent: { subscription_details: { subscription: 'sub_paid' } },
      lines: { data: [{ period: { end: 1788220800 } }] },
      status_transitions: { paid_at: 1785542400 },
    };
    mocks.getStripe.mockReturnValue(stripeSubscriptions([subscription({ latest_invoice: latestInvoice })]));

    await reconcileStripeBilling();

    expect(currentUser).toMatchObject({
      billingStatus: 'active',
      plan: 'pro',
      lastPaidInvoiceId: 'in_reconciled',
      paidThrough: '2026-09-01T00:00:00.000Z',
    });
    expect(mocks.quarantineAgentAutomation).not.toHaveBeenCalled();
  });

  it('does not mutate billing state when Stripe reconciliation is unavailable', async () => {
    mocks.getStripe.mockReturnValue(stripeSubscriptions([], new Error('Stripe unavailable')));

    await expect(reconcileStripeBilling()).rejects.toThrow('Stripe unavailable');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.quarantineAgentAutomation).not.toHaveBeenCalled();
  });

  it('quarantines immediately on payment failure and subscription deletion', async () => {
    await handleStripePaymentFailed({ id: 'in_failed', customer: 'cus_paid', lines: { data: [] } } as any);
    expect(currentUser.billingStatus).toBe('past_due');
    expect(mocks.quarantineAgentAutomation).toHaveBeenCalledOnce();

    mocks.quarantineAgentAutomation.mockClear();
    await handleStripeSubscriptionDeleted(subscription({ status: 'canceled', ended_at: 1785542400 }));
    expect(currentUser).toMatchObject({ plan: 'free', billingStatus: 'canceled', stripeSubscriptionId: null });
    expect(mocks.unlinkStripeSubscription).toHaveBeenCalledWith('sub_paid');
    expect(mocks.quarantineAgentAutomation).toHaveBeenCalledOnce();
  });

  it('does not let deletion of an old subscription clear the current one', async () => {
    await handleStripeSubscriptionDeleted(subscription({
      id: 'sub_old',
      status: 'canceled',
      ended_at: 1782864000,
    }));

    expect(currentUser).toMatchObject({
      stripeSubscriptionId: 'sub_paid',
      billingStatus: 'active',
      plan: 'pro',
    });
    expect(mocks.unlinkStripeSubscription).toHaveBeenCalledWith('sub_old');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.quarantineAgentAutomation).not.toHaveBeenCalled();
  });
});
