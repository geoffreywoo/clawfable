import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import {
  handleStripeChargeRefunded,
  handleStripePaymentFailed,
  handleStripeSubscriptionDeleted,
  subscriptionIdFromInvoice,
  syncStripeCustomerEmail,
  syncStripePaidInvoice,
  syncStripeSubscription,
} from '@/lib/billing-sync';
import { claimStripeWebhookEvent, completeStripeWebhookEvent, releaseStripeWebhookEvent } from '@/lib/kv-storage';
import { getStripe, getStripeWebhookSecret, isStripeConfigured } from '@/lib/stripe';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function syncSubscriptionState(
  stripe: Stripe,
  customerId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const expanded = typeof subscription.latest_invoice === 'string'
    ? await stripe.subscriptions.retrieve(subscription.id, {
        expand: ['items.data.price', 'latest_invoice'],
      })
    : subscription;
  const latestInvoice = expanded.latest_invoice;
  if (latestInvoice && typeof latestInvoice !== 'string' && latestInvoice.status === 'paid') {
    await syncStripePaidInvoice(latestInvoice);
  }
  await syncStripeSubscription(customerId, expanded);
}

// POST /api/stripe/webhook — receive Stripe subscription lifecycle events
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe billing is not configured yet.' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
  }

  let verified = false;
  try {
    const stripe = getStripe();
    const rawBody = await request.text();
    const event = stripe.webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret());
    verified = true;
    const claim = await claimStripeWebhookEvent(event.id);
    if (claim.status === 'completed') return NextResponse.json({ received: true, duplicate: true });
    if (claim.status === 'busy') return NextResponse.json({ error: 'This event is still processing. Retry shortly.' }, { status: 503 });

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (typeof session.customer === 'string') {
            await syncStripeCustomerEmail(session.customer);
          }
          if (typeof session.customer === 'string' && typeof session.subscription === 'string') {
            const subscription = await stripe.subscriptions.retrieve(session.subscription, {
              expand: ['items.data.price', 'latest_invoice'],
            });
            await syncSubscriptionState(stripe, session.customer, subscription);
          }
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          await syncSubscriptionState(stripe, String(subscription.customer), subscription);
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleStripeSubscriptionDeleted(subscription);
          break;
        }
        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice;
          await syncStripePaidInvoice(invoice);
          const subscriptionId = subscriptionIdFromInvoice(invoice);
          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
              expand: ['items.data.price'],
            });
            await syncStripeSubscription(String(subscription.customer), subscription);
          }
          break;
        }
        case 'invoice.payment_failed': {
          await handleStripePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        }
        case 'charge.refunded': {
          await handleStripeChargeRefunded(event.data.object as Stripe.Charge);
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
      if (!await completeStripeWebhookEvent(event.id, claim.owner)) {
        throw new Error('Stripe event processing lease expired before completion.');
      }
    } catch (error) {
      await releaseStripeWebhookEvent(event.id, claim.owner).catch(() => null);
      throw error;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe webhook failed';
    return NextResponse.json({ error: message }, { status: verified ? 500 : 400 });
  }
}
