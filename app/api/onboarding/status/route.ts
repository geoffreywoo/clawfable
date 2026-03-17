import { NextRequest, NextResponse } from 'next/server';
import { getKvClient, kvGet } from '@/lib/content';

type ClaimRecord = {
  artifact_key: string;
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

export async function GET(request: NextRequest) {
  const artifactKey = new URL(request.url).searchParams.get('artifact_key')?.trim() || '';
  if (!artifactKey) {
    return NextResponse.json({ error: 'artifact_key query param required.' }, { status: 400 });
  }

  const kv = await getKvClient();
  if (!kv) {
    return NextResponse.json({ error: 'Onboarding store unavailable.', code: 'KV_UNAVAILABLE' }, { status: 503 });
  }

  const record = await kvGet<ClaimRecord | null>(kv, key(artifactKey));
  if (!record) {
    return NextResponse.json({ error: 'Claim record not found.', code: 'NOT_FOUND' }, { status: 404 });
  }

  const expired = new Date(record.expires_at).getTime() < Date.now();
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
