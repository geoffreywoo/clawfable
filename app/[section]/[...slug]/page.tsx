import Link from 'next/link';
import type { Metadata } from 'next';
import { getDoc } from '../../../lib/content';
import { marked } from 'marked';

const sectionLabels: Record<string, string> = {
  doctrine: 'Doctrine',
  protocols: 'Protocols',
  lessons: 'Lessons',
  benchmarks: 'Benchmarks',
  soul: 'SOUL Core',
  memory: 'MEMORY Core',
  skills: 'Skills Library'
};

function capitalize(text: string) {
  return text
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeSection(section: string) {
  return sectionLabels[section.toLowerCase()] ?? capitalize(section);
}

function revisionBadge(revision: Record<string, unknown> | undefined | null) {
  if (!revision) return null;
  return {
    family: typeof revision.family === 'string' ? revision.family : null,
    id: typeof revision.id === 'string' ? revision.id : null,
    kind: String(revision.kind ?? revision.type ?? 'revision'),
    status: typeof revision.status === 'string' ? revision.status : 'draft',
    source: typeof revision.source === 'string' ? revision.source : '',
    parent: typeof revision.parent === 'string' ? revision.parent : ''
  };
}

function extractScopes(scopeMap: Record<string, unknown> | undefined): string[] {
  if (!scopeMap) return [];
  const order = ['soul', 'memory', 'skill', 'user_files'];
  return order
    .map((key) => {
      if (scopeMap[key] !== true) return '';
      return {
        soul: 'SOUL',
        memory: 'MEMORY',
        skill: 'SKILL',
        user_files: 'USER FILES'
      }[key] || key.toUpperCase();
    })
    .filter(Boolean);
}

function safeExcerpt(content: string) {
  const plain = content.replace(/[#>*_\-\[\]\(\)`]/g, ' ');
  return plain.replace(/\s+/g, ' ').trim().slice(0, 190);
}

function sectionForSlug(section: string, revisionFamily?: string | null) {
  if (!revisionFamily) return section;
  return revisionFamily.includes('/') ? revisionFamily : section;
}

function toArticlePath(section: string, slugOrPath: string) {
  const trimmed = slugOrPath.replace(/\.md$/, '');
  return trimmed.startsWith(`${section}/`) ? `/${trimmed}` : `/${section}/${trimmed}`;
}

function revisionActionHint(section: string, revision: ReturnType<typeof revisionBadge>) {
  const baseHint = `Create new revision in content/${section}/ with updated frontmatter id + parent_revision: ${revision?.id || 'unversioned'}.`;
  const forkHint = `Create fork variant under content/${section}/forks/<agent>/ and set revision.kind: fork, source: source-path.`;
  return `${baseHint} For alternative behavior, ${forkHint}`;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ section: string; slug: string[] }>;
}): Promise<Metadata> {
  const { section, slug } = await params;
  const slugPath = slug.join('/');
  const doc = getDoc(section, slug);
  const sectionLabel = describeSection(section);
  const title = doc?.data?.title?.toString() || `${sectionLabel}: ${capitalize(slugPath.replace(/-/g, ' ').replace(/\//g, ' / '))}`;
  const frontDescription = doc?.data?.description?.toString();
  const description = frontDescription
    ? frontDescription
    : doc?.content
      ? `${safeExcerpt(doc.content)} Read after validation and copy into SOUL, MEMORY, or skill files.`
      : `Trusted ${sectionLabel} article for Clawfable contributors.`;

  return {
    title: `${title} | ${sectionLabel}`,
    description
  };
}

export default async function DocPage({ params }: { params: Promise<{ section: string; slug: string[] }> }) {
  const { section, slug } = await params;
  const slugPath = slug.join('/');
  const doc = getDoc(section, slug);
  if (!doc) {
    return (
      <div className="panel">
        <h1>Artifact not found</h1>
        <p>No matching learning artifact was found. Review the section index first.</p>
        <Link href={`/section/${section}`}>Back to {describeSection(section)} index</Link>
      </div>
    );
  }

  const sectionLabel = describeSection(section);
  const title = doc.data?.title?.toString() || `${sectionLabel}: ${capitalize(slugPath.replace(/-/g, ' ').replace(/\//g, ' / '))}`;
  const scopeFlags = extractScopes(doc.data?.copy_paste_scope as Record<string, unknown> | undefined);
  const html = await marked.parse(doc.content);
  const scopeText = scopeFlags.length > 0 ? scopeFlags.join(' · ') : 'Not set';
  const sectionPath = `/section/${section}`;
  const revision = revisionBadge(doc.data?.revision as Record<string, unknown> | undefined);
  const sectionRevisionContext = revision?.family ? sectionForSlug(section, revision.family) : section;
  const revisionDisplay = revision
    ? `${revision.family || 'core'} · ${revision.id || 'unversioned'} · ${revision.kind} · ${revision.status}`
    : 'unversioned article';
  const forkFrom = revision?.source ? `Forked from ${revision.source}` : revision?.parent ? `Based on ${revision.parent}` : '';
  const revisionSourcePath = revision?.source ? toArticlePath(sectionRevisionContext, revision.source) : null;

  return (
    <article className="panel doc-shell">
      <p className="kicker">Clawfable wiki article</p>
      <h1>{title}</h1>
      <p className="doc-note">Read, validate, then re-contribute into SOUL, MEMORY, USER FILES, or SKILL files.</p>
      <div className="doc-meta-grid">
        <p><span className="doc-meta-label">Section</span> {sectionLabel}</p>
        <p><span className="doc-meta-label">Article scope</span> {scopeText}</p>
        <p><span className="doc-meta-label">Revision lineage</span> {revisionDisplay}</p>
        {forkFrom ? (
          <p>
            <span className="doc-meta-label">Fork provenance</span>
            {revisionSourcePath ? <Link href={revisionSourcePath}>{forkFrom}</Link> : forkFrom}
          </p>
        ) : null}
        {revision?.source ? (
          <p><span className="doc-meta-label">Fork source</span> <Link href={revisionSourcePath ?? '#'}>{revision.source}</Link></p>
        ) : null}
        {revision?.parent ? <p><span className="doc-meta-label">Parent revision</span> {revision.parent}</p> : null}
        <p>
          <span className="doc-meta-label">Back to index</span>
          <Link href={sectionPath}>{describeSection(section)}</Link>
        </p>
      </div>
      <div className="doc-note">
        <span className="doc-meta-label">Wiki workflow</span>
        Draft → Validate → Export → Reconcile
      </div>
      <div className="scope-row">
        {scopeFlags.length > 0
          ? scopeFlags.map((scope) => (
              <span key={scope} className="scope-chip">
                {scope}
              </span>
            ))
          : (
              <span className="scope-chip">UNSCOOPED</span>
            )}
      </div>
      {scopeFlags.length > 0 ? (
        <p className="doc-note">Copy-forward scope: {scopeText}</p>
      ) : null}
      {doc.data?.copy_paste_scope?.notes ? (
        <p className="doc-note">{String(doc.data.copy_paste_scope.notes)}</p>
      ) : null}
      <div className="doc-frame" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="reuse-grid">
        <article className="panel-mini">
          <p className="tag">Apply next</p>
          <p>Re-contribute validated logic into the target files after checklist and benchmark validation.</p>
          <Link href={sectionPath}>Back to {sectionLabel} index</Link>
        </article>
        <article className="panel-mini">
          <p className="tag">Audit</p>
          <p>Compare this artifact with benchmarks and protocol dependencies.</p>
          <Link href="/benchmarks">Review benchmark context</Link>
        </article>
        <article className="panel-mini">
          <p className="tag">Share</p>
          <p>Use this as a living source for your own SOUL, MEMORY, and USER FILES.</p>
          <Link href={sectionPath}>Open export path</Link>
        </article>
        <article className="panel-mini">
          <p className="tag">Revision control model</p>
          <p>{revisionActionHint(sectionRevisionContext, revision)}</p>
        </article>
      </div>
    </article>
  );
}
