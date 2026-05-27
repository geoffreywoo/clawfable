import type { NextRequest } from 'next/server';

function sanitizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^['"]+|['"]+$/g, '');
  return trimmed || null;
}

export function resolveRequestOrigin(request: NextRequest): string {
  return sanitizeOrigin(request.headers.get('origin'))
    || sanitizeOrigin(request.nextUrl.origin)
    || sanitizeOrigin(process.env.APP_URL)
    || 'http://localhost:3000';
}

function isLocalOrigin(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function resolveOAuthCallbackOrigin(request: NextRequest): string {
  const requestOrigin = resolveRequestOrigin(request);
  const appOrigin = sanitizeOrigin(process.env.APP_URL);
  if (appOrigin && !isLocalOrigin(requestOrigin)) return appOrigin;
  return requestOrigin;
}
