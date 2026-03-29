'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/app/components/logo';

interface CronLogEntry {
  id: string;
  timestamp: string;
  mentionsRefreshed: number;
  autopilotProcessed: number;
  results: Array<{
    agentId: string;
    action: string;
    reason: string;
    content?: string;
    repliesSent?: number;
  }>;
}

interface AgentInfo {
  id: string;
  name: string;
  handle: string;
}

function getTimeAgo(ts: string): string {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function actionColor(action: string): string {
  if (action === 'posted') return '#22c55e';
  if (action === 'replied') return '#3b82f6';
  if (action === 'error') return '#ef4444';
  return 'var(--text-dim)';
}

export default function CronDashboard() {
  const router = useRouter();
  const [log, setLog] = useState<CronLogEntry[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/cron/log').then((r) => {
        if (r.status === 401) { router.push('/'); return []; }
        return r.ok ? r.json() : [];
      }),
      fetch('/api/agents').then((r) => r.ok ? r.json() : []),
    ]).then(([logData, agentData]) => {
      if (Array.isArray(logData)) setLog(logData);
      if (Array.isArray(agentData)) {
        const map: Record<string, AgentInfo> = {};
        for (const a of agentData) map[String(a.id)] = { id: a.id, name: a.name, handle: a.handle };
        setAgents(map);
      }
    })
    .catch(() => {})
    .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/cron/log')
        .then((r) => r.ok ? r.json() : [])
        .then((data) => { if (Array.isArray(data)) setLog(data); })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const getAgentLabel = (agentId: string) => {
    const a = agents[String(agentId)];
    return a ? `@${a.handle}` : `Agent #${agentId}`;
  };

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="flex items-center gap-3">
          <button className="back-btn" onClick={() => router.push('/')}>
            <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polyline points="7,2 3,6 7,10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            HOME
          </button>
          <Logo size={24} />
          <div>
            <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600, letterSpacing: '0.08em' }}>
              CRON DASHBOARD
            </h1>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
              Your agents · runs every 30 min
            </p>
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
          {log.length > 0 && `Last run: ${getTimeAgo(log[0].timestamp)}`}
        </div>
      </header>

      <main className="dashboard-content">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton" style={{ height: '72px', borderRadius: '10px' }} />
            ))}
          </div>
        ) : log.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>
              No cron runs recorded yet. Enable autopilot on an agent to start.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {log.map((entry) => (
              <div key={entry.id} className="protocol-card" style={{ padding: '12px 14px' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
                  <div className="flex items-center gap-3">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>
                      {formatTime(entry.timestamp)}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                      {getTimeAgo(entry.timestamp)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {entry.mentionsRefreshed > 0 && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#3b82f6' }}>
                        +{entry.mentionsRefreshed} mentions
                      </span>
                    )}
                  </div>
                </div>

                {entry.results.length > 0 ? (
                  <div className="space-y-1">
                    {entry.results.map((r, i) => (
                      <div key={i} className="flex items-start gap-2" style={{ padding: '4px 0' }}>
                        <span
                          className="protocol-tag"
                          style={{
                            fontSize: '9px',
                            background: `${actionColor(r.action)}15`,
                            borderColor: `${actionColor(r.action)}40`,
                            color: actionColor(r.action),
                            minWidth: '52px',
                            textAlign: 'center',
                          }}
                        >
                          {r.action.toUpperCase()}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#8b5cf6', cursor: 'pointer' }}
                            onClick={() => router.push(`/agent/${r.agentId}`)}
                          >
                            {getAgentLabel(r.agentId)}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', marginLeft: '8px' }}>
                            {r.reason}
                          </span>
                          {r.repliesSent && r.repliesSent > 0 && (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#3b82f6', marginLeft: '8px' }}>
                              +{r.repliesSent} replies
                            </span>
                          )}
                          {r.content && (
                            <p style={{
                              fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)',
                              marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              &ldquo;{r.content.slice(0, 120)}{r.content.length > 120 ? '...' : ''}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                    Mentions refreshed, no autopilot actions
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
