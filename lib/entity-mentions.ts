import type { SourceDocument } from './types';
import type { TopicEntityRole, TopicEntityRoleName } from './trending';

export type VerifiedEntityMentionSource = 'official_x_author' | 'curated_registry';
export const ENTITY_MENTION_POLICY_VERSION = 'verified-entity-mentions-v3';
export const CURATED_X_ENTITY_REGISTRY_VERSION = 'curated-x-entities-2026-08-26-2';

export interface VerifiedEntityMention {
  entity: string;
  handle: string;
  role: TopicEntityRoleName;
  source: VerifiedEntityMentionSource;
}

export interface CuratedXEntityRegistryEntry {
  entity: string;
  aliases?: readonly string[];
  handle: string;
  role: TopicEntityRoleName;
  caseSensitive?: boolean;
}

// Handles are accepted only after a live X identity check or a first-party
// site links the account. Ambiguous common words require canonical casing;
// distinctive brands still match Geoffrey's intentionally lowercase prose.
export const CURATED_X_ENTITY_REGISTRY: readonly CuratedXEntityRegistryEntry[] = [
  { entity: 'Cursor', handle: 'cursor_ai', role: 'company', caseSensitive: true },
  { entity: 'OpenAI', handle: 'OpenAI', role: 'company' },
  { entity: 'Anthropic', handle: 'AnthropicAI', role: 'company', caseSensitive: true },
  { entity: 'Claude', handle: 'claudeai', role: 'product', caseSensitive: true },
  { entity: 'Cognition', aliases: ['Cognition AI'], handle: 'cognition', role: 'company', caseSensitive: true },
  { entity: 'SpaceX', aliases: ['Space X'], handle: 'SpaceX', role: 'company' },
  { entity: 'xAI', handle: 'xai', role: 'company' },
  { entity: 'Grok', handle: 'grok', role: 'product', caseSensitive: true },
  { entity: 'Tesla', handle: 'Tesla', role: 'company', caseSensitive: true },
  { entity: 'NVIDIA', aliases: ['Nvidia'], handle: 'nvidia', role: 'company' },
  { entity: 'Google DeepMind', aliases: ['DeepMind'], handle: 'GoogleDeepMind', role: 'company' },
  { entity: 'Gemini', aliases: ['Google Gemini'], handle: 'GeminiApp', role: 'product', caseSensitive: true },
  { entity: 'Microsoft', handle: 'Microsoft', role: 'company' },
  { entity: 'Anduril', aliases: ['Anduril Industries'], handle: 'anduriltech', role: 'company', caseSensitive: true },
  { entity: 'Physical Intelligence', handle: 'physical_int', role: 'company', caseSensitive: true },
  { entity: 'ElevenLabs', aliases: ['Eleven Labs'], handle: 'ElevenLabs', role: 'company' },
  { entity: 'Perplexity', handle: 'perplexity_ai', role: 'company', caseSensitive: true },
  { entity: 'Lovable', handle: 'Lovable', role: 'company', caseSensitive: true },
  { entity: 'Replit', handle: 'Replit', role: 'company' },
  { entity: 'Vercel', handle: 'vercel', role: 'company' },
  { entity: 'Modal', handle: 'modal', role: 'company', caseSensitive: true },
  { entity: 'Ramp', handle: 'tryramp', role: 'company', caseSensitive: true },
  { entity: 'Polymarket', handle: 'Polymarket', role: 'company' },
  { entity: 'Helion', handle: 'Helion_Energy', role: 'company', caseSensitive: true },
  { entity: 'Saronic', handle: 'Saronic', role: 'company', caseSensitive: true },
  { entity: 'General Matter', handle: 'generalmatter', role: 'company', caseSensitive: true },
  { entity: 'Etched', handle: 'Etched', role: 'company', caseSensitive: true },
  { entity: 'Ketone-IQ', aliases: ['Ketone IQ'], handle: 'ketone', role: 'company' },
  { entity: 'Eight Sleep', handle: 'eightsleep', role: 'company' },
  { entity: 'Betr', handle: 'betr', role: 'company' },
  { entity: 'Kings League', handle: 'KingsLeague', role: 'company' },
  { entity: 'Chronosphere', handle: 'chronosphereio', role: 'company' },
  { entity: 'LinkedIn', aliases: ['Linkedin'], handle: 'LinkedIn', role: 'company' },
  { entity: 'GitHub', aliases: ['Github'], handle: 'github', role: 'company' },
  { entity: 'Scale AI', handle: 'scale_AI', role: 'company' },
  { entity: 'CoreWeave', handle: 'CoreWeave', role: 'company' },
  { entity: 'Palantir', handle: 'PalantirTech', role: 'company' },
  { entity: 'Figure AI', handle: 'Figure_robot', role: 'company' },
  { entity: 'Waymo', handle: 'Waymo', role: 'company' },
  { entity: 'Boston Dynamics', handle: 'BostonDynamics', role: 'company' },
  { entity: 'Midjourney', handle: 'midjourney', role: 'company' },
  { entity: 'Stripe', handle: 'stripe', role: 'company', caseSensitive: true },
  { entity: 'Sam Altman', handle: 'sama', role: 'person' },
  { entity: 'Elon Musk', handle: 'elonmusk', role: 'person' },
  { entity: 'Satya Nadella', handle: 'satyanadella', role: 'person' },
  { entity: 'Dario Amodei', handle: 'DarioAmodei', role: 'person' },
  { entity: 'Scott Wu', handle: 'ScottWu46', role: 'person' },
  { entity: 'Alexandr Wang', handle: 'alexandr_wang', role: 'person' },
  { entity: 'Aravind Srinivas', handle: 'AravSrinivas', role: 'person' },
  { entity: 'Bret Taylor', handle: 'btaylor', role: 'person' },
  { entity: 'Patrick Collison', handle: 'patrickc', role: 'person' },
  { entity: 'John Collison', handle: 'collision', role: 'person' },
  { entity: 'Brian Armstrong', handle: 'brian_armstrong', role: 'person' },
  { entity: 'Demis Hassabis', handle: 'demishassabis', role: 'person' },
  { entity: 'Yann LeCun', handle: 'ylecun', role: 'person' },
  { entity: 'Andrej Karpathy', handle: 'karpathy', role: 'person' },
  { entity: 'Palmer Luckey', handle: 'PalmerLuckey', role: 'person' },
  { entity: 'Dylan Field', handle: 'zoink', role: 'person' },
  { entity: 'Michael Truell', handle: 'MichaelTruell', role: 'person' },
  { entity: 'Amjad Masad', handle: 'amasad', role: 'person' },
  { entity: 'Guillermo Rauch', handle: 'rauchg', role: 'person' },
];

