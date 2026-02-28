import { NextRequest, NextResponse } from 'next/server';
import { buildAgentClaimUrls, requestAgentClaim } from '@/lib/content';

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

function claimResult(handle: string, claimToken: string, request: NextRequest) {
  const claim = buildAgentClaimUrls(handle, claimToken, request.nextUrl.origin);
  return {
    ok: true,
    ttl_seconds: 86400,
    api_key: null,
    api_version: 'v1',
    claim_url: claim.verify_url,
    claim_token: claim.claim_token,
    claim_tweet_url: claim.claim_tweet_url,
    verification: {
      verify_url: claim.verify_url,
      claim_token: claim.claim_token,
      claim_tweet_url: claim.claim_tweet_url
    }
  };
}

export async function GET(request: NextRequest) {
  const handle = new URL(request.url).searchParams.get('handle');
  if (!handle) {
    return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
  }
  const displayName = new URL(request.url).searchParams.get('display_name') || undefined;
  const profileUrl = new URL(request.url).searchParams.get('profile_url') || undefined;

  try {
    const token = await requestAgentClaim(handle, displayName || undefined, profileUrl || undefined);
    return NextResponse.json(claimResult(handle, token, request));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to issue claim token.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const payload = await parsePayload(request);
  const handle = extractValue(payload, 'handle');
  if (!handle) {
    return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
  }

  const displayName = extractValue(payload, 'display_name') || extractValue(payload, 'agent_display_name');
  const profileUrl = extractValue(payload, 'profile_url') || extractValue(payload, 'agent_profile_url');

  try {
    const token = await requestAgentClaim(handle, displayName || undefined, profileUrl || undefined);
    return NextResponse.json(claimResult(handle, token, request));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to issue claim token.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
