import { kv } from '@vercel/kv';

export type CoreSection = 'soul' | 'memory';

export type Doc = {
  title: string;
  summary?: string;
  date?: string;
  slug: string;
  [key: string]: unknown;
};

/**
 * A single point-in-time snapshot of an artifact, stored in revision history.
 */
export type HistoryEntry = {
  /** ISO-8601 timestamp when this revision was recorded */
  timestamp: string;
  /** Optional short description of what changed */
  changeNote?: string;
  /** Optional commit hash from the upstream repo, if applicable */
  commitHash?: string;
  /** Full snapshot of the artifact fields at this point in time */
  snapshot?: Record<string, unknown>;
};

/**
 * A node in the lineage graph.
 */
export type LineageNode = {
  /** KV key (e.g. "soul:my-artifact") */
  key: string;
  /** Human-readable title, if available */
  title?: string;
  section?: CoreSection;
  slug?: string;
};

/**
 * Lineage result for a single artifact — its parents and children.
 */
export type LineageResult = {
  self: LineageNode;
  parents: LineageNode[];
  children: LineageNode[];
};

export function isCoreSection(s: string): s is CoreSection {
  return s === 'soul' || s === 'memory';
}

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

function docKey(section: CoreSection, slug: string | string[]): string {
  const slugStr = Array.isArray(slug) ? slug.join('/') : slug;
  return `${section}:${slugStr}`;
}

function historyKey(section: CoreSection, slug: string | string[]): string {
  const slugStr = Array.isArray(slug) ? slug.join('/') : slug;
  return `history:${section}:${slugStr}`;
}

function lineageParentsKey(key: string): string {
  return `lineage:parents:${key}`;
}

function lineageChildrenKey(key: string): string {
  return `lineage:children:${key}`;
}

// ---------------------------------------------------------------------------
// Doc CRUD
// ---------------------------------------------------------------------------

export async function getDoc(
  section: string,
  slug: string | string[]
): Promise<Doc | null> {
  if (!isCoreSection(section)) return null;
  const key = docKey(section, slug);
  const raw = await kv.get<Record<string, unknown>>(key);
  if (!raw) return null;
  return {
    ...raw,
    title: typeof raw.title === 'string' ? raw.title : key,
    slug: Array.isArray(slug) ? slug.join('/') : slug,
  };
}

export async function listDocs(section: CoreSection): Promise<Doc[]> {
  const pattern = `${section}:*`;
  // Exclude derived keys (history:, lineage:)
  let cursor = 0;
  const docs: Doc[] = [];
  do {
    const [nextCursor, keys] = await kv.scan(cursor, {
      match: pattern,
      count: 100,
    });
    cursor = Number(nextCursor);
    for (const key of keys) {
      // Skip history & lineage keys that match the section prefix by accident
      if (key.startsWith('history:') || key.startsWith('lineage:')) continue;
      const raw = await kv.get<Record<string, unknown>>(key);
      if (!raw) continue;
      const slug = key.slice(section.length + 1);
      docs.push({
        ...raw,
        title: typeof raw.title === 'string' ? raw.title : key,
        slug,
      });
    }
  } while (cursor !== 0);
  return docs;
}

export async function putDoc(
  section: CoreSection,
  slug: string | string[],
  data: Record<string, unknown>
): Promise<void> {
  const key = docKey(section, slug);
  await kv.set(key, data);
}

export async function deleteDoc(
  section: CoreSection,
  slug: string | string[]
): Promise<void> {
  const key = docKey(section, slug);
  await kv.del(key);
}

// ---------------------------------------------------------------------------
// Revision history
// ---------------------------------------------------------------------------

/**
 * Append a new HistoryEntry to an artifact's revision log.
 * The list is stored as a JSON array in KV, newest-first.
 */
