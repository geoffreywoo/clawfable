'use client';

import { AgentDashboardClient } from './agent-dashboard-client';
import type { AutopilotHealthSnapshot, BillingSummary, AgentDetail, AgentSummary, Metric, PostLogEntry, ProtocolSettings } from '@/lib/types';

interface AutopilotInitialData {
  agentConnected: boolean;
  agentHandle: string;
  settings: ProtocolSettings;
  billing: BillingSummary;
  postLog: PostLogEntry[];
  metrics: Metric[];
  autopilotHealth?: AutopilotHealthSnapshot | null;
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
