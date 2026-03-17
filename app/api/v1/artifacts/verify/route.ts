import { NextRequest, NextResponse } from 'next/server';
import { claimKey, getClaimRecord, isExpired, sanitize } from '@/lib/onboarding';
import { parseBody, pickString } from '@/lib/http';

async function execute(artifactKey: string, proofUrl: string, proofHandleRaw: string) {
  const proofHandle = proofHandleRaw.replace(/^@/, '');

  let kv;
  let record;
  try {
    ({ kv, record } = await getClaimRecord(artifactKey));
  } catch {
    return NextResponse.json({ error: 'Onboarding store unavailable.', code: 'KV_UNAVAILABLE' }, { status: 503 });
  }
  if (!record) return NextResponse.json({ error: 'Claim record not found.', code: 'NOT_FOUND' }, { status: 404 });
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
    ok: true,
    api_version: 'v1',
    status: 'claimed',
    artifact_key: artifactKey,
    author_handle: record.author_handle,
    proof_url: record.proof_url
  });
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const artifactKey = sanitize(params.get('artifact_key'));
  const proofUrl = sanitize(params.get('proof_url'));
  const proofHandle = sanitize(params.get('proof_handle'));

  if (!artifactKey) return NextResponse.json({ error: 'artifact_key is required.' }, { status: 400 });
  if (!proofUrl) return NextResponse.json({ error: 'proof_url is required.', code: 'NO_CLAIM_PROOF' }, { status: 400 });

  return execute(artifactKey, proofUrl, proofHandle);
}

export async function POST(request: NextRequest) {
  const payload = await parseBody(request);
  const artifactKey = sanitize(pickString(payload, 'artifact_key'));
  const proofUrl = sanitize(pickString(payload, 'proof_url'));
  const proofHandle = sanitize(pickString(payload, 'proof_handle'));

  if (!artifactKey) return NextResponse.json({ error: 'artifact_key is required.' }, { status: 400 });
  if (!proofUrl) return NextResponse.json({ error: 'proof_url is required.', code: 'NO_CLAIM_PROOF' }, { status: 400 });

  return execute(artifactKey, proofUrl, proofHandle);
}
