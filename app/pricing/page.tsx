'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Logo } from '@/app/components/logo';
import type { BillingSummary } from '@/lib/types';

interface AuthUser {
  id: string;
  username: string;
  name: string;
  billing: BillingSummary;
}

const PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    price: '$0',
    cadence: '/month',
    label: 'PROVE THE PRODUCT',
    headline: 'Train one agent and keep judgment in the loop.',
    features: [
      '1 agent',
      'Full setup wizard and voice contract',
      'Manual compose, queue review, and manual posting',
      'Learning visibility and decision explanations',
      'Nothing posts during setup',
    ],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: '$29',
    cadence: '/month',
    label: 'AUTOMATION LAYER',
    headline: 'Let the queue run itself once the voice is calibrated.',
    features: [
      'Up to 5 agents',
      'Autopilot queue execution',
      'Auto-replies and proactive engagement',
      'Full self-learning loop from operator and live signals',
      'Best for a serious personal brand or small operator fleet',
    ],
    recommended: true,
  },
  {
    id: 'scale' as const,
    name: 'Scale',
    price: '$99',
    cadence: '/month',
    label: 'FLEET CONTROL',
    headline: 'Run a larger voice fleet with room to experiment.',
    features: [
      'Up to 25 agents',
      'Everything in Pro',
      'Advanced learning and experimentation controls',
      'Priority support',
      'Best for multi-brand or multi-persona operations',
    ],
  },
];

const COMPARE_ROWS = [
  ['Agents included', '1', '5', '25'],
  ['Setup wizard and voice training', 'Included', 'Included', 'Included'],
  ['Manual compose and queue review', 'Included', 'Included', 'Included'],
  ['Learning control room and decision visibility', 'Included', 'Included', 'Included'],
  ['Autopilot posting and queue execution', 'No', 'Yes', 'Yes'],
  ['Auto-replies and proactive engagement', 'No', 'Yes', 'Yes'],
  ['Advanced experimentation controls', 'No', 'Yes', 'Yes'],
  ['Priority support', 'No', 'No', 'Yes'],
];

const FAQS = [
  {
    q: 'Does anything post during setup?',
    a: 'No. Setup is review-first. You connect X, define the voice contract, analyze what already works, and approve the first batch before any automation is armed.',
  },
  {
    q: 'Do I need to pay to see whether the product works?',
    a: 'No. The free tier is designed to prove value first: you can train one agent, inspect the learning surfaces, and manually run the workflow before paying for automation.',
  },
  {
    q: 'Is pricing usage-based?',
    a: 'No. Clawfable is sold as a subscription by account capability and fleet size, not by tweet volume.',
  },
  {
    q: 'Can I cancel or change plans later?',
    a: 'Yes. Paid plans are managed through Stripe and can be changed or canceled from the billing portal.',
  },
];

