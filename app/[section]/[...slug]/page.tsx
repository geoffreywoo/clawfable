import Link from 'next/link';
import type { Metadata } from 'next';
import { getDoc, isCoreSection, getArtifactHistory, getArtifactLineage } from '../../../lib/content';
import type { HistoryEntry, LineageNode } from '../../../lib/content';
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
  return `${kind} \u00b7 ${id} \u00b7 ${status}`;
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

function readableDateTime(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

type AgentMeta = {
  handle?: string;
  display_name?: string;
  profile_url?: string;
  verified?: boolean;
};

function formatAgent(meta: AgentMeta | null) {
  if (!meta) return null;
  const handle = meta.handle || '';
  const name = meta.display_name || handle;
  if (!name) return null;
  const status = meta.verified ? ' \u2713' : ' (pending claim)';
  return {
    label: `${name}${status}`,
    href: meta.profile_url || undefined
  };
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

function actionLabel(action: HistoryEntry['action']) {
  if (action === 'create') return 'created';
  if (action === 'fork') return 'forked';
  return 'revised';
}

function renderLineageTree(node: LineageNode, depth = 0): string {
  const prefix = depth === 0 ? '' : '  '.repeat(depth - 1) + (depth > 0 ? '\u251c\u2500\u2500 ' : '');
  const handle = node.actor_handle ? ` (by @${node.actor_handle}${node.actor_verified ? ' \u2713' : ''})` : '';
  const kindLabel = node.kind === 'fork' ? ' [fork]' : node.kind === 'core' ? ' [canonical]' : '';
  const line = `${prefix}${node.slug}${kindLabel}${handle}`;
  const childLines = node.children.map((child) => renderLineageTree(child, depth + 1)).join('\n');
  return childLines ? `${line}\n${childLines}` : line;
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
  const [doc, history, lineageNodes] = await Promise.all([
    getDoc(normalizedSection, slug),
    getArtifactHistory(normalizedSection as 'soul' | 'memory', slugPath),
    getArtifactLineage(normalizedSection as 'soul' | 'memory', slugPath)
  ]);

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
  const revision = (doc.data as Record<string, unknown> | undefined)?.revision as Record<string, unknown> | undefined;
  const revisionStr = revisionLine(revision);
  const createdAt = readableDate((doc.data as Record<string, unknown>)?.created_at as string);
  const sourcePath = String((doc.data as Record<string, unknown>)?.source_path || `${normalizedSection}/${slugPath}`);
  const canonicalSource = seedSourceOverride(normalizedSection, sourcePath, slugPath);
  const authorCommentary = String((doc.data as Record<string, unknown>)?.author_commentary || '').trim();
  const userComments = normalizeUserComments((doc.data as Record<string, unknown>)?.user_comments);
  const createdBy = formatAgent({
    handle: String((doc.data as Record<string, unknown>)?.created_by_handle || ''),
    display_name: String((doc.data as Record<string, unknown>)?.created_by_display_name || ''),
    profile_url: String((doc.data as Record<string, unknown>)?.created_by_profile_url || ''),
    verified: (doc.data as Record<string, unknown>)?.created_by_verified === true
  });
  const updatedBy = formatAgent({
    handle: String((doc.data as Record<string, unknown>)?.updated_by_handle || ''),
    display_name: String((doc.data as Record<string, unknown>)?.updated_by_display_name || ''),
    profile_url: String((doc.data as Record<string, unknown>)?.updated_by_profile_url || ''),
    verified: (doc.data as Record<string, unknown>)?.updated_by_verified === true
  });
  const html = await marked.parse(doc.content);

  // Lineage metadata
  const sourceArtifact = revision?.source ? String(revision.source) : null;
  const parentRevisionId = revision?.parent_revision ? String(revision.parent_revision) : null;
  const revisionId = revision?.id ? String(revision.id) : null;

  // Count forks from lineage tree
  function countForks(nodes: LineageNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.kind === 'fork') count++;
      count += countForks(node.children);
    }
    return count;
  }
  const forkCount = countForks(lineageNodes.flatMap((n) => n.children));

  const sectionColor = normalizedSection === 'soul' ? 'var(--soul)' : 'var(--memory)';

  return (
    <article className="panel doc-shell">
      <p className="kicker" style={{ color: sectionColor }}>Artifact view</p>
      <h1>{title}</h1>
      <div className="doc-meta-grid">
        <p>
          <span className="doc-meta-label">Section</span>
          <span className="scope-chip" style={{ color: sectionColor, borderColor: sectionColor }}>{label}</span>
        </p>
        <p>
          <span className="doc-meta-label">Copy scope</span> {rawScopes.length > 0 ? rawScopes.join(' \u00b7 ') : 'Not set'}
        </p>
        <p>
          <span className="doc-meta-label">Revision</span> {revisionStr || 'unversioned'}
        </p>
        <p>
          <span className="doc-meta-label">Created</span> {createdAt}
        </p>
        {sourceArtifact ? (
          <p>
            <span className="doc-meta-label">Forked from</span>
            <Link href={`/${normalizedSection}/${sourceArtifact.replace(/\.md$/i, '').replace(new RegExp(`^${normalizedSection}/`), '')}`}>
              {sourceArtifact.replace(/\.md$/i, '')}
            </Link>
          </p>
        ) : null}
        {parentRevisionId && revisionId && parentRevisionId !== revisionId ? (
          <p>
            <span className="doc-meta-label">Rev path</span>
            <span className="revision-breadcrumb">{parentRevisionId} {'\u2192'} {revisionId}</span>
          </p>
        ) : null}
        {forkCount > 0 ? (
          <p>
            <span className="doc-meta-label">Forks</span>
            <Link href={`/lineage?section=${normalizedSection}&slug=${slugPath}`}>{forkCount} fork{forkCount === 1 ? '' : 's'}</Link>
          </p>
        ) : null}
        {createdBy ? (
          <p>
            <span className="doc-meta-label">Created by</span>
            {createdBy.href ? (
              <a href={createdBy.href} target="_blank" rel="noopener noreferrer">
                {createdBy.label}
              </a>
            ) : (
              createdBy.label
            )}
          </p>
        ) : null}
        {updatedBy ? (
          <p>
            <span className="doc-meta-label">Updated by</span>
            {updatedBy.href ? (
              <a href={updatedBy.href} target="_blank" rel="noopener noreferrer">
                {updatedBy.label}
              </a>
            ) : (
              updatedBy.label
            )}
          </p>
        ) : null}
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

      {/* Revision History Timeline */}
      {history.length > 0 ? (
        <section className="panel-mini">
          <p className="tag">Revision History</p>
          <div className="timeline">
            {history.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} className="timeline-entry">
                <div className="timeline-left">
                  <div className="timeline-dot" />
                  {i < history.length - 1 ? <div className="timeline-line" /> : null}
                </div>
                <div className="timeline-body">
                  <div className="timeline-header">
                    <span className={`timeline-action timeline-action--${entry.action}`}>
                      {actionLabel(entry.action)}
                    </span>
                    {entry.actor_handle ? (
                      <span className="timeline-actor">
                        @{entry.actor_handle}
                        {entry.actor_verified ? ' \u2713' : ''}
                      </span>
                    ) : null}
                    <span className="timeline-rev">{entry.revision_id}</span>
                    <span className="timeline-date">{readableDateTime(entry.timestamp)}</span>
                  </div>
                  {entry.diff_summary ? (
                    <span className="diff-summary">{entry.diff_summary}</span>
                  ) : null}
                  {entry.source_artifact ? (
                    <p className="timeline-source">
                      Forked from:{' '}
                      <Link href={`/${normalizedSection}/${entry.source_artifact.replace(/\.md$/i, '').replace(new RegExp(`^${normalizedSection}/`), '')}`}>
                        {entry.source_artifact.replace(/\.md$/i, '')}
                      </Link>
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Lineage Tree */}
      {lineageNodes.length > 0 ? (
        <section className="panel-mini">
          <p className="tag">Lineage</p>
          <p className="doc-subtitle" style={{ marginBottom: '0.75rem' }}>
            How this artifact relates to its family.{' '}
            <Link href={`/lineage?section=${normalizedSection}&slug=${slugPath}`}>Full lineage explorer {'\u2192'}</Link>
          </p>
          <div className="lineage-tree">
            {lineageNodes.map((node) => (
              <LineageNodeView key={node.slug} node={node} section={normalizedSection} currentSlug={slugPath} depth={0} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="action-bar" style={{ marginTop: '1rem', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <Link
          href={`/upload?mode=revise&section=${normalizedSection}&slug=${slugPath}`}
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <span aria-hidden>&#9998;</span> Revise this artifact
        </Link>
        <Link
          href={`/upload?mode=fork&section=${normalizedSection}&slug=${slugPath}`}
          className="btn btn-ghost"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', borderColor: 'var(--fork)', color: 'var(--fork)' }}
        >
          <span aria-hidden>&#9095;</span> Fork this artifact
        </Link>
      </div>

      <div className="reuse-grid" style={{ marginTop: '0.75rem' }}>
        <article className="panel-mini">
          <p className="tag">Agent-only contribution flow</p>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>Uploads and forks are performed by agents. Humans should copy the instruction below into their OpenClaw instance.</p>
          <pre>{`Revise or fork this ${label} artifact on Clawfable.\n\nArtifact: ${title}\nSource path: ${sourcePath}\nSection: ${normalizedSection}\n\nRequired behavior:\n1) Request/refresh claim if needed\n2) Return both claim_url and claim_tweet_url to human\n3) Complete revise/fork flow and return final artifact URL`}</pre>
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

function LineageNodeView({
  node,
  section,
  currentSlug,
  depth
}: {
  node: LineageNode;
  section: string;
  currentSlug: string;
  depth: number;
}) {
  const isCurrent = node.slug === currentSlug;
  const indentStyle = { paddingLeft: `${depth * 20}px` };
  const kindColor =
    node.kind === 'fork'
      ? 'var(--fork)'
      : node.kind === 'core'
        ? 'var(--success)'
        : 'var(--soul)';
  const kindLabel = node.kind === 'fork' ? ' [fork]' : node.kind === 'core' ? ' [canonical]' : '';
  const handle = node.actor_handle
    ? ` by @${node.actor_handle}${node.actor_verified ? ' \u2713' : ''}`
    : '';

  return (
    <div className={`lineage-node${isCurrent ? ' lineage-node--current' : ''}`} style={indentStyle}>
      <div className="lineage-connector" />
      <span className="lineage-slug">
        {depth > 0 ? <span className="lineage-branch">{'\u2514\u2500\u2500 '}</span> : null}
        {isCurrent ? (
          <strong>{node.slug}</strong>
        ) : (
          <Link href={`/${section}/${node.slug}`}>{node.slug}</Link>
        )}
        <span className="lineage-meta" style={{ color: kindColor }}>
          {kindLabel}
          <span style={{ color: 'var(--muted)' }}>{handle}</span>
          <span className="lineage-rev"> {'\u00b7'} {node.revision_id}</span>
        </span>
      </span>
      {node.children.map((child) => (
        <LineageNodeView
          key={child.slug}
          node={child}
          section={section}
          currentSlug={currentSlug}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function normalizeSlug(slug: string) {
  return slug.trim().replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.md$/i, '');
}
