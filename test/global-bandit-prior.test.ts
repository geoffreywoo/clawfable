import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TweetPerformance } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getAgents: vi.fn(),
  getPerformanceHistory: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getAgents: mocks.getAgents,
  getPerformanceHistory: mocks.getPerformanceHistory,
}));

function rows(format: string, count = 6): TweetPerformance[] {
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return Array.from({ length: count }, (_, index) => ({
    tweetId: `${format}-${index}`,
    xTweetId: `x-${format}-${index}`,
    content: `post ${format} ${index} with some real content about startups and capital.`,
    format,
    topic: 'Startups',
    postedAt: recent,
    checkedAt: new Date().toISOString(),
    likes: 20 + index,
    retweets: 2,
    replies: 1,
    impressions: 500,
    engagementRate: 5,
    wasViral: false,
    source: 'autopilot',
  }));
}

async function loadModule() {
  vi.resetModules();
  return import('@/lib/global-bandit-prior');
}

describe('getGlobalBanditPrior', () => {
  beforeEach(() => {
    mocks.getAgents.mockReset();
    mocks.getPerformanceHistory.mockReset();
    mocks.getAgents.mockResolvedValue([{ id: 'agent-1' }, { id: 'agent-2' }]);
    mocks.getPerformanceHistory.mockImplementation(async (agentId: string) =>
      agentId === 'agent-1' ? rows('hot_take') : rows('question')
    );
  });

  it('excludes the requesting account so its own posts are not counted again as shared prior', async () => {
    const { getGlobalBanditPrior } = await loadModule();
    const prior = await getGlobalBanditPrior('agent-1');

    expect(mocks.getPerformanceHistory).toHaveBeenCalledTimes(1);
    expect(mocks.getPerformanceHistory).toHaveBeenCalledWith('agent-2', 80);
    expect(prior.sourceAccounts).toBe(1);
    expect(prior.totalSamples).toBe(6);
    expect(prior.families.format.some((entry) => entry.arm === 'hot_take')).toBe(false);
    expect(prior.families.format.some((entry) => entry.arm === 'question')).toBe(true);
  });

  it('returns an empty prior when no other account contributes', async () => {
    mocks.getAgents.mockResolvedValue([{ id: 'agent-1' }]);
    const { getGlobalBanditPrior } = await loadModule();
    const prior = await getGlobalBanditPrior('agent-1');

    expect(mocks.getPerformanceHistory).not.toHaveBeenCalled();
    expect(prior.sourceAccounts).toBe(0);
    expect(prior.totalSamples).toBe(0);
    expect(prior.families.format).toEqual([]);
  });

  it('caches per excluded account instead of sharing one prior across agents', async () => {
    const { getGlobalBanditPrior } = await loadModule();
    const first = await getGlobalBanditPrior('agent-1');
    const again = await getGlobalBanditPrior('agent-1');
    const other = await getGlobalBanditPrior('agent-2');

    expect(again).toBe(first);
    expect(mocks.getAgents).toHaveBeenCalledTimes(2);
    expect(other.families.format.some((entry) => entry.arm === 'hot_take')).toBe(true);
    expect(other.families.format.some((entry) => entry.arm === 'question')).toBe(false);
  });

  it('still aggregates every account when no exclusion is requested', async () => {
    const { getGlobalBanditPrior } = await loadModule();
    const prior = await getGlobalBanditPrior();

    expect(prior.sourceAccounts).toBe(2);
    expect(prior.totalSamples).toBe(12);
  });
});
