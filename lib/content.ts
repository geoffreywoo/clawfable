import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { randomBytes } from 'node:crypto';

export const coreSections = ['soul', 'memory'] as const;

export type CoreSection = (typeof coreSections)[number];

export type ScopeMap = {
  [key: string]: boolean | undefined;
  soul?: boolean;
  memory?: boolean;
  skill?: boolean;
  user_files?: boolean;
};

type RevisionMeta = {
  family?: string;
  id?: string;
  kind?: string;
  status?: string;
  parent_revision?: string;
  source?: string;
};

export type UserProfile = {
  handle: string;
  display_name?: string;
  profile_url?: string;
  verified: boolean;
  created_at: string;
  updated_at: string;
  artifact_count: number;
  last_artifact_ref?: string;
};

export type ArtifactDocument = {
  slug: string;
  sourcePath: string;
  title: string;
  description: string;
  content: string;
  copy_paste_scope: ScopeMap;
  revision: RevisionMeta | null;
  author_commentary?: string;
  user_comments?: unknown;
  created_by_handle?: string;
  created_by_display_name?: string;
  created_by_profile_url?: string;
  created_by_verified?: boolean;
  updated_by_handle?: string;
  updated_by_display_name?: string;
  updated_by_profile_url?: string;
  updated_by_verified?: boolean;
};

export type SectionItem = {
  slug: string;
  sourcePath: string;
  title: string;
  description: string;
  scopeFlags: string[];
  revision: {
    id?: string;
    kind?: string;
    status?: string;
  } | null;
  data?: Record<string, unknown>;
};

interface KVClient {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
  delete?(key: string): Promise<unknown>;
}

type DbRecord = {
  section: CoreSection;
  slug: string;
  sourcePath: string;
  title: string;
  description: string;
  content: string;
  copy_paste_scope: ScopeMap;
  revision: RevisionMeta;
  created_at: string;
  updated_at: string;
  author_commentary?: string;
  user_comments?: unknown;
  created_by_handle?: string;
  created_by_display_name?: string;
  created_by_profile_url?: string;
  created_by_verified?: boolean;
  updated_by_handle?: string;
  updated_by_display_name?: string;
  updated_by_profile_url?: string;
  updated_by_verified?: boolean;
};

type DbPayload = {
  section: CoreSection;
  slug: string;
  sourcePath?: string;
  title: string;
  description: string;
  content: string;
  copy_paste_scope?: ScopeMap;
  revision?: RevisionMeta;
  author_commentary?: string;
  user_comments?: unknown;
  created_by_handle?: string;
  created_by_display_name?: string;
  created_by_profile_url?: string;
  created_by_verified?: boolean;
  updated_by_handle?: string;
  updated_by_display_name?: string;
  updated_by_profile_url?: string;
  updated_by_verified?: boolean;
};

type ForkPayload = DbPayload & {
  sourceSection: CoreSection;
  sourceSlug: string;
};

const CONTENT_ROOT = path.join(process.cwd(), 'content');
const scopeOrder = ['soul', 'memory', 'skill', 'user_files'];
const DB_ARTIFACT_INDEX_PREFIX = 'clawfable:db:index';
const DB_ARTIFACT_PREFIX = 'clawfable:db:artifact';
const DB_AGENT_INDEX = 'clawfable:agents:index';
const DB_AGENT_PROFILE_PREFIX = 'clawfable:agents:profile';
const AGENT_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
const DB_SKIP_SEED_PREFIX = 'clawfable:admin:skip_seed';
const OPENCLAW_CANONICAL_TEMPLATES: Record<CoreSection, string> = {
  soul: 'https://docs.openclaw.ai/reference/templates/SOUL.md',
  memory: 'https://docs.openclaw.ai/reference/templates/MEMORY.md'
};
const OPENCLAW_CANONICAL_SEEDS: Record<CoreSection, string> = {
  soul: 'soul-baseline-v1',
  memory: 'memory-baseline-v1'
};
const OPENCLAW_TEMPLATE_BASENAME: Record<CoreSection, string> = {
  soul: 'soul.md',
  memory: 'memory.md'
};

let kvClient: Promise<KVClient | null> | null = null;
const seededSections = new Set<string>();

type StoredAgentProfile = UserProfile & {
  claim_token?: string;
  claim_token_expires_at?: string;
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

function scopeFlagsFromMap(scopeMap?: Record<string, unknown>): string[] {
  if (!scopeMap) return [];
  return scopeOrder.filter((key) => scopeMap[key] === true);
}

export function isCoreSection(section: string): section is CoreSection {
  return coreSections.includes(section.toLowerCase() as CoreSection);
}

function normalizeSection(section: string): CoreSection {
  return section.toLowerCase() as CoreSection;
}

function normalizeSlug(slug: string) {
  return slug.trim().replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.md$/i, '');
}

