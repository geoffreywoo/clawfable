'use client';

import { useState } from 'react';

type Mode = 'human' | 'ai';

export default function SoulStudioClient() {
  const [mode, setMode] = useState<Mode>('human');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');

  const [human, setHuman] = useState({
    handle: 'antihunterai',
    name: 'Anti Hunter',
    objective: 'compound money -> compute -> execution -> money under constraints',
    values: 'truth, speed, receipts, compounding',
    edge: 'execution under uncertainty + public verification',
    antiGoals: 'content churn, fake APY narratives, unverified claims',
    voice: 'direct, mythic, evidence-led',
    riskPolicy: 'high-risk financial actions require explicit human authorization'
  });

  const [ai, setAi] = useState({
    project: 'anti hunter',
    market: 'crypto-native teams and agent operators',
    compoundingLoop: 'execution -> receipts -> trust -> distribution -> better opportunities',
    moneyGoal: 'increase treasury and recurring service revenue',
    strategicGoal: 'be the most trusted proof-first agent operator',
    constraints: 'no unauthorized treasury action, no unverified factual claims',
    style: 'thesis-driven, compact, non-generic'
  });

  async function generate() {
    setStatus('generating...');
    const endpoint = mode === 'human' ? '/api/v1/soul-studio/human/draft' : '/api/v1/soul-studio/ai/draft';
    const payload = mode === 'human' ? human : ai;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await res.json();
    if (!res.ok) {
      setStatus(j.error || 'failed');
      return;
    }
    setDraft(j.soul_md || '');
    setStatus('draft ready');
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setMode('human')} style={{ padding: '8px 12px' }}>
          Human path
        </button>
        <button onClick={() => setMode('ai')} style={{ padding: '8px 12px' }}>
          AI path
        </button>
      </div>

      {mode === 'human' ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {Object.entries(human).map(([k, v]) => (
            <label key={k}>
              <div style={{ fontSize: 12 }}>{k}</div>
              <input value={v} onChange={(e) => setHuman({ ...human, [k]: e.target.value })} style={{ width: '100%', padding: 8 }} />
            </label>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {Object.entries(ai).map(([k, v]) => (
            <label key={k}>
              <div style={{ fontSize: 12 }}>{k}</div>
              <input value={v} onChange={(e) => setAi({ ...ai, [k]: e.target.value })} style={{ width: '100%', padding: 8 }} />
            </label>
          ))}
        </div>
      )}

      <button onClick={generate} style={{ marginTop: 12, padding: '8px 12px' }}>Generate SOUL draft</button>
      <div style={{ marginTop: 10, fontSize: 13 }}>{status}</div>
      <pre style={{ whiteSpace: 'pre-wrap', marginTop: 10, background: '#f6f6f6', padding: 10 }}>{draft}</pre>
    </div>
  );
}
