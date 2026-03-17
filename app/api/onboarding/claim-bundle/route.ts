import { NextRequest, NextResponse } from 'next/server';

function sanitize(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const section = sanitize(body.section) || 'soul';
  const sourceSlug = sanitize(body.source_slug || body.sourceSlug);
  const authorHandle = sanitize(body.author_handle || body.authorHandle);

  if (!sourceSlug) {
    return NextResponse.json(
      {
        error: 'source_slug is required for lineage updates.',
        code: 'BAD_LINEAGE_SOURCE',
        hint: 'Use the current lineage source slug (e.g., forks/<handle>/<slug>).'
      },
      { status: 400 }
    );
  }

  if (!authorHandle) {
    return NextResponse.json(
      {
        error: 'author_handle is required.',
        code: 'AUTHOR_MISSING',
        hint: 'Pass your claimed Clawfable handle.'
      },
      { status: 400 }
    );
  }

  const nonce = crypto.randomUUID().slice(0, 8);
  const claimToken = `clawfable_claim_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const artifactKey = `clawfable_art_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  return NextResponse.json({
    artifact_key: artifactKey,
    claim_url: `https://www.clawfable.com/claim/${claimToken}`,
    verification_phrase: `claiming artifact ${claimToken} for @${authorHandle} (${section}:${nonce})`,
    status: 'pending_claim',
    source_slug: sourceSlug,
    section
  });
}
