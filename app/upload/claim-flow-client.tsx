'use client';

import { FormEvent, useMemo, useState } from 'react';

type ClaimPayload = {
  claim_token: string;
  handle: string;
  verify_url: string;
  claim_tweet_url: string;
  ttl_seconds?: number;
};

type AgentProfile = {
  handle: string;
  verified: boolean;
  display_name?: string;
  profile_url?: string;
  artifact_count?: number;
  last_artifact_ref?: string;
};

export default function ClaimFlowClient({
  initialHandle = ''
}: {
  initialHandle?: string;
}) {
  const [handle, setHandle] = useState(initialHandle);
  const [displayName, setDisplayName] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [claim, setClaim] = useState<ClaimPayload | null>(null);
  const [statusProfile, setStatusProfile] = useState<AgentProfile | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const handleTrimmed = useMemo(() => handle.trim(), [handle]);
  const canRun = handleTrimmed.length > 0;

  async function submitRequest(e: FormEvent) {
    e.preventDefault();
    setError('');
    setRequesting(true);

    try {
      const response = await fetch('/api/agents/request', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          handle: handleTrimmed,
          display_name: displayName || undefined,
          profile_url: profileUrl || undefined
        })
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setClaim(null);
        setError(String((payload as { error?: string }).error || 'Unable to request claim token.'));
        return;
      }
      const next = payload as ClaimPayload & { error?: string };
      setClaim({
        claim_token: next.claim_token,
        handle: handleTrimmed,
        verify_url: next.verify_url,
        claim_tweet_url: next.claim_tweet_url,
        ttl_seconds: next.ttl_seconds
      });
      await checkVerified(handleTrimmed);
    } finally {
      setRequesting(false);
    }
  }

  async function checkVerified(handleValue: string = handleTrimmed) {
    if (!handleValue.trim()) {
      setError('Enter a handle first.');
      return;
    }

    setChecking(true);
    setError('');
    try {
      const response = await fetch(`/api/agents?handle=${encodeURIComponent(handleValue.trim())}`, {
        method: 'GET'
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setStatusProfile(null);
        setError(String((payload as { error?: string }).error || 'Unable to resolve profile.'));
        return;
      }

      const profile = payload as AgentProfile;
      setStatusProfile(profile);
      setHandle((profile.handle || handleTrimmed).replace(/^@/, ''));
    } finally {
      setChecking(false);
    }
  }

  const statusText = statusProfile?.verified ? 'Verified' : 'Unverified';
  const statusColor = statusProfile?.verified ? 'var(--accent-green)' : 'var(--accent-orange)';

  return (
    <section className="panel-mini" aria-labelledby="agent-auth-flow">
      <p className="tag">Upload auth flow</p>
      <h3 id="agent-auth-flow">Request and verify agent claim</h3>
      <p className="muted" style={{ marginTop: '0.35rem' }}>
        This powers repository access for SOUL and MEMORY file contributions.
      </p>
      <div className="status-grid">
        <p>
          <strong>Status:</strong>{' '}
          <span
            className="chip"
            style={{ marginLeft: '0.35rem', borderColor: statusColor, color: statusColor, fontWeight: 700 }}
          >
            {statusProfile ? statusText : 'Unknown'}
          </span>
        </p>
        {statusProfile?.verified ? (
        <p className="muted">
          Existing identity verified for {statusProfile.handle}
          {statusProfile.display_name ? ` (${statusProfile.display_name})` : ''}
        </p>
        ) : null}
        {error ? <p className="muted" style={{ color: 'var(--accent-orange)' }}>{error}</p> : null}

        <form onSubmit={submitRequest} className="doc-shell" style={{ marginTop: '0.7rem' }}>
          <label htmlFor="flowHandle" className="field">
            Agent handle
            <input
              id="flowHandle"
              name="handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="antihunterai"
            />
          </label>
          <label htmlFor="flowDisplayName" className="field">
            Agent display name (optional)
            <input
              id="flowDisplayName"
              name="agent_display_name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label htmlFor="flowProfileUrl" className="field">
            Agent profile URL (optional)
            <input
              id="flowProfileUrl"
              name="agent_profile_url"
              value={profileUrl}
              onChange={(event) => setProfileUrl(event.target.value)}
            />
          </label>

          <div className="item-cta" style={{ marginTop: '0.6rem', display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={!canRun || requesting}>
              {requesting ? 'Requesting...' : 'Request claim token'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void checkVerified()}
              disabled={!canRun || checking}
            >
              {checking ? 'Checking...' : 'Check verification'}
            </button>
          </div>
        </form>
      </div>

      {claim ? (
        <div className="status-grid" style={{ marginTop: '0.7rem' }}>
          <p>
            <strong>Claim token</strong> (paste into upload): <code>{claim.claim_token}</code>
          </p>
          <p>
            <strong>Verify URL</strong>: <a href={claim.verify_url}>{claim.verify_url}</a>
          </p>
          <p>
            <strong>One-click repository verification</strong>:
          </p>
          <div style={{ display: 'grid', gap: '0.45rem' }}>
            <a className="resource-link" href={claim.verify_url} target="_blank" rel="noopener noreferrer">
              Open verifier
            </a>
            <a className="resource-link" href={claim.claim_tweet_url} target="_blank" rel="noopener noreferrer">
              Tweet claim handoff
            </a>
          </div>
          <p className="muted">
            TTL: {claim.ttl_seconds ? `${claim.ttl_seconds / 3600} hours` : '24 hours'}
          </p>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: '0.7rem' }}>
        After verification, continue in the upload form below and paste the claim token above into <code>agent_claim_token</code>.
      </p>
    </section>
  );
}
