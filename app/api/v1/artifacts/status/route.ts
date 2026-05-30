import { NextRequest, NextResponse } from 'next/server';
import { getClaimRecord, isExpired, sanitize } from '@/lib/onboarding';

export async function GET(request: NextRequest) {
  const artifactKey = sanitize(new URL(request.url).searchParams.get('artifact_key'));
  if (!artifactKey) {
    return NextResponse.json({ error: 'artifact_key is required.' }, { status: 400 });
  }

  let record;
  try {
    ({ record } = await getClaimRecord(artifactKey));
  } catch {
    return NextResponse.json({ error: 'Onboarding store unavailable.', code: 'KV_UNAVAILABLE' }, { status: 503 });
  }

  if (!record) {
    return NextResponse.json({ ok: false, status: 'not_found', artifact_key: artifactKey }, { status: 404 });
  }

  const status = isExpired(record) && record.status !== 'active' ? 'expired' : record.status;

  return NextResponse.json({
    ok: true,
    api_version: 'v1',
    artifact_key: record.artifact_key,
    status,
    source_slug: record.source_slug,
    author_handle: record.author_handle,
    proof_url: record.proof_url,
    expires_at: record.expires_at
  });
}
