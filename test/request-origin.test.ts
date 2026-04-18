import { describe, expect, it } from 'vitest';
import { resolveRequestOrigin } from '@/lib/request-origin';

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
});
