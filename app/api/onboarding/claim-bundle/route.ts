import { NextRequest, NextResponse } from 'next/server';
import { createClaimBundle, sanitize, validateOnboardingInput } from '@/lib/onboarding';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const section = sanitize(body.section) || 'soul';
  const sourceSlug = sanitize(body.source_slug || body.sourceSlug);
  const authorHandle = sanitize(body.author_handle || body.authorHandle);
  const requestIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const validation = validateOnboardingInput(sourceSlug, authorHandle);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, code: validation.code, hint: validation.hint },
      { status: 400 }
    );
  }

  try {
    const record = await createClaimBundle({
      section,
      sourceSlug,
      authorHandle,
      requestIp,
      origin: request.nextUrl.origin
    });

    return NextResponse.json({
      artifact_key: record.artifact_key,
      claim_url: record.claim_url,
      claim_token: record.claim_token,
      verification_phrase: record.verification_phrase,
      status: record.status,
      source_slug: record.source_slug,
      section: record.section,
      expires_at: record.expires_at
    });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN';
    if (code === 'RATE_LIMITED') {
      return NextResponse.json(
        { error: 'Too many onboarding requests. Please retry shortly.', code: 'RATE_LIMITED' },
        { status: 429 }
      );
    }
    if (code === 'KV_UNAVAILABLE') {
      return NextResponse.json({ error: 'Onboarding store unavailable.', code: 'KV_UNAVAILABLE' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Unable to create claim bundle.', code: 'CREATE_FAILED' }, { status: 500 });
  }
}
