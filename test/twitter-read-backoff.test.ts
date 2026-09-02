import { describe, expect, it } from 'vitest';
import {
  TWITTER_READ_RATE_LIMIT_BACKOFF_MS,
  TWITTER_READ_TRANSIENT_BACKOFF_MS,
  getReadEndpointBackoffUntil,
  hasRecentReadEndpointFailure,
} from '@/lib/twitter-read-backoff';
import type { PostLogEntry } from '@/lib/types';

const NOW = Date.parse('2026-09-02T12:00:00.000Z');
const MINUTE = 60 * 1000;

function errorEntry(overrides: Partial<PostLogEntry> = {}): PostLogEntry {
  return {
    id: 'log-1',
    agentId: 'agent-1',
    tweetId: '',
    xTweetId: '',
    content: '',
    format: 'performance_timeline_error',
    topic: 'learning',
    postedAt: new Date(NOW - 30 * MINUTE).toISOString(),
    source: 'cron',
    action: 'error',
    reason: 'X performance timeline read failed.',
    errorCode: 'fetch_timeline_for_performance',
    ...overrides,
  };
}

describe('hasRecentReadEndpointFailure', () => {
  it('honors the advertised 429 reset time instead of a fixed multi-hour pause', () => {
    const resetInPast = errorEntry({
      errorCode: 'x_rate_limit',
      reason: 'X performance timeline read rate limited until 2026-09-02T11:50:00.000Z; learning will retry on a later cron run.',
    });
    expect(hasRecentReadEndpointFailure([resetInPast], 'performance_timeline_error', NOW)).toBe(false);

    const resetInFuture = errorEntry({
      errorCode: 'x_rate_limit',
      reason: 'X performance timeline read rate limited until 2026-09-02T12:10:00.000Z; learning will retry on a later cron run.',
    });
    expect(hasRecentReadEndpointFailure([resetInFuture], 'performance_timeline_error', NOW)).toBe(true);
    expect(getReadEndpointBackoffUntil(resetInFuture)).toBe(Date.parse('2026-09-02T12:10:30.000Z'));
  });

  it('falls back to a one-hour pause for a rate limit without a reset time', () => {
    const noReset = errorEntry({ errorCode: 'x_rate_limit', reason: 'X trend refresh rate limited; retry later.' });
    expect(TWITTER_READ_RATE_LIMIT_BACKOFF_MS).toBe(60 * MINUTE);
    expect(hasRecentReadEndpointFailure([noReset], 'performance_timeline_error', NOW)).toBe(true);
    expect(hasRecentReadEndpointFailure([noReset], 'performance_timeline_error', NOW + 31 * MINUTE)).toBe(false);
  });

  it('keeps a short pause for transient failures and none for other errors', () => {
    const transient = errorEntry({ errorCode: 'x_transient', postedAt: new Date(NOW - 10 * MINUTE).toISOString() });
    expect(TWITTER_READ_TRANSIENT_BACKOFF_MS).toBe(20 * MINUTE);
    expect(hasRecentReadEndpointFailure([transient], 'performance_timeline_error', NOW)).toBe(true);
    expect(hasRecentReadEndpointFailure([transient], 'performance_timeline_error', NOW + 11 * MINUTE)).toBe(false);

    const thirtyMinuteOldTransient = errorEntry({ errorCode: 'x_transient' });
    expect(hasRecentReadEndpointFailure([thirtyMinuteOldTransient], 'performance_timeline_error', NOW)).toBe(false);

    const unknown = errorEntry({ postedAt: new Date(NOW - MINUTE).toISOString() });
    expect(hasRecentReadEndpointFailure([unknown], 'performance_timeline_error', NOW)).toBe(false);
    const invalidCredentials = errorEntry({ errorCode: 'x_invalid_credentials', postedAt: new Date(NOW - MINUTE).toISOString() });
    expect(hasRecentReadEndpointFailure([invalidCredentials], 'performance_timeline_error', NOW)).toBe(false);
  });

  it('treats legacy entries without an error code as rate limits only when the reason says so', () => {
    const legacyRateLimit = errorEntry({ errorCode: undefined, reason: 'Rate limit exceeded on timeline read.' });
    expect(hasRecentReadEndpointFailure([legacyRateLimit], 'performance_timeline_error', NOW)).toBe(true);
    const legacyOther = errorEntry({ errorCode: undefined, reason: 'Request failed with status 500.' });
    expect(hasRecentReadEndpointFailure([legacyOther], 'performance_timeline_error', NOW)).toBe(false);
  });

  it('ignores non-error entries, other formats, and future-dated entries', () => {
    const entries = [
      errorEntry({ errorCode: 'x_rate_limit', action: 'skipped' }),
      errorEntry({ errorCode: 'x_rate_limit', format: 'auto_follow_error' }),
      errorEntry({ errorCode: 'x_rate_limit', postedAt: new Date(NOW + 5 * MINUTE).toISOString() }),
    ];
    expect(hasRecentReadEndpointFailure(entries, 'performance_timeline_error', NOW)).toBe(false);
    expect(hasRecentReadEndpointFailure(entries, ['auto_follow_error'], NOW)).toBe(true);
  });
});
