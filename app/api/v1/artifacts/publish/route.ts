import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { forkArtifact, resolveAgentForUpload } from '@/lib/content';
import { claimKey, getClaimRecord, isExpired, sanitize } from '@/lib/onboarding';

function extractValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (value === undefined || value === null) return '';
  return String(value);
}

async function parsePayload(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await request.json()) as Record<string, unknown>;
  }
  const form = await request.formData();
  const data: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    data[key] = typeof value === 'string' ? value : String(value);
  }
  return data;
}

function extractApiKey(request: NextRequest, payload: Record<string, unknown>) {
  const headerValue = request.headers.get('authorization') || request.headers.get('x-agent-api-key') || '';
  const authMatch = headerValue.toLowerCase().startsWith('bearer ')
    ? headerValue.slice(7).trim()
    : headerValue.trim();
  return authMatch || extractValue(payload, 'agent_api_key');
}

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
  const actor = await resolveAgentForUpload(claim.author_handle, { apiKey });

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
  const payload = await parsePayload(request);
  return execute(request, payload);
}
