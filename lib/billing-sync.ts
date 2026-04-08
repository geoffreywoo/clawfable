import type Stripe from 'stripe';
import { getPlanFromPriceId, normalizeBillingStatus } from './billing';
import type { BillingPlan, BillingStatus, User } from './types';
import {
  getUser,
  getUserAgentIds,
  getUserIdByStripeCustomer,
  getUserIdByStripeSubscription,
  linkStripeCustomerToUser,
  linkStripeSubscriptionToUser,
  unlinkStripeSubscription,
  updateProtocolSettings,
  updateUser,
} from './kv-storage';
import { getStripe } from './stripe';

function toIsoPeriodEnd(periodEnd: number | null | undefined): string | null {
  return typeof periodEnd === 'number' ? new Date(periodEnd * 1000).toISOString() : null;
}

async function disableAutomationForUser(userId: string): Promise<void> {
  const agentIds = await getUserAgentIds(userId);
  await Promise.all(
    agentIds.map((agentId) => updateProtocolSettings(agentId, {
      enabled: false,
      autoReply: false,
      proactiveReplies: false,
      proactiveLikes: false,
      autoFollow: false,
      agentShoutouts: false,
    }))
  );
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

  await updateUser(user.id, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    plan,
    billingStatus,
    currentPeriodEnd,
  });
  await linkStripeCustomerToUser(user.id, customerId);
  await linkStripeSubscriptionToUser(user.id, subscription.id);

  if (billingStatus !== 'active' && billingStatus !== 'trialing') {
    await disableAutomationForUser(user.id);
  }
}

export async function syncStripeCustomerEmail(customerId: string): Promise<void> {
  const userId = await getUserIdByStripeCustomer(customerId);
  if (!userId) return;

  const user = await getUser(userId);
  if (!user) return;

  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(customerId);
  if ('deleted' in customer && customer.deleted) return;
  const activeCustomer = customer as Stripe.Customer;

  await updateUser(user.id, {
    billingEmail: activeCustomer.email || user.billingEmail || null,
    stripeCustomerId: activeCustomer.id,
  });
}

export async function handleStripeSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = String(subscription.customer);
  const userId = await getUserIdByStripeCustomer(customerId)
    || await getUserIdByStripeSubscription(subscription.id);
  if (!userId) return;

  const user = await getUser(userId);
  if (!user) return;

  await updateUser(user.id, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    plan: 'free',
    billingStatus: 'canceled',
    currentPeriodEnd: toIsoPeriodEnd(subscription.ended_at || subscription.cancel_at || null),
  });
  await unlinkStripeSubscription(subscription.id);
  await disableAutomationForUser(user.id);
}
