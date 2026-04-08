import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import {
  handleStripeSubscriptionDeleted,
  syncStripeCustomerEmail,
  syncStripeSubscription,
} from '@/lib/billing-sync';
import { getStripe, getStripeWebhookSecret, isStripeConfigured } from '@/lib/stripe';

export const runtime = 'nodejs';

// POST /api/stripe/webhook — receive Stripe subscription lifecycle events
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe billing is not configured yet.' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const rawBody = await request.text();
    const event = stripe.webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret());

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (typeof session.customer === 'string') {
          await syncStripeCustomerEmail(session.customer);
        }
        if (typeof session.customer === 'string' && typeof session.subscription === 'string') {
          const subscription = await stripe.subscriptions.retrieve(session.subscription, {
            expand: ['items.data.price'],
          });
          await syncStripeSubscription(session.customer, subscription);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await syncStripeSubscription(String(subscription.customer), subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleStripeSubscriptionDeleted(subscription);
        break;
      }
      case 'customer.updated': {
        const customer = event.data.object as Stripe.Customer | Stripe.DeletedCustomer;
        if (!('deleted' in customer && customer.deleted)) {
          await syncStripeCustomerEmail(customer.id);
        }
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe webhook failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
