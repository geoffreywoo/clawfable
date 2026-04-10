'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentCard } from './agent-card';
import { Logo } from './logo';
import { SetupWizard } from './setup-wizard';
import { LogoutButton } from './site-actions';
import type { AgentSummary, BillingSummary } from '@/lib/types';

interface AuthUser {
  id: string;
  username: string;
  name: string;
  billing: BillingSummary;
}

interface HomeMissionControlProps {
  initialUser: AuthUser;
  initialAgents: AgentSummary[];
}

export function HomeMissionControl({ initialUser, initialAgents }: HomeMissionControlProps) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [agents, setAgents] = useState(initialAgents);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [billingLoading, setBillingLoading] = useState<'checkout' | 'portal' | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const loadControlRoom = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setLoading(true);
      const res = await fetch('/api/control-room', { cache: 'no-store' });
      if (res.status === 401) {
        router.push('/');
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.user) setUser(data.user);
      if (Array.isArray(data.agents)) setAgents(data.agents);
    } catch {
      // ignore
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void loadControlRoom({ silent: true });
    };

    refreshTimerRef.current = window.setInterval(refreshIfVisible, 60000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
      }
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadControlRoom]);

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

  const billing = user.billing;
  const setupAgents = agents.filter((agent) => agent.setupStep && agent.setupStep !== 'ready');
  const liveCount = agents.filter((agent) => agent.isConnected === 1 && agent.setupStep === 'ready').length;
  const canCreateAgent = billing.canCreateAgent;
  const planStatusLabel = billing.grandfathered
    ? 'GRANDFATHERED ACCESS'
    : billing.plan === 'free'
      ? 'FREE'
      : `${billing.label.toUpperCase()} · ${billing.status.toUpperCase()}`;

  return (
    <div className="page-shell">
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
          <LogoutButton className="btn btn-ghost btn-sm" style={{ fontSize: '10px' }}>
            LOGOUT
          </LogoutButton>
        </div>
      </header>

      <main className="page-main">
        <div className="content-wrap">
          {!loading && agents.length === 0 && (
            <div className="home-brief home-brief-empty">
              <div className="home-brief-copy">
                <p className="home-brief-label">{billing.label.toUpperCase()} PLAN</p>
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
                  <div
                    style={{
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      borderRadius: 'var(--radius-lg)',
                      padding: '12px 14px',
                    }}
                  >
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
                    : billing.canUseAutopilot
                      ? 'Open any agent to inspect queue, learnings, and automation settings from one place.'
                      : 'Manual compose, queue review, and learning remain open. Upgrade when you want hands-off posting and reply automation.'}
                </p>
                {billing.grandfathered && (
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
                <div className="home-brief-metric">
                  <span className="home-brief-metric-value">{billing.agentsRemaining}</span>
                  <span className="home-brief-metric-label">AGENTS LEFT</span>
                </div>
                {setupAgents.length > 0 && (
                  <button className="btn btn-outline btn-sm" onClick={() => router.push(`/agent/${setupAgents[0].id}`)}>
                    CONTINUE SETUP
                  </button>
                )}
                {billing.checkoutReady && !billing.isPaid && (
                  <button className="btn btn-outline btn-sm" onClick={() => handleCheckout('pro')} disabled={billingLoading !== null}>
                    {billingLoading === 'checkout' ? 'LOADING...' : 'UPGRADE'}
                  </button>
                )}
                {billing.portalReady && billing.isPaid && (
                  <button className="btn btn-outline btn-sm" onClick={handleBillingPortal} disabled={billingLoading !== null}>
                    {billingLoading === 'portal' ? 'LOADING...' : 'MANAGE BILLING'}
                  </button>
                )}
              </div>
            </div>
          )}

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
                  {agents.length} configured · {billing.agentCount}/{billing.maxAgents} on {billing.label}
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="agent-grid">
              {[1, 2, 3].map((index) => (
                <div key={index} className="skeleton" style={{ height: '192px', borderRadius: '10px' }} />
              ))}
            </div>
          ) : (
            <div className="agent-grid">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}

              <div
                className="agent-card-new"
                onClick={() => {
                  if (canCreateAgent) {
                    setCreateOpen(true);
                  } else if (billing.checkoutReady) {
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
                      : billing.checkoutReady
                        ? 'Upgrade to add more agents and unlock automation'
                        : billing.grandfathered
                          ? `Grandfathered full access includes up to ${billing.maxAgents} agents`
                          : `Current plan allows ${billing.maxAgents} agent${billing.maxAgents === 1 ? '' : 's'}`}
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
          await loadControlRoom();
        }}
      />
    </div>
  );
}
