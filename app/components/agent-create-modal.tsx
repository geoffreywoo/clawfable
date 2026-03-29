'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const SOUL_PLACEHOLDER = `# SOUL.md — System Definition

I am [describe your agent's identity here].

## 1) Objective Function
Primary objective: [what this agent aims to achieve]

## 2) Communication Protocol
Default output: [how this agent communicates]
Tone: [contrarian / optimist / analyst / provocateur / educator]

## 3) Anti-Goals
Do not optimize for: [what to avoid]

## 4) Focus Areas
Topics: [ai, tech, crypto, finance, etc.]`;

interface AgentCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export function AgentCreateModal({ open, onClose, onCreated }: AgentCreateModalProps) {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [soulMd, setSoulMd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canCreate = handle.trim() && name.trim() && soulMd.trim();

  const handleCreate = async () => {
    if (!canCreate || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: handle.replace(/^@/, '').trim(),
          name: name.trim(),
          soulMd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create agent');
      onCreated?.();
      onClose();
      setHandle('');
      setName('');
      setSoulMd('');
      router.push(`/agent/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" style={{ flexShrink: 0 }}>
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="#8b5cf6" strokeWidth="1.5" />
              <circle cx="8" cy="8" r="2.5" stroke="#8b5cf6" strokeWidth="1.5" />
            </svg>
            New Agent
          </div>
          <p className="modal-description">
            Define a new Twitter bot agent. The SOUL.md determines its voice and personality.
          </p>
        </div>

        <div className="space-y-5">
          {/* Handle */}
          <div className="field">
            <label>Twitter Handle</label>
            <div className="input-with-prefix">
              <span className="prefix">@</span>
              <input
                type="text"
                className="input"
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
                placeholder="agenthandle"
                data-testid="input-agent-handle"
              />
            </div>
          </div>

          {/* Name */}
          <div className="field">
            <label>Display Name</label>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent Name"
              data-testid="input-agent-name"
            />
          </div>

          {/* SOUL.md */}
          <div className="field">
            <div className="flex items-center justify-between">
              <label>SOUL.md</label>
              <span className="label" style={{ textTransform: 'none' }}>{soulMd.length} chars</span>
            </div>
            <textarea
              className="textarea"
              value={soulMd}
              onChange={(e) => setSoulMd(e.target.value)}
              placeholder={SOUL_PLACEHOLDER}
              rows={14}
              data-testid="input-agent-soul"
            />
            <p className="label" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '10px', marginTop: 4 }}>
              Include tone indicators: contrarian, optimist, analyst, provocateur, or educator.
            </p>
          </div>

          {error && (
            <p style={{ color: '#ef4444', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              className="btn btn-outline flex-1"
              onClick={onClose}
              disabled={loading}
            >
              CANCEL
            </button>
            <button
              className="btn btn-primary flex-1"
              disabled={!canCreate || loading}
              onClick={handleCreate}
              data-testid="button-create-agent"
              style={{ background: canCreate ? '#8b5cf6' : undefined }}
            >
              {loading ? 'CREATING...' : 'CREATE AGENT'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
