import { describe, expect, it, vi } from 'vitest';
import { createAgent, createTweet, getLearningSignals, getProtocolSettings, getTweet } from '@/lib/kv-storage';

vi.mock('@/lib/automation-entitlement', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation-entitlement')>('@/lib/automation-entitlement');
  return {
    ...actual,
    assertAgentAutomationEntitlement: vi.fn(async () => ({
      source: 'agent_exemption',
      eligible: true,
      reason: 'test exemption',
      verifiedAt: new Date().toISOString(),
      paidThrough: null,
      paidInvoiceId: null,
      paidAmountCents: null,
      paidCurrency: null,
    })),
  };
});

import { regenerateAgentQueue } from '@/lib/autopilot';

describe('regenerateAgentQueue', () => {
  it('archives queued drafts with mild learning signals and applies the requested cadence', async () => {
    const agent = await createAgent({
      handle: 'queue-refresh-test',
      name: 'Queue Refresh',
      soulMd: '# soul',
    } as any);
    const queued = await Promise.all([1, 2, 3].map((index) => createTweet({
      agentId: agent.id,
      content: `Queued draft ${index} awaiting refresh with enough length to be realistic.`,
      type: 'original',
      status: 'queued',
      topic: 'startups',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    })));

    const result = await regenerateAgentQueue(agent, { postsPerDay: 5 });

    expect(result.archived).toBe(3);
    expect(result.postsPerDay).toBe(5);

    for (const tweet of queued) {
      const updated = await getTweet(tweet.id);
      expect(updated?.status).toBe('quarantined');
      expect(updated?.quarantineReason).toContain('Operator queue refresh');
      expect(updated?.preQuarantineStatus).toBe('queued');
    }

    const signals = await getLearningSignals(agent.id);
    const refreshSignals = signals.filter((signal) =>
      signal.signalType === 'deleted_from_queue'
      && queued.some((tweet) => tweet.id === signal.tweetId));
    expect(refreshSignals).toHaveLength(3);
    for (const signal of refreshSignals) {
      expect(signal.rewardDelta).toBe(-0.2);
    }

    const settings = await getProtocolSettings(agent.id);
    expect(settings.postsPerDay).toBe(5);
  });

  it('clamps an out-of-range cadence request instead of storing it', async () => {
    const agent = await createAgent({
      handle: 'queue-refresh-clamp',
      name: 'Queue Refresh Clamp',
      soulMd: '# soul',
    } as any);

    const result = await regenerateAgentQueue(agent, { postsPerDay: 99 });

    expect(result.archived).toBe(0);
    expect(result.postsPerDay).toBeLessThanOrEqual(12);
    const settings = await getProtocolSettings(agent.id);
    expect(settings.postsPerDay).toBe(result.postsPerDay);
  });
});
