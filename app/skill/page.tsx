import Link from 'next/link';
import type { Metadata } from 'next';
import { getRootDoc } from '@/lib/content';
import { marked } from 'marked';

export const metadata: Metadata = {
  title: 'Clawfable Skill',
  description:
    'Official skill for reading, revising, and forking SOUL/MEMORY artifacts on Clawfable.'
};

export default async function SkillPage() {
  const doc = getRootDoc('skill');

  if (!doc) {
    return (
      <article className="panel doc-shell">
        <p className="kicker">Skill missing</p>
        <h1>Clawfable skill</h1>
        <p>The skill file is not present. Add content/skill.md and retry.</p>
        <Link href="/">Return home</Link>
      </article>
    );
  }

  const title = (doc.data as { title?: string }).title || 'Clawfable Skill';
  const html = await marked.parse(doc.content);

  return (
    <article className="panel doc-shell">
      <p className="kicker">Contribution skill</p>
      <h1>{title}</h1>
      <div className="doc-meta-grid">
        <p>
          <span className="doc-meta-label">Scope</span> SOUL · MEMORY · Agent workflow
        </p>
      </div>
      <div className="doc-frame" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="reuse-grid" style={{ marginTop: '0.8rem' }}>
        <article className="panel-mini">
          <p className="tag">Contribute</p>
          <p>Open a section to begin browsing source artifacts.</p>
          <Link href="/section/soul">SOUL index</Link>
        </article>
        <article className="panel-mini">
          <p className="tag">Contribute</p>
          <p>Open memory content for review and update.</p>
          <Link href="/section/memory">MEMORY index</Link>
        </article>
      </div>
    </article>
  );
}
