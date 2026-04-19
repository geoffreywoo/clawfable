'use client';

import { useState, useEffect } from 'react';
import type { Metric, AgentLearnings } from '@/lib/types';

interface MetricsTabProps {
  agentId: string;
}

interface TimeseriesData {
  baseline: { avgLikes: number; avgRetweets: number; tweetCount: number; snapshotDate: string } | null;
  postAutopilot: { avgLikes: number; avgRetweets: number; tweetCount: number };
  lift: { likesPercent: number; retweetsPercent: number } | null;
  daily: Array<{ date: string; tweetsPosted: number; avgLikes: number }>;
  formatBreakdown: Array<{ format: string; count: number; avgEngagement: number }>;
  topicBreakdown: Array<{ topic: string; count: number; avgEngagement: number }>;
  compounding?: {
    approvalRate: { currentWeek: number; previousWeek: number };
    deleteRate: { currentWeek: number; previousWeek: number };
    copiedWithoutPost: number;
    topLearnedRules: string[];
    weeklyChanges: string[];
    memory: {
      alwaysDoMoreOfThis: string[];
      neverDoThisAgain: string[];
      topicsWithMomentum: string[];
      formatsUnderTested: string[];
      operatorHiddenPreferences: string[];
      identityConstraints: string[];
    } | null;
  };
  dataReady: boolean;
}

const METRIC_CONFIG: Record<string, {
  label: string;
  format: (v: number) => string;
  color?: string;
}> = {
  tweets_generated: { label: 'Total Generated', format: (v) => String(v) },
  tweets_posted: { label: 'Posted to X', format: (v) => String(v), color: '#22c55e' },
  tweets_queued: { label: 'In Queue', format: (v) => String(v), color: '#8b5cf6' },
  tweets_draft: { label: 'Drafts', format: (v) => String(v) },
  mentions: { label: 'Mentions', format: (v) => String(v), color: '#3b82f6' },
  auto_posted: { label: 'Auto-Posted', format: (v) => String(v), color: '#22c55e' },
  auto_replied: { label: 'Auto-Replied', format: (v) => String(v), color: '#3b82f6' },
  avg_engagement: { label: 'Avg Likes', format: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v) },
  viral_posts: { label: 'Viral Posts', format: (v) => String(v), color: '#f59e0b' },
  following: { label: 'Following', format: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v) },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

