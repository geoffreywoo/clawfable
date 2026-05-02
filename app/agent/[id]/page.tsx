import { redirect } from 'next/navigation';
import { AgentDashboardShell } from '@/app/components/agent-dashboard-shell';
import { CONTROL_ROOM_PATH } from '@/lib/app-routes';
import { AuthError, NotFoundError, requireAgentAccess } from '@/lib/auth';
import {
  buildAgentDetail,
  getAgentSummariesForUser,
  getProtocolSnapshot,
} from '@/lib/dashboard-data';
import { getMetricsArray } from '@/lib/kv-storage';
import { isSetupIncomplete } from '@/lib/setup-state';

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
      getAgentSummariesForUser(user).then((agents) => agents.filter((candidate) => candidate.id !== agent.id)),
      getProtocolSnapshot(user, agent),
      getMetricsArray(agent.id),
    ]);
    const agentDetail = await buildAgentDetail(agent);

    return (
      <AgentDashboardShell
        agentId={agent.id}
        initialAgent={agentDetail}
        initialOtherAgents={otherAgents}
        initialAutopilotData={{
          agentConnected: agent.isConnected === 1,
          agentHandle: agent.handle,
          settings: protocol.settings,
          billing: protocol.billing,
          postLog: protocol.postLog,
          metrics,
          autopilotHealth: protocol.autopilotHealth,
        }}
        shouldOpenSetupContinuation={
          resolvedSearchParams.oauth === 'success' && isSetupIncomplete(agent.setupStep)
        }
      />
    );
  } catch (err) {
    if (err instanceof AuthError || err instanceof NotFoundError) {
      redirect(CONTROL_ROOM_PATH);
    }

    console.error('Agent dashboard load failed', {
      agentId: id,
      error: err instanceof Error ? err.message : err,
    });
    throw err;
  }
}
