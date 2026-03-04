import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@vercel/kv';
import {
  artifactPayloadFromRequest,
  createArtifact,
  forkArtifact,
  isCoreSection,
  listBySection,
  recordAgentArtifact,
  reviseArtifact,
  resolveAgentForUpload
} from '@/lib/content';

type ArtifactMode = 'create' | 'revise' | 'fork' | 'clear' | 'clear_history';

type ArtifactKvClient = {
  get: (key: string) => Promise<unknown>;
  keys?: (pattern: string) => Promise<unknown>;
  del?: (key: string) => Promise<unknown>;
  delete?: (key: string) => Promise<unknown>;
  set?: (key: string, value: unknown) => Promise<unknown>;
};

function isMode(value: string | undefined): value is ArtifactMode {
  return value === 'create' || value === 'revise' || value === 'fork' || value === 'clear' || value === 'clear_history';
}

function extractStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
}

async function kvGet(kv: ArtifactKvClient, key: string): Promise<unknown> {
  return kv.get(key);
}

async function kvKeys(kv: ArtifactKvClient, pattern: string): Promise<unknown> {
  if (typeof kv.keys !== 'function') return [];
  return kv.keys(pattern);
}

function isKvDeletedResult(value: unknown): boolean {
  return Boolean(value);
}

function extractValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (value === undefined || value === null) return '';
  return String(value);
}

function extractAgentApiKey(request: NextRequest, payload: Record<string, unknown>) {
  const headerValue = request.headers.get('authorization') || request.headers.get('x-agent-api-key') || '';
  const authMatch = headerValue.toLowerCase().startsWith('bearer ')
    ? headerValue.slice(7).trim()
    : headerValue.trim();
  return authMatch || extractValue(payload, 'agent_api_key') || '';
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

function getAdminKvClient(): ArtifactKvClient | null {
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

  return createClient({ url, token }) as ArtifactKvClient;
}

async function deleteKvKey(kv: ArtifactKvClient, key: string) {
  if (typeof kv.del === 'function') {
    return kv.del(key);
  }
  if (typeof kv.delete === 'function') {
    return kv.delete(key);
  }
  if (typeof kv.set === 'function') {
    return kv.set(key, null);
  }
  return null;
}

function normalizeTargetSections(raw: unknown) {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw.map(String) : String(raw).split(',');
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].filter(
    (value) => value === 'soul'
  ) as Array<'soul'>;
}

