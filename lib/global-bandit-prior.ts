import type { BanditGlobalPrior } from './bandit';
import { buildBanditGlobalPrior } from './bandit';
import { getAgents, getPerformanceHistory } from './kv-storage';

const GLOBAL_PRIOR_TTL_MS = 15 * 60 * 1000;

let cachedPrior: { expiresAt: number; value: BanditGlobalPrior } | null = null;

export async function getGlobalBanditPrior(): Promise<BanditGlobalPrior> {
  if (cachedPrior && cachedPrior.expiresAt > Date.now()) {
    return cachedPrior.value;
  }

  const agents = await getAgents();
  const histories = await Promise.all(agents.map((agent) => getPerformanceHistory(agent.id, 80)));
  const performanceHistory = histories.flat();
  const prior = buildBanditGlobalPrior({
    performanceHistory,
    sourceAccounts: agents.length,
  });

  cachedPrior = {
    expiresAt: Date.now() + GLOBAL_PRIOR_TTL_MS,
    value: prior,
  };

  return prior;
}