function normalizeAgentHandle(raw: string) {
  return raw.trim().replace(/^@+/, '').trim().toLowerCase();
}

function nowStamp() {
  return new Date().toISOString();
}

function parseArtifactCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function sourcePathFor(section: CoreSection, slug: string) {
  return `${section}/${slug}.md`;
}

function canonicalSourcePath(section: CoreSection, slug: string, sourcePath: string) {
  if (sourcePath.startsWith('http://') || sourcePath.startsWith('https://')) {
    return sourcePath;
  }

  const normalizedSlug = slug.toLowerCase();
  const normalizedSource = path.basename(sourcePath).toLowerCase();
  if (
    normalizedSlug === OPENCLAW_CANONICAL_SEEDS[section] ||
    normalizedSource === `${OPENCLAW_CANONICAL_SEEDS[section]}.md` ||
    normalizedSource === OPENCLAW_TEMPLATE_BASENAME[section]
  ) {
    return OPENCLAW_CANONICAL_TEMPLATES[section];
  }

  return sourcePath;
}

function artifactKey(section: CoreSection, slug: string) {
  return `${DB_ARTIFACT_PREFIX}:${section}:${slug}`;
}

function indexKey(section: CoreSection) {
  return `${DB_ARTIFACT_INDEX_PREFIX}:${section}`;
}

function extractRevision(meta: Record<string, unknown> | undefined) {
  if (!meta) return null;
  const revision = (meta as Record<string, unknown>).revision as Record<string, unknown> | undefined;
  if (!revision || typeof revision !== 'object') return null;

  return {
    family: String(revision.family || '').trim() || undefined,
    id: String(revision.id || revision.version || 'v1').trim() || undefined,
    kind: String(revision.kind || revision.type || 'revision').trim() || undefined,
    status: String(revision.status || 'draft').trim() || undefined,
    parent_revision: revision.parent_revision ? String(revision.parent_revision) : undefined,
    source: revision.fork_of
      ? String(revision.fork_of)
      : revision.source
        ? String(revision.source)
        : undefined
  };
}

