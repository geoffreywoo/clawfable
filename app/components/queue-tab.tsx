'use client';

import { useState, useEffect } from 'react';
import type { Tweet } from '@/lib/types';

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
