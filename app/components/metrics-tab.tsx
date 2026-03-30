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

export function MetricsTab({ agentId }: MetricsTabProps) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [learnings, setLearnings] = useState<AgentLearnings | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/agents/${agentId}/metrics`).then((r) => r.ok ? r.json() : { metrics: [], health: [] }),
      fetch(`/api/agents/${agentId}/learnings`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/agents/${agentId}/metrics/timeseries`).then((r) => r.ok ? r.json() : null),
    ])
      .then(([metricsData, learningsData, timeseriesData]) => {
        // Handle both old (array) and new ({ metrics, health }) response shapes
        if (Array.isArray(metricsData)) setMetrics(metricsData);
        else if (metricsData?.metrics && Array.isArray(metricsData.metrics)) setMetrics(metricsData.metrics);
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

  return (
    <div className="space-y-6">
      {/* Lift hero */}
      {timeseries && timeseries.dataReady && timeseries.lift && (
        <div className="lift-section">
          <div className="section-title mb-4">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <polyline points="2,12 6,7 9,9 14,3" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="10,3 14,3 14,7" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2>AUTOPILOT LIFT</h2>
            <span className="section-count">vs. pre-autopilot baseline</span>
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

      {/* Not enough data state */}
      {timeseries && !timeseries.dataReady && (
        <div className="lift-gathering">
          <div className="section-title mb-4">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <polyline points="2,12 6,7 9,9 14,3" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2>AUTOPILOT LIFT</h2>
          </div>
          <div className="lift-progress">
            <p className="lift-progress-label">
              Gathering data... {timeseries.postAutopilot.tweetCount} of 5 tweets tracked
            </p>
            <div className="lift-progress-bar">
              <div
                className="lift-progress-fill"
                style={{ width: `${Math.min((timeseries.postAutopilot.tweetCount / 5) * 100, 100)}%` }}
              />
            </div>
            {!timeseries.baseline && (
              <p className="lift-progress-hint">Baseline will be set when autopilot is first enabled.</p>
            )}
          </div>
        </div>
      )}

      {/* Daily trends */}
      {timeseries && timeseries.daily.some((d) => d.tweetsPosted > 0) && (
        <div className="trend-section">
          <div className="section-title mb-4">
            <h2>POSTING ACTIVITY</h2>
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
            <h2>ENGAGEMENT TREND</h2>
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

      {/* Counter grid */}
      <div className="section-title mb-4">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <rect x="1" y="8" width="3" height="7" rx="1" fill="#8b5cf6" />
          <rect x="6" y="5" width="3" height="10" rx="1" fill="#8b5cf6" />
          <rect x="11" y="2" width="3" height="13" rx="1" fill="#8b5cf6" />
        </svg>
        <h2>METRICS</h2>
        <span className="section-count">live from account data</span>
      </div>

      {metrics.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>
            No data yet. Generate tweets, run analysis, or enable autopilot to see metrics.
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

      {/* Learnings (existing) */}
      {learnings && (
        <div className="perf-section">
          <div className="section-title mb-4" style={{ marginTop: '32px' }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <polyline points="2,12 6,7 9,9 14,3" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2>PERFORMANCE LEARNINGS</h2>
            <span className="section-count">{learnings.totalTracked} tweets tracked</span>
          </div>

          {learnings.formatRankings.length > 0 && (
            <div className="perf-block">
              <p className="perf-block-label">FORMAT RANKINGS</p>
              <div className="perf-rows">
                {learnings.formatRankings.slice(0, 5).map((f) => (
                  <div key={f.format} className="perf-row">
                    <span className="perf-row-name">{f.format.replace(/_/g, ' ')}</span>
                    <span className="perf-row-stat">{f.avgEngagement} avg likes</span>
                    <span className="perf-row-count">{f.count} posts</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {learnings.topicRankings.length > 0 && (
            <div className="perf-block">
              <p className="perf-block-label">TOPIC RANKINGS</p>
              <div className="perf-rows">
                {learnings.topicRankings.slice(0, 5).map((t) => (
                  <div key={t.topic} className="perf-row">
                    <span className="perf-row-name">{t.topic}</span>
                    <span className="perf-row-stat">{t.avgEngagement} avg likes</span>
                    <span className="perf-row-count">{t.count} posts</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          {learnings.insights.length > 0 && (
            <div className="perf-block">
              <p className="perf-block-label">AI INSIGHTS</p>
              <ul className="perf-insights">
                {learnings.insights.map((insight, i) => (
                  <li key={i} className="perf-insight">{insight}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