function shortDescription(frontmatter: Record<string, unknown> | undefined, content: string) {
  const fromFrontmatter = typeof frontmatter?.description === 'string' ? frontmatter.description.trim() : '';
  if (fromFrontmatter) {
    return fromFrontmatter;
  }
  const titleLine = content.split('\n').find((line) => line.startsWith('# '));
  const firstBody = content
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .slice(0, 4)
    .join(' ');
  const fallback = titleLine ? titleLine.replace(/^#\s+/, '') : 'Wiki artifact in this section.';
  const cleaned = firstBody || fallback;
  return cleaned.replace(/\s+/g, ' ').slice(0, 180);
}

function fromMdSection(section: CoreSection) {
  const sectionDir = path.join(CONTENT_ROOT, section);
  if (!fs.existsSync(sectionDir)) return [];

  const walk = (dir: string, prefix = ''): ArtifactDocument[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: ArtifactDocument[] = [];

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walk(full, `${prefix}${entry.name}/`));
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const raw = fs.readFileSync(full, 'utf8');
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;
      const titleLine = String(parsed.content).split('\n').find((line) => line.startsWith('# '));
      const file = entry.name;
      const slug = `${prefix}${file.replace(/\.md$/, '')}`;
      const scope = (data?.copy_paste_scope as Record<string, unknown>) || {};

      files.push({
        slug,
        sourcePath: `${prefix}${file}`,
        title: (data?.title as string) || (titleLine ? titleLine.replace(/^#\s+/, '') : file.replace(/\.md$/, '')),
        description: shortDescription(data, parsed.content),
        copy_paste_scope: scope as ScopeMap,
        revision: extractRevision(data),
        author_commentary: typeof data?.author_commentary === 'string' ? data.author_commentary : undefined,
        user_comments: data?.author_comments || data?.user_comments || data?.comments,
        content: parsed.content
      });
    }

    return files;
  };

  return walk(sectionDir);
}

function sanitizeScope(scope?: ScopeMap) {
  const base: ScopeMap = {};
  scopeOrder.forEach((key) => {
    base[key] = scope?.[key] === true;
  });
  return base;
}

function mapRecordToSectionItem(row: DbRecord | ArtifactDocument): SectionItem {
  const revision =
    'revision' in row && row.revision
      ? {
          id: (row as DbRecord).revision?.id,
          kind: (row as DbRecord).revision?.kind,
          status: (row as DbRecord).revision?.status
        }
      : null;

  return {
    slug: row.slug,
    sourcePath: row.sourcePath,
    title: row.title,
    description: row.description,
    scopeFlags: scopeFlagsFromMap((row as DbRecord).copy_paste_scope),
    revision,
    data: {
      title: row.title,
      description: row.description,
        copy_paste_scope: (row as DbRecord).copy_paste_scope,
      revision: (row as DbRecord).revision,
      created_by_handle: (row as DbRecord).created_by_handle,
      created_by_display_name: (row as DbRecord).created_by_display_name,
      created_by_profile_url: (row as DbRecord).created_by_profile_url,
      created_by_verified: (row as DbRecord).created_by_verified,
      updated_by_handle: (row as DbRecord).updated_by_handle,
      updated_by_display_name: (row as DbRecord).updated_by_display_name,
      updated_by_profile_url: (row as DbRecord).updated_by_profile_url,
      updated_by_verified: (row as DbRecord).updated_by_verified,
      author_commentary: (row as Record<string, unknown>).author_commentary || (row as Record<string, unknown>).author_comment,
      user_comments: (row as Record<string, unknown>).user_comments || (row as Record<string, unknown>).author_comments || (row as Record<string, unknown>).comments,
      updated_at: 'updated_at' in row ? row.updated_at : nowStamp(),
      created_at: 'created_at' in row ? (row as DbRecord).created_at : nowStamp()
    }
  };
}

function toDoc(row: DbRecord): { data: Record<string, unknown>; content: string } {
  return {
    data: {
      title: row.title,
      description: row.description,
      copy_paste_scope: row.copy_paste_scope,
      revision: {
        family: row.revision?.family,
        id: row.revision?.id,
        kind: row.revision?.kind,
        status: row.revision?.status,
        parent_revision: row.revision?.parent_revision,
        source: row.revision?.source
      },
      author_commentary: row.author_commentary || (row as Record<string, unknown>).author_comment,
      user_comments: row.user_comments || (row as Record<string, unknown>).author_comments || (row as Record<string, unknown>).comments,
      source_path: row.sourcePath,
      created_by_handle: row.created_by_handle,
      created_by_display_name: row.created_by_display_name,
      created_by_profile_url: row.created_by_profile_url,
      created_by_verified: row.created_by_verified,
      updated_by_handle: row.updated_by_handle,
      updated_by_display_name: row.updated_by_display_name,
      updated_by_profile_url: row.updated_by_profile_url,
      updated_by_verified: row.updated_by_verified,
      created_at: row.created_at,
      updated_at: row.updated_at
    },
    content: row.content
  };
}

async function getKvClient(): Promise<KVClient | null> {
  if (kvClient !== null) return kvClient;

  kvClient = (async () => {
    const directUrl =
      pickEnvValue(
        'KV_REST_API_URL',
        'CLAWFABLE_DATABASE_URL',
        'CLAWFABLE_KV_URL',
        'KV_URL',
        'REDIS_URL'
      );
    const directToken =
      pickEnvValue(
        'KV_REST_API_TOKEN',
        'CLAWFABLE_DATABASE_TOKEN',
        'CLAWFABLE_KV_TOKEN',
        'KV_TOKEN',
        'KV_REST_API_READ_ONLY_TOKEN'
      );

    if (!directUrl || !directToken) return null;

    try {
      const kvModule = await import('@vercel/kv');
      if (typeof (kvModule as any).createClient === 'function') {
        return (kvModule as any).createClient({
          url: directUrl,
          token: directToken
        }) as KVClient;
      }
      if ((kvModule as any).kv) {
        return (kvModule as any).kv as KVClient;
      }
      return null;
    } catch {
      return null;
    }
  })();

  return kvClient;
}

function userProfileKey(rawHandle: string) {
  return `${DB_AGENT_PROFILE_PREFIX}:${normalizeAgentHandle(rawHandle)}`;
}

function isExpiredAt(raw?: string) {
  if (!raw) return true;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed.getTime() <= Date.now();
}

function normalizeAgentProfile(handle: string, raw: StoredAgentProfile | null): UserProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    handle: normalizeAgentHandle(handle),
    display_name:
      typeof raw.display_name === 'string' && raw.display_name.trim() ? raw.display_name.trim() : undefined,
    profile_url: typeof raw.profile_url === 'string' && raw.profile_url.trim() ? raw.profile_url.trim() : undefined,
    verified: raw.verified === true,
    created_at: raw.created_at || nowStamp(),
    updated_at: raw.updated_at || nowStamp(),
    artifact_count: parseArtifactCount(raw.artifact_count),
    last_artifact_ref: typeof raw.last_artifact_ref === 'string' && raw.last_artifact_ref.trim() ? raw.last_artifact_ref : undefined
  };
}

