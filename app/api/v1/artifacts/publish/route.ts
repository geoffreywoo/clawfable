import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { forkArtifact, resolveAgentForUpload } from '@/lib/content';
import { claimKey, getClaimRecord, isExpired, sanitize } from '@/lib/onboarding';
import { extractApiKey, parseBody } from '@/lib/http';

async function execute(request: NextRequest, payload: Record<string, unknown>) {
  const artifactKey = sanitize(payload.artifact_key);
  const title = sanitize(payload.title);
  const content = sanitize(payload.content);
  const description = sanitize(payload.description);

  if (!artifactKey || !title || !content) {
    return NextResponse.json({ error: 'artifact_key, title, and content are required.', code: 'MISSING_REQUIRED_FIELDS' }, { status: 400 });
  }

  let kv;
  let claim;
  try {
    ({ kv, record: claim } = await getClaimRecord(artifactKey));
  } catch {
    return NextResponse.json({ error: 'Onboarding store unavailable.', code: 'KV_UNAVAILABLE' }, { status: 503 });
  }

  if (!claim) return NextResponse.json({ error: 'Claim record not found.', code: 'NOT_FOUND' }, { status: 404 });
  if (claim.status !== 'claimed') return NextResponse.json({ error: 'Artifact must be claimed before publish.', code: 'NOT_CLAIMED' }, { status: 400 });
  if (isExpired(claim)) {
    claim.status = 'expired';
    claim.updated_at = new Date().toISOString();
    await kv.set(claimKey(artifactKey), claim);
    return NextResponse.json({ error: 'Claim token expired.', code: 'CLAIM_EXPIRED' }, { status: 410 });
  }

  const apiKey = extractApiKey(request, payload);
  let actor;
  try {
    actor = await resolveAgentForUpload(claim.author_handle, { apiKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized upload actor';
    return NextResponse.json({ error: message, code: 'UNAUTHORIZED_ACTOR' }, { status: 401 });
  }

  const doc = await forkArtifact({
    section: claim.section as 'soul',
    sourceSection: claim.section as 'soul',
    sourceSlug: claim.source_slug,
    slug: sanitize(payload.slug) || undefined,
    title,
    description: description || undefined,
    content,
    copy_paste_scope:
      typeof payload.copy_paste_scope === 'object' && payload.copy_paste_scope !== null
        ? (payload.copy_paste_scope as Record<string, boolean>)
        : { soul: true },
    author_commentary: sanitize(payload.author_commentary) || undefined,
    revision: {
      status: sanitize(payload.status) || 'review',
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
  await kv.set(claimKey(artifactKey), claim);

  revalidatePath(`/section/${doc.section}`);
  revalidatePath(`/${doc.section}/${doc.slug}`);
  revalidatePath('/lineage');

  return NextResponse.json({
    ok: true,
    api_version: 'v1',
    artifact_key: artifactKey,
    status: 'active',
    section: doc.section,
    slug: doc.slug,
    lineage: { kind: 'fork', source: claim.source_slug }
  });
}

export async function POST(request: NextRequest) {
  const payload = await parseBody(request);
  return execute(request, payload);
}
