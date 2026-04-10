import Link from 'next/link';
import { Logo } from '@/app/components/logo';
import { LoginButton } from '@/app/components/site-actions';
import { PricingPlanAction } from '@/app/components/pricing-plan-action';
import { CONTROL_ROOM_PATH } from '@/lib/app-routes';
import { MARKETING_COMPARE_ROWS, MARKETING_FAQS, MARKETING_PLANS } from '@/lib/site-marketing';

export const revalidate = 300;

export default function PricingPage() {
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
          <Link href={CONTROL_ROOM_PATH} className="btn btn-outline btn-sm">
            OPEN APP
          </Link>
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
            <div className="pricing-hero-actions">
              <LoginButton className="landing-cta-btn">GET STARTED FREE</LoginButton>
              <p className="pricing-hero-note">
                Setup is review-first. Nothing posts during calibration.
              </p>
            </div>
          </section>

          <section className="pricing-grid">
            {MARKETING_PLANS.map((plan) => {
              return (
                <article
                  key={plan.id}
                  className={`pricing-card${plan.recommended ? ' pricing-card-recommended' : ''}`}
                >
                  <div className="pricing-card-head">
                    <div>
                      <p className="pricing-card-label">{plan.label}</p>
                      <h2 className="pricing-card-name">{plan.name}</h2>
                    </div>
                    {plan.recommended && <span className="pricing-card-badge">MOST POPULAR</span>}
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
                    <PricingPlanAction
                      planId={plan.id}
                      className={`btn ${plan.id === 'pro' ? 'btn-primary' : 'btn-outline'} btn-wide`}
                    />
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
              {MARKETING_COMPARE_ROWS.map(([feature, free, pro, scale]) => (
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
              {MARKETING_FAQS.map((item) => (
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
