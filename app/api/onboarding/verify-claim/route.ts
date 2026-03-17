import { NextRequest, NextResponse } from 'next/server';
import { getKvClient, kvGet } from '@/lib/content';

type ClaimRecord = {
  artifact_key: string;
  claim_token: string;
  claim_url: string;
  verification_phrase: string;
  section: string;
  source_slug: string;
  author_handle: string;
  status: 'pending_claim' | 'claimed' | 'active' | 'expired';
  created_at: string;
  updated_at: string;
  expires_at: string;
  proof_url?: string;
};

function key(artifactKey: string) {
  return `clawfable:db:onboarding:claim:${artifactKey}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const artifactKey = String(body.artifact_key || '').trim();
  const proofUrl = String(body.proof_url || '').trim();
  const proofHandle = String(body.proof_handle || '').trim().replace(/^@/, '');

  if (!artifactKey) {
    return NextResponse.json({ error: 'artifact_key is required.', code: 'NO_ARTIFACT_KEY' }, { status: 400 });
  }
  if (!proofUrl) {
    return NextResponse.json({ error: 'proof_url is required.', code: 'NO_CLAIM_PROOF' }, { status: 400 });
  }

  const kv = await getKvClient();
  if (!kv) {
    return NextResponse.json({ error: 'Onboarding store unavailable.', code: 'KV_UNAVAILABLE' }, { status: 503 });
  }

  const record = await kvGet<ClaimRecord | null>(kv, key(artifactKey));
  if (!record) {
    return NextResponse.json({ error: 'Claim record not found.', code: 'NOT_FOUND' }, { status: 404 });
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    record.status = 'expired';
    record.updated_at = new Date().toISOString();
    await kv.set(key(artifactKey), record);
    return NextResponse.json({ error: 'Claim token expired.', code: 'CLAIM_EXPIRED' }, { status: 410 });
  }

  if (proofHandle && proofHandle.toLowerCase() !== record.author_handle.toLowerCase()) {
    return NextResponse.json({ error: 'Proof handle does not match author_handle.', code: 'AUTHOR_MISMATCH' }, { status: 400 });
  }

  record.status = 'claimed';
  record.proof_url = proofUrl;
  record.updated_at = new Date().toISOString();
  await kv.set(key(artifactKey), record);

  return NextResponse.json({
    artifact_key: artifactKey,
    status: record.status,
    proof_url: record.proof_url,
    author_handle: record.author_handle
  });
}
