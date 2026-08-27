import { NextRequest, NextResponse } from 'next/server';
import { handleAuthError, requireUser } from '@/lib/auth';
import { BillingError, getPriceIdForPlan, normalizePlan } from '@/lib/billing';
import { ensureStripeCustomerForUser } from '@/lib/billing-sync';
import { getAppUrl, getStripe, isStripeCheckoutConfigured } from '@/lib/stripe';

export const runtime = 'nodejs';

// POST /api/billing/checkout — create a Stripe Checkout session for a paid plan
export async function POST(request: NextRequest) {
  try {
    if (!isStripeCheckoutConfigured()) {
      return NextResponse.json({ error: 'Stripe billing is not configured yet.' }, { status: 503 });
    }

    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const plan = normalizePlan(body.plan || 'pro');

    if (plan === 'free') {
      throw new BillingError('Choose a paid plan to start Checkout.', 'invalid_plan', 400);
    }

    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return NextResponse.json({ error: `No Stripe price configured for the ${plan} plan.` }, { status: 503 });
    }

    const stripe = getStripe();
    const customerId = await ensureStripeCustomerForUser(user);
    const appUrl = getAppUrl(request);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      allow_promotion_codes: true,
      success_url: `${appUrl}/?billing=success`,
      cancel_url: `${appUrl}/?billing=canceled`,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        clawfableUserId: user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          clawfableUserId: user.id,
          plan,
        },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    if (err instanceof BillingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to create checkout session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
