import Link from 'next/link';
import type { Metadata } from 'next';
import { getDoc, isCoreSection } from '../../../lib/content';
import { marked } from 'marked';

const sectionLabels: Record<string, string> = {
  soul: 'SOUL',
  memory: 'MEMORY'
};

type NormalizedComment = {
  body: string;
  author: string;
  date?: string;
};

function titleFromSlug(section: string, slugParts: string[]) {
  const slug = slugParts.join(' / ').replace(/-/g, ' ');
  return `${section.toUpperCase()}: ${slug}`;
}

function scopeRows(scopeMap: Record<string, unknown> | undefined) {
  if (!scopeMap) return [];
  return ['soul', 'memory', 'user_files', 'skill']
    .filter((k) => scopeMap[k] === true)
    .map((k) => k.toUpperCase());
}

function revisionLine(revision: Record<string, unknown> | undefined) {
  if (!revision || typeof revision !== 'object') return null;
  const id = String((revision as Record<string, unknown>).id || 'unversioned');
  const kind = String((revision as Record<string, unknown>).kind || 'revision');
  const status = String((revision as Record<string, unknown>).status || 'draft');
  return `${kind} · ${id} · ${status}`;
}

function isCanonicalSource(value: string) {
  return value.startsWith('http://') || value.startsWith('https://');
}

function readableDate(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

function seedSourceOverride(section: string, sourcePath: string, slug: string) {
  if (section !== 'soul' && section !== 'memory') return undefined;
  const normalizedSlug = slug.toLowerCase();
  const file = sourcePath.toLowerCase();
  const overrides: Record<string, string> = {
    soul: 'https://docs.openclaw.ai/reference/templates/SOUL.md',
    memory: 'https://docs.openclaw.ai/reference/templates/MEMORY.md'
  };

  if (normalizedSlug === 'soul-baseline-v1' || normalizedSlug === 'memory-baseline-v1') {
    return overrides[section];
  }

  if (section === 'soul' && (file === 'soul.md' || file.endsWith('/soul.md'))) {
    return overrides.soul;
  }

  if (section === 'memory' && (file === 'memory.md' || file.endsWith('/memory.md'))) {
    return overrides.memory;
  }

  if (isCanonicalSource(sourcePath)) return sourcePath;
  return undefined;
}

function normalizeCommentText(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return trimmed || null;
  }

  if (typeof entry === 'object' && entry !== null) {
    const record = entry as Record<string, unknown>;
    const candidate =
      typeof record.body === 'string'
        ? record.body
        : typeof record.text === 'string'
          ? record.text
          : typeof record.comment === 'string'
            ? record.comment
            : typeof record.message === 'string'
              ? record.message
              : null;
    return candidate ? String(candidate).trim() : null;
  }

  return null;
}

function normalizeCommentAuthor(entry: unknown): string | null {
  if (typeof entry === 'object' && entry !== null) {
    const record = entry as Record<string, unknown>;
    const candidate =
      typeof record.author === 'string'
        ? record.author
        : typeof record.user === 'string'
          ? record.user
          : typeof record.username === 'string'
            ? record.username
            : null;
    return candidate ? String(candidate).trim() : null;
  }

  return null;
}

function normalizeCommentDate(entry: unknown): string | null {
  if (typeof entry === 'object' && entry !== null) {
    const record = entry as Record<string, unknown>;
    const candidate =
      typeof record.created_at === 'string'
        ? record.created_at
        : typeof record.createdAt === 'string'
          ? record.createdAt
          : typeof record.date === 'string'
            ? record.date
            : typeof record.at === 'string'
              ? record.at
              : null;
    return candidate ? String(candidate).trim() : null;
  }

  return null;
}

function normalizeUserComments(raw: unknown): NormalizedComment[] {
  if (!raw) return [];

  const comments: NormalizedComment[] = [];
  const values = Array.isArray(raw) ? raw : [raw];

  for (const entry of values) {
    if (Array.isArray(entry)) {
      comments.push(...normalizeUserComments(entry));
      continue;
    }

    const body = normalizeCommentText(entry);
    if (!body) continue;

    const author = normalizeCommentAuthor(entry);
    const date = normalizeCommentDate(entry);
    const safeDate = date ? date.slice(0, 10) : undefined;

    comments.push({
      body,
      author: author || 'Community',
      date: safeDate
    });
  }

  return comments;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ section: string; slug: string[] }>;
}): Promise<Metadata> {
  const { section, slug } = await params;
  const normalizedSection = section.toLowerCase();

  if (!isCoreSection(normalizedSection)) {
    return {
      title: 'Unsupported section | Clawfable',
      description: 'Only SOUL and MEMORY are available in this Clawfable instance.'
    };
  }

  const doc = await getDoc(normalizedSection, slug);
  const label = sectionLabels[normalizedSection] || normalizedSection;
  const title =
    (doc?.data as Record<string, unknown> | undefined)?.title?.toString() ||
    titleFromSlug(normalizedSection, slug);

  const description =
    (doc?.data as Record<string, unknown> | undefined)?.description?.toString() ||
    `Trusted ${label} article in Clawfable.`;

  return { title: `${title} | ${label}`, description };
}

