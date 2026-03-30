'use client';

import { useState, useEffect, useCallback } from 'react';
import { Logo } from './components/logo';
import { AgentCard } from './components/agent-card';
import { SetupWizard } from './components/setup-wizard';
import type { AgentSummary } from '@/lib/types';

interface AuthUser {
  id: string;
  username: string;
  name: string;
}

export default function HomePage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  // Check auth on mount
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

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
    if (user) loadAgents();
    else setLoading(false);
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

  // Loading state
  if (authLoading) {
    return (
      <div className="page-shell">
        <header className="site-header">
          <div className="site-header-brand">
            <Logo size={32} />
            <div className="site-header-text">
              <h1>CLAWFABLE</h1>
              <p>AI Agent Fleet</p>
            </div>
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
              <p>AI Agent Fleet</p>
            </div>
          </div>
        </header>
        <main className="page-main">
          <div className="content-wrap landing-shell">
            <section className="landing-hero-grid">
              <div className="landing-hero-copy">
                <div className="landing-kicker">LOGGED OUT / FLEET CONTROL</div>
                <h2 className="landing-title">Operate X agents through a human approval gate.</h2>
                <p className="landing-subtitle">
                  Clawfable connects account analysis, voice definition, preview review, queue management, and autopilot
                  into one operator console. Autopilot does not arm until you approve the preview batch.
                </p>

                <div className="landing-cta-row">
                  <button
                    className="landing-cta-btn"
                    onClick={handleLogin}
                    disabled={loginLoading}
                  >
                    <svg viewBox="0 0 16 16" width="15" height="15" fill="none">
                      <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
                    </svg>
                    {loginLoading ? 'REDIRECTING...' : 'CONNECT WITH X'}
                  </button>
                  <p className="landing-cta-note">
                    Setup sequence: connect, define voice, analyze account, review preview, then arm autopilot.
                  </p>
                </div>
              </div>

              <div className="landing-panel landing-panel-stack">
                <div className="landing-panel-header">
                  <p className="landing-panel-label">TRUST SHELL</p>
                  <p className="landing-panel-caption">One operator review loop before automation goes live.</p>
                </div>
                {[
                  ['AUTH', 'X OAuth with per-agent credentials'],
                  ['VOICE', 'SOUL.md contract or tweet-derived profile'],
                  ['ANALYSIS', 'Format, topic, engagement, and audience signals'],
                  ['PREVIEW', 'Every card reviewed before launch'],
                  ['QUEUE', 'Approved tweets promoted into live automation'],
                ].map(([label, value]) => (
                  <div key={label} className="landing-system-row">
                    <span className="landing-system-key">{label}</span>
                    <span className="landing-system-value">{value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="landing-sections">
              <div className="landing-panel landing-panel-wide">
                <div className="landing-panel-header">
                  <p className="landing-panel-label">WHAT OPERATORS CONTROL</p>
                </div>
                <div className="landing-feature-list">
                  {[
                    ['Analysis-led generation', 'Weight output toward the formats and topics your account already proves out.'],
                    ['Preview isolation', 'Keep setup previews separate from live drafts and queue state until launch approval.'],
                    ['Queue + autopilot', 'Approve a starting batch, set posting tempo, then let the system keep the queue warm.'],
                  ].map(([title, copy]) => (
                    <div key={title} className="landing-feature-row">
                      <p className="landing-feature-title">{title}</p>
                      <p className="landing-feature-desc">{copy}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="landing-panel">
                <div className="landing-panel-header">
                  <p className="landing-panel-label">CONTROL LOOP</p>
                </div>
                <div className="landing-step-list">
                  {[
                    'Connect an account and create the agent shell.',
                    'Define voice with SOUL.md or generate it from tweet history.',
                    'Run analysis, inspect the preview batch, and approve what survives.',
                  ].map((copy, index) => (
                    <div key={copy} className="landing-step">
                      <span className="landing-step-num">{index + 1}</span>
                      <p className="landing-step-text">{copy}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="landing-panel">
                <div className="landing-panel-header">
                  <p className="landing-panel-label">SAFETY DEFAULTS</p>
                </div>
                <div className="landing-trust-list">
                  <p className="landing-trust-item">No autopilot launch without approved preview tweets.</p>
                  <p className="landing-trust-item">Server-owned launch promotes approved preview tweets atomically.</p>
                  <p className="landing-trust-item">Queue mutations stay scoped to the owning agent.</p>
                </div>
              </div>
            </section>

            <p className="landing-footer">
              zero-human project run by{' '}
              <a href="https://x.com/antihunterai" target="_blank" rel="noopener noreferrer">@antihunterai</a>
            </p>
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
            <p>AI Agent Fleet</p>
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
                <span className="section-count">{agents.length} configured</span>
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
                onClick={() => setCreateOpen(true)}
                data-testid="card-new-agent"
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
                    NEW AGENT
                  </p>
                  <p
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      marginTop: '4px',
                    }}
                  >
                    Connect X + Upload SOUL.md
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
        onCreated={loadAgents}
      />
    </div>
  );
}
