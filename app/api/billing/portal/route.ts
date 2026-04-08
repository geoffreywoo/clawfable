import { NextRequest, NextResponse } from 'next/server';
import { handleAuthError, requireUser } from '@/lib/auth';
import { getAppUrl, getStripe, isStripeConfigured } from '@/lib/stripe';

export const runtime = 'nodejs';

// POST /api/billing/portal — create a Stripe Customer Portal session
export async function POST(request: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Stripe billing is not configured yet.' }, { status: 503 });
    }

    const user = await requireUser();
    if (!user.stripeCustomerId) {
      return NextResponse.json({ error: 'No Stripe customer found for this account yet.' }, { status: 400 });
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${getAppUrl(request)}/`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    const message = err instanceof Error ? err.message : 'Failed to open billing portal';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
