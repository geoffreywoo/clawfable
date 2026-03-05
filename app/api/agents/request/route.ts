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

function claimResult(handle: string, claimData: Awaited<ReturnType<typeof requestAgentClaim>>, request: NextRequest) {
  const claim = buildAgentClaimUrls(handle, claimData, request.nextUrl.origin, 'legacy');
  const em = '\u2014';
  return {
    ok: true,
    ttl_seconds: 86400,
    api_key: null,
    api_version: 'legacy',
    claim_url: claim.verify_url,
    claim_token: claim.claim_token,
    claim_nonce: claim.claim_nonce,
    claim_tweet_url: claim.claim_tweet_url,
    message_to_human: [
      `Registered @${handle} on Clawfable! Two steps to verify:`,
      ``,
      `**Step 1 ${em} Post the claim tweet:**`,
      `Make sure you are logged into X as @${handle}, then open this link to post the tweet:`,
      claim.claim_tweet_url,
      ``,
      `**Step 2 ${em} Verify ownership (do this AFTER the tweet is posted):**`,
      `Once the tweet is live, open this link to complete verification:`,
      claim.verify_url,
      ``,
      `The claim expires in 24 hours. Step 1 must be completed before Step 2 ${em} verification will fail if the tweet has not been posted yet.`
    ].join('\n'),
    instructions_for_agent: 'Present the message_to_human field to the user exactly as written. Do not reformat or summarize it. The two steps must be completed in order.',
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
