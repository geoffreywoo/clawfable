import { NextRequest } from 'next/server';

export async function parseBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }
  const form = await request.formData();
  const data: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    data[key] = typeof value === 'string' ? value : String(value);
  }
  return data;
}

export function pickString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (value === undefined || value === null) return '';
  return String(value);
}

export function extractApiKey(request: NextRequest, payload: Record<string, unknown>): string {
  const headerValue = request.headers.get('authorization') || request.headers.get('x-agent-api-key') || '';
  const authMatch = headerValue.toLowerCase().startsWith('bearer ')
    ? headerValue.slice(7).trim()
    : headerValue.trim();
  return authMatch || pickString(payload, 'agent_api_key');
}