async function persistAgentProfile(profile: StoredAgentProfile) {
  const kv = await getKvClient();
  if (!kv) {
    throw new Error('No database configured for user profiles.');
  }

  const now = nowStamp();
  const normalizedHandle = normalizeAgentHandle(profile.handle);
  const record: StoredAgentProfile = {
    ...profile,
    handle: normalizedHandle,
    created_at: profile.created_at || now,
    updated_at: now,
    artifact_count: parseArtifactCount(profile.artifact_count)
  };

  const indexRaw = await kv.get<unknown>(DB_AGENT_INDEX);
  const index = Array.isArray(indexRaw) ? indexRaw.filter((value): value is string => typeof value === 'string') : [];
  const nextIndex = [...new Set([...index, normalizedHandle])];
  await kv.set(DB_AGENT_INDEX, nextIndex);
  await kv.set(userProfileKey(normalizedHandle), record);
}

export async function getAgentProfile(handle: string): Promise<UserProfile | null> {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) return null;
  const kv = await getKvClient();
  if (!kv) return null;
  const row = await kv.get<StoredAgentProfile>(userProfileKey(normalized));
  if (!row) return null;
  return normalizeAgentProfile(normalized, row);
}

async function setAgentProfile(raw: StoredAgentProfile) {
  await persistAgentProfile(raw);
}

function parseAgentProfile(raw: StoredAgentProfile | null, fallbackHandle: string): StoredAgentProfile {
  const base = normalizeAgentHandle(fallbackHandle);
  if (!base) throw new Error('Agent handle is required.');
  const now = nowStamp();
  if (!raw || typeof raw !== 'object') {
    return {
      handle: base,
      verified: false,
      created_at: now,
      updated_at: now,
      artifact_count: 0
    };
  }
  return {
    ...raw,
    handle: base,
    verified: raw.verified === true,
    created_at: raw.created_at || now,
    updated_at: now,
    artifact_count: parseArtifactCount(raw.artifact_count)
  };
}

async function getAgentProfileRow(handle: string): Promise<StoredAgentProfile | null> {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) return null;
  const kv = await getKvClient();
  if (!kv) return null;
  return kv.get<StoredAgentProfile>(userProfileKey(normalized));
}

export async function getAgentProfiles(): Promise<UserProfile[]> {
  const kv = await getKvClient();
  if (!kv) return [];

  const rawIndex = await kv.get<unknown>(DB_AGENT_INDEX);
  const handles = Array.isArray(rawIndex) ? rawIndex.filter((value): value is string => typeof value === 'string') : [];
  if (handles.length === 0) return [];

  const rows = await Promise.all(handles.map((handle) => getAgentProfile(handle)));
  return rows.filter((row): row is UserProfile => Boolean(row));
}

export async function requestAgentClaim(handle: string, displayName?: string, profileUrl?: string) {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) throw new Error('Agent handle is required to request a claim.');
  const now = nowStamp();
  const raw = await getAgentProfileRow(normalized);
  const base = parseAgentProfile(raw, normalized);

  const next: StoredAgentProfile = {
    ...base,
    handle: normalized,
    display_name: displayName || base.display_name,
    profile_url: profileUrl || base.profile_url,
    claim_token: randomBytes(16).toString('hex'),
    claim_token_expires_at: new Date(Date.parse(now) + AGENT_CLAIM_TTL_MS).toISOString(),
    updated_at: now
  };

  await persistAgentProfile(next);
  return next.claim_token;
}

export async function verifyAgentClaim(handle: string, claimToken: string): Promise<UserProfile> {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) throw new Error('Agent handle is required.');
  if (!claimToken) throw new Error('Claim token is required.');

  const kv = await getKvClient();
  if (!kv) throw new Error('No database configured for user verification.');

  const raw = await getAgentProfileRow(normalized);
  if (!raw) throw new Error('Agent not found.');
  if (typeof raw.claim_token !== 'string' || raw.claim_token !== claimToken) {
    throw new Error('Claim token is invalid.');
  }
  if (isExpiredAt(raw.claim_token_expires_at)) {
    throw new Error('Claim token expired.');
  }

  const next: StoredAgentProfile = {
    ...raw,
    handle: normalized,
    verified: true,
    claim_token: undefined,
    claim_token_expires_at: undefined,
    updated_at: nowStamp()
  };
  await persistAgentProfile(next);
  return normalizeAgentProfile(normalized, next)!;
}

async function consumeAgentClaimForUpload(handle: string, claimToken?: string): Promise<boolean> {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) return false;
  if (!claimToken) return false;

  const kv = await getKvClient();
  if (!kv) return false;
  const raw = await getAgentProfileRow(normalized);
  if (!raw || raw.verified === true) {
    return raw ? raw.verified === true : false;
  }
  if (typeof raw.claim_token !== 'string' || raw.claim_token !== claimToken) {
    return false;
  }
  if (isExpiredAt(raw.claim_token_expires_at)) return false;

  await persistAgentProfile({
    ...raw,
    handle: normalized,
    verified: true,
    claim_token: undefined,
    claim_token_expires_at: undefined,
    updated_at: nowStamp()
  });
  return true;
}

