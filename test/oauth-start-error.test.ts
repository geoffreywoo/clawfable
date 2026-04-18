import { describe, expect, it } from 'vitest';
import { formatOAuthStartError } from '@/lib/oauth-start-error';

describe('formatOAuthStartError', () => {
  it('maps missing env vars to a setup message', () => {
    expect(
      formatOAuthStartError(new Error('TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET env vars are required'))
    ).toContain('X login is not configured');
  });

  it('maps X code 32 failures to a credential rotation message', () => {
    expect(
      formatOAuthStartError(new Error('Request failed with code 401 - Could not authenticate you. (Twitter code 32)'))
    ).toContain('Rotate TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET');
  });

  it('passes through unrelated errors', () => {
    expect(formatOAuthStartError(new Error('Something else failed'))).toBe('Something else failed');
  });
});
