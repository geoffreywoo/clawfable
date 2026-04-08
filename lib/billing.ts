import type { BillingEntitlements, BillingPlan, BillingStatus, BillingSummary, User } from './types';
import { isStripeCheckoutConfigured, isStripeConfigured } from './stripe';

const PLAN_LABELS: Record<BillingPlan, string> = {
  free: 'Free',
  pro: 'Pro',
  scale: 'Scale',
};

const PLAN_ENTITLEMENTS: Record<BillingPlan, BillingEntitlements> = {
  free: {
    maxAgents: 1,
    autopilot: false,
    advancedLearning: false,
    prioritySupport: false,
  },
  pro: {
    maxAgents: 5,
    autopilot: true,
    advancedLearning: true,
    prioritySupport: false,
  },
  scale: {
    maxAgents: 25,
    autopilot: true,
    advancedLearning: true,
    prioritySupport: true,
  },
};

export class BillingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, code = 'billing_required', status = 402) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
    this.code = code;
  }
}

export function normalizePlan(value: unknown): BillingPlan {
  return value === 'pro' || value === 'scale' ? value : 'free';
}

export function normalizeBillingStatus(value: unknown): BillingStatus {
  return (
    value === 'trialing'
    || value === 'active'
    || value === 'past_due'
    || value === 'canceled'
    || value === 'incomplete'
    || value === 'incomplete_expired'
    || value === 'unpaid'
    || value === 'paused'
  ) ? value : 'free';
}

export function isPaidStatus(status: BillingStatus): boolean {
  return status === 'active' || status === 'trialing';
}

export function getEntitlementsForUser(user: User): BillingEntitlements {
  const status = normalizeBillingStatus(user.billingStatus);
  const plan = normalizePlan(user.plan);
  const effectivePlan = isPaidStatus(status) ? plan : 'free';
  return PLAN_ENTITLEMENTS[effectivePlan];
}

export function getBillingSummary(user: User, agentCount: number): BillingSummary {
  const plan = normalizePlan(user.plan);
  const status = normalizeBillingStatus(user.billingStatus);
  const entitlements = getEntitlementsForUser(user);
  const configured = isStripeConfigured();
  const checkoutReady = isStripeCheckoutConfigured();
  const portalReady = configured && Boolean(user.stripeCustomerId);
  const agentsRemaining = Math.max(entitlements.maxAgents - agentCount, 0);

  return {
    configured,
    checkoutReady,
    portalReady,
    plan,
    status,
    label: PLAN_LABELS[plan],
    isPaid: isPaidStatus(status),
    agentCount,
    maxAgents: entitlements.maxAgents,
    agentsRemaining,
    canCreateAgent: agentCount < entitlements.maxAgents,
    canUseAutopilot: entitlements.autopilot,
    stripeCustomerId: user.stripeCustomerId || null,
    stripeSubscriptionId: user.stripeSubscriptionId || null,
    billingEmail: user.billingEmail || null,
    currentPeriodEnd: user.currentPeriodEnd || null,
    entitlements,
  };
}

export function getPriceIdForPlan(plan: BillingPlan): string | null {
  if (plan === 'pro') return process.env.STRIPE_PRICE_PRO_MONTHLY || null;
  if (plan === 'scale') return process.env.STRIPE_PRICE_SCALE_MONTHLY || null;
  return null;
}

export function getPlanFromPriceId(priceId: string | null | undefined): BillingPlan {
  if (!priceId) return 'free';
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_SCALE_MONTHLY) return 'scale';
  return 'free';
}

export function assertCanCreateAgent(user: User, agentCount: number): BillingSummary {
  const summary = getBillingSummary(user, agentCount);
  if (!summary.canCreateAgent) {
    throw new BillingError(
      `Your ${summary.label} plan allows ${summary.maxAgents} agent${summary.maxAgents === 1 ? '' : 's'}. Upgrade to create more.`,
      'agent_limit_reached',
      403,
    );
  }
  return summary;
}

export function assertCanUseAutopilot(user: User, agentCount = 0): BillingSummary {
  const summary = getBillingSummary(user, agentCount);
  if (!summary.canUseAutopilot) {
    throw new BillingError(
      'Paid plans unlock the automation layer: auto-posting, auto-replies, proactive engagement, and hands-off queue execution.',
      'autopilot_locked',
      403,
    );
  }
  return summary;
}