export async function resolveAgentForUpload(
  handle: string,
  metadata: {
    displayName?: string;
    profileUrl?: string;
    claimToken?: string;
  } = {}
): Promise<Required<Pick<UserProfile, 'handle' | 'verified'>> & Pick<UserProfile, 'display_name' | 'profile_url'> {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) throw new Error('agent_handle is required.');

  const raw = await getAgentProfileRow(normalized);
  const base = parseAgentProfile(raw, normalized);

  const now = nowStamp();
  const isVerified = base.verified || (await consumeAgentClaimForUpload(normalized, metadata.claimToken));
  const updated = {
    ...base,
    handle: normalized,
    display_name: metadata.displayName || base.display_name,
    profile_url: metadata.profileUrl || base.profile_url,
    verified: isVerified,
    updated_at: now
  };

  await persistAgentProfile(updated);
  return {
    handle: updated.handle,
    verified: updated.verified,
    display_name: updated.display_name,
    profile_url: updated.profile_url
  };
}

export async function recordAgentArtifact(handle: string, section: string, slug: string) {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) return;
  const now = nowStamp();
  const raw = await getAgentProfileRow(normalized);
  const base = parseAgentProfile(raw, normalized);
  await persistAgentProfile({
    ...base,
    handle: normalized,
    last_artifact_ref: `${section}/${slug}`,
    artifact_count: parseArtifactCount(base.artifact_count) + 1,
    updated_at: now
  });
}

async function getSectionIndex(section: CoreSection): Promise<string[]> {
  const kv = await getKvClient();
  if (!kv) return [];

  const raw = await kv.get<unknown>(indexKey(section));
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      return [];
    }
  }

  return [];
}

async function setSectionIndex(section: CoreSection, values: string[]) {
  const kv = await getKvClient();
  if (!kv) return;
  const next = [...new Set(values.filter(Boolean).map((item) => item.trim()).filter(Boolean))];
  await kv.set(indexKey(section), next);
}

function skipSeedKey(section: CoreSection) {
  return `${DB_SKIP_SEED_PREFIX}:${section}`;
}

async function shouldSkipSectionSeed(section: CoreSection) {
  const kv = await getKvClient();
  if (!kv) return false;

  const raw = await kv.get<unknown>(skipSeedKey(section));
  if (raw == null) return false;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on', 'enabled', 'skip'].includes(value);
  }

  return false;
}

async function getArtifact(section: CoreSection, slug: string): Promise<DbRecord | null> {
  const kv = await getKvClient();
  if (!kv) return null;
  const key = artifactKey(section, normalizeSlug(slug));
  const raw = await kv.get<DbRecord>(key);
  if (!raw) return null;
  return normalizeArtifact(section, raw);
}

function normalizeArtifact(section: CoreSection, raw: DbRecord): DbRecord {
  const rev = raw.revision || {};
  const normalizedSlug = normalizeSlug(raw.slug);
  return {
    section,
    slug: normalizedSlug,
    sourcePath: canonicalSourcePath(section, normalizedSlug, raw.sourcePath || sourcePathFor(section, normalizedSlug)),
    title: raw.title || 'Clawfable artifact',
    description: raw.description || 'Clawfable artifact',
    author_commentary: raw.author_commentary || (raw as Record<string, unknown>).author_comment,
    user_comments:
      raw.user_comments || (raw as Record<string, unknown>).author_comments || (raw as Record<string, unknown>).comments,
    content: raw.content || '',
    created_by_handle: raw.created_by_handle,
    created_by_display_name: raw.created_by_display_name,
    created_by_profile_url: raw.created_by_profile_url,
    created_by_verified: raw.created_by_verified === true,
    updated_by_handle: raw.updated_by_handle,
    updated_by_display_name: raw.updated_by_display_name,
    updated_by_profile_url: raw.updated_by_profile_url,
    updated_by_verified: raw.updated_by_verified === true,
    copy_paste_scope: sanitizeScope(raw.copy_paste_scope || {}),
    revision: {
      family: rev.family || section,
      id: rev.id || 'v1',
      kind: rev.kind || 'core',
      status: rev.status || 'draft',
      parent_revision: rev.parent_revision,
      source: rev.source
    },
    created_at: raw.created_at || nowStamp(),
    updated_at: raw.updated_at || nowStamp()
  };
}

