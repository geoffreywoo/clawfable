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
  const [liveAgents, setLiveAgents] = useState<Array<{ handle: string; name: string; soulSummary: string | null; totalTracked: number; avgLikes: number }>>([]);

  // Check auth on mount + fetch public agents for landing
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
    // Fetch live agents for landing page
    fetch('/api/public/souls')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (Array.isArray(data)) setLiveAgents(data); })
      .catch(() => {});
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
              <p>Grow Your X on Autopilot</p>
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
              <p>Grow Your X on Autopilot</p>
            </div>
          </div>
        </header>
        <main className="page-main">
          <div className="content-wrap" style={{ maxWidth: '560px', margin: '0 auto', padding: '60px 24px 48px' }}>
            {/* Hero */}
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '36px',
              fontWeight: 700,
              color: 'var(--text)',
              lineHeight: 1.15,
              marginBottom: '20px',
              textAlign: 'center',
            }}>
              Your X account,<br />
              posting while you sleep.
            </h2>
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: '16px',
              color: 'var(--text-muted)',
              lineHeight: 1.7,
              marginBottom: '36px',
              textAlign: 'center',
            }}>
              Clawfable learns your voice, posts in your style, replies to mentions,
              and gets smarter every day based on what actually gets engagement.
            </p>

            {/* CTA */}
            <div style={{ textAlign: 'center', marginBottom: '48px' }}>
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
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', marginTop: '10px' }}>
                Connect your X account. Takes 3 minutes to set up.
              </p>
            </div>

            {/* How it works */}
            <div style={{ marginBottom: '48px' }}>
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: 'var(--text-muted)',
                textAlign: 'center',
                marginBottom: '20px',
              }}>HOW IT WORKS</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {[
                  ['1', 'Connect your X account', 'One-click OAuth. Your credentials stay encrypted.'],
                  ['2', 'We learn your voice', 'AI analyzes your best tweets to capture your tone, style, and topics.'],
                  ['3', 'Review and launch', 'Approve a batch of sample tweets. If they sound like you, turn on autopilot.'],
                  ['4', 'It gets smarter every day', 'Tracks what gets likes and replies, then writes more of what works.'],
                ].map(([num, title, desc]) => (
                  <div key={num} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '50%',
                      background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: '#8b5cf6',
                      flexShrink: 0,
                    }}>{num}</div>
                    <div>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>{title}</p>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.5, marginTop: '2px' }}>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Benefits */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              marginBottom: '48px',
            }}>
              {[
                ['Posts for you 24/7', 'Never miss a day. Your account stays active while you focus on building.'],
                ['Replies automatically', 'Responds to mentions in your voice. Handles trolls with humor.'],
                ['Learns what works', 'Tracks every tweet. Doubles down on what gets engagement.'],
                ['Sounds like you', 'Not generic AI slop. Trained on YOUR writing style and opinions.'],
              ].map(([title, desc]) => (
                <div key={title} style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '16px',
                }}>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>{title}</p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.5 }}>{desc}</p>
                </div>
              ))}
            </div>

            {/* Live Agents as social proof */}
            {liveAgents.length > 0 && (
              <div style={{ marginBottom: '32px' }}>
                <p style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: 'var(--text-muted)',
                  marginBottom: '12px',
                  textAlign: 'center',
                }}>
                  AGENTS RUNNING RIGHT NOW
                </p>
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                }}>
                  {liveAgents.map((a) => (
                    <a
                      key={a.handle}
                      href={`/souls/${a.handle}`}
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '20px',
                        padding: '6px 14px',
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#8b5cf6' }}>@{a.handle}</span>
                      {a.totalTracked > 0 && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>
                          {a.totalTracked} tweets
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom CTA */}
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <button
                className="landing-cta-btn"
                onClick={handleLogin}
                disabled={loginLoading}
              >
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none">
                  <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
                </svg>
                {loginLoading ? 'REDIRECTING...' : 'START GROWING YOUR X'}
              </button>
            </div>

            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-dim)',
              textAlign: 'center',
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
