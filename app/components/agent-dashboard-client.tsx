'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HealthAlerts } from '@/app/components/health-alerts';
import { CONTROL_ROOM_PATH } from '@/lib/app-routes';
import { SETUP_BANNER_CONTENT, isSetupIncomplete, normalizeSetupStep } from '@/lib/setup-state';
import type { AutopilotHealthSnapshot, BillingSummary, AgentDetail, AgentSummary, Metric, PostLogEntry, ProtocolSettings } from '@/lib/types';

const ReviewTab = dynamic(() => import('@/app/components/review-tab').then((mod) => mod.ReviewTab), {
  loading: () => <TabSkeleton />,
});
const UnifiedEngageTab = dynamic(() => import('@/app/components/unified-engage-tab').then((mod) => mod.UnifiedEngageTab), {
  loading: () => <TabSkeleton />,
});
const AutomationTab = dynamic(() => import('@/app/components/autopilot-tab').then((mod) => mod.AutopilotTab), {
  loading: () => <TabSkeleton />,
});
const InsightsTab = dynamic(() => import('@/app/components/insights-tab').then((mod) => mod.InsightsTab), {
  loading: () => <TabSkeleton />,
});
const SettingsTab = dynamic(() => import('@/app/components/settings-tab').then((mod) => mod.SettingsTab), {
  loading: () => <TabSkeleton />,
});
const SetupContinuation = dynamic(() => import('@/app/components/setup-continuation').then((mod) => mod.SetupContinuation), {
  ssr: false,
});

const TABS = [
  {
    id: 'today',
    label: 'Today',
    title: 'See what needs attention right now.',
    description: 'Check connection, queue health, automation, blockers, and the next best action from one place.',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Decide what deserves to publish.',
    description: 'Generate drafts, inspect why they were made, approve strong ones, and rescue or remove weak ones.',
  },
  {
    id: 'engage',
    label: 'Engage',
    title: 'Reply when there is real value to add.',
    description: 'Review mentions, draft high-value replies, and run supervised engagement sessions without losing taste.',
  },
  {
    id: 'learn',
    label: 'Learn',
    title: 'See whether the account is getting sharper.',
    description: 'Track quality, what changed this week, and which experiments are helping or hurting.',
  },
  {
    id: 'settings',
    label: 'Settings',
    title: 'Manage account, voice, and posting rules.',
    description: 'Update identity, SOUL.md, X connection, billing, and advanced account controls.',
  },
] as const;

type TabId = (typeof TABS)[number]['id'];
type InsightsView = 'learning' | 'results';
type OAuthNotice = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

