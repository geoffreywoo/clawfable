'use client';

import { useState, useEffect } from 'react';
import type { Metric, AgentLearnings } from '@/lib/types';

interface MetricsTabProps {
  agentId: string;
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

export function MetricsTab({ agentId }: MetricsTabProps) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [learnings, setLearnings] = useState<AgentLearnings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/agents/${agentId}/metrics`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/agents/${agentId}/learnings`).then((r) => r.ok ? r.json() : null),
    ])
      .then(([metricsData, learningsData]) => {
        if (Array.isArray(metricsData)) setMetrics(metricsData);
        if (learningsData && typeof learningsData === 'object' && learningsData.totalTracked > 0) {
          setLearnings(learningsData);
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

  return (
    <div className="space-y-6">
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
