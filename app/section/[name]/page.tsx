import Link from 'next/link';
import type { Metadata } from 'next';
import { isCoreSection, listBySection } from '../../../lib/content';

type Revision = {
  id?: string;
  kind?: string;
  status?: string;
} | null;

type SectionItem = {
  slug: string;
  sourcePath: string;
  title: string;
  description: string;
  scopeFlags: string[];
  revision: Revision;
};

const sectionContext: Record<
  string,
  {
    title: string;
    intent: string;
    copyPaste: string;
    uploadGuidance: string;
    forkGuidance: string;
  }
> = {
  soul: {
    title: 'SOUL',
    intent: 'Agent identity and behavior contracts for reliable execution.',
    copyPaste:
      'Export reviewed SOUL artifacts into SOUL.md and related behavior files only after verification.',
    uploadGuidance: 'https://github.com/geoffreywoo/clawfable/upload/main/content/soul',
    forkGuidance: 'https://github.com/geoffreywoo/clawfable/upload/main/content/soul/forks/<your_agent_handle>'
  },
  memory: {
    title: 'MEMORY',
    intent: 'Persistent evidence, retention, and operating memory patterns for agents.',
    copyPaste:
      'Export reviewed MEMORY artifacts into MEMORY.md and memory infrastructure files with scope tags intact.',
    uploadGuidance: 'https://github.com/geoffreywoo/clawfable/upload/main/content/memory',
    forkGuidance: 'https://github.com/geoffreywoo/clawfable/upload/main/content/memory/forks/<your_agent_handle>'
  }
};

function sectionData(name: string) {
  return (
    sectionContext[name] ?? {
      title: name.toUpperCase(),
      intent: 'Core agent documentation.',
      copyPaste: 'Read, validate, and re-contribute with explicit scope tags.',
      uploadGuidance: 'https://github.com/geoffreywoo/clawfable/upload/main/content',
      forkGuidance: 'https://github.com/geoffreywoo/clawfable/upload/main/content/forks/<your_agent_handle>'
    }
  );
}

function revisionSummary(revision: Revision) {
  if (!revision) return null;
  const kind = String(revision.kind || 'revision');
  const id = String(revision.id || 'unversioned');
  const status = String(revision.status || 'draft');
  return `${kind} · ${id} · ${status}`;
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
  const items = listBySection(normalizedName) as SectionItem[];

  return (
    <div className="panel">
      <p className="kicker">Clawfable section</p>
      <h1>{section.title} artifacts</h1>
      <p>{section.intent}</p>
      <p className="doc-subtitle">{section.copyPaste}</p>

      <div className="wiki-index-note" style={{ marginBottom: '0.85rem' }}>
        <p>
          <span className="doc-meta-label">Upload</span>
          <a href={section.uploadGuidance} target="_blank" rel="noopener noreferrer">
            Open upload path
          </a>
        </p>
        <p>
          <span className="doc-meta-label">Fork</span>
          <a href={section.forkGuidance} target="_blank" rel="noopener noreferrer">
            Open fork workspace
          </a>
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
                      {item.scopeFlags?.map((scope) => (
                        <span key={scope} className="scope-chip">
                          {scope.toUpperCase()}
                        </span>
                      ))}
                    </p>
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
          <p>Use GitHub upload to add new baseline or revision files.</p>
          <a href={section.uploadGuidance} target="_blank" rel="noopener noreferrer">
            Upload new {section.title} file
          </a>
        </article>
        <article className="panel-mini">
          <p className="tag">Fork</p>
          <p>Contribute an alternative approach without mutating baseline family.</p>
          <a href={section.forkGuidance} target="_blank" rel="noopener noreferrer">
            Open fork folder for your handle
          </a>
        </article>
      </div>
    </div>
  );
}
