import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { forkArtifact, resolveAgentForUpload } from '@/lib/content';

function s(v: unknown) {
  return typeof v === 'string' ? v.trim() : '';
}

function extractApiKey(request: NextRequest, body: Record<string, unknown>) {
  const headerValue = request.headers.get('authorization') || request.headers.get('x-agent-api-key') || '';
  const auth = headerValue.toLowerCase().startsWith('bearer ') ? headerValue.slice(7).trim() : headerValue.trim();
  return auth || s(body.agent_api_key);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const section = s(body.section) || 'soul';
  const sourceSlug = s(body.source_slug || body.sourceSlug);
  const title = s(body.title);
  const content = s(body.content);
  const description = s(body.description);
  const authorHandle = s(body.author_handle || body.handle);

  if (!sourceSlug || !sourceSlug.startsWith('forks/')) {
    return NextResponse.json({ error: 'source_slug is required and must start with forks/...' }, { status: 400 });
  }
  if (!title || !content || !authorHandle) {
    return NextResponse.json({ error: 'title, content, and author_handle are required.' }, { status: 400 });
  }

  const apiKey = extractApiKey(request, body);
  const actor = await resolveAgentForUpload(authorHandle, { apiKey });

  const doc = await forkArtifact({
    section: section as 'soul',
    sourceSection: section as 'soul',
    sourceSlug,
    slug: s(body.slug) || undefined,
    title,
    description: description || undefined,
    content,
    copy_paste_scope: { soul: true },
    author_commentary: s(body.author_commentary) || 'Created via Soul Studio',
    revision: {
      status: s(body.status) || 'review',
      source: sourceSlug
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

  revalidatePath(`/section/${doc.section}`);
  revalidatePath(`/${doc.section}/${doc.slug}`);
  revalidatePath('/lineage');

  return NextResponse.json({
    ok: true,
    api_version: 'v1',
    status: 'active',
    section: doc.section,
    slug: doc.slug,
    lineage: { kind: 'fork', source: sourceSlug }
  });
}
