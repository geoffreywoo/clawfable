import { getKvClient, kvGet } from './content';

export type ClaimStatus = 'pending_claim' | 'claimed' | 'active' | 'expired';

export type OnboardingClaimRecord = {
  artifact_key: string;
  claim_token: string;
  claim_url: string;
  verification_phrase: string;
  section: string;
  source_slug: string;
  author_handle: string;
  proof_url?: string;
  status: ClaimStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
  request_ip?: string;
};

const CLAIM_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const RATE_LIMIT_WINDOW_MS = 1000 * 60; // 1m
const RATE_LIMIT_MAX = 20;

export function sanitize(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function claimKey(artifactKey: string) {
  return `clawfable:db:onboarding:claim:${artifactKey}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function expiresIso() {
  return new Date(Date.now() + CLAIM_TTL_MS).toISOString();
}

export function isExpired(record: { expires_at: string }) {
  return new Date(record.expires_at).getTime() < Date.now();
}

function rateLimitKey(ip: string) {
  const slot = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  return `clawfable:db:onboarding:rl:${ip}:${slot}`;
}

export async function enforceRateLimit(ip: string) {
  const kv = await getKvClient();
  if (!kv || !ip) return;
  const key = rateLimitKey(ip);
  const raw = await kvGet<number | string | null>(kv, key);
  const count = typeof raw === 'number' ? raw : Number(raw || 0);
  if (count >= RATE_LIMIT_MAX) {
    throw new Error('RATE_LIMITED');
  }
  await kv.set(key, count + 1);
}

export function validateOnboardingInput(sourceSlug: string, authorHandle: string) {
  if (!sourceSlug) {
    return {
      ok: false as const,
      error: 'source_slug is required for lineage updates.',
      code: 'BAD_LINEAGE_SOURCE',
      hint: 'Use the current lineage source slug (e.g., forks/<handle>/<slug>).'
    };
  }
  if (!sourceSlug.startsWith('forks/')) {
    return {
      ok: false as const,
      error: 'source_slug must reference a fork lineage source.',
      code: 'BAD_LINEAGE_SOURCE',
      hint: 'Expected format: forks/<handle>/<slug>'
    };
  }
  if (!authorHandle || !/^[a-zA-Z0-9_]{2,32}$/.test(authorHandle)) {
    return {
      ok: false as const,
      error: 'author_handle is required and must be 2-32 chars (letters, numbers, underscore).',
      code: 'AUTHOR_MISSING',
      hint: 'Pass your claimed Clawfable handle.'
    };
  }
  return { ok: true as const };
}

export async function createClaimBundle(params: {
  section: string;
  sourceSlug: string;
  authorHandle: string;
  requestIp: string;
  origin: string;
}) {
  const { section, sourceSlug, authorHandle, requestIp, origin } = params;
  await enforceRateLimit(requestIp);

  const nonce = crypto.randomUUID().slice(0, 8);
  const claimToken = `clawfable_claim_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const artifactKey = `clawfable_art_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const record: OnboardingClaimRecord = {
    artifact_key: artifactKey,
    claim_token: claimToken,
    claim_url: `${origin}/claim/${claimToken}`,
    verification_phrase: `claiming artifact ${claimToken} for @${authorHandle} (${section}:${nonce})`,
    section,
    source_slug: sourceSlug,
    author_handle: authorHandle,
    status: 'pending_claim',
    created_at: nowIso(),
    updated_at: nowIso(),
    expires_at: expiresIso(),
    request_ip: requestIp
  };

  const kv = await getKvClient();
  if (!kv) {
    throw new Error('KV_UNAVAILABLE');
  }
  await kv.set(claimKey(artifactKey), record);
  return record;
}

export async function getClaimRecord(artifactKey: string) {
  const kv = await getKvClient();
  if (!kv) throw new Error('KV_UNAVAILABLE');
  const record = await kvGet<OnboardingClaimRecord | null>(kv, claimKey(artifactKey));
  return { kv, record };
}
