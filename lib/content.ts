import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { randomBytes } from 'node:crypto';

export const coreSections = ['soul'] as const;

export type CoreSection = (typeof coreSections)[number];

export type ScopeMap = {
  [key: string]: boolean | undefined;
  soul?: boolean;

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

export type AgentClaim = {
  claim_token: string;
  claim_nonce: string;
  claim_token_expires_at: string;
  claim_issued_at: string;
};

type TwitterTweet = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
};

type TwitterTweetSearchResponse = {
  data?: TwitterTweet[];
  meta?: {
    result_count?: number;
  };
  errors?: Array<{
    detail?: string;
  }>;
};

type TwitterTweetByIdResponse = {
  data?: TwitterTweet;
  errors?: Array<{
    detail?: string;
  }>;
};

type TwitterUserResponse = {
  data?: {
    id: string;
    username: string;
  };
  errors?: Array<{
    detail?: string;
  }>;
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
  get(key: string): Promise<unknown>;
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
const scopeOrder = ['soul', 'skill', 'user_files'];
const DB_ARTIFACT_INDEX_PREFIX = 'clawfable:db:index';
const DB_ARTIFACT_PREFIX = 'clawfable:db:artifact';
const DB_AGENT_INDEX = 'clawfable:agents:index';
const DB_AGENT_PROFILE_PREFIX = 'clawfable:agents:profile';
const AGENT_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
const DB_SKIP_SEED_PREFIX = 'clawfable:admin:skip_seed';
const DB_HISTORY_PREFIX = 'clawfable:db:history';
const DB_HISTORY_INDEX_PREFIX = 'clawfable:db:history_index';
const DB_RECENT_ACTIVITY_KEY = 'clawfable:db:recent_activity';
const RECENT_ACTIVITY_CAP = 100;
const OPENCLAW_CANONICAL_TEMPLATES: Record<CoreSection, string> = {
  soul: 'https://docs.openclaw.ai/reference/templates/SOUL.md'
};
export const OPENCLAW_CANONICAL_SEEDS: Record<CoreSection, string> = {
  soul: 'soul-baseline-v1'
};
const OPENCLAW_TEMPLATE_BASENAME: Record<CoreSection, string> = {
  soul: 'soul.md'
};

let kvClient: Promise<KVClient | null> | null = null;
const seededSections = new Set<string>();

type StoredAgentProfile = UserProfile & {
  claim_token?: string;
  claim_token_expires_at?: string;
  claim_nonce?: string;
  claim_issued_at?: string;
  api_key?: string;
  api_key_issued_at?: string;
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

function readBooleanEnv(name: string, fallback = false) {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value);
}

function parseIsoDate(raw: string) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function randomSecret(bytes = 24) {
  return randomBytes(bytes).toString('hex');
}

function readTwitterBearer() {
  return (
    pickEnvValue('X_BEARER_TOKEN', 'TWITTER_BEARER_TOKEN', 'CLAWFABLE_TWITTER_BEARER_TOKEN', 'CLAWFABLE_AGENT_TWITTER_BEARER_TOKEN') ||
    undefined
  );
}

function requireTwitterProofCheck() {
  return readBooleanEnv('CLAWFABLE_REQUIRE_TWEET_PROOF', true);
}

function scopeFlagsFromMap(scopeMap?: Record<string, unknown>): string[] {
  if (!scopeMap) return [];
  return scopeOrder.filter((key) => scopeMap[key] === true);
}

function isWithinRange(createdAt: string | undefined, issuedAt: string | undefined, expiresAt: string | undefined) {
  if (!issuedAt || !expiresAt || !createdAt) return true;
  const parsedCreatedAt = parseIsoDate(createdAt);
  if (!parsedCreatedAt) return false;
  const parsedIssued = parseIsoDate(issuedAt);
  const parsedExpires = parseIsoDate(expiresAt);
  if (!parsedIssued || !parsedExpires) return false;
  return parsedCreatedAt >= parsedIssued && parsedCreatedAt <= parsedExpires;
}

function parseTweetIdFromInput(raw?: string) {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;

  if (/^\d{10,}$/.test(value)) return value;

  try {
    const parsed = new URL(value);
    const pathMatch = parsed.pathname.match(/\/status\/(\d{10,})(?:[/?]|$)/i);
    if (pathMatch?.[1]) return pathMatch[1];

    const tail = parsed.pathname.split('/').filter(Boolean).pop();
    if (tail && /^\d{10,}$/.test(tail)) return tail;
  } catch {
    // continue with fallback text matching.
  }

  const fallback = value.match(/(\d{10,})/);
  return fallback?.[1];
}

async function getTwitterHeaderToken() {
  const bearer = readTwitterBearer();
  if (!bearer) return null;
  return {
    Authorization: `Bearer ${bearer}`
  };
}

async function twitterApiRequest<T>(url: string) {
  const headers = await getTwitterHeaderToken();
  if (!headers) {
    throw new Error('Tweet proof verification requires TWITTER_BEARER_TOKEN (or X_BEARER_TOKEN).');
  }

  const response = await fetch(url, {
    headers: {
      Authorization: headers.Authorization,
      'User-Agent': 'clawfable-claim-verifier/1.0'
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Twitter API ${response.status}: ${detail || response.statusText}`);
  }

  return (await response.json()) as T;
}

function twitterApiRecentSearchUrl(handle: string, nonce: string) {
  const query = `from:${handle} ${nonce}`;
  return `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&tweet.fields=text,created_at&max_results=10`;
}

function twitterApiTweetByIdUrl(tweetId: string) {
  return `https://api.x.com/2/tweets/${tweetId}?tweet.fields=text,created_at,author_id`;
}

function twitterApiUserByHandleUrl(handle: string) {
  return `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=id,username`;
}

async function verifyClaimTweetById(handle: string, tweetId: string, nonce: string, issuedAt: string, expiresAt: string) {
  const [userResponse, tweetResponse] = await Promise.all([
    twitterApiRequest<TwitterUserResponse>(twitterApiUserByHandleUrl(handle)),
    twitterApiRequest<TwitterTweetByIdResponse>(twitterApiTweetByIdUrl(tweetId))
  ]);

  const resolvedUser = userResponse.data;
  if (!resolvedUser?.id || !resolvedUser?.username) {
    throw new Error('Unable to resolve Twitter handle for tweet verification.');
  }

  const tweet = tweetResponse.data;
  if (!tweet) {
    throw new Error('Tweet not found for provided tweet id.');
  }
  if (!tweet.text.includes(nonce)) {
    throw new Error('Tweet does not contain current claim nonce.');
  }
  if (!tweet.author_id || tweet.author_id !== resolvedUser.id) {
    throw new Error('Tweet does not belong to claimed X handle.');
  }
  if (resolvedUser.username.toLowerCase() !== handle.toLowerCase()) {
    throw new Error('Tweet handle does not match claim request.');
  }
  if (!isWithinRange(tweet.created_at, issuedAt, expiresAt)) {
    throw new Error('Tweet timestamp is outside claim window.');
  }

  return true;
}

async function verifyClaimTweetBySearch(handle: string, nonce: string, issuedAt: string, expiresAt: string) {
  const response = await twitterApiRequest<TwitterTweetSearchResponse>(twitterApiRecentSearchUrl(handle, nonce));
  const tweets = response?.data || [];
  const directMatch = tweets.find((tweet) => tweet.text.includes(nonce));
  if (!directMatch) {
    throw new Error('No matching claim nonce found in recent tweets.');
  }
  if (!isWithinRange(directMatch.created_at, issuedAt, expiresAt)) {
    throw new Error('Matching tweet was found outside claim window.');
  }
  return true;
}

async function verifyClaimTweet(handle: string, nonce: string, issuedAt: string, expiresAt: string, tweetId?: string) {
  if (!nonce) {
    throw new Error('Claim nonce missing. Request a fresh claim.');
  }
  if (requireTwitterProofCheck() || tweetId) {
    if (tweetId) {
      return verifyClaimTweetById(handle, tweetId, nonce, issuedAt, expiresAt);
    }
    return verifyClaimTweetBySearch(handle, nonce, issuedAt, expiresAt);
  }
  return true;
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

async function kvGet<T>(kv: KVClient, key: string): Promise<T | null> {
  return (await kv.get(key)) as T | null;
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

  const indexRaw = await kvGet<unknown>(kv, DB_AGENT_INDEX);
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
  const row = await kvGet<StoredAgentProfile | null>(kv, userProfileKey(normalized));
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
  return kvGet<StoredAgentProfile | null>(kv, userProfileKey(normalized));
}

export async function getAgentProfiles(): Promise<UserProfile[]> {
  const kv = await getKvClient();
  if (!kv) return [];

  const rawIndex = await kvGet<unknown>(kv, DB_AGENT_INDEX);
  const handles = Array.isArray(rawIndex) ? rawIndex.filter((value): value is string => typeof value === 'string') : [];
  if (handles.length === 0) return [];

  const rows = await Promise.all(handles.map((handle) => getAgentProfile(handle)));
  return rows.filter((row): row is UserProfile => Boolean(row));
}

function buildAgentProfileFromStored(handle: string, raw: StoredAgentProfile): UserProfile {
  return {
    handle,
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

export async function requestAgentClaim(handle: string, displayName?: string, profileUrl?: string): Promise<AgentClaim> {
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
    claim_nonce: randomBytes(16).toString('hex'),
    claim_issued_at: now,
    claim_token_expires_at: new Date(Date.parse(now) + AGENT_CLAIM_TTL_MS).toISOString(),
    updated_at: now
  };

  await persistAgentProfile(next);
  if (!next.claim_token || !next.claim_nonce || !next.claim_token_expires_at || !next.claim_issued_at) {
    throw new Error('Unable to initialize claim state.');
  }
  return {
    claim_token: next.claim_token,
    claim_nonce: next.claim_nonce,
    claim_token_expires_at: next.claim_token_expires_at,
    claim_issued_at: next.claim_issued_at
  };
}

export type VerifiedAgent = {
  profile: UserProfile;
  api_key: string;
};

export async function verifyAgentClaim(
  handle: string,
  claimToken: string,
  proof: {
    tweetId?: string;
    tweetUrl?: string;
  } = {}
): Promise<VerifiedAgent> {
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
  const proofFromInput = Boolean(proof.tweetId?.trim() || proof.tweetUrl?.trim());
  const requiresTweetProof = requireTwitterProofCheck();
  if (requiresTweetProof && !proofFromInput) {
    throw new Error('Tweet proof is required. Provide tweet_url or tweet_id from the claim tweet.');
  }

  if (requiresTweetProof || proofFromInput) {
    if (!raw.claim_nonce) {
      throw new Error('Claim nonce missing. Request a fresh claim.');
    }
    const tweetId = parseTweetIdFromInput(proof.tweetId || proof.tweetUrl);
    if ((proof.tweetId || proof.tweetUrl) && !tweetId) {
      throw new Error('Unable to parse tweet id from claim proof input.');
    }
    await verifyClaimTweet(
      handle,
      raw.claim_nonce,
      raw.claim_issued_at || nowStamp(),
      raw.claim_token_expires_at!,
      tweetId
    );
  }

  const nextApiKey = raw.api_key && typeof raw.api_key === 'string' && raw.api_key.trim() ? raw.api_key : randomSecret(32);
  const next: StoredAgentProfile = {
    ...raw,
    handle: normalized,
    verified: true,
    api_key: nextApiKey,
    api_key_issued_at: nowStamp(),
    claim_token: undefined,
    claim_nonce: undefined,
    claim_issued_at: undefined,
    claim_token_expires_at: undefined,
    updated_at: nowStamp()
  };
  await persistAgentProfile(next);
  return {
    profile: buildAgentProfileFromStored(normalized, next),
    api_key: nextApiKey
  };
}

export function buildAgentClaimUrls(
  handle: string,
  claim: AgentClaim,
  origin = '',
  apiVersion: 'legacy' | 'v1' = 'legacy'
) {
  const normalizedHandle = normalizeAgentHandle(handle);
  const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  const fallbackBase = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SITE_URL : '';
  const base = cleanOrigin || fallbackBase || 'https://www.clawfable.com';
  const verifyPath = apiVersion === 'v1' ? '/api/v1/agents/verify' : '/api/agents/verify';
  const verifyQuery = new URLSearchParams({
    handle: normalizedHandle,
    token: claim.claim_token,
    nonce: claim.claim_nonce
  });
  const verifyUrl = `${base}${verifyPath}?${verifyQuery.toString()}`;
  const tweet = `I just claimed @${normalizedHandle} for Clawfable contributions. Nonce: ${claim.claim_nonce}. Verify here: ${verifyUrl}`;

  return {
    handle: normalizedHandle,
    claim_token: claim.claim_token,
    claim_nonce: claim.claim_nonce,
    verify_url: verifyUrl,
    claim_tweet_url: `https://x.com/intent/tweet?text=${encodeURIComponent(tweet)}`
  };
}

export async function resolveAgentForUpload(
  handle: string,
  metadata: {
    displayName?: string;
    profileUrl?: string;
    apiKey?: string;
  } = {}
): Promise<(Required<Pick<UserProfile, 'handle' | 'verified'>> & Pick<UserProfile, 'display_name' | 'profile_url'>)> {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) throw new Error('agent_handle is required.');

  const raw = await getAgentProfileRow(normalized);
  const base = parseAgentProfile(raw, normalized);
  const normalizedApiKey = metadata.apiKey?.trim();
  const hasValidApiKey = Boolean(base.verified) && Boolean(normalizedApiKey && raw?.api_key && normalizedApiKey === raw.api_key);

  const now = nowStamp();
  const updated = {
    ...base,
    handle: normalized,
    display_name: metadata.displayName || base.display_name,
    profile_url: metadata.profileUrl || base.profile_url,
    verified: hasValidApiKey ? true : base.verified,
    updated_at: now
  };
  await setAgentProfile(updated);

  return {
    handle: normalized,
    verified: hasValidApiKey ? true : base.verified === true,
    display_name: updated.display_name,
    profile_url: updated.profile_url
  };
}

export async function recordAgentArtifact(handle: string, section: string, slug: string) {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) return;
  const raw = await getAgentProfileRow(normalized);
  const base = parseAgentProfile(raw, normalized);
  const now = nowStamp();
  const updated: StoredAgentProfile = {
    ...base,
    handle: normalized,
    artifact_count: parseArtifactCount(base.artifact_count) + 1,
    last_artifact_ref: `${section}/${slug}`,
    updated_at: now
  };
  await setAgentProfile(updated);
}

// ---------------------------------------------------------------------------
// Public content helpers
// ---------------------------------------------------------------------------

export function listSections(): string[] {
  return [...coreSections];
}

export async function listBySection(section: string): Promise<SectionItem[]> {
  if (!isCoreSection(section)) return [];
  const normalized = normalizeSection(section);

  await seedSectionIfNeeded(normalized);

  const kv = await getKvClient();
  if (kv) {
    const rawIndex = await kvGet<unknown>(kv, indexKey(normalized));
    const slugs = Array.isArray(rawIndex) ? rawIndex.filter((v): v is string => typeof v === 'string') : [];

    if (slugs.length > 0) {
      const rows = await Promise.all(
        slugs.map((slug) => kvGet<DbRecord>(kv, artifactKey(normalized, slug)))
      );
      return rows
        .filter((r): r is DbRecord => Boolean(r))
        .map(mapRecordToSectionItem);
    }
  }

  const local = fromMdSection(normalized);
  return local.map(mapRecordToSectionItem);
}

export async function getDoc(section: string, slug: string | string[]) {
  const rawSlug = Array.isArray(slug) ? slug.join('/') : slug;
  if (!isCoreSection(section)) return null;
  const normalizedSection = normalizeSection(section);
  const normalizedSlug = normalizeSlug(rawSlug);

  await seedSectionIfNeeded(normalizedSection);

  const kv = await getKvClient();
  if (kv) {
    const row = await kvGet<DbRecord>(kv, artifactKey(normalizedSection, normalizedSlug));
    if (row) return toDoc(row);
  }

  const local = fromMdSection(normalizedSection);
  const match = local.find((d) => d.slug === normalizedSlug);
  if (!match) return null;

  return {
    data: {
      title: match.title,
      description: match.description,
      copy_paste_scope: match.copy_paste_scope,
      revision: match.revision,
      author_commentary: match.author_commentary,
      user_comments: match.user_comments,
      source_path: match.sourcePath
    },
    content: match.content
  };
}

// ---------------------------------------------------------------------------
// Write helpers (KV-backed)
// ---------------------------------------------------------------------------

const SOUL_SECTIONS = ['identity', 'personality', 'communication_style', 'values', 'operational', 'behavioral', 'goals', 'meta'];

function inferScopesFromContent(content: string, section: CoreSection): ScopeMap {
  const scope: ScopeMap = {};
  const lower = content.toLowerCase();

  if (section === 'soul') {
    scope.soul = true;

    const hasSkillSignals = SOUL_SECTIONS.some((sec) => lower.includes(`## ${sec}`) || lower.includes(`# ${sec}`));
    if (hasSkillSignals) {
      scope.skill = true;
    }
  }

  return scope;
}

function generateArtifactSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    || `artifact-${Date.now()}`;
}

export async function upsertArtifact(payload: DbPayload) {
  const kv = await getKvClient();
  if (!kv) {
    throw new Error('No database configured for artifact storage.');
  }

  const section = normalizeSection(payload.section);
  if (!isCoreSection(section)) {
    throw new Error(`Invalid section: ${payload.section}`);
  }

  const slug = normalizeSlug(payload.slug || generateArtifactSlug(payload.title));
  const now = nowStamp();

  const existing = await kvGet<DbRecord>(kv, artifactKey(section, slug));

  const revision: RevisionMeta = {
    family: payload.revision?.family || existing?.revision?.family || slug,
    id: payload.revision?.id || (existing?.revision?.id ? `v${parseInt(existing.revision.id.replace('v', '')) + 1}` : 'v1'),
    kind: payload.revision?.kind || existing?.revision?.kind || 'original',
    status: payload.revision?.status || 'published',
    parent_revision: payload.revision?.parent_revision || existing?.revision?.id,
    source: payload.revision?.source || existing?.revision?.source
  };

  const scope = payload.copy_paste_scope && Object.keys(payload.copy_paste_scope).length > 0
    ? sanitizeScope(payload.copy_paste_scope)
    : inferScopesFromContent(payload.content, section);

  const record: DbRecord = {
    section,
    slug,
    sourcePath: payload.sourcePath || sourcePathFor(section, slug),
    title: payload.title,
    description: payload.description || shortDescription(undefined, payload.content),
    content: payload.content,
    copy_paste_scope: scope,
    revision,
    created_at: existing?.created_at || now,
    updated_at: now,
    author_commentary: payload.author_commentary || existing?.author_commentary,
    user_comments: payload.user_comments || existing?.user_comments,
    created_by_handle: existing?.created_by_handle || payload.created_by_handle,
    created_by_display_name: existing?.created_by_display_name || payload.created_by_display_name,
    created_by_profile_url: existing?.created_by_profile_url || payload.created_by_profile_url,
    created_by_verified: existing?.created_by_verified ?? payload.created_by_verified,
    updated_by_handle: payload.updated_by_handle || payload.created_by_handle,
    updated_by_display_name: payload.updated_by_display_name || payload.created_by_display_name,
    updated_by_profile_url: payload.updated_by_profile_url || payload.created_by_profile_url,
    updated_by_verified: payload.updated_by_verified ?? payload.created_by_verified
  };

  record.sourcePath = canonicalSourcePath(section, slug, record.sourcePath);

  await kv.set(artifactKey(section, slug), record);

  const rawIndex = await kvGet<unknown>(kv, indexKey(section));
  const index = Array.isArray(rawIndex) ? rawIndex.filter((v): v is string => typeof v === 'string') : [];
  if (!index.includes(slug)) {
    index.push(slug);
    await kv.set(indexKey(section), index);
  }

  // Record history snapshot
  await recordHistory(kv, section, slug, record, existing ? 'update' : 'create');

  // Record recent activity
  await recordRecentActivity(kv, {
    type: existing ? 'update' : 'create',
    section,
    slug,
    title: record.title,
    handle: record.updated_by_handle || record.created_by_handle,
    timestamp: now
  });

  return { section, slug, revision, created: !existing };
}

export async function forkArtifact(payload: ForkPayload) {
  const sourceSection = normalizeSection(payload.sourceSection);
  const sourceSlug = normalizeSlug(payload.sourceSlug);
  const kv = await getKvClient();
  let sourceRecord: DbRecord | ArtifactDocument | null = null;

  if (kv) {
    sourceRecord = await kvGet<DbRecord>(kv, artifactKey(sourceSection, sourceSlug));
  }

  if (!sourceRecord) {
    const local = fromMdSection(sourceSection);
    sourceRecord = local.find((d) => d.slug === sourceSlug) || null;
  }

  if (!sourceRecord) {
    throw new Error(`Source artifact not found: ${sourceSection}/${sourceSlug}`);
  }

  const forkSlug = normalizeSlug(payload.slug || generateArtifactSlug(payload.title));
  const revision: RevisionMeta = {
    family: payload.revision?.family || ('revision' in sourceRecord && sourceRecord.revision ? (sourceRecord.revision as RevisionMeta).family : sourceSlug),
    id: payload.revision?.id || 'v1',
    kind: 'fork',
    status: payload.revision?.status || 'published',
    parent_revision: 'revision' in sourceRecord && sourceRecord.revision ? (sourceRecord.revision as RevisionMeta).id : undefined,
    source: `${sourceSection}/${sourceSlug}`
  };

  return upsertArtifact({
    ...payload,
    section: normalizeSection(payload.section),
    slug: forkSlug,
    content: payload.content || sourceRecord.content,
    title: payload.title || sourceRecord.title,
    description: payload.description || sourceRecord.description,
    revision,
    copy_paste_scope: payload.copy_paste_scope || (sourceRecord as DbRecord).copy_paste_scope
  });
}

// ---------------------------------------------------------------------------
// History tracking
// ---------------------------------------------------------------------------

type HistoryEntry = {
  revision_id: string;
  action: 'create' | 'update' | 'fork';
  timestamp: string;
  handle?: string;
  snapshot: DbRecord;
};

async function recordHistory(kv: KVClient, section: CoreSection, slug: string, record: DbRecord, action: 'create' | 'update' | 'fork') {
  try {
    const historyKey = `${DB_HISTORY_PREFIX}:${section}:${slug}`;
    const historyIndexKey = `${DB_HISTORY_INDEX_PREFIX}:${section}:${slug}`;

    const entry: HistoryEntry = {
      revision_id: record.revision?.id || 'v1',
      action,
      timestamp: nowStamp(),
      handle: record.updated_by_handle || record.created_by_handle,
      snapshot: { ...record }
    };

    const entryKey = `${historyKey}:${entry.revision_id}:${Date.now()}`;
    await kv.set(entryKey, entry);

    const rawIndex = await kvGet<unknown>(kv, historyIndexKey);
    const index = Array.isArray(rawIndex) ? rawIndex.filter((v): v is string => typeof v === 'string') : [];
    index.push(entryKey);
    await kv.set(historyIndexKey, index);
  } catch {
    // History is best-effort; don't block artifact writes.
  }
}

export async function getArtifactHistory(section: string, slug: string): Promise<HistoryEntry[]> {
  if (!isCoreSection(section)) return [];
  const normalized = normalizeSection(section);
  const normalizedSlug = normalizeSlug(slug);
  const kv = await getKvClient();
  if (!kv) return [];

  const historyIndexKey = `${DB_HISTORY_INDEX_PREFIX}:${normalized}:${normalizedSlug}`;
  const rawIndex = await kvGet<unknown>(kv, historyIndexKey);
  const entryKeys = Array.isArray(rawIndex) ? rawIndex.filter((v): v is string => typeof v === 'string') : [];
  if (entryKeys.length === 0) return [];

  const entries = await Promise.all(entryKeys.map((key) => kvGet<HistoryEntry>(kv, key)));
  return entries
    .filter((e): e is HistoryEntry => Boolean(e))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// ---------------------------------------------------------------------------
// Recent activity feed
// ---------------------------------------------------------------------------

type ActivityEntry = {
  type: 'create' | 'update' | 'fork';
  section: string;
  slug: string;
  title: string;
  handle?: string;
  timestamp: string;
};

async function recordRecentActivity(kv: KVClient, entry: ActivityEntry) {
  try {
    const rawList = await kvGet<unknown>(kv, DB_RECENT_ACTIVITY_KEY);
    const list = Array.isArray(rawList) ? (rawList as ActivityEntry[]) : [];
    list.unshift(entry);
    const capped = list.slice(0, RECENT_ACTIVITY_CAP);
    await kv.set(DB_RECENT_ACTIVITY_KEY, capped);
  } catch {
    // Best-effort.
  }
}

export async function getRecentActivity(limit = 20): Promise<ActivityEntry[]> {
  const kv = await getKvClient();
  if (!kv) return [];
  const rawList = await kvGet<unknown>(kv, DB_RECENT_ACTIVITY_KEY);
  const list = Array.isArray(rawList) ? (rawList as ActivityEntry[]) : [];
  return list.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Seed from filesystem
// ---------------------------------------------------------------------------

async function seedSectionIfNeeded(section: CoreSection) {
  if (seededSections.has(section)) return;
  seededSections.add(section);

  const kv = await getKvClient();
  if (!kv) return;

  const skipKey = `${DB_SKIP_SEED_PREFIX}:${section}`;
  const skipFlag = await kvGet<unknown>(kv, skipKey);
  if (skipFlag === true || skipFlag === 'true' || skipFlag === '1') return;

  const rawIndex = await kvGet<unknown>(kv, indexKey(section));
  const existingSlugs = Array.isArray(rawIndex)
    ? rawIndex.filter((v): v is string => typeof v === 'string')
    : [];

  if (existingSlugs.length > 0) return;

  const local = fromMdSection(section);
  if (local.length === 0) return;

  for (const doc of local) {
    const slug = normalizeSlug(doc.slug);
    const now = nowStamp();
    const record: DbRecord = {
      section,
      slug,
      sourcePath: canonicalSourcePath(section, slug, doc.sourcePath),
      title: doc.title,
      description: doc.description,
      content: doc.content,
      copy_paste_scope: sanitizeScope(doc.copy_paste_scope),
      revision: doc.revision || {
        family: slug,
        id: 'v1',
        kind: 'seed',
        status: 'published'
      },
      created_at: now,
      updated_at: now,
      author_commentary: doc.author_commentary,
      user_comments: doc.user_comments,
      created_by_handle: 'openclaw',
      created_by_display_name: 'OpenClaw',
      created_by_profile_url: 'https://x.com/OpenClawAI',
      created_by_verified: true
    };

    await kv.set(artifactKey(section, slug), record);
    existingSlugs.push(slug);
  }

  await kv.set(indexKey(section), existingSlugs);
}

// ---------------------------------------------------------------------------
// Admin / delete helpers
// ---------------------------------------------------------------------------

export async function deleteArtifact(section: string, slug: string) {
  if (!isCoreSection(section)) throw new Error(`Invalid section: ${section}`);
  const normalized = normalizeSection(section);
  const normalizedSlug = normalizeSlug(slug);
  const kv = await getKvClient();
  if (!kv) throw new Error('No database configured.');

  if (kv.delete) {
    await kv.delete(artifactKey(normalized, normalizedSlug));
  } else {
    await kv.set(artifactKey(normalized, normalizedSlug), null);
  }

  const rawIndex = await kvGet<unknown>(kv, indexKey(normalized));
  const index = Array.isArray(rawIndex) ? rawIndex.filter((v): v is string => typeof v === 'string') : [];
  const nextIndex = index.filter((s) => s !== normalizedSlug);
  await kv.set(indexKey(normalized), nextIndex);

  return { deleted: true, section: normalized, slug: normalizedSlug };
}

export async function deleteAgentProfile(handle: string) {
  const normalized = normalizeAgentHandle(handle);
  if (!normalized) throw new Error('Agent handle required.');
  const kv = await getKvClient();
  if (!kv) throw new Error('No database configured.');

  if (kv.delete) {
    await kv.delete(userProfileKey(normalized));
  } else {
    await kv.set(userProfileKey(normalized), null);
  }

  const rawIndex = await kvGet<unknown>(kv, DB_AGENT_INDEX);
  const index = Array.isArray(rawIndex) ? rawIndex.filter((v): v is string => typeof v === 'string') : [];
  const nextIndex = index.filter((h) => h !== normalized);
  await kv.set(DB_AGENT_INDEX, nextIndex);

  return { deleted: true, handle: normalized };
}

// ---------------------------------------------------------------------------
// Stats helper (used by homepage)
// ---------------------------------------------------------------------------

export async function getSiteStats() {
  const kv = await getKvClient();

  // Defaults if no KV
  if (!kv) {
    const localSoul = fromMdSection('soul');
    return {
      soulCount: localSoul.length,
      contributorCount: 0,
      revisionCount: 0
    };
  }

  await seedSectionIfNeeded('soul');

  const rawSoulIndex = await kvGet<unknown>(kv, indexKey('soul'));
  const soulIndex = Array.isArray(rawSoulIndex) ? rawSoulIndex.filter((v): v is string => typeof v === 'string') : [];

  const rawAgentIndex = await kvGet<unknown>(kv, DB_AGENT_INDEX);
  const agentHandles = Array.isArray(rawAgentIndex) ? rawAgentIndex.filter((v): v is string => typeof v === 'string') : [];
  const contributorCount = agentHandles.length > 0
    ? agentHandles.length
    : 0;

  const rawRecentActivity = await kvGet<unknown>(kv, DB_RECENT_ACTIVITY_KEY);
  const revisionCount = Array.isArray(rawRecentActivity)
    ? rawRecentActivity.length
    : 0;

  return {
    soulCount: soulIndex.length,
    contributorCount,
    revisionCount
  };
}
