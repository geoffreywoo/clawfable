import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@vercel/kv';

type AdminKvClient = {
  get: (key: string) => Promise<unknown>;
  del?: (key: string) => Promise<unknown>;
  delete?: (key: string) => Promise<unknown>;
  keys?: (pattern: string) => Promise<unknown>;
  set?: (key: string, value: unknown) => Promise<unknown>;
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

  // Targeted deletion: if "handles" is provided, only delete those specific agents
  const rawHandles = body.handles;
  const targetHandles = Array.isArray(rawHandles)
    ? rawHandles.map(String).filter(Boolean)
    : typeof rawHandles === 'string' && rawHandles.trim()
      ? rawHandles.split(',').map((h: string) => h.trim()).filter(Boolean)
      : null;

  const indexKey = 'clawfable:agents:index';
  const profilePrefix = 'clawfable:agents:profile:';

  if (targetHandles && targetHandles.length > 0) {
    // Targeted deletion: remove specific handles from index and delete their profiles
    const indexRaw = await kvGet(kv, indexKey);
    const currentHandles = asStringList(indexRaw);
    const handleSet = new Set(targetHandles.map((h: string) => h.toLowerCase()));

    const remaining = currentHandles.filter((h) => !handleSet.has(h.toLowerCase()));
    const removed: string[] = [];

    for (const handle of targetHandles) {
      const profileKey = `${profilePrefix}${handle}`;
      await deleteKvKey(kv, profileKey);
      removed.push(handle);
    }

    // Update the index with remaining handles
    if (typeof kv.set === 'function') {
      await kv.set(indexKey, remaining);
    }

    return NextResponse.json({
      ok: true,
      mode: 'targeted',
      removed,
      remaining_count: remaining.length
    });
  }

  // Full clear: delete all agents (existing behavior)
  const indexRaw = await kvGet(kv, indexKey);
  const handles = asStringList(indexRaw);
  const indexedProfileKeys = handles.map((handle) => `${profilePrefix}${handle}`);

  const keysToDelete = [...new Set([indexKey, ...indexedProfileKeys])];
  let removed = 0;
  for (const key of keysToDelete) {
    await deleteKvKey(kv, key);
    removed++;
  }

  return NextResponse.json({
    ok: true,
    mode: 'full',
    cleared: {
      agents: true,
      agentsDeleted: removed,
      keysDeleted: keysToDelete.length
    }
  });
}
