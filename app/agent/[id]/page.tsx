'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/app/components/logo';
import { FeedTab } from '@/app/components/feed-tab';
import { QueueTab } from '@/app/components/queue-tab';
import { MentionsTab } from '@/app/components/mentions-tab';
import { MetricsTab } from '@/app/components/metrics-tab';
import { SettingsTab } from '@/app/components/settings-tab';
import { ProtocolTab } from '@/app/components/protocol-tab';
import { SetupContinuation } from '@/app/components/setup-continuation';
import type { AgentDetail } from '@/lib/types';

const TABS = [
  { id: 'protocol', label: 'PROTOCOL', hasPulse: true },
  { id: 'feed', label: 'FEED' },
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
  const searchParams = useSearchParams();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('protocol');
  const [showSetupContinuation, setShowSetupContinuation] = useState(false);

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
  const inSetup = agent.setupStep && agent.setupStep !== 'ready';

  const SETUP_LABELS: Record<string, { title: string; desc: string }> = {
    oauth: { title: 'CONNECT X API', desc: 'This agent needs X API credentials to continue setup. Go to Settings to connect.' },
    soul: { title: 'UPLOAD SOUL.MD', desc: 'This agent needs a personality definition. Go to Settings to configure SOUL.md.' },
    analyze: { title: 'RUN ANALYSIS', desc: 'This agent is connected and has a SOUL.md. Go to the Protocol tab to run account analysis.' },
  };

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
              Agent Dashboard
            </p>
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
      {inSetup && SETUP_LABELS[agent.setupStep] && (
        <div style={{
          padding: '12px 24px',
          background: 'rgba(245, 158, 11, 0.08)',
          borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path d="M8 2L14 14H2L8 2z" stroke="#f59e0b" strokeWidth="1.3" strokeLinejoin="round" />
            <line x1="8" y1="7" x2="8" y2="10" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="8" cy="12" r="0.5" fill="#f59e0b" />
          </svg>
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: '#f59e0b', letterSpacing: '0.08em' }}>
              SETUP INCOMPLETE: {SETUP_LABELS[agent.setupStep].title}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {SETUP_LABELS[agent.setupStep].desc}
            </p>
          </div>
        </div>
      )}

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
        {activeTab === 'protocol' && <ProtocolTab agentId={agentId} />}
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