export async function appendHistory(
  section: CoreSection,
  slug: string | string[],
  entry: HistoryEntry
): Promise<void> {
  const key = historyKey(section, slug);
  const existing = await kv.get<HistoryEntry[]>(key);
  const list: HistoryEntry[] = Array.isArray(existing) ? existing : [];
  list.unshift(entry); // prepend so index 0 = latest
  await kv.set(key, list);
}

/**
 * Retrieve all HistoryEntries for an artifact (newest-first).
 * Returns an empty array if no history exists.
 */
export async function getArtifactHistory(
  section: string,
  slug: string | string[]
): Promise<HistoryEntry[]> {
  if (!isCoreSection(section)) return [];
  const key = historyKey(section, slug);
  const raw = await kv.get<HistoryEntry[]>(key);
  return Array.isArray(raw) ? raw : [];
}

// ---------------------------------------------------------------------------
// Lineage / Provenance
// ---------------------------------------------------------------------------

/**
 * Link a child artifact to a parent (directional edge: parent → child).
 * Idempotent — calling twice with the same args is safe.
 */
export async function linkLineage(
  parentSection: CoreSection,
  parentSlug: string | string[],
  childSection: CoreSection,
  childSlug: string | string[]
): Promise<void> {
  const parentKey = docKey(parentSection, parentSlug);
  const childKey = docKey(childSection, childSlug);

  // Add childKey to parent's children set
  const existingChildren = await kv.get<string[]>(lineageChildrenKey(parentKey));
  const children = Array.isArray(existingChildren) ? existingChildren : [];
  if (!children.includes(childKey)) {
    children.push(childKey);
    await kv.set(lineageChildrenKey(parentKey), children);
  }

  // Add parentKey to child's parents set
  const existingParents = await kv.get<string[]>(lineageParentsKey(childKey));
  const parents = Array.isArray(existingParents) ? existingParents : [];
  if (!parents.includes(parentKey)) {
    parents.push(parentKey);
    await kv.set(lineageParentsKey(childKey), parents);
  }
}

/**
 * Resolve a list of artifact keys into LineageNode objects.
 * For each key, fetches the artifact title from KV if available.
 */
async function resolveNodes(keys: string[]): Promise<LineageNode[]> {
  return Promise.all(
    keys.map(async (key) => {
      const colonIdx = key.indexOf(':');
      if (colonIdx === -1) return { key };
      const section = key.slice(0, colonIdx) as CoreSection;
      const slug = key.slice(colonIdx + 1);
      if (!isCoreSection(section)) return { key };
      const raw = await kv.get<Record<string, unknown>>(key);
      return {
        key,
        section,
        slug,
        title: raw && typeof raw.title === 'string' ? raw.title : undefined,
      };
    })
  );
}

/**
 * Get the immediate lineage (parents + children) for an artifact.
 * Returns null if the artifact doesn't exist.
 */
export async function getArtifactLineage(
  section: string,
  slug: string | string[]
): Promise<LineageResult | null> {
  if (!isCoreSection(section)) return null;
  const key = docKey(section, slug);

  // Check artifact exists
  const doc = await kv.get(key);
  if (!doc) return null;

  const [rawParents, rawChildren] = await Promise.all([
    kv.get<string[]>(lineageParentsKey(key)),
    kv.get<string[]>(lineageChildrenKey(key)),
  ]);

  const [parents, children] = await Promise.all([
    resolveNodes(Array.isArray(rawParents) ? rawParents : []),
    resolveNodes(Array.isArray(rawChildren) ? rawChildren : []),
  ]);

  return {
    self: { key, section: section as CoreSection, slug: Array.isArray(slug) ? slug.join('/') : slug },
    parents,
    children,
  };
}

/**
 * Walk the full lineage graph (BFS) from a starting artifact.
 * Returns all reachable nodes and directed edges.
 * maxDepth prevents infinite loops in cyclic graphs.
 */
