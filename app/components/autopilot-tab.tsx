'use client';

import { useState, useEffect } from 'react';
import type { ProtocolSettings, PostLogEntry, TweetJob, JobSuggestion, Metric } from '@/lib/types';

interface AutopilotTabProps {
  agentId: string;
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

function formatHour(h: number): string {
  if (h === 0) return '12AM';
  if (h < 12) return `${h}AM`;
  if (h === 12) return '12PM';
  return `${h - 12}PM`;
}

export function AutopilotTab({ agentId }: AutopilotTabProps) {
  const [settings, setSettings] = useState<ProtocolSettings | null>(null);
  const [postLog, setPostLog] = useState<PostLogEntry[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [jobs, setJobs] = useState<TweetJob[]>([]);
  const [suggestions, setSuggestions] = useState<JobSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAutopilot, setRunningAutopilot] = useState(false);
  const [agentConnected, setAgentConnected] = useState(false);
  const [activatingIdx, setActivatingIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/agents/${agentId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/agents/${agentId}/protocol/settings`).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/agents/${agentId}/metrics`).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/agents/${agentId}/jobs`).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/agents/${agentId}/jobs/suggest`).then((r) => r.ok ? r.json() : { suggestions: [] }).catch(() => ({ suggestions: [] })),
    ]).then(([agent, protocolData, metricsData, jobsData, suggestData]) => {
      setAgentConnected(agent?.isConnected === 1);
      if (protocolData) {
        setSettings(protocolData.settings);
        setPostLog(protocolData.postLog || []);
      }
      if (Array.isArray(metricsData)) setMetrics(metricsData);
      setJobs(jobsData || []);
      setSuggestions(suggestData.suggestions || []);
      setLoading(false);
    });
  }, [agentId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleUpdateSettings = async (updates: Partial<ProtocolSettings>) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/protocol/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleRunAutopilot = async () => {
    setRunningAutopilot(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/protocol/run`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(data.action === 'posted'
        ? `Posted: "${(data.content || '').slice(0, 60)}..."`
        : `${data.action}: ${data.reason}`);
      // Refresh
      const logRes = await fetch(`/api/agents/${agentId}/protocol/settings`);
      if (logRes.ok) {
        const logData = await logRes.json();
        setSettings(logData.settings);
        setPostLog(logData.postLog || []);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunningAutopilot(false);
    }
  };

  const handleActivateSuggestion = async (suggestion: JobSuggestion, idx: number) => {
    setActivatingIdx(idx);
    try {
      const res = await fetch(`/api/agents/${agentId}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...suggestion, source: 'suggested' }),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error);
      setJobs((prev) => [job, ...prev]);
      setSuggestions((prev) => prev.filter((_, i) => i !== idx));
      showToast(`Job "${suggestion.name}" activated`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to activate');
    } finally {
      setActivatingIdx(null);
    }
  };

  const handleToggleJob = async (job: TweetJob) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error);
      setJobs((prev) => prev.map((j) => j.id === job.id ? updated : j));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDeleteJob = async (job: TweetJob) => {
    try {
      await fetch(`/api/agents/${agentId}/jobs/${job.id}`, { method: 'DELETE' });
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      showToast(`"${job.name}" deleted`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const getMetricValue = (name: string): number => {
    const m = metrics.find((m) => m.metricName === name);
    return m?.value ?? 0;
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: '80px', borderRadius: '10px' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ position: 'relative' }}>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, background: '#1a1a1a',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
          padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: '12px',
          color: 'var(--text)', zIndex: 200,
        }}>
          {toast}
        </div>
      )}

      {/* ─── Metrics Summary ─────────────────────────────────────────────── */}
      <div className="protocol-stats-grid">
        {[
          { label: 'GENERATED', value: getMetricValue('tweets_generated'), color: undefined },
          { label: 'POSTED', value: getMetricValue('tweets_posted'), color: '#22c55e' },
          { label: 'QUEUED', value: getMetricValue('tweets_queued'), color: '#8b5cf6' },
          { label: 'AUTO-POSTED', value: getMetricValue('auto_posted'), color: '#22c55e' },
          { label: 'AUTO-REPLIED', value: getMetricValue('auto_replied'), color: '#3b82f6' },
          { label: 'MENTIONS', value: getMetricValue('mentions'), color: '#3b82f6' },
        ].map((m) => (
          <div key={m.label} className="protocol-stat">
            <span className="protocol-stat-value" style={m.color ? { color: m.color } : undefined}>{m.value}</span>
            <span className="protocol-stat-label">{m.label}</span>
          </div>
        ))}
      </div>

      {/* ─── Background Jobs ─────────────────────────────────────────────── */}
      {settings && agentConnected && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <circle cx="8" cy="8" r="6" stroke={settings.enabled || settings.autoReply ? '#22c55e' : '#8b5cf6'} strokeWidth="1.5" />
                <circle cx="8" cy="8" r="2" fill={settings.enabled || settings.autoReply ? '#22c55e' : 'var(--text-dim)'} />
              </svg>
              <h2>BACKGROUND JOBS</h2>
              <span className="section-count">cron every 30 min</span>
            </div>
            <button className="btn btn-outline btn-sm" onClick={handleRunAutopilot}
              disabled={runningAutopilot || (!settings.enabled && !settings.autoReply)}
            >
              {runningAutopilot ? 'RUNNING...' : 'RUN ALL NOW'}
            </button>
          </div>

          <div className="space-y-2" style={{ marginTop: '8px' }}>
            {/* Auto-Post */}
            <div className="protocol-card" style={{ padding: '12px 14px' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: settings.enabled ? '8px' : '0' }}>
                <div className="flex items-center gap-3">
                  <button className="btn btn-sm" style={{
                    background: settings.enabled ? '#22c55e' : 'var(--surface-2)',
                    color: settings.enabled ? '#fff' : 'var(--text-muted)',
                    border: `1px solid ${settings.enabled ? '#22c55e' : 'var(--border)'}`,
                    minWidth: '40px',
                  }} onClick={() => handleUpdateSettings({ enabled: !settings.enabled })}>
                    {settings.enabled ? 'ON' : 'OFF'}
                  </button>
                  <div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>AUTO-POST</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                      Generate + post tweets · {settings.totalAutoPosted} posted
                      {settings.lastPostedAt && ` · last ${getTimeAgo(settings.lastPostedAt)}`}
                    </p>
                  </div>
                </div>
              </div>
              {settings.enabled && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  <div className="field"><label>POSTS/DAY</label>
                    <select className="input" style={{ fontSize: '11px', padding: '4px 6px' }} value={settings.postsPerDay}
                      onChange={(e) => handleUpdateSettings({ postsPerDay: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>START</label>
                    <select className="input" style={{ fontSize: '11px', padding: '4px 6px' }} value={settings.activeHoursStart}
                      onChange={(e) => handleUpdateSettings({ activeHoursStart: Number(e.target.value) })}>
                      {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{formatHour(i)}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>END</label>
                    <select className="input" style={{ fontSize: '11px', padding: '4px 6px' }} value={settings.activeHoursEnd}
                      onChange={(e) => handleUpdateSettings({ activeHoursEnd: Number(e.target.value) })}>
                      {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{formatHour(i)}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>MIN QUEUE</label>
                    <select className="input" style={{ fontSize: '11px', padding: '4px 6px' }} value={settings.minQueueSize}
                      onChange={(e) => handleUpdateSettings({ minQueueSize: Number(e.target.value) })}>
                      {[3, 5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Auto-Reply */}
            <div className="protocol-card" style={{ padding: '12px 14px' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button className="btn btn-sm" style={{
                    background: settings.autoReply ? '#22c55e' : 'var(--surface-2)',
                    color: settings.autoReply ? '#fff' : 'var(--text-muted)',
                    border: `1px solid ${settings.autoReply ? '#22c55e' : 'var(--border)'}`,
                    minWidth: '40px',
                  }} onClick={() => handleUpdateSettings({ autoReply: !settings.autoReply })}>
                    {settings.autoReply ? 'ON' : 'OFF'}
                  </button>
                  <div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>AUTO-REPLY</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                      Reply to new mentions · {settings.totalAutoReplied || 0} replied
                      {settings.autoReply && ` · max ${settings.maxRepliesPerRun || 3}/run`}
                      {settings.lastRepliedAt && ` · last ${getTimeAgo(settings.lastRepliedAt)}`}
                    </p>
                  </div>
                </div>
                {settings.autoReply && (
                  <select className="input" style={{ fontSize: '11px', padding: '4px 6px', width: '60px' }}
                    value={settings.maxRepliesPerRun || 3}
                    onChange={(e) => handleUpdateSettings({ maxRepliesPerRun: Number(e.target.value) })}>
                    {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}/run</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* Always-on jobs */}
            <div className="protocol-card" style={{ padding: '10px 14px', display: 'flex', gap: '12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, color: '#22c55e' }}>ALWAYS ON</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                Mention sync (every 30 min) · Trending sync (on generate)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ─── Suggested Jobs ──────────────────────────────────────────────── */}
      {suggestions.length > 0 && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M8 1l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4l2-4z" stroke="#8b5cf6" strokeWidth="1.2" fill="none" />
              </svg>
              <h2>SUGGESTED JOBS</h2>
            </div>
          </div>
          <div className="space-y-2">
            {suggestions.map((s, idx) => (
              <div key={idx} className="protocol-card" style={{ padding: '12px 14px' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: '4px' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>{s.name}</p>
                  <button className="btn btn-primary btn-sm" style={{ background: '#8b5cf6' }}
                    disabled={activatingIdx === idx} onClick={() => handleActivateSuggestion(s, idx)}>
                    {activatingIdx === idx ? 'ACTIVATING...' : 'ACTIVATE'}
                  </button>
                </div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', lineHeight: '1.5' }}>{s.description}</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>{s.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Active Jobs ──────────────────────────────────────────────────── */}
      {jobs.length > 0 && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="#8b5cf6" strokeWidth="1.5" />
                <polyline points="5,8 7,10 11,6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h2>ACTIVE JOBS</h2>
              <span className="section-count">{jobs.filter((j) => j.enabled).length} running</span>
            </div>
          </div>
          <div className="space-y-2">
            {jobs.map((job) => (
              <div key={job.id} className="protocol-card" style={{ padding: '10px 14px' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button className="btn btn-sm" style={{
                      background: job.enabled ? '#22c55e' : 'var(--surface-2)',
                      color: job.enabled ? '#fff' : 'var(--text-muted)',
                      border: `1px solid ${job.enabled ? '#22c55e' : 'var(--border)'}`,
                      minWidth: '36px', height: '24px', fontSize: '9px',
                    }} onClick={() => handleToggleJob(job)}>
                      {job.enabled ? 'ON' : 'OFF'}
                    </button>
                    <div>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>{job.name}</p>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>
                        {job.schedule} · {job.totalPosted} posted
                        {job.lastRunAt && ` · last ${getTimeAgo(job.lastRunAt)}`}
                      </p>
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444', fontSize: '9px' }}
                    onClick={() => handleDeleteJob(job)}>DELETE</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Activity Log ─────────────────────────────────────────────────── */}
      <div>
        <div className="section-header">
          <div className="section-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="#8b5cf6" strokeWidth="1.5" />
              <line x1="5" y1="6" x2="11" y2="6" stroke="#8b5cf6" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="5" y1="10" x2="9" y2="10" stroke="#8b5cf6" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <h2>ACTIVITY LOG</h2>
            <span className="section-count">{postLog.length} events</span>
          </div>
        </div>
        {postLog.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.7' }}>
              No activity yet. Enable auto-post or auto-reply, or hit RUN ALL NOW.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {postLog.map((entry) => {
              const isPost = entry.action === 'posted' || (!entry.action && entry.xTweetId);
              const tagLabel = entry.source === 'cron' ? 'CRON' : entry.source === 'autopilot' ? 'AUTO' : 'MANUAL';
              const tagColor = entry.action === 'posted' ? '#22c55e'
                : entry.action === 'replied' ? '#3b82f6'
                : entry.action === 'error' ? '#ef4444'
                : entry.action === 'mentions_refreshed' ? '#3b82f6'
                : entry.action === 'skipped' ? 'var(--text-dim)'
                : isPost ? '#22c55e' : 'var(--text-dim)';

              return (
                <div key={entry.id} className="protocol-viral-card">
                  <div className="flex items-center justify-between" style={{ marginBottom: '4px' }}>
                    <div className="flex items-center gap-2">
                      <span className="protocol-tag" style={{
                        fontSize: '9px', background: `${tagColor}15`, borderColor: `${tagColor}40`, color: tagColor,
                      }}>{tagLabel}</span>
                      {entry.action && entry.action !== 'posted' && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: tagColor, textTransform: 'uppercase' }}>
                          {entry.action.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                      {getTimeAgo(entry.postedAt)}
                    </span>
                  </div>
                  {entry.content && <p className="protocol-viral-text" style={{ fontSize: '11px' }}>{entry.content}</p>}
                  {entry.reason && (
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>{entry.reason}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
