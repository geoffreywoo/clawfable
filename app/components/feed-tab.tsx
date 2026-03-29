'use client';

import { useState, useEffect } from 'react';
import type { Tweet } from '@/lib/types';

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

interface FeedTabProps {
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

export function FeedTab({ agentId }: FeedTabProps) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentConnected, setAgentConnected] = useState(false);
  const [generatedTweets, setGeneratedTweets] = useState<Tweet[]>([]);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/agents/${agentId}/topics`)
      .then((r) => r.json())
      .then(setTopics)
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch(`/api/agents/${agentId}`)
      .then((r) => r.json())
      .then((a) => setAgentConnected(a.isConnected === 1))
      .catch(() => {});
  }, [agentId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleGenerate = async (topic: Topic) => {
    setGeneratingId(topic.id);
    try {
      const res = await fetch(`/api/agents/${agentId}/generate-tweet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.category, headline: topic.headline }),
      });
      const tweet = await res.json();
      setGeneratedTweets((prev) => [tweet, ...prev]);
    } catch {
      showToast('Failed to generate take');
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
      showToast('Tweet added to queue');
    } catch {
      showToast('Failed to queue tweet');
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    } catch {
      showToast('Copy failed');
    }
  };

  const handleDiscard = (id: string) => {
    setGeneratedTweets((prev) => prev.filter((t) => t.id !== id));
  };

  const handlePostNow = async (tweet: Tweet) => {
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

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: '96px', borderRadius: '10px' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ position: 'relative' }}>
      {/* Toast */}
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

      {/* Trending topics */}
      <div>
        <div className="section-header">
          <div className="section-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><polyline points="1,12 5,7 9,9 15,3" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <h2>TRENDING TOPICS</h2>
            <span className="section-count">{topics.length} items</span>
          </div>
        </div>

        {topics.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.7' }}>
              {agentConnected
                ? 'No trending topics found. Your following graph may be too small, or the X API rate limit was hit. Try again later.'
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
                  <span
                    className="topic-score"
                    style={{
                      background: `rgba(220,38,38,${topic.relevanceScore / 200})`,
                      color: topic.relevanceScore > 85 ? '#8b5cf6' : '#888',
                    }}
                    data-testid={`text-score-${topic.id}`}
                  >
                    {topic.relevanceScore}
                  </span>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={generatingId === topic.id}
                    onClick={() => handleGenerate(topic)}
                    data-testid={`button-generate-${topic.id}`}
                  >
                    <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polygon points="2,1 11,6 2,11" fill="#fff" /></svg>
                    {generatingId === topic.id ? 'GENERATING...' : 'GENERATE TAKE'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* Generated tweets */}
      {generatedTweets.length > 0 && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><polygon points="2,2 14,8 2,14" fill="#8b5cf6" /></svg>
              <h2>GENERATED TAKES</h2>
              <span className="section-count">{generatedTweets.length} drafts</span>
            </div>
          </div>

          <div className="space-y-3">
            {generatedTweets.map((tweet) => (
              <div key={tweet.id} className="tweet-card-draft" data-testid={`card-draft-${tweet.id}`}>
                <p className="tweet-content">{tweet.content}</p>
                <div className="tweet-footer">
                  <span
                    className={`char-count ${tweet.content.length > 280 ? 'over' : ''}`}
                    data-testid={`text-charcount-${tweet.id}`}
                  >
                    {tweet.content.length}/280
                  </span>
                  <div className="tweet-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleCopy(tweet.content)}
                      data-testid={`button-copy-${tweet.id}`}
                    >
                      COPY
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: '#8b5cf6' }}
                      onClick={() => handleQueue(tweet)}
                      data-testid={`button-queue-${tweet.id}`}
                    >
                      QUEUE
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{
                        color: agentConnected ? '#ef4444' : 'var(--text-dim)',
                        cursor: agentConnected ? 'pointer' : 'not-allowed',
                      }}
                      disabled={!agentConnected || postingId === tweet.id}
                      onClick={() => handlePostNow(tweet)}
                      data-testid={`button-post-now-${tweet.id}`}
                      title={!agentConnected ? 'Connect X API in Settings first' : 'Post directly to X'}
                    >
                      {postingId === tweet.id ? 'POSTING...' : 'POST NOW'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDiscard(tweet.id)}
                      data-testid={`button-discard-${tweet.id}`}
                    >
                      DISCARD
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