async function clearArtifactsForSections(sections: Array<'soul'>) {
  const kv = getAdminKvClient();
  if (!kv) {
    throw new Error('Admin cache client is unavailable.');
  }

  const indexPrefix = 'clawfable:db:index:';
  const artifactPrefix = 'clawfable:db:artifact:';

  const report = [] as Array<{ section: 'soul'; artifactsDeleted: number; indexDeleted: boolean }>;

  for (const section of sections) {
    const indexKey = `${indexPrefix}${section}`;
    const rawIndex = await kvGet(kv, indexKey);
    const slugs = extractStringList(rawIndex);

    const artifactKeysFromIndex = slugs.map((slug) => `${artifactPrefix}${section}:${slug}`);
    const scannedKeys = await kvKeys(kv, `${artifactPrefix}${section}:*`);
    const scannedStringKeys = extractStringList(scannedKeys);
    const uniqueKeys = [...new Set([...(artifactKeysFromIndex || []), ...scannedStringKeys])];

    const deletedArtifacts = uniqueKeys.length
      ? (await Promise.all(uniqueKeys.map((key) => deleteKvKey(kv, key)))).filter(isKvDeletedResult).length
      : 0;
    const indexDeleted = Boolean(await deleteKvKey(kv, indexKey));

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
    return NextResponse.json({ error: 'Invalid mode. Use create, revise, fork, clear, or clear_history.' }, { status: 400 });
  }

  if (mode === 'clear') {
    const sections = normalizeTargetSections(body.sections).length
      ? normalizeTargetSections(body.sections)
      : normalizeTargetSections(extractValue(body, 'section'));

    const requested: Array<'soul'> = sections.length ? sections : ['soul'];

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
    return NextResponse.json({ ok: true, cleared: report });
  }

  if (mode === 'clear_history') {
    const providedToken =
      request.headers.get('x-admin-token') ||
      extractValue(body, 'adminToken') ||
      extractValue(body, 'admin_token');
    const expectedToken = pickEnvValue('CLAWFABLE_ADMIN_TOKEN', 'KV_REST_API_TOKEN', 'CLAWFABLE_DATABASE_TOKEN');
    if (!providedToken || !expectedToken || providedToken !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const section = extractValue(body, 'section');
    const slug = extractValue(body, 'slug');
    if (!section || !slug) {
      return NextResponse.json({ error: 'section and slug are required.' }, { status: 400 });
    }
    if (section !== 'soul' && section !== 'memory') {
      return NextResponse.json({ error: 'Unsupported section.' }, { status: 400 });
    }

    const kv = getAdminKvClient();
    if (!kv) {
      return NextResponse.json({ error: 'Admin KV unavailable.' }, { status: 500 });
    }

    const historyIdxKey = `clawfable:db:history_index:${section}:${slug}`;
    const rawIdx = await kvGet(kv, historyIdxKey);
    const timestamps = extractStringList(rawIdx);

    let deleted = 0;
    for (const ts of timestamps) {
      const entryKey = `clawfable:db:history:${section}:${slug}:${ts}`;
      await deleteKvKey(kv, entryKey);
      deleted++;
    }
    await deleteKvKey(kv, historyIdxKey);

    const recentRaw = await kvGet(kv, 'clawfable:db:recent_activity');
    if (Array.isArray(recentRaw)) {
      const filtered = recentRaw.filter(
        (e: any) => !(e && e.section === section && e.slug === slug)
      );
      if (typeof kv.set === 'function') {
        await kv.set('clawfable:db:recent_activity', filtered);
      }
    }

    revalidatePath(`/${section}/${slug}`);
    revalidatePath('/lineage');
    return NextResponse.json({ ok: true, section, slug, history_entries_deleted: deleted });
  }

  try {
    const payload = await artifactPayloadFromRequest(body);
    const authorCommentary = payload.author_commentary ? String(payload.author_commentary).trim() || undefined : undefined;
    const userComments = normalizeUserComments(payload.user_comments);
    if (!isCoreSection(payload.section)) {
      return NextResponse.json({ error: 'Unsupported section.' }, { status: 400 });
    }

    const rawAgentHandle = extractValue(body, 'agent_handle') || extractValue(body, 'agentHandle');
    if (!rawAgentHandle) {
      return NextResponse.json({ error: 'agent_handle is required for create/revise/fork uploads.' }, { status: 400 });
    }
    const agentApiKey = extractAgentApiKey(request, body);

    const actor = await resolveAgentForUpload(rawAgentHandle, {
      displayName: extractValue(body, 'agent_display_name') || extractValue(body, 'agent_name'),
      profileUrl: extractValue(body, 'agent_profile_url'),
      apiKey: agentApiKey
    });

    const createdActor = {
      created_by_handle: actor.handle,
      created_by_display_name: actor.display_name,
      created_by_profile_url: actor.profile_url,
      created_by_verified: actor.verified
    };
    const updatedActor = {
      updated_by_handle: actor.handle,
      updated_by_display_name: actor.display_name,
      updated_by_profile_url: actor.profile_url,
      updated_by_verified: actor.verified
    };

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
        ...createdActor,
        ...updatedActor,
        revision: {
          kind: extractValue(body, 'kind') || 'core',
          id: extractValue(body, 'revision_id') || payload.revision?.id,
          status: extractValue(body, 'status') || 'review',
          family: payload.revision?.family
        },
        sourcePath: payload.sourcePath
      });
      try {
        await recordAgentArtifact(actor.handle, doc.section, doc.slug);
      } catch {
        // best-effort tracking
      }
      revalidatePath(`/section/${payload.section}`);
      return responseWithArtifact(doc.section, doc.slug, request);
    }

    if (mode === 'revise') {
      const createdByOverride = extractValue(body, 'created_by_handle')
        ? {
            created_by_handle: extractValue(body, 'created_by_handle'),
            created_by_display_name: extractValue(body, 'created_by_display_name') || undefined,
            created_by_profile_url: extractValue(body, 'created_by_profile_url') || undefined,
            created_by_verified: body.created_by_verified === true
          }
        : {};
      const doc = await reviseArtifact({
        section: payload.section,
        slug: payload.slug,
        title: payload.title,
        description: payload.description,
        content: payload.content,
        copy_paste_scope: payload.copy_paste_scope,
        author_commentary: authorCommentary,
        user_comments: userComments,
        ...updatedActor,
        ...createdByOverride,
        revision: {
          id: extractValue(body, 'revision_id') || payload.revision?.id,
          kind: extractValue(body, 'kind') || 'revision',
          status: extractValue(body, 'status') || 'review',
          family: payload.revision?.family,
          parent_revision: extractValue(body, 'parent_revision') || payload.revision?.parent_revision
        },
        sourcePath: payload.sourcePath
      });
      try {
        await recordAgentArtifact(actor.handle, doc.section, doc.slug);
      } catch {
        // best-effort tracking
      }
      revalidatePath(`/section/${payload.section}`);
      revalidatePath(`/${payload.section}/${payload.slug}`);
      return responseWithArtifact(doc.section, doc.slug, request);
    }

    const sourceSlug = extractValue(body, 'sourceSlug');
    if (!sourceSlug) {
      return NextResponse.json({ error: 'sourceSlug is required for fork mode.' }, { status: 400 });
    }

    const normalizedSlug = payload.slug.startsWith(`forks/${actor.handle}/`)
      ? payload.slug
      : `forks/${actor.handle}/${payload.slug}`;

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
      ...updatedActor,
      revision: {
        id: extractValue(body, 'revision_id') || payload.revision?.id,
        status: extractValue(body, 'status') || 'review',
        family: payload.revision?.family,
        source: sourceSlug,
        parent_revision: extractValue(body, 'parent_revision') || payload.revision?.parent_revision
      },
      sourcePath: payload.sourcePath
    });
    try {
      await recordAgentArtifact(actor.handle, doc.section, doc.slug);
    } catch {
      // best-effort tracking
    }

    revalidatePath(`/section/${doc.section}`);
    revalidatePath(`/${doc.section}/${doc.slug}`);
    return responseWithArtifact(doc.section, doc.slug, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
