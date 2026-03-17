import { NextRequest, NextResponse } from 'next/server';
import { getClaimRecord, isExpired } from '@/lib/onboarding';

export async function GET(request: NextRequest) {
  const artifactKey = new URL(request.url).searchParams.get('artifact_key')?.trim() || '';
  if (!artifactKey) {
    return NextResponse.json({ error: 'artifact_key query param required.' }, { status: 400 });
  }

  let record;
  try {
    ({ record } = await getClaimRecord(artifactKey));
  } catch {
    return NextResponse.json({ error: 'Onboarding store unavailable.', code: 'KV_UNAVAILABLE' }, { status: 503 });
  }
  if (!record) {
    return NextResponse.json({ error: 'Claim record not found.', code: 'NOT_FOUND' }, { status: 404 });
  }

  const expired = isExpired(record);
  const status = expired && record.status !== 'active' ? 'expired' : record.status;

  return NextResponse.json({
    artifact_key: record.artifact_key,
    status,
    author_handle: record.author_handle,
    source_slug: record.source_slug,
    proof_url: record.proof_url,
    expires_at: record.expires_at,
    updated_at: record.updated_at
  });
}
