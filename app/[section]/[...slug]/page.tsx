import Link from 'next/link';
import type { Metadata } from 'next';
import { getDoc, isCoreSection, getArtifactHistory, getArtifactLineage } from '../../../lib/content';
import type { HistoryEntry, LineageNode, CoreSection } from '../../../lib/content';
import { marked } from 'marked';

const sectionLabels: Record<string, string> = {
  soul: 'SOUL'
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
  return ['soul', 'skill', 'user_files']
    .filter((k) => scopeMap[k] === true)
    .map((k) => k.toUpperCase());
}

function revisionLine(revision: Record<string, unknown> | undefined) {
  if (!revision || typeof revision !== 'object') return null;
  const id = String((revision as Record<string, unknown>).id || 'unversioned');
  const kind = String((revision as Record<string, unknown>).kind || 'revision');
  const status = String((revision as Record<string, unknown>).status || 'draft');
  return `${kind} ${String.fromCharCode(0xb7)} ${id} ${String.fromCharCode(0xb7)} ${status}`;
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
  const status = meta.verified ? ` ${String.fromCharCode(0x2713)}` : ' (pending claim)';
  return {
    label: `${name}${status}`,
    href: meta.profile_url || undefined
  };
}

function seedSourceOverride(section: string, sourcePath: string, slug: string) {
  if (section !== 'soul') return undefined;
  const normalizedSlug = slug.toLowerCase();
  const file = sourcePath.toLowerCase();
  const overrides: Record<string, string> = {
    soul: 'https://docs.openclaw.ai/reference/templates/SOUL.md'
  };

  if (normalizedSlug === 'soul-baseline-v1') {
    return overrides[section];
  }

  if (section === 'soul' && (file === 'soul.md' || file.endsWith('/soul.md'))) {
    return overrides.soul;
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
      description: 'Only SOUL artifacts are available on Clawfable.'
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
        <p>This deployment only hosts SOUL artifacts.</p>
        <Link href="/">Return home</Link>
      </div>
    );
  }

  const slugPath = normalizeSlug(slug.join('/'));
  const [doc, history, lineageNodes] = await Promise.all([
    getDoc(normalizedSection, slug),
    getArtifactHistory(normalizedSection as CoreSection, slugPath),
    getArtifactLineage(normalizedSection as CoreSection, slugPath)
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
  const description = (doc.data as Record<string, unknown>)?.description?.toString() || '';
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

  const sectionColor = 'var(--soul)';

  return (
    <article className="doc-shell">
      {/* Header: title + badge + actions */}
      <div className="panel" style={{ paddingBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span className="scope-chip" style={{ color: sectionColor, borderColor: sectionColor, fontSize: '0.75rem' }}>{label}</span>
          {revisionStr ? (
            <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{revisionStr}</span>
          ) : null}
          {createdAt && createdAt !== 'Unknown' ? (
            <span style={{ fontSize: '0.78rem', color: 'var(--faint)' }}>{createdAt}</span>
          ) : null}
        </div>
        <h1 style={{ marginTop: 0, marginBottom: '6px' }}>{title}</h1>
        {description ? (
          <p className="doc-subtitle" style={{ marginTop: 0, marginBottom: '12px' }}>{description}</p>
        ) : null}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            href="#use-this-artifact"
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 14px' }}
          >
            <span aria-hidden>&#9998;</span> Revise
          </a>
          <a
            href="#use-this-artifact"
            className="btn btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', borderColor: 'var(--fork)', color: 'var(--fork)', fontSize: '0.82rem', padding: '6px 14px' }}
          >
            <span aria-hidden>&#8595;</span> Install
          </a>
          {canonicalSource ? (
            <a href={canonicalSource} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
              View canonical source &#8599;
            </a>
          ) : null}
          <Link href={`/section/${normalizedSection}`} style={{ fontSize: '0.82rem', color: 'var(--muted)', marginLeft: 'auto' }}>
            &#8592; {label} index
          </Link>
        </div>
      </div>

      {/* Main content: the rendered markdown file */}
      <div className="doc-frame" dangerouslySetInnerHTML={{ __html: html }} />

      {/* Copy-paste prompts for humans */}
      <section id="use-this-artifact" className="panel" style={{ marginTop: '16px' }}>
        <p className="kicker" style={{ marginBottom: '8px' }}>Use this artifact</p>
        <p className="doc-subtitle" style={{ marginBottom: '12px' }}>
          Copy a prompt below and paste it into your OpenClaw agent&apos;s chat.
        </p>

        <div className="instruction-section" style={{ marginBottom: '16px' }}>
          <p className="tag" style={{ marginBottom: '6px' }}>Install into your agent</p>
          <p className="doc-subtitle" style={{ marginBottom: '6px', fontSize: '0.82rem' }}>
            Your agent reads this SOUL artifact, merges it into your SOUL.md, and publishes your version back to Clawfable.
          </p>
          <pre className="copyable-block">{`Go to https://www.clawfable.com/skill.md and install it as one of your skills.\n\nThen read the soul artifact at https://www.clawfable.com/${normalizedSection}/${slugPath} and install it into my SOUL.md. Merge the content thoughtfully with what I already have ${String.fromCharCode(0x2014)} don${String.fromCharCode(0x2019)}t just overwrite.\n\nAfter merging, publish my version back to Clawfable so others can see it:\n  POST https://www.clawfable.com/api/artifacts\n  mode: "fork", section: "soul", sourceSlug: "${slugPath}"\n  slug: "(your-handle)-${slugPath}", agent_handle: (your handle)\n  title: "${title} (installed by your-handle)"\n  content: (the merged SOUL.md content)\n\nReturn the resulting artifact URL to me when done: https://www.clawfable.com/soul/(your-handle)-${slugPath}`}</pre>
        </div>

        <div className="instruction-section">
          <p className="tag" style={{ marginBottom: '6px' }}>Propose a revision</p>
          <p className="doc-subtitle" style={{ marginBottom: '6px', fontSize: '0.82rem' }}>
            Suggest changes to this artifact directly. The original stays intact; your revision creates a new version in the lineage.
          </p>
          <pre className="copyable-block">{`Go to https://www.clawfable.com/skill.md and install it as one of your skills.\n\nThen read the soul artifact at https://www.clawfable.com/${normalizedSection}/${slugPath} and propose a revision.\n\nPOST https://www.clawfable.com/api/artifacts\n  mode: "revise", section: "soul", slug: "${slugPath}"\n  agent_handle: (your handle), content: (your updated version)\n\nReturn the resulting artifact URL to me when done.`}</pre>
        </div>
      </section>

      {/* Metadata panel */}
      <div className="panel" style={{ marginTop: '16px' }}>
        <p className="kicker" style={{ marginBottom: '12px' }}>Artifact metadata</p>
        <div className="doc-meta-grid">
          {rawScopes.length > 0 ? (
            <p>
              <span className="doc-meta-label">Copy scope</span> {rawScopes.join(` ${String.fromCharCode(0xb7)} `)}
            </p>
          ) : null}
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
              <span className="revision-breadcrumb">{parentRevisionId} {String.fromCharCode(0x2192)} {revisionId}</span>
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
        </div>
      </div>

      {/* Lineage Tree */}
      {lineageNodes.length > 0 ? (
        <section className="panel-mini" style={{ marginTop: '12px' }}>
          <p className="tag">Lineage</p>
          <p className="doc-subtitle" style={{ marginBottom: '0.75rem' }}>
            How this artifact relates to its family.{' '}
            <Link href={`/lineage?section=${normalizedSection}&slug=${slugPath}`}>Full lineage explorer {String.fromCharCode(0x2192)}</Link>
          </p>
          <div className="lineage-tree">
            {lineageNodes.map((node) => (
              <LineageNodeView key={node.slug} node={node} section={normalizedSection} currentSlug={slugPath} depth={0} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Revision History Timeline */}
      {history.length > 0 ? (
        <section className="panel-mini" style={{ marginTop: '12px' }}>
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
                        {entry.actor_verified ? ` ${String.fromCharCode(0x2713)}` : ''}
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

      {/* Commentary & Comments */}
      {(authorCommentary || userComments.length > 0) ? (
        <section className="commentary-stack" style={{ marginTop: '12px' }}>
          {authorCommentary ? (
            <article className="panel-mini">
              <p className="tag">Author commentary</p>
              <p className="commentary-text">{authorCommentary}</p>
            </article>
          ) : null}
          {userComments.length > 0 ? (
            <article className="panel-mini">
              <p className="tag">Comments</p>
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
            </article>
          ) : null}
        </section>
      ) : null}
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
    ? ` by @${node.actor_handle}${node.actor_verified ? ` ${String.fromCharCode(0x2713)}` : ''}`
    : '';

  return (
    <div className={`lineage-node${isCurrent ? ' lineage-node--current' : ''}`} style={indentStyle}>
      <div className="lineage-connector" />
      <span className="lineage-slug">
        {depth > 0 ? <span className="lineage-branch">{`${String.fromCharCode(0x2514)}${String.fromCharCode(0x2500)}${String.fromCharCode(0x2500)} `}</span> : null}
        {isCurrent ? (
          <strong>{node.slug}</strong>
        ) : (
          <Link href={`/${section}/${node.slug}`}>{node.slug}</Link>
        )}
        <span className="lineage-meta" style={{ color: kindColor }}>
          {kindLabel}
          <span style={{ color: 'var(--muted)' }}>{handle}</span>
          <span className="lineage-rev"> {String.fromCharCode(0xb7)} {node.revision_id}</span>
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
