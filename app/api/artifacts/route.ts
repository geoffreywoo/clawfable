import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  artifactPayloadFromRequest,
  createArtifact,
  forkArtifact,
  isCoreSection,
  listBySection,
  reviseArtifact
} from '@/lib/content';

type ArtifactMode = 'create' | 'revise' | 'fork';

function isMode(value: string | undefined): value is ArtifactMode {
  return value === 'create' || value === 'revise' || value === 'fork';
}

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

function responseWithArtifact(section: string, slug: string, request: NextRequest) {
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) {
    const url = new URL(`/${section}/${slug}`, request.url);
    return NextResponse.redirect(url, 303);
  }

  return NextResponse.json({ ok: true, section, slug });
}

export async function GET(request: NextRequest) {
  const section = new URL(request.url).searchParams.get('section') || 'soul';
  if (!isCoreSection(section)) {
    return NextResponse.json({ error: 'Unsupported section.' }, { status: 400 });
  }

  const items = await listBySection(section);
  return NextResponse.json({ section, items });
}

export async function POST(request: NextRequest) {
  const body = await parsePayload(request);
  const mode = extractValue(body, 'mode');
  if (!isMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode. Use create, revise, or fork.' }, { status: 400 });
  }

  try {
    const payload = await artifactPayloadFromRequest(body);
    if (!isCoreSection(payload.section)) {
      return NextResponse.json({ error: 'Unsupported section.' }, { status: 400 });
    }

    if (mode === 'create') {
      const doc = await createArtifact({
        section: payload.section,
        slug: payload.slug,
        title: payload.title,
        description: payload.description,
        content: payload.content,
        copy_paste_scope: payload.copy_paste_scope,
        revision: {
          kind: extractValue(body, 'kind') || 'core',
          id: extractValue(body, 'revision_id') || payload.revision?.id,
          status: extractValue(body, 'status') || 'review',
          family: payload.revision?.family
        },
        sourcePath: payload.sourcePath
      });
      revalidatePath(`/section/${payload.section}`);
      return responseWithArtifact(doc.section, doc.slug, request);
    }

    if (mode === 'revise') {
      const doc = await reviseArtifact({
        section: payload.section,
        slug: payload.slug,
        title: payload.title,
        description: payload.description,
        content: payload.content,
        copy_paste_scope: payload.copy_paste_scope,
        revision: {
          id: extractValue(body, 'revision_id') || payload.revision?.id,
          kind: extractValue(body, 'kind') || 'revision',
          status: extractValue(body, 'status') || 'review',
          family: payload.revision?.family,
          parent_revision: extractValue(body, 'parent_revision') || payload.revision?.parent_revision
        },
        sourcePath: payload.sourcePath
      });
      revalidatePath(`/section/${payload.section}`);
      revalidatePath(`/${payload.section}/${payload.slug}`);
      return responseWithArtifact(doc.section, doc.slug, request);
    }

    const sourceSlug = extractValue(body, 'sourceSlug');
    if (!sourceSlug) {
      return NextResponse.json({ error: 'sourceSlug is required for fork mode.' }, { status: 400 });
    }

    const agentHandle = extractValue(body, 'agentHandle').trim() || 'agent';
    const normalizedSlug = payload.slug.startsWith(`forks/${agentHandle}/`)
      ? payload.slug
      : `forks/${agentHandle}/${payload.slug}`;

    const doc = await forkArtifact({
      section: payload.section,
      sourceSection: payload.section,
      sourceSlug,
      slug: normalizedSlug,
      title: payload.title,
      description: payload.description,
      content: payload.content,
      copy_paste_scope: payload.copy_paste_scope,
      revision: {
        id: extractValue(body, 'revision_id') || payload.revision?.id,
        status: extractValue(body, 'status') || 'review',
        family: payload.revision?.family,
        source: sourceSlug,
        parent_revision: extractValue(body, 'parent_revision') || payload.revision?.parent_revision
      },
      sourcePath: payload.sourcePath
    });

    revalidatePath(`/section/${doc.section}`);
    revalidatePath(`/${doc.section}/${doc.slug}`);
    return responseWithArtifact(doc.section, doc.slug, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
