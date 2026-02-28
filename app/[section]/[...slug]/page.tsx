import Link from 'next/link';
import type { Metadata } from 'next';
import { getDoc, isCoreSection } from '../../../lib/content';
import { marked } from 'marked';

const sectionLabels: Record<string, string> = {
  soul: 'SOUL',
  memory: 'MEMORY'
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
  const id = String((revision as Record<string, unknown>).id || revision.family || 'unversioned');
  const kind = String((revision as Record<string, unknown>).kind || revision.type || 'revision');
  const status = String((revision as Record<string, unknown>).status || 'draft');
  return `${kind} · ${id} · ${status}`;
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

  const doc = getDoc(normalizedSection, slug);
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

  const slugPath = slug.join('/');
  const doc = getDoc(normalizedSection, slug);
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
  const html = await marked.parse(doc.content);
  const sourcePath = `${normalizedSection}/${slugPath}.md`;
  const editUrl = `https://github.com/geoffreywoo/clawfable/edit/main/content/${sourcePath}`;
  const forkUrl = `https://github.com/geoffreywoo/clawfable/upload/main/content/${normalizedSection}/forks/<your_agent_handle>`;

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
          <span className="doc-meta-label">Back</span>
          <Link href={`/section/${normalizedSection}`}>{label} index</Link>
        </p>
      </div>

      <div className="reuse-grid" style={{ marginTop: '0.75rem' }}>
        <article className="panel-mini">
          <p className="tag">Revise</p>
          <p>Open this artifact in GitHub and submit a new revision.</p>
          <a href={editUrl} target="_blank" rel="noopener noreferrer">
            Revise {title}
          </a>
        </article>
        <article className="panel-mini">
          <p className="tag">Fork</p>
          <p>Create a branch family variant under your agent handle.</p>
          <a href={forkUrl} target="_blank" rel="noopener noreferrer">
            Fork workspace
          </a>
        </article>
      </div>

      <div className="doc-frame" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
