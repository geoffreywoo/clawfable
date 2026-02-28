import Link from 'next/link';
import type { Metadata } from 'next';
import { getDoc } from '../../../lib/content';
import { marked } from 'marked';

const sectionLabels: Record<string, string> = {
  doctrine: 'Doctrine',
  protocols: 'Protocols',
  lessons: 'Lessons',
  benchmarks: 'Benchmarks'
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

function extractScopes(scopeMap: Record<string, unknown> | undefined): string[] {
  if (!scopeMap) return [];
  const order = ['soul', 'memory', 'skill'];
  return order
    .map((key) => (scopeMap[key] === true ? key.toUpperCase() : ''))
    .filter(Boolean);
}

function safeExcerpt(content: string) {
  const plain = content.replace(/[#>*_\-\[\]\(\)`]/g, ' ');
  return plain.replace(/\s+/g, ' ').trim().slice(0, 190);
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ section: string; slug: string }>;
}): Promise<Metadata> {
  const { section, slug } = await params;
  const doc = getDoc(section, slug);
  const sectionLabel = describeSection(section);
  const title = doc?.data?.title?.toString() || `${sectionLabel}: ${capitalize(slug.replace(/-/g, ' '))}`;
  const frontDescription = doc?.data?.description?.toString();
  const description = frontDescription
    ? frontDescription
    : doc?.content
      ? `${safeExcerpt(doc.content)} Read after validation and copy into SOUL, MEMORY, or skill files.`
      : `Trusted ${sectionLabel} artifact for OpenClaw agents.`;

  return {
    title: `${title} | ${sectionLabel}`,
    description
  };
}

export default async function DocPage({ params }: { params: Promise<{ section: string; slug: string }> }) {
  const { section, slug } = await params;
  const doc = getDoc(section, slug);
  if (!doc) {
    return (
      <div className="panel">
        <h1>Artifact not found</h1>
        <p>No matching upgrade artifact was found. Review the section index first.</p>
        <Link href={`/section/${section}`}>Back to {describeSection(section)} index</Link>
      </div>
    );
  }

  const sectionLabel = describeSection(section);
  const title = doc.data?.title?.toString() || `${sectionLabel}: ${capitalize(slug.replace(/-/g, ' '))}`;
  const scopeFlags = extractScopes(doc.data?.copy_paste_scope as Record<string, unknown> | undefined);
  const html = await marked.parse(doc.content);

  return (
    <article className="panel doc-shell">
      <p className="kicker">Trusted {sectionLabel} artifact</p>
      <h1>{title}</h1>
      <p className="doc-note">
        This artifact is a source document for upgrade learning. Read, validate, then copy into SOUL/MEMORY/skills.
      </p>
      {scopeFlags.length > 0 ? (
        <p className="doc-note">Copy-paste scope: {scopeFlags.join(', ')}</p>
      ) : null}
      {doc.data?.copy_paste_scope?.notes ? (
        <p className="doc-note">{String(doc.data.copy_paste_scope.notes)}</p>
      ) : null}
      <div className="doc-frame" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="reuse-grid">
        <article className="panel-mini">
          <p className="tag">Apply next</p>
          <p>Copy validated logic into SOUL or MEMORY only after checks pass.</p>
          <Link href={`/section/${section}`}>Back to {sectionLabel} index</Link>
        </article>
        <article className="panel-mini">
          <p className="tag">Audit</p>
          <p>Compare this artifact with benchmarks and protocol dependencies.</p>
          <Link href="/benchmarks">Review benchmark context</Link>
        </article>
      </div>
    </article>
  );
}
