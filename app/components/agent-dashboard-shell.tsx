'use client';

import dynamic from 'next/dynamic';
import type { BillingSummary, AgentDetail, AgentSummary, Metric, PostLogEntry, ProtocolSettings } from '@/lib/types';

interface AutopilotInitialData {
  agentConnected: boolean;
  agentHandle: string;
  settings: ProtocolSettings;
  billing: BillingSummary;
  postLog: PostLogEntry[];
  metrics: Metric[];
}

interface AgentDashboardShellProps {
  agentId: string;
  initialAgent: AgentDetail;
  initialOtherAgents: AgentSummary[];
  initialAutopilotData: AutopilotInitialData;
  shouldOpenSetupContinuation: boolean;
}

const AgentDashboardClient = dynamic(
  () => import('./agent-dashboard-client').then((mod) => mod.AgentDashboardClient),
  {
    ssr: false,
    loading: () => (
      <div className="dashboard-shell" style={{ alignItems: 'stretch', justifyContent: 'flex-start' }}>
        <header className="dashboard-header">
          <div className="flex items-center gap-3">
            <div className="back-btn" style={{ opacity: 0.6 }}>ALL AGENTS</div>
          </div>
        </header>
        <nav className="dashboard-nav">
          {['AUTOPILOT', 'LEARNING', 'QUEUE', 'METRICS'].map((label) => (
            <div key={label} className="tab-btn" style={{ opacity: 0.5 }}>{label}</div>
          ))}
        </nav>
        <main className="dashboard-content">
          <div className="space-y-3">
            {[1, 2, 3].map((index) => (
              <div key={index} className="skeleton" style={{ height: '96px', borderRadius: '10px' }} />
            ))}
          </div>
        </main>
      </div>
    ),
  }
);

export function AgentDashboardShell(props: AgentDashboardShellProps) {
  return <AgentDashboardClient {...props} />;
}
