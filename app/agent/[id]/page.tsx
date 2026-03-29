'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Logo } from '@/app/components/logo';
import { FeedTab } from '@/app/components/feed-tab';
import { QueueTab } from '@/app/components/queue-tab';
import { MentionsTab } from '@/app/components/mentions-tab';
import { MetricsTab } from '@/app/components/metrics-tab';
import { SettingsTab } from '@/app/components/settings-tab';
import type { AgentDetail } from '@/lib/types';

const TABS = [
  { id: 'feed', label: 'FEED', hasPulse: true },
  { id: 'queue', label: 'QUEUE' },
  { id: 'mentions', label: 'MENTIONS' },
  { id: 'metrics', label: 'METRICS' },
  { id: 'settings', label: 'SETTINGS' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function getAgentHue(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

export default function AgentDashboard() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('feed');

  const loadAgent = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAgent(data);
    } catch {
      setAgent(null);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadAgent();
    const interval = setInterval(loadAgent, 30000);
    return () => clearInterval(interval);
  }, [loadAgent]);

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

          <div>
            <h1
              style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600, letterSpacing: '0.08em' }}
              data-testid="text-agent-name"
            >
              {agent.name.toUpperCase()}
            </h1>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
              Engagement Ops
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="status-dot">
            <div className={`status-dot-indicator ${isConnected ? 'live' : 'offline'}`} />
            <span
              className={`status-label ${isConnected ? 'live' : 'offline'}`}
              style={{ letterSpacing: '0.1em' }}
            >
              {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
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
        {activeTab === 'feed' && <FeedTab agentId={agentId} />}
        {activeTab === 'queue' && <QueueTab agentId={agentId} />}
        {activeTab === 'mentions' && <MentionsTab agentId={agentId} />}
        {activeTab === 'metrics' && <MetricsTab agentId={agentId} />}
        {activeTab === 'settings' && (
          <SettingsTab
            agentId={agentId}
            agent={agent}
            onAgentDeleted={() => router.push('/')}
            onAgentUpdated={loadAgent}
          />
        )}
      </main>
    </div>
  );
}
