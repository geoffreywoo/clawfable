import { describe, expect, it } from 'vitest';
import {
  buildPerformanceSignalBaseline,
  confidenceAdjustedPerformanceAverage,
  computeRelativeSpreadSignal,
  summarizeFollowerGrowth,
  weightedSpreadEngagement,
} from '@/lib/performance-signals';
import type { TweetPerformance } from '@/lib/types';

function performance(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: overrides.tweetId || 'tweet-1',
    xTweetId: overrides.xTweetId || 'x-1',
    content: overrides.content || 'AI capability keeps moving faster than hiring plans.',
    format: overrides.format || 'hot_take',
    topic: overrides.topic || 'AI',
    postedAt: overrides.postedAt || '2026-08-20T00:00:00.000Z',
    checkedAt: overrides.checkedAt || '2026-08-21T00:00:00.000Z',
    likes: overrides.likes ?? 20,
    retweets: overrides.retweets ?? 3,
    replies: overrides.replies ?? 2,
    quotes: overrides.quotes ?? 1,
    bookmarks: overrides.bookmarks ?? 2,
    impressions: overrides.impressions ?? 2_000,
    engagementRate: overrides.engagementRate ?? 1.4,
    wasViral: overrides.wasViral ?? false,
    source: overrides.source || 'timeline',
    performanceCheckpoint: overrides.performanceCheckpoint || 'full_24h',
  };
}

describe('relative performance signals', () => {
  it('shrinks one-post topic spikes toward the account baseline', () => {
    const onePostSpike = confidenceAdjustedPerformanceAverage(100, 1, 50, 4);
    const establishedTopic = confidenceAdjustedPerformanceAverage(8 * 70, 8, 50, 4);

    expect(onePostSpike).toBe(60);
    expect(establishedTopic).toBeGreaterThan(onePostSpike);
  });

  it('values quote and bookmark spread above raw likes', () => {
    const history = Array.from({ length: 10 }, (_, index) => performance({
      tweetId: `baseline-${index}`,
      xTweetId: `x-baseline-${index}`,
    }));
    const baseline = buildPerformanceSignalBaseline(history);
    const likeHeavy = computeRelativeSpreadSignal(performance({
      likes: 100,
      retweets: 1,
      replies: 2,
      quotes: 0,
      bookmarks: 0,
    }), baseline);
    const shareHeavy = computeRelativeSpreadSignal(performance({
      likes: 18,
      retweets: 12,
      replies: 2,
      quotes: 9,
      bookmarks: 16,
    }), baseline);

    expect(shareHeavy.score).toBeGreaterThan(likeHeavy.score);
    expect(weightedSpreadEngagement(performance({ quotes: 9, bookmarks: 16 })))
      .toBeGreaterThan(weightedSpreadEngagement(performance({ likes: 100, quotes: 0, bookmarks: 0 })));
  });

  it('projects early velocity without treating a young post as a mature miss', () => {
    const history = Array.from({ length: 10 }, (_, index) => performance({
      tweetId: `baseline-${index}`,
      xTweetId: `x-baseline-${index}`,
    }));
    const signal = computeRelativeSpreadSignal(performance({
      postedAt: '2026-08-22T00:00:00.000Z',
      checkedAt: '2026-08-22T02:00:00.000Z',
      performanceCheckpoint: 'momentum_2h',
      likes: 12,
      retweets: 2,
      replies: 1,
      quotes: 1,
      bookmarks: 2,
      impressions: 1_100,
      engagementRate: 1.5,
    }), buildPerformanceSignalBaseline(history));

    expect(signal.projectedTo24Hours).toBe(true);
    expect(signal.score).toBeGreaterThan(0.5);
    expect(signal.metricCoverage).toBe(1);
  });

  it('uses a robust mature baseline instead of letting one viral outlier reset the bar', () => {
    const history = [
      ...Array.from({ length: 9 }, (_, index) => performance({
        tweetId: `normal-${index}`,
        xTweetId: `x-normal-${index}`,
        likes: 10,
      })),
      performance({ tweetId: 'outlier', xTweetId: 'x-outlier', likes: 50_000 }),
    ];

    expect(buildPerformanceSignalBaseline(history).likes).toBe(10);
  });
});

describe('summarizeFollowerGrowth', () => {
  it('summarizes a 7-day trend only with enough span', () => {
    const lines = summarizeFollowerGrowth([
      { capturedAt: '2026-08-30T00:00:00.000Z', followersCount: 1240 },
      { capturedAt: '2026-08-27T00:00:00.000Z', followersCount: 1190 },
      { capturedAt: '2026-08-24T00:00:00.000Z', followersCount: 1180 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('gained 60');
    expect(lines[0]).toContain('now 1240');
  });

  it('refuses to fabricate a trend from a single snapshot or a short span', () => {
    expect(summarizeFollowerGrowth([])).toEqual([]);
    expect(summarizeFollowerGrowth([
      { capturedAt: '2026-08-30T00:00:00.000Z', followersCount: 1240 },
    ])).toEqual([]);
    expect(summarizeFollowerGrowth([
      { capturedAt: '2026-08-30T06:00:00.000Z', followersCount: 1240 },
      { capturedAt: '2026-08-30T00:00:00.000Z', followersCount: 1200 },
    ])).toEqual([]);
  });

  it('reports losses and flat periods honestly', () => {
    const lost = summarizeFollowerGrowth([
      { capturedAt: '2026-08-30T00:00:00.000Z', followersCount: 1100 },
      { capturedAt: '2026-08-25T00:00:00.000Z', followersCount: 1150 },
    ]);
    expect(lost[0]).toContain('lost 50');
    const flat = summarizeFollowerGrowth([
      { capturedAt: '2026-08-30T00:00:00.000Z', followersCount: 1100 },
      { capturedAt: '2026-08-25T00:00:00.000Z', followersCount: 1100 },
    ]);
    expect(flat[0]).toContain('flat');
  });
});
