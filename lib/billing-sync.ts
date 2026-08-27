import type Stripe from 'stripe';
import { getPaidAutomationEntitlementForUser, getPlanFromPriceId, normalizeBillingStatus } from './billing';
import { isAgentAutomationExempt } from './automation-entitlement';
import type { BillingPlan, BillingStatus, User } from './types';
import {
  getUser,
  getUserAgentIds,
  getUserIdByStripeCustomer,
  getUserIdByStripeSubscription,
  getUsers,
  linkStripeCustomerToUser,
  linkStripeSubscriptionToUser,
  quarantineAgentAutomation,
  unlinkStripeSubscription,
  updateUser,
} from './kv-storage';
import { getStripe } from './stripe';

type InvoiceWithSubscription = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
  parent?: {
    subscription_details?: {
      subscription?: string | Stripe.Subscription | null;
    } | null;
  } | null;
};

function toIsoPeriodEnd(periodEnd: number | null | undefined): string | null {
  return typeof periodEnd === 'number' ? new Date(periodEnd * 1000).toISOString() : null;
}

export function subscriptionIdFromInvoice(invoice: InvoiceWithSubscription): string | null {
  const subscription = invoice.subscription
    || invoice.parent?.subscription_details?.subscription
    || null;
  return typeof subscription === 'string' ? subscription : subscription?.id || null;
}

function invoicePaidThrough(invoice: Stripe.Invoice): string | null {
  const periodEnd = invoice.lines.data.reduce(
    (latest, line) => Math.max(latest, Number(line.period?.end || 0)),
    0,
  );
  return toIsoPeriodEnd(periodEnd || null);
}

async function resolveInvoiceUser(invoice: InvoiceWithSubscription): Promise<User | null> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  const userId = (customerId ? await getUserIdByStripeCustomer(customerId) : null)
    || (subscriptionId ? await getUserIdByStripeSubscription(subscriptionId) : null);
  return userId ? getUser(String(userId)) : null;
}

async function disableAutomationForUser(userId: string, reason: string): Promise<void> {
  const agentIds = await getUserAgentIds(userId);
  await Promise.all(agentIds.map(async (agentId) => {
    if (isAgentAutomationExempt(agentId)) return;
    await quarantineAgentAutomation(agentId, reason);
  }));
}

function resolveSubscriptionPlan(subscription: Stripe.Subscription): BillingPlan {
  const priceId = subscription.items.data[0]?.price?.id;
  return getPlanFromPriceId(priceId);
}

function getSubscriptionPeriodEnd(subscription: Stripe.Subscription): number | null {
  const withPeriodEnd = subscription as Stripe.Subscription & {
    current_period_end?: number;
    items: { data: Array<{ current_period_end?: number }> };
  };
  return withPeriodEnd.current_period_end || withPeriodEnd.items.data[0]?.current_period_end || null;
}

function subscriptionStatusRank(status: Stripe.Subscription.Status): number {
  if (status === 'active') return 3;
  if (status === 'trialing') return 2;
  if (status === 'past_due' || status === 'unpaid') return 1;
  return 0;
}

export async function ensureStripeCustomerForUser(user: User): Promise<string> {
  if (user.stripeCustomerId) {
    await linkStripeCustomerToUser(user.id, user.stripeCustomerId);
    return user.stripeCustomerId;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: user.name || user.username,
    email: user.billingEmail || undefined,
    metadata: {
      clawfableUserId: user.id,
      xUsername: user.username,
    },
  });

  await updateUser(user.id, {
    stripeCustomerId: customer.id,
    billingEmail: customer.email || user.billingEmail || null,
  });
  await linkStripeCustomerToUser(user.id, customer.id);
  return customer.id;
}

export async function syncStripeSubscription(customerId: string, subscription: Stripe.Subscription): Promise<void> {
  const mappedUserId = await getUserIdByStripeCustomer(customerId)
    || await getUserIdByStripeSubscription(subscription.id);
  if (!mappedUserId) return;

  const user = await getUser(mappedUserId);
  if (!user) return;

  const plan = resolveSubscriptionPlan(subscription);
  const billingStatus = normalizeBillingStatus(subscription.status) as BillingStatus;
  const currentPeriodEnd = toIsoPeriodEnd(getSubscriptionPeriodEnd(subscription));
  const reconciledUser = await updateUser(user.id, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    plan,
    billingStatus,
    currentPeriodEnd,
    billingVerifiedAt: new Date().toISOString(),
  });
  await linkStripeCustomerToUser(user.id, customerId);
  await linkStripeSubscriptionToUser(user.id, subscription.id);

  const entitlement = getPaidAutomationEntitlementForUser(reconciledUser);
  if (!entitlement.eligible) {
    await disableAutomationForUser(user.id, `Automation paused after Stripe reconciliation: ${entitlement.reason}`);
  }
}

