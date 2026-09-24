import { describe, expect, it } from 'vitest';
import { getOperatorComparison, needsComparisonSnapshot, observedAgeHours, selectComparisonSnapshot } from '@/lib/antihunter-measurement';
import type { TweetPerformance } from '@/lib/types';

const postedAt = '2026-09-20T12:00:00.000Z';
const sample = (hours: number, overrides: Partial<TweetPerformance> = {}) => ({
  xTweetId: 'post', postedAt, checkedAt: new Date(Date.parse(postedAt) + hours * 3_600_000).toISOString(),
  retweets: 2, quotes: 1, impressions: 100, publicMetricAvailability: { retweets: true, quotes: true, impressions: true },
  performanceCheckpoint: 'full_24h', ...overrides,
} as TweetPerformance);

describe('Anti Hunter comparable-age observations', () => {
  it('keeps missing private URL metrics unknown and distinguishes reported zero', () => {
    for (const overrides of [{}, { urlClicks: 0 }, { urlClicks: 2, privateMetricAvailability: { urlClicks: false, profileClicks: false } }]) {
      expect(getOperatorComparison([sample(25, overrides)], 'post')).toMatchObject({ urlClicks: null, urlClicksAvailable: false, urlClickRate: null });
    }
    expect(getOperatorComparison([sample(25, { urlClicks: 2, privateMetricAvailability: { urlClicks: true, profileClicks: true } })], 'post'))
      .toMatchObject({ urlClicks: 2, urlClicksAvailable: true, urlClickRate: 0.02 });
  });
  it('uses the raw 24–30 hour window rather than the shared maturity label', () => {
    for (const age of [18, 23.999, 30.001, 48]) expect(selectComparisonSnapshot([sample(age)], 'post')).toBeNull();
    for (const age of [24, 25, 30]) expect(selectComparisonSnapshot([sample(age)], 'post')).toEqual(sample(age));
  });
  it('retains the earliest comparable reading when a later total is larger', () => {
    const history = [sample(48, { retweets: 100 }), sample(29, { retweets: 30 }), sample(25), sample(18)];
    const unchanged = JSON.stringify(history);
    expect(getOperatorComparison(history, 'post')).toMatchObject({
      snapshot: sample(25), observedAgeHours: 25, repostQuoteRate: 0.03, eligible: true,
    });
    expect(JSON.stringify(history)).toBe(unchanged);
  });
  it('does not use another post, a future wall-clock age or an invalid timestamp as an observation', () => {
    const history = [sample(25, { xTweetId: 'other' }), sample(25, { checkedAt: 'invalid' }), sample(-1)];
    expect(getOperatorComparison(history, 'post')).toMatchObject({ snapshot: null, eligible: false, repostQuoteRate: null });
    expect(observedAgeHours(sample(25, { postedAt: 'invalid' }))).toBeNull();
    expect(selectComparisonSnapshot([sample(25, { xTweetId: '' })], '')).toBeNull();
    expect(needsComparisonSnapshot([], '', postedAt, sample(25).checkedAt)).toBe(false);
  });
  it('admits one comparison snapshot even after an 18-hour full_24h checkpoint', () => {
    const history = [sample(18)];
    expect(needsComparisonSnapshot(history, 'post', postedAt, sample(25).checkedAt)).toBe(true);
    expect(needsComparisonSnapshot([...history, sample(25)], 'post', postedAt, sample(29).checkedAt)).toBe(false);
    expect(needsComparisonSnapshot(history, 'post', postedAt, sample(31).checkedAt)).toBe(false);
  });
  it('preserves missing or invalid metrics as unknown rather than manufacturing a zero rate', () => {
    for (const overrides of [{ quotes: undefined }, { retweets: -1 }, { impressions: Number.NaN }, { quotes: 0.5 }]) {
      expect(getOperatorComparison([sample(25, overrides)], 'post')).toMatchObject({ eligible: false, repostQuoteRate: null });
    }
    expect(getOperatorComparison([sample(25, { impressions: 0 })], 'post')).toMatchObject({
      eligible: false, repostQuoteRate: null, coverage: 'Observed zero impressions; rate undefined.',
    });
    expect(getOperatorComparison([sample(25, { retweets: 0, quotes: 0 })], 'post')).toMatchObject({ eligible: true, repostQuoteRate: 0 });
  });
  it('does not cherry-pick a later complete row when the first observation lacks a metric', () => {
    const comparison = getOperatorComparison([sample(29), sample(25, { quotes: undefined })], 'post');
    expect(comparison).toMatchObject({ observedAgeHours: 25, eligible: false, repostQuoteRate: null });
  });
  it('requires raw provenance even when a shared adapter has defaulted absent counts to zero', () => {
    for (const availability of [undefined, null, { retweets: true, quotes: false, impressions: true }]) {
      expect(getOperatorComparison([sample(25, { quotes: 0, publicMetricAvailability: availability })], 'post'))
        .toMatchObject({ eligible: false, repostQuoteRate: null });
    }
  });
});
