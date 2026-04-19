'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const LearningTab = dynamic(() => import('@/app/components/learning-tab').then((mod) => mod.LearningTab), {
  loading: () => <InsightsSkeleton />,
});
const MetricsTab = dynamic(() => import('@/app/components/metrics-tab').then((mod) => mod.MetricsTab), {
  loading: () => <InsightsSkeleton />,
});

type InsightsView = 'learning' | 'results';

interface InsightsTabProps {
  agentId: string;
  initialView?: InsightsView;
  onViewChange?: (view: InsightsView) => void;
}

const INSIGHT_VIEWS: Array<{ id: InsightsView; label: string; copy: string }> = [
  {
    id: 'learning',
    label: 'Learning',
    copy: 'What the system believes, what changed this week, and which experiments are still under test.',
  },
  {
    id: 'results',
    label: 'Results',
    copy: 'Performance lift, trend lines, and account-level outcomes after the learning loop runs.',
  },
];

function InsightsSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((index) => (
        <div key={index} className="skeleton" style={{ height: '96px', borderRadius: '10px' }} />
      ))}
    </div>
  );
}

export function InsightsTab({ agentId, initialView = 'learning', onViewChange }: InsightsTabProps) {
  const [activeView, setActiveView] = useState<InsightsView>(initialView);

  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  const currentView = INSIGHT_VIEWS.find((view) => view.id === activeView) ?? INSIGHT_VIEWS[0];

  return (
    <div className="insights-shell">
      <section className="insights-switcher">
        <div>
          <p className="insights-kicker">Insights focus</p>
          <p className="insights-copy">{currentView.copy}</p>
        </div>
        <div className="insights-view-switch" role="tablist" aria-label="Insights sections">
          {INSIGHT_VIEWS.map((view) => {
            const isActive = view.id === activeView;
            return (
              <button
                key={view.id}
                role="tab"
                aria-selected={isActive}
                className={`insights-view-btn ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveView(view.id);
                  onViewChange?.(view.id);
                }}
              >
                {view.label}
              </button>
            );
          })}
        </div>
      </section>

      {activeView === 'learning' ? <LearningTab agentId={agentId} /> : <MetricsTab agentId={agentId} />}
    </div>
  );
}
