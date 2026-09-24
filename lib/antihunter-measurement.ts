import type { TweetPerformance } from './types';

const HOUR_MS = 3_600_000;
export const COMPARISON_WINDOW_HOURS = [24, 30] as const;

/** Provider-created timestamps precede local publish persistence by milliseconds. */
export function comparisonPostedAt(history: TweetPerformance[], xTweetId: string, localPostedAt?: string | null): string | null {
  let earliest: TweetPerformance | null = null;
  for (const row of history) {
    if (row.xTweetId !== xTweetId || observedAgeHours(row) === null) continue;
    if (!earliest || Date.parse(row.checkedAt) < Date.parse(earliest.checkedAt)) earliest = row;
  }
  if (earliest) return earliest.postedAt;
  return typeof localPostedAt === 'string' && Number.isFinite(Date.parse(localPostedAt)) ? localPostedAt : null;
}

/** Use elapsed observation time, never a checkpoint label or current post age. */
export function observedAgeHours(entry: Pick<TweetPerformance, 'postedAt' | 'checkedAt'>): number | null {
  const posted = Date.parse(entry.postedAt);
  const checked = Date.parse(entry.checkedAt);
  if (!Number.isFinite(posted) || !Number.isFinite(checked) || checked < posted) return null;
  return (checked - posted) / HOUR_MS;
}

function inComparisonWindow(entry: Pick<TweetPerformance, 'postedAt' | 'checkedAt'>): boolean {
  const age = observedAgeHours(entry);
  return age !== null && age >= COMPARISON_WINDOW_HOURS[0] && age <= COMPARISON_WINDOW_HOURS[1];
}

/** Select a raw snapshot by time, without blending counts or choosing a winner. */
export function selectComparisonSnapshot(history: TweetPerformance[], xTweetId: string): TweetPerformance | null {
  if (!xTweetId) return null;
  let selected: TweetPerformance | null = null;
  for (const entry of history) {
    if (entry.xTweetId !== xTweetId || !inComparisonWindow(entry)) continue;
    if (!selected || Date.parse(entry.checkedAt) < Date.parse(selected.checkedAt)) selected = entry;
  }
  return selected;
}

/** Opt-in callers can preserve a reading skipped by the shared 18h checkpoint. */
export function needsComparisonSnapshot(history: TweetPerformance[], xTweetId: string, postedAt: string, checkedAt: string): boolean {
  return !!xTweetId && inComparisonWindow({ postedAt, checkedAt }) && !selectComparisonSnapshot(history, xTweetId);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function getOperatorComparison(history: TweetPerformance[], xTweetId: string) {
  const snapshot = selectComparisonSnapshot(history, xTweetId);
  const availability = snapshot?.publicMetricAvailability;
  const complete = !!snapshot && availability?.retweets === true && availability?.quotes === true
    && availability?.impressions === true && isCount(snapshot.retweets) && isCount(snapshot.quotes) && isCount(snapshot.impressions);
  const rate = complete && snapshot.impressions > 0
    ? (snapshot.retweets + snapshot.quotes!) / snapshot.impressions : null;
  const urlClicksAvailable = snapshot?.privateMetricAvailability?.urlClicks === true && isCount(snapshot.urlClicks);
  const urlClickRate = urlClicksAvailable && availability?.impressions === true && isCount(snapshot!.impressions) && snapshot!.impressions > 0
    ? snapshot!.urlClicks! / snapshot!.impressions : null;
  return {
    windowHours: COMPARISON_WINDOW_HOURS,
    selection: 'Earliest raw observation in the 24–30 hour window; no interpolation or blended counts.',
    snapshot,
    observedAgeHours: snapshot ? observedAgeHours(snapshot) : null,
    repostQuoteRate: rate,
    urlClicks: urlClicksAvailable ? snapshot!.urlClicks! : null,
    urlClicksAvailable,
    urlClickRate,
    rateUnit: 'fraction of impressions',
    eligible: rate !== null,
    coverage: !snapshot ? 'No observation in the comparison window.'
      : !complete ? 'Raw availability or valid counts for reposts, quotes or impressions are missing.'
        : snapshot.impressions === 0 ? 'Observed zero impressions; rate undefined.' : 'Observed counts available.',
  };
}
