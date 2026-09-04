import { describe, expect, it } from 'vitest';
import { deriveMaturePerformanceRewards } from '@/lib/performance-rewards';
import type { TweetPerformance } from '@/lib/types';

function measured(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: 'tweet-1', xTweetId: 'x-1', content: 'The packaging line lost six hours to one die.',
    format: 'observation', topic: 'Operations', postedAt: '2026-09-01T00:00:00.000Z', checkedAt: '2026-09-02T00:00:00.000Z',
    likes: 20, retweets: 3, replies: 2, quotes: 0, bookmarks: 1, impressions: 1000, engagementRate: 2.6,
    source: 'autopilot', wasViral: false, ...overrides,
  };
}

describe('derived performance reward repair', () => {
  it('replaces cached rewards only in derived mature rows and preserves raw attribution', () => {
    const mature = measured({ actionRewards: { total: -0.99, qualityAdjustedGrowthReward: -0.99 } as any,
      qualityAdjustedGrowthScore: 0, relativeSpreadScore: 0,
      draftExperimentId: 'exp-1', experimentHoldout: true, creativeLane: 'contrarian_angle' });
    const early = measured({ tweetId: 'early', xTweetId: 'early-x', checkedAt: '2026-09-01T02:00:00.000Z',
      likes: 100_000, actionRewards: { total: 0.99 } as any });
    const raw = structuredClone([mature, early]);
    const [repaired, unchangedEarly] = deriveMaturePerformanceRewards([mature, early]);

    expect(repaired.actionRewards?.total).not.toBe(-0.99);
    expect(repaired.qualityAdjustedGrowthScore).not.toBe(0);
    expect(repaired.relativeSpreadScore).not.toBe(0);
    expect(repaired).toMatchObject({ draftExperimentId: 'exp-1', experimentHoldout: true, creativeLane: 'contrarian_angle' });
    expect(unchangedEarly).toBe(early);
    expect([mature, early]).toEqual(raw);
    expect(deriveMaturePerformanceRewards([mature])[0]).toEqual(repaired);
  });

  it('excludes an early checkpoint before merging the mature baseline for that same post', () => {
    const mature = measured();
    const anomalousEarly = measured({ checkedAt: '2026-09-01T01:00:00.000Z', likes: 100_000, retweets: 10_000 });
    const [repaired] = deriveMaturePerformanceRewards([mature, anomalousEarly]);
    expect(repaired).toEqual(deriveMaturePerformanceRewards([mature])[0]);
  });
});