interface AutopilotInitialData {
  agentConnected: boolean;
  agentHandle: string;
  settings: ProtocolSettings;
  billing: BillingSummary;
  postLog: PostLogEntry[];
  metrics: Metric[];
  autopilotHealth?: AutopilotHealthSnapshot | null;
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

function normalizeInsightsView(rawView: string | null): InsightsView {
  return rawView === 'results' ? 'results' : 'learning';
}

function resolveDashboardLocation(rawTab: string | null, rawView: string | null): { tab: TabId; insightsView: InsightsView } {
  const insightsView = normalizeInsightsView(rawView);

  switch (rawTab) {
    case 'autopilot':
    case 'automation':
    case 'today':
      return { tab: 'today', insightsView };
    case 'drafts':
    case 'compose':
    case 'queue':
    case 'review':
      return { tab: 'review', insightsView };
    case 'inbox':
    case 'mentions':
    case 'engage':
      return { tab: 'engage', insightsView };
    case 'metrics':
    case 'results':
      return { tab: 'learn', insightsView: 'results' };
    case 'learning':
    case 'insights':
    case 'learn':
      return { tab: 'learn', insightsView };
    case 'settings':
      return { tab: 'settings', insightsView };
    default:
      return { tab: 'today', insightsView };
  }
}

function formatUrlTab(tab: TabId): string {
  switch (tab) {
    case 'today':
      return 'today';
    case 'review':
      return 'review';
    case 'learn':
      return 'learn';
    default:
      return tab;
  }
}

function resolveOAuthNotice(params: URLSearchParams): OAuthNotice | null {
  const oauth = params.get('oauth');
  if (!oauth) return null;

  if (oauth === 'success') {
    const username = params.get('username');
    return {
      tone: 'success',
      message: username
        ? `X connected as @${username}. Continue setup from here.`
        : 'X connected. Continue setup from here.',
    };
  }

  if (oauth === 'denied') {
    return {
      tone: 'warning',
      message: 'X connection was cancelled. Nothing changed.',
    };
  }

  return {
    tone: 'error',
    message: 'X did not finish connecting. Try again from Today or Settings.',
  };
}

function oauthNoticeStyle(tone: OAuthNotice['tone']) {
  if (tone === 'success') {
    return {
      border: '1px solid var(--primary-border)',
      background: 'var(--primary-soft)',
      color: 'var(--primary)',
    };
  }
  if (tone === 'warning') {
    return {
      border: '1px solid rgba(199, 133, 40, 0.28)',
      background: 'rgba(199, 133, 40, 0.10)',
      color: '#c78528',
    };
  }
  return {
    border: '1px solid rgba(214, 92, 92, 0.28)',
    background: 'rgba(214, 92, 92, 0.10)',
    color: 'var(--red)',
  };
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
  const [activeTab, setActiveTab] = useState<TabId>('today');
  const [insightsView, setInsightsView] = useState<InsightsView>('learning');
  const [locationReady, setLocationReady] = useState(false);
  const [showSetupContinuation, setShowSetupContinuation] = useState(shouldOpenSetupContinuation);
  const [oauthNotice, setOAuthNotice] = useState<OAuthNotice | null>(null);
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
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const location = resolveDashboardLocation(params.get('tab'), params.get('view'));
    const notice = resolveOAuthNotice(params);
    if (notice) {
      setOAuthNotice(notice);
      url.searchParams.delete('oauth');
      url.searchParams.delete('username');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    setActiveTab(location.tab);
    setInsightsView(location.insightsView);
    setLocationReady(true);
  }, []);

  useEffect(() => {
    if (!locationReady) return;

    const url = new URL(window.location.href);
    url.searchParams.set('tab', formatUrlTab(activeTab));

    if (activeTab === 'learn') {
      url.searchParams.set('view', insightsView);
    } else {
      url.searchParams.delete('view');
    }

    window.history.replaceState(window.history.state, '', url.toString());
  }, [activeTab, insightsView, locationReady]);

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