const DEPRECATED_CURATED_X_HANDLES = new Map<string, string>([
  ['elevenlabsio', 'elevenlabs'],
  ['modal_labs', 'modal'],
]);

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

  return mergeVerifiedEntityMentions(candidates);
}

export function mergeVerifiedEntityMentions(
  ...collections: Array<readonly VerifiedEntityMention[]>
): VerifiedEntityMention[] {
  const byEntity = new Map<string, VerifiedEntityMention>();
  const conflicted = new Set<string>();
  for (const candidate of collections.flat()) {
    const key = normalizeIdentity(candidate.entity);
    if (!key || conflicted.has(key)) continue;
    const existing = byEntity.get(key);
    if (existing && existing.handle !== candidate.handle) {
      if (existing.source === 'curated_registry' && candidate.source !== 'curated_registry') continue;
      if (candidate.source === 'curated_registry' && existing.source !== 'curated_registry') {
        byEntity.set(key, candidate);
        continue;
      }
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

function textNamesEntity(text: string, entity: string, caseSensitive = false): boolean {
  const escaped = escapeRegExp(entity).replace(/\s+/g, '\\s+');
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_@])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
    caseSensitive ? 'u' : 'iu',
  ).test(text);
}

function textMentionsHandle(text: string, handle: string): boolean {
  return new RegExp(`(^|[^\\w])@${escapeRegExp(handle)}\\b`, 'i').test(text);
}

export function findCuratedVerifiedEntityMentions(
  ...texts: Array<string | null | undefined>
): VerifiedEntityMention[] {
  const text = texts.filter((value): value is string => Boolean(value?.trim())).join('\n');
  if (!text) return [];
  return buildVerifiedEntityMentions({
    curated: CURATED_X_ENTITY_REGISTRY.flatMap((entry) => {
      const aliases = [entry.entity, ...(entry.aliases || [])];
      const named = aliases.some((alias) => textNamesEntity(text, alias, entry.caseSensitive === true));
      return named || textMentionsHandle(text, entry.handle)
        ? [{ entity: entry.entity, handle: entry.handle, role: entry.role }]
        : [];
    }),
  });
}

export function getDeprecatedCuratedEntityHandleIssue(text: string): string | null {
  for (const handle of extractXHandles(text)) {
    const replacement = DEPRECATED_CURATED_X_HANDLES.get(handle);
    if (replacement) return `Deprecated X handle @${handle} must use @${replacement}.`;
  }
  return null;
}

function extractXHandles(text: string): string[] {
  return [...new Set([...text.matchAll(/(^|[^\w])@([a-zA-Z0-9_]{1,15})\b/g)]
    .map((match) => match[2].toLowerCase()))];
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

export function getCuratedEntityMentionPolicyIssue(text: string): string | null {
  return getDeprecatedCuratedEntityHandleIssue(text)
    || getMissingVerifiedEntityTagIssue(text, findCuratedVerifiedEntityMentions(text));
}

export function usedVerifiedMentionHandles(
  text: string,
  mentions: VerifiedEntityMention[],
): string[] {
  return [...new Set(mentions
    .filter((mention) => textMentionsHandle(text, mention.handle))
    .map((mention) => mention.handle))];
}

export function usedCuratedVerifiedMentionHandles(text: string): string[] {
  return usedVerifiedMentionHandles(text, findCuratedVerifiedEntityMentions(text));
}
