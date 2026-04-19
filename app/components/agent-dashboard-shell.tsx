'use client';

import { AgentDashboardClient } from './agent-dashboard-client';
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

export function AgentDashboardShell(props: AgentDashboardShellProps) {
  return <AgentDashboardClient {...props} />;
}
