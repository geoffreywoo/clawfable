'use client';

import { useState, useEffect } from 'react';
import type { ProtocolSettings, PostLogEntry, Metric } from '@/lib/types';

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

export function AutopilotTab({ agentId }: AutopilotTabProps) {
  const [settings, setSettings] = useState<ProtocolSettings | null>(null);
  const [postLog, setPostLog] = useState<PostLogEntry[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAutopilot, setRunningAutopilot] = useState(false);
  const [agentConnected, setAgentConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/agents/${agentId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/agents/${agentId}/protocol/settings`).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/agents/${agentId}/metrics`).then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([agent, protocolData, metricsData]) => {
      setAgentConnected(agent?.isConnected === 1);
      if (protocolData) {
        setSettings(protocolData.settings);
        setPostLog(protocolData.postLog || []);
      }
      if (Array.isArray(metricsData)) setMetrics(metricsData);
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
              <span className="section-count">cron every 10 min</span>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  <div className="field"><label>POSTS/DAY</label>
                    <select className="input" style={{ fontSize: '11px', padding: '4px 6px' }} value={settings.postsPerDay}
                      onChange={(e) => handleUpdateSettings({ postsPerDay: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 6, 8, 12, 24].map((n) => <option key={n} value={n}>{n}</option>)}
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
                      {settings.lastRepliedAt && ` · last ${getTimeAgo(settings.lastRepliedAt)}`}
                    </p>
                  </div>
                </div>
              </div>
              {settings.autoReply && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginTop: '8px' }}>
                  <div className="field">
                    <label>CHECK EVERY</label>
                    <select className="input" style={{ fontSize: '11px', padding: '4px 6px' }}
                      value={settings.replyIntervalMins || 30}
                      onChange={(e) => handleUpdateSettings({ replyIntervalMins: Number(e.target.value) })}>
                      {[
                        { v: 10, l: '10 min' },
                        { v: 30, l: '30 min' },
                        { v: 60, l: '1 hour' },
                        { v: 120, l: '2 hours' },
                        { v: 240, l: '4 hours' },
                        { v: 480, l: '8 hours' },
                        { v: 720, l: '12 hours' },
                      ].map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>MAX REPLIES/RUN</label>
                    <select className="input" style={{ fontSize: '11px', padding: '4px 6px' }}
                      value={settings.maxRepliesPerRun || 3}
                      onChange={(e) => handleUpdateSettings({ maxRepliesPerRun: Number(e.target.value) })}>
                      {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Marketing Track */}
            <div className="protocol-card" style={{ padding: '12px 14px' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: settings.marketingEnabled ? '8px' : '0' }}>
                <div className="flex items-center gap-3">
                  <button className="btn btn-sm" style={{
                    background: settings.marketingEnabled ? '#22c55e' : 'var(--surface-2)',
                    color: settings.marketingEnabled ? '#fff' : 'var(--text-muted)',
                    border: `1px solid ${settings.marketingEnabled ? '#22c55e' : 'var(--border)'}`,
                    minWidth: '40px',
                  }} onClick={() => handleUpdateSettings({ marketingEnabled: !settings.marketingEnabled })}>
                    {settings.marketingEnabled ? 'ON' : 'OFF'}
                  </button>
                  <div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>MARKETING</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                      Auto-generate promotional tweets for clawfable.com
                    </p>
                  </div>
                </div>
              </div>
              {settings.marketingEnabled && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  <div className="field"><label>MIX %</label>
                    <select className="input" style={{ fontSize: '11px', padding: '4px 6px' }}
                      value={settings.marketingMix || 20}
                      onChange={(e) => handleUpdateSettings({ marketingMix: Number(e.target.value) })}>
                      {[10, 20, 30, 40, 50].map((n) => <option key={n} value={n}>{n}% promotional</option>)}
                    </select>
                  </div>
                  <div className="field"><label>ROLE</label>
                    <select className="input" style={{ fontSize: '11px', padding: '4px 6px' }}
                      value={settings.marketingRole || 'product'}
                      onChange={(e) => handleUpdateSettings({ marketingRole: e.target.value })}>
                      <option value="ceo">CEO / Founder</option>
                      <option value="service">Official Product</option>
                      <option value="product">Product Evangelist</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Always-on jobs */}
            <div className="protocol-card" style={{ padding: '10px 14px', display: 'flex', gap: '12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, color: '#22c55e' }}>ALWAYS ON</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                Mention sync (every 10 min) · Self-learning (daily)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ─── Content Style Controls ──────────────────────────────────────── */}
      {settings && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="#8b5cf6" strokeWidth="1.5" />
                <line x1="5" y1="6" x2="11" y2="6" stroke="#8b5cf6" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="5" y1="10" x2="9" y2="10" stroke="#8b5cf6" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <h2>CONTENT STYLE</h2>
              <span className="section-count">controls generation output</span>
            </div>
          </div>

          <div className="space-y-3" style={{ marginTop: '8px' }}>
            {/* Length mix */}
            <div className="protocol-card" style={{ padding: '14px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: '10px' }}>
                LENGTH MIX
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div className="field">
                  <label>SHORT (&lt;200)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min="0" max="100" step="10"
                      value={settings.lengthMix?.short ?? 30}
                      onChange={(e) => {
                        const short = Number(e.target.value);
                        const current = settings.lengthMix || { short: 30, medium: 30, long: 40 };
                        const remaining = 100 - short;
                        const ratio = current.medium + current.long > 0 ? current.medium / (current.medium + current.long) : 0.5;
                        handleUpdateSettings({ lengthMix: { short, medium: Math.round(remaining * ratio), long: Math.round(remaining * (1 - ratio)) } });
                      }}
                      style={{ flex: 1, accentColor: '#8b5cf6' }}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: 'var(--text)', width: '32px', textAlign: 'right' }}>
                      {settings.lengthMix?.short ?? 30}%
                    </span>
                  </div>
                </div>
                <div className="field">
                  <label>MEDIUM (200-500)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min="0" max="100" step="10"
                      value={settings.lengthMix?.medium ?? 30}
                      onChange={(e) => {
                        const medium = Number(e.target.value);
                        const current = settings.lengthMix || { short: 30, medium: 30, long: 40 };
                        const remaining = 100 - medium;
                        const ratio = current.short + current.long > 0 ? current.short / (current.short + current.long) : 0.5;
                        handleUpdateSettings({ lengthMix: { short: Math.round(remaining * ratio), medium, long: Math.round(remaining * (1 - ratio)) } });
                      }}
                      style={{ flex: 1, accentColor: '#8b5cf6' }}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: 'var(--text)', width: '32px', textAlign: 'right' }}>
                      {settings.lengthMix?.medium ?? 30}%
                    </span>
                  </div>
                </div>
                <div className="field">
                  <label>LONG (500+)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min="0" max="100" step="10"
                      value={settings.lengthMix?.long ?? 40}
                      onChange={(e) => {
                        const long = Number(e.target.value);
                        const current = settings.lengthMix || { short: 30, medium: 30, long: 40 };
                        const remaining = 100 - long;
                        const ratio = current.short + current.medium > 0 ? current.short / (current.short + current.medium) : 0.5;
                        handleUpdateSettings({ lengthMix: { short: Math.round(remaining * ratio), medium: Math.round(remaining * (1 - ratio)), long } });
                      }}
                      style={{ flex: 1, accentColor: '#8b5cf6' }}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: 'var(--text)', width: '32px', textAlign: 'right' }}>
                      {settings.lengthMix?.long ?? 40}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Format toggles */}
            <div className="protocol-card" style={{ padding: '14px' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: '10px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>
                  ALLOWED FORMATS
                </p>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '9px' }}
                  onClick={() => handleUpdateSettings({ enabledFormats: [] })}
                >
                  {(settings.enabledFormats?.length || 0) === 0 ? 'ALL ENABLED' : 'RESET TO ALL'}
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {[
                  { id: 'hot_take', label: 'Hot Take' },
                  { id: 'question', label: 'Question' },
                  { id: 'data_point', label: 'Data Point' },
                  { id: 'short_punch', label: 'Short Punch' },
                  { id: 'long_form', label: 'Long Form' },
                  { id: 'analysis', label: 'Analysis' },
                  { id: 'observation', label: 'Observation' },
                ].map((f) => {
                  const enabled = !settings.enabledFormats || settings.enabledFormats.length === 0 || settings.enabledFormats.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      className="protocol-tag"
                      style={{
                        cursor: 'pointer',
                        fontSize: '10px',
                        background: enabled ? 'rgba(139,92,246,0.15)' : 'var(--surface)',
                        borderColor: enabled ? 'rgba(139,92,246,0.4)' : 'var(--border)',
                        color: enabled ? '#8b5cf6' : 'var(--text-dim)',
                        opacity: enabled ? 1 : 0.5,
                      }}
                      onClick={() => {
                        const current = settings.enabledFormats || [];
                        if (current.length === 0) {
                          // Switching from "all" to specific: enable all except this one
                          const allIds = ['hot_take','question','data_point','short_punch','long_form','analysis','observation'];
                          handleUpdateSettings({ enabledFormats: allIds.filter((id) => id !== f.id) });
                        } else if (current.includes(f.id)) {
                          const next = current.filter((id: string) => id !== f.id);
                          handleUpdateSettings({ enabledFormats: next.length === 0 ? [] : next });
                        } else {
                          handleUpdateSettings({ enabledFormats: [...current, f.id] });
                        }
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
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
