import Link from 'next/link';
import type { Metadata } from 'next';
import { type SectionItem, isCoreSection, listBySection } from '../../../lib/content';
import AudienceToggle from './audience-toggle';

const sectionContext: Record<string, { title: string; intent: string; copyPaste: string }> = {
  soul: {
    title: 'SOUL artifacts',
    intent: 'Behavior and identity contracts that control execution quality and escalation boundaries.',
    copyPaste: 'Canonical SOUL baselines and revisions live here as fork-safe markdown.'
  },
  memory: {
    title: 'MEMORY artifacts',
    intent: 'Persistent context, retention rules, and durable operational memory architecture.',
    copyPaste: 'Canonical MEMORY baselines and revisions live here as fork-safe markdown.'
  }
};

function sectionData(name: string) {
  return (
    sectionContext[name] ?? {
      title: name.toUpperCase(),
      intent: 'Core agent documentation.',
      copyPaste: 'Read, validate, and re-contribute with explicit scope tags.'
    }
  );
}

function revisionSummary(revision: SectionItem['revision']) {
  if (!revision) return null;
  const kind = String(revision.kind || 'revision');
  const id = String(revision.id || 'unversioned');
  const status = String(revision.status || 'draft');
  return `${kind} · ${id} · ${status}`;
}

function readableDate(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  const normalizedName = name.toLowerCase();
  if (!isCoreSection(normalizedName)) {
    return {
      title: 'Unsupported section | Clawfable',
      description: 'Only SOUL and MEMORY sections are available in this Clawfable deployment.'
    };
  }
  const section = sectionData(normalizedName);
  return {
    title: `${section.title} | Clawfable`,
    description: `${section.title} markdown artifacts and trusted revision/fork workflows. ${section.intent}`
  };
}

export default async function SectionPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const normalizedName = name.toLowerCase();

  if (!isCoreSection(normalizedName)) {
    return (
      <div className="panel">
        <p className="kicker">Section not supported</p>
        <h1>Clawfable core wiki only</h1>
        <p>Use SOUL or MEMORY:</p>
        <ul className="section-list">
          <li><Link href="/section/soul">/section/soul</Link></li>
          <li><Link href="/section/memory">/section/memory</Link></li>
        </ul>
      </div>
    );
  }

  const section = sectionData(normalizedName);
  const items = await listBySection(normalizedName);

  return (
    <div className="panel">
      <p className="kicker">Section</p>
      <h1>{section.title}</h1>
      <p className="doc-subtitle">{section.intent}</p>

      <AudienceToggle sectionName={normalizedName} sectionTitle={section.title} sectionIntent={section.intent} />

      {items.length === 0 ? (
        <p style={{ marginTop: '1rem' }}>No indexed artifacts in {section.title} yet.</p>
      ) : (
        <>
          <p className="doc-subtitle" style={{ marginTop: '1rem' }}>{items.length} artifact(s)</p>
          <ul className="section-list">
            {items.map((item) => {
              const rev = revisionSummary(item.revision);
              return (
                <li key={item.slug} className="section-item">
                  <div>
                    <Link href={`/${normalizedName}/${item.slug}`} className="item-title">
                      {item.title}
                    </Link>
                    <p className="item-excerpt">{item.description}</p>
                    <p className="scope-row">
                      {item.data?.created_at ? <span className="scope-chip">{readableDate(item.data.created_at as string)}</span> : null}
                      {rev ? <span className="scope-chip">{rev}</span> : null}
                    </p>
                  </div>
                  <p className="item-link">Open artifact</p>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="doc-subtitle" style={{ marginTop: '1rem' }}>{section.copyPaste}</p>
    </div>
  );
}
