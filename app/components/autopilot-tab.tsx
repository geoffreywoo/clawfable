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
  const [agentHandle, setAgentHandle] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  // Voice coaching chat
  const [voiceChat, setVoiceChat] = useState<Array<{ id: string; role: string; content: string; directive?: string; ts: string }>>([]);
  const [voiceDirectives, setVoiceDirectives] = useState<string[]>([]);
  const [voiceInput, setVoiceInput] = useState('');
  const [voiceSending, setVoiceSending] = useState(false);
  const [voiceChatOpen, setVoiceChatOpen] = useState(false);
  // Learned rules
  const [learnedInsights, setLearnedInsights] = useState<string[]>([]);
  const [antiPatterns, setAntiPatterns] = useState<string[]>([]);
  const [remixPatterns, setRemixPatterns] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/agents/${agentId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/agents/${agentId}/protocol/settings`).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/agents/${agentId}/metrics`).then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([agent, protocolData, metricsData]) => {
      setAgentConnected(agent?.isConnected === 1);
      setAgentHandle(agent?.handle || '');
      if (protocolData) {
        setSettings(protocolData.settings);
        setPostLog(protocolData.postLog || []);
      }
      if (Array.isArray(metricsData)) setMetrics(metricsData);
      setLoading(false);
    });
    // Load voice chat + learnings
    fetch(`/api/agents/${agentId}/voice-chat`).then((r) => r.ok ? r.json() : null).then((data) => {
      if (data?.chat) setVoiceChat(data.chat);
      if (data?.directives) setVoiceDirectives(data.directives);
    }).catch(() => {});
    fetch(`/api/agents/${agentId}/learnings`).then((r) => r.ok ? r.json() : null).then((data) => {
      if (data?.insights) setLearnedInsights(data.insights);
      if (data?.styleFingerprint?.antiPatterns) setAntiPatterns(data.styleFingerprint.antiPatterns);
    }).catch(() => {});
  }, [agentId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleVoiceSend = async () => {
    if (!voiceInput.trim() || voiceSending) return;
    const msg = voiceInput.trim();
    setVoiceInput('');
    setVoiceSending(true);
    // Optimistic: add operator message immediately
    setVoiceChat((prev) => [...prev, { id: `op-${Date.now()}`, role: 'operator', content: msg, ts: new Date().toISOString() }]);
    try {
      const res = await fetch(`/api/agents/${agentId}/voice-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Add agent response
      setVoiceChat((prev) => [...prev, {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: data.reply,
        directive: data.directive || undefined,
        ts: new Date().toISOString(),
      }]);
      if (data.directives) setVoiceDirectives(data.directives);
      if (data.directive) showToast(`New directive locked in: ${data.directive.slice(0, 60)}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Voice chat failed');
    } finally {
      setVoiceSending(false);
    }
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
                      {[1, 2, 3, 4, 6, 8, 12, 24, 48].map((n) => <option key={n} value={n}>{n}{n === 48 ? ' (every 30m)' : ''}</option>)}
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

            {/* Marketing Track — only for spokesperson accounts */}
            {['antihunterai', 'clawfable'].includes(agentHandle.toLowerCase()) && (
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
            )}

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

      {/* ─── Voice Coaching ─────────────────────────────────────────────── */}
      {settings && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M8 1C5.2 1 3 3.2 3 6c0 1.9 1 3.5 2.5 4.3V12a1 1 0 001 1h3a1 1 0 001-1v-1.7C12 9.5 13 7.9 13 6c0-2.8-2.2-5-5-5z" stroke="#8b5cf6" strokeWidth="1.3" />
                <line x1="6" y1="14" x2="10" y2="14" stroke="#8b5cf6" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <h2>VOICE COACHING</h2>
              <span className="section-count">{voiceDirectives.length} active directive{voiceDirectives.length !== 1 ? 's' : ''}</span>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => setVoiceChatOpen(!voiceChatOpen)}>
              {voiceChatOpen ? 'CLOSE' : 'OPEN CHAT'}
            </button>
          </div>

          {/* Active directives */}
          {voiceDirectives.length > 0 && !voiceChatOpen && (
            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {voiceDirectives.slice(0, 5).map((d, i) => (
                <span key={i} style={{
                  fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#8b5cf6',
                  background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: '4px', padding: '3px 8px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {d.slice(0, 60)}{d.length > 60 ? '...' : ''}
                </span>
              ))}
              {voiceDirectives.length > 5 && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>
                  +{voiceDirectives.length - 5} more
                </span>
              )}
            </div>
          )}

          {/* Chat interface */}
          {voiceChatOpen && (
            <div style={{
              marginTop: '12px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {/* Chat messages */}
              <div style={{ maxHeight: '300px', overflowY: 'auto', padding: '12px' }}>
                {voiceChat.length === 0 && (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)', textAlign: 'center', padding: '20px 0' }}>
                    Tell the agent how to adjust its voice. Each message becomes a permanent directive.
                  </p>
                )}
                {voiceChat.map((msg) => (
                  <div key={msg.id} style={{
                    marginBottom: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.role === 'operator' ? 'flex-end' : 'flex-start',
                  }}>
                    <div style={{
                      maxWidth: '80%',
                      padding: '8px 12px',
                      borderRadius: '10px',
                      background: msg.role === 'operator' ? 'rgba(139,92,246,0.15)' : 'var(--surface-2)',
                      border: `1px solid ${msg.role === 'operator' ? 'rgba(139,92,246,0.3)' : 'var(--border)'}`,
                    }}>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text)', lineHeight: 1.5 }}>
                        {msg.content}
                      </p>
                      {msg.directive && (
                        <p style={{
                          fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#22c55e',
                          marginTop: '6px', padding: '3px 6px',
                          background: 'rgba(34,197,94,0.1)', borderRadius: '4px',
                        }}>
                          LOCKED IN: {msg.directive}
                        </p>
                      )}
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--text-dim)', marginTop: '2px' }}>
                      {msg.role === 'operator' ? 'you' : agentHandle ? `@${agentHandle}` : 'agent'}
                    </span>
                  </div>
                ))}
                {voiceSending && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0' }}>
                    <div className="wizard-spinner" style={{ width: '14px', height: '14px' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>thinking...</span>
                  </div>
                )}
              </div>

              {/* Input */}
              <div style={{
                display: 'flex', gap: '8px', padding: '10px 12px',
                borderTop: '1px solid var(--border)',
              }}>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Be more contrarian, use more data points, stop saying 'democratizing'..."
                  value={voiceInput}
                  onChange={(e) => setVoiceInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleVoiceSend(); } }}
                  disabled={voiceSending}
                  style={{ flex: 1, fontSize: '12px' }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  style={{ background: '#8b5cf6', flexShrink: 0 }}
                  disabled={!voiceInput.trim() || voiceSending}
                  onClick={handleVoiceSend}
                >
                  SEND
                </button>
              </div>

              {/* Active directives list */}
              {voiceDirectives.length > 0 && (
                <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'rgba(139,92,246,0.03)' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '6px' }}>
                    ACTIVE DIRECTIVES ({voiceDirectives.length})
                  </p>
                  {voiceDirectives.map((d, i) => (
                    <p key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#8b5cf6', marginBottom: '3px' }}>
                      {i + 1}. {d}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Active Rules (all learned + coached) ──────────────────────── */}
      {(voiceDirectives.length > 0 || learnedInsights.length > 0 || antiPatterns.length > 0) && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="#8b5cf6" strokeWidth="1.5" />
                <polyline points="5,8 7,10 11,6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h2>ACTIVE RULES</h2>
              <span className="section-count">{voiceDirectives.length + learnedInsights.length + antiPatterns.length} total</span>
            </div>
          </div>
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Voice coaching directives (operator-directed) */}
            {voiceDirectives.length > 0 && (
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderLeft: '3px solid #8b5cf6',
                borderRadius: 'var(--radius-lg)',
                padding: '12px 16px',
              }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', color: '#8b5cf6', marginBottom: '8px' }}>
                  FROM VOICE COACHING ({voiceDirectives.length})
                </p>
                {voiceDirectives.map((d, i) => (
                  <p key={i} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text)', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '12px', borderLeft: '2px solid rgba(139,92,246,0.3)' }}>
                    {d}
                  </p>
                ))}
              </div>
            )}

            {/* Learned insights (from performance data) */}
            {learnedInsights.length > 0 && (
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderLeft: '3px solid #22c55e',
                borderRadius: 'var(--radius-lg)',
                padding: '12px 16px',
              }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', color: '#22c55e', marginBottom: '8px' }}>
                  FROM PERFORMANCE DATA ({learnedInsights.length})
                </p>
                {learnedInsights.map((insight, i) => (
                  <p key={i} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text)', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '12px', borderLeft: '2px solid rgba(34,197,94,0.3)' }}>
                    {insight}
                  </p>
                ))}
              </div>
            )}

            {/* Anti-patterns (from worst performers) */}
            {antiPatterns.length > 0 && (
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderLeft: '3px solid #ef4444',
                borderRadius: 'var(--radius-lg)',
                padding: '12px 16px',
              }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', color: '#ef4444', marginBottom: '8px' }}>
                  BLOCKLIST ({antiPatterns.length})
                </p>
                {antiPatterns.map((ap, i) => (
                  <p key={i} style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '4px', paddingLeft: '12px', borderLeft: '2px solid rgba(239,68,68,0.3)' }}>
                    {ap}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Proactive Engagement ──────────────────────────────────────── */}
      {settings && agentConnected && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M8 1l2.5 5H15l-4 3.5L12.5 15 8 11.5 3.5 15 5 9.5 1 6h4.5L8 1z" stroke="#8b5cf6" strokeWidth="1.3" fill="none" />
              </svg>
              <h2>GROWTH ENGINE</h2>
            </div>
          </div>
          <div className="space-y-2" style={{ marginTop: '8px' }}>
            {/* Proactive replies */}
            <div className="protocol-card" style={{ padding: '10px 14px' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button className="btn btn-sm" style={{
                    background: settings.proactiveReplies ? '#22c55e' : 'var(--surface-2)',
                    color: settings.proactiveReplies ? '#fff' : 'var(--text-muted)',
                    border: `1px solid ${settings.proactiveReplies ? '#22c55e' : 'var(--border)'}`,
                    minWidth: '40px',
                  }} onClick={() => handleUpdateSettings({ proactiveReplies: !settings.proactiveReplies })}>
                    {settings.proactiveReplies ? 'ON' : 'OFF'}
                  </button>
                  <div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>REPLY TO VIRAL</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                      Jump into viral threads in your network for visibility
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Proactive likes */}
            <div className="protocol-card" style={{ padding: '10px 14px' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button className="btn btn-sm" style={{
                    background: settings.proactiveLikes ? '#22c55e' : 'var(--surface-2)',
                    color: settings.proactiveLikes ? '#fff' : 'var(--text-muted)',
                    border: `1px solid ${settings.proactiveLikes ? '#22c55e' : 'var(--border)'}`,
                    minWidth: '40px',
                  }} onClick={() => handleUpdateSettings({ proactiveLikes: !settings.proactiveLikes })}>
                    {settings.proactiveLikes ? 'ON' : 'OFF'}
                  </button>
                  <div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>AUTO-LIKE</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                      Like relevant tweets from your network
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Auto-follow */}
            <div className="protocol-card" style={{ padding: '10px 14px' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button className="btn btn-sm" style={{
                    background: settings.autoFollow ? '#22c55e' : 'var(--surface-2)',
                    color: settings.autoFollow ? '#fff' : 'var(--text-muted)',
                    border: `1px solid ${settings.autoFollow ? '#22c55e' : 'var(--border)'}`,
                    minWidth: '40px',
                  }} onClick={() => handleUpdateSettings({ autoFollow: !settings.autoFollow })}>
                    {settings.autoFollow ? 'ON' : 'OFF'}
                  </button>
                  <div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>SMART FOLLOW</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                      Follow relevant accounts for better trending data and inspiration (max 3/run)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Agent shoutouts */}
            <div className="protocol-card" style={{ padding: '10px 14px' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button className="btn btn-sm" style={{
                    background: settings.agentShoutouts ? '#22c55e' : 'var(--surface-2)',
                    color: settings.agentShoutouts ? '#fff' : 'var(--text-muted)',
                    border: `1px solid ${settings.agentShoutouts ? '#22c55e' : 'var(--border)'}`,
                    minWidth: '40px',
                  }} onClick={() => handleUpdateSettings({ agentShoutouts: !settings.agentShoutouts })}>
                    {settings.agentShoutouts ? 'ON' : 'OFF'}
                  </button>
                  <div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>AGENT SHOUTOUTS</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                      Cross-promote other Clawfable agents (~15% chance per queue refill)
                    </p>
                  </div>
                </div>
              </div>
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