export default function PricingPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [billingLoading, setBillingLoading] = useState<'checkout' | 'portal' | null>(null);

  const loadCurrentUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = res.ok ? await res.json() : null;
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch {
      setLoginLoading(false);
    }
  };

  const handleCheckout = async (plan: 'pro' | 'scale') => {
    setBillingLoading('checkout');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout');
      window.location.href = data.url;
    } catch {
      setBillingLoading(null);
    }
  };

  const handlePortal = async () => {
    setBillingLoading('portal');
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to open billing portal');
      window.location.href = data.url;
    } catch {
      setBillingLoading(null);
    }
  };

  const renderCta = (planId: 'free' | 'pro' | 'scale') => {
    const currentPlan = user?.billing.plan || 'free';
    const isCurrentPlan = currentPlan === planId;

    if (planId === 'free') {
      if (user) {
        return (
          <Link href="/" className="btn btn-outline btn-wide">
            OPEN MISSION CONTROL
          </Link>
        );
      }
      return (
        <button className="btn btn-outline btn-wide" onClick={handleLogin} disabled={loginLoading}>
          {loginLoading ? 'REDIRECTING...' : 'START FREE'}
        </button>
      );
    }

    if (!user) {
      return (
        <button className="btn btn-primary btn-wide" onClick={handleLogin} disabled={loginLoading}>
          {loginLoading ? 'REDIRECTING...' : `LOG IN FOR ${planId === 'pro' ? 'PRO' : 'SCALE'}`}
        </button>
      );
    }

    if (user.billing.grandfathered) {
      if (isCurrentPlan) {
        return (
          <button className="btn btn-primary btn-wide" disabled>
            GRANDFATHERED ACCESS
          </button>
        );
      }
      return (
        <Link href="/" className="btn btn-outline btn-wide">
          OPEN MISSION CONTROL
        </Link>
      );
    }

    if (user.billing.isPaid) {
      return (
        <button className={`btn ${isCurrentPlan ? 'btn-primary' : 'btn-outline'} btn-wide`} onClick={handlePortal} disabled={billingLoading !== null}>
          {billingLoading === 'portal'
            ? 'LOADING...'
            : isCurrentPlan
              ? 'MANAGE CURRENT PLAN'
              : 'CHANGE IN BILLING'}
        </button>
      );
    }

    return (
      <button className={`btn ${planId === 'pro' ? 'btn-primary' : 'btn-outline'} btn-wide`} onClick={() => handleCheckout(planId)} disabled={billingLoading !== null}>
        {billingLoading === 'checkout'
          ? 'LOADING...'
          : planId === 'pro'
            ? 'UNLOCK PRO'
            : 'UNLOCK SCALE'}
      </button>
    );
  };

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="site-header-brand">
          <Logo size={32} />
          <div className="site-header-text">
            <h1>CLAWFABLE</h1>
            <p>Mission Control For X Agents</p>
          </div>
        </div>
        <div className="site-header-right">
          <nav className="site-header-nav">
            <Link href="/">HOME</Link>
            <Link href="/souls">PUBLIC SOULS</Link>
          </nav>
          {authLoading ? null : user ? (
            <Link href="/" className="btn btn-outline btn-sm">
              OPEN APP
            </Link>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={handleLogin} disabled={loginLoading}>
              {loginLoading ? 'REDIRECTING...' : 'SIGN IN'}
            </button>
          )}
        </div>
      </header>

      <main className="page-main">
        <div className="content-wrap pricing-shell">
          <section className="pricing-hero">
            <p className="pricing-kicker">PRICING</p>
            <h1 className="pricing-title">Start free. Pay when you want the automation layer.</h1>
            <p className="pricing-subtitle">
              Clawfable is designed to prove the voice first, then charge for the part that actually saves labor:
              hands-off posting, auto-replies, proactive engagement, and multi-agent control.
            </p>
            {user?.billing.grandfathered && (
              <p className="pricing-hero-note" style={{ marginTop: '12px' }}>
                This X account has grandfathered full access, so billing is not required for your own internal fleet.
              </p>
            )}
            <div className="pricing-hero-actions">
              {!authLoading && !user ? (
                <button className="landing-cta-btn" onClick={handleLogin} disabled={loginLoading}>
                  {loginLoading ? 'REDIRECTING...' : 'GET STARTED FREE'}
                </button>
              ) : (
                <Link href="/" className="landing-cta-btn">
                  OPEN MISSION CONTROL
                </Link>
              )}
              <p className="pricing-hero-note">
                Setup is review-first. Nothing posts during calibration.
              </p>
            </div>
          </section>

          <section className="pricing-grid">
            {PLANS.map((plan) => {
              const currentPlan = user?.billing.plan || 'free';
              const isCurrent = currentPlan === plan.id;

              return (
                <article
                  key={plan.id}
                  className={`pricing-card${plan.recommended ? ' pricing-card-recommended' : ''}${isCurrent ? ' pricing-card-current' : ''}`}
                >
                  <div className="pricing-card-head">
                    <div>
                      <p className="pricing-card-label">{plan.label}</p>
                      <h2 className="pricing-card-name">{plan.name}</h2>
                    </div>
                    {plan.recommended && <span className="pricing-card-badge">MOST POPULAR</span>}
                    {isCurrent && <span className="pricing-card-badge pricing-card-badge-current">CURRENT</span>}
                  </div>
                  <div className="pricing-card-price-row">
                    <span className="pricing-card-price">{plan.price}</span>
                    <span className="pricing-card-cadence">{plan.cadence}</span>
                  </div>
                  <p className="pricing-card-headline">{plan.headline}</p>
                  <div className="pricing-card-divider" />
                  <div className="pricing-card-feature-list">
                    {plan.features.map((feature) => (
                      <div key={feature} className="pricing-card-feature">
                        <span className="pricing-card-feature-mark">+</span>
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pricing-card-actions">
                    {renderCta(plan.id)}
                  </div>
                </article>
              );
            })}
          </section>

          <section className="pricing-story-grid">
            <div className="landing-panel landing-panel-wide">
              <div className="landing-panel-header">
                <span className="landing-panel-label">WHAT CHANGES WHEN YOU PAY</span>
                <p className="landing-panel-caption">The free tier proves the voice. Paid plans take over the repetitive operating work.</p>
              </div>
              {[
                ['FREE IS FOR CALIBRATION', 'Train one agent, inspect the learning loop, and decide whether the system actually sounds like you.'],
                ['PRO UNLOCKS EXECUTION', 'Queue execution, auto-replies, and proactive engagement move from manual control to automation.'],
                ['SCALE UNLOCKS FLEET MANAGEMENT', 'Run more voices at once without collapsing into generic prompts or fragmented workflows.'],
              ].map(([key, value]) => (
                <div key={key} className="landing-system-row">
                  <span className="landing-system-key">{key}</span>
                  <span className="landing-system-value">{value}</span>
                </div>
              ))}
            </div>

            <div className="landing-panel">
              <div className="landing-panel-header">
                <span className="landing-panel-label">WHO EACH PLAN IS FOR</span>
              </div>
              <div className="landing-trust-list">
                {[
                  'Free: one operator proving whether an AI-managed voice can actually feel true.',
                  'Pro: a serious personal brand, founder account, or small fleet that wants daily hands-off execution.',
                  'Scale: a multi-brand or multi-persona operation that needs room to experiment across many agents.',
                ].map((item) => (
                  <div key={item} className="landing-trust-item">{item}</div>
                ))}
              </div>
            </div>
          </section>

          <section className="pricing-compare">
            <div className="section-header">
              <div className="section-title">
                <h2>PLAN COMPARISON</h2>
              </div>
            </div>
            <div className="pricing-compare-table">
              <div className="pricing-compare-row pricing-compare-head">
                <div>FEATURE</div>
                <div>FREE</div>
                <div>PRO</div>
                <div>SCALE</div>
              </div>
              {COMPARE_ROWS.map(([feature, free, pro, scale]) => (
                <div key={feature} className="pricing-compare-row">
                  <div className="pricing-compare-feature">{feature}</div>
                  <div>{free}</div>
                  <div>{pro}</div>
                  <div>{scale}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="pricing-faq">
            <div className="section-header">
              <div className="section-title">
                <h2>FAQ</h2>
              </div>
            </div>
            <div className="pricing-faq-list">
              {FAQS.map((item) => (
                <article key={item.q} className="pricing-faq-item">
                  <p className="pricing-faq-question">{item.q}</p>
                  <p className="pricing-faq-answer">{item.a}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
