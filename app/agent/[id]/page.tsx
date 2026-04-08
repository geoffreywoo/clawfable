'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/app/components/logo';
import { ComposeTab } from '@/app/components/compose-tab';
import { QueueTab } from '@/app/components/queue-tab';
import { MentionsTab } from '@/app/components/mentions-tab';
import { AutopilotTab } from '@/app/components/autopilot-tab';
import { LearningTab } from '@/app/components/learning-tab';
import { MetricsTab } from '@/app/components/metrics-tab';
import { HealthAlerts } from '@/app/components/health-alerts';
import { SettingsTab } from '@/app/components/settings-tab';
import { SetupContinuation } from '@/app/components/setup-continuation';
import { SETUP_BANNER_CONTENT, isSetupIncomplete, normalizeSetupStep } from '@/lib/setup-state';
import type { AgentDetail, AgentSummary } from '@/lib/types';

const TABS = [
  { id: 'autopilot', label: 'AUTOPILOT', hasPulse: true },
  { id: 'learning', label: 'LEARNING', hasPulse: true },
  { id: 'queue', label: 'QUEUE' },
  { id: 'metrics', label: 'METRICS' },
  { id: 'mentions', label: 'MENTIONS' },
  { id: 'compose', label: 'COMPOSE' },
  { id: 'settings', label: 'SETTINGS' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function getAgentHue(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

export default function AgentDashboard() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('autopilot');
  const [showSetupContinuation, setShowSetupContinuation] = useState(false);
  const [otherAgents, setOtherAgents] = useState<AgentSummary[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  // Detect OAuth return — if ?oauth=success, agent just connected, show setup continuation
  useEffect(() => {
    if (searchParams.get('oauth') === 'success') {
      setShowSetupContinuation(true);
      // Clean the URL
      router.replace(`/agent/${agentId}`, { scroll: false });
    }
  }, [searchParams, agentId, router]);

  const loadAgent = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}`);
      if (res.status === 401) {
        router.push('/');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAgent(data);
    } catch {
      setAgent(null);
    } finally {
      setLoading(false);
    }
  }, [agentId, router]);

  useEffect(() => {
    loadAgent();
    const interval = setInterval(loadAgent, 30000);
    return () => clearInterval(interval);
  }, [loadAgent]);

  // Fetch other agents for the switcher
  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (Array.isArray(data)) {
          setOtherAgents(data.filter((a: AgentSummary) => a.id !== agentId));
        }
      })
      .catch(() => {});
  }, [agentId]);

  // Close switcher on outside click
  useEffect(() => {
    if (!switcherOpen) return;
    const handler = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [switcherOpen]);

  if (loading) {
    return (
      <div className="dashboard-shell">
        <div className="dashboard-header">
          <div className="flex items-center gap-3">
            <div className="skeleton" style={{ width: '32px', height: '32px', borderRadius: '8px' }} />
            <div className="skeleton" style={{ width: '160px', height: '16px', borderRadius: '4px' }} />
          </div>
        </div>
        <div className="dashboard-content">
          <div className="skeleton" style={{ height: '128px', borderRadius: '10px', marginBottom: '16px' }} />
          <div className="skeleton" style={{ height: '96px', borderRadius: '10px' }} />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="dashboard-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 48 48" width="48" height="48" fill="none" style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>
          <rect x="8" y="12" width="32" height="26" rx="4" stroke="currentColor" strokeWidth="2" />
          <circle cx="24" cy="25" r="5" stroke="currentColor" strokeWidth="2" />
        </svg>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Agent not found
        </p>
        <button className="back-btn" onClick={() => router.push('/')}>
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polyline points="7,2 3,6 7,10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Back to agents
        </button>
      </div>
    );
  }

  const isConnected = agent.isConnected === 1;
  const hue = getAgentHue(agent.name);
  const setupStep = normalizeSetupStep(agent.setupStep);
  const inSetup = isSetupIncomplete(setupStep);

  return (
    <div className="dashboard-shell">
      {/* Header */}
      <header className="dashboard-header">
        <div className="flex items-center gap-3">
          <button className="back-btn" onClick={() => router.push('/')} data-testid="button-back-to-agents">
            <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polyline points="7,2 3,6 7,10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ALL AGENTS
          </button>

          {/* Agent avatar */}
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: `hsla(${hue}, 60%, 22%, 0.5)`,
              border: `1px solid hsla(${hue}, 60%, 40%, 0.3)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              fontWeight: 700,
              color: `hsl(${hue}, 60%, 65%)`,
              flexShrink: 0,
            }}
          >
            {agent.name.charAt(0).toUpperCase()}
          </div>

          <div style={{ position: 'relative' }} ref={switcherRef}>
            <button
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: otherAgents.length > 0 ? 'pointer' : 'default',
                textAlign: 'left',
              }}
              onClick={() => otherAgents.length > 0 && setSwitcherOpen((v) => !v)}
              aria-haspopup={otherAgents.length > 0 ? 'listbox' : undefined}
              aria-expanded={switcherOpen}
            >
              <h1
                style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: '5px' }}
                data-testid="text-agent-name"
              >
                {agent.name.toUpperCase()}
                {otherAgents.length > 0 && (
                  <svg viewBox="0 0 10 6" width="9" height="6" fill="none" style={{ marginTop: '1px', opacity: 0.5 }}>
                    <polyline points="1,1 5,5 9,1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </h1>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
                Agent Dashboard{otherAgents.length > 0 ? ` · ${otherAgents.length + 1} agents` : ''}
              </p>
            </button>

            {switcherOpen && (
              <div
                role="listbox"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  background: '#1a1a1a',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  minWidth: '180px',
                  zIndex: 50,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
                  overflow: 'hidden',
                }}
              >
                {otherAgents.map((a) => {
                  const h = getAgentHue(a.name);
                  return (
                    <button
                      key={a.id}
                      role="option"
                      onClick={() => { setSwitcherOpen(false); router.push(`/agent/${a.id}`); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 12px',
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#222')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{
                        width: '22px', height: '22px', borderRadius: '5px', flexShrink: 0,
                        background: `hsla(${h}, 60%, 22%, 0.5)`,
                        border: `1px solid hsla(${h}, 60%, 40%, 0.3)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
                        color: `hsl(${h}, 60%, 65%)`,
                      }}>
                        {a.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {a.name}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)' }}>
                          @{a.handle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="status-dot">
            <div className={`status-dot-indicator ${inSetup ? 'setup' : isConnected ? 'live' : 'offline'}`} />
            <span
              className={`status-label ${inSetup ? 'setup' : isConnected ? 'live' : 'offline'}`}
              style={{ letterSpacing: '0.1em' }}
            >
              {inSetup ? 'SETUP' : isConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}
            data-testid="text-handle"
          >
            @{agent.handle}
          </span>
        </div>
      </header>

      {/* Setup banner for incomplete agents */}
      {inSetup && SETUP_BANNER_CONTENT[setupStep] && (
        <div style={{
          padding: '12px 24px',
          background: 'rgba(245, 158, 11, 0.08)',
          borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M8 2L14 14H2L8 2z" stroke="#f59e0b" strokeWidth="1.3" strokeLinejoin="round" />
              <line x1="8" y1="7" x2="8" y2="10" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="8" cy="12" r="0.5" fill="#f59e0b" />
            </svg>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: '#f59e0b', letterSpacing: '0.08em' }}>
                SETUP INCOMPLETE: {SETUP_BANNER_CONTENT[setupStep].title}
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {SETUP_BANNER_CONTENT[setupStep].desc}
              </p>
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setShowSetupContinuation(true)}>
            CONTINUE SETUP
          </button>
        </div>
      )}

      {/* Health alerts */}
      {!inSetup && <HealthAlerts agentId={agentId} onNavigateTab={(tab) => setActiveTab(tab as TabId)} />}

      {/* Tab nav */}
      <nav className="dashboard-nav">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`tab-btn ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`button-tab-${tab.id}`}
            >
              {tab.label}
              {'hasPulse' in tab && tab.hasPulse && (
                <span className="tab-pulse pulse-dot" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <main className="dashboard-content">
        {activeTab === 'compose' && <ComposeTab agentId={agentId} />}
        {activeTab === 'queue' && <QueueTab agentId={agentId} />}
        {activeTab === 'mentions' && <MentionsTab agentId={agentId} />}
        {activeTab === 'learning' && <LearningTab agentId={agentId} />}
        {activeTab === 'metrics' && <MetricsTab agentId={agentId} />}
        {activeTab === 'autopilot' && <AutopilotTab agentId={agentId} />}
        {activeTab === 'settings' && (
          <SettingsTab
            agentId={agentId}
            agent={agent}
            onAgentDeleted={() => router.push('/')}
            onAgentUpdated={loadAgent}
          />
        )}
      </main>

      {/* Setup continuation after OAuth return */}
      {showSetupContinuation && agent && (
        <SetupContinuation
          agentId={agentId}
          agent={agent}
          onComplete={() => {
            setShowSetupContinuation(false);
            loadAgent();
          }}
          onClose={() => setShowSetupContinuation(false)}
        />
      )}
    </div>
  );
}