export function MetricsTab({ agentId }: MetricsTabProps) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [learnings, setLearnings] = useState<AgentLearnings | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesData | null>(null);
  const [healthScore, setHealthScore] = useState<number>(0);
  const [funnel, setFunnel] = useState<{ milestones: Array<{ event: string; reached: boolean; ts: string | null }>; currentStage: string; completionPct: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/agents/${agentId}/metrics`).then((r) => r.ok ? r.json() : { metrics: [], health: [] }),
      fetch(`/api/agents/${agentId}/learnings`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/agents/${agentId}/metrics/timeseries`).then((r) => r.ok ? r.json() : null),
    ])
      .then(([metricsData, learningsData, timeseriesData]) => {
        if (Array.isArray(metricsData)) setMetrics(metricsData);
        else if (metricsData?.metrics && Array.isArray(metricsData.metrics)) setMetrics(metricsData.metrics);
        if (metricsData?.healthScore !== undefined) setHealthScore(metricsData.healthScore);
        if (metricsData?.funnel) setFunnel(metricsData.funnel);
        if (learningsData && typeof learningsData === 'object' && learningsData.totalTracked > 0) {
          setLearnings(learningsData);
        }
        if (timeseriesData && typeof timeseriesData === 'object') {
          setTimeseries(timeseriesData);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) {
    return (
      <div className="metrics-grid">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="skeleton" style={{ height: '100px', borderRadius: '10px' }} />
        ))}
      </div>
    );
  }

  const maxDailyPosts = timeseries ? Math.max(...timeseries.daily.map((d) => d.tweetsPosted), 1) : 1;
  const maxDailyLikes = timeseries ? Math.max(...timeseries.daily.map((d) => d.avgLikes), 1) : 1;
  const maxFormatEng = learnings?.formatRankings.length ? Math.max(...learnings.formatRankings.map((f) => f.avgEngagement), 1) : 1;
  const maxTopicEng = learnings?.topicRankings.length ? Math.max(...learnings.topicRankings.map((t) => t.avgEngagement), 1) : 1;

  // Compute weekly comparison from timeseries
  const thisWeek = timeseries?.daily.slice(0, 7) || [];
  const lastWeek = timeseries?.daily.slice(7, 14) || [];
  const thisWeekPosts = thisWeek.reduce((s, d) => s + d.tweetsPosted, 0);
  const lastWeekPosts = lastWeek.reduce((s, d) => s + d.tweetsPosted, 0);
  const thisWeekAvgLikes = thisWeek.length > 0 ? Math.round(thisWeek.reduce((s, d) => s + d.avgLikes, 0) / Math.max(thisWeek.filter((d) => d.avgLikes > 0).length, 1)) : 0;
  const lastWeekAvgLikes = lastWeek.length > 0 ? Math.round(lastWeek.reduce((s, d) => s + d.avgLikes, 0) / Math.max(lastWeek.filter((d) => d.avgLikes > 0).length, 1)) : 0;

  const pctChange = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? '+100' : '0';
    return `${curr >= prev ? '+' : ''}${Math.round(((curr - prev) / prev) * 100)}`;
  };

  return (
    <div className="space-y-6">

      {/* ─── 0. Health Score + Weekly Comparison ──────────────────────────── */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {/* Health score */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          textAlign: 'center',
          minWidth: '120px',
        }}>
          <p style={{
            fontFamily: 'var(--font-display)',
            fontSize: '36px',
            fontWeight: 700,
            color: healthScore >= 70 ? '#22c55e' : healthScore >= 40 ? '#f59e0b' : '#ef4444',
          }}>{healthScore}</p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>HEALTH SCORE</p>
        </div>

        {/* Weekly comparison */}
        {timeseries && thisWeekPosts > 0 && (
          <div style={{
            flex: 1,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '16px',
            minWidth: '280px',
          }}>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '4px' }}>POSTS</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{thisWeekPosts}</p>
              {lastWeekPosts > 0 && <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: thisWeekPosts >= lastWeekPosts ? '#22c55e' : '#ef4444' }}>{pctChange(thisWeekPosts, lastWeekPosts)}% vs last week</p>}
            </div>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '4px' }}>AVG LIKES</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{thisWeekAvgLikes}</p>
              {lastWeekAvgLikes > 0 && <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: thisWeekAvgLikes >= lastWeekAvgLikes ? '#22c55e' : '#ef4444' }}>{pctChange(thisWeekAvgLikes, lastWeekAvgLikes)}% vs last week</p>}
            </div>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '4px' }}>THIS WEEK</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {thisWeek.filter((d) => d.tweetsPosted > 0).length} active days
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Funnel visualization */}
      {funnel && funnel.milestones.length > 0 && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '14px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>ACTIVATION FUNNEL</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{funnel.completionPct}% complete</p>
          </div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {funnel.milestones.map((m, i) => (
              <div key={m.event} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <div style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  background: m.reached ? '#8b5cf6' : 'var(--surface-2)',
                }} />
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '8px',
                  color: m.reached ? '#8b5cf6' : 'var(--text-dim)',
                  letterSpacing: '0.05em',
                  textAlign: 'center',
                }}>
                  {m.event.replace(/_/g, ' ').replace('wizard ', '').toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 1. Learning Digest Hero ──────────────────────────────────────── */}
      {learnings && learnings.insights.length > 0 ? (
        <div className="learning-digest">
          <div className="learning-digest-header">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M8 1C5.2 1 3 3.2 3 6c0 1.9 1 3.5 2.5 4.3V12a1 1 0 001 1h3a1 1 0 001-1v-1.7C12 9.5 13 7.9 13 6c0-2.8-2.2-5-5-5z" stroke="#8b5cf6" strokeWidth="1.3" />
              <line x1="6" y1="14" x2="10" y2="14" stroke="#8b5cf6" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <h2>What the system is learning</h2>
            <span className="section-count">updated {getTimeAgo(learnings.updatedAt)}</span>
          </div>
          <ul className="learning-insights">
            {learnings.insights.map((insight, i) => (
              <li key={i} className="learning-insight">{insight}</li>
            ))}
          </ul>
          <p className="learning-provenance">
            Based on {learnings.totalTracked} tracked tweets. Avg {learnings.avgLikes} likes, {learnings.avgRetweets} retweets.
          </p>
        </div>
      ) : (
        <div className="learning-empty">
          <div className="learning-digest-header">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M8 1C5.2 1 3 3.2 3 6c0 1.9 1 3.5 2.5 4.3V12a1 1 0 001 1h3a1 1 0 001-1v-1.7C12 9.5 13 7.9 13 6c0-2.8-2.2-5-5-5z" stroke="var(--text-dim)" strokeWidth="1.3" />
              <line x1="6" y1="14" x2="10" y2="14" stroke="var(--text-dim)" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <h2>Learning</h2>
          </div>
          <div className="learning-progress">
            <p className="learning-progress-label">
              Autopilot is gathering data... {timeseries?.postAutopilot?.tweetCount ?? 0} of 5 tweets tracked
            </p>
            <div className="lift-progress-bar">
              <div
                className="lift-progress-fill"
                style={{ width: `${Math.min(((timeseries?.postAutopilot?.tweetCount ?? 0) / 5) * 100, 100)}%` }}
              />
            </div>
            <p className="learning-progress-hint">
              Insights will appear once there&apos;s enough performance data to learn from.
            </p>
          </div>
        </div>
      )}

      {/* ─── 1B. Visible Compounding ─────────────────────────────────────── */}
      {timeseries?.compounding && (
        <div className="space-y-4">
          <div className="section-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <polyline points="2,11 6,7 9,8.5 14,3" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="10,3 14,3 14,7" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2>Compounding</h2>
            <span className="section-count">how the system is improving from operator feedback</span>
          </div>

          <div className="rankings-grid">
            <div className="perf-block">
              <p className="perf-block-label">APPROVAL RATE</p>
              <div className="perf-rows">
                <div className="perf-row">
                  <span className="perf-row-name">This week</span>
                  <span className="perf-row-stat">{timeseries.compounding.approvalRate.currentWeek}%</span>
                </div>
                <div className="perf-row">
                  <span className="perf-row-name">Last week</span>
                  <span className="perf-row-stat">{timeseries.compounding.approvalRate.previousWeek}%</span>
                </div>
              </div>
            </div>

            <div className="perf-block">
              <p className="perf-block-label">DELETE RATE</p>
              <div className="perf-rows">
                <div className="perf-row">
                  <span className="perf-row-name">This week</span>
                  <span className="perf-row-stat">{timeseries.compounding.deleteRate.currentWeek}%</span>
                </div>
                <div className="perf-row">
                  <span className="perf-row-name">Last week</span>
                  <span className="perf-row-stat">{timeseries.compounding.deleteRate.previousWeek}%</span>
                </div>
                {timeseries.compounding.copiedWithoutPost > 0 && (
                  <div className="perf-row">
                    <span className="perf-row-name">Copied, not posted</span>
                    <span className="perf-row-stat">{timeseries.compounding.copiedWithoutPost}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {timeseries.compounding.topLearnedRules.length > 0 && (
            <div className="learning-digest">
              <div className="learning-digest-header">
                <h2>Top learned rules</h2>
              </div>
              <ul className="learning-insights">
                {timeseries.compounding.topLearnedRules.map((rule, index) => (
                  <li key={index} className="learning-insight">{rule}</li>
                ))}
              </ul>
            </div>
          )}

          {timeseries.compounding.weeklyChanges.length > 0 && (
            <div className="perf-block">
              <p className="perf-block-label">What changed this week</p>
              <div className="perf-tweets">
                {timeseries.compounding.weeklyChanges.map((change, index) => (
                  <div key={index} className="perf-tweet">
                    <p className="perf-tweet-content">{change}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {timeseries.compounding.memory && (
            <div className="comparison-grid">
              {timeseries.compounding.memory.alwaysDoMoreOfThis.length > 0 && (
                <div className="perf-block">
                  <p className="perf-block-label">DO MORE OF THIS</p>
                  <div className="perf-tweets">
                    {timeseries.compounding.memory.alwaysDoMoreOfThis.map((item, index) => (
                      <div key={index} className="perf-tweet perf-tweet-best">
                        <p className="perf-tweet-content">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {timeseries.compounding.memory.neverDoThisAgain.length > 0 && (
                <div className="perf-block">
                  <p className="perf-block-label">NEVER DO THIS AGAIN</p>
                  <div className="perf-tweets">
                    {timeseries.compounding.memory.neverDoThisAgain.map((item, index) => (
                      <div key={index} className="perf-tweet perf-tweet-worst">
                        <p className="perf-tweet-content">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── 2. What's Working / What Isn't ──────────────────────────────── */}
      {learnings && (learnings.formatRankings.length > 0 || learnings.topicRankings.length > 0) && (
        <div>
          <div className="section-title mb-4">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <rect x="1" y="8" width="3" height="7" rx="1" fill="#8b5cf6" />
              <rect x="6" y="5" width="3" height="10" rx="1" fill="#8b5cf6" />
              <rect x="11" y="2" width="3" height="13" rx="1" fill="#8b5cf6" />
            </svg>
            <h2>What performs</h2>
            <span className="section-count">ranked by avg engagement</span>
          </div>

          <div className="rankings-grid">
            {learnings.formatRankings.length > 0 && (
              <div className="perf-block">
                <p className="perf-block-label">FORMATS</p>
                <div className="perf-rows">
                  {learnings.formatRankings.slice(0, 5).map((f) => (
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

            {learnings.topicRankings.length > 0 && (
              <div className="perf-block">
                <p className="perf-block-label">TOPICS</p>
                <div className="perf-rows">
                  {learnings.topicRankings.slice(0, 5).map((t) => (
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
        </div>
      )}

      {/* Best vs Worst tweets */}
      {learnings && (learnings.bestPerformers.length > 0 || learnings.worstPerformers.length > 0) && (
        <div className="comparison-grid">
          {learnings.bestPerformers.length > 0 && (
            <div className="perf-block">
              <p className="perf-block-label">TOP TWEETS</p>
              <div className="perf-tweets">
                {learnings.bestPerformers.slice(0, 3).map((t) => (
                  <div key={t.tweetId} className="perf-tweet perf-tweet-best">
                    <span className="perf-tweet-stat">{t.likes} likes</span>
                    <p className="perf-tweet-content">{t.content.slice(0, 160)}{t.content.length > 160 ? '...' : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {learnings.worstPerformers.length > 0 && (
            <div className="perf-block">
              <p className="perf-block-label">LOWEST PERFORMERS</p>
              <div className="perf-tweets">
                {learnings.worstPerformers.slice(0, 3).map((t) => (
                  <div key={t.tweetId} className="perf-tweet perf-tweet-worst">
                    <span className="perf-tweet-stat">{t.likes} likes</span>
                    <p className="perf-tweet-content">{t.content.slice(0, 160)}{t.content.length > 160 ? '...' : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 3. Autopilot Lift ────────────────────────────────────────────── */}
      {timeseries && timeseries.dataReady && timeseries.lift && (
        <div className="lift-section">
          <div className="section-title mb-4">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <polyline points="2,12 6,7 9,9 14,3" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="10,3 14,3 14,7" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2>Automation lift</h2>
            <span className="section-count">vs. pre-automation baseline</span>
          </div>
          {timeseries.lift.likesPercent >= 0 ? (
            <div className="lift-hero lift-positive">
              <span className="lift-hero-value">+{timeseries.lift.likesPercent}%</span>
              <span className="lift-hero-label">avg engagement improvement</span>
            </div>
          ) : (
            <div className="lift-hero-negative">
              <span className="lift-negative-value">{timeseries.lift.likesPercent}%</span>
              <span className="lift-negative-label">
                Based on {timeseries.postAutopilot.tweetCount} tweets. Try adjusting topics in Settings.
              </span>
            </div>
          )}
          <div className="lift-comparison">
            <div className="lift-comparison-item">
              <span className="lift-comparison-label">BEFORE</span>
              <span className="lift-comparison-value">{timeseries.baseline?.avgLikes ?? 0} avg likes</span>
            </div>
            <span className="lift-comparison-arrow">
              <svg viewBox="0 0 16 10" width="16" height="10" fill="none">
                <polyline points="1,5 13,5" stroke="var(--text-muted)" strokeWidth="1.5" />
                <polyline points="10,1 14,5 10,9" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div className="lift-comparison-item">
              <span className="lift-comparison-label">AFTER</span>
              <span className="lift-comparison-value">{timeseries.postAutopilot.avgLikes} avg likes</span>
            </div>
          </div>
          <p className="lift-provenance">
            Based on {timeseries.postAutopilot.tweetCount} tweets over 14 days
            {timeseries.baseline ? `. Baseline from ${formatDate(timeseries.baseline.snapshotDate)}` : ''}
          </p>
        </div>
      )}

      {/* ─── 4. Activity Trends ───────────────────────────────────────────── */}
      {timeseries && timeseries.daily.some((d) => d.tweetsPosted > 0) && (
        <div className="trend-section">
          <div className="section-title mb-4">
            <h2>Posting activity</h2>
            <span className="section-count">last 14 days</span>
          </div>
          <div className="trend-bars">
            {timeseries.daily.map((d) => (
              <div key={d.date} className="trend-bar-row">
                <span className="trend-bar-label">{formatDate(d.date)}</span>
                <div className="trend-bar-track">
                  <div
                    className="trend-bar"
                    style={{ width: `${(d.tweetsPosted / maxDailyPosts) * 100}%` }}
                    aria-valuenow={d.tweetsPosted}
                    aria-label={`${d.tweetsPosted} tweets on ${d.date}`}
                  />
                </div>
                <span className="trend-bar-value">{d.tweetsPosted}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {timeseries && timeseries.daily.some((d) => d.avgLikes > 0) && (
        <div className="trend-section">
          <div className="section-title mb-4">
            <h2>Engagement trend</h2>
            <span className="section-count">avg likes per day</span>
          </div>
          <div className="trend-bars">
            {timeseries.daily.filter((d) => d.avgLikes > 0 || d.tweetsPosted > 0).map((d) => (
              <div key={d.date} className="trend-bar-row">
                <span className="trend-bar-label">{formatDate(d.date)}</span>
                <div className="trend-bar-track">
                  <div
                    className={`trend-bar ${timeseries.baseline && d.avgLikes > timeseries.baseline.avgLikes ? 'above-avg' : ''}`}
                    style={{ width: `${(d.avgLikes / maxDailyLikes) * 100}%` }}
                    aria-valuenow={d.avgLikes}
                  />
                </div>
                <span className="trend-bar-value">{d.avgLikes}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 5. Live Counters (demoted) ───────────────────────────────────── */}
      <div className="section-title mb-4">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <rect x="1" y="8" width="3" height="7" rx="1" fill="var(--text-dim)" />
          <rect x="6" y="5" width="3" height="10" rx="1" fill="var(--text-dim)" />
          <rect x="11" y="2" width="3" height="13" rx="1" fill="var(--text-dim)" />
        </svg>
        <h2>Counters</h2>
      </div>

      {metrics.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>
            No data yet. Generate tweets, run analysis, or enable automation to see metrics.
          </p>
        </div>
      ) : (
        <div className="metrics-grid">
          {metrics.map((metric) => {
            const config = METRIC_CONFIG[metric.metricName];
            if (!config) return null;
            return (
              <div key={metric.id} className="metric-card" data-testid={`card-metric-${metric.metricName}`}>
                <div className="metric-label">{config.label}</div>
                <div
                  className="metric-value"
                  style={config.color ? { color: config.color } : undefined}
                  data-testid={`text-metric-value-${metric.metricName}`}
                >
                  {config.format(metric.value ?? 0)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
