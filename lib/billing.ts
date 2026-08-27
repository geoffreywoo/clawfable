import type { AutomationEntitlement, BillingEntitlements, BillingPlan, BillingStatus, BillingSummary, User } from './types';
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
  return status === 'active';
}

export function isGrandfatheredUser(_user: Pick<User, 'username'>): boolean {
  return false;
}

export function getPaidAutomationEntitlementForUser(
  user: User | null,
  now = new Date(),
): AutomationEntitlement {
  const base = {
    source: 'none' as const,
    verifiedAt: user?.billingVerifiedAt ?? null,
    paidThrough: user?.paidThrough ?? null,
    paidInvoiceId: user?.lastPaidInvoiceId ?? null,
    paidInvoiceSubscriptionId: user?.lastPaidInvoiceSubscriptionId ?? null,
    paidAmountCents: user?.lastPaidAmountCents ?? null,
    paidCurrency: user?.lastPaidCurrency ?? null,
  };
  if (!user) return { ...base, eligible: false, reason: 'Agent owner is missing.' };
  if (user.billingStatus !== 'active') {
    return { ...base, eligible: false, reason: user.billingStatus === 'trialing' ? 'Trials do not include automated publishing.' : 'An active paid subscription is required.' };
  }
  if (user.plan !== 'pro' && user.plan !== 'scale') {
    return { ...base, eligible: false, reason: 'The active Stripe subscription is not tied to a paid Clawfable plan.' };
  }
  if (!user.stripeCustomerId || !user.stripeSubscriptionId) {
    return { ...base, eligible: false, reason: 'Stripe subscription verification is missing.' };
  }
  if (!user.billingVerifiedAt || !user.lastPaidInvoiceId || !user.lastPaidInvoiceAt) {
    return { ...base, eligible: false, reason: 'A paid Stripe invoice has not been verified.' };
  }
  if (!user.lastPaidAmountCents || user.lastPaidAmountCents <= 0) {
    return { ...base, eligible: false, reason: 'The latest Stripe invoice did not collect payment.' };
  }
  if (user.lastRefundedInvoiceId && user.lastRefundedInvoiceId === user.lastPaidInvoiceId) {
    return { ...base, eligible: false, reason: 'The current Stripe invoice was fully refunded.' };
  }
  const paidThrough = user.paidThrough ? Date.parse(user.paidThrough) : Number.NaN;
  if (!Number.isFinite(paidThrough) || paidThrough <= now.getTime()) {
    return { ...base, eligible: false, reason: 'The paid subscription period has ended.' };
  }
  if (user.lastPaidInvoiceSubscriptionId !== user.stripeSubscriptionId) {
    return { ...base, eligible: false, reason: 'The paid invoice does not match the active Stripe subscription.' };
  }
  const currentPeriodEnd = user.currentPeriodEnd ? Date.parse(user.currentPeriodEnd) : Number.NaN;
  if (!Number.isFinite(currentPeriodEnd) || currentPeriodEnd <= now.getTime()) {
    return { ...base, eligible: false, reason: 'The active Stripe billing period is missing or expired.' };
  }
  if (paidThrough + 60_000 < currentPeriodEnd) {
    return { ...base, eligible: false, reason: 'The paid invoice does not cover the current Stripe billing period.' };
  }
  return {
    ...base,
    source: 'stripe_paid',
    eligible: true,
    reason: 'Stripe payment is verified for the current subscription period.',
  };
}

function getEffectiveBillingState(user: User): {
  grandfathered: boolean;
  plan: BillingPlan;
  status: BillingStatus;
  label: string;
  isPaid: boolean;
  entitlements: BillingEntitlements;
} {
  const grandfathered = false;
  const status = normalizeBillingStatus(user.billingStatus);
  const plan = normalizePlan(user.plan);
  const isPaid = getPaidAutomationEntitlementForUser(user).eligible;
  const effectivePlan = isPaid ? plan : 'free';
  return {
    grandfathered: false,
    plan,
    status,
    label: PLAN_LABELS[plan],
    isPaid,
    entitlements: PLAN_ENTITLEMENTS[effectivePlan],
  };
}

export function getEntitlementsForUser(user: User): BillingEntitlements {
  return getEffectiveBillingState(user).entitlements;
}

export function getBillingSummary(user: User, agentCount: number): BillingSummary {
  const effective = getEffectiveBillingState(user);
  const entitlements = effective.entitlements;
  const configured = isStripeConfigured();
  const checkoutReady = effective.grandfathered ? false : isStripeCheckoutConfigured();
  const portalReady = effective.grandfathered ? false : configured && Boolean(user.stripeCustomerId);
  const agentsRemaining = Math.max(entitlements.maxAgents - agentCount, 0);

  return {
    configured,
    checkoutReady,
    portalReady,
    plan: effective.plan,
    status: effective.status,
    label: effective.label,
    isPaid: effective.isPaid,
    grandfathered: effective.grandfathered,
    agentCount,
    maxAgents: entitlements.maxAgents,
    agentsRemaining,
    canCreateAgent: agentCount < entitlements.maxAgents,
    canUseAutopilot: entitlements.autopilot,
    stripeCustomerId: user.stripeCustomerId || null,
    stripeSubscriptionId: user.stripeSubscriptionId || null,
    billingEmail: user.billingEmail || null,
    currentPeriodEnd: user.currentPeriodEnd || null,
    billingVerifiedAt: user.billingVerifiedAt || null,
    paidThrough: user.paidThrough || null,
    lastPaidInvoiceId: user.lastPaidInvoiceId || null,
    lastPaidInvoiceSubscriptionId: user.lastPaidInvoiceSubscriptionId || null,
    lastPaidInvoiceAt: user.lastPaidInvoiceAt || null,
    lastPaidAmountCents: user.lastPaidAmountCents ?? null,
    lastPaidCurrency: user.lastPaidCurrency || null,
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
      'Paid plans unlock the automation layer: auto-posting, auto-replies, supervised engagement workflows, and hands-off queue execution.',
      'autopilot_locked',
      403,
    );
  }
  return summary;
}
