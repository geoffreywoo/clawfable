'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from './components/logo';
import { AgentCard } from './components/agent-card';
import { SetupWizard } from './components/setup-wizard';
import type { AgentSummary, BillingSummary } from '@/lib/types';

interface AuthUser {
  id: string;
  username: string;
  name: string;
  billing: BillingSummary;
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [billingLoading, setBillingLoading] = useState<'checkout' | 'portal' | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [liveAgents, setLiveAgents] = useState<Array<{ handle: string; name: string; soulSummary: string | null; totalTracked: number; avgLikes: number }>>([]);

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

  // Check auth on mount + fetch public agents for landing
  useEffect(() => {
    loadCurrentUser();
    // Fetch live agents for landing page
    fetch('/api/public/souls')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (Array.isArray(data)) setLiveAgents(data); })
      .catch(() => {});
  }, [loadCurrentUser]);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Load agents when logged in
  useEffect(() => {
    if (user) {
      setLoading(true);
      loadAgents();
    } else {
      setLoading(false);
    }
  }, [user, loadAgents]);

  // Poll every 30 seconds
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(loadAgents, 30000);
    return () => clearInterval(interval);
  }, [user, loadAgents]);

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

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setAgents([]);
  };

  const handleCheckout = async (plan: 'pro' | 'scale' = 'pro') => {
    setBillingLoading('checkout');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start Stripe Checkout');
      window.location.href = data.url;
    } catch {
      setBillingLoading(null);
    }
  };

  const handleBillingPortal = async () => {
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

  const setupAgents = agents.filter((agent) => agent.setupStep && agent.setupStep !== 'ready');
  const liveCount = agents.filter((agent) => agent.isConnected === 1 && agent.setupStep === 'ready').length;
  const billing = user?.billing ?? null;
  const canCreateAgent = billing?.canCreateAgent ?? true;
  const planStatusLabel = billing
    ? billing.grandfathered
      ? 'GRANDFATHERED ACCESS'
      : billing.plan === 'free'
      ? 'FREE'
      : `${billing.label.toUpperCase()} · ${billing.status.toUpperCase()}`
    : 'FREE';

  // Loading state
  if (authLoading) {
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
          <div className="content-wrap" style={{ display: 'flex', justifyContent: 'center', paddingTop: '80px' }}>
            <div className="wizard-spinner" />
          </div>
        </main>
      </div>
    );
  }

  // Not logged in — show intro + login
  if (!user) {
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
                  <button
                    className="landing-cta-btn"
                    onClick={handleLogin}
                    disabled={loginLoading}
                    style={{ fontSize: '14px', padding: '12px 32px' }}
                  >
                    <svg viewBox="0 0 16 16" width="15" height="15" fill="none">
                      <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
                    </svg>
                    {loginLoading ? 'REDIRECTING...' : 'GET STARTED FREE'}
                  </button>
                  <Link href="/pricing" className="btn btn-outline landing-cta-secondary">
                    SEE PRICING
                  </Link>
                  <p className="landing-cta-note">
                    Connect your X account, draft the voice contract, and review the first tweet batch.
                    Nothing goes live during setup.
                  </p>
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
                    {liveAgents.slice(0, 5).map((a) => (
                      <a
                        key={a.handle}
                        href={`/souls/${a.handle}`}
                        className="landing-feature-row"
                        style={{ textDecoration: 'none', display: 'block' }}
                      >
                        <p className="landing-feature-title" style={{ color: 'var(--text)' }}>@{a.handle}</p>
                        <p className="landing-feature-desc">
                          {a.soulSummary || 'Public SOUL available'}{a.totalTracked > 0 ? ` · ${a.totalTracked} tracked tweets` : ''}
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
              <button
                className="landing-cta-btn"
                onClick={handleLogin}
                disabled={loginLoading}
              >
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none">
                  <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
                </svg>
                {loginLoading ? 'REDIRECTING...' : 'OPEN MISSION CONTROL'}
              </button>
              <p className="landing-footer">
                built by <a href="https://x.com/geoffreywoo" target="_blank" rel="noopener noreferrer">@geoffreywoo</a>
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Logged in — show agent grid
  return (
    <div className="page-shell">
      {/* Header */}
      <header className="site-header">
          <div className="site-header-brand">
            <Logo size={32} />
            <div className="site-header-text">
              <h1>CLAWFABLE</h1>
              <p>Mission Control</p>
            </div>
          </div>
        <div className="site-header-right">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
            @{user.username}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleLogout}
            style={{ fontSize: '10px' }}
          >
            LOGOUT
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="page-main">
        <div className="content-wrap">
          {!loading && agents.length === 0 && (
            <div className="home-brief home-brief-empty">
              <div className="home-brief-copy">
                <p className="home-brief-label">{billing?.label.toUpperCase() || 'FREE'} PLAN</p>
                <h2 className="home-brief-title">Your first agent takes about five minutes.</h2>
                <p className="home-brief-body">
                  Create the agent shell, connect X, draft the voice contract, review the first tweet batch,
                  and only then decide whether you want manual control or paid automation. The setup is designed to build trust before speed.
                </p>
              </div>
              <div className="home-brief-side">
                {[
                  'Name the account and connect X.',
                  'Generate or define the voice contract.',
                  'Approve the first batch before anything can post.',
                ].map((item, index) => (
                  <div key={item} className="home-brief-step">
                    <span className="home-brief-step-num">0{index + 1}</span>
                    <span className="home-brief-step-copy">{item}</span>
                  </div>
                ))}
                <div style={{ display: 'grid', gap: '10px' }}>
                  <button
                    className="btn btn-primary btn-wide"
                    style={{ background: '#8b5cf6' }}
                    onClick={() => setCreateOpen(true)}
                  >
                    CREATE FIRST AGENT
                  </button>
                  {billing && (
                    <div style={{
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      borderRadius: 'var(--radius-lg)',
                      padding: '12px 14px',
                    }}>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                        PLAN CAPACITY
                      </p>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text)', marginTop: '6px', lineHeight: 1.6 }}>
                        {billing.grandfathered
                          ? `This account has grandfathered full access with up to ${billing.maxAgents} agents and the automation layer unlocked.`
                          : `${billing.maxAgents} agent${billing.maxAgents === 1 ? '' : 's'} on ${billing.label}. Paid plans unlock the automation loop.`}
                      </p>
                      {billing.checkoutReady && !billing.isPaid && (
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ marginTop: '10px' }}
                          onClick={() => handleCheckout('pro')}
                          disabled={billingLoading !== null}
                        >
                          {billingLoading === 'checkout' ? 'LOADING...' : 'UNLOCK AUTOPILOT'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!loading && agents.length > 0 && (
            <div className="home-brief">
              <div className="home-brief-copy">
                <p className="home-brief-label">FLEET STATUS · {planStatusLabel}</p>
                <h2 className="home-brief-title">
                  {setupAgents.length > 0
                    ? 'You are still in calibration.'
                    : 'Your control room is live.'}
                </h2>
                <p className="home-brief-body">
                  {setupAgents.length > 0
                    ? `${setupAgents.length} agent${setupAgents.length === 1 ? '' : 's'} still need setup review before they can run with confidence.`
                    : billing?.canUseAutopilot
                      ? 'Open any agent to inspect queue, learnings, and automation settings from one place.'
                      : 'Manual compose, queue review, and learning remain open. Upgrade when you want hands-off posting and reply automation.'}
                </p>
                {billing?.grandfathered && (
                  <p className="home-brief-body" style={{ marginTop: '10px' }}>
                    This login is grandfathered for full access, so billing limits will not block agent creation or automation for your own accounts.
                  </p>
                )}
              </div>
              <div className="home-brief-metrics">
                <div className="home-brief-metric">
                  <span className="home-brief-metric-value">{agents.length}</span>
                  <span className="home-brief-metric-label">TOTAL AGENTS</span>
                </div>
                <div className="home-brief-metric">
                  <span className="home-brief-metric-value">{liveCount}</span>
                  <span className="home-brief-metric-label">LIVE</span>
                </div>
                <div className="home-brief-metric">
                  <span className="home-brief-metric-value">{setupAgents.length}</span>
                  <span className="home-brief-metric-label">IN SETUP</span>
                </div>
                {billing && (
                  <div className="home-brief-metric">
                    <span className="home-brief-metric-value">{billing.agentsRemaining}</span>
                    <span className="home-brief-metric-label">AGENTS LEFT</span>
                  </div>
                )}
                {setupAgents.length > 0 && (
                  <button className="btn btn-outline btn-sm" onClick={() => router.push(`/agent/${setupAgents[0].id}`)}>
                    CONTINUE SETUP
                  </button>
                )}
                {billing?.checkoutReady && !billing.isPaid && (
                  <button className="btn btn-outline btn-sm" onClick={() => handleCheckout('pro')} disabled={billingLoading !== null}>
                    {billingLoading === 'checkout' ? 'LOADING...' : 'UPGRADE'}
                  </button>
                )}
                {billing?.portalReady && billing.isPaid && (
                  <button className="btn btn-outline btn-sm" onClick={handleBillingPortal} disabled={billingLoading !== null}>
                    {billingLoading === 'portal' ? 'LOADING...' : 'MANAGE BILLING'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Section header */}
          <div className="section-header mb-6">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" style={{ flexShrink: 0 }}>
                <rect x="1" y="4" width="14" height="8" rx="2" stroke="#8b5cf6" strokeWidth="1.5" />
                <circle cx="5" cy="8" r="1.5" fill="#8b5cf6" />
                <line x1="9" y1="8" x2="13" y2="8" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <h2>AGENTS</h2>
              {!loading && (
                <span className="section-count">
                  {agents.length} configured{billing ? ` · ${billing.agentCount}/${billing.maxAgents} on ${billing.label}` : ''}
                </span>
              )}
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="agent-grid">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="skeleton"
                  style={{ height: '192px', borderRadius: '10px' }}
                />
              ))}
            </div>
          ) : (
            <div className="agent-grid">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}

              {/* New agent card */}
              <div
                className="agent-card-new"
                onClick={() => {
                  if (canCreateAgent) {
                    setCreateOpen(true);
                  } else if (billing?.checkoutReady) {
                    void handleCheckout('pro');
                  }
                }}
                data-testid="card-new-agent"
                style={canCreateAgent ? undefined : { opacity: 0.85 }}
              >
                <div className="plus-ring">
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="none">
                    <line x1="8" y1="3" x2="8" y2="13" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="3" y1="8" x2="13" y2="8" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--text)',
                    }}
                  >
                    {canCreateAgent
                      ? agents.length === 0 ? 'CREATE FIRST AGENT' : 'NEW AGENT'
                      : 'AGENT LIMIT REACHED'}
                  </p>
                  <p
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      marginTop: '4px',
                    }}
                  >
                    {canCreateAgent
                      ? agents.length === 0
                        ? 'Name it, connect X, review the first batch'
                        : 'Spin up another voice and connect X'
                      : billing?.checkoutReady
                        ? 'Upgrade to add more agents and unlock automation'
                        : billing?.grandfathered
                          ? `Grandfathered full access includes up to ${billing?.maxAgents ?? 25} agents`
                          : `Current plan allows ${billing?.maxAgents ?? 1} agent${billing?.maxAgents === 1 ? '' : 's'}`}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <SetupWizard
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          await Promise.all([loadAgents(), loadCurrentUser()]);
        }}
      />
    </div>
  );
}
