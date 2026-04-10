'use client';

import { useState } from 'react';
import { Logo } from '@/app/components/logo';
import type { PublicSoulProfile as PublicSoulProfileData } from '@/lib/open-source-souls';

interface PublicSoulProfileProps {
  agent: PublicSoulProfileData;
}

export function PublicSoulProfile({ agent }: PublicSoulProfileProps) {
  const [soulExpanded, setSoulExpanded] = useState(false);
  const [forkLoading, setForkLoading] = useState(false);

  const handleFork = async () => {
    setForkLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forkHandle: agent.handle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch {
      setForkLoading(false);
    }
  };

  const maxFormatEng = agent.formatRankings.length > 0 ? Math.max(...agent.formatRankings.map((item) => item.avgEngagement), 1) : 1;
  const maxTopicEng = agent.topicRankings.length > 0 ? Math.max(...agent.topicRankings.map((item) => item.avgEngagement), 1) : 1;

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="site-header-brand">
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: 'inherit' }}>
            <Logo size={32} />
            <div className="site-header-text">
              <h1>CLAWFABLE</h1>
              <p>Grow Your X on Autopilot</p>
            </div>
          </a>
        </div>
      </header>

      <main className="page-main">
        <div style={{ maxWidth: '700px', margin: '0 auto', padding: '48px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700, color: 'var(--text)' }}>
                {agent.name}
              </h2>
              {agent.sourceType === 'live' && agent.xHandle ? (
                <a
                  href={`https://x.com/${agent.xHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#8b5cf6', textDecoration: 'none' }}
                >
                  @{agent.xHandle}
                </a>
              ) : (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#8b5cf6', letterSpacing: '0.08em' }}>
                  {agent.category.toUpperCase()}
                </p>
              )}
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

          {agent.sourceType === 'preset' && (
            <div style={{
              marginBottom: '24px',
              padding: '14px 20px',
              background: 'rgba(139,92,246,0.12)',
              border: '1px solid rgba(139,92,246,0.25)',
              borderRadius: 'var(--radius-lg)',
            }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#8b5cf6', letterSpacing: '0.1em', marginBottom: '8px' }}>
                ICONIC VOICE TEMPLATE
              </p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                This is a forkable preset, not a live public agent. Use it as a starting SOUL, then tune the voice to your own account and use case.
              </p>
            </div>
          )}

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

          {agent.insights.length > 0 && (
            <div className="learning-digest" style={{ marginBottom: '24px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '12px' }}>
                WHAT THE SYSTEM LEARNED
              </p>
              <ul className="learning-insights">
                {agent.insights.map((insight, index) => (
                  <li key={index} className="learning-insight">{insight}</li>
                ))}
              </ul>
            </div>
          )}

          {(agent.formatRankings.length > 0 || agent.topicRankings.length > 0) && (
            <div className="rankings-grid" style={{ marginBottom: '24px' }}>
              {agent.formatRankings.length > 0 && (
                <div className="perf-block">
                  <p className="perf-block-label">FORMAT RANKINGS</p>
                  <div className="perf-rows">
                    {agent.formatRankings.map((format) => (
                      <div key={format.format} className="perf-row">
                        <span className="perf-row-name">{format.format.replace(/_/g, ' ')}</span>
                        <div className="ranking-bar-track">
                          <div className="ranking-bar" style={{ width: `${(format.avgEngagement / maxFormatEng) * 100}%` }} />
                        </div>
                        <span className="perf-row-stat">{format.avgEngagement}</span>
                        <span className="perf-row-count">{format.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {agent.topicRankings.length > 0 && (
                <div className="perf-block">
                  <p className="perf-block-label">TOPIC RANKINGS</p>
                  <div className="perf-rows">
                    {agent.topicRankings.map((topic) => (
                      <div key={topic.topic} className="perf-row">
                        <span className="perf-row-name">{topic.topic}</span>
                        <div className="ranking-bar-track">
                          <div className="ranking-bar" style={{ width: `${(topic.avgEngagement / maxTopicEng) * 100}%` }} />
                        </div>
                        <span className="perf-row-stat">{topic.avgEngagement}</span>
                        <span className="perf-row-count">{topic.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            marginBottom: '24px',
          }}>
            <button
              onClick={() => setSoulExpanded((value) => !value)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '16px 20px',
                textAlign: 'left',
              }}
            >
              <div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
                  SOUL.md
                </p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  {agent.soulMd.split('\n').length} lines of voice contract
                </p>
              </div>
              <svg
                viewBox="0 0 10 6"
                width="10"
                height="6"
                fill="none"
                style={{
                  transform: soulExpanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 150ms ease-out',
                }}
              >
                <polyline points="1,1 5,5 9,1" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div style={{
              padding: soulExpanded ? '0 20px 20px' : '0 20px 16px',
              borderTop: '1px solid var(--border)',
            }}>
              <pre style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                lineHeight: '1.8',
                color: soulExpanded ? 'var(--text-muted)' : 'var(--text-dim)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: '16px 0 0',
                maxHeight: soulExpanded ? 'none' : '90px',
                overflow: 'hidden',
                maskImage: soulExpanded ? 'none' : 'linear-gradient(to bottom, black 45%, transparent 100%)',
                WebkitMaskImage: soulExpanded ? 'none' : 'linear-gradient(to bottom, black 45%, transparent 100%)',
              }}>
                {agent.soulMd}
              </pre>
            </div>
          </div>

          {agent.topTweets.length > 0 && (
            <div className="learning-digest">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '12px' }}>
                TOP POSTS
              </p>
              <div className="space-y-4">
                {agent.topTweets.map((tweet) => (
                  <div key={`${tweet.postedAt}-${tweet.content.slice(0, 24)}`} style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: '12px',
                  }}>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text)', lineHeight: 1.7 }}>
                      {tweet.content}
                    </p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#22c55e' }}>{tweet.likes} likes</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#3b82f6' }}>{tweet.retweets} retweets</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{tweet.format}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{tweet.topic}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--text-dim)',
            marginTop: '32px',
            textAlign: 'center',
          }}>
            <a href="/souls" style={{ color: 'inherit', textDecoration: 'none' }}>
              BACK TO SOUL LIBRARY
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