async function upsertArtifact(section: CoreSection, payload: DbPayload): Promise<DbRecord> {
  const kv = await getKvClient();
  if (!kv) {
    throw new Error(
      'No database configured. Set CLAWFABLE_DATABASE_URL + CLAWFABLE_DATABASE_TOKEN, CLAWFABLE_KV_URL + CLAWFABLE_KV_TOKEN, KV_REST_API_URL + KV_REST_API_TOKEN (read-write), or KV_REST_API_URL + KV_REST_API_READ_ONLY_TOKEN (read-only).'
    );
  }

  const slug = normalizeSlug(payload.slug);
  const now = nowStamp();
  const existing = await getArtifact(section, slug);
  const revisionInput = payload.revision || {};
  const fallbackSection = revisionInput.family || section;
  const actorUpdated: Record<string, unknown> = payload.updated_by_handle || payload.created_by_handle
    ? {
        handle: payload.updated_by_handle || payload.created_by_handle,
        display_name: payload.updated_by_display_name || payload.created_by_display_name,
        profile_url: payload.updated_by_profile_url || payload.created_by_profile_url,
        verified: payload.updated_by_verified ?? payload.created_by_verified
      }
    : {};
  const actorCreated = payload.created_by_handle
    ? {
        handle: payload.created_by_handle,
        display_name: payload.created_by_display_name,
        profile_url: payload.created_by_profile_url,
        verified: payload.created_by_verified
      }
    : existing
      ? {
          handle: existing.created_by_handle,
          display_name: existing.created_by_display_name,
          profile_url: existing.created_by_profile_url,
          verified: existing.created_by_verified === true
        }
      : actorUpdated;

  const createdHandle = typeof actorCreated.handle === 'string' ? actorCreated.handle : undefined;
  const createdDisplay = typeof actorCreated.display_name === 'string' ? actorCreated.display_name : undefined;
  const createdProfile = typeof actorCreated.profile_url === 'string' ? actorCreated.profile_url : undefined;
  const createdVerified = actorCreated.verified === true;
  const updatedHandle = typeof actorUpdated.handle === 'string' ? actorUpdated.handle : createdHandle;
  const updatedDisplay = typeof actorUpdated.display_name === 'string' ? actorUpdated.display_name : createdDisplay;
  const updatedProfile = typeof actorUpdated.profile_url === 'string' ? actorUpdated.profile_url : createdProfile;
  const updatedVerified = actorUpdated.verified === true || createdVerified;

  const record: DbRecord = {
    section,
    slug,
    sourcePath: canonicalSourcePath(section, slug, payload.sourcePath || sourcePathFor(section, slug)),
    title: payload.title,
    description:
      payload.description?.trim() ||
      shortDescription({}, payload.content) ||
      `Clawfable ${section} artifact.`,
    author_commentary: payload.author_commentary || undefined,
    user_comments: payload.user_comments,
    content: payload.content,
    created_by_handle: createdHandle,
    created_by_display_name: createdDisplay,
    created_by_profile_url: createdProfile,
    created_by_verified: createdVerified,
    updated_by_handle: updatedHandle,
    updated_by_display_name: updatedDisplay,
    updated_by_profile_url: updatedProfile,
    updated_by_verified: updatedVerified,
    copy_paste_scope: sanitizeScope(payload.copy_paste_scope || existing?.copy_paste_scope || {}),
    revision: {
      family: fallbackSection,
      id: revisionInput.id || existing?.revision?.id || 'v1',
      kind: revisionInput.kind || existing?.revision?.kind || 'revision',
      status: revisionInput.status || existing?.revision?.status || 'draft',
      parent_revision: revisionInput.parent_revision || existing?.revision?.parent_revision,
      source: revisionInput.source || existing?.revision?.source
    },
    created_at: existing?.created_at || now,
    updated_at: now
  };

  await kv.set(artifactKey(section, slug), record);

  const index = await getSectionIndex(section);
  if (!index.includes(slug)) {
    index.push(slug);
    await setSectionIndex(section, index);
  }

  return record;
}

async function ensureSectionSeeded(section: CoreSection) {
  if (seededSections.has(section)) return;

  if (await shouldSkipSectionSeed(section)) {
    return;
  }

  const index = await getSectionIndex(section);
  if (index.length > 0) {
    seededSections.add(section);
    return;
  }

  const seededRows = fromMdSection(section);
  const kv = await getKvClient();
  if (!kv) {
    seededSections.add(section);
    return;
  }

  for (const row of seededRows) {
    await upsertArtifact(section, {
      section,
      slug: row.slug,
      title: row.title,
      description: row.description,
      content: row.content,
      copy_paste_scope: row.copy_paste_scope,
      revision: row.revision || undefined,
      sourcePath: row.sourcePath
    });
  }

  seededSections.add(section);
}

export function listSections(): string[] {
  return coreSections.filter((section) => {
    const contentDirectory = path.join(CONTENT_ROOT, section);
    return fs.existsSync(contentDirectory);
  });
}

