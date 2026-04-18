'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Logo } from '@/app/components/logo';
import { reportActionError, requestLoginUrl } from '@/app/components/site-actions';
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
      const url = await requestLoginUrl({ forkHandle: agent.handle });
      window.location.href = url;
    } catch (error) {
      reportActionError(error, 'Failed to start login');
      setForkLoading(false);
    }
  };

  const maxFormatEng = agent.formatRankings.length > 0
    ? Math.max(...agent.formatRankings.map((item) => item.avgEngagement), 1)
    : 1;
  const maxTopicEng = agent.topicRankings.length > 0
    ? Math.max(...agent.topicRankings.map((item) => item.avgEngagement), 1)
    : 1;

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="site-header-brand">
          <Link href="/" className="site-header-home-link">
            <Logo size={32} />
            <div className="site-header-text">
              <h1>CLAWFABLE</h1>
              <p>AI publishing teammate for X</p>
            </div>
          </Link>
        </div>
        <div className="site-header-right">
          <nav className="site-header-nav">
            <Link href="/">Home</Link>
            <Link href="/souls">Soul library</Link>
            <Link href="/pricing">Pricing</Link>
          </nav>
        </div>
      </header>

      <main className="page-main">
        <div className="content-wrap soul-profile-shell">
          <section className="soul-profile-hero">
            <div className="soul-profile-copy">
              <p className="landing-kicker">
                {agent.sourceType === 'live' ? 'LIVE PUBLIC AGENT' : 'PRESET VOICE'}
              </p>
              <h1>{agent.name}</h1>
              {agent.sourceType === 'live' && agent.xHandle ? (
                <a
                  href={`https://x.com/${agent.xHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="soul-profile-handle"
                >
                  @{agent.xHandle}
                </a>
              ) : (
                <p className="soul-profile-category">{agent.category}</p>
              )}
              {agent.soulSummary && (
                <p className="soul-profile-summary">{agent.soulSummary}</p>
              )}
            </div>

            <div className="soul-profile-cta">
              <button className="btn btn-primary btn-wide" onClick={handleFork} disabled={forkLoading}>
                {forkLoading ? 'Connecting...' : 'Fork this voice'}
              </button>
              <p>
                {agent.sourceType === 'preset'
                  ? 'Use this as a starting voice, then adapt it to your own account and context.'
                  : 'Fork the public SOUL, then retrain it on your own posts and feedback loop.'}
              </p>
            </div>
          </section>

          {agent.sourceType === 'preset' && (
            <section className="soul-profile-banner">
              <p className="souls-section-kicker">Preset voice</p>
              <p>
                This is a forkable template, not a live public account. It gives you a strong
                starting point that you can soften, redirect, or rebuild inside your own workflow.
              </p>
            </section>
          )}

          {agent.totalTracked > 0 && (
            <section className="soul-profile-metrics">
              <div className="soul-profile-metric-card">
                <span>Tracked posts</span>
                <strong>{agent.totalTracked}</strong>
              </div>
              <div className="soul-profile-metric-card soul-profile-metric-card-good">
                <span>Average likes</span>
                <strong>{agent.avgLikes}</strong>
              </div>
              <div className="soul-profile-metric-card soul-profile-metric-card-cool">
                <span>Average reposts</span>
                <strong>{agent.avgRetweets}</strong>
              </div>
            </section>
          )}

          {agent.insights.length > 0 && (
            <section className="soul-profile-panel">
              <div className="soul-profile-panel-head">
                <p className="souls-section-kicker">What the system learned</p>
                <h2>Reusable takeaways from this voice.</h2>
              </div>
              <ul className="learning-insights">
                {agent.insights.map((insight, index) => (
                  <li key={index} className="learning-insight">{insight}</li>
                ))}
              </ul>
            </section>
          )}

          {(agent.formatRankings.length > 0 || agent.topicRankings.length > 0) && (
            <section className="soul-profile-rankings">
              {agent.formatRankings.length > 0 && (
                <div className="perf-block soul-profile-panel">
                  <p className="perf-block-label">Format performance</p>
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
                <div className="perf-block soul-profile-panel">
                  <p className="perf-block-label">Topic performance</p>
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
            </section>
          )}

          <section className="soul-profile-panel">
            <button className="soul-profile-toggle" onClick={() => setSoulExpanded((value) => !value)}>
              <div>
                <p className="souls-section-kicker">SOUL.md</p>
                <h2>{agent.soulMd.split('\n').length} lines of voice contract</h2>
              </div>
              <span>{soulExpanded ? 'Hide' : 'Preview'}</span>
            </button>
            <div className={`soul-card-preview soul-profile-code${soulExpanded ? ' is-expanded' : ''}`}>
              <pre>{agent.soulMd}</pre>
            </div>
          </section>

          {agent.topTweets.length > 0 && (
            <section className="soul-profile-panel">
              <div className="soul-profile-panel-head">
                <p className="souls-section-kicker">Top posts</p>
                <h2>Examples of what worked best in public.</h2>
              </div>
              <div className="souls-card-stack">
                {agent.topTweets.map((tweet) => (
                  <article key={`${tweet.postedAt}-${tweet.content.slice(0, 24)}`} className="soul-card soul-card-live">
                    <p className="soul-card-summary soul-tweet-content">{tweet.content}</p>
                    <div className="soul-card-meta">
                      <span>{tweet.likes} likes</span>
                      <span>{tweet.retweets} reposts</span>
                      <span>{tweet.format}</span>
                      <span>{tweet.topic}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className="souls-library-footer">
            <p>Want to browse more voices before you fork one?</p>
            <Link href="/souls" className="btn btn-outline">
              Back to soul library
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
