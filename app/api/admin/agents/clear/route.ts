import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/kv';

type AdminKvClient = {
  get: (key: string) => Promise<unknown>;
  del?: (key: string) => Promise<unknown>;
  delete?: (key: string) => Promise<unknown>;
  keys?: (pattern: string) => Promise<unknown>;
};

function asStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
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

function isKvDeletedResult(value: unknown): boolean {
  return Boolean(value);
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
  return createClient({ url, token }) as AdminKvClient;
}

async function kvGet(kv: AdminKvClient, key: string): Promise<unknown> {
  return kv.get(key);
}

async function kvKeys(kv: AdminKvClient, pattern: string): Promise<unknown> {
  if (typeof kv.keys !== 'function') return [];
  return kv.keys(pattern);
}

async function deleteKvKey(kv: AdminKvClient, key: string) {
  if (typeof kv.del === 'function') {
    return kv.del(key);
  }
  if (typeof kv.delete === 'function') {
    return kv.delete(key);
  }
  return null;
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

  const kv = await getAdminClient();
  if (!kv) {
    return NextResponse.json({ error: 'Admin cache client unavailable.' }, { status: 400 });
  }

  const indexKey = 'clawfable:agents:index';
  const profilePrefix = 'clawfable:agents:profile:';
  const indexRaw = await kvGet(kv, indexKey);
  const handles = asStringList(indexRaw);
  const indexedProfileKeys = handles.map((handle) => `${profilePrefix}${handle}`);
  const allScannedKeys = asStringList(await kvKeys(kv, `${profilePrefix}*`));

  const keysToDelete = [...new Set([indexKey, ...indexedProfileKeys, ...allScannedKeys])];
  const deleteResults = keysToDelete.length ? await Promise.all(keysToDelete.map((key) => deleteKvKey(kv, key))) : [];
  const removed = deleteResults.filter(isKvDeletedResult).length;

  return NextResponse.json({
    ok: true,
    cleared: {
      agents: true,
      agentsDeleted: removed,
      keysDeleted: keysToDelete.length
    }
  });
}
