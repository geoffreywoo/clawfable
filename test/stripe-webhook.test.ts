import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimStripeWebhookEvent: vi.fn(),
  completeStripeWebhookEvent: vi.fn(),
  releaseStripeWebhookEvent: vi.fn(),
  syncStripePaidInvoice: vi.fn(),
  handleStripeChargeRefunded: vi.fn(),
  handleStripePaymentFailed: vi.fn(),
  handleStripeSubscriptionDeleted: vi.fn(),
  syncStripeCustomerEmail: vi.fn(),
  syncStripeSubscription: vi.fn(),
  subscriptionIdFromInvoice: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  claimStripeWebhookEvent: mocks.claimStripeWebhookEvent,
  completeStripeWebhookEvent: mocks.completeStripeWebhookEvent,
  releaseStripeWebhookEvent: mocks.releaseStripeWebhookEvent,
}));
vi.mock('@/lib/billing-sync', () => ({
  syncStripePaidInvoice: mocks.syncStripePaidInvoice,
  handleStripeChargeRefunded: mocks.handleStripeChargeRefunded,
  handleStripePaymentFailed: mocks.handleStripePaymentFailed,
  handleStripeSubscriptionDeleted: mocks.handleStripeSubscriptionDeleted,
  syncStripeCustomerEmail: mocks.syncStripeCustomerEmail,
  syncStripeSubscription: mocks.syncStripeSubscription,
  subscriptionIdFromInvoice: mocks.subscriptionIdFromInvoice,
}));
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  getStripeWebhookSecret: () => 'whsec_test',
  getStripe: () => ({ webhooks: { constructEvent: mocks.constructEvent } }),
}));

import { POST } from '@/app/api/stripe/webhook/route';

function request() {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    body: '{}',
  });
}

describe('Stripe webhook idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimStripeWebhookEvent.mockResolvedValue({ status: 'claimed', owner: 'attempt-1' });
    mocks.completeStripeWebhookEvent.mockResolvedValue(true);
    mocks.releaseStripeWebhookEvent.mockResolvedValue(undefined);
    mocks.subscriptionIdFromInvoice.mockReturnValue(null);
    mocks.constructEvent.mockReturnValue({
      id: 'evt_paid',
      type: 'invoice.paid',
      data: { object: { id: 'in_paid' } },
    });
  });

  it('processes a claimed event once', async () => {
    const response = await POST(request() as any);

    expect(response.status).toBe(200);
    expect(mocks.syncStripePaidInvoice).toHaveBeenCalledWith({ id: 'in_paid' });
    expect(mocks.completeStripeWebhookEvent).toHaveBeenCalledWith('evt_paid', 'attempt-1');
    expect(mocks.releaseStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it('acknowledges duplicate events without repeating side effects', async () => {
    mocks.claimStripeWebhookEvent.mockResolvedValue({ status: 'completed', owner: 'attempt-2' });
    const response = await POST(request() as any);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.syncStripePaidInvoice).not.toHaveBeenCalled();
    expect(mocks.completeStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it('releases a failed event claim so Stripe can retry it', async () => {
    mocks.syncStripePaidInvoice.mockRejectedValue(new Error('temporary KV failure'));
    const response = await POST(request() as any);

    expect(response.status).toBe(500);
    expect(mocks.releaseStripeWebhookEvent).toHaveBeenCalledWith('evt_paid', 'attempt-1');
    expect(mocks.completeStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it('asks Stripe to retry an event still owned by another live processor', async () => {
    mocks.claimStripeWebhookEvent.mockResolvedValue({ status: 'busy', owner: 'attempt-2' });
    const response = await POST(request() as any);
    expect(response.status).toBe(503);
    expect(mocks.syncStripePaidInvoice).not.toHaveBeenCalled();
  });

  it('does not acknowledge work whose completion receipt could not be saved', async () => {
    mocks.syncStripePaidInvoice.mockResolvedValue(undefined);
    mocks.completeStripeWebhookEvent.mockResolvedValue(false);
    const response = await POST(request() as any);
    expect(response.status).toBe(500);
    expect(mocks.releaseStripeWebhookEvent).toHaveBeenCalledWith('evt_paid', 'attempt-1');
  });
});
