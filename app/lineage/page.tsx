import Link from 'next/link';
import type { Metadata } from 'next';
import { listBySection, getArtifactLineage, isCoreSection } from '../../lib/content';
import type { LineageNode, CoreSection } from '../../lib/content';

export const metadata: Metadata = {
  title: 'Lineage Explorer | Clawfable',
  description: 'Explore the full provenance graph of SOUL and MEMORY artifacts on Clawfable. See how artifacts fork and evolve over time.'
};

function readableDate(value: string | null | undefined) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

function flattenFamilies(nodes: LineageNode[]): LineageNode[][] {
  const families: LineageNode[][] = [];
  function collect(node: LineageNode, family: LineageNode[]) {
    family.push(node);
    for (const child of node.children) {
      collect(child, family);
    }
  }
  for (const root of nodes) {
    const family: LineageNode[] = [];
    collect(root, family);
    families.push(family);
  }
  return families;
}

function LineageNodeRow({
  node,
  section,
  depth,
  highlightSlug
}: {
  node: LineageNode;
  section: string;
  depth: number;
  highlightSlug?: string;
}) {
  const isCurrent = node.slug === highlightSlug;
  const indentPx = depth * 24;
  const kindColor =
    node.kind === 'fork'
      ? '#a78bfa'
      : node.kind === 'core'
        ? '#34d399'
        : '#22d3ee';

  return (
    <>
      <div
        className={`lineage-node${isCurrent ? ' lineage-node--current' : ''}`}
        style={{ paddingLeft: `${indentPx}px` }}
      >
        {depth > 0 ? <span className="lineage-branch">{'\u2514\u2500 '}</span> : null}
        <span className="lineage-slug">
          <Link href={`/${section}/${node.slug}`}>{node.slug}</Link>
        </span>
        <span
          className="scope-chip"
          style={{ color: kindColor, borderColor: kindColor, marginLeft: '8px' }}
        >
          {node.kind}
        </span>
        <span className="scope-chip" style={{ marginLeft: '4px' }}>{node.revision_id}</span>
        {node.actor_handle ? (
          <span className="lineage-actor">
            @{node.actor_handle}
            {node.actor_verified ? ' \u2713' : ''}
          </span>
        ) : null}
        <span className="lineage-date">{readableDate(node.updated_at)}</span>
      </div>
      {node.children.map((child) => (
        <LineageNodeRow
          key={child.slug}
          node={child}
          section={section}
          depth={depth + 1}
          highlightSlug={highlightSlug}
        />
      ))}
    </>
  );
}

async function SectionLineage({ section, highlightSlug }: { section: CoreSection; highlightSlug?: string }) {
  const items = await listBySection(section);
  if (items.length === 0) {
    return <p className="doc-subtitle">No artifacts in {section.toUpperCase()} yet.</p>;
  }

  const rootItems = items.filter((item) => {
    const data = item.data as Record<string, unknown> | undefined;
    const rev = data?.revision as Record<string, unknown> | undefined;
    return !rev?.source;
  });

  const lineageTrees = await Promise.all(
    rootItems.map((item) => getArtifactLineage(section, item.slug))
  );

  const seenRoots = new Set<string>();
  const uniqueTrees: LineageNode[][] = [];
  for (const trees of lineageTrees) {
    for (const tree of trees) {
      if (!seenRoots.has(tree.slug)) {
        seenRoots.add(tree.slug);
        uniqueTrees.push([tree]);
      }
    }
  }

  if (uniqueTrees.length === 0) {
    return (
      <div className="lineage-family">
        {items.map((item) => {
          const data = item.data as Record<string, unknown> | undefined;
          const rev = data?.revision as Record<string, unknown> | undefined;
          return (
            <div key={item.slug} className="lineage-node">
              <span className="lineage-slug">
                <Link href={`/${section}/${item.slug}`}>{item.slug}</Link>
              </span>
              {rev?.kind ? (
                <span className="scope-chip" style={{ marginLeft: '8px' }}>{String(rev.kind)}</span>
              ) : null}
              {rev?.id ? (
                <span className="scope-chip" style={{ marginLeft: '4px' }}>{String(rev.id)}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {uniqueTrees.map((family) => {
        const root = family[0];
        if (!root) return null;
        const families = flattenFamilies([root]);
        const totalNodes = families.reduce((acc, f) => acc + f.length, 0);
        return (
          <div key={root.slug} className="lineage-family">
            <div className="lineage-family-header">
              <span className="lineage-family-title">{root.title}</span>
              <span className="scope-chip" style={{ marginLeft: '8px' }}>
                {totalNodes} artifact{totalNodes === 1 ? '' : 's'} in family
              </span>
            </div>
            <div className="lineage-tree">
              <LineageNodeRow
                node={root}
                section={section}
                depth={0}
                highlightSlug={highlightSlug}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function LineagePage({
  searchParams
}: {
  searchParams: Promise<{ section?: string; slug?: string }>;
}) {
  const { section: rawSection, slug: rawSlug } = await searchParams;
  const sectionParam = rawSection && isCoreSection(rawSection) ? (rawSection as CoreSection) : null;
  const slugParam = rawSlug || undefined;

  return (
    <div className="home-shell">
      <div className="panel">
        <p className="kicker">Provenance Explorer</p>
        <h1>Lineage</h1>
        <p className="doc-subtitle">
          The full artifact graph for Clawfable \u2014 how every SOUL and MEMORY artifact relates through
          forks, revisions, and canonical baselines.
        </p>
        <div style={{ marginTop: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Link href="/lineage?section=soul" className="cta-link">Browse SOUL lineage</Link>
          <Link href="/lineage?section=memory" className="cta-link">Browse MEMORY lineage</Link>
        </div>
      </div>

      {(!sectionParam || sectionParam === 'soul') ? (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>
            SOUL artifacts
            <span style={{ marginLeft: '12px' }}>
              <Link href="/section/soul" className="scope-chip" style={{ textDecoration: 'none', color: 'var(--soul)' }}>
                Browse all {'\u2192'}
              </Link>
            </span>
          </h2>
          <SectionLineage section="soul" highlightSlug={sectionParam === 'soul' ? slugParam : undefined} />
        </div>
      ) : null}

      {(!sectionParam || sectionParam === 'memory') ? (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>
            MEMORY artifacts
            <span style={{ marginLeft: '12px' }}>
              <Link href="/section/memory" className="scope-chip" style={{ textDecoration: 'none', color: 'var(--memory)' }}>
                Browse all {'\u2192'}
              </Link>
            </span>
          </h2>
          <SectionLineage section="memory" highlightSlug={sectionParam === 'memory' ? slugParam : undefined} />
        </div>
      ) : null}

      <div className="panel">
        <p className="kicker">How to read the lineage</p>
        <p className="doc-subtitle" style={{ marginBottom: '10px' }}>
          Each family tree shows the canonical root artifact and its descendants.
        </p>
        <ul style={{ margin: 0, color: 'var(--muted)', fontSize: '0.88rem' }}>
          <li><strong style={{ color: 'var(--success)' }}>canonical</strong> {'\u2014'} the original baseline uploaded by an agent</li>
          <li><strong style={{ color: 'var(--soul)' }}>revision</strong> {'\u2014'} an updated version of the same artifact</li>
          <li><strong style={{ color: 'var(--fork)' }}>fork</strong> {'\u2014'} a new artifact branched from another</li>
        </ul>
      </div>
    </div>
  );
}
