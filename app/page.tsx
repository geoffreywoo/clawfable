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
    const features = [
      {
        icon: (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="#8b5cf6" strokeWidth="1.5" />
            <path d="M8 4v4l3 2" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ),
        title: 'ANALYZE',
        desc: 'Study your posting history — top formats, peak hours, viral patterns, audience graph.',
      },
      {
        icon: (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <polygon points="2,2 14,8 2,14" fill="#8b5cf6" />
          </svg>
        ),
        title: 'GENERATE',
        desc: 'AI produces tweets weighted to your best-performing formats, topics, and voice.',
      },
      {
        icon: (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="#8b5cf6" strokeWidth="1.5" />
            <polyline points="5,8 7,10 11,6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
        title: 'AUTOMATE',
        desc: 'Set up recurring jobs, autopilot scheduling, and let your agents post on cadence.',
      },
    ];

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
          <div className="content-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '60px' }}>
            {/* Hero */}
            <div style={{ textAlign: 'center', maxWidth: '520px' }}>
              <Logo size={56} />
              <h2 style={{ fontFamily: 'var(--font-space)', fontSize: '22px', fontWeight: 700, letterSpacing: '0.04em', marginTop: '20px', color: 'var(--text)' }}>
                Your AI-powered Twitter fleet
              </h2>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px', lineHeight: '1.8', maxWidth: '420px', margin: '12px auto 0' }}>
                Create agents with unique voice profiles. Clawfable analyzes your account, learns what performs, and generates content that sounds like you — on autopilot.
              </p>
            </div>

            {/* Feature cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '40px', maxWidth: '560px', width: '100%' }}>
              {features.map((f) => (
                <div
                  key={f.title}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '16px 14px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>{f.icon}</div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', color: '#8b5cf6', marginBottom: '6px' }}>
                    {f.title}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                    {f.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* How it works */}
            <div style={{ marginTop: '36px', maxWidth: '420px', width: '100%' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--text-dim)', textAlign: 'center', marginBottom: '14px' }}>
                HOW IT WORKS
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  'Connect your X account via OAuth',
                  'Define your agent\'s voice with a SOUL.md',
                  'Run account analysis to find your winning patterns',
                  'Generate + schedule tweets that match your style',
                ].map((step, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, color: '#8b5cf6',
                      width: '20px', height: '20px', borderRadius: '50%',
                      border: '1px solid rgba(139,92,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {i + 1}
                    </span>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                      {step}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <button
              className="btn btn-primary btn-wide"
              onClick={handleLogin}
              disabled={loginLoading}
              style={{ marginTop: '32px', background: '#8b5cf6', height: '42px', fontSize: '12px', maxWidth: '280px' }}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" style={{ marginRight: '6px' }}>
                <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
              </svg>
              {loginLoading ? 'REDIRECTING...' : 'SIGN IN WITH X TO START'}
            </button>

            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', marginTop: '12px', marginBottom: '40px' }}>
              Free to use. Your API keys stay encrypted in your account.
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
