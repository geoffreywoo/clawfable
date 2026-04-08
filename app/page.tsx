import Link from 'next/link';
import { HomeMissionControl } from './components/home-mission-control';
import { LoginButton } from './components/site-actions';
import { Logo } from './components/logo';
import { getCurrentUser } from '@/lib/auth';
import { getBillingSummary } from '@/lib/billing';
import { getAgentSummariesForUser, getPublicSoulSummaries } from '@/lib/dashboard-data';

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    const agents = await getAgentSummariesForUser(user.id);
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

  const liveAgents = await getPublicSoulSummaries();

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
        </div>
      </header>

      <main className="page-main">
        <div className="content-wrap landing-shell">
          <div className="landing-hero-grid">
            <div className="landing-hero-copy">
              <span className="landing-kicker">SELF-IMPROVING X AGENTS</span>
              <h2 className="landing-title">
                Train an X agent on your voice.
                Approve the first batch.
                Then let it compound.
              </h2>
              <p className="landing-subtitle">
                Clawfable analyzes what already works on your account, drafts in your style,
                shows why each tweet was chosen, and keeps learning from approvals, edits,
                deletes, and live performance.
              </p>
              <div className="landing-cta-row">
                <LoginButton
                  className="landing-cta-btn"
                  style={{ fontSize: '14px', padding: '12px 32px' }}
                >
                  <>
                    <svg viewBox="0 0 16 16" width="15" height="15" fill="none">
                      <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
                    </svg>
                    GET STARTED FREE
                  </>
                </LoginButton>
                <Link href="/pricing" className="btn btn-outline landing-cta-secondary">
                  SEE PRICING
                </Link>
                <p className="landing-cta-note">
                  Connect your X account, draft the voice contract, and review the first tweet batch.
                  Nothing goes live during setup.
                </p>
              </div>
            </div>

            <div className="landing-panel-stack">
              <div className="landing-panel">
                <div className="landing-panel-header">
                  <span className="landing-panel-label">SYSTEM MODEL</span>
                  <p className="landing-panel-caption">A feedback loop, not a one-shot generator.</p>
                </div>
                <div className="landing-feature-list">
                  {[
                    ['VOICE CONTRACT', 'Extracted from your posts or coached manually.'],
                    ['LEARNING LOOP', 'Approvals, edits, deletes, and performance become future priors.'],
                    ['DECISION VISIBILITY', 'Every candidate can explain why it was chosen.'],
                    ['AUTOPILOT MODES', 'Safe, balanced, and explore let you choose the risk profile.'],
                  ].map(([title, description]) => (
                    <div key={title} className="landing-feature-row">
                      <p className="landing-feature-title">{title}</p>
                      <p className="landing-feature-desc">{description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="landing-panel landing-panel-stack landing-panel-wide">
                <div className="landing-panel-header">
                  <span className="landing-panel-label">WHY IT FEELS DIFFERENT</span>
                  <p className="landing-panel-caption">
                    Clawfable is not just a tweet generator. It is an operating system for a voice that gets sharper with use.
                  </p>
                </div>
                {[
                  ['YOU APPROVE THE FIRST BATCH', 'The product starts with review, not blind automation.'],
                  ['EVERY SIGNAL TEACHES THE SYSTEM', 'Approvals, edits, deletes, and live performance all update future drafts.'],
                  ['EVERY TWEET IS EXPLAINABLE', 'See why a candidate was chosen before it enters queue or goes live.'],
                  ['ONE PLACE TO SEE THE LEARNING', 'The learning control room shows what changed, what is under test, and what to avoid.'],
                ].map(([key, value]) => (
                  <div key={key} className="landing-system-row">
                    <span className="landing-system-key">{key}</span>
                    <span className="landing-system-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="landing-sections">
            <div className="landing-panel landing-panel-wide">
              <div className="landing-panel-header">
                <span className="landing-panel-label">FIRST SESSION</span>
                <p className="landing-panel-caption">Most users can get to a reviewable first batch in about five minutes.</p>
              </div>
              <div className="landing-step-list">
                {[
                  ['1', 'Name the agent and connect X.'],
                  ['2', 'Generate the voice contract from real posts or define it manually.'],
                  ['3', 'Analyze what already performs on the account.'],
                  ['4', 'Approve the tweets that feel true and arm the queue.'],
                ].map(([num, text]) => (
                  <div key={num} className="landing-step">
                    <div className="landing-step-num">{num}</div>
                    <div className="landing-step-text">{text}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="landing-panel">
              <div className="landing-panel-header">
                <span className="landing-panel-label">WHAT YOU CONTROL</span>
                <p className="landing-panel-caption">The system automates execution, not judgment.</p>
              </div>
              <div className="landing-trust-list">
                {[
                  'You decide the voice contract and can coach it directly.',
                  'You review the first batch before anything is queued to post.',
                  'Safe, balanced, and explore modes let you choose how aggressive learning should be.',
                ].map((item) => (
                  <div key={item} className="landing-trust-item">{item}</div>
                ))}
              </div>
            </div>

            <div className="landing-panel">
              <div className="landing-panel-header">
                <span className="landing-panel-label">PUBLIC AGENTS</span>
                <p className="landing-panel-caption">Peek at real voice contracts already running through Clawfable.</p>
              </div>
              {liveAgents.length > 0 ? (
                <div className="landing-feature-list">
                  {liveAgents.slice(0, 5).map((agent) => (
                    <a
                      key={agent.handle}
                      href={`/souls/${agent.handle}`}
                      className="landing-feature-row"
                      style={{ textDecoration: 'none', display: 'block' }}
                    >
                      <p className="landing-feature-title" style={{ color: 'var(--text)' }}>@{agent.handle}</p>
                      <p className="landing-feature-desc">
                        {agent.soulSummary || 'Public SOUL available'}
                        {agent.totalTracked > 0 ? ` · ${agent.totalTracked} tracked tweets` : ''}
                      </p>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="landing-trust-list">
                  <div className="landing-trust-item">Public SOULs appear here once agents are live.</div>
                </div>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: '32px' }}>
            <LoginButton className="landing-cta-btn">
              <>
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none">
                  <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
                </svg>
                OPEN MISSION CONTROL
              </>
            </LoginButton>
            <p className="landing-footer">
              built by <a href="https://x.com/geoffreywoo" target="_blank" rel="noopener noreferrer">@geoffreywoo</a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
