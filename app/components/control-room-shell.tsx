'use client';

import dynamic from 'next/dynamic';
import type { AgentSummary, BillingSummary } from '@/lib/types';

interface AuthUser {
  id: string;
  username: string;
  name: string;
  billing: BillingSummary;
}

interface ControlRoomShellProps {
  initialUser: AuthUser;
  initialAgents: AgentSummary[];
}

const HomeMissionControl = dynamic(
  () => import('./home-mission-control').then((mod) => mod.HomeMissionControl),
  {
    ssr: false,
    loading: () => (
      <div className="page-shell">
        <main className="page-main">
          <div className="content-wrap">
            <div className="home-brief">
              <div className="home-brief-copy">
                <p className="home-brief-label">LOADING</p>
                <h2 className="home-brief-title">Opening your control room...</h2>
                <p className="home-brief-body">
                  Preparing your agents, queue state, and billing context.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    ),
  }
);

export function ControlRoomShell({ initialUser, initialAgents }: ControlRoomShellProps) {
  return <HomeMissionControl initialUser={initialUser} initialAgents={initialAgents} />;
}
