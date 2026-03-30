'use client';

import { useState, useEffect } from 'react';
import type { Tweet, ProtocolSettings } from '@/lib/types';

interface QueueTabProps {
  agentId: string;
}

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

  const loadQueue = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/queue`);
      const data = await res.json();
      setQueue(data);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      await loadQueue();
      try {
        const a = await fetch(`/api/agents/${agentId}`).then((r) => r.json());
        setAgentConnected(a.isConnected === 1);
      } catch {}
      try {
        const p = await fetch(`/api/agents/${agentId}/protocol/settings`).then((r) => r.ok ? r.json() : null);
        if (p?.settings) setAutopilotSettings(p.settings);
      } catch {}
      setLoading(false);
    })();
  }, [agentId]);

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
    if (!queue.length) return;
    const all = queue.map((t, i) => `${i + 1}. ${t.content}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(all);
      showToast(`${queue.length} tweets copied`);
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

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/agents/${agentId}/queue/${id}`, { method: 'DELETE' });
      showToast('Removed from queue');
      loadQueue();
    } catch {}
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

  const handlePostAll = async () => {
    if (!queue.length || !agentConnected) return;
    setIsPostingAll(true);
    let posted = 0;
    for (const tweet of queue) {
      try {
        await fetch(`/api/agents/${agentId}/twitter/post`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: tweet.content, tweetId: tweet.id }),
        });
        posted++;
        showToast(`Posted ${posted}/${queue.length}`);
      } catch {}
      if (posted < queue.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    setIsPostingAll(false);
    loadQueue();
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
          <span className="section-count">{queue.length} items</span>
        </div>
        {queue.length > 0 && (
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

      {/* Empty state */}
      {queue.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none"><line x1="5" y1="8" x2="27" y2="8" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" /><line x1="5" y1="16" x2="27" y2="16" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" /><line x1="5" y1="24" x2="18" y2="24" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" /></svg>
          <p>Queue empty</p>
          <p>Generate takes from the FEED tab and queue them here</p>
        </div>
      )}

      {/* Queue items */}
      <div className="space-y-3">
        {queue.map((tweet, idx) => (
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
                    onClick={() => handleDelete(tweet.id)}
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
    </div>
  );
}
