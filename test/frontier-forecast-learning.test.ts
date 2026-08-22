import { describe, expect, it } from 'vitest';
import {
  FRONTIER_FORECAST_LEARNING_VERSION,
  buildFrontierForecastLearningProfile,
  extractFrontierForecastFeatures,
} from '@/lib/frontier-forecast-learning';
import type { TweetPerformance } from '@/lib/types';

function performance(content: string, overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: overrides.tweetId || content.slice(0, 12),
    xTweetId: overrides.xTweetId || content.slice(0, 14),
    content,
    format: 'hot_take',
    topic: overrides.topic || 'AI',
    postedAt: overrides.postedAt || '2026-08-20T00:00:00.000Z',
    checkedAt: overrides.checkedAt || '2026-08-21T00:00:00.000Z',
    likes: overrides.likes ?? 30,
    retweets: overrides.retweets ?? 4,
    replies: overrides.replies ?? 3,
    quotes: overrides.quotes ?? 2,
    bookmarks: overrides.bookmarks ?? 4,
    impressions: overrides.impressions ?? 3_000,
    engagementRate: overrides.engagementRate ?? 1.5,
    wasViral: overrides.wasViral ?? false,
    source: overrides.source || 'timeline',
    performanceCheckpoint: 'full_24h',
    relativeSpreadScore: overrides.relativeSpreadScore,
    qualityAdjustedGrowthScore: overrides.qualityAdjustedGrowthScore,
  };
}

describe('frontier forecast learning', () => {
  const now = new Date('2026-08-22T00:00:00.000Z');

  it('recognizes a grounded aggressive robotics threshold forecast', () => {
    const features = extractFrontierForecastFeatures(
      "within 9 months, Figure's factory fleet will double useful task hours per dollar. once reliability clears 99%, suppliers stop staffing the overnight exception line.",
      'robotics',
      now,
    );

    expect(features).toEqual({
      domain: 'robotics_deployment',
      horizon: '6_12_months',
      posture: 'committed_prediction',
      grounding: 'quantified_curve',
      isForecast: true,
      aggressive: true,
      exponentialMechanism: true,
    });
  });

  it('distinguishes a lagging product wish from a trajectory forecast', () => {
    const features = extractFrontierForecastFeatures(
      'i want humanoid robots to start working in factories',
      'robotics',
      now,
    );

    expect(features.posture).toBe('wish_or_request');
    expect(features.isForecast).toBe(false);
    expect(features.aggressive).toBe(false);
    expect(features.exponentialMechanism).toBe(false);
  });

  it('stores performance mechanics as structured slices without historical prose', () => {
    const winning = "within 9 months, AI coding agents will double accepted changes per engineer. once review reliability clears the threshold, startups stop hiring for backlog growth.";
    const profile = buildFrontierForecastLearningProfile([
      performance(winning, { tweetId: 'winner-1', relativeSpreadScore: 0.84, wasViral: true }),
      performance('next year robots will double useful task hours per dollar once fleet reliability clears 99%. factories stop staffing every exception.', {
        tweetId: 'winner-2',
        topic: 'robotics',
        relativeSpreadScore: 0.8,
        wasViral: true,
      }),
      performance('i want AI coding agents to become good enough for hard work', {
        tweetId: 'wish-1',
        relativeSpreadScore: 0.3,
        source: 'autopilot',
      }),
    ], now);

    expect(profile.version).toBe(FRONTIER_FORECAST_LEARNING_VERSION);
    expect(profile.directShareMetricCoverage).toBe(1);
    expect(profile.aggressiveForecastShare).toBe(1);
    expect(profile.exponentialMechanismShare).toBe(1);
    expect(profile.domains.map((entry) => entry.key)).toEqual(expect.arrayContaining([
      'startup_organization',
      'robotics_deployment',
    ]));
    expect(JSON.stringify(profile)).not.toContain(winning);
  });
});
