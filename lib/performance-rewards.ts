import type { TweetPerformance } from './types';
import { collapsePerformanceSnapshots } from './performance-history';
import { buildPerformanceSignalBaseline, computeRelativeSpreadSignal, isMaturePerformance, type PerformanceSignalBaseline } from './performance-signals';
import { computeActionRewards } from './virality-signals';

export const PERFORMANCE_REWARD_DERIVATION_VERSION = 'mature-spread-action-2026-09-04-v1';

/** Recompute derived rewards from measured metrics; never mutate stored evidence. */
export function deriveMaturePerformanceReward(entry: TweetPerformance, baseline: PerformanceSignalBaseline): TweetPerformance {
  if (!isMaturePerformance(entry)) return entry;
  const actionRewards = computeActionRewards(entry, {
    avgLikes: baseline.likes,
    avgRetweets: baseline.retweets,
    avgQuotes: baseline.quotes ?? undefined,
    avgBookmarks: baseline.bookmarks ?? undefined,
  });
  const spread = computeRelativeSpreadSignal(entry, baseline);
  return {
    ...entry,
    actionRewards,
    qualityAdjustedGrowthScore: actionRewards.qualityAdjustedGrowthScore,
    relativeSpreadScore: spread.score,
    spreadMetricCoverage: spread.metricCoverage,
  };
}

export function deriveMaturePerformanceRewards(history: TweetPerformance[]): TweetPerformance[] {
  const baseline = buildPerformanceSignalBaseline(collapsePerformanceSnapshots(history.filter(isMaturePerformance)));
  return history.map((entry) => deriveMaturePerformanceReward(entry, baseline));
}
