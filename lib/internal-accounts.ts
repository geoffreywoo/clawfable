import type { User } from './types';

const DEFAULT_INTERNAL_USERNAMES = new Set([
  'geoffreywoo',
  'antifund',
  'antihunterai',
  'clawfable',
]);

export function normalizeUsername(username: string | null | undefined): string {
  return String(username || '').replace(/^@/, '').trim().toLowerCase();
}

export function getInternalSharedUsernames(): Set<string> {
  const configured = (process.env.BILLING_GRANDFATHERED_USERNAMES || '')
    .split(',')
    .map((entry) => normalizeUsername(entry))
    .filter(Boolean);
  return new Set([...DEFAULT_INTERNAL_USERNAMES, ...configured]);
}

export function isInternalSharedAccount(user: Pick<User, 'username'>): boolean {
  return getInternalSharedUsernames().has(normalizeUsername(user.username));
}
