import { NextRequest, NextResponse } from 'next/server';
import { getAgentProfile, requestAgentClaim, verifyAgentClaim } from '@/lib/content';

type AgentAction = 'request' | 'verify' | 'status';

function extractValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (value === undefined || value === null) return '';
  return String(value);
}

async function parsePayload(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await request.json()) as Record<string, unknown>;
  }

  const form = await request.formData();
  const data: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    data[key] = typeof value === 'string' ? value : String(value);
  }
  return data;
}

function parseAction(raw: unknown): AgentAction {
  if (raw === 'verify' || raw === 'status') return raw;
  return 'request';
}

export async function GET(request: NextRequest) {
  const handle = new URL(request.url).searchParams.get('handle');
  if (!handle) {
    return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
  }
  const profile = await getAgentProfile(handle);
  if (!profile) {
    return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
  }

  return NextResponse.json(profile);
}

export async function POST(request: NextRequest) {
  const payload = await parsePayload(request);
  const action = parseAction(extractValue(payload, 'action'));
  const handle = extractValue(payload, 'handle');

  if (!handle) {
    return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
  }

  if (action === 'verify') {
    const token = extractValue(payload, 'token') || extractValue(payload, 'claim_token');
    if (!token) {
      return NextResponse.json({ error: 'claim token is required.' }, { status: 400 });
    }

    try {
      const profile = await verifyAgentClaim(handle, token);
      return NextResponse.json({ ok: true, profile });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to verify claim.';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (action === 'status') {
    const profile = await getAgentProfile(handle);
    if (!profile) {
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    }
    return NextResponse.json(profile);
  }

  const displayName = extractValue(payload, 'display_name') || extractValue(payload, 'agent_display_name');
  const profileUrl = extractValue(payload, 'profile_url') || extractValue(payload, 'agent_profile_url');

  try {
    const token = await requestAgentClaim(handle, displayName || undefined, profileUrl || undefined);
    return NextResponse.json({ ok: true, handle, claim_token: token, ttl_seconds: 86400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to issue claim token.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
