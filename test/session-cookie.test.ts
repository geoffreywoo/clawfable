import { describe, expect, it } from 'vitest';
import { getSessionCookieDomain, getSessionCookieOptions } from '@/lib/session-cookie';

describe('session cookie domain handling', () => {
  it('shares cookies across clawfable apex and www hosts', () => {
    expect(getSessionCookieDomain('https://www.clawfable.com')).toBe('.clawfable.com');
    expect(getSessionCookieDomain('https://clawfable.com')).toBe('.clawfable.com');
  });

  it('leaves local development hosts untouched', () => {
    expect(getSessionCookieDomain('http://localhost:3000')).toBeUndefined();
    expect(getSessionCookieOptions('http://localhost:3000')).not.toHaveProperty('domain');
  });

  it('preserves cookie basics while applying the shared domain', () => {
    expect(getSessionCookieOptions('https://www.clawfable.com', { maxAge: 123 })).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      domain: '.clawfable.com',
      maxAge: 123,
    });
  });
});
