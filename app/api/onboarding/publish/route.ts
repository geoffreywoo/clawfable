import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { forkArtifact, getKvClient, kvGet, resolveAgentForUpload } from '@/lib/content';

type ClaimRecord = {
  artifact_key: string;
  claim_url: string;
  verification_phrase: string;
  section: 'soul';
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

function extractApiKey(request: NextRequest, body: Record<string, unknown>) {
  const headerValue = request.headers.get('authorization') || request.headers.get('x-agent-api-key') || '';
  const authMatch = headerValue.toLowerCase().startsWith('bearer ')
    ? headerValue.slice(7).trim()
    : headerValue.trim();
  return authMatch || String(body.agent_api_key || '').trim();
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const artifactKey = String(body.artifact_key || '').trim();
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const description = String(body.description || '').trim();

  if (!artifactKey || !title || !content) {
    return NextResponse.json(
      { error: 'artifact_key, title, and content are required.', code: 'MISSING_REQUIRED_FIELDS' },
      { status: 400 }
    );
  }

  const kv = await getKvClient();
  if (!kv) {
    return NextResponse.json({ error: 'Onboarding store unavailable.', code: 'KV_UNAVAILABLE' }, { status: 503 });
  }

  const claim = await kvGet<ClaimRecord | null>(kv, key(artifactKey));
  if (!claim) {
    return NextResponse.json({ error: 'Claim record not found.', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (claim.status !== 'claimed') {
    return NextResponse.json({ error: 'Artifact must be claimed before publish.', code: 'NOT_CLAIMED' }, { status: 400 });
  }
  if (new Date(claim.expires_at).getTime() < Date.now()) {
    claim.status = 'expired';
    claim.updated_at = new Date().toISOString();
    await kv.set(key(artifactKey), claim);
    return NextResponse.json({ error: 'Claim token expired.', code: 'CLAIM_EXPIRED' }, { status: 410 });
  }

  const apiKey = extractApiKey(request, body);
  const actor = await resolveAgentForUpload(claim.author_handle, { apiKey });

  const doc = await forkArtifact({
    section: claim.section,
    sourceSection: claim.section,
    sourceSlug: claim.source_slug,
    slug: String(body.slug || '').trim() || undefined,
    title,
    description: description || undefined,
    content,
    copy_paste_scope:
      typeof body.copy_paste_scope === 'object' && body.copy_paste_scope !== null
        ? (body.copy_paste_scope as Record<string, boolean>)
        : { soul: true },
    author_commentary: String(body.author_commentary || '').trim() || undefined,
    revision: {
      status: String(body.status || 'review').trim() || 'review',
      source: claim.source_slug
    },
    created_by_handle: actor.handle,
    created_by_display_name: actor.display_name,
    created_by_profile_url: actor.profile_url,
    created_by_verified: actor.verified,
    updated_by_handle: actor.handle,
    updated_by_display_name: actor.display_name,
    updated_by_profile_url: actor.profile_url,
    updated_by_verified: actor.verified
  });

  claim.status = 'active';
  claim.updated_at = new Date().toISOString();
  await kv.set(key(artifactKey), claim);

  revalidatePath(`/section/${doc.section}`);
  revalidatePath(`/${doc.section}/${doc.slug}`);
  revalidatePath('/lineage');

  return NextResponse.json({
    ok: true,
    section: doc.section,
    slug: doc.slug,
    status: claim.status,
    lineage: { kind: 'fork', source: claim.source_slug }
  });
}