  const navigateToTab = useCallback((rawTab: string) => {
    const location = resolveDashboardLocation(rawTab, rawTab === 'metrics' ? 'results' : rawTab === 'learning' ? 'learning' : null);
    setActiveTab(location.tab);
    setInsightsView(location.insightsView);
  }, []);

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
  const currentTab = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
  const connectionTone = inSetup ? 'setup' : isConnected ? 'live' : 'offline';
  const connectionLabel = inSetup ? 'In setup' : isConnected ? 'Connected' : 'Disconnected';

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="flex items-center gap-3">
          <button className="back-btn" onClick={() => router.push(CONTROL_ROOM_PATH)} data-testid="button-back-to-agents">
            <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polyline points="7,2 3,6 7,10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            All agents
          </button>

          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: `hsla(${hue}, 78%, 92%, 0.95)`,
              border: `1px solid hsla(${hue}, 40%, 48%, 0.22)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              fontWeight: 700,
              color: `hsl(${hue}, 42%, 34%)`,
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
                style={{ fontFamily: 'var(--font-space)', fontSize: '24px', fontWeight: 650, lineHeight: 1.05, display: 'flex', alignItems: 'center', gap: '7px' }}
                data-testid="text-agent-name"
              >
                {agent.name}
                {otherAgents.length > 0 && (
                  <svg viewBox="0 0 10 6" width="10" height="6" fill="none" style={{ marginTop: '2px', opacity: 0.5 }}>
                    <polyline points="1,1 5,5 9,1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </h1>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px' }}>
                Publishing workspace{otherAgents.length > 0 ? ` · ${otherAgents.length + 1} agents` : ''}
              </p>
            </button>

            {switcherOpen && (
              <div
                role="listbox"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  background: 'var(--surface)',
                  border: '1px solid rgba(70, 54, 38, 0.14)',
                  borderRadius: '16px',
                  minWidth: '220px',
                  zIndex: 50,
                  boxShadow: '0 18px 36px rgba(70, 54, 38, 0.14)',
                  overflow: 'hidden',
                }}
              >
                {otherAgents.map((otherAgent) => {
                  const otherHue = getAgentHue(otherAgent.name);
                  return (
                    <button
                      key={otherAgent.id}
                      role="option"
                      onClick={() => {
                        setSwitcherOpen(false);
                        router.push(`/agent/${otherAgent.id}`);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 12px',
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid rgba(70, 54, 38, 0.08)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'var(--text)',
                      }}
                      onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '5px',
                        flexShrink: 0,
                        background: `hsla(${otherHue}, 60%, 92%, 1)`,
                        border: `1px solid hsla(${otherHue}, 45%, 48%, 0.22)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        fontWeight: 700,
                        color: `hsl(${otherHue}, 45%, 34%)`,
                      }}>
                        {otherAgent.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
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
            <div className={`status-dot-indicator ${connectionTone}`} />
            <span className={`status-label ${connectionTone}`}>
              {connectionLabel}
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
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: '#f59e0b', letterSpacing: '0' }}>
                Setup incomplete: {SETUP_BANNER_CONTENT[setupStep].title}
              </p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {SETUP_BANNER_CONTENT[setupStep].desc}
              </p>
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setShowSetupContinuation(true)}>
            Continue setup
          </button>
        </div>
      )}

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
            </button>
          );
        })}
      </nav>

      {oauthNotice && (
        <div style={{
          margin: '16px 24px 0',
          padding: '12px 14px',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          ...oauthNoticeStyle(oauthNotice.tone),
        }}>
          <p style={{
            margin: 0,
            fontFamily: 'var(--font-body)',
            fontSize: '13px',
            fontWeight: 650,
            color: 'var(--text)',
          }}>
            {oauthNotice.message}
          </p>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setOAuthNotice(null)}
            style={{ flexShrink: 0 }}
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="dashboard-content">
        {!inSetup && <HealthAlerts agentId={agentId} onNavigateTab={navigateToTab} />}

        <section className="dashboard-context-card">
          <div>
            <p className="dashboard-context-kicker">{currentTab.label}</p>
            <h2 className="dashboard-context-title">{currentTab.title}</h2>
            <p className="dashboard-context-copy">{currentTab.description}</p>
          </div>
          <div className="dashboard-context-meta">
            <span className="dashboard-context-chip">@{agent.handle}</span>
            <span className={`dashboard-context-chip ${connectionTone}`}>{connectionLabel}</span>
            {otherAgents.length > 0 && (
              <span className="dashboard-context-chip">{otherAgents.length + 1} agents</span>
            )}
          </div>
        </section>

        {activeTab === 'review' && <ReviewTab agentId={agentId} />}
        {activeTab === 'engage' && <UnifiedEngageTab agentId={agentId} />}
        {activeTab === 'learn' && (
          <InsightsTab
            agentId={agentId}
            initialView={insightsView}
            onViewChange={setInsightsView}
          />
        )}
        {activeTab === 'today' && <AutomationTab agentId={agentId} initialData={initialAutopilotData} />}
        {activeTab === 'settings' && (
          <SettingsTab
            agentId={agentId}
            agent={agent}
            onAgentDeleted={() => {
              window.location.href = CONTROL_ROOM_PATH;
            }}
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
