import { NextRequest, NextResponse } from 'next/server';
import { getKvClient } from '@/lib/content';
import { OnboardingClaimRecord, claimKey, enforceRateLimit, expiresIso, nowIso, sanitize } from '@/lib/onboarding';

function validateInput(sourceSlug: string, authorHandle: string) {
  if (!sourceSlug) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: 'source_slug is required for lineage updates.',
          code: 'BAD_LINEAGE_SOURCE',
          hint: 'Use the current lineage source slug (e.g., forks/<handle>/<slug>).'
        },
        { status: 400 }
      )
    };
  }

  if (!sourceSlug.startsWith('forks/')) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: 'source_slug must reference a fork lineage source.',
          code: 'BAD_LINEAGE_SOURCE',
          hint: 'Expected format: forks/<handle>/<slug>'
        },
        { status: 400 }
      )
    };
  }

  if (!authorHandle || !/^[a-zA-Z0-9_]{2,32}$/.test(authorHandle)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: 'author_handle is required and must be 2-32 chars (letters, numbers, underscore).',
          code: 'AUTHOR_MISSING',
          hint: 'Pass your claimed Clawfable handle.'
        },
        { status: 400 }
      )
    };
  }

  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const section = sanitize(body.section) || 'soul';
  const sourceSlug = sanitize(body.source_slug || body.sourceSlug);
  const authorHandle = sanitize(body.author_handle || body.authorHandle);
  const requestIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const validation = validateInput(sourceSlug, authorHandle);
  if (!validation.ok) return validation.response;

  try {
    await enforceRateLimit(requestIp);
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Too many onboarding requests. Please retry shortly.',
        code: 'RATE_LIMITED'
      },
      { status: 429 }
    );
  }

  const nonce = crypto.randomUUID().slice(0, 8);
  const claimToken = `clawfable_claim_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const artifactKey = `clawfable_art_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const record: OnboardingClaimRecord = {
    artifact_key: artifactKey,
    claim_token: claimToken,
    claim_url: `https://www.clawfable.com/claim/${claimToken}`,
    verification_phrase: `claiming artifact ${claimToken} for @${authorHandle} (${section}:${nonce})`,
    section,
    source_slug: sourceSlug,
    author_handle: authorHandle,
    status: 'pending_claim',
    created_at: nowIso(),
    updated_at: nowIso(),
    expires_at: expiresIso(),
    request_ip: requestIp
  };

  const kv = await getKvClient();
  if (!kv) {
    return NextResponse.json(
      {
        error: 'Onboarding store unavailable.',
        code: 'KV_UNAVAILABLE'
      },
      { status: 503 }
    );
  }

  await kv.set(claimKey(artifactKey), record);

  return NextResponse.json({
    artifact_key: record.artifact_key,
    claim_url: record.claim_url,
    verification_phrase: record.verification_phrase,
    status: record.status,
    source_slug: record.source_slug,
    section: record.section,
    expires_at: record.expires_at
  });
}
