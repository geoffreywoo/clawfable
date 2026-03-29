'use client';

import { useState, useEffect } from 'react';
import type { Metric } from '@/lib/types';

interface MetricsTabProps {
  agentId: string;
}

const METRIC_CONFIG: Record<string, {
  label: string;
  format: (v: number) => string;
  delta: string;
  deltaUp: boolean;
}> = {
  tweets_generated: {
    label: 'Tweets Generated',
    format: (v) => String(v),
    delta: '+12 today',
    deltaUp: true,
  },
  tweets_posted: {
    label: 'Tweets Posted',
    format: (v) => String(v),
    delta: '+4 today',
    deltaUp: true,
  },
  avg_engagement: {
    label: 'Avg. Engagement',
    format: (v) => String(v),
    delta: '+18% vs last week',
    deltaUp: true,
  },
  follower_growth: {
    label: 'Followers',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)),
    delta: '+127 this week',
    deltaUp: true,
  },
  impressions_today: {
    label: 'Impressions Today',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)),
    delta: '-3% vs yesterday',
    deltaUp: false,
  },
  reply_rate: {
    label: 'Reply Rate',
    format: (v) => `${v}%`,
    delta: '+2% vs avg',
    deltaUp: true,
  },
};

const RECENT_ACTIVITY = [
  { time: '2m ago', event: 'Tweet generated for topic: OpenAI GPT-5 announcement', type: 'generate' },
  { time: '15m ago', event: 'Reply queued for @sama', type: 'queue' },
  { time: '32m ago', event: 'Tweet posted: "AI hype cycle reaches new peak..."', type: 'post' },
  { time: '1h ago', event: '3 new mentions detected', type: 'mention' },
  { time: '2h ago', event: 'Tweet generated for topic: AI regulation', type: 'generate' },
  { time: '3h ago', event: 'Reply posted to @garrytan', type: 'post' },
  { time: '4h ago', event: 'Follower milestone: 1,800 reached', type: 'milestone' },
];

export function MetricsTab({ agentId }: MetricsTabProps) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/agents/${agentId}/metrics`)
      .then((r) => r.json())
      .then(setMetrics)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) {
    return (
      <div className="metrics-grid">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="skeleton" style={{ height: '128px', borderRadius: '10px' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="section-title mb-4">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><rect x="1" y="8" width="3" height="7" rx="1" fill="#8b5cf6" /><rect x="6" y="5" width="3" height="10" rx="1" fill="#8b5cf6" /><rect x="11" y="2" width="3" height="13" rx="1" fill="#8b5cf6" /></svg>
        <h2>ENGAGEMENT METRICS</h2>
      </div>

      {/* Stats grid */}
      <div className="metrics-grid">
        {metrics.map((metric) => {
          const config = METRIC_CONFIG[metric.metricName];
          if (!config) return null;
          return (
            <div
              key={metric.id}
              className="metric-card"
              data-testid={`card-metric-${metric.metricName}`}
            >
              <div className="metric-label">{config.label}</div>
              <div
                className="metric-value"
                data-testid={`text-metric-value-${metric.metricName}`}
              >
                {config.format(metric.value ?? 0)}
              </div>
              <div className={`metric-delta ${config.deltaUp ? 'up' : 'down'}`}>
                {config.deltaUp ? (
                  <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polyline points="2,9 6,3 10,9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : (
                  <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polyline points="2,3 6,9 10,3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
                {config.delta}
              </div>
            </div>
          );
        })}
      </div>

      {/* Activity log */}
      <div>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: '12px',
          }}
        >
          RECENT ACTIVITY
        </p>
        <div>
          {RECENT_ACTIVITY.map((a, i) => (
            <div key={i} className="activity-row">
              <span className="activity-time">{a.time}</span>
              <div
                className="activity-dot"
                style={{
                  background:
                    a.type === 'post'
                      ? 'var(--green)'
                      : a.type === 'generate'
                      ? 'var(--primary)'
                      : a.type === 'milestone'
                      ? '#eab308'
                      : 'var(--text-muted)',
                }}
              />
              <span className="activity-event">{a.event}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
