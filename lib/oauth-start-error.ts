interface OAuthStartErrorOptions {
  callbackUrl?: string | null;
}

function isLocalCallbackUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value);
}

export function formatOAuthStartError(error: unknown, options: OAuthStartErrorOptions = {}): string {
  const raw = error instanceof Error ? error.message : 'Failed to start login';

  if (/TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET env vars are required/i.test(raw)) {
    return 'X login is not configured. Add TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET, then try again.';
  }

  if (/Could not authenticate you|Twitter code 32/i.test(raw)) {
    return 'X login is temporarily unavailable. The configured X app credentials were rejected by X. Rotate TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET, then try again.';
  }

  if (/Request failed with code 403/i.test(raw) && isLocalCallbackUrl(options.callbackUrl)) {
    return 'Local X login is unavailable because the configured X app rejects localhost callback URLs. Test on the live app or run local dev behind a public callback URL.';
  }

  return raw;
}
