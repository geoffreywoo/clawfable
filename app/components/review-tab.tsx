'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const ComposeTab = dynamic(() => import('@/app/components/compose-tab').then((mod) => mod.ComposeTab), {
  loading: () => <ReviewSkeleton />,
});
const QueueTab = dynamic(() => import('@/app/components/queue-tab').then((mod) => mod.QueueTab), {
  loading: () => <ReviewSkeleton />,
});

type ReviewView = 'drafts' | 'approved';

interface ReviewTabProps {
  agentId: string;
}

function ReviewSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((index) => (
        <div key={index} className="skeleton" style={{ height: '96px', borderRadius: '10px' }} />
      ))}
    </div>
  );
}

const REVIEW_VIEWS: Array<{ id: ReviewView; label: string; copy: string }> = [
  {
    id: 'drafts',
    label: 'Draft new',
    copy: 'Generate fresh options and decide which ones deserve to move forward.',
  },
  {
    id: 'approved',
    label: 'Approved',
    copy: 'Edit, post, rescue, or remove drafts that are already cleared for the queue.',
  },
];

export function ReviewTab({ agentId }: ReviewTabProps) {
  const [activeView, setActiveView] = useState<ReviewView>('drafts');
  const currentView = REVIEW_VIEWS.find((view) => view.id === activeView) ?? REVIEW_VIEWS[0];

  return (
    <div className="workflow-shell">
      <section className="workflow-switcher">
        <div>
          <p className="workflow-kicker">Review</p>
          <p className="workflow-copy">{currentView.copy}</p>
        </div>
        <div className="workflow-view-switch" role="tablist" aria-label="Review sections">
          {REVIEW_VIEWS.map((view) => (
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

      {activeView === 'drafts' ? <ComposeTab agentId={agentId} /> : <QueueTab agentId={agentId} />}
    </div>
  );
}
