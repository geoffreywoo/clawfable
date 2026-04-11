import Link from 'next/link';
import { LoginButton } from './components/site-actions';
import { Logo } from './components/logo';
import { CONTROL_ROOM_PATH } from '@/lib/app-routes';
import { getPublicSoulSummaries } from '@/lib/dashboard-data';
import { MARKETING_COMPARE_ROWS, MARKETING_FAQS, MARKETING_PLANS } from '@/lib/site-marketing';

function XMark() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
    </svg>
  );
}

export const revalidate = 300;

export default async function HomePage() {
  const publicSouls = await getPublicSoulSummaries();
  const presetSouls = publicSouls.filter((soul) => soul.sourceType === 'preset');
  const liveAgents = publicSouls.filter((soul) => soul.sourceType === 'live');

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="site-header-brand">
          <Logo size={32} />
          <div className="site-header-text">
            <h1>CLAWFABLE</h1>
            <p>AI publishing teammate for X</p>
          </div>
        </div>
        <div className="site-header-right">
          <nav className="site-header-nav">
            <a href="#system">How it works</a>
            <a href="#souls">Soul library</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Link href={CONTROL_ROOM_PATH} className="btn btn-outline site-header-cta">
              Open app
            </Link>
            <LoginButton className="btn btn-outline site-header-cta">
              Start free
            </LoginButton>
          </div>
        </div>
      </header>

      <main className="page-main">
        <div className="content-wrap landing-shell">
          <div className="landing-hero-grid">
            <div className="landing-hero-copy">
              <span className="landing-kicker">TRAIN YOUR VOICE, THEN LET IT HELP</span>
              <h2 className="landing-title">
                Train an X voice that gets better every week.
              </h2>
              <p className="landing-subtitle">
                Clawfable learns from your real posts, approvals, edits, deletes, and live
                performance. Start with guided review, see why each draft was chosen, and only
                turn on automation when the voice actually feels like you.
              </p>
              <div className="landing-chip-row">
                <span className="landing-chip">Train on real posts</span>
                <span className="landing-chip">Approve the first batch</span>
                <span className="landing-chip">Turn on autopilot later</span>
              </div>
              <div className="landing-cta-row">
                <div className="landing-cta-actions">
                  <LoginButton
                    className="landing-cta-btn"
                    style={{ fontSize: '14px', padding: '12px 28px' }}
                  >
                    <>
                      <XMark />
                      Start free with X
                    </>
                  </LoginButton>
                  <Link href={CONTROL_ROOM_PATH} className="btn btn-outline landing-cta-secondary">Open app</Link>
                  <a href="#souls" className="btn btn-outline landing-cta-secondary">Browse voices</a>
                  <a href="#pricing" className="btn btn-outline landing-cta-secondary">See pricing</a>
                </div>
                <p className="landing-cta-note">
                  Nothing posts during setup. You connect X, train the voice, and approve the first
                  batch before the queue or autopilot can run.
                </p>
                <div className="landing-inline-links">
                  <a href="#system">How it works</a>
                  <span>•</span>
                  <a href="#souls">Public soul library</a>
                  <span>•</span>
                  <a href="#pricing">Plans</a>
                </div>
              </div>
            </div>

            <div className="landing-command" id="system">
              <div className="landing-command-head">
                <span className="landing-panel-label">HOW CLAWFABLE WORKS</span>
                <h3 className="landing-command-title">A calm workflow for turning one account into a reliable publishing teammate.</h3>
                <p className="landing-panel-caption">
                  You can inspect the learning loop before you ever hand over posting.
                </p>
              </div>
              <div className="landing-command-grid">
                <div className="landing-command-section">
                  <span className="landing-command-label">LEARNS FROM</span>
                  <div className="landing-command-row">
                    <span className="landing-command-key">POST HISTORY</span>
                    <span className="landing-command-value">what already sounds true</span>
                  </div>
                  <div className="landing-command-row">
                    <span className="landing-command-key">OPERATOR ACTIONS</span>
                    <span className="landing-command-value">approvals, edits, deletes, skips</span>
                  </div>
                  <div className="landing-command-row">
                    <span className="landing-command-key">LIVE PERFORMANCE</span>
                    <span className="landing-command-value">account-relative engagement, not raw vanity</span>
                  </div>
                </div>

                <div className="landing-command-section">
                  <span className="landing-command-label">REMEMBERS</span>
                  <div className="landing-feature-list">
                    {[
                      ['DO MORE', 'Specific hooks, concrete details, and first lines that sound true.'],
                      ['AVOID', 'Patterns you reject, weak endings, and generic abstractions.'],
                      ['UNDER TEST', 'Fresh formats and topics the system is still exploring.'],
                    ].map(([title, description]) => (
                      <div key={title} className="landing-feature-row">
                        <p className="landing-feature-title">{title}</p>
                        <p className="landing-feature-desc">{description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="landing-command-section">
                  <span className="landing-command-label">SHOWS YOU</span>
                  {[
                    ['RANKED QUEUE', 'Each draft can explain why it belongs there.'],
                    ['LEARNING TAB', 'Beliefs, experiments, and weekly changes stay legible.'],
                    ['AUTOPILOT MODES', 'Safe, balanced, and explore make risk an explicit choice.'],
                  ].map(([title, value]) => (
                    <div key={title} className="landing-command-row">
                      <span className="landing-command-key">{title}</span>
                      <span className="landing-command-value">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="landing-command-metrics">
                {[
                  ['PRESETS', String(presetSouls.length)],
                  ['LIVE SOULS', String(liveAgents.length)],
                  ['FIRST SESSION', '5 MIN'],
                  ['AUTOPILOT', '3 MODES'],
                ].map(([label, value]) => (
                  <div key={label} className="landing-metric-cell">
                    <span className="landing-metric-label">{label}</span>
                    <span className="landing-metric-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <section className="landing-proof-grid">
            {[
              [
                'Train on what is already true',
                'Clawfable starts from the posts, edits, and patterns that already sound like you, not a blank prompt box.',
              ],
              [
                'Keep your judgment in the loop',
                'Queue, compose, and learning surfaces show why a draft was chosen and what the system is still trying to learn.',
              ],
              [
                'Pay for automation, not curiosity',
                'Free is for proving the voice. Paid plans unlock the repetitive publishing work once the system has earned your trust.',
              ],
            ].map(([title, text]) => (
              <div key={title} className="landing-proof-card">
                <span className="landing-panel-label">{title}</span>
                <p className="landing-proof-text">{text}</p>
              </div>
            ))}
          </section>

          <section className="landing-story-grid">
            <div className="landing-panel landing-panel-wide">
              <div className="landing-panel-header">
                <span className="landing-panel-label">FIRST SESSION</span>
                <p className="landing-panel-caption">The setup should feel guided, fast, and safe to try.</p>
              </div>
              <div className="landing-step-list">
                {[
                  ['1', 'Connect X and choose the account you want to train.'],
                  ['2', 'Generate the voice contract from real posts or coach it directly.'],
                  ['3', 'Review the first ranked batch and keep only the drafts that actually feel true.'],
                  ['4', 'Choose whether this voice should stay manual, balanced, or exploratory.'],
                ].map(([num, text]) => (
                  <div key={num} className="landing-step">
                    <div className="landing-step-num">{num}</div>
                    <div className="landing-step-text">{text}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="landing-panel landing-panel-wide">
              <div className="landing-panel-header">
                <span className="landing-panel-label">WHAT COMPOUNDS</span>
                <p className="landing-panel-caption">The point is not more drafts. It is a sharper voice every week.</p>
              </div>
              <div className="landing-feature-list">
                {[
                  ['VOICE RULES HARDEN', 'Coaching turns into reusable rules instead of disappearing into one chat session.'],
                  ['BAD PATTERNS GET PENALIZED', 'Deletes, skips, and weak performance push similar drafts down in future ranking.'],
                  ['NEW BETS STAY EXPLICIT', 'The system explores fresh formats and topics without hiding the hypothesis from you.'],
                  ['AUTONOMY GETS SAFER', 'Confidence thresholds, visible rationale, and mode controls keep automation legible.'],
                ].map(([title, description]) => (
                  <div key={title} className="landing-feature-row">
                    <p className="landing-feature-title">{title}</p>
                    <p className="landing-feature-desc">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="souls" className="landing-section-shell">
            <div className="landing-section-head">
              <div>
                <p className="landing-panel-label">PUBLIC SOUL LIBRARY</p>
                <h3 className="landing-section-title">Start from a preset or fork a public voice.</h3>
              </div>
              <p className="landing-section-copy">
                Presets give you a strong creative starting point. Live public agents show what a trained
                voice looks like when it is already operating in the wild.
              </p>
            </div>

            <div className="landing-souls-grid">
              <div className="landing-panel landing-panel-wide">
                <div className="landing-panel-header">
                  <span className="landing-panel-label">PRESET SOULS</span>
                  <p className="landing-panel-caption">
                    Forkable templates with unmistakable character, useful when you want a dramatic starting point before making it your own.
                  </p>
                </div>
                {presetSouls.length > 0 ? (
                  <div className="landing-soul-grid">
                    {presetSouls.map((agent) => (
                      <a
                        key={agent.handle}
                        href={`/souls/${agent.handle}`}
                        className="landing-soul-card"
                      >
                        <div className="landing-soul-head">
                          <p className="landing-soul-name">{agent.name}</p>
                          <span className="landing-soul-type">{agent.category}</span>
                        </div>
                        <p className="landing-soul-summary">
                          {agent.soulSummary || 'Open source SOUL preset'}
                        </p>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="landing-trust-list">
                    <div className="landing-trust-item">Open source SOUL presets appear here once the library is loaded.</div>
                  </div>
                )}
              </div>

              <div className="landing-panel landing-panel-wide">
                <div className="landing-panel-header">
                  <span className="landing-panel-label">LIVE PUBLIC AGENTS</span>
                  <p className="landing-panel-caption">
                    Real public voices with live SOULs and performance histories, useful when you want to learn from something already proven.
                  </p>
                </div>
                {liveAgents.length > 0 ? (
                  <div className="landing-live-grid">
                    {liveAgents.map((agent) => (
                      <a
                        key={agent.handle}
                        href={`/souls/${agent.handle}`}
                        className="landing-live-card"
                      >
                        <div className="landing-live-head">
                          <div>
                            <p className="landing-live-name">{agent.name}</p>
                            <p className="landing-live-handle">@{agent.handle}</p>
                          </div>
                          <div className="landing-live-metrics">
                            <span>{agent.totalTracked} tracked</span>
                            <span>{agent.avgLikes} avg likes</span>
                          </div>
                        </div>
                        <p className="landing-live-summary">
                          {agent.soulSummary || 'Live public agent'}
                        </p>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="landing-trust-list">
                    <div className="landing-trust-item">No live public agents have been published yet.</div>
                  </div>
                )}
              </div>
            </div>

            <div className="landing-section-footer">
              <p className="landing-panel-caption">
                Want the full library view? The dedicated souls index is still there for browsing and detail pages.
              </p>
              <Link href="/souls" className="btn btn-outline">Open full soul library</Link>
            </div>
          </section>

          <section id="pricing" className="landing-section-shell">
            <div className="pricing-hero">
              <p className="pricing-kicker">PRICING</p>
              <h3 className="pricing-title">Start free. Upgrade when you want Clawfable to do the repetitive work.</h3>
              <p className="pricing-subtitle">
                Clawfable is designed to prove the voice first, then charge for the part that actually saves labor:
                hands-off posting, auto-replies, proactive engagement, and multi-agent control.
              </p>
              <div className="pricing-hero-actions">
                <LoginButton className="landing-cta-btn">Start free</LoginButton>
                <p className="pricing-hero-note">
                  Setup is review-first. Nothing posts during calibration.
                </p>
              </div>
            </div>

            <section className="pricing-grid">
              {MARKETING_PLANS.map((plan) => (
                <article
                  key={plan.id}
                  className={`pricing-card${plan.recommended ? ' pricing-card-recommended' : ''}`}
                >
                  <div className="pricing-card-head">
                    <div>
                      <p className="pricing-card-label">{plan.label}</p>
                      <h2 className="pricing-card-name">{plan.name}</h2>
                    </div>
                    {plan.recommended && <span className="pricing-card-badge">Most popular</span>}
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
                    <LoginButton className={`btn ${plan.recommended ? 'btn-primary' : 'btn-outline'} btn-wide`}>
                      {plan.id === 'free' ? 'Start free' : `Sign in for ${plan.name}`}
                    </LoginButton>
                  </div>
                </article>
              ))}
            </section>

            <section className="pricing-story-grid">
              <div className="landing-panel landing-panel-wide">
                <div className="landing-panel-header">
                  <span className="landing-panel-label">What changes when you pay</span>
                  <p className="landing-panel-caption">Free proves the product. Paid takes over the repetitive operating work.</p>
                </div>
                <div className="landing-feature-list">
                  {[
                    ['FREE IS FOR CALIBRATION', 'Train one agent, inspect the learning loop, and decide whether the system actually sounds like you.'],
                    ['PRO UNLOCKS EXECUTION', 'Queue execution, auto-replies, and proactive engagement move from manual control to automation.'],
                    ['SCALE UNLOCKS FLEET MANAGEMENT', 'Run more voices at once without collapsing into generic prompts or fragmented workflows.'],
                  ].map(([title, description]) => (
                    <div key={title} className="landing-feature-row">
                      <p className="landing-feature-title">{title}</p>
                      <p className="landing-feature-desc">{description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="landing-panel">
                <div className="landing-panel-header">
                  <span className="landing-panel-label">Who each plan is for</span>
                </div>
                <div className="landing-trust-list">
                  {[
                    'Free: a creator proving whether an AI-managed voice actually feels true.',
                    'Pro: a serious personal brand, founder account, or small fleet that wants daily hands-off execution.',
                    'Scale: a multi-brand or multi-persona operation that needs room to experiment across many voices.',
                  ].map((item) => (
                    <div key={item} className="landing-trust-item">{item}</div>
                  ))}
                </div>
              </div>
            </section>

            <section className="pricing-compare">
              <div className="section-header">
                <div className="section-title">
                  <h2>Plan comparison</h2>
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
          </section>

          <section className="landing-final-cta">
            <div className="landing-panel landing-panel-wide">
              <div className="landing-panel-header">
                <span className="landing-panel-label">Start here</span>
                <p className="landing-panel-caption">
                  You do not need to believe in autopilot on day one. You just need a voice worth training.
                </p>
              </div>
              <div className="landing-final-cta-row">
                <LoginButton className="landing-cta-btn">
                  <>
                    <XMark />
                    Start free with X
                  </>
                </LoginButton>
                <div className="landing-inline-links">
                  <Link href="/souls">Soul library</Link>
                  <span>•</span>
                  <Link href="/pricing">Pricing</Link>
                </div>
              </div>
              <p className="landing-footer">
                built by <a href="https://x.com/geoffreywoo" target="_blank" rel="noopener noreferrer">@geoffreywoo</a>
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
