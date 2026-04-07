'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Tweet, ProtocolSettings } from '@/lib/types';

interface QueueTabProps {
  agentId: string;
}

const QUEUE_REFRESH_INTERVAL_MS = 15000;

export function QueueTab({ agentId }: QueueTabProps) {
  const [queue, setQueue] = useState<Tweet[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentConnected, setAgentConnected] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [postingId, setPostingId] = useState<string | null>(null);
  const [isPostingAll, setIsPostingAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [autopilotSettings, setAutopilotSettings] = useState<ProtocolSettings | null>(null);
  const [remixingId, setRemixingId] = useState<string | null>(null);
  const [remixOpenId, setRemixOpenId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Tweet | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deletionFeedback, setDeletionFeedback] = useState<Record<string, string>>({});
  const [submittingDeletionId, setSubmittingDeletionId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/queue`, { cache: 'no-store' });
      const data = await res.json();
      const visibleTweets = Array.isArray(data)
        ? data.filter((tweet): tweet is Tweet =>
            Boolean(tweet) && (tweet.status === 'queued' || tweet.status === 'deleted_from_x'))
        : [];
      setQueue(visibleTweets);
    } catch {}
  }, [agentId]);

  const loadAgentMeta = useCallback(async () => {
    try {
      const a = await fetch(`/api/agents/${agentId}`, { cache: 'no-store' }).then((r) => r.json());
      setAgentConnected(a.isConnected === 1);
    } catch {}
  }, [agentId]);

  const loadAutopilotSettings = useCallback(async () => {
    try {
      const p = await fetch(`/api/agents/${agentId}/protocol/settings`, { cache: 'no-store' }).then((r) => r.ok ? r.json() : null);
      if (p?.settings) setAutopilotSettings(p.settings);
    } catch {}
  }, [agentId]);

  const refreshQueueState = useCallback(async () => {
    await Promise.allSettled([
      loadQueue(),
      loadAgentMeta(),
      loadAutopilotSettings(),
    ]);
  }, [loadAgentMeta, loadAutopilotSettings, loadQueue]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshQueueState();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshQueueState]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshQueueState();
    };

    const interval = window.setInterval(refreshIfVisible, QUEUE_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [refreshQueueState]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied');
    } catch {
      showToast('Copy failed');
    }
  };

  const handleCopyAll = async () => {
    const queuedTweets = queue.filter((tweet) => tweet.status === 'queued');
    if (!queuedTweets.length) return;
    const all = queuedTweets.map((tweet, i) => `${i + 1}. ${tweet.content}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(all);
      showToast(`${queuedTweets.length} tweets copied`);
    } catch {
      showToast('Copy failed');
    }
  };

  const handleSave = async () => {
    if (!editingId) return;
    try {
      await fetch(`/api/agents/${agentId}/queue/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      setEditingId(null);
      showToast('Tweet updated');
      loadQueue();
    } catch {
      showToast('Save failed');
    }
  };

  const handleMarkPosted = async (id: string) => {
    try {
      await fetch(`/api/agents/${agentId}/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'posted' }),
      });
      showToast('Marked as posted');
      loadQueue();
    } catch {}
  };

  const handleDelete = async (skipReason = false) => {
    if (!deleteTarget) return;
    try {
      setDeleteSubmitting(true);
      const res = await fetch(`/api/agents/${agentId}/queue/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skipReason ? {} : { reason: deleteReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Delete failed');

      setDeleteTarget(null);
      setDeleteReason('');
      showToast(
        data.feedbackSource === 'user'
          ? 'Removed from queue and saved to voice memory'
          : 'Removed from queue. Intent inferred for voice tuning'
      );
      loadQueue();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handlePostToX = async (tweet: Tweet) => {
    if (!agentConnected) return;
    setPostingId(tweet.id);
    try {
      const res = await fetch(`/api/agents/${agentId}/twitter/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('Posted to X!');
      loadQueue();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Post failed');
    } finally {
      setPostingId(null);
    }
  };

  const handleRemix = async (tweet: Tweet, direction: string, prompt?: string) => {
    setRemixingId(tweet.id);
    try {
      const res = await fetch(`/api/agents/${agentId}/remix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tweetId: tweet.id,
          content: tweet.content,
          direction: prompt ? undefined : direction,
          customPrompt: prompt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Update in local state
      setQueue((prev) => prev.map((t) => t.id === tweet.id ? { ...t, content: data.content } : t));
      showToast(`Remixed: ${direction || 'custom'}`);
      setRemixOpenId(null);
      setCustomPrompt('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Remix failed');
    } finally {
      setRemixingId(null);
    }
  };

  const handleDeletionFeedback = async (tweetId: string) => {
    const reason = deletionFeedback[tweetId]?.trim();
    if (!reason) return;
    setSubmittingDeletionId(tweetId);
    try {
      const res = await fetch(`/api/agents/${agentId}/queue/${tweetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletionReason: reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save feedback');
      setQueue((prev) => prev.filter((t) => t.id !== tweetId));
      showToast('Feedback saved — voice will adapt');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save feedback');
    } finally {
      setSubmittingDeletionId(null);
    }
  };

  const handlePostAll = async () => {
    const postableTweets = queue.filter((tweet) => tweet.status === 'queued');
    if (!postableTweets.length || !agentConnected) return;
    setIsPostingAll(true);
    let posted = 0;
    let failed = 0;
    for (const tweet of postableTweets) {
      try {
        const res = await fetch(`/api/agents/${agentId}/twitter/post`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Post failed');
        posted++;
        showToast(`Posted ${posted}/${postableTweets.length}`);
      } catch {
        failed++;
      }
      if (posted + failed < postableTweets.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    setIsPostingAll(false);
    if (failed > 0) {
      showToast(`Posted ${posted}/${postableTweets.length}. ${failed} failed.`);
    } else if (postableTweets.length > 0) {
      showToast(`Posted all ${postableTweets.length} queued tweets`);
    }
    loadQueue();
  };

  const queuedTweets = queue.filter((tweet) => tweet.status === 'queued');
  const feedbackTweets = queue.filter((tweet) => tweet.status === 'deleted_from_x');

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
    <div className="space-y-4" style={{ position: 'relative' }}>
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

      {/* Autopilot status banner */}
      {autopilotSettings && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', borderRadius: 'var(--radius)',
          background: autopilotSettings.enabled ? 'rgba(34, 197, 94, 0.08)' : 'var(--surface)',
          border: `1px solid ${autopilotSettings.enabled ? 'rgba(34, 197, 94, 0.2)' : 'var(--border)'}`,
        }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: autopilotSettings.enabled ? '#22c55e' : 'var(--text-dim)',
            boxShadow: autopilotSettings.enabled ? '0 0 6px rgba(34, 197, 94, 0.4)' : 'none',
          }} />
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: autopilotSettings.enabled ? '#22c55e' : 'var(--text-muted)' }}>
            {autopilotSettings.enabled ? (
              <>
                <span style={{ fontWeight: 700 }}>AUTOPILOT ON</span>
                {' — posting ~'}{autopilotSettings.postsPerDay}x/day from this queue.
                {autopilotSettings.lastPostedAt && (
                  <> Next post in ~{Math.max(0, Math.round(
                    ((24 / autopilotSettings.postsPerDay) * 60) -
                    ((Date.now() - new Date(autopilotSettings.lastPostedAt).getTime()) / 60000)
                  ))} min.</>
                )}
                {' Queue auto-refills below '}{autopilotSettings.minQueueSize}{' items.'}
              </>
            ) : (
              <>
                <span style={{ fontWeight: 700 }}>AUTOPILOT OFF</span>
                {' — tweets in this queue must be posted manually. Enable in the Autopilot tab.'}
              </>
            )}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="section-header">
        <div className="section-title">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><line x1="3" y1="4" x2="13" y2="4" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" /><line x1="3" y1="8" x2="13" y2="8" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" /><line x1="3" y1="12" x2="9" y2="12" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" /></svg>
          <h2>TWEET QUEUE</h2>
          <span className="section-count">{queuedTweets.length} items</span>
        </div>
        {queuedTweets.length > 0 && (
          <div className="flex gap-2">
            <button className="btn btn-outline btn-sm" onClick={handleCopyAll} data-testid="button-copy-all">
              COPY ALL
            </button>
            <button
              className="btn btn-sm"
              style={{
                border: agentConnected ? '1px solid rgba(239,68,68,0.4)' : '1px solid var(--border)',
                color: agentConnected ? '#ef4444' : 'var(--text-dim)',
                background: 'transparent',
                opacity: agentConnected ? 1 : 0.4,
              }}
              disabled={!agentConnected || isPostingAll}
              onClick={handlePostAll}
              data-testid="button-post-all"
              title={!agentConnected ? 'Connect X API in Settings first' : 'Post all queued tweets'}
            >
              {isPostingAll ? 'POSTING...' : 'POST ALL'}
            </button>
          </div>
        )}
      </div>

      {/* Deleted from X — needs feedback */}
      {feedbackTweets.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div className="section-header" style={{ marginBottom: '8px' }}>
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M8 2L14 14H2L8 2z" stroke="#f59e0b" strokeWidth="1.3" strokeLinejoin="round" />
                <line x1="8" y1="7" x2="8" y2="10" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round" />
                <circle cx="8" cy="12" r="0.5" fill="#f59e0b" />
              </svg>
              <h2>DELETED FROM X</h2>
              <span className="section-count">Tell us why so the AI can learn</span>
            </div>
          </div>
          <div className="space-y-2">
            {feedbackTweets.map((tweet) => (
              <div key={tweet.id} style={{
                background: 'rgba(245, 158, 11, 0.05)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                borderRadius: 'var(--radius-lg)',
                padding: '14px',
              }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '10px' }}>
                  {tweet.content.slice(0, 200)}{tweet.content.length > 200 ? '...' : ''}
                </p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Why did you delete this? (e.g. off-topic, too aggressive, factually wrong)"
                    value={deletionFeedback[tweet.id] || ''}
                    onChange={(e) => setDeletionFeedback((prev) => ({ ...prev, [tweet.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleDeletionFeedback(tweet.id); }}
                    style={{ flex: 1, fontSize: '12px' }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ background: '#f59e0b', flexShrink: 0 }}
                    disabled={!deletionFeedback[tweet.id]?.trim() || submittingDeletionId === tweet.id}
                    onClick={() => handleDeletionFeedback(tweet.id)}
                  >
                    {submittingDeletionId === tweet.id ? '...' : 'SAVE'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '9px', flexShrink: 0 }}
                    onClick={async () => {
                      const res = await fetch(`/api/agents/${agentId}/queue/${tweet.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ deletionReason: 'skipped' }),
                      }).catch(() => null);
                      if (res?.ok) {
                        setQueue((prev) => prev.filter((t) => t.id !== tweet.id));
                        showToast('Skipped — inferred reason kept for learning');
                      } else {
                        showToast('Failed to skip');
                      }
                    }}
                  >
                    SKIP
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {queuedTweets.length === 0 && feedbackTweets.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none"><line x1="5" y1="8" x2="27" y2="8" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" /><line x1="5" y1="16" x2="27" y2="16" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" /><line x1="5" y1="24" x2="18" y2="24" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" /></svg>
          <p>Queue empty</p>
          <p>Generate takes from the FEED tab and queue them here</p>
        </div>
      )}

      {/* Queue items */}
      <div className="space-y-3">
        {queuedTweets.map((tweet, idx) => (
          <div key={tweet.id} className="tweet-card" data-testid={`card-queue-${tweet.id}`}>
            <div className="flex items-start gap-3">
              <span className="tweet-queue-num">{String(idx + 1).padStart(2, '0')}</span>
              <div className="flex-1 min-w-0">
                {editingId === tweet.id ? (
                  <div className="space-y-2">
                    <textarea
                      className="textarea"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      data-testid={`input-edit-${tweet.id}`}
                    />
                    <div className="flex items-center gap-2">
                      <span className={`char-count ${editContent.length > 280 ? 'over' : ''}`}>
                        {editContent.length}/280
                      </span>
                      <button className="btn btn-xs btn-success" onClick={handleSave} data-testid={`button-save-${tweet.id}`}>SAVE</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => setEditingId(null)} data-testid={`button-cancel-${tweet.id}`}>CANCEL</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="tweet-content" style={{ marginBottom: '8px' }}>{tweet.content}</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="badge">{tweet.status}</span>
                      {tweet.type !== 'original' && <span className="badge">{tweet.type}</span>}
                      <span className="char-count">{tweet.content.length}/280</span>
                      {tweet.topic && (
                        <span className="label" style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-inter)' }}>
                          {tweet.topic}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Remix panel */}
              {remixOpenId === tweet.id && editingId !== tweet.id && (
                <div style={{
                  padding: '10px 12px', marginTop: '8px', marginBottom: '4px',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    REMIX DIRECTION
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
                    {[
                      { id: 'shorter', label: 'Shorter', icon: '↓' },
                      { id: 'longer', label: 'Longer', icon: '↑' },
                      { id: 'spicier', label: 'Spicier', icon: '🔥' },
                      { id: 'softer', label: 'Softer', icon: '~' },
                      { id: 'funnier', label: 'Funnier', icon: '😏' },
                      { id: 'data', label: 'Add Data', icon: '#' },
                      { id: 'question', label: 'As Question', icon: '?' },
                      { id: 'contrarian', label: 'Flip Take', icon: '⟲' },
                    ].map((d) => (
                      <button
                        key={d.id}
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: '10px', padding: '3px 8px', height: '24px' }}
                        disabled={remixingId === tweet.id}
                        onClick={() => handleRemix(tweet, d.id)}
                      >
                        {remixingId === tweet.id ? '...' : `${d.icon} ${d.label}`}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input"
                      style={{ fontSize: '11px', padding: '4px 8px', flex: 1 }}
                      placeholder="Custom instruction: e.g. 'make it about AI safety' or 'add a metaphor'"
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customPrompt.trim()) {
                          handleRemix(tweet, 'custom', customPrompt.trim());
                        }
                      }}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ background: '#8b5cf6', fontSize: '10px', height: '28px' }}
                      disabled={!customPrompt.trim() || remixingId === tweet.id}
                      onClick={() => handleRemix(tweet, 'custom', customPrompt.trim())}
                    >
                      {remixingId === tweet.id ? '...' : 'REMIX'}
                    </button>
                  </div>
                </div>
              )}

              {/* Actions */}
              {editingId !== tweet.id && (
                <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{
                      color: agentConnected ? '#ef4444' : 'var(--text-dim)',
                      opacity: agentConnected ? 1 : 0.4,
                    }}
                    disabled={!agentConnected || postingId === tweet.id}
                    onClick={() => handlePostToX(tweet)}
                    data-testid={`button-post-x-${tweet.id}`}
                    title={!agentConnected ? 'Connect X API first' : 'Post to X'}
                  >
                    {postingId === tweet.id ? 'POSTING...' : 'POST TO X'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleCopy(tweet.content)}
                    data-testid={`button-copy-queue-${tweet.id}`}
                    title="Copy"
                    style={{ padding: '4px 8px' }}
                  >
                    <svg viewBox="0 0 14 14" width="13" height="13" fill="none"><rect x="1" y="3" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M4 3V2a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.3" /></svg>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setRemixOpenId(remixOpenId === tweet.id ? null : tweet.id); setCustomPrompt(''); }}
                    title="Remix"
                    style={{ padding: '4px 8px', color: remixOpenId === tweet.id ? '#8b5cf6' : undefined }}
                  >
                    <svg viewBox="0 0 14 14" width="13" height="13" fill="none"><path d="M2 10l3-3 2 2 5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M8 4h4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setEditingId(tweet.id); setEditContent(tweet.content); }}
                    data-testid={`button-edit-${tweet.id}`}
                    title="Edit"
                    style={{ padding: '4px 8px' }}
                  >
                    <svg viewBox="0 0 14 14" width="13" height="13" fill="none"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleMarkPosted(tweet.id)}
                    data-testid={`button-mark-posted-${tweet.id}`}
                    title="Mark as posted"
                    style={{ padding: '4px 8px', color: 'var(--green)' }}
                  >
                    <svg viewBox="0 0 14 14" width="13" height="13" fill="none"><polyline points="2,7 6,11 12,3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setDeleteTarget(tweet); setDeleteReason(''); }}
                    data-testid={`button-delete-${tweet.id}`}
                    title="Remove"
                    style={{ padding: '4px 8px', color: '#ef4444' }}
                  >
                    <svg viewBox="0 0 14 14" width="13" height="13" fill="none"><polyline points="3,4 11,4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M5 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5.5 6.5v4M8.5 6.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><rect x="2" y="4" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {deleteTarget && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && !deleteSubmitting && setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: '460px' }}>
            <div className="wizard-body">
              <div className="wizard-step-header">
                <h3>Why remove this tweet?</h3>
                <p>We&apos;ll use this signal to tune the agent&apos;s voice. Skip if you want Clawfable to infer intent automatically.</p>
              </div>

              <div style={{
                padding: '12px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                background: 'var(--surface)',
                marginBottom: '12px',
              }}>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', color: 'var(--text)', lineHeight: '1.6' }}>
                  {deleteTarget.content}
                </p>
              </div>

              <div className="wizard-builder-section">
                <div className="wizard-section-label">DELETE REASON (OPTIONAL)</div>
                <textarea
                  className="textarea"
                  value={deleteReason}
                  onChange={(event) => setDeleteReason(event.target.value)}
                  placeholder="Examples: too generic, wrong tone, weak hook, not on-topic, sounds forced..."
                  rows={4}
                />
                <p className="wizard-section-hint">
                  Explicit reasons are strongest. If you skip, we&apos;ll guess likely intent and still store the delete as feedback.
                </p>
              </div>

              <div className="wizard-actions">
                <button className="btn btn-outline" disabled={deleteSubmitting} onClick={() => setDeleteTarget(null)}>
                  CANCEL
                </button>
                <button className="btn btn-outline" disabled={deleteSubmitting} onClick={() => handleDelete(true)}>
                  {deleteSubmitting ? 'REMOVING...' : 'SKIP + INFER'}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={deleteSubmitting || !deleteReason.trim()}
                  onClick={() => handleDelete(false)}
                  style={{ background: deleteReason.trim() ? '#8b5cf6' : undefined }}
                >
                  {deleteSubmitting ? 'REMOVING...' : 'SAVE REASON + REMOVE'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
