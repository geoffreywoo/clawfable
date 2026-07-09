import { LoginFormButton } from './components/login-form-button';
import { Logo } from './components/logo';
import { CONTROL_ROOM_PATH } from '@/lib/app-routes';
import { getPublicSoulSummaries } from '@/lib/dashboard-data';
import { MARKETING_PLANS } from '@/lib/site-marketing';

function XMark() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
    </svg>
  );
}

function previewText(text: string | null | undefined, fallback: string, maxLength = 150) {
  const clean = (text || fallback).replace(/\s+/g, ' ').trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength).trimEnd()}...`;
}

export const revalidate = 300;

export default async function HomePage() {
  const publicSouls = await getPublicSoulSummaries();
  const presetSouls = publicSouls.filter((soul) => soul.sourceType === 'preset');
  const liveAgents = publicSouls.filter((soul) => soul.sourceType === 'live');
  const presetSoulPreview = presetSouls.slice(0, 6);
  const liveAgentPreview = liveAgents.slice(0, 6);

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="site-header-brand">
          <Logo size={32} />
          <div className="site-header-text">
            <h1>CLAWFABLE</h1>
            <p>Authentic X autopilot</p>
          </div>
        </div>
        <div className="site-header-right">
          <nav className="site-header-nav">
            <a href="#system">How it works</a>
            <a href="#souls">Soul library</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="site-header-actions">
            <a href={CONTROL_ROOM_PATH} className="btn btn-outline site-header-cta">
              Open app
            </a>
            <LoginFormButton className="btn btn-outline site-header-cta">
              Start free
            </LoginFormButton>
          </div>
        </div>
      </header>

      <main className="page-main">
        <div className="content-wrap landing-shell">
          <div className="landing-hero-grid">
            <div className="landing-hero-copy">
              <span className="landing-kicker">AUTHENTIC X AUTOPILOT</span>
              <h2 className="landing-title">
                Train your X voice. Let it publish when it earns trust.
              </h2>
              <p className="landing-subtitle">
                Clawfable learns from your real posts, approvals, edits, deletes, and live
                performance, then turns that evidence into a ranked queue and optional autopilot.
                More consistency, without sounding like a prompt.
              </p>
              <div className="landing-chip-row">
                <span className="landing-chip">Review-first setup</span>
                <span className="landing-chip">Learns from manual posts</span>
                <span className="landing-chip">Autopilot only when ready</span>
              </div>
              <div className="landing-cta-row">
                <div className="landing-cta-actions">
                  <LoginFormButton
                    className="landing-cta-btn"
                    style={{ fontSize: '14px', padding: '12px 28px' }}
                  >
                    <>
                      <XMark />
                      Start free with X
                    </>
                  </LoginFormButton>
                  <a href="#system" className="btn btn-outline landing-cta-secondary">See how it works</a>
                </div>
                <p className="landing-cta-note">
                  Nothing posts during setup. Connect X, train the voice, review the first batch,
                  then decide whether autopilot is allowed to run.
                </p>
              </div>
            </div>

            <div className="landing-command" id="system">
              <div className="landing-command-head">
                <span className="landing-panel-label">HOW IT WORKS</span>
                <h3 className="landing-command-title">A weekly loop that keeps the account sounding like you.</h3>
                <p className="landing-panel-caption">
                  The system only gets more autonomy as it collects proof from your decisions and actual post outcomes.
                </p>
              </div>
              <div className="landing-loop-steps">
                {[
                  ['01', 'Learn the voice', 'Import posting history and turn manual winners into a voice contract.'],
                  ['02', 'Rank the queue', 'Generate drafts with reasons, confidence, source lane, and topic fit.'],
                  ['03', 'Post and adapt', 'Use approvals, edits, deletes, and engagement to tune the next batch.'],
                ].map(([num, title, text]) => (
                  <div key={num} className="landing-loop-step">
                    <span className="landing-loop-num">{num}</span>
                    <div>
                      <p className="landing-feature-title">{title}</p>
                      <p className="landing-feature-desc">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="landing-voice-card">
                <div>
                  <span className="landing-command-label">NEXT BATCH PREVIEW</span>
                  <p>3 manual-core posts, 2 aligned trends, 1 spicy explore slot.</p>
                </div>
                <div className="landing-voice-meter">
                  <span style={{ width: '86%' }} />
                </div>
                <div className="landing-voice-meta">
                  <span>Voice fit 86%</span>
                  <span>Autopilot gated</span>
                </div>
              </div>
              <div className="landing-command-metrics">
                {[
                  ['Setup', '5 min'],
                  ['Presets', String(presetSouls.length)],
                  ['Modes', '3'],
                  ['Posting', 'gated'],
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
                'Voice before volume',
                'Start from what already sounds like you, then let the system explore without sanding off the edge.',
              ],
              [
                'Clear reasons for every draft',
                'See why a post belongs in the queue, which topic it targets, and what the system is testing.',
              ],
              [
                'Autopilot after calibration',
                'Free proves the voice. Paid plans unlock repetitive publishing once the queue is earning trust.',
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
                <p className="landing-panel-caption">A guided setup that keeps posting disabled until you approve the first batch.</p>
              </div>
              <div className="landing-step-list">
                {[
                  ['1', 'Connect X and choose the account you want to train.'],
                  ['2', 'Build a voice contract from real posts or direct coaching.'],
                  ['3', 'Review ranked drafts and keep only what feels true.'],
                  ['4', 'Choose manual mode, balanced autopilot, or explore mode.'],
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
                <span className="landing-panel-label">WHAT IMPROVES</span>
                <p className="landing-panel-caption">The point is not more drafts. It is a sharper voice every week.</p>
              </div>
              <div className="landing-feature-list">
                {[
                  ['Voice rules get sharper', 'Coaching turns into reusable rules instead of disappearing into one chat session.'],
                  ['Bad patterns get penalized', 'Deletes, skips, and weak performance push similar drafts down in future ranking.'],
                  ['Trend bets stay visible', 'The planner shows which trends fit the voice and which ones got rejected.'],
                  ['Autonomy stays legible', 'Confidence thresholds, rationale, and mode controls keep automation easy to inspect.'],
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
                <h3 className="landing-section-title">Start with a preset, then make the voice yours.</h3>
              </div>
              <p className="landing-section-copy">
                Presets give you a strong creative starting point. Public agents show what a trained
                voice looks like once it has real decisions and performance behind it.
              </p>
            </div>

            <div className="landing-souls-grid">
              <div className="landing-panel landing-panel-wide">
                <div className="landing-panel-header">
                  <span className="landing-panel-label">PRESET SOULS</span>
                  <p className="landing-panel-caption">Forkable templates with unmistakable style, useful when you want a fast starting point.</p>
                </div>
                {presetSoulPreview.length > 0 ? (
                  <div className="landing-soul-grid">
                    {presetSoulPreview.map((agent) => (
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
                          {previewText(agent.soulSummary, 'Open source SOUL preset')}
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
                  <p className="landing-panel-caption">Real public voices with SOULs and performance histories when available.</p>
                </div>
                {liveAgentPreview.length > 0 ? (
                  <div className="landing-live-grid">
                    {liveAgentPreview.map((agent) => (
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
                          {previewText(agent.soulSummary, 'Live public agent')}
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
                Want the full library view? Browse presets, public voices, and detail pages.
              </p>
              <a href="/souls" className="btn btn-outline">Open full soul library</a>
            </div>
          </section>

          <section id="pricing" className="landing-section-shell">
            <div className="pricing-hero">
              <p className="pricing-kicker">PRICING</p>
              <h3 className="pricing-title">Start free. Upgrade when publishing gets repetitive.</h3>
              <p className="pricing-subtitle">
                Pro unlocks the labor-saving parts: queue execution, auto-replies, supervised engagement,
                and multi-agent control.
              </p>
              <div className="pricing-hero-actions">
                <LoginFormButton className="landing-cta-btn">Start free</LoginFormButton>
                <p className="pricing-hero-note">
                  Setup is review-first. Nothing posts during calibration.
                </p>
              </div>
            </div>

            <div className="pricing-grid">
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
                </article>
              ))}
            </div>

            <div className="landing-section-footer">
              <p className="landing-panel-caption">
                Full feature comparison, FAQ, and billing details live on the pricing page.
              </p>
              <a href="/pricing" className="btn btn-outline">Compare plans</a>
            </div>
          </section>

          <section className="landing-final-cta">
            <div className="landing-panel landing-panel-wide">
              <div className="landing-panel-header">
                <span className="landing-panel-label">Start here</span>
                <p className="landing-panel-caption">
                  You do not need to trust autopilot on day one. Start by training a voice worth protecting.
                </p>
              </div>
              <div className="landing-final-cta-row">
                <LoginFormButton className="landing-cta-btn">
                  <>
                    <XMark />
                    Start free with X
                  </>
                </LoginFormButton>
                <div className="landing-inline-links">
                  <a href="/souls">Soul library</a>
                  <span>•</span>
                  <a href="/pricing">Pricing</a>
                </div>
              </div>
              <p className="landing-footer">
                built by <a href="https://x.com/geoffwoo" target="_blank" rel="noopener noreferrer">@geoffwoo</a>
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
