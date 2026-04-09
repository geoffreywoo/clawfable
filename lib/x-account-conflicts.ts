import { getAgents } from './kv-storage';
import type { Agent } from './types';

export async function findExistingConnectedAgentByXUserId(
  xUserId: string,
  excludeAgentId?: string | null,
): Promise<Agent | null> {
  const normalizedXUserId = String(xUserId);
  const excluded = excludeAgentId ? String(excludeAgentId) : null;
  const agents = await getAgents();

  return agents.find((agent) => {
    if (!agent.isConnected || !agent.xUserId) return false;
    if (String(agent.xUserId) !== normalizedXUserId) return false;
    if (excluded && String(agent.id) === excluded) return false;
    return true;
  }) || null;
}
