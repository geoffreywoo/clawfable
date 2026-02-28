import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@vercel/kv';

type TargetSection = 'soul' | 'memory';

type ApiResult = {
  section: TargetSection;
  artifactsDeleted: number;
  indexDeleted: boolean;
};

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

function normalizeTargetSections(raw: unknown): TargetSection[] {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw.map(String) : String(raw).split(',');
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))]
    .filter((value) => value === 'soul' || value === 'memory')
    .map((value) => value as TargetSection);
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

async function getAdminClient() {
  const url = pickEnvValue('KV_REST_API_URL', 'CLAWFABLE_DATABASE_URL', 'CLAWFABLE_KV_URL', 'KV_URL', 'REDIS_URL');
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

function collectTargetSections(request: NextRequest, body: Record<string, unknown>) {
  const bodyTarget = normalizeTargetSections(body.sections);
  const queryTarget = normalizeTargetSections(request.nextUrl.searchParams.get('sections'));
  const querySection = normalizeTargetSections(request.nextUrl.searchParams.get('section'));

  const sections = bodyTarget.length ? bodyTarget : queryTarget.length ? queryTarget : querySection;
  return sections.length ? sections : (['soul', 'memory'] as TargetSection[]);
}

async function clearSection(kv: Record<string, unknown>, section: TargetSection) {
  const indexKey = `clawfable:db:index:${section}`;
  const artifactPrefix = `clawfable:db:artifact:${section}:`;

  const rawIndex = await (kv as any).get<unknown>(indexKey);
  const slugs = Array.isArray(rawIndex) ? rawIndex.filter((value: unknown) => typeof value === 'string') : [];
  const keysFromIndex = slugs.map((slug) => `${artifactPrefix}${slug}`);
  const scanned = await (kv as any).keys(`${artifactPrefix}*`);
  const allKeys = [...new Set([...(Array.isArray(scanned) ? scanned : []), ...keysFromIndex])];

  const removedArtifacts = allKeys.length
    ? (await Promise.all(allKeys.map((key) => ((kv as any).del ? (kv as any).del(key) : (kv as any).delete(key)))).filter(Boolean).length)
    : 0;
  const indexDeleted = Boolean((kv as any).del ? (kv as any).del(indexKey) : (kv as any).delete(indexKey));

  return {
    section,
    artifactsDeleted: removedArtifacts,
    indexDeleted
  } as ApiResult;
}

export async function POST(request: NextRequest) {
  const body = await parsePayload(request);

  const providedToken =
    request.headers.get('x-admin-token') ||
    request.headers.get('x-clear-token') ||
    String(body.admin_token || '').trim() ||
    String(body.adminToken || '').trim();

  const expectedToken = pickEnvValue('CLAWFABLE_ADMIN_TOKEN', 'KV_REST_API_TOKEN', 'CLAWFABLE_DATABASE_TOKEN');
  if (!providedToken || !expectedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized. Missing or invalid admin token.' }, { status: 401 });
  }

  const sections = collectTargetSections(request, body);
  const kv = await getAdminClient();
  if (!kv) {
    return NextResponse.json({ error: 'Admin cache client unavailable.' }, { status: 400 });
  }

  const results = await Promise.all(sections.map((section) => clearSection(kv, section)));

  revalidatePath('/section/soul');
  revalidatePath('/section/memory');
  return NextResponse.json({ ok: true, cleared: results });
}

export async function GET() {
  return NextResponse.json({ message: 'POST to clear sections: soul,memory with x-admin-token header.' });
}
