import type { TweetPerformance } from './types';

export interface PerformanceSignalBaseline {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number | null;
  bookmarks: number | null;
  impressions: number;
  engagementRate: number;
  sampleCount: number;
}

export interface RelativeSpreadSignal {
  score: number;
  metricCoverage: number;
  projectedTo24Hours: boolean;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function median(values: number[], fallback: number): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return fallback;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function confidenceAdjustedPerformanceAverage(
  total: number,
  count: number,
  globalAverage: number,
  priorCount = 4,
): number {
  const observedCount = Math.max(0, count);
  const prior = Math.max(0, priorCount);
  if (observedCount + prior === 0) return 0;
  return ((Math.max(0, total)) + (Math.max(0, globalAverage) * prior)) / (observedCount + prior);
}

function observedAgeHours(entry: Pick<TweetPerformance, 'postedAt' | 'checkedAt'>): number {
  const posted = Date.parse(entry.postedAt);
  const checked = Date.parse(entry.checkedAt);
  if (!Number.isFinite(posted) || !Number.isFinite(checked)) return 24;
  return Math.max(0.25, (checked - posted) / (60 * 60 * 1000));
}

function isMature(entry: TweetPerformance): boolean {
  return entry.performanceCheckpoint === 'full_24h'
    || entry.performanceCheckpoint === 'late'
    || observedAgeHours(entry) >= 18;
}

export function weightedSpreadEngagement(
  entry: Pick<TweetPerformance, 'likes' | 'retweets' | 'replies' | 'quotes' | 'bookmarks'>,
): number {
  return finite(entry.likes)
    + (finite(entry.retweets) * 3)
    + (finite(entry.replies) * 2)
    + (finite(entry.quotes) * 5)
    + (finite(entry.bookmarks) * 4);
}

export function buildPerformanceSignalBaseline(history: TweetPerformance[]): PerformanceSignalBaseline {
  const mature = history.filter(isMature);
  const sample = mature.length >= 8 ? mature : history;
  const directQuoteRows = sample.filter((entry) => typeof entry.quotes === 'number');
  const directBookmarkRows = sample.filter((entry) => typeof entry.bookmarks === 'number');
  return {
    likes: Math.max(1, median(sample.map((entry) => finite(entry.likes)), 12)),
    retweets: Math.max(1, median(sample.map((entry) => finite(entry.retweets)), 2)),
    replies: Math.max(1, median(sample.map((entry) => finite(entry.replies)), 2)),
    quotes: directQuoteRows.length > 0
      ? Math.max(1, median(directQuoteRows.map((entry) => finite(entry.quotes)), 1))
      : null,
    bookmarks: directBookmarkRows.length > 0
      ? Math.max(1, median(directBookmarkRows.map((entry) => finite(entry.bookmarks)), 1))
      : null,
    impressions: Math.max(100, median(sample.map((entry) => finite(entry.impressions)), 1000)),
    engagementRate: Math.max(0.25, median(sample.map((entry) => finite(entry.engagementRate)), 2)),
    sampleCount: sample.length,
  };
}

function projectedMetric(value: number, entry: TweetPerformance): { value: number; projected: boolean } {
  const ageHours = observedAgeHours(entry);
  if (ageHours >= 18 || entry.performanceCheckpoint === 'full_24h' || entry.performanceCheckpoint === 'late') {
    return { value, projected: false };
  }
  const multiplier = Math.min(3.5, Math.sqrt(24 / Math.max(1, ageHours)));
  return { value: value * multiplier, projected: multiplier > 1.01 };
}

function relativeLiftScore(value: number, baseline: number): number {
  const ratio = (Math.max(0, value) + 1) / (Math.max(0, baseline) + 1);
  return clamp(0.5 + (Math.log2(ratio) * 0.17));
}

export function computeRelativeSpreadSignal(
  entry: TweetPerformance,
  baseline: PerformanceSignalBaseline,
): RelativeSpreadSignal {
  const metrics: Array<{ value: number; baseline: number; weight: number; direct: boolean }> = [
    { value: finite(entry.likes), baseline: baseline.likes, weight: 0.1, direct: true },
    { value: finite(entry.retweets), baseline: baseline.retweets, weight: 0.22, direct: true },
    { value: finite(entry.replies), baseline: baseline.replies, weight: 0.1, direct: true },
    { value: finite(entry.impressions), baseline: baseline.impressions, weight: 0.05, direct: true },
    { value: finite(entry.engagementRate), baseline: baseline.engagementRate, weight: 0.05, direct: true },
    {
      value: finite(entry.quotes),
      baseline: baseline.quotes || 1,
      weight: 0.25,
      direct: typeof entry.quotes === 'number' && baseline.quotes !== null,
    },
    {
      value: finite(entry.bookmarks),
      baseline: baseline.bookmarks || 1,
      weight: 0.23,
      direct: typeof entry.bookmarks === 'number' && baseline.bookmarks !== null,
    },
  ];
  const available = metrics.filter((metric) => metric.direct);
  const availableWeight = available.reduce((sum, metric) => sum + metric.weight, 0);
  if (availableWeight <= 0) return { score: 0.5, metricCoverage: 0, projectedTo24Hours: false };

  let projectedTo24Hours = false;
  const total = available.reduce((sum, metric) => {
    const projected = projectedMetric(metric.value, entry);
    projectedTo24Hours ||= projected.projected;
    return sum + (relativeLiftScore(projected.value, metric.baseline) * metric.weight);
  }, 0);

  return {
    score: Number(clamp(total / availableWeight).toFixed(3)),
    metricCoverage: Number(availableWeight.toFixed(3)),
    projectedTo24Hours,
  };
}

/**
 * 7-day follower growth summary lines for personalization memory. Requires at
 * least two snapshots spanning 24h so a single fetch never fabricates a trend.
 * Snapshots are newest first.
 */
export function summarizeFollowerGrowth(
  snapshots: Array<{ capturedAt: string; followersCount: number }>,
): string[] {
  if (snapshots.length < 2) return [];
  const newest = snapshots[0];
  const newestAt = Date.parse(newest.capturedAt);
  if (!Number.isFinite(newestAt)) return [];
  const weekAgo = newestAt - 7 * 24 * 60 * 60 * 1000;
  const baselineEntry = [...snapshots].reverse().find((entry) => {
    const at = Date.parse(entry.capturedAt);
    return Number.isFinite(at) && at >= weekAgo;
  });
  if (!baselineEntry || baselineEntry === newest) return [];
  const spanHours = (newestAt - Date.parse(baselineEntry.capturedAt)) / (60 * 60 * 1000);
  if (spanHours < 24) return [];
  const delta = newest.followersCount - baselineEntry.followersCount;
  const spanDays = Math.max(1, Math.round(spanHours / 24));
  if (delta === 0) return [`Followers flat at ${newest.followersCount} over the last ${spanDays}d.`];
  const direction = delta > 0 ? 'gained' : 'lost';
  return [`Account ${direction} ${Math.abs(delta)} follower${Math.abs(delta) === 1 ? '' : 's'} over the last ${spanDays}d (now ${newest.followersCount}).`];
}