export async function syncStripePaidInvoice(invoice: InvoiceWithSubscription): Promise<void> {
  const user = await resolveInvoiceUser(invoice);
  if (!user) return;
  if (user.lastRefundedInvoiceId === invoice.id) {
    await disableAutomationForUser(user.id, 'Automation paused because the current Stripe payment was fully refunded.');
    return;
  }
  const amountPaid = Number(invoice.amount_paid || 0);
  const paidThrough = invoicePaidThrough(invoice);
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  const incomingPaidThrough = paidThrough ? Date.parse(paidThrough) : Number.NaN;
  const currentPaidThrough = user.paidThrough ? Date.parse(user.paidThrough) : Number.NaN;
  if (
    invoice.id !== user.lastPaidInvoiceId
    && Number.isFinite(incomingPaidThrough)
    && Number.isFinite(currentPaidThrough)
    && incomingPaidThrough + 60_000 < currentPaidThrough
  ) {
    return;
  }
  const verifiedAt = new Date().toISOString();
  await updateUser(user.id, {
    ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
    billingVerifiedAt: verifiedAt,
    lastPaidInvoiceId: invoice.id,
    lastPaidInvoiceSubscriptionId: subscriptionId,
    lastPaidInvoiceAt: toIsoPeriodEnd(invoice.status_transitions?.paid_at) || verifiedAt,
    lastPaidAmountCents: amountPaid,
    lastPaidCurrency: invoice.currency || null,
    lastRefundedInvoiceId: null,
    lastRefundedAt: null,
    paidThrough,
    ...(paidThrough ? { currentPeriodEnd: paidThrough } : {}),
  });
  if (amountPaid <= 0 || !paidThrough) {
    await disableAutomationForUser(user.id, 'Automation requires a non-zero paid Stripe invoice for the current period.');
  }
}

export async function handleStripePaymentFailed(invoice: InvoiceWithSubscription): Promise<void> {
  const user = await resolveInvoiceUser(invoice);
  if (!user) return;
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (subscriptionId && user.stripeSubscriptionId && subscriptionId !== user.stripeSubscriptionId) return;
  const failedThrough = invoicePaidThrough(invoice);
  const failedThroughMs = failedThrough ? Date.parse(failedThrough) : Number.NaN;
  const currentPeriodEndMs = user.currentPeriodEnd ? Date.parse(user.currentPeriodEnd) : Number.NaN;
  if (
    Number.isFinite(failedThroughMs)
    && Number.isFinite(currentPeriodEndMs)
    && failedThroughMs + 60_000 < currentPeriodEndMs
  ) {
    return;
  }
  await updateUser(user.id, {
    billingStatus: 'past_due',
    billingVerifiedAt: new Date().toISOString(),
  });
  await disableAutomationForUser(user.id, 'Automation paused because the latest Stripe invoice payment failed.');
}

export async function handleStripeChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id || null;
  if (!customerId) return;
  const userId = await getUserIdByStripeCustomer(customerId);
  if (!userId) return;
  const user = await getUser(userId);
  if (!user) return;
  const netPaid = Math.max(0, Number(charge.amount || 0) - Number(charge.amount_refunded || 0));
  const invoiceValue = (charge as Stripe.Charge & { invoice?: string | Stripe.Invoice | null }).invoice;
  const invoiceId = typeof invoiceValue === 'string' ? invoiceValue : invoiceValue?.id || user.lastPaidInvoiceId;
  if (invoiceId && user.lastPaidInvoiceId && invoiceId !== user.lastPaidInvoiceId) {
    await updateUser(user.id, {
      lastRefundedInvoiceId: invoiceId,
      lastRefundedAt: new Date().toISOString(),
    });
    return;
  }
  if (netPaid > 0) {
    await updateUser(user.id, {
      billingVerifiedAt: new Date().toISOString(),
      lastPaidAmountCents: netPaid,
    });
    return;
  }
  await updateUser(user.id, {
    billingStatus: 'unpaid',
    billingVerifiedAt: new Date().toISOString(),
    paidThrough: null,
    lastPaidInvoiceSubscriptionId: null,
    lastPaidAmountCents: 0,
    lastRefundedInvoiceId: invoiceId || null,
    lastRefundedAt: new Date().toISOString(),
  });
  await disableAutomationForUser(user.id, 'Automation paused because the current Stripe payment was fully refunded.');
}

