import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

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

export type ArtifactDocument = {
  slug: string;
  sourcePath: string;
  title: string;
  description: string;
  content: string;
  copy_paste_scope: ScopeMap;
  revision: RevisionMeta | null;
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
};

type ForkPayload = DbPayload & {
  sourceSection: CoreSection;
  sourceSlug: string;
};

const CONTENT_ROOT = path.join(process.cwd(), 'content');
const scopeOrder = ['soul', 'memory', 'skill', 'user_files'];
const DB_ARTIFACT_INDEX_PREFIX = 'clawfable:db:index';
const DB_ARTIFACT_PREFIX = 'clawfable:db:artifact';

let kvClient: Promise<KVClient | null> | null = null;
const seededSections = new Set<string>();

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

function nowStamp() {
  return new Date().toISOString();
}

function sourcePathFor(section: CoreSection, slug: string) {
  return `${section}/${slug}.md`;
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
      source_path: row.sourcePath,
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
      process.env.CLAWFABLE_DATABASE_URL ||
      process.env.CLAWFABLE_KV_URL ||
      process.env.KV_URL ||
      process.env.KV_REST_API_URL;
    const directToken =
      process.env.CLAWFABLE_DATABASE_TOKEN ||
      process.env.CLAWFABLE_KV_TOKEN ||
      process.env.KV_TOKEN ||
      process.env.KV_REST_API_TOKEN;

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
  return {
    section,
    slug: normalizeSlug(raw.slug),
    sourcePath: raw.sourcePath || sourcePathFor(section, normalizeSlug(raw.slug)),
    title: raw.title || 'Clawfable artifact',
    description: raw.description || 'Clawfable artifact',
    content: raw.content || '',
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
      'No database configured. Set CLAWFABLE_DATABASE_URL + CLAWFABLE_DATABASE_TOKEN, CLAWFABLE_KV_URL + CLAWFABLE_KV_TOKEN, or KV_REST_API_URL + KV_REST_API_TOKEN.'
    );
  }

  const slug = normalizeSlug(payload.slug);
  const now = nowStamp();
  const existing = await getArtifact(section, slug);
  const revisionInput = payload.revision || {};
  const fallbackSection = revisionInput.family || section;

  const record: DbRecord = {
    section,
    slug,
    sourcePath: payload.sourcePath || sourcePathFor(section, slug),
    title: payload.title,
    description:
      payload.description?.trim() ||
      shortDescription({}, payload.content) ||
      `Clawfable ${section} artifact.`,
    content: payload.content,
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

  const fallback = fromMdSection(normalized);
  return fallback
    .map((row) => mapRecordToSectionItem({
      section: normalized,
      slug: row.slug,
      sourcePath: row.sourcePath,
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

  const fromDb = await getArtifact(normalizedSection, normalizedSlug);
  if (fromDb) {
    return toDoc(fromDb);
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
    sourcePath: `${normalizedSlug}.md`,
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
    revision
  };
}
