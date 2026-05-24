import { getAgents } from './kv-storage';
import type { Agent } from './types';

function compareCanonicalConnectedAgents(a: Agent, b: Agent): number {
  const readyDelta = Number(b.setupStep === 'ready') - Number(a.setupStep === 'ready');
  if (readyDelta !== 0) return readyDelta;

  const createdAtDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (createdAtDelta !== 0) return createdAtDelta;

  const aId = Number(a.id);
  const bId = Number(b.id);
  if (Number.isFinite(aId) && Number.isFinite(bId)) {
    return aId - bId;
  }

  return String(a.id).localeCompare(String(b.id));
}

export async function findExistingConnectedAgentByXUserId(
  xUserId: string,
  excludeAgentId?: string | null,
): Promise<Agent | null> {
  const normalizedXUserId = String(xUserId);
  const excluded = excludeAgentId ? String(excludeAgentId) : null;
  const agents = await getAgents();

  return agents
    .filter((agent) => {
      if (!agent.isConnected || !agent.xUserId) return false;
      if (String(agent.xUserId) !== normalizedXUserId) return false;
      if (excluded && String(agent.id) === excluded) return false;
      return true;
    })
    .sort(compareCanonicalConnectedAgents)[0] || null;
}
