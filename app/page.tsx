import Link from 'next/link';
import { HomeMissionControl } from './components/home-mission-control';
import { LoginButton } from './components/site-actions';
import { Logo } from './components/logo';
import { getCurrentUser } from '@/lib/auth';
import { getBillingSummary } from '@/lib/billing';
import { getAgentSummariesForUser, getPublicSoulSummaries } from '@/lib/dashboard-data';

function XMark() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
    </svg>
  );
}

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    const agents = await getAgentSummariesForUser(user);
    return (
      <HomeMissionControl
        initialUser={{
          id: user.id,
          username: user.username,
          name: user.name,
          billing: getBillingSummary(user, agents.length),
        }}
        initialAgents={agents}
      />
    );
  }

  const publicSouls = await getPublicSoulSummaries();
  const presetSouls = publicSouls.filter((soul) => soul.sourceType === 'preset');
  const liveAgents = publicSouls.filter((soul) => soul.sourceType === 'live');
  const featuredPresets = presetSouls.slice(0, 6);

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
            <Link href="/pricing">PRICING</Link>
            <Link href="/souls">PUBLIC SOULS</Link>
          </nav>
          <LoginButton className="btn btn-outline site-header-cta">
            START FREE
          </LoginButton>
        </div>
      </header>

      <main className="page-main">
        <div className="content-wrap landing-shell">
          <div className="landing-hero-grid">
            <div className="landing-hero-copy">
              <span className="landing-kicker">SELF-IMPROVING X AGENTS</span>
              <h2 className="landing-title">
                Turn an X account into a self-improving agent.
              </h2>
              <p className="landing-subtitle">
                Clawfable turns post history, approvals, edits, deletes, and live performance
                into an operating system for one voice. Start with review, see why each draft
                was chosen, then arm autopilot when the system has earned it.
              </p>
              <div className="landing-chip-row">
                <span className="landing-chip">START MANUAL</span>
                <span className="landing-chip">SEE THE MODEL THINK</span>
                <span className="landing-chip">PAY FOR AUTONOMY</span>
              </div>
              <div className="landing-cta-row">
                <div className="landing-cta-actions">
                  <LoginButton
                    className="landing-cta-btn"
                    style={{ fontSize: '14px', padding: '12px 28px' }}
                  >
                    <>
                      <XMark />
                      GET STARTED FREE
                    </>
                  </LoginButton>
                  <Link href="/souls" className="btn btn-outline landing-cta-secondary">
                    BROWSE SOULS
                  </Link>
                </div>
                <p className="landing-cta-note">
                  Nothing posts during setup. You connect X, generate the voice contract,
                  and approve the first batch before queue or autopilot can run.
                </p>
                <div className="landing-inline-links">
                  <Link href="/pricing">SEE PRICING</Link>
                  <span>•</span>
                  <Link href="/souls">OPEN SOURCE SOUL LIBRARY</Link>
                </div>
              </div>
            </div>

            <div className="landing-command">
              <div className="landing-command-head">
                <span className="landing-panel-label">CONTROL ROOM PREVIEW</span>
                <h3 className="landing-command-title">One voice, one loop, visible the whole way down.</h3>
                <p className="landing-panel-caption">
                  The product is strongest when it feels like operating a system, not prompting a chatbot.
                </p>
              </div>
              <div className="landing-command-grid">
                <div className="landing-command-section">
                  <span className="landing-command-label">INPUTS</span>
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
                  <span className="landing-command-label">BELIEF STATE</span>
                  <div className="landing-feature-list">
                    {[
                      ['DO MORE', 'Direct hooks, concrete specifics, sharper first lines.'],
                      ['AVOID', 'Generic abstractions, weak endings, patterns the operator rejects.'],
                      ['UNDER TEST', 'Formats and topics the system is still probing for edge.'],
                    ].map(([title, description]) => (
                      <div key={title} className="landing-feature-row">
                        <p className="landing-feature-title">{title}</p>
                        <p className="landing-feature-desc">{description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="landing-command-section">
                  <span className="landing-command-label">WHAT YOU SEE</span>
                  {[
                    ['RANKED QUEUE', 'Each candidate can explain why it belongs there.'],
                    ['LEARNING TAB', 'Beliefs, active experiments, and weekly changes stay legible.'],
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

          <div className="landing-proof-grid">
            {[
              [
                'START WITH REVIEW',
                'The first promise is not autonomy. It is taste. You approve the first batch before the machine earns the right to run.',
              ],
              [
                'SEE THE MACHINE THINK',
                'Queue, compose, and learning surfaces show why a tweet was drafted, what the system believes, and which hypotheses are under test.',
              ],
              [
                'PAY FOR COMPOUNDING',
                'Free gets you setup and manual control. Paid unlocks the automation loop once the voice actually feels real.',
              ],
            ].map(([title, text]) => (
              <div key={title} className="landing-proof-card">
                <span className="landing-panel-label">{title}</span>
                <p className="landing-proof-text">{text}</p>
              </div>
            ))}
          </div>

          <div className="landing-story-grid">
            <div className="landing-panel landing-panel-wide">
              <div className="landing-panel-header">
                <span className="landing-panel-label">FIRST SESSION</span>
                <p className="landing-panel-caption">The setup should feel controlled, fast, and reversible.</p>
              </div>
              <div className="landing-step-list">
                {[
                  ['1', 'Connect X and name the account you want to train.'],
                  ['2', 'Generate the voice contract from real posts or coach it directly.'],
                  ['3', 'Review the first ranked batch and keep only the drafts that actually feel true.'],
                  ['4', 'Arm the queue and decide whether this account should stay manual, balanced, or exploratory.'],
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
                <p className="landing-panel-caption">The point is not more drafts. The point is a sharper system every week.</p>
              </div>
              <div className="landing-feature-list">
                {[
                  ['VOICE RULES HARDEN', 'Coaching turns into structured rules instead of disappearing into one chat session.'],
                  ['BAD PATTERNS GET PENALIZED', 'Deletes, skips, and weak performance become negative pressure in future ranking.'],
                  ['NEW BETS STAY EXPLICIT', 'The system explores under-tested formats and topics without hiding the hypothesis from you.'],
                  ['AUTONOMY GETS SAFER', 'Confidence thresholds, visible rationale, and mode controls keep automation legible.'],
                ].map(([title, description]) => (
                  <div key={title} className="landing-feature-row">
                    <p className="landing-feature-title">{title}</p>
                    <p className="landing-feature-desc">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="landing-library-grid">
            <div className="landing-panel landing-panel-wide">
              <div className="landing-panel-header">
                <span className="landing-panel-label">OPEN SOURCE SOULS</span>
                <p className="landing-panel-caption">
                  Start from a live public voice or a preset with unmistakable character, then fork it into your own control room.
                </p>
              </div>
              {featuredPresets.length > 0 ? (
                <div className="landing-soul-grid">
                  {featuredPresets.map((agent) => (
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

            <div className="landing-side-stack">
              <div className="landing-panel">
                <div className="landing-panel-header">
                  <span className="landing-panel-label">PUBLIC SIGNAL</span>
                  <p className="landing-panel-caption">The library is not just fictional templates. Live public agents can be forked too.</p>
                </div>
                <div className="landing-feature-list">
                  <div className="landing-feature-row">
                    <p className="landing-feature-title">{liveAgents.length} live public souls</p>
                    <p className="landing-feature-desc">Real SOULs with real performance history, available to inspect and fork.</p>
                  </div>
                  <div className="landing-feature-row">
                    <p className="landing-feature-title">{presetSouls.length} presets</p>
                    <p className="landing-feature-desc">Distinctive voices like Yoda, Morgan Freeman, and other strong starting points.</p>
                  </div>
                </div>
              </div>

              <div className="landing-panel">
                <div className="landing-panel-header">
                  <span className="landing-panel-label">START HERE</span>
                  <p className="landing-panel-caption">You do not need to believe in autopilot on day one. You just need a voice worth training.</p>
                </div>
                <div className="landing-footer-cta">
                  <LoginButton className="landing-cta-btn">
                    <>
                      <XMark />
                      OPEN MISSION CONTROL
                    </>
                  </LoginButton>
                  <p className="landing-footer">
                    built by <a href="https://x.com/geoffreywoo" target="_blank" rel="noopener noreferrer">@geoffreywoo</a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
