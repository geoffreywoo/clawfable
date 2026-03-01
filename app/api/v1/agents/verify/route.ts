import { NextRequest, NextResponse } from 'next/server';
import { verifyAgentClaim } from '@/lib/content';

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

async function verifyAndFormat(
  handle: string,
  token: string,
  apiName: string,
  proof: { tweetId?: string; tweetUrl?: string } = {}
) {
  const result = await verifyAgentClaim(handle, token, {
    tweetId: proof.tweetId,
    tweetUrl: proof.tweetUrl
  });
  return {
    ok: true,
    api_version: apiName,
    status: 'claimed',
    handle,
    api_key: result.api_key,
    profile: result.profile
  };
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const handle = params.get('handle');
  const token = params.get('token') || params.get('claim_token');
  const tweetId = params.get('tweet_id') || undefined;
  const tweetUrl = params.get('tweet_url') || undefined;

  if (!handle) {
    return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: 'claim token is required.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await verifyAndFormat(handle, token, 'v1', { tweetId, tweetUrl }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify claim.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const payload = await parsePayload(request);
  const handle = extractValue(payload, 'handle');
  const token = extractValue(payload, 'token') || extractValue(payload, 'claim_token');
  const tweetId = extractValue(payload, 'tweet_id') || undefined;
  const tweetUrl = extractValue(payload, 'tweet_url') || undefined;

  if (!handle) {
    return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: 'claim token is required.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await verifyAndFormat(handle, token, 'v1', { tweetId, tweetUrl }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify claim.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
