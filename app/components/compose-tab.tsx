'use client';

import { useState, useEffect } from 'react';
import type { Tweet, AccountAnalysis } from '@/lib/types';

interface Topic {
  id: number;
  headline: string;
  source: string;
  relevanceScore: number;
  category: string;
  timestamp: string;
  tweetCount?: number;
  topTweet?: { text: string; likes: number; author: string };
}

interface ProtocolTweet extends Tweet {
  format?: string;
  rationale?: string;
}

interface ComposeTabProps {
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

export function ComposeTab({ agentId }: ComposeTabProps) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [analysis, setAnalysis] = useState<AccountAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [agentConnected, setAgentConnected] = useState(false);
  const [generatedTweets, setGeneratedTweets] = useState<ProtocolTweet[]>([]);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/agents/${agentId}/topics`).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/agents/${agentId}/analysis`).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/agents/${agentId}`).then((r) => r.json()).catch(() => ({})),
    ]).then(([t, a, agent]) => {
      if (Array.isArray(t)) setTopics(t);
      setAnalysis(a);
      setAgentConnected(agent?.isConnected === 1);
      setLoading(false);
    });
  }, [agentId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Generate from a trending topic
  const handleGenerateFromTopic = async (topic: Topic) => {
    setGeneratingId(topic.id);
    try {
      const res = await fetch(`/api/agents/${agentId}/generate-tweet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.category, headline: topic.headline }),
      });
      const tweet = await res.json();
      if (!res.ok) throw new Error(tweet.error);
      setGeneratedTweets((prev) => [tweet, ...prev]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate');
    } finally {
      setGeneratingId(null);
    }
  };

  // Batch generate from analysis
  const handleBatchGenerate = async (count: number) => {
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

  const handleQueue = async (tweet: ProtocolTweet) => {
    try {
      await fetch(`/api/agents/${agentId}/queue/${tweet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'queued' }),
      });
      showToast('Added to queue');
    } catch { showToast('Failed to queue'); }
  };

  const handleCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); showToast('Copied'); }
    catch { showToast('Copy failed'); }
  };

  const handlePostNow = async (tweet: ProtocolTweet) => {
    if (!agentConnected) return;
    setPostingId(tweet.id);
    try {
      const res = await fetch(`/api/agents/${agentId}/twitter/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tweet.content, tweetId: tweet.id, quoteTweetId: tweet.quoteTweetId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGeneratedTweets((prev) => prev.filter((t) => t.id !== tweet.id));
      showToast('Posted to X!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Post failed');
    } finally { setPostingId(null); }
  };

  const handleDiscard = (id: string) => {
    setGeneratedTweets((prev) => prev.filter((t) => t.id !== id));
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: '96px', borderRadius: '10px' }} />
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

      {/* ─── Generate from Analysis ──────────────────────────────────────── */}
      {analysis ? (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <polygon points="2,2 14,8 2,14" fill="#8b5cf6" />
              </svg>
              <h2>GENERATE</h2>
              <span className="section-count">from your voice + engagement data + trending</span>
            </div>
          </div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.7', marginBottom: '12px' }}>
            AI produces tweets weighted to your top-performing formats, topics, and voice — informed by what&apos;s trending in your network. Includes quote tweets.
          </p>
          <div className="flex gap-3">
            <button className="btn btn-primary" onClick={() => handleBatchGenerate(3)} disabled={generating} style={{ background: '#8b5cf6' }}>
              {generating ? 'GENERATING...' : 'GENERATE 3'}
            </button>
            <button className="btn btn-primary" onClick={() => handleBatchGenerate(5)} disabled={generating} style={{ background: '#8b5cf6' }}>
              GENERATE 5
            </button>
            <button className="btn btn-outline" onClick={() => handleBatchGenerate(10)} disabled={generating}>
              GENERATE 10
            </button>
          </div>
        </div>
      ) : (
        <div className="protocol-empty">
          <svg viewBox="0 0 48 48" width="40" height="40" fill="none">
            <circle cx="24" cy="24" r="20" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4 3" />
            <path d="M24 14v10l7 4" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
            Run account analysis to unlock AI-powered generation based on your engagement data.
          </p>
          <button className="btn btn-primary" onClick={handleReanalyze} disabled={analyzing}
            style={{ marginTop: '12px', background: '#8b5cf6' }}
          >
            {analyzing ? 'ANALYZING...' : 'RUN ANALYSIS'}
          </button>
        </div>
      )}

      {/* ─── Generated Content ───────────────────────────────────────────── */}
      {generatedTweets.length > 0 && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><polygon points="2,2 14,8 2,14" fill="#8b5cf6" /></svg>
              <h2>DRAFTS</h2>
              <span className="section-count">{generatedTweets.length} generated</span>
            </div>
          </div>
          <div className="space-y-3">
            {generatedTweets.map((tweet) => (
              <div key={tweet.id} className="protocol-generated-card">
                {tweet.quoteTweetId && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px',
                    fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)',
                  }}>
                    <span className="protocol-tag tag-topic" style={{ fontSize: '9px' }}>QT</span>
                    <span>quoting {tweet.quoteTweetAuthor || 'unknown'}</span>
                  </div>
                )}
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
                  <span className="char-count">{tweet.content.length} chars</span>
                  <div className="tweet-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => handleCopy(tweet.content)}>COPY</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: '#8b5cf6' }} onClick={() => handleQueue(tweet)}>QUEUE</button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: agentConnected ? '#ef4444' : 'var(--text-dim)', cursor: agentConnected ? 'pointer' : 'not-allowed' }}
                      disabled={!agentConnected || postingId === tweet.id}
                      onClick={() => handlePostNow(tweet)}
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

      {/* ─── Trending in Network ──��──────────────────────────────────────── */}
      <div>
        <div className="section-header">
          <div className="section-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><polyline points="1,12 5,7 9,9 15,3" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <h2>TRENDING IN YOUR NETWORK</h2>
            <span className="section-count">{topics.length} topics</span>
          </div>
        </div>

        {topics.length === 0 ? (
          <div style={{ padding: '30px 20px', textAlign: 'center', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.7' }}>
              {agentConnected
                ? 'No trending topics found. Your following graph may be too small, or the X API rate limit was hit.'
                : 'Connect your X API in Settings to see what\'s trending in your network.'}
            </p>
          </div>
        ) : (
          <div className="topic-grid">
            {topics.map((topic) => (
              <div key={topic.id} className="topic-card" data-testid={`card-topic-${topic.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="topic-headline">{topic.headline}</p>
                    <div className="topic-meta">
                      <span>{topic.source}</span>
                      {topic.tweetCount && <span>{topic.tweetCount} posts</span>}
                      <span className="flex items-center gap-2">
                        <svg viewBox="0 0 12 12" width="10" height="10" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" /><polyline points="6,3.5 6,6 7.5,7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                        {getTimeAgo(topic.timestamp)}
                      </span>
                    </div>
                    {topic.topTweet && (
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', marginTop: '6px', lineHeight: '1.5' }}>
                        @{topic.topTweet.author}: {topic.topTweet.text.slice(0, 120)}{topic.topTweet.text.length > 120 ? '...' : ''} ({topic.topTweet.likes} likes)
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2" style={{ flexShrink: 0 }}>
                    <span className="topic-score" style={{
                      background: `rgba(139,92,246,${topic.relevanceScore / 200})`,
                      color: topic.relevanceScore > 85 ? '#8b5cf6' : '#888',
                    }}>
                      {topic.relevanceScore}
                    </span>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={generatingId === topic.id}
                      onClick={() => handleGenerateFromTopic(topic)}
                    >
                      <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polygon points="2,1 11,6 2,11" fill="#fff" /></svg>
                      {generatingId === topic.id ? 'GENERATING...' : 'GENERATE'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Account Intelligence ──────────���─────────────────────────────── */}
      {analysis && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <circle cx="8" cy="8" r="6" stroke="#8b5cf6" strokeWidth="1.5" />
                <path d="M8 4v4l3 2" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <h2>YOUR PATTERNS</h2>
              <span className="section-count">analyzed {getTimeAgo(analysis.analyzedAt)}</span>
            </div>
            <button className="btn btn-outline btn-sm" onClick={handleReanalyze} disabled={analyzing}>
              {analyzing ? 'ANALYZING...' : 'RE-ANALYZE'}
            </button>
          </div>

          <div className="protocol-section-grid" style={{ marginTop: '8px' }}>
            <div className="protocol-card">
              <p className="protocol-card-label">TOP FORMATS</p>
              <div className="protocol-tags">
                {analysis.engagementPatterns.topFormats.map((f) => (
                  <span key={f} className="protocol-tag">{f.replace(/_/g, ' ')}</span>
                ))}
              </div>
            </div>
            <div className="protocol-card">
              <p className="protocol-card-label">BEST TOPICS</p>
              <div className="protocol-tags">
                {analysis.engagementPatterns.topTopics.map((t) => (
                  <span key={t} className="protocol-tag tag-topic">{t}</span>
                ))}
              </div>
            </div>
            <div className="protocol-card">
              <p className="protocol-card-label">ENGAGEMENT</p>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.8' }}>
                <div>Avg likes: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{analysis.engagementPatterns.avgLikes}</span></div>
                <div>Avg RTs: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{analysis.engagementPatterns.avgRetweets}</span></div>
                <div>Viral bar: <span style={{ color: '#f59e0b', fontWeight: 600 }}>{analysis.engagementPatterns.viralThreshold}+</span></div>
              </div>
            </div>
          </div>

          <div className="protocol-fingerprint" style={{ marginTop: '8px' }}>
            <p className="protocol-card-label">CONTENT FINGERPRINT</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text)', lineHeight: '1.7' }}>
              {analysis.contentFingerprint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
