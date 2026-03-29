'use client';

import { useState, useEffect } from 'react';
import type { Mention, Tweet } from '@/lib/types';

interface MentionsTabProps {
  agentId: string;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
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

export function MentionsTab({ agentId }: MentionsTabProps) {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentConnected, setAgentConnected] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, Tweet>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadMentions = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/mentions`);
      const data = await res.json();
      setMentions(data);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      await loadMentions();
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

  const handleGenerate = async (mention: Mention) => {
    setGeneratingId(mention.id);
    try {
      const res = await fetch(`/api/agents/${agentId}/generate-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: mention.content, authorHandle: mention.authorHandle }),
      });
      const tweet = await res.json();
      setReplyDrafts((prev) => ({ ...prev, [mention.id]: tweet }));
    } catch {
      showToast('Failed to generate reply');
    } finally {
      setGeneratingId(null);
    }
  };

  const handleQueue = async (tweet: Tweet) => {
    try {
      await fetch(`/api/agents/${agentId}/queue/${tweet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'queued' }),
      });
      showToast('Reply added to queue');
    } catch {
      showToast('Queue failed');
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied');
    } catch {}
  };

  const handleRefresh = async () => {
    if (!agentConnected) {
      showToast('Connect X API in Settings first');
      return;
    }
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/twitter/mentions`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await loadMentions();
      showToast(`${Array.isArray(data) ? data.length : 0} mentions loaded`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePostReply = async (mention: Mention) => {
    const draft = replyDrafts[mention.id];
    if (!draft || !agentConnected) return;
    setPostingId(mention.id);
    try {
      const res = await fetch(`/api/agents/${agentId}/twitter/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: draft.content,
          replyToId: mention.tweetId || undefined,
          tweetId: draft.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[mention.id];
        return next;
      });
      showToast('Reply posted!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Post failed');
    } finally {
      setPostingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: '112px', borderRadius: '10px' }} />
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
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M8 2a7 7 0 1 0 0 14A7 7 0 0 0 8 2z" stroke="#dc2626" strokeWidth="1.5" /><text x="8" y="11" textAnchor="middle" fill="#dc2626" fontSize="8" fontFamily="monospace" fontWeight="700">@</text></svg>
          <h2>MENTIONS</h2>
          <span className="section-count">{mentions.length} items</span>
        </div>
        <button
          className={`btn btn-sm ${agentConnected ? 'btn-outline' : 'btn-ghost'}`}
          style={agentConnected ? { borderColor: 'var(--primary-border)', color: 'var(--primary)' } : { opacity: 0.5 }}
          onClick={handleRefresh}
          disabled={isRefreshing}
          data-testid="button-refresh-mentions"
          title={!agentConnected ? 'Connect X API in Settings first' : 'Fetch real mentions from X'}
        >
          <svg
            viewBox="0 0 14 14"
            width="12"
            height="12"
            fill="none"
            style={isRefreshing ? { animation: 'spin 1s linear infinite' } : {}}
          >
            <path d="M12 7A5 5 0 1 1 7 2M12 2v5l-5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {isRefreshing ? 'REFRESHING...' : 'REFRESH'}
        </button>
      </div>

      {/* Empty state */}
      {mentions.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none"><circle cx="16" cy="16" r="12" stroke="var(--text-muted)" strokeWidth="1.5" /><text x="16" y="21" textAnchor="middle" fill="var(--text-muted)" fontSize="12" fontFamily="monospace">@</text></svg>
          <p>No mentions yet</p>
        </div>
      )}

      <div className="space-y-4">
        {mentions.map((mention) => (
          <div key={mention.id} className="space-y-2">
            {/* Mention card */}
            <div className="mention-card" data-testid={`card-mention-${mention.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="mention-avatar">
                      {mention.author.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span className="mention-author-name">{mention.author}</span>
                      <span className="mention-author-handle">{mention.authorHandle}</span>
                    </div>
                  </div>
                  <p className="mention-text">{mention.content}</p>
                  <div className="mention-engagement">
                    <span className="flex items-center gap-1">
                      <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><path d="M6 10.5C4 9 1 7 1 4.5a3 3 0 0 1 5-2.2A3 3 0 0 1 11 4.5c0 2.5-3 4.5-5 6z" stroke="currentColor" strokeWidth="1.2" /></svg>
                      {formatNumber(mention.engagementLikes ?? 0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><path d="M9 3H4a2 2 0 0 0-2 2v1M3 9h5a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><polyline points="7.5,1.5 9,3 7.5,4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><polyline points="4.5,7.5 3,9 4.5,10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                      {formatNumber(mention.engagementRetweets ?? 0)}
                    </span>
                    <span>{getTimeAgo(mention.createdAt)}</span>
                    {mention.tweetId && (
                      <a
                        href={`https://x.com/i/web/status/${mention.tweetId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--primary)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}
                      >
                        VIEW ON X
                      </a>
                    )}
                  </div>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flexShrink: 0 }}
                  disabled={generatingId === mention.id}
                  onClick={() => handleGenerate(mention)}
                  data-testid={`button-reply-${mention.id}`}
                >
                  {generatingId === mention.id ? 'GENERATING...' : 'GENERATE REPLY'}
                </button>
              </div>
            </div>

            {/* Reply draft */}
            {replyDrafts[mention.id] && (
              <div className="reply-draft" data-testid={`card-reply-${mention.id}`}>
                <div className="reply-draft-label">REPLY DRAFT</div>
                <p style={{ fontSize: '13px', color: 'var(--text)', lineHeight: '1.65', marginBottom: '10px' }}>
                  {replyDrafts[mention.id].content}
                </p>
                <div className="flex items-center justify-between">
                  <span className={`char-count ${replyDrafts[mention.id].content.length > 280 ? 'over' : ''}`}>
                    {replyDrafts[mention.id].content.length}/280
                  </span>
                  <div className="tweet-actions">
                    <button className="btn btn-ghost btn-xs" onClick={() => handleCopy(replyDrafts[mention.id].content)} data-testid={`button-copy-reply-${mention.id}`}>COPY</button>
                    <button className="btn btn-ghost btn-xs" style={{ color: 'var(--primary)' }} onClick={() => handleQueue(replyDrafts[mention.id])} data-testid={`button-queue-reply-${mention.id}`}>QUEUE</button>
                    <button
                      className="btn btn-ghost btn-xs"
                      style={{ color: agentConnected ? '#ef4444' : 'var(--text-dim)', opacity: agentConnected ? 1 : 0.4 }}
                      disabled={!agentConnected || postingId === mention.id}
                      onClick={() => handlePostReply(mention)}
                      data-testid={`button-post-reply-${mention.id}`}
                    >
                      {postingId === mention.id ? 'POSTING...' : 'POST REPLY'}
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => handleGenerate(mention)} data-testid={`button-regen-reply-${mention.id}`}>REGEN</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
