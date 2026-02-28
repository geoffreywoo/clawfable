import Link from 'next/link';
import type { Metadata } from 'next';
import { type SectionItem, isCoreSection, listBySection } from '../../../lib/content';

const sectionContext: Record<
  string,
  {
    title: string;
    intent: string;
    copyPaste: string;
  }
> = {
  soul: {
    title: 'SOUL',
    intent: 'Agent identity and behavior contracts for reliable execution.',
    copyPaste:
      'Export reviewed SOUL artifacts into SOUL.md and related behavior files only after verification.'
  },
  memory: {
    title: 'MEMORY',
    intent: 'Persistent evidence, retention, and operating memory patterns for agents.',
    copyPaste:
      'Export reviewed MEMORY artifacts into MEMORY.md and memory infrastructure files with scope tags intact.'
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

function isCanonicalSource(value: string) {
  return value.startsWith('http://') || value.startsWith('https://');
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
          <li>
            <Link href="/section/soul">/section/soul</Link>
          </li>
          <li>
            <Link href="/section/memory">/section/memory</Link>
          </li>
        </ul>
      </div>
    );
  }

  const section = sectionData(normalizedName);
  const items = await listBySection(normalizedName);

  return (
    <div className="panel">
      <p className="kicker">Clawfable section</p>
      <h1>{section.title} artifacts</h1>
      <p>{section.intent}</p>
      <p className="doc-subtitle">{section.copyPaste}</p>

      <div className="wiki-index-note" style={{ marginBottom: '0.85rem' }}>
        <p>
          <span className="doc-meta-label">Upload</span>
          <Link href={`/upload?mode=create&section=${normalizedName}`}>Open create flow</Link>
        </p>
        <p>
          <span className="doc-meta-label">Fork</span>
          <Link href={`/upload?mode=fork&section=${normalizedName}`}>Open fork flow</Link>
        </p>
      </div>

      {items.length === 0 ? (
        <p>No indexed artifacts in {section.title} yet.</p>
      ) : (
        <>
          <p className="doc-subtitle">{items.length} artifact(s).</p>
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
                      {rev ? <span className="scope-chip">{rev}</span> : null}
                      {item.data?.created_at ? <span className="scope-chip">Created {readableDate(item.data.created_at as string)}</span> : null}
                    {item.scopeFlags?.map((scope) => (
                        <span key={scope} className="scope-chip">
                          {scope.toUpperCase()}
                        </span>
                      ))}
                    </p>
                    {seedSourceOverride(normalizedName, item.sourcePath, item.slug) ? (
                      <p className="item-excerpt">
                        <span className="doc-meta-label">Source</span>
                        <a href={seedSourceOverride(normalizedName, item.sourcePath, item.slug)} target="_blank" rel="noopener noreferrer">
                          canonical openclaw source
                        </a>
                      </p>
                    ) : null}
                  </div>
                  <p className="item-link">Select artifact</p>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="reuse-grid" style={{ marginTop: '1rem' }}>
        <article className="panel-mini">
          <p className="tag">Upload</p>
          <p>Add a new baseline or revisioned artifact.</p>
          <Link href={`/upload?mode=create&section=${normalizedName}`}>Upload new {section.title} file</Link>
        </article>
        <article className="panel-mini">
          <p className="tag">Fork</p>
          <p>Contribute an alternative approach without mutating the baseline.</p>
          <Link href={`/upload?mode=fork&section=${normalizedName}`}>Open fork uploader</Link>
        </article>
      </div>
    </div>
  );
}
