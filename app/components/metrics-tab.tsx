'use client';

import { useState, useEffect } from 'react';
import type { Metric } from '@/lib/types';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/agents/${agentId}/metrics`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (Array.isArray(data)) setMetrics(data); })
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
    </div>
  );
}
