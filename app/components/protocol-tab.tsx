'use client';

import { useState, useEffect } from 'react';
import type { Tweet, AccountAnalysis } from '@/lib/types';

interface ProtocolTweet extends Tweet {
  format?: string;
  rationale?: string;
}

interface ProtocolTabProps {
  agentId: string;
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

export function ProtocolTab({ agentId }: ProtocolTabProps) {
  const [analysis, setAnalysis] = useState<AccountAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedTweets, setGeneratedTweets] = useState<ProtocolTweet[]>([]);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // Load analysis + agent status
    Promise.all([
      fetch(`/api/agents/${agentId}/analysis`)
        .then((r) => r.ok ? r.json() : null)
        .catch(() => null),
      fetch(`/api/agents/${agentId}`)
        .then((r) => r.json())
        .catch(() => ({})),
    ]).then(([a, agent]) => {
      setAnalysis(a);
      setAgentConnected(agent?.isConnected === 1);
      setLoadingAnalysis(false);
    });
  }, [agentId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleReanalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnalysis(data);
      showToast('Analysis updated');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerate = async (count: number) => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/protocol/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGeneratedTweets((prev) => [...data.tweets, ...prev]);
      showToast(`Generated ${data.tweets.length} tweets`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleQueue = async (tweet: ProtocolTweet) => {
    try {
      await fetch(`/api/agents/${agentId}/queue/${tweet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'queued' }),
      });
      showToast('Added to queue');
    } catch {
      showToast('Failed to queue');
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied');
    } catch {
      showToast('Copy failed');
    }
  };

  const handlePostNow = async (tweet: ProtocolTweet) => {
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
      setGeneratedTweets((prev) => prev.filter((t) => t.id !== tweet.id));
      showToast('Posted to X!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Post failed');
    } finally {
      setPostingId(null);
    }
  };

  const handleDiscard = (id: string) => {
    setGeneratedTweets((prev) => prev.filter((t) => t.id !== id));
  };

  if (loadingAnalysis) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: '80px', borderRadius: '10px' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ position: 'relative' }}>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, background: '#1a1a1a',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
          padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: '12px',
          color: 'var(--text)', zIndex: 200,
        }}>
          {toast}
        </div>
      )}

      {/* Analysis overview */}
      {!analysis ? (
        <div className="protocol-empty">
          <svg viewBox="0 0 48 48" width="40" height="40" fill="none">
            <circle cx="24" cy="24" r="20" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4 3" />
            <path d="M24 14v10l7 4" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
            No account analysis yet. Run analysis to study your posting history and engagement patterns.
          </p>
          <button
            className="btn btn-primary"
            onClick={handleReanalyze}
            disabled={analyzing}
            style={{ marginTop: '12px', background: '#8b5cf6' }}
          >
            {analyzing ? 'ANALYZING...' : 'RUN ANALYSIS'}
          </button>
        </div>
      ) : (
        <>
          {/* Analysis header */}
          <div>
            <div className="section-header">
              <div className="section-title">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="#8b5cf6" strokeWidth="1.5" />
                  <path d="M8 4v4l3 2" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <h2>ACCOUNT INTELLIGENCE</h2>
                <span className="section-count">analyzed {getTimeAgo(analysis.analyzedAt)}</span>
              </div>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleReanalyze}
                disabled={analyzing}
              >
                {analyzing ? 'ANALYZING...' : 'RE-ANALYZE'}
              </button>
            </div>

            {/* Stats row */}
            <div className="protocol-stats-grid">
              <div className="protocol-stat">
                <span className="protocol-stat-value">{analysis.tweetCount}</span>
                <span className="protocol-stat-label">TWEETS</span>
              </div>
              <div className="protocol-stat">
                <span className="protocol-stat-value">{analysis.viralTweets.length}</span>
                <span className="protocol-stat-label">VIRAL</span>
              </div>
              <div className="protocol-stat">
                <span className="protocol-stat-value">{analysis.engagementPatterns.avgLikes}</span>
                <span className="protocol-stat-label">AVG LIKES</span>
              </div>
              <div className="protocol-stat">
                <span className="protocol-stat-value">{analysis.engagementPatterns.avgRetweets}</span>
                <span className="protocol-stat-label">AVG RTS</span>
              </div>
              <div className="protocol-stat">
                <span className="protocol-stat-value">{analysis.engagementPatterns.viralThreshold}+</span>
                <span className="protocol-stat-label">VIRAL BAR</span>
              </div>
              <div className="protocol-stat">
                <span className="protocol-stat-value">{analysis.followingProfile.totalFollowing}</span>
                <span className="protocol-stat-label">FOLLOWING</span>
              </div>
            </div>
          </div>

          {/* Engagement patterns */}
          <div className="protocol-section">
            <div className="protocol-section-grid">
              {/* Top formats */}
              <div className="protocol-card">
                <p className="protocol-card-label">TOP FORMATS</p>
                <div className="protocol-tags">
                  {analysis.engagementPatterns.topFormats.map((f) => (
                    <span key={f} className="protocol-tag">{f.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              </div>

              {/* Top topics */}
              <div className="protocol-card">
                <p className="protocol-card-label">BEST TOPICS</p>
                <div className="protocol-tags">
                  {analysis.engagementPatterns.topTopics.map((t) => (
                    <span key={t} className="protocol-tag tag-topic">{t}</span>
                  ))}
                </div>
              </div>

              {/* Following categories */}
              <div className="protocol-card">
                <p className="protocol-card-label">FOLLOWING GRAPH</p>
                <div className="protocol-categories">
                  {analysis.followingProfile.categories.slice(0, 4).map((c) => (
                    <div key={c.label} className="protocol-category-row">
                      <span>{c.label}</span>
                      <span className="protocol-category-count">{c.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Content fingerprint */}
            <div className="protocol-fingerprint">
              <p className="protocol-card-label">CONTENT FINGERPRINT</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text)', lineHeight: '1.7' }}>
                {analysis.contentFingerprint}
              </p>
            </div>
          </div>

          {/* Viral tweets preview */}
          {analysis.viralTweets.length > 0 && (
            <div>
              <div className="section-header">
                <div className="section-title">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                    <polygon points="8,1 10,6 16,6 11,9.5 13,15 8,11.5 3,15 5,9.5 0,6 6,6" fill="#8b5cf6" />
                  </svg>
                  <h2>TOP VIRAL POSTS</h2>
                  <span className="section-count">{analysis.viralTweets.length} posts above {analysis.engagementPatterns.viralThreshold} likes</span>
                </div>
              </div>
              <div className="space-y-2">
                {analysis.viralTweets.slice(0, 5).map((vt) => (
                  <div key={vt.id} className="protocol-viral-card">
                    <p className="protocol-viral-text">{vt.text}</p>
                    <div className="protocol-viral-meta">
                      <span>{vt.likes} likes</span>
                      <span>{vt.retweets} RTs</span>
                      <span>{vt.replies} replies</span>
                      {vt.engagementRate > 0 && <span>{vt.engagementRate}% rate</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Generate section */}
          <div>
            <div className="section-header">
              <div className="section-title">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                  <polygon points="2,2 14,8 2,14" fill="#8b5cf6" />
                </svg>
                <h2>PROTOCOL GENERATION</h2>
              </div>
            </div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.7', marginBottom: '12px' }}>
              Generate viral content based on your soul profile + engagement patterns + following context.
              Content is weighted toward your top-performing formats and topics.
            </p>
            <div className="flex gap-3">
              <button
                className="btn btn-primary"
                onClick={() => handleGenerate(3)}
                disabled={generating}
                style={{ background: '#8b5cf6' }}
              >
                {generating ? 'GENERATING...' : 'GENERATE 3'}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleGenerate(5)}
                disabled={generating}
                style={{ background: '#8b5cf6' }}
              >
                GENERATE 5
              </button>
              <button
                className="btn btn-outline"
                onClick={() => handleGenerate(10)}
                disabled={generating}
              >
                GENERATE 10
              </button>
            </div>
          </div>

          {/* Generated tweets */}
          {generatedTweets.length > 0 && (
            <div>
              <div className="section-header">
                <div className="section-title">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><polygon points="2,2 14,8 2,14" fill="#8b5cf6" /></svg>
                  <h2>GENERATED CONTENT</h2>
                  <span className="section-count">{generatedTweets.length} drafts</span>
                </div>
              </div>
              <div className="space-y-3">
                {generatedTweets.map((tweet) => (
                  <div key={tweet.id} className="protocol-generated-card">
                    <p className="tweet-content">{tweet.content}</p>
                    {(tweet.format || tweet.rationale) && (
                      <div className="protocol-tweet-meta">
                        {tweet.format && (
                          <span className="protocol-tag" style={{ fontSize: '9px' }}>
                            {tweet.format.replace(/_/g, ' ')}
                          </span>
                        )}
                        {tweet.rationale && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                            {tweet.rationale}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="tweet-footer">
                      <span className={`char-count ${tweet.content.length > 280 ? 'over' : ''}`}>
                        {tweet.content.length}/280
                      </span>
                      <div className="tweet-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => handleCopy(tweet.content)}>COPY</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: '#8b5cf6' }} onClick={() => handleQueue(tweet)}>QUEUE</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{
                            color: agentConnected ? '#ef4444' : 'var(--text-dim)',
                            cursor: agentConnected ? 'pointer' : 'not-allowed',
                          }}
                          disabled={!agentConnected || postingId === tweet.id}
                          onClick={() => handlePostNow(tweet)}
                          title={!agentConnected ? 'Connect X API in Settings first' : 'Post directly to X'}
                        >
                          {postingId === tweet.id ? 'POSTING...' : 'POST NOW'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleDiscard(tweet.id)}>DISCARD</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
