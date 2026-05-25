'use client';

import { useEffect, useState } from 'react';
import type { EngageSnapshot, EngagementAction, EngagementCandidate, EngagementSession } from '@/lib/types';

interface EngageTabProps {
  agentId: string;
}

interface CompanionHealth {
  ok: boolean;
  paired: boolean;
  machineLabel: string | null;
  currentHandle: string | null;
  runningActionId: string | null;
  lastError: string | null;
}

function getTimeAgo(ts: string | null | undefined): string {
  if (!ts) return 'never';
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const mins = Math.floor(deltaSeconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncate(value: string, max = 220): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function emptyHealth(): CompanionHealth {
  return {
    ok: false,
    paired: false,
    machineLabel: null,
    currentHandle: null,
    runningActionId: null,
    lastError: null,
  };
}

export function EngageTab({ agentId }: EngageTabProps) {
  const [snapshot, setSnapshot] = useState<EngageSnapshot | null>(null);
  const [session, setSession] = useState<EngagementSession | null>(null);
  const [health, setHealth] = useState<CompanionHealth>(emptyHealth());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [resolvedCandidate, setResolvedCandidate] = useState<EngagementCandidate | null>(null);
  const [dirtyDraft, setDirtyDraft] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };

  const localUrl = snapshot?.companion.localUrl || 'http://127.0.0.1:48123';

  const loadSnapshot = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/dashboard?sections=engage`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load Engage');
      const engage = (data?.engage ?? null) as EngageSnapshot | null;
      setSnapshot(engage);
      if (!dirtyDraft || engage?.currentSession?.state !== 'draft') {
        setSession(engage?.currentSession ?? null);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load Engage');
    } finally {
      setLoading(false);
    }
  };

  const loadLocalHealth = async () => {
    try {
      const res = await fetch(`${localUrl}/health`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Local companion unavailable');
      const data = await res.json();
      setHealth({
        ok: true,
        paired: !!data?.paired,
        machineLabel: typeof data?.machineLabel === 'string' ? data.machineLabel : null,
        currentHandle: typeof data?.currentHandle === 'string' ? data.currentHandle.replace(/^@/, '') : null,
        runningActionId: typeof data?.runningActionId === 'string' ? data.runningActionId : null,
        lastError: typeof data?.lastError === 'string' ? data.lastError : null,
      });
    } catch {
      setHealth(emptyHealth());
    }
  };

  useEffect(() => {
    void loadSnapshot();
    const interval = window.setInterval(() => {
      void loadSnapshot();
    }, 6000);
    return () => window.clearInterval(interval);
  }, [agentId, dirtyDraft]);

  useEffect(() => {
    void loadLocalHealth();
    const interval = window.setInterval(() => {
      void loadLocalHealth();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [localUrl]);

  const currentSession = session || snapshot?.currentSession || null;
  const currentActions = currentSession?.actions || [];
  const queuedKeys = new Set(currentActions.map((action) => `${action.type}:${action.candidate.tweetId}`));
  const accountMismatch = !!(
    currentSession?.lastError && /account mismatch/i.test(currentSession.lastError)
  ) || !!(
    health.currentHandle
    && snapshot?.companion.latestPairing?.currentAgentHandle
    && health.currentHandle !== snapshot.companion.latestPairing.currentAgentHandle
  );

  const syncSession = async (actions: EngagementAction[]) => {
    setBusy('sync');
    try {
      const res = await fetch(`/api/agents/${agentId}/engage/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession?.id || undefined,
          actions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save Engage session');
      setSession(data.session);
      setDirtyDraft(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save session');
    } finally {
      setBusy(null);
    }
  };

  const upsertAction = async (action: EngagementAction) => {
    const next = [...currentActions.filter((entry) => entry.id !== action.id && `${entry.type}:${entry.candidate.tweetId}` !== `${action.type}:${action.candidate.tweetId}`), action];
    await syncSession(next);
  };

  const handleQueueLike = async (candidate: EngagementCandidate) => {
    if (queuedKeys.has(`like:${candidate.tweetId}`)) {
      showToast('Like already queued in this session');
      return;
    }
    await upsertAction({
      id: crypto.randomUUID(),
      type: 'like',
      status: 'pending',
      candidate,
      draft: null,
      resultTweetId: null,
      resultTweetUrl: null,
      proof: null,
      failureReason: null,
      startedAt: null,
      completedAt: null,
    });
  };

  const handleDraftReply = async (candidate: EngagementCandidate) => {
    if (queuedKeys.has(`reply:${candidate.tweetId}`)) {
      showToast('Reply already queued in this session');
      return;
    }

    setBusy(`reply:${candidate.tweetId}`);
    try {
      const res = await fetch(`/api/agents/${agentId}/engage/draft-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to draft reply');
      await upsertAction({
        id: crypto.randomUUID(),
        type: 'reply',
        status: 'pending',
        candidate,
        draft: data.draft,
        resultTweetId: null,
        resultTweetUrl: null,
        proof: null,
        failureReason: null,
        startedAt: null,
        completedAt: null,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to draft reply');
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveAction = async (actionId: string) => {
    await syncSession(currentActions.filter((action) => action.id !== actionId));
  };

  const handleDraftChange = (actionId: string, content: string) => {
    if (!currentSession) return;
    setDirtyDraft(true);
    setSession({
      ...currentSession,
      actions: currentSession.actions.map((action) => (
        action.id === actionId && action.draft
          ? {
              ...action,
              draft: {
                ...action.draft,
                content,
                edited: content !== action.draft.originalContent,
                updatedAt: new Date().toISOString(),
              },
            }
          : action
      )),
    });
  };

  const handleDraftBlur = async () => {
    if (!dirtyDraft || !currentSession) return;
    await syncSession(currentSession.actions);
  };

  const handleResolveTarget = async () => {
    if (!resolvedUrl.trim()) return;
    setBusy('resolve');
    try {
      const res = await fetch(`/api/agents/${agentId}/engage/resolve-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: resolvedUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve tweet URL');
      setResolvedCandidate(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to resolve target');
    } finally {
      setBusy(null);
    }
  };

  const handlePairCompanion = async () => {
    setBusy('pair');
    try {
      const challengeRes = await fetch('/api/browser-companion/pairings', { method: 'POST' });
      const challengeData = await challengeRes.json();
      if (!challengeRes.ok) throw new Error(challengeData.error || 'Failed to create pairing challenge');

      const localRes = await fetch(`${challengeData.localUrl || localUrl}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appUrl: window.location.origin,
          challenge: challengeData.challenge,
          machineLabel: window.navigator.platform || 'Desktop browser',
        }),
      });
      const localData = await localRes.json();
      if (!localRes.ok) throw new Error(localData.error || 'Local companion pairing failed');

      showToast('Browser companion paired');
      await loadSnapshot();
      await loadLocalHealth();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to pair local companion');
    } finally {
      setBusy(null);
    }
  };

  const mutateSession = async (action: 'approve' | 'abort' | 'clear-failed') => {
    if (!currentSession) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/agents/${agentId}/engage/sessions/${currentSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} session`);
      setSession(data);
      await loadSnapshot();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update session');
    } finally {
      setBusy(null);
    }
  };

  const renderCandidateCard = (candidate: EngagementCandidate, emphasis: 'feed' | 'pasted' = 'feed') => {
    const likeKey = `like:${candidate.tweetId}`;
    const replyKey = `reply:${candidate.tweetId}`;
    const likeQueued = queuedKeys.has(likeKey);
    const replyQueued = queuedKeys.has(replyKey);

    return (
      <article key={`${emphasis}:${candidate.tweetId}`} className="engage-card">
        <div className="engage-card-head">
          <div>
            <p className="engage-card-kicker">@{candidate.authorHandle}</p>
            <h3 className="engage-card-title">{candidate.source === 'pasted' ? 'Operator-selected target' : candidate.scoreReason}</h3>
          </div>
          <span className="engage-score-pill">{candidate.score}</span>
        </div>

        <p className="engage-card-copy">{truncate(candidate.text, emphasis === 'pasted' ? 320 : 220)}</p>

        <div className="engage-card-meta">
          <span>{candidate.likes} likes</span>
          <span>{getTimeAgo(candidate.createdAt)}</span>
          <a href={candidate.tweetUrl} target="_blank" rel="noreferrer">Open on X</a>
        </div>

        <div className="engage-card-actions">
          <button className="btn btn-outline btn-sm" disabled={likeQueued || busy !== null && busy !== `like:${candidate.tweetId}`} onClick={() => void handleQueueLike(candidate)}>
            {likeQueued ? 'Like queued' : 'Queue like'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={replyQueued || busy === `reply:${candidate.tweetId}`}
            onClick={() => void handleDraftReply(candidate)}
          >
            {replyQueued ? 'Reply ready' : busy === `reply:${candidate.tweetId}` ? 'Drafting...' : 'Draft reply'}
          </button>
        </div>
      </article>
    );
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((index) => (
          <div key={index} className="skeleton" style={{ height: '120px', borderRadius: '14px' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="engage-shell" style={{ position: 'relative' }}>
      {toast && (
        <div className="engage-toast">
          {toast}
        </div>
      )}

      <div className="engage-grid engage-grid-top">
        <section className="engage-panel">
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <rect x="2.25" y="3" width="11.5" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="5" cy="8" r="1.1" fill="currentColor" />
                <path d="M7.4 8h3.4M7.4 10.4h2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <h2>Companion status</h2>
              <span className="section-count">{health.ok ? 'local companion online' : 'not detected'}</span>
            </div>
          </div>

          <div className="engage-status-stack">
            <div className="engage-status-card">
              <span className="engage-status-label">Browser companion</span>
              <strong className="engage-status-value">{health.ok ? 'Detected' : 'Offline'}</strong>
              <p className="engage-status-note">
                {health.ok
                  ? `Listening on ${localUrl}`
                  : `Run the local companion on this machine, then pair it to execute supervised likes and replies.`}
              </p>
            </div>

            <div className="engage-status-card">
              <span className="engage-status-label">Pairing</span>
              <strong className="engage-status-value">
                {snapshot?.companion.latestPairing ? snapshot.companion.latestPairing.machineLabel : 'Not paired'}
              </strong>
              <p className="engage-status-note">
                {snapshot?.companion.latestPairing
                  ? `Last heartbeat ${getTimeAgo(snapshot.companion.latestPairing.lastHeartbeatAt)}`
                  : 'No active pairing yet. Pair once from this dashboard and keep the browser visible.'}
              </p>
            </div>

            <div className={`engage-status-card ${accountMismatch ? 'warning' : ''}`}>
              <span className="engage-status-label">Visible X account</span>
              <strong className="engage-status-value">{health.currentHandle ? `@${health.currentHandle}` : 'Unknown'}</strong>
              <p className="engage-status-note">
                {accountMismatch
                  ? 'The visible X account does not match the locked agent handle. Switch accounts before continuing.'
                  : health.lastError || 'The companion verifies the current account before each action.'}
              </p>
            </div>
          </div>

          <div className="engage-inline-actions">
            <button className="btn btn-outline btn-sm" disabled={!health.ok || busy === 'pair'} onClick={() => void handlePairCompanion()}>
              {busy === 'pair' ? 'PAIRING…' : 'PAIR COMPANION'}
            </button>
            {currentSession && ['approved', 'running'].includes(currentSession.state) && (
              <button className="btn btn-danger btn-sm" disabled={busy === 'abort'} onClick={() => void mutateSession('abort')}>
                {busy === 'abort' ? 'STOPPING…' : 'EMERGENCY STOP'}
              </button>
            )}
          </div>

          <div className="engage-recent-sessions">
            <span className="engage-status-label">Recent sessions</span>
            {(snapshot?.recentSessions || []).slice(0, 4).map((item) => (
              <div key={item.id} className="engage-recent-row">
                <span>{item.id}</span>
                <span className={`engage-session-pill ${item.state}`}>{item.state}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="engage-panel">
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M2 4.5h12M2 8h12M2 11.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <h2>Paste tweet URL</h2>
              <span className="section-count">arbitrary-target intake</span>
            </div>
          </div>

          <p className="engage-panel-copy">
            Use this for specific targets. Paste a tweet URL, resolve the target on the server, then add a like or a reply to the current session.
          </p>

          <div className="engage-input-row">
            <input
              className="engage-input"
              placeholder="https://x.com/handle/status/1234567890"
              value={resolvedUrl}
              onChange={(event) => setResolvedUrl(event.target.value)}
            />
            <button className="btn btn-primary btn-sm" disabled={busy === 'resolve'} onClick={() => void handleResolveTarget()}>
              {busy === 'resolve' ? 'RESOLVING…' : 'RESOLVE'}
            </button>
          </div>

          {resolvedCandidate ? renderCandidateCard(resolvedCandidate, 'pasted') : (
            <div className="protocol-empty" style={{ minHeight: '220px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                Resolved targets appear here with the same queue controls as the ranked feed.
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="engage-grid engage-grid-bottom">
        <section className="engage-panel">
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M3 8c0-2.8 2.2-5 5-5 1.9 0 3.5.8 4.5 2.1M13 8c0 2.8-2.2 5-5 5-1.9 0-3.5-.8-4.5-2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M11.3 2.6l1.4 2.5-2.7.2M4.7 13.4l-1.4-2.5 2.7-.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h2>Ranked feed</h2>
              <span className="section-count">{snapshot?.candidateFeed.length || 0} candidates</span>
            </div>
          </div>

          {(snapshot?.candidateFeed || []).length > 0 ? (
            <div className="engage-card-list">
              {(snapshot?.candidateFeed || []).map((candidate) => renderCandidateCard(candidate))}
            </div>
          ) : (
            <div className="protocol-empty" style={{ minHeight: '280px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                No ranked feed candidates right now. If trending cache is empty, Engage will refill it on demand.
              </p>
            </div>
          )}
        </section>

        <section className="engage-panel">
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M3 3.5h10v9H3z" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 6.5h6M5 9h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <h2>Session queue</h2>
              <span className="section-count">{currentActions.length} queued actions</span>
            </div>
          </div>

          {currentSession ? (
            <>
              <div className="engage-session-head">
                <div>
                  <span className={`engage-session-pill ${currentSession.state}`}>{currentSession.state}</span>
                  <p className="engage-panel-copy" style={{ marginTop: '10px' }}>
                    One approval starts the whole session. The companion then executes the queue in the visible browser until it finishes, fails, or you abort it.
                  </p>
                </div>
                <div className="engage-inline-actions">
                  {currentSession.state === 'draft' && (
                    <button className="btn btn-primary btn-sm" disabled={busy === 'approve' || currentActions.length === 0} onClick={() => void mutateSession('approve')}>
                      {busy === 'approve' ? 'APPROVING…' : 'APPROVE SESSION'}
                    </button>
                  )}
                  {currentSession.state === 'failed' && (
                    <button className="btn btn-outline btn-sm" disabled={busy === 'clear-failed'} onClick={() => void mutateSession('clear-failed')}>
                      {busy === 'clear-failed' ? 'CLEARING…' : 'CLEAR FAILED'}
                    </button>
                  )}
                </div>
              </div>

              <div className="engage-queue-list">
                {currentActions.map((action) => (
                  <article key={action.id} className="engage-queue-card">
                    <div className="engage-queue-head">
                      <div>
                        <span className="engage-status-label">{action.type}</span>
                        <h3 className="engage-card-title">@{action.candidate.authorHandle}</h3>
                      </div>
                      <span className={`engage-session-pill ${action.status}`}>{action.status}</span>
                    </div>

                    <p className="engage-card-copy">{truncate(action.candidate.text, 180)}</p>

                    {action.type === 'reply' && action.draft && (
                      <textarea
                        className="engage-textarea"
                        value={action.draft.content}
                        disabled={currentSession.state !== 'draft'}
                        onChange={(event) => handleDraftChange(action.id, event.target.value)}
                        onBlur={() => void handleDraftBlur()}
                      />
                    )}

                    {action.failureReason && (
                      <div className="engage-inline-note warning">{action.failureReason}</div>
                    )}

                    {action.proof?.localPath && (
                      <div className="engage-inline-note">
                        Proof saved to {action.proof.localPath}
                      </div>
                    )}

                    {currentSession.state === 'draft' && (
                      <div className="engage-inline-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => void handleRemoveAction(action.id)}>
                          REMOVE
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="protocol-empty" style={{ minHeight: '320px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                Queue likes and reply drafts here, then approve once when the browser companion is ready.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