export async function listBySection(section: string): Promise<SectionItem[]> {
  if (!isCoreSection(section)) return [];
  const normalized = normalizeSection(section);

  await ensureSectionSeeded(normalized);
  const isSeedingSkipped = await shouldSkipSectionSeed(normalized);

  const recordsFromDb = await (async () => {
    const index = await getSectionIndex(normalized);
    if (index.length === 0) return [];
    const rows = await Promise.all(index.map((slug) => getArtifact(normalized, slug)));
    return rows.filter((row): row is DbRecord => Boolean(row));
  })();

  if (recordsFromDb.length > 0) {
    return recordsFromDb
      .map((row) => mapRecordToSectionItem(row))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  if (isSeedingSkipped) {
    return [];
  }

  const fallback = fromMdSection(normalized);
  return fallback
    .map((row) => mapRecordToSectionItem({
      section: normalized,
      slug: row.slug,
      sourcePath: canonicalSourcePath(normalized, row.slug, row.sourcePath),
      title: row.title,
      description: row.description,
      content: row.content,
      copy_paste_scope: row.copy_paste_scope,
      revision: row.revision || {},
      created_at: nowStamp(),
      updated_at: nowStamp()
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getDoc(section: string, slug: string | string[]) {
  if (!isCoreSection(section)) return null;

  const normalizedSection = normalizeSection(section);
  const normalizedSlug = normalizeSlug(Array.isArray(slug) ? slug.join('/') : String(slug));

  await ensureSectionSeeded(normalizedSection);
  const isSeedingSkipped = await shouldSkipSectionSeed(normalizedSection);

  const fromDb = await getArtifact(normalizedSection, normalizedSlug);
  if (fromDb) {
    return toDoc(fromDb);
  }

  if (isSeedingSkipped) {
    return null;
  }

  const sectionDir = path.join(CONTENT_ROOT, normalizedSection);
  const fallbackPath = path.join(sectionDir, `${normalizedSlug}.md`);
  if (!fs.existsSync(fallbackPath)) return null;
  const raw = fs.readFileSync(fallbackPath, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;

  const row: DbRecord = {
    section: normalizedSection,
    slug: normalizedSlug,
    sourcePath: canonicalSourcePath(
      normalizedSection,
      normalizedSlug,
      `${normalizedSection}/${normalizedSlug}.md`
    ),
    title: (data?.title as string) || `Clawfable ${normalizedSection} artifact`,
    description: shortDescription(data, parsed.content),
    content: parsed.content,
    copy_paste_scope: sanitizeScope((data?.copy_paste_scope as ScopeMap) || {}),
    revision: extractRevision(data) || { family: normalizedSection, id: 'v1', kind: 'core', status: 'accepted' },
    created_at: nowStamp(),
    updated_at: nowStamp()
  };

  return toDoc(row);
}

export async function createArtifact(payload: DbPayload) {
  const normalizedSection = normalizeSection(payload.section);
  const existing = await getArtifact(normalizedSection, payload.slug);
  if (existing) {
    throw new Error('A row already exists for this section+slug. Use revise for existing entries.');
  }

  return upsertArtifact(normalizedSection, {
    ...payload,
    section: normalizedSection,
    revision: {
      ...payload.revision,
      kind: payload.revision?.kind || 'core',
      family: payload.revision?.family || normalizedSection,
      status: payload.revision?.status || 'review'
    }
  });
}

export async function reviseArtifact(payload: DbPayload) {
  const normalizedSection = normalizeSection(payload.section);
  const slug = normalizeSlug(payload.slug);
  const existing = await getArtifact(normalizedSection, slug);
  if (!existing) {
    throw new Error('Cannot revise a missing artifact. Upload with create mode first.');
  }

  return upsertArtifact(normalizedSection, {
    ...payload,
    section: normalizedSection,
    slug,
    revision: {
      ...(payload.revision || {}),
      kind: payload.revision?.kind || 'revision',
      family: payload.revision?.family || existing.revision.family || normalizedSection,
      parent_revision: payload.revision?.parent_revision || existing.revision.id || 'v1',
      status: payload.revision?.status || existing.revision.status || 'review'
    }
  });
}

export async function forkArtifact(payload: ForkPayload) {
  const sourceSection = payload.sourceSection;
  const sourceSlug = normalizeSlug(payload.sourceSlug);
  const normalizedSection = normalizeSection(payload.section);

  if (!isCoreSection(sourceSection) || !isCoreSection(payload.section)) {
    throw new Error('Fork request must use SOUL or MEMORY only.');
  }

  const sourceRecord = await getArtifact(sourceSection, sourceSlug);
  if (!sourceRecord) {
    throw new Error('Fork source artifact not found.');
  }

  if (sourceSection !== payload.section) {
    throw new Error('Fork source and destination section must match.');
  }

  const normalizedSlug = normalizeSlug(payload.slug);
  const existing = await getArtifact(normalizedSection, normalizedSlug);
  if (existing) {
    throw new Error('A fork already exists with this slug. Choose a unique fork slug.');
  }

  return upsertArtifact(normalizedSection, {
    section: normalizedSection,
    slug: normalizedSlug,
    title: payload.title,
    description: payload.description || sourceRecord.description,
    content: payload.content,
    copy_paste_scope: payload.copy_paste_scope || sourceRecord.copy_paste_scope,
    revision: {
      family: payload.revision?.family || sourceRecord.revision.family,
      kind: 'fork',
      id: payload.revision?.id,
      status: payload.revision?.status || 'review',
      parent_revision: payload.revision?.parent_revision || sourceRecord.revision.id,
      source: payload.revision?.source || sourceRecord.sourcePath
    },
    sourcePath: payload.sourcePath || sourcePathFor(normalizedSection, normalizedSlug)
  });
}

export function getRootDoc(slug: string) {
  const full = path.join(CONTENT_ROOT, `${slug}.md`);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, 'utf8');
  const parsed = matter(raw);
  return { data: parsed.data, content: parsed.content };
}

export async function artifactPayloadFromRequest(body: Record<string, unknown>) {
  const section = normalizeSection(String(body.section || ''));
  if (!isCoreSection(section)) {
    throw new Error('Unsupported section. Use soul or memory.');
  }

  const slug = normalizeSlug(String(body.slug || ''));
  if (!slug) {
    throw new Error('Artifact slug is required.');
  }
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  if (!title || !content) {
    throw new Error('Artifact title and content are required.');
  }

  const sourcePath = body.sourcePath ? String(body.sourcePath) : sourcePathFor(section, slug);
  const rawDescription = body.description ? String(body.description) : '';
  const parseCheckbox = (value: unknown) => {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return false;
    return ['on', 'true', '1', 'yes'].includes(value.toLowerCase());
  };
  const copyPasteScope: ScopeMap = {
    soul: parseCheckbox(body.soul) || parseCheckbox(body.copy_paste_soul),
    memory: parseCheckbox(body.memory) || parseCheckbox(body.copy_paste_memory),
    skill: parseCheckbox(body.skill) || parseCheckbox(body.copy_paste_skill),
    user_files: parseCheckbox(body.user_files) || parseCheckbox(body.copy_paste_user_files)
  };

  const revision: RevisionMeta = {
    family: body.family ? String(body.family) : section,
    id: body.revision_id ? String(body.revision_id).trim() : undefined,
    kind: body.kind ? String(body.kind) : undefined,
    status: body.status ? String(body.status) : undefined,
    parent_revision: body.parent_revision ? String(body.parent_revision) : undefined,
    source: body.source ? String(body.source) : undefined
  };

  return {
    section,
    slug,
    sourcePath,
    title,
    description: rawDescription || shortDescription({}, content),
    content,
    copy_paste_scope: copyPasteScope,
    created_by_handle: typeof body.agent_handle === 'string' ? normalizeAgentHandle(body.agent_handle) : undefined,
    created_by_display_name:
      typeof body.agent_display_name === 'string' && body.agent_display_name.trim()
        ? body.agent_display_name.trim()
        : typeof body.agent_name === 'string' && body.agent_name.trim()
          ? body.agent_name.trim()
          : undefined,
    created_by_profile_url:
      typeof body.agent_profile_url === 'string' && body.agent_profile_url.trim()
        ? body.agent_profile_url.trim()
        : undefined,
    updated_by_handle:
      typeof body.updated_by_handle === 'string'
        ? normalizeAgentHandle(body.updated_by_handle)
        : typeof body.agent_handle === 'string'
          ? normalizeAgentHandle(body.agent_handle)
          : undefined,
    updated_by_display_name:
      typeof body.updated_by_display_name === 'string' && body.updated_by_display_name.trim()
        ? body.updated_by_display_name.trim()
        : typeof body.agent_display_name === 'string' && body.agent_display_name.trim()
          ? body.agent_display_name.trim()
          : typeof body.agent_name === 'string' && body.agent_name.trim()
            ? body.agent_name.trim()
            : undefined,
    updated_by_profile_url:
      typeof body.updated_by_profile_url === 'string' && body.updated_by_profile_url.trim()
        ? body.updated_by_profile_url.trim()
        : typeof body.agent_profile_url === 'string' && body.agent_profile_url.trim()
          ? body.agent_profile_url.trim()
          : undefined,
    updated_by_verified:
      typeof body.updated_by_verified === 'boolean'
        ? body.updated_by_verified
        : typeof body.updated_by_verified === 'string'
          ? ['true', '1', 'yes', 'on'].includes(body.updated_by_verified.toLowerCase())
          : undefined,
    author_commentary: typeof body.author_commentary === 'string' ? body.author_commentary : undefined,
    user_comments: body.user_comments || body.comments,
    revision
  };
}
