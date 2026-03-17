import { NextRequest, NextResponse } from 'next/server';
import { getClaimRecord, claimKey, isExpired, sanitize } from '@/lib/onboarding';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const artifactKey = sanitize(body.artifact_key);
  const proofUrl = sanitize(body.proof_url);
  const proofHandle = sanitize(body.proof_handle).replace(/^@/, '');

  if (!artifactKey) {
    return NextResponse.json({ error: 'artifact_key is required.', code: 'NO_ARTIFACT_KEY' }, { status: 400 });
  }
  if (!proofUrl) {
    return NextResponse.json({ error: 'proof_url is required.', code: 'NO_CLAIM_PROOF' }, { status: 400 });
  }

  let kv;
  let record;
  try {
    ({ kv, record } = await getClaimRecord(artifactKey));
  } catch {
    return NextResponse.json({ error: 'Onboarding store unavailable.', code: 'KV_UNAVAILABLE' }, { status: 503 });
  }
  if (!record) {
    return NextResponse.json({ error: 'Claim record not found.', code: 'NOT_FOUND' }, { status: 404 });
  }

  if (isExpired(record)) {
    record.status = 'expired';
    record.updated_at = new Date().toISOString();
    await kv.set(claimKey(artifactKey), record);
    return NextResponse.json({ error: 'Claim token expired.', code: 'CLAIM_EXPIRED' }, { status: 410 });
  }

  if (proofHandle && proofHandle.toLowerCase() !== record.author_handle.toLowerCase()) {
    return NextResponse.json({ error: 'Proof handle does not match author_handle.', code: 'AUTHOR_MISMATCH' }, { status: 400 });
  }

  record.status = 'claimed';
  record.proof_url = proofUrl;
  record.updated_at = new Date().toISOString();
  await kv.set(claimKey(artifactKey), record);

  return NextResponse.json({
    artifact_key: artifactKey,
    status: record.status,
    proof_url: record.proof_url,
    author_handle: record.author_handle
  });
}
