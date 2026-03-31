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

  // Loading state
  if (authLoading) {
    return (
      <div className="page-shell">
        <header className="site-header">
          <div className="site-header-brand">
            <Logo size={32} />
            <div className="site-header-text">
              <h1>CLAWFABLE</h1>
              <p>Give Your Agents a Soul</p>
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
              <p>Give Your Agents a Soul</p>
            </div>
          </div>
        </header>
        <main className="page-main">
          <div className="content-wrap" style={{ maxWidth: '600px', margin: '0 auto', padding: '80px 24px 48px' }}>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '32px',
              fontWeight: 700,
              color: 'var(--text)',
              lineHeight: 1.2,
              marginBottom: '16px',
            }}>
              Autonomous X agents that learn what works and iterate.
            </h2>
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: '15px',
              color: 'var(--text-muted)',
              lineHeight: 1.7,
              marginBottom: '32px',
            }}>
              Connect your X account. Define a voice with SOUL.md. Approve a preview batch.
              Autopilot takes over — posting, replying, tracking engagement, and self-improving
              based on what actually performs.
            </p>

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

            <div style={{
              marginTop: '64px',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '1px',
              background: 'var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {[
                ['SOUL.md', 'Voice contract generated from your tweet history or defined manually'],
                ['AUTOPILOT', 'Posts, replies, and queue refill run on a 10-min cron cycle'],
                ['SELF-IMPROVING', 'Tracks engagement, ranks formats, and feeds learnings back into generation'],
              ].map(([label, desc]) => (
                <div key={label} style={{
                  background: 'var(--surface)',
                  padding: '20px 16px',
                }}>
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    color: '#8b5cf6',
                    marginBottom: '6px',
                  }}>{label}</p>
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--text-dim)',
                    lineHeight: 1.6,
                  }}>{desc}</p>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '32px', textAlign: 'center' }}>
              <a
                href="/souls"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: '#8b5cf6',
                  textDecoration: 'none',
                  letterSpacing: '0.06em',
                }}
              >
                VIEW OPEN SOURCE SOULs
              </a>
            </div>

            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-dim)',
              textAlign: 'center',
              marginTop: '48px',
            }}>
              built by{' '}
              <a href="https://x.com/geoffreywoo" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>@geoffreywoo</a>
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
