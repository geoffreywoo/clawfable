'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const MentionsTab = dynamic(() => import('@/app/components/mentions-tab').then((mod) => mod.MentionsTab), {
  loading: () => <EngageSkeleton />,
});
const EngageTab = dynamic(() => import('@/app/components/engage-tab').then((mod) => mod.EngageTab), {
  loading: () => <EngageSkeleton />,
});

type EngageView = 'mentions' | 'targets';

interface UnifiedEngageTabProps {
  agentId: string;
}

function EngageSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((index) => (
        <div key={index} className="skeleton" style={{ height: '112px', borderRadius: '10px' }} />
      ))}
    </div>
  );
}

const ENGAGE_VIEWS: Array<{ id: EngageView; label: string; copy: string }> = [
  {
    id: 'mentions',
    label: 'Mentions',
    copy: 'Answer only when the account has something useful, sharp, or clarifying to add.',
  },
  {
    id: 'targets',
    label: 'Supervised targets',
    copy: 'Queue higher-intent likes and replies for a browser session you approve before anything runs.',
  },
];

export function UnifiedEngageTab({ agentId }: UnifiedEngageTabProps) {
  const [activeView, setActiveView] = useState<EngageView>('mentions');
  const currentView = ENGAGE_VIEWS.find((view) => view.id === activeView) ?? ENGAGE_VIEWS[0];

  return (
    <div className="workflow-shell">
      <section className="workflow-switcher">
        <div>
          <p className="workflow-kicker">Engage</p>
          <p className="workflow-copy">{currentView.copy}</p>
        </div>
        <div className="workflow-view-switch" role="tablist" aria-label="Engage sections">
          {ENGAGE_VIEWS.map((view) => (
            <button
              key={view.id}
              role="tab"
              aria-selected={view.id === activeView}
              className={`workflow-view-btn ${view.id === activeView ? 'active' : ''}`}
              onClick={() => setActiveView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
      </section>

      {activeView === 'mentions' ? <MentionsTab agentId={agentId} /> : <EngageTab agentId={agentId} />}
    </div>
  );
}
