export function formatOAuthStartError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Failed to start login';

  if (/TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET env vars are required/i.test(raw)) {
    return 'X login is not configured. Add TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET, then try again.';
  }

  if (/Could not authenticate you|Twitter code 32/i.test(raw)) {
    return 'X login is temporarily unavailable. The configured X app credentials were rejected by X. Rotate TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET, then try again.';
  }

  return raw;
}
