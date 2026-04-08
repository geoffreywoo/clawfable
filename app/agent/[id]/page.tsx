import { redirect } from 'next/navigation';
import { AgentDashboardClient } from '@/app/components/agent-dashboard-client';
import { requireAgentAccess } from '@/lib/auth';
import {
  getAgentSummariesForUser,
  getProtocolSnapshot,
  serializeAgentDetail,
} from '@/lib/dashboard-data';
import { getMetricsArray } from '@/lib/kv-storage';

interface AgentDashboardPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ oauth?: string }>;
}

export default async function AgentDashboardPage({ params, searchParams }: AgentDashboardPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;

  try {
    const { user, agent } = await requireAgentAccess(id);
    const [otherAgents, protocol, metrics] = await Promise.all([
      getAgentSummariesForUser(user.id).then((agents) => agents.filter((candidate) => candidate.id !== agent.id)),
      getProtocolSnapshot(user, agent.id),
      getMetricsArray(agent.id),
    ]);

    return (
      <AgentDashboardClient
        agentId={agent.id}
        initialAgent={serializeAgentDetail(agent)}
        initialOtherAgents={otherAgents}
        initialAutopilotData={{
          agentConnected: agent.isConnected === 1,
          agentHandle: agent.handle,
          settings: protocol.settings,
          billing: protocol.billing,
          postLog: protocol.postLog,
          metrics,
        }}
        shouldOpenSetupContinuation={resolvedSearchParams.oauth === 'success'}
      />
    );
  } catch {
    redirect('/');
  }
}
