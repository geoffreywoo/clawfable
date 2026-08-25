import type { SourceDocument } from './types';
import type { TopicEntityRole, TopicEntityRoleName } from './trending';

export type VerifiedEntityMentionSource = 'official_x_author' | 'curated_registry';
export const ENTITY_MENTION_POLICY_VERSION = 'verified-entity-mentions-v1';

export interface VerifiedEntityMention {
  entity: string;
  handle: string;
  role: TopicEntityRoleName;
  source: VerifiedEntityMentionSource;
}

const FIRST_PARTY_HANDLE_SUFFIXES = [
  'official',
  'comms',
  'hq',
  'team',
  'inc',
  'labs',
  'ai',
  'app',
  'mma',
  'sports',
  'company',
  'co',
];

function compactEntity(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function normalizeIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\b(?:the|official)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function normalizeXHandle(value: string | null | undefined): string | null {
  const handle = String(value || '').trim().replace(/^@/, '');
  return /^[a-zA-Z0-9_]{1,15}$/.test(handle) ? handle.toLowerCase() : null;
}

export function xIdentityMatchesEntity(identity: string, entity: string): boolean {
  const identityKey = normalizeIdentity(identity);
  const entityKey = normalizeIdentity(entity);
  if (identityKey.length < 3 || entityKey.length < 3) return false;
  if (identityKey === entityKey) return true;
  return FIRST_PARTY_HANDLE_SUFFIXES.some((suffix) => (
    identityKey === `${entityKey}${suffix}`
    || entityKey === `${identityKey}${suffix}`
  ));
}

function sourceAuthorHandle(document: SourceDocument): string | null {
  if (document.sourceType !== 'x') return null;
  const metadataHandle = normalizeXHandle(
    typeof document.metadata.sourceAuthorHandle === 'string'
      ? document.metadata.sourceAuthorHandle
      : null,
  );
  const publisherHandle = normalizeXHandle(document.publisher);
  let urlHandle: string | null = null;
  try {
    const url = new URL(document.canonicalUrl);
    if (url.hostname === 'x.com' || url.hostname === 'www.x.com' || url.hostname === 'twitter.com' || url.hostname === 'www.twitter.com') {
      urlHandle = normalizeXHandle(url.pathname.split('/').filter(Boolean)[0]);
    }
  } catch {
    return null;
  }
  const handle = metadataHandle || publisherHandle || urlHandle;
  if (!handle || !urlHandle || handle !== urlHandle) return null;
  if (publisherHandle && publisherHandle !== handle) return null;
  return handle;
}

function sourceAuthorName(document: SourceDocument): string | null {
  const value = document.metadata.sourceAuthorName;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null;
}

function sourceAuthorVerified(document: SourceDocument): boolean {
  return document.metadata.sourceAuthorVerified === true;
}

function documentEntities(document: SourceDocument): string[] {
  return [...new Set([
    ...document.entities,
    ...document.claims.flatMap((claim) => claim.entities),
  ].map(compactEntity).filter(Boolean))].slice(0, 20);
}

function roleForEntity(entity: string, roles: TopicEntityRole[]): TopicEntityRoleName {
  const key = normalizeIdentity(entity);
  return roles.find((entry) => normalizeIdentity(entry.name) === key)?.role || 'other';
}

export function buildVerifiedEntityMentions({
  entityRoles = [],
  documents = [],
  curated = [],
}: {
  entityRoles?: TopicEntityRole[];
  documents?: SourceDocument[];
  curated?: Array<{ entity: string; handle: string; role?: TopicEntityRoleName }>;
}): VerifiedEntityMention[] {
  const candidates: VerifiedEntityMention[] = [];

  for (const entry of entityRoles) {
    const handle = normalizeXHandle(entry.xHandle);
    const entity = compactEntity(entry.name);
    if (!handle || !entity) continue;
    candidates.push({ entity, handle, role: entry.role, source: 'official_x_author' });
  }

  for (const document of documents) {
    const handle = sourceAuthorHandle(document);
    if (!handle) continue;
    const authorName = sourceAuthorName(document);
    const authorVerified = sourceAuthorVerified(document);
    for (const entity of documentEntities(document)) {
      const handleMatches = xIdentityMatchesEntity(handle, entity);
      const verifiedNameMatches = document.isPrimary
        && authorVerified
        && Boolean(authorName && xIdentityMatchesEntity(authorName, entity));
      if (!handleMatches && !verifiedNameMatches) continue;
      candidates.push({
        entity,
        handle,
        role: roleForEntity(entity, entityRoles),
        source: 'official_x_author',
      });
    }
  }

  for (const entry of curated) {
    const handle = normalizeXHandle(entry.handle);
    const entity = compactEntity(entry.entity);
    if (!handle || !entity) continue;
    candidates.push({
      entity,
      handle,
      role: entry.role || 'company',
      source: 'curated_registry',
    });
  }

  const byEntity = new Map<string, VerifiedEntityMention>();
  const conflicted = new Set<string>();
  for (const candidate of candidates) {
    const key = normalizeIdentity(candidate.entity);
    if (!key || conflicted.has(key)) continue;
    const existing = byEntity.get(key);
    if (existing && existing.handle !== candidate.handle) {
      byEntity.delete(key);
      conflicted.add(key);
      continue;
    }
    if (!existing || (existing.role === 'other' && candidate.role !== 'other')) {
      byEntity.set(key, candidate);
    }
  }
  return [...byEntity.values()].slice(0, 12);
}

export function isLeadingXMention(text: string): boolean {
  const match = /@[a-zA-Z0-9_]{1,15}\b/.exec(text);
  if (!match) return false;
  return !/[\p{L}\p{N}]/u.test(text.slice(0, match.index));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textNamesEntity(text: string, entity: string): boolean {
  const escaped = escapeRegExp(entity).replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}_@])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
}

function textMentionsHandle(text: string, handle: string): boolean {
  return new RegExp(`(^|[^\\w])@${escapeRegExp(handle)}\\b`, 'i').test(text);
}

export function getMissingVerifiedEntityTagIssue(
  text: string,
  mentions: VerifiedEntityMention[],
): string | null {
  const missing = mentions.filter((mention) => (
    textNamesEntity(text, mention.entity)
    && !textMentionsHandle(text, mention.handle)
  ));
  if (missing.length === 0) return null;
  return `Named X ${missing.length === 1 ? 'entity' : 'entities'} must use the verified handle: ${missing.map((entry) => `${entry.entity}=@${entry.handle}`).join(', ')}.`;
}

export function usedVerifiedMentionHandles(
  text: string,
  mentions: VerifiedEntityMention[],
): string[] {
  return [...new Set(mentions
    .filter((mention) => textMentionsHandle(text, mention.handle))
    .map((mention) => mention.handle))];
}
