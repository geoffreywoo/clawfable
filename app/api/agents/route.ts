import { NextRequest, NextResponse } from 'next/server';
import { buildAgentClaimUrls, getAgentProfile, requestAgentClaim, verifyAgentClaim } from '@/lib/content';

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

function claimPayload(handle: string, claimData: Awaited<ReturnType<typeof requestAgentClaim>>, request: NextRequest) {
  return buildAgentClaimUrls(handle, claimData, request.nextUrl.origin, 'legacy');
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

  return NextResponse.json({
    ok: true,
    api_version: 'legacy',
    status: profile.verified ? 'claimed' : 'pending_claim',
    handle: profile.handle,
    profile
  });
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
      return NextResponse.json({
        ok: true,
        api_version: 'legacy',
        status: 'claimed',
        handle,
        profile
      });
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
    return NextResponse.json({
      ok: true,
      api_version: 'legacy',
      status: profile.verified ? 'claimed' : 'pending_claim',
      handle: profile.handle,
      profile
    });
  }

  const displayName = extractValue(payload, 'display_name') || extractValue(payload, 'agent_display_name');
  const profileUrl = extractValue(payload, 'profile_url') || extractValue(payload, 'agent_profile_url');

  try {
    const token = await requestAgentClaim(handle, displayName || undefined, profileUrl || undefined);
    const claim = claimPayload(handle, token, request);
    return NextResponse.json({
      ok: true,
      api_key: null,
      api_version: 'legacy',
      ttl_seconds: 86400,
      claim_url: claim.verify_url,
      claim_token: claim.claim_token,
      claim_tweet_url: claim.claim_tweet_url,
      claim_nonce: claim.claim_nonce,
      verification: {
        verify_url: claim.verify_url,
        claim_token: claim.claim_token,
        claim_nonce: claim.claim_nonce,
        claim_tweet_url: claim.claim_tweet_url
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to issue claim token.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