export async function syncStripeCustomerEmail(customerId: string): Promise<void> {
  const userId = await getUserIdByStripeCustomer(customerId);
  if (!userId) return;
  const user = await getUser(userId);
  if (!user) return;
  const customer = await getStripe().customers.retrieve(customerId);
  if ('deleted' in customer && customer.deleted) return;
  const activeCustomer = customer as Stripe.Customer;
  await updateUser(user.id, {
    billingEmail: activeCustomer.email || user.billingEmail || null,
    stripeCustomerId: activeCustomer.id,
  });
}

export async function handleStripeSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = String(subscription.customer);
  const userId = await getUserIdByStripeSubscription(subscription.id)
    || await getUserIdByStripeCustomer(customerId);
  if (!userId) return;
  const user = await getUser(userId);
  if (!user) return;
  if (user.stripeSubscriptionId && user.stripeSubscriptionId !== subscription.id) {
    await unlinkStripeSubscription(subscription.id);
    return;
  }
  await updateUser(user.id, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    plan: 'free',
    billingStatus: 'canceled',
    currentPeriodEnd: toIsoPeriodEnd(subscription.ended_at || subscription.cancel_at || null),
    billingVerifiedAt: new Date().toISOString(),
    paidThrough: null,
    lastPaidInvoiceSubscriptionId: null,
    lastRefundedInvoiceId: null,
    lastRefundedAt: null,
  });
  await unlinkStripeSubscription(subscription.id);
  await disableAutomationForUser(user.id, 'Automation paused because the Stripe subscription ended.');
}

export async function reconcileStripeBilling(): Promise<{
  usersChecked: number;
  subscriptionsFound: number;
  usersReset: number;
}> {
  const stripe = getStripe();
  const users = await getUsers();
  const subscriptions: Stripe.Subscription[] = [];
  for await (const subscription of stripe.subscriptions.list({
    status: 'all',
    limit: 100,
    expand: ['data.latest_invoice'],
  })) {
    subscriptions.push(subscription);
  }
  const byId = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  const byCustomer = new Map<string, Stripe.Subscription[]>();
  for (const subscription of subscriptions) {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    byCustomer.set(customerId, [...(byCustomer.get(customerId) || []), subscription]);
  }

  let usersReset = 0;
  for (const user of users) {
    const candidates = [
      ...(user.stripeSubscriptionId && byId.has(user.stripeSubscriptionId) ? [byId.get(user.stripeSubscriptionId)!] : []),
      ...(user.stripeCustomerId ? byCustomer.get(user.stripeCustomerId) || [] : []),
    ];
    const subscription = [...new Map(candidates.map((entry) => [entry.id, entry])).values()]
      .sort((left, right) => (
        subscriptionStatusRank(right.status) - subscriptionStatusRank(left.status)
        || Number(right.id === user.stripeSubscriptionId) - Number(left.id === user.stripeSubscriptionId)
        || Number(right.created || 0) - Number(left.created || 0)
      ))[0] || null;
    if (!subscription) {
      if (user.plan !== 'free' || user.billingStatus !== 'free' || user.stripeSubscriptionId) usersReset += 1;
      await updateUser(user.id, {
        stripeSubscriptionId: null,
        plan: 'free',
        billingStatus: 'free',
        currentPeriodEnd: null,
        billingVerifiedAt: new Date().toISOString(),
        paidThrough: null,
        lastPaidInvoiceId: null,
        lastPaidInvoiceSubscriptionId: null,
        lastPaidInvoiceAt: null,
        lastPaidAmountCents: null,
        lastPaidCurrency: null,
        lastRefundedInvoiceId: null,
        lastRefundedAt: null,
      });
      await disableAutomationForUser(user.id, 'Automation paused because Stripe has no current paid subscription.');
      continue;
    }

    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const latestInvoice = subscription.latest_invoice;
    const invoice = latestInvoice && typeof latestInvoice !== 'string' && latestInvoice.status === 'paid'
      ? latestInvoice as InvoiceWithSubscription
      : null;
    if (invoice) await syncStripePaidInvoice(invoice);
    await syncStripeSubscription(customerId, subscription);
  }

  return { usersChecked: users.length, subscriptionsFound: subscriptions.length, usersReset };
}