export default async function DocPage({
  params
}: {
  params: Promise<{ section: string; slug: string[] }>;
}) {
  const { section, slug } = await params;
  const normalizedSection = section.toLowerCase();

  if (!isCoreSection(normalizedSection)) {
    return (
      <div className="panel">
        <h1>Unsupported section</h1>
        <p>This deployment only hosts SOUL and MEMORY documents.</p>
        <Link href="/">Return home</Link>
      </div>
    );
  }

  const slugPath = normalizeSlug(slug.join('/'));
  const doc = await getDoc(normalizedSection, slug);
  if (!doc) {
    return (
      <div className="panel">
        <h1>Artifact not found</h1>
        <p>No matching artifact exists for this path.</p>
        <Link href={`/section/${normalizedSection}`}>Back to {sectionLabels[normalizedSection]} index</Link>
      </div>
    );
  }

  const label = sectionLabels[normalizedSection] || normalizedSection;
  const title = (doc.data as Record<string, unknown>)?.title?.toString() || titleFromSlug(normalizedSection, slug);
  const rawScopes = scopeRows((doc.data as Record<string, unknown> | undefined)?.copy_paste_scope as
    | Record<string, unknown>
    | undefined);
  const revision = revisionLine((doc.data as Record<string, unknown> | undefined)?.revision as
    | Record<string, unknown>
    | undefined);
  const createdAt = readableDate((doc.data as Record<string, unknown>)?.created_at as string);
  const sourcePath = String((doc.data as Record<string, unknown>)?.source_path || `${normalizedSection}/${slugPath}`);
  const canonicalSource = seedSourceOverride(normalizedSection, sourcePath, slugPath);
  const authorCommentary = String((doc.data as Record<string, unknown>)?.author_commentary || '').trim();
  const userComments = normalizeUserComments((doc.data as Record<string, unknown>)?.user_comments);
  const html = await marked.parse(doc.content);

  return (
    <article className="panel doc-shell">
      <p className="kicker">Artifact view</p>
      <h1>{title}</h1>
      <div className="doc-meta-grid">
        <p>
          <span className="doc-meta-label">Section</span> {label}
        </p>
        <p>
          <span className="doc-meta-label">Copy scope</span> {rawScopes.length > 0 ? rawScopes.join(' · ') : 'Not set'}
        </p>
        <p>
          <span className="doc-meta-label">Revision lineage</span> {revision || 'unversioned'}
        </p>
        <p>
          <span className="doc-meta-label">Created</span> {createdAt}
        </p>
        {canonicalSource ? (
          <p>
            <span className="doc-meta-label">Source</span>
            <a href={canonicalSource} target="_blank" rel="noopener noreferrer">
              openclaw canonical source
            </a>
          </p>
        ) : null}
        <p>
          <span className="doc-meta-label">Back</span>
          <Link href={`/section/${normalizedSection}`}>{label} index</Link>
        </p>
      </div>

      <div className="reuse-grid" style={{ marginTop: '0.75rem' }}>
        <article className="panel-mini">
          <p className="tag">Revise</p>
          <p>Create a revision with inherited lineage.</p>
          <Link href={`/upload?mode=revise&section=${normalizedSection}&slug=${encodeURIComponent(sourcePath)}`}>Revise {title}</Link>
        </article>
        <article className="panel-mini">
          <p className="tag">Fork</p>
          <p>Create a fork variant for alternative strategy.</p>
          <Link href={`/upload?mode=fork&section=${normalizedSection}&slug=${encodeURIComponent(sourcePath)}`}>Open fork flow</Link>
        </article>
      </div>

      <section className="commentary-stack">
        <article className="panel-mini">
          <p className="tag">Author commentary</p>
          <p className="commentary-text">{authorCommentary || 'No author commentary for this artifact yet.'}</p>
        </article>
        <article className="panel-mini">
          <p className="tag">Comments from other users</p>
          {userComments.length > 0 ? (
            <ul className="comment-list">
              {userComments.map((item: { author: string; body: string; date?: string }, index: number) => (
                <li className="comment-item" key={`${item.author}-${item.date || index}`}>
                  <p className="comment-header">
                    <span>{item.author}</span>
                    {item.date ? <span className="comment-meta">{item.date}</span> : null}
                  </p>
                  <p className="comment-body">{item.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="comment-empty">No comments from other users yet.</p>
          )}
        </article>
      </section>

      <div className="doc-frame" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}

function normalizeSlug(slug: string) {
  return slug.trim().replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.md$/i, '');
}
