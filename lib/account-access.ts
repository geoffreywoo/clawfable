import { getAgent, getUserAgentIds, getUsers } from './kv-storage';
import { getInternalSharedUsernames, isInternalSharedAccount, normalizeUsername } from './internal-accounts';
import type { Agent, User } from './types';

export async function getAccessibleUsers(user: User): Promise<User[]> {
  if (!isInternalSharedAccount(user)) {
    return [user];
  }

  const sharedUsernames = getInternalSharedUsernames();
  const users = await getUsers();
  const sharedUsers = users.filter((candidate) => sharedUsernames.has(normalizeUsername(candidate.username)));
  const deduped = new Map<string, User>([[user.id, user]]);

  for (const candidate of sharedUsers) {
    deduped.set(candidate.id, candidate);
  }

  return Array.from(deduped.values());
}

export async function getAccessibleUserIds(user: User): Promise<string[]> {
  const users = await getAccessibleUsers(user);
  return users.map((candidate) => String(candidate.id));
}

export async function getAccessibleAgentIds(user: User): Promise<string[]> {
  const ownerIds = await getAccessibleUserIds(user);
  const agentIdGroups = await Promise.all(ownerIds.map((ownerId) => getUserAgentIds(ownerId)));
  return Array.from(new Set(agentIdGroups.flat().map(String)));
}

export async function getAccessibleAgentCount(user: User): Promise<number> {
  return (await getAccessibleAgentIds(user)).length;
}

export async function getAccessibleAgents(user: User): Promise<Agent[]> {
  const agentIds = await getAccessibleAgentIds(user);
  if (agentIds.length === 0) return [];

  const agents = await Promise.all(agentIds.map((agentId) => getAgent(agentId)));
  return agents
    .filter((agent): agent is Agent => agent !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function canAccessAgent(user: User, agentId: string): Promise<boolean> {
  const agentIds = await getAccessibleAgentIds(user);
  return agentIds.includes(String(agentId));
}
