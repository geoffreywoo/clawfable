'use client';

import { useState } from 'react';
import type { AgentDetail } from '@/lib/types';

interface SettingsTabProps {
  agentId: string;
  agent: AgentDetail;
  onAgentDeleted: () => void;
  onAgentUpdated?: () => void;
}

export function SettingsTab({ agentId, agent, onAgentDeleted, onAgentUpdated }: SettingsTabProps) {
  // Identity
  const [agentName, setAgentName] = useState(agent.name);
  const [agentHandle, setAgentHandle] = useState(agent.handle);
  const [soulMd, setSoulMd] = useState(agent.soulMd);

  // X API keys
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accessSecret, setAccessSecret] = useState('');
  const [showFields, setShowFields] = useState({
    apiKey: false,
    apiSecret: false,
    accessToken: false,
    accessSecret: false,
  });

  // UI state
  const [savingSoul, setSavingSoul] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const isConnected = agent.isConnected === 1;
  const soulChanged = soulMd !== agent.soulMd || agentName !== agent.name || agentHandle !== agent.handle;
  const canConnect = apiKey && apiSecret && accessToken && accessSecret;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleSaveSoul = async () => {
    setSavingSoul(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agentName, handle: agentHandle, soulMd }),
      });
      if (!res.ok) throw new Error('Failed to save');
      showToast('Agent configuration saved');
      onAgentUpdated?.();
    } catch {
      showToast('Save failed');
    } finally {
      setSavingSoul(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiSecret, accessToken, accessSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Connected as @${data.user?.username}`);
      setApiKey('');
      setApiSecret('');
      setAccessToken('');
      setAccessSecret('');
      onAgentUpdated?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch(`/api/agents/${agentId}/disconnect`, { method: 'POST' });
      showToast('API keys removed');
      onAgentUpdated?.();
    } catch {
      showToast('Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
      showToast('Agent deleted');
      onAgentDeleted();
    } catch {
      showToast('Delete failed');
      setDeleting(false);
    }
  };

  const toggleField = (field: keyof typeof showFields) => {
    setShowFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <div style={{ maxWidth: '640px', position: 'relative' }} className="space-y-8">
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            padding: '8px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text)',
            zIndex: 200,
          }}
        >
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="section-title">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><circle cx="8" cy="8" r="3" stroke="#dc2626" strokeWidth="1.5" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" /></svg>
        <h2>AGENT SETTINGS</h2>
      </div>

      {/* ─── Identity ─────────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <p className="settings-section-label">Identity</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '0' }}>
          <div className="field">
            <label>Display Name</label>
            <input
              type="text"
              className="input"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              data-testid="input-agent-name-settings"
            />
          </div>
          <div className="field">
            <label>Twitter Handle</label>
            <div className="input-with-prefix">
              <span className="prefix">@</span>
              <input
                type="text"
                className="input"
                value={agentHandle}
                onChange={(e) => setAgentHandle(e.target.value.replace(/^@/, ''))}
                data-testid="input-agent-handle-settings"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── SOUL.md ──────────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="flex items-center justify-between" style={{ marginBottom: '16px' }}>
          <p className="settings-section-label" style={{ marginBottom: 0 }}>SOUL.md</p>
          <span className="label" style={{ textTransform: 'none' }}>{soulMd.length} chars</span>
        </div>
        <textarea
          className="textarea"
          value={soulMd}
          onChange={(e) => setSoulMd(e.target.value)}
          rows={16}
          data-testid="input-soul-md"
        />
        {agent.soulSummary && (
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid rgba(220,38,38,0.15)',
              borderRadius: '6px',
              padding: '10px 12px',
              marginTop: '10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-muted)',
              lineHeight: '1.7',
            }}
          >
            <span style={{ color: 'var(--primary)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
              Parsed Voice:{' '}
            </span>
            {agent.soulSummary}
          </div>
        )}
        <div style={{ marginTop: '12px' }}>
          <button
            className="btn btn-primary"
            disabled={!soulChanged || savingSoul}
            onClick={handleSaveSoul}
            data-testid="button-save-soul"
            style={{ background: soulChanged ? '#dc2626' : undefined }}
          >
            {savingSoul ? 'SAVING...' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>

      {/* ─── X API Connection ─────────────────────────────────────────────────── */}
      <div className="settings-section">
        {/* Status card */}
        <div className={`connection-status-card ${isConnected ? 'connected' : 'disconnected'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><circle cx="8" cy="8" r="7" stroke="#22c55e" strokeWidth="1.5" /><polyline points="4,8 7,11 12,5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><circle cx="8" cy="8" r="7" stroke="#dc2626" strokeWidth="1.5" /><line x1="5" y1="5" x2="11" y2="11" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" /><line x1="11" y1="5" x2="5" y2="11" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" /></svg>
              )}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: isConnected ? '#22c55e' : '#dc2626',
                }}
              >
                {isConnected ? 'X API CONNECTED' : 'X API DISCONNECTED'}
              </span>
            </div>
            {isConnected && (
              <button
                className="btn btn-danger btn-sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                data-testid="button-disconnect"
              >
                {disconnecting ? 'DISCONNECTING...' : 'DISCONNECT'}
              </button>
            )}
          </div>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: isConnected ? '#86efac' : 'var(--text-muted)',
            }}
          >
            {isConnected
              ? 'Connected — live posting and mentions sync enabled.'
              : 'Configure your X API keys below to enable live posting and mentions sync.'}
          </p>
        </div>

        {/* API key form */}
        <div className="flex items-center justify-between" style={{ marginBottom: '16px' }}>
          <p className="settings-section-label" style={{ marginBottom: 0 }}>X API Credentials</p>
          <a
            href="https://developer.x.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--primary)',
              textDecoration: 'none',
              letterSpacing: '0.1em',
            }}
          >
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none"><path d="M9 3H3v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><path d="M9 3L5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            X DEVELOPER PORTAL
          </a>
        </div>

        <div className="space-y-4">
          {[
            { key: 'apiKey', label: 'API Key (Consumer Key)', value: apiKey, setter: setApiKey },
            { key: 'apiSecret', label: 'API Secret (Consumer Secret)', value: apiSecret, setter: setApiSecret },
            { key: 'accessToken', label: 'Access Token', value: accessToken, setter: setAccessToken },
            { key: 'accessSecret', label: 'Access Token Secret', value: accessSecret, setter: setAccessSecret },
          ].map(({ key, label, value, setter }) => (
            <div key={key} className="field">
              <label>{label}</label>
              <div className="input-with-suffix">
                <input
                  type={showFields[key as keyof typeof showFields] ? 'text' : 'password'}
                  className="input"
                  style={{ paddingRight: '40px' }}
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  placeholder={`Enter ${label}...`}
                  data-testid={`input-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`}
                />
                <button
                  type="button"
                  className="suffix"
                  onClick={() => toggleField(key as keyof typeof showFields)}
                >
                  {showFields[key as keyof typeof showFields] ? (
                    <svg viewBox="0 0 14 14" width="13" height="13" fill="none"><path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" /><line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                  ) : (
                    <svg viewBox="0 0 14 14" width="13" height="13" fill="none"><path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" /><circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2" /></svg>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '16px' }}>
          <button
            className="btn btn-primary btn-wide"
            disabled={!canConnect || connecting}
            onClick={handleConnect}
            data-testid="button-connect"
            style={{ background: canConnect ? '#dc2626' : undefined }}
          >
            {connecting ? 'CONNECTING...' : 'CONNECT TO X'}
          </button>
        </div>

        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.7', marginTop: '10px' }}>
          Keys are stored in base64 encoding. Requires OAuth 1.0a User Context (Read + Write). Create your app at{' '}
          <a href="https://developer.x.com/en/portal/projects-and-apps" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
            developer.x.com
          </a>
          .
        </p>
      </div>

      {/* ─── Danger zone ──────────────────────────────────────────────────────── */}
      <div className="danger-zone">
        <div className="flex items-center gap-2 mb-3">
          <svg viewBox="0 0 14 14" width="13" height="13" fill="none"><path d="M7 2L13 12H1L7 2z" stroke="#ef4444" strokeWidth="1.3" strokeLinejoin="round" /><line x1="7" y1="6" x2="7" y2="9" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round" /><circle cx="7" cy="10.5" r="0.5" fill="#ef4444" /></svg>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ef4444' }}>
            Danger Zone
          </span>
        </div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Permanently delete this agent and all associated tweets, mentions, and metrics. This action cannot be undone.
        </p>
        {!deleteConfirm ? (
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setDeleteConfirm(true)}
            data-testid="button-delete-agent-confirm"
          >
            DELETE AGENT
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#ef4444' }}>Are you sure?</p>
            <button
              className="btn btn-sm"
              style={{ background: '#dc2626', color: '#fff', border: '1px solid #dc2626' }}
              disabled={deleting}
              onClick={handleDelete}
              data-testid="button-delete-agent-final"
            >
              {deleting ? 'DELETING...' : 'YES, DELETE'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setDeleteConfirm(false)}
            >
              CANCEL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
