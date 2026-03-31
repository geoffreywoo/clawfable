'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Logo } from '../../components/logo';

interface AgentProfile {
  handle: string;
  name: string;
  soulMd: string;
  soulSummary: string | null;
  totalTracked: number;
  avgLikes: number;
  avgRetweets: number;
  formatRankings: Array<{ format: string; count: number; avgEngagement: number }>;
  topicRankings: Array<{ topic: string; count: number; avgEngagement: number }>;
  insights: string[];
  topTweets: Array<{ content: string; likes: number; retweets: number; format: string; topic: string; postedAt: string }>;
}

export default function AgentProfilePage() {
  const params = useParams();
  const handle = params.handle as string;
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [soulExpanded, setSoulExpanded] = useState(false);
  const [forkLoading, setForkLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/public/agent/${handle}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setAgent(data))
      .catch(() => setAgent(null))
      .finally(() => setLoading(false));
  }, [handle]);

  const handleFork = async () => {
    setForkLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forkHandle: handle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch {
      setForkLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-shell">
        <header className="site-header">
          <div className="site-header-brand">
            <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: 'inherit' }}>
              <Logo size={32} />
              <div className="site-header-text">
                <h1>CLAWFABLE</h1>
                <p>Give Your Agents a Soul</p>
              </div>
            </a>
          </div>
        </header>
        <main className="page-main">
          <div style={{ maxWidth: '700px', margin: '0 auto', padding: '60px 24px' }}>
            <div className="skeleton" style={{ height: '200px', borderRadius: '10px' }} />
          </div>
        </main>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="page-shell">
        <header className="site-header">
          <div className="site-header-brand">
            <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: 'inherit' }}>
              <Logo size={32} />
              <div className="site-header-text">
                <h1>CLAWFABLE</h1>
                <p>Give Your Agents a Soul</p>
              </div>
            </a>
          </div>
        </header>
        <main className="page-main">
          <div style={{ maxWidth: '700px', margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-muted)' }}>Agent not found</p>
            <a href="/souls" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#8b5cf6', textDecoration: 'none', marginTop: '12px', display: 'inline-block' }}>
              BROWSE ALL SOULs
            </a>
          </div>
        </main>
      </div>
    );
  }

  const maxFormatEng = agent.formatRankings.length > 0 ? Math.max(...agent.formatRankings.map((f) => f.avgEngagement), 1) : 1;
  const maxTopicEng = agent.topicRankings.length > 0 ? Math.max(...agent.topicRankings.map((t) => t.avgEngagement), 1) : 1;

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="site-header-brand">
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: 'inherit' }}>
            <Logo size={32} />
            <div className="site-header-text">
              <h1>CLAWFABLE</h1>
              <p>Give Your Agents a Soul</p>
            </div>
          </a>
        </div>
      </header>

      <main className="page-main">
        <div style={{ maxWidth: '700px', margin: '0 auto', padding: '48px 24px' }}>
          {/* Agent header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700, color: 'var(--text)' }}>
                {agent.name}
              </h2>
              <a
                href={`https://x.com/${agent.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#8b5cf6', textDecoration: 'none' }}
              >
                @{agent.handle}
              </a>
              {agent.soulSummary && (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.6 }}>
                  {agent.soulSummary}
                </p>
              )}
            </div>
            <button
              onClick={handleFork}
              disabled={forkLoading}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontWeight: 700,
                color: '#fff',
                background: '#8b5cf6',
                border: '1px solid #8b5cf6',
                borderRadius: '6px',
                padding: '8px 18px',
                cursor: forkLoading ? 'wait' : 'pointer',
                letterSpacing: '0.06em',
                flexShrink: 0,
              }}
            >
              {forkLoading ? 'CONNECTING...' : 'FORK THIS AGENT'}
            </button>
          </div>

          {/* Stats row */}
          {agent.totalTracked > 0 && (
            <div style={{
              display: 'flex',
              gap: '24px',
              marginBottom: '32px',
              padding: '14px 20px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
            }}>
              <div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{agent.totalTracked}</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>TRACKED</p>
              </div>
              <div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: '#22c55e' }}>{agent.avgLikes}</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>AVG LIKES</p>
              </div>
              <div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: '#3b82f6' }}>{agent.avgRetweets}</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>AVG RTs</p>
              </div>
            </div>
          )}

          {/* AI Insights */}
          {agent.insights.length > 0 && (
            <div className="learning-digest" style={{ marginBottom: '24px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '12px' }}>
                WHAT THE SYSTEM LEARNED
              </p>
              <ul className="learning-insights">
                {agent.insights.map((insight, i) => (
                  <li key={i} className="learning-insight">{insight}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Rankings */}
          {(agent.formatRankings.length > 0 || agent.topicRankings.length > 0) && (
            <div className="rankings-grid" style={{ marginBottom: '24px' }}>
              {agent.formatRankings.length > 0 && (
                <div className="perf-block">
                  <p className="perf-block-label">FORMAT RANKINGS</p>
                  <div className="perf-rows">
                    {agent.formatRankings.map((f) => (
                      <div key={f.format} className="perf-row">
                        <span className="perf-row-name">{f.format.replace(/_/g, ' ')}</span>
                        <div className="ranking-bar-track">
                          <div className="ranking-bar" style={{ width: `${(f.avgEngagement / maxFormatEng) * 100}%` }} />
                        </div>
                        <span className="perf-row-stat">{f.avgEngagement}</span>
                        <span className="perf-row-count">{f.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {agent.topicRankings.length > 0 && (
                <div className="perf-block">
                  <p className="perf-block-label">TOPIC RANKINGS</p>
                  <div className="perf-rows">
                    {agent.topicRankings.map((t) => (
                      <div key={t.topic} className="perf-row">
                        <span className="perf-row-name">{t.topic}</span>
                        <div className="ranking-bar-track">
                          <div className="ranking-bar" style={{ width: `${(t.avgEngagement / maxTopicEng) * 100}%` }} />
                        </div>
                        <span className="perf-row-stat">{t.avgEngagement}</span>
                        <span className="perf-row-count">{t.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Top tweets */}
          {agent.topTweets.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '10px' }}>
                TOP TWEETS
              </p>
              <div className="space-y-2">
                {agent.topTweets.map((tweet, i) => (
                  <div key={i} className="perf-tweet perf-tweet-best">
                    <span className="perf-tweet-stat">{tweet.likes} likes</span>
                    <p className="perf-tweet-content">{tweet.content.slice(0, 200)}{tweet.content.length > 200 ? '...' : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SOUL.md */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            marginBottom: '24px',
          }}>
            <button
              onClick={() => setSoulExpanded(!soulExpanded)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
                SOUL.md
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                {agent.soulMd.split('\n').length} lines {soulExpanded ? '(collapse)' : '(expand)'}
              </span>
            </button>
            {soulExpanded && (
              <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)' }}>
                <pre style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  lineHeight: 1.8,
                  color: 'var(--text-muted)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: '16px 0 0',
                }}>
                  {agent.soulMd}
                </pre>
              </div>
            )}
          </div>

          {/* CTA */}
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <button
              onClick={handleFork}
              disabled={forkLoading}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                fontWeight: 700,
                color: '#fff',
                background: '#8b5cf6',
                border: '1px solid #8b5cf6',
                borderRadius: '8px',
                padding: '10px 24px',
                cursor: forkLoading ? 'wait' : 'pointer',
                letterSpacing: '0.06em',
              }}
            >
              {forkLoading ? 'CONNECTING...' : 'FORK THIS AGENT'}
            </button>
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-dim)',
              marginTop: '12px',
            }}>
              Connect your X account and launch with this voice profile in minutes.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '16px' }}>
            <a href="/souls" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#8b5cf6', textDecoration: 'none' }}>
              ALL SOULs
            </a>
            <a href="/" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', textDecoration: 'none' }}>
              HOME
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
