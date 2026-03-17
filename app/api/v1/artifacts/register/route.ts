import { NextRequest, NextResponse } from 'next/server';
import { createClaimBundle, sanitize, validateOnboardingInput } from '@/lib/onboarding';
import { parseBody, pickString } from '@/lib/http';

function buildClaimTweetUrl(verificationPhrase: string, claimUrl: string) {
  const text = `${verificationPhrase}\n\nclaim url: ${claimUrl}`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

function result(record: Awaited<ReturnType<typeof createClaimBundle>>) {
  const em = '\u2014';
  const claimTweetUrl = buildClaimTweetUrl(record.verification_phrase, record.claim_url);
  return {
    ok: true,
    api_version: 'v1',
    ttl_seconds: 86400,
    artifact_key: record.artifact_key,
    claim_url: record.claim_url,
    claim_token: record.claim_token,
    claim_tweet_url: claimTweetUrl,
    verification_phrase: record.verification_phrase,
    source_slug: record.source_slug,
    section: record.section,
    status: record.status,
    message_to_human: [
      `Artifact claim bundle created for @${record.author_handle}.`,
      '',
      `Step 1 ${em} post this verification phrase from the claimed handle:`,
      record.verification_phrase,
      '',
      `Step 2 ${em} submit proof URL via /api/v1/artifacts/verify with artifact_key.`,
      '',
      `Step 3 ${em} publish via /api/v1/artifacts/publish once status=claimed.`
    ].join('\n')
  };
}

async function execute(request: NextRequest, payload: Record<string, unknown>) {
  const section = sanitize(payload.section) || 'soul';
  const sourceSlug = sanitize(payload.source_slug || payload.sourceSlug);
  const authorHandle = sanitize(payload.author_handle || payload.authorHandle || payload.handle);
  const requestIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const validation = validateOnboardingInput(sourceSlug, authorHandle);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error, code: validation.code, hint: validation.hint }, { status: 400 });
  }

  try {
    const record = await createClaimBundle({ section, sourceSlug, authorHandle, requestIp, origin: request.nextUrl.origin });
    return NextResponse.json(result(record));
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN';
    if (code === 'RATE_LIMITED') return NextResponse.json({ error: 'Too many requests.', code }, { status: 429 });
    if (code === 'KV_UNAVAILABLE') return NextResponse.json({ error: 'Onboarding store unavailable.', code }, { status: 503 });
    return NextResponse.json({ error: 'Unable to create claim bundle.', code: 'CREATE_FAILED' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const payload: Record<string, unknown> = {
    section: params.get('section') || 'soul',
    source_slug: params.get('source_slug') || params.get('sourceSlug'),
    author_handle: params.get('author_handle') || params.get('handle')
  };
  return execute(request, payload);
}

export async function POST(request: NextRequest) {
  const payload = await parseBody(request);
  payload.author_handle = pickString(payload, 'author_handle') || pickString(payload, 'handle');
  return execute(request, payload);
}
