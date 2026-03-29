'use client';

import { useState, useEffect } from 'react';
import type { Metric } from '@/lib/types';

interface MetricsTabProps {
  agentId: string;
}

const METRIC_CONFIG: Record<string, {
  label: string;
  format: (v: number) => string;
}> = {
  tweets_generated: {
    label: 'Tweets Generated',
    format: (v) => String(v),
  },
  tweets_posted: {
    label: 'Tweets Posted',
    format: (v) => String(v),
  },
  avg_engagement: {
    label: 'Avg. Engagement',
    format: (v) => String(v),
  },
  follower_growth: {
    label: 'Followers',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)),
  },
  impressions_today: {
    label: 'Impressions Today',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)),
  },
  reply_rate: {
    label: 'Reply Rate',
    format: (v) => `${v}%`,
  },
};

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
            </div>
          );
        })}
      </div>

    </div>
  );
}