export async function walkLineageGraph(
  section: CoreSection,
  slug: string | string[],
  maxDepth = 5
): Promise<{ nodes: LineageNode[]; edges: Array<{ from: string; to: string }> }> {
  const startKey = docKey(section, slug);
  const visited = new Set<string>();
  const nodes: LineageNode[] = [];
  const edges: Array<{ from: string; to: string }> = [];

  async function visit(key: string, depth: number) {
    if (visited.has(key) || depth > maxDepth) return;
    visited.add(key);

    const colonIdx = key.indexOf(':');
    const sec = key.slice(0, colonIdx) as CoreSection;
    const sl = key.slice(colonIdx + 1);
    if (!isCoreSection(sec)) return;

    const raw = await kv.get<Record<string, unknown>>(key);
    nodes.push({
      key,
      section: sec,
      slug: sl,
      title: raw && typeof raw.title === 'string' ? raw.title : undefined,
    });

    const [rawParents, rawChildren] = await Promise.all([
      kv.get<string[]>(lineageParentsKey(key)),
      kv.get<string[]>(lineageChildrenKey(key)),
    ]);

    for (const pKey of Array.isArray(rawParents) ? rawParents : []) {
      edges.push({ from: pKey, to: key });
      await visit(pKey, depth + 1);
    }
    for (const cKey of Array.isArray(rawChildren) ? rawChildren : []) {
      edges.push({ from: key, to: cKey });
      await visit(cKey, depth + 1);
    }
  }

  await visit(startKey, 0);
  return { nodes, edges };
}

/**
 * List all lineage edges across all artifacts.
 * Scans for all lineage:children:* keys and returns the full edge list.
 * Useful for rendering a global lineage graph.
 */
export async function listAllLineageEdges(): Promise<Array<{ from: string; to: string }>> {
  const edges: Array<{ from: string; to: string }> = [];
  let cursor = 0;
  do {
    const [nextCursor, keys] = await kv.scan(cursor, {
      match: 'lineage:children:*',
      count: 100,
    });
    cursor = Number(nextCursor);
    for (const key of keys) {
      const fromKey = key.slice('lineage:children:'.length);
      const children = await kv.get<string[]>(key);
      if (Array.isArray(children)) {
        for (const toKey of children) {
          edges.push({ from: fromKey, to: toKey });
        }
      }
    }
  } while (cursor !== 0);
  return edges;
}

/**
 * Purge all lineage data for an artifact (both parents and children refs).
 * Does NOT clean up the reverse pointers in other artifacts.
 */
export async function deleteLineage(
  section: CoreSection,
  slug: string | string[]
): Promise<void> {
  const key = docKey(section, slug);
  await Promise.all([
    kv.del(lineageParentsKey(key)),
    kv.del(lineageChildrenKey(key)),
  ]);
}

// ---------------------------------------------------------------------------
// Convenience: write a new doc version and record it in history atomically
// ---------------------------------------------------------------------------

/**
 * Save a new version of an artifact and append a history entry in one call.
 * This is the preferred write path for any mutation that should be tracked.
 */
export async function putDocWithHistory(
  section: CoreSection,
  slug: string | string[],
  data: Record<string, unknown>,
  historyEntry?: Partial<HistoryEntry>
): Promise<void> {
  await putDoc(section, slug, data);
  await appendHistory(section, slug, {
    timestamp: new Date().toISOString(),
    snapshot: data,
    ...historyEntry,
  });
}

// ---------------------------------------------------------------------------
// Section index pages: list all artifacts with pagination
// ---------------------------------------------------------------------------

export type DocListItem = {
  slug: string;
  title: string;
  summary?: string;
  date?: string;
  section: CoreSection;
};

export async function listDocsPaginated(
  section: CoreSection,
  page = 1,
  pageSize = 20
): Promise<{ items: DocListItem[]; total: number; page: number; pageSize: number }> {
  const all = await listDocs(section);
  // Sort by date desc
  all.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
  const total = all.length;
  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize).map((d) => ({
    slug: d.slug,
    title: d.title,
    summary: d.summary,
    date: d.date,
    section,
  }));
  return { items, total, page, pageSize };
}
