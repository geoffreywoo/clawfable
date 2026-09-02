import type { PostLogEntry } from './types';

/** Fallback pause after a 429 whose reset time the log entry does not carry. */
export const TWITTER_READ_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;
/** Short pause after a transient (5xx-class) read failure. */
export const TWITTER_READ_TRANSIENT_BACKOFF_MS = 20 * 60 * 1000;
/** Grace added after X's advertised reset so the first retry lands past it. */
const RATE_LIMIT_RESET_GRACE_MS = 30 * 1000;

const RATE_LIMIT_RESET_IN_REASON_RE = /rate limited until (\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))/i;

function entryTimestamp(entry: PostLogEntry): number | null {
  const value = entry.postedAt;
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function isRateLimitEntry(entry: PostLogEntry): boolean {
  if (entry.errorCode) return entry.errorCode === 'x_rate_limit';
  return /rate limit/i.test(entry.reason || '');
}

/**
 * When a read on this endpoint should be retried, or null when the failure
 * carries no read backoff at all (invalid credentials, unknown errors).
 */
export function getReadEndpointBackoffUntil(
  entry: PostLogEntry,
  rateLimitBackoffMs = TWITTER_READ_RATE_LIMIT_BACKOFF_MS,
): number | null {
  const ts = entryTimestamp(entry);
  if (ts === null) return null;
  if (isRateLimitEntry(entry)) {
    const resetMatch = (entry.reason || '').match(RATE_LIMIT_RESET_IN_REASON_RE);
    const resetAtMs = resetMatch ? Date.parse(resetMatch[1]) : NaN;
    if (Number.isFinite(resetAtMs)) return resetAtMs + RATE_LIMIT_RESET_GRACE_MS;
    return ts + rateLimitBackoffMs;
  }
  if (entry.errorCode === 'x_transient') return ts + TWITTER_READ_TRANSIENT_BACKOFF_MS;
  return null;
}

export function hasRecentReadEndpointFailure(
  postLog: PostLogEntry[],
  formats: string | string[],
  now = Date.now(),
  rateLimitBackoffMs = TWITTER_READ_RATE_LIMIT_BACKOFF_MS,
): boolean {
  const formatSet = new Set(Array.isArray(formats) ? formats : [formats]);

  return postLog.some((entry) => {
    if (entry.action !== 'error' || !formatSet.has(entry.format)) return false;
    const ts = entryTimestamp(entry);
    if (ts === null || now - ts < 0) return false;
    const backoffUntil = getReadEndpointBackoffUntil(entry, rateLimitBackoffMs);
    return backoffUntil !== null && now < backoffUntil;
  });
}
