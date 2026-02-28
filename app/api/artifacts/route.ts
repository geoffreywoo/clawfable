import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@vercel/kv';
import {
  artifactPayloadFromRequest,
  createArtifact,
  forkArtifact,
  isCoreSection,
  listBySection,
  reviseArtifact
} from '@/lib/content';

type ArtifactMode = 'create' | 'revise' | 'fork' | 'clear';

function isMode(value: string | undefined): value is ArtifactMode {
  return value === 'create' || value === 'revise' || value === 'fork' || value === 'clear';
}

function extractValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (value === undefined || value === null) return '';
  return String(value);
}

function readEnv(name: string) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim() || undefined;
  }
  return trimmed;
}

function pickEnvValue(...names: string[]) {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return undefined;
}

function getAdminKvClient() {
  const url = pickEnvValue(
    'KV_REST_API_URL',
    'CLAWFABLE_DATABASE_URL',
    'CLAWFABLE_KV_URL',
    'KV_URL',
    'REDIS_URL'
  );
  const token = pickEnvValue(
    'KV_REST_API_TOKEN',
    'CLAWFABLE_DATABASE_TOKEN',
    'CLAWFABLE_KV_TOKEN',
    'KV_TOKEN',
    'KV_REST_API_READ_ONLY_TOKEN'
  );
  if (!url || !token) return null;

  return createClient({ url, token });
}

async function deleteKvKey(kv: Record<string, unknown>, key: string) {
  if (typeof (kv as any).del === 'function') {
    return (kv as any).del(key);
  }
  if (typeof (kv as any).delete === 'function') {
    return (kv as any).delete(key);
  }
  if (typeof (kv as any).set === 'function') {
    return (kv as any).set(key, null);
  }
  return null;
}

function normalizeTargetSections(raw: unknown) {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw.map(String) : String(raw).split(',');
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].filter(
    (value) => value === 'soul' || value === 'memory'
  ) as Array<'soul' | 'memory'>;
}

async function clearArtifactsForSections(sections: Array<'soul' | 'memory'>) {
  const kv = getAdminKvClient();
  if (!kv) {
    throw new Error('Admin cache client is unavailable.');
  }

  const indexPrefix = 'clawfable:db:index:';
  const artifactPrefix = 'clawfable:db:artifact:';

  const report = [] as Array<{ section: 'soul' | 'memory'; artifactsDeleted: number; indexDeleted: boolean }>;

  for (const section of sections) {
    const indexKey = `${indexPrefix}${section}`;
    const rawIndex = await (kv as any).get<unknown>(indexKey);
    const slugs = Array.isArray(rawIndex) ? rawIndex.filter((value: unknown) => typeof value === 'string') : [];

    const artifactKeysFromIndex = slugs.map((slug) => `${artifactPrefix}${section}:${slug}`);
    const scannedKeys = await (kv as any).keys(`${artifactPrefix}${section}:*`);
    const uniqueKeys = [...new Set([...(artifactKeysFromIndex || []), ...(Array.isArray(scannedKeys) ? scannedKeys : [])])];

    const deletedArtifacts = uniqueKeys.length
      ? (await Promise.all(uniqueKeys.map((key) => deleteKvKey(kv as any, key as string)))).filter(Boolean).length
      : 0;
    const indexDeleted = Boolean(await deleteKvKey(kv as any, indexKey));

    report.push({
      section,
      artifactsDeleted: deletedArtifacts,
      indexDeleted
    });
  }

  return report;
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

function normalizeUserComments(raw: unknown) {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string') return raw;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return parsed ? [parsed] : undefined;
  } catch {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
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
    return NextResponse.json({ error: 'Invalid mode. Use create, revise, fork, or clear.' }, { status: 400 });
  }

  if (mode === 'clear') {
    const sections = normalizeTargetSections(body.sections).length
      ? normalizeTargetSections(body.sections)
      : normalizeTargetSections(extractValue(body, 'section'));

    const requested = sections.length ? sections : ['soul', 'memory'];

    const providedToken =
      request.headers.get('x-admin-token') ||
      request.headers.get('x-clearpayload-token') ||
      extractValue(body, 'adminToken') ||
      extractValue(body, 'admin_token');
    const expectedToken = pickEnvValue('CLAWFABLE_ADMIN_TOKEN', 'KV_REST_API_TOKEN', 'CLAWFABLE_DATABASE_TOKEN');

    if (!providedToken || !expectedToken || providedToken !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized. Missing or invalid admin token.' }, { status: 401 });
    }

    const report = await clearArtifactsForSections(requested);
    revalidatePath('/section/soul');
    revalidatePath('/section/memory');
    return NextResponse.json({ ok: true, cleared: report });
  }

  try {
    const payload = await artifactPayloadFromRequest(body);
    const authorCommentary = payload.author_commentary ? String(payload.author_commentary).trim() || undefined : undefined;
    const userComments = normalizeUserComments(payload.user_comments);
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
        author_commentary: authorCommentary,
        user_comments: userComments,
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
        author_commentary: authorCommentary,
        user_comments: userComments,
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
      author_commentary: authorCommentary,
      user_comments: userComments,
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
