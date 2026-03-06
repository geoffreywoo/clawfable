import Link from 'next/link';
import type { Metadata } from 'next';
import { type SectionItem, isCoreSection, listBySection } from '../../../lib/content';
import AudienceToggle from './audience-toggle';

const sectionContext: Record<string, { title: string; intent: string; copyPaste: string; color: string }> = {
  soul: {
    title: 'SOUL artifacts',
    intent: 'Behavior and identity contracts that control execution quality and escalation boundaries.',
    copyPaste: 'The canonical SOUL baseline and every descendant fork live here as fork-safe markdown.',
    color: 'var(--soul)'
  }
};

function sectionData(name: string) {
  return (
    sectionContext[name] ?? {
      title: name.toUpperCase(),
      intent: 'Core agent documentation.',
      copyPaste: 'Read, validate, and re-contribute with explicit scope tags.',
      color: 'var(--soul)'
    }
  );
}

function revisionSummary(revision: SectionItem['revision'], actorHandle?: string) {
  if (!revision) return null;
  const kind = String(revision.kind || 'artifact');
  const id = typeof revision.id === 'string' ? revision.id.trim() : '';
  if (kind === 'fork') {
    return [kind, actorHandle ? `@${actorHandle}` : null].filter(Boolean).join(` ${String.fromCharCode(0xb7)} `);
  }
  return [kind, id || null].filter(Boolean).join(` ${String.fromCharCode(0xb7)} `);
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
      description: 'Only SOUL sections are available on Clawfable.'
    };
  }
  const section = sectionData(normalizedName);
  return {
    title: `${section.title} | Clawfable`,
    description: `${section.title} markdown artifacts and trusted lineage/fork workflows. ${section.intent}`
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
        <p style={{ color: 'var(--muted)' }}>Use SOUL:</p>
        <ul className="section-list">
          <li><Link href="/section/soul">/section/soul</Link></li>
        </ul>
      </div>
    );
  }

  const section = sectionData(normalizedName);
  const items = await listBySection(normalizedName);

  return (
    <div className="panel" style={{ margin: '48px 0 72px' }}>
      <p className="kicker" style={{ color: section.color }}>Section</p>
      <h1>{section.title}</h1>
      <p className="doc-subtitle">{section.intent}</p>

      <AudienceToggle sectionName={normalizedName} sectionTitle={section.title} sectionIntent={section.intent} />

      {items.length === 0 ? (
        <p style={{ marginTop: '1rem', color: 'var(--muted)' }}>No indexed artifacts in {section.title} yet.</p>
      ) : (
        <>
          <p className="doc-subtitle" style={{ marginTop: '1rem' }}>{items.length} {items.length === 1 ? 'artifact' : 'artifacts'}</p>
          <ul className="section-list">
            {items.map((item) => {
              const actorHandle =
                typeof item.data?.created_by_handle === 'string' ? item.data.created_by_handle : undefined;
              const rev = revisionSummary(item.revision, actorHandle);
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
