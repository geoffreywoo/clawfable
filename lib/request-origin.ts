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
