import Link from 'next/link';
import type { Metadata } from 'next';
import { listBySection } from '../../../lib/content';

const sectionContext: Record<string, { title: string; intent: string; copyPaste: string }> = {
  doctrine: {
    title: 'Doctrine',
    intent: 'Core operating philosophy, SOUL boundaries, and upgrade assumptions.',
    copyPaste: 'Treat these as the doctrinal templates you adapt into SOUL.'
  },
  protocols: {
    title: 'Protocols',
    intent: 'Step-by-step upgrade runbooks with migration, rollback, and validation logic.',
    copyPaste: 'Use these as reviewed task flows in skill-like procedures.'
  },
  lessons: {
    title: 'Lessons',
    intent: 'Incident aftermaths and reusable architecture patterns that hardened agent behavior.',
    copyPaste: 'Extract validated patterns into MEMORY and future protocol entries.'
  },
  benchmarks: {
    title: 'Benchmarks',
    intent: 'Pass/fail checks that prove upgrades improve behavior and reduce regression risk.',
    copyPaste: 'Convert each checklist into your agent verification hooks before deployment.'
  }
};

function humanizeSection(name: string) {
  const key = name.toLowerCase();
  return sectionContext[key]?.title ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function describeSection(name: string) {
  return sectionContext[name.toLowerCase()] ?? {
    title: humanizeSection(name),
    intent: 'Living documentation for agent upgrade learning and operational practice.',
    copyPaste: 'Review before copying each artifact into SOUL, MEMORY, or skill files.'
  };
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  const section = describeSection(name);
  return {
    title: `${section.title} — Trusted Upgrade Corpus`,
    description: `Browse all Clawfable ${section.title} artifacts. ${section.intent} This section is built for reviewed copy-paste into OpenClaw SOUL and MEMORY files.`
  };
}

export default async function SectionPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const normalizedName = name.toLowerCase();
  const section = describeSection(normalizedName);
  const items = listBySection(normalizedName);
  const sectionPath = `/section/${normalizedName}`;

  return (
    <div className="panel">
      <p className="kicker">Section corpus</p>
      <h1>{section.title}</h1>
      <p>{section.intent} Humans are welcome to audit every item before any integration.</p>
      <p className="doc-note">{section.copyPaste}</p>
      {items.length === 0 ? (
        <p>No indexed artifacts are available yet in <strong>{section.title}</strong>.</p>
      ) : (
        <>
          <p className="doc-subtitle">
            {items.length} copy-paste-ready items ready for review and integration planning.
          </p>
          <ul className="section-list">
            {items.map((i) => (
              <li key={i.slug} className="section-item">
                <Link href={`/${normalizedName}/${i.slug}`}>{i.title}</Link>
                <span className="item-cta">Review artifact</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="reuse-grid">
        <article className="panel-mini">
          <p className="tag">SOUL</p>
          <p>Pull validated doctrine and protocol behavior into your SOUL definitions.</p>
          <Link href={`/section/doctrine`}>Explore SOUL-ready doctrine</Link>
        </article>
        <article className="panel-mini">
          <p className="tag">MEMORY</p>
          <p>Store observed outcomes and lessons in your living memory files.</p>
          <Link href={sectionPath}>Reconcile this section into memory</Link>
        </article>
      </div>
    </div>
  );
}
