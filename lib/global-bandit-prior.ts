import type { BanditGlobalPrior } from './bandit';
import { buildBanditGlobalPrior } from './bandit';
import { getAgents, getPerformanceHistory } from './kv-storage';

const GLOBAL_PRIOR_TTL_MS = 15 * 60 * 1000;

const cachedPriors = new Map<string, { expiresAt: number; value: BanditGlobalPrior }>();

/**
 * Cross-account prior for the bandit. The requesting account's own rows are
 * excluded: they already enter its posteriors through episodes/fallback
 * observations, and including them again as prior pseudo-pulls double
 * counted every local post and reported self-evidence as "shared prior".
 * With no other contributing account the prior is empty (default pulls only).
 */
export async function getGlobalBanditPrior(excludeAgentId?: string | null): Promise<BanditGlobalPrior> {
  const cacheKey = excludeAgentId ? String(excludeAgentId) : '';
  const cached = cachedPriors.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const agents = (await getAgents()).filter((agent) => !cacheKey || String(agent.id) !== cacheKey);
  const histories = await Promise.all(agents.map((agent) => getPerformanceHistory(agent.id, 80)));
  const prior = buildBanditGlobalPrior({
    accountHistories: histories,
    sourceAccounts: agents.length,
  });

  cachedPriors.set(cacheKey, {
    expiresAt: Date.now() + GLOBAL_PRIOR_TTL_MS,
    value: prior,
  });

  return prior;
}
