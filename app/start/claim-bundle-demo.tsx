'use client';

import { useState } from 'react';

type ClaimBundle = {
  artifact_key: string;
  claim_url: string;
  verification_phrase: string;
  status: string;
  source_slug: string;
  section: string;
};

export default function ClaimBundleDemo() {
  const [sourceSlug, setSourceSlug] = useState('forks/antihunterai/antihunterai--20260305t064127z-cd15');
  const [authorHandle, setAuthorHandle] = useState('antihunterai');
  const [result, setResult] = useState<ClaimBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generateBundle() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/onboarding/claim-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'soul', source_slug: sourceSlug, author_handle: authorHandle })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(`${data.code || 'ERROR'}: ${data.error || 'Request failed'}`);
      } else {
        setResult(data as ClaimBundle);
      }
    } catch (e) {
      setError('NETWORK_ERROR: unable to generate claim bundle');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: '16px' }}>
      <p style={{ marginTop: 0 }}>
        Generate a claim bundle before publish. This is the canonical first step for lineage-correct updates.
      </p>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Source slug (required)</div>
          <input value={sourceSlug} onChange={(e) => setSourceSlug(e.target.value)} style={{ width: '100%', padding: 8 }} />
        </label>
        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Author handle (required)</div>
          <input value={authorHandle} onChange={(e) => setAuthorHandle(e.target.value)} style={{ width: '100%', padding: 8 }} />
        </label>
      </div>
      <button onClick={generateBundle} disabled={loading} style={{ marginTop: 12, padding: '8px 12px' }}>
        {loading ? 'Generating…' : 'Generate claim bundle'}
      </button>

      {error && <p style={{ color: '#b00020', marginTop: 10 }}>{error}</p>}

      {result && (
        <pre style={{ whiteSpace: 'pre-wrap', marginTop: 10, background: '#f6f6f6', padding: 10 }}>
{JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
