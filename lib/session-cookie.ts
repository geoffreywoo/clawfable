interface SessionCookieOptionsInput {
  maxAge?: number;
}

function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = String(value).trim().replace(/^"+|"+$/g, '');
  if (!trimmed) return null;

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/:\d+$/, '').toLowerCase();
  }
}

function isLocalHost(hostOrOrigin: string | null | undefined): boolean {
  const host = normalizeHost(hostOrOrigin);
  return host === 'localhost' || host === '127.0.0.1';
}

export function getSessionCookieDomain(hostOrOrigin: string | null | undefined): string | undefined {
  const host = normalizeHost(hostOrOrigin);
  if (!host) return undefined;
  if (host === 'clawfable.com' || host.endsWith('.clawfable.com')) {
    return '.clawfable.com';
  }
  return undefined;
}

export function getSessionCookieOptions(
  hostOrOrigin: string | null | undefined,
  overrides: SessionCookieOptionsInput = {}
) {
  const domain = getSessionCookieDomain(hostOrOrigin);
  const secure = process.env.NODE_ENV === 'production' && !isLocalHost(hostOrOrigin);

  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    ...(domain ? { domain } : {}),
    ...(typeof overrides.maxAge === 'number' ? { maxAge: overrides.maxAge } : {}),
  };
}
