'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HealthAlerts } from '@/app/components/health-alerts';
import { CONTROL_ROOM_PATH } from '@/lib/app-routes';
import { SETUP_BANNER_CONTENT, isSetupIncomplete, normalizeSetupStep } from '@/lib/setup-state';
import type { BillingSummary, AgentDetail, AgentSummary, Metric, PostLogEntry, ProtocolSettings } from '@/lib/types';

const ComposeTab = dynamic(() => import('@/app/components/compose-tab').then((mod) => mod.ComposeTab), {
  loading: () => <TabSkeleton />,
});
const QueueTab = dynamic(() => import('@/app/components/queue-tab').then((mod) => mod.QueueTab), {
  loading: () => <TabSkeleton />,
});
const MentionsTab = dynamic(() => import('@/app/components/mentions-tab').then((mod) => mod.MentionsTab), {
  loading: () => <TabSkeleton />,
});
const AutopilotTab = dynamic(() => import('@/app/components/autopilot-tab').then((mod) => mod.AutopilotTab), {
  loading: () => <TabSkeleton />,
});
const LearningTab = dynamic(() => import('@/app/components/learning-tab').then((mod) => mod.LearningTab), {
  loading: () => <TabSkeleton />,
});
const MetricsTab = dynamic(() => import('@/app/components/metrics-tab').then((mod) => mod.MetricsTab), {
  loading: () => <TabSkeleton />,
});
const SettingsTab = dynamic(() => import('@/app/components/settings-tab').then((mod) => mod.SettingsTab), {
  loading: () => <TabSkeleton />,
});
const SetupContinuation = dynamic(() => import('@/app/components/setup-continuation').then((mod) => mod.SetupContinuation), {
  ssr: false,
});

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

interface AutopilotInitialData {
  agentConnected: boolean;
  agentHandle: string;
  settings: ProtocolSettings;
  billing: BillingSummary;
  postLog: PostLogEntry[];
  metrics: Metric[];
}

interface AgentDashboardClientProps {
  agentId: string;
  initialAgent: AgentDetail;
  initialOtherAgents: AgentSummary[];
  initialAutopilotData: AutopilotInitialData;
  shouldOpenSetupContinuation: boolean;
}

interface DashboardShellPayload {
  agent?: AgentDetail;
  otherAgents?: AgentSummary[];
}

function TabSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((index) => (
        <div key={index} className="skeleton" style={{ height: '96px', borderRadius: '10px' }} />
      ))}
    </div>
  );
}

function getAgentHue(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

export function AgentDashboardClient({
  agentId,
  initialAgent,
  initialOtherAgents,
  initialAutopilotData,
  shouldOpenSetupContinuation,
}: AgentDashboardClientProps) {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentDetail | null>(initialAgent);
  const [activeTab, setActiveTab] = useState<TabId>('autopilot');
  const [showSetupContinuation, setShowSetupContinuation] = useState(shouldOpenSetupContinuation);
  const [otherAgents, setOtherAgents] = useState(initialOtherAgents);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const loadDashboardShell = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/dashboard?sections=agent,otherAgents`, { cache: 'no-store' });
      if (res.status === 401) {
        router.push(CONTROL_ROOM_PATH);
        return;
      }
      const data: DashboardShellPayload = await res.json();
      if (!res.ok) throw new Error('Failed to refresh dashboard');
      if (data.agent) setAgent(data.agent);
      if (Array.isArray(data.otherAgents)) setOtherAgents(data.otherAgents);
    } catch {
      // Keep last good state.
    }
  }, [agentId, router]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void loadDashboardShell();
    };

    const interval = window.setInterval(refreshIfVisible, 60000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadDashboardShell]);

  useEffect(() => {
    if (!switcherOpen) return;
    const handler = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [switcherOpen]);

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
        <button className="back-btn" onClick={() => router.push(CONTROL_ROOM_PATH)}>
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
      <header className="dashboard-header">
        <div className="flex items-center gap-3">
          <button className="back-btn" onClick={() => router.push(CONTROL_ROOM_PATH)} data-testid="button-back-to-agents">
            <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polyline points="7,2 3,6 7,10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ALL AGENTS
          </button>

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
              onClick={() => otherAgents.length > 0 && setSwitcherOpen((value) => !value)}
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
                Control room{otherAgents.length > 0 ? ` · ${otherAgents.length + 1} agents` : ''}
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
                {otherAgents.map((otherAgent) => {
                  const otherHue = getAgentHue(otherAgent.name);
                  return (
                    <button
                      key={otherAgent.id}
                      role="option"
                      onClick={() => { setSwitcherOpen(false); router.push(`/agent/${otherAgent.id}`); }}
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
                      onMouseEnter={(event) => (event.currentTarget.style.background = '#222')}
                      onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{
                        width: '22px', height: '22px', borderRadius: '5px', flexShrink: 0,
                        background: `hsla(${otherHue}, 60%, 22%, 0.5)`,
                        border: `1px solid hsla(${otherHue}, 60%, 40%, 0.3)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
                        color: `hsl(${otherHue}, 60%, 65%)`,
                      }}>
                        {otherAgent.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {otherAgent.name}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)' }}>
                          @{otherAgent.handle}
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

      {!inSetup && <HealthAlerts agentId={agentId} onNavigateTab={(tab) => setActiveTab(tab as TabId)} />}

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

      <main className="dashboard-content">
        {activeTab === 'compose' && <ComposeTab agentId={agentId} />}
        {activeTab === 'queue' && <QueueTab agentId={agentId} />}
        {activeTab === 'mentions' && <MentionsTab agentId={agentId} />}
        {activeTab === 'learning' && <LearningTab agentId={agentId} />}
        {activeTab === 'metrics' && <MetricsTab agentId={agentId} />}
        {activeTab === 'autopilot' && <AutopilotTab agentId={agentId} initialData={initialAutopilotData} />}
        {activeTab === 'settings' && (
          <SettingsTab
            agentId={agentId}
            agent={agent}
            onAgentDeleted={() => router.push(CONTROL_ROOM_PATH)}
            onAgentUpdated={loadDashboardShell}
          />
        )}
      </main>

      {showSetupContinuation && (
        <SetupContinuation
          agentId={agentId}
          agent={agent}
          onComplete={() => {
            setShowSetupContinuation(false);
            void loadDashboardShell();
          }}
          onClose={() => setShowSetupContinuation(false)}
        />
      )}
    </div>
  );
}
