import type { PostLogEntry } from './types';

export const TWITTER_READ_ENDPOINT_BACKOFF_MS = 4 * 60 * 60 * 1000;

function entryTimestamp(entry: PostLogEntry): number | null {
  const value = entry.postedAt;
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function hasRecentReadEndpointFailure(
  postLog: PostLogEntry[],
  formats: string | string[],
  now = Date.now(),
  backoffMs = TWITTER_READ_ENDPOINT_BACKOFF_MS,
): boolean {
  const formatSet = new Set(Array.isArray(formats) ? formats : [formats]);

  return postLog.some((entry) => {
    if (entry.action !== 'error' || !formatSet.has(entry.format)) return false;
    const ts = entryTimestamp(entry);
    return ts !== null && now - ts >= 0 && now - ts < backoffMs;
  });
}
