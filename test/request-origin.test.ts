import { afterEach, describe, expect, it } from 'vitest';
import { resolveOAuthCallbackOrigin, resolveRequestOrigin } from '@/lib/request-origin';

function makeRequest({
  origin,
  nextOrigin,
}: {
  origin?: string | null;
  nextOrigin?: string;
}) {
  return {
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'origin' ? (origin ?? null) : null;
      },
    },
    nextUrl: {
      origin: nextOrigin ?? 'https://fallback.example',
    },
  } as any;
}

describe('resolveRequestOrigin', () => {
  const originalAppUrl = process.env.APP_URL;

  afterEach(() => {
    process.env.APP_URL = originalAppUrl;
  });

  it('prefers the request origin header', () => {
    expect(resolveRequestOrigin(makeRequest({
      origin: 'https://www.clawfable.com',
      nextOrigin: 'https://clawfable.com',
    }))).toBe('https://www.clawfable.com');
  });

  it('falls back to request nextUrl origin', () => {
    expect(resolveRequestOrigin(makeRequest({
      origin: null,
      nextOrigin: 'https://www.clawfable.com',
    }))).toBe('https://www.clawfable.com');
  });

  it('strips wrapping quotes from origin values', () => {
    expect(resolveRequestOrigin(makeRequest({
      origin: '"https://www.clawfable.com"',
      nextOrigin: 'https://clawfable.com',
    }))).toBe('https://www.clawfable.com');
  });

  it('uses APP_URL as the canonical OAuth callback origin in production', () => {
    process.env.APP_URL = 'https://www.clawfable.com';

    expect(resolveOAuthCallbackOrigin(makeRequest({
      origin: 'https://clawfable.com',
      nextOrigin: 'https://clawfable.com',
    }))).toBe('https://www.clawfable.com');
  });

  it('keeps localhost OAuth callbacks local during development', () => {
    process.env.APP_URL = 'https://www.clawfable.com';

    expect(resolveOAuthCallbackOrigin(makeRequest({
      origin: 'http://localhost:3000',
      nextOrigin: 'http://localhost:3000',
    }))).toBe('http://localhost:3000');
  });
});
