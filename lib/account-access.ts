import { getAgent, getAgentOwnerId, getAgents, getUserAgentIds, getUserByUsername } from './kv-storage';
import { getInternalSharedUsernames, isInternalSharedAccount, normalizeUsername } from './internal-accounts';
import type { Agent, User } from './types';

export async function getAccessibleUsers(user: User): Promise<User[]> {
  if (!isInternalSharedAccount(user)) {
    return [user];
  }

  const sharedUsernames = getInternalSharedUsernames();
  const sharedUsers = (
    await Promise.all(Array.from(sharedUsernames).map((username) => getUserByUsername(username)))
  ).filter((candidate): candidate is User => candidate !== null);
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

async function buildAccessScope(user: User): Promise<{
  accessibleUsers: User[];
  ownerIds: string[];
  ownerIdSet: Set<string>;
  recoverableHandles: Set<string>;
}> {
  const accessibleUsers = await getAccessibleUsers(user);
  const ownerIds = accessibleUsers.map((candidate) => String(candidate.id));
  const ownerIdSet = new Set(ownerIds);
  const recoverableHandles = new Set<string>();

  for (const candidate of accessibleUsers) {
    const normalized = normalizeUsername(candidate.username);
    if (normalized) recoverableHandles.add(normalized);
  }

  if (isInternalSharedAccount(user)) {
    for (const handle of getInternalSharedUsernames()) {
      recoverableHandles.add(handle);
    }
  }

  return { accessibleUsers, ownerIds, ownerIdSet, recoverableHandles };
}

async function getFallbackAgentIds(user: User, ownerIds: string[], accessibleUsers: User[]): Promise<string[]> {
  const agents = await getAgents();
  if (agents.length === 0) return [];

  const recoverableHandles = new Set<string>();
  for (const candidate of accessibleUsers) {
    const normalized = normalizeUsername(candidate.username);
    if (normalized) recoverableHandles.add(normalized);
  }

  if (isInternalSharedAccount(user)) {
    for (const handle of getInternalSharedUsernames()) {
      recoverableHandles.add(handle);
    }
  }

  const newestAgentIdByHandle = new Map<string, string>();
  for (const agent of agents) {
    const normalizedHandle = normalizeUsername(agent.handle);
    if (!normalizedHandle || newestAgentIdByHandle.has(normalizedHandle)) continue;
    newestAgentIdByHandle.set(normalizedHandle, String(agent.id));
  }

  const ownerEntries = await Promise.all(
    agents.map(async (agent) => [String(agent.id), await getAgentOwnerId(String(agent.id))] as const)
  );
  const ownerIdsByAgent = new Map(
    ownerEntries.map(([agentId, ownerId]) => [agentId, ownerId ? String(ownerId) : null] as const)
  );

  const fallbackIds = new Set<string>();
  for (const agent of agents) {
    const agentId = String(agent.id);
    const ownerId = ownerIdsByAgent.get(agentId);
    if (ownerId && ownerIds.includes(ownerId)) {
      fallbackIds.add(agentId);
      continue;
    }

    if (agent.xUserId && ownerIds.includes(String(agent.xUserId))) {
      fallbackIds.add(agentId);
    }
  }

  for (const handle of recoverableHandles) {
    const agentId = newestAgentIdByHandle.get(handle);
    if (agentId) {
      fallbackIds.add(agentId);
    }
  }

  return Array.from(fallbackIds);
}

export async function getAccessibleAgentIds(user: User): Promise<string[]> {
  const { accessibleUsers, ownerIds } = await buildAccessScope(user);
  const agentIdGroups = await Promise.all(ownerIds.map((ownerId) => getUserAgentIds(ownerId)));
  const directIds = new Set(agentIdGroups.flat().map(String));
  const fallbackIds = await getFallbackAgentIds(user, ownerIds, accessibleUsers);

  return Array.from(new Set([...directIds, ...fallbackIds]));
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
    .sort((a, b) => {
      const createdAtDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (createdAtDelta !== 0) return createdAtDelta;
      return Number(b.id) - Number(a.id);
    });
}

export async function canAccessAgent(user: User, agentId: string, preloadedAgent?: Agent | null): Promise<boolean> {
  const normalizedAgentId = String(agentId);
  const agent = preloadedAgent ?? await getAgent(normalizedAgentId);
  if (!agent) return false;

  const userId = String(user.id);
  const normalizedHandle = normalizeUsername(agent.handle);
  const directIds = await getUserAgentIds(userId);
  if (directIds.map(String).includes(normalizedAgentId)) {
    return true;
  }

  if (normalizedHandle && normalizedHandle === normalizeUsername(user.username)) {
    return true;
  }

  if (agent.xUserId && String(agent.xUserId) === userId) {
    return true;
  }

  const ownerId = await getAgentOwnerId(normalizedAgentId);
  if (ownerId && String(ownerId) === userId) {
    return true;
  }

  if (!isInternalSharedAccount(user)) return false;

  const sharedHandles = getInternalSharedUsernames();
  if (normalizedHandle && sharedHandles.has(normalizedHandle)) {
    return true;
  }

  const accessibleUsers = await getAccessibleUsers(user);
  const accessibleUserIds = new Set(accessibleUsers.map((candidate) => String(candidate.id)));
  if (ownerId && accessibleUserIds.has(String(ownerId))) {
    return true;
  }

  if (agent.xUserId && accessibleUserIds.has(String(agent.xUserId))) {
    return true;
  }

  const sharedDirectGroups = await Promise.all(
    Array.from(accessibleUserIds)
      .filter((candidateId) => candidateId !== userId)
      .map((candidateId) => getUserAgentIds(candidateId))
  );
  if (sharedDirectGroups.some((ids) => ids.map(String).includes(normalizedAgentId))) {
    return true;
  }

  return false;
}
