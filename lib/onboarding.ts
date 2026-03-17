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

export async function getClaimRecord(artifactKey: string) {
  const kv = await getKvClient();
  if (!kv) throw new Error('KV_UNAVAILABLE');
  const record = await kvGet<OnboardingClaimRecord | null>(kv, claimKey(artifactKey));
  return { kv, record };
}
