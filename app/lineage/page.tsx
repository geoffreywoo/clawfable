import Link from 'next/link';
import type { Metadata } from 'next';
import { listAllLineageEdges } from '../../lib/content';
import { kv } from '@vercel/kv';

export const metadata: Metadata = {
  title: 'Lineage Graph · Clawfable',
  description:
    'Explore the artifact lineage graph for Clawfable. See how SOUL and MEMORY artifacts ' +
    'derive from and spawn each other over time.',
  keywords: ['artifact lineage', 'provenance graph', 'AI agent memory lineage', 'Clawfable lineage'],
};

type NodeInfo = {
  key: string;
  title: string;
  section: string;
  slug: string;
};

async function resolveNodeInfo(key: string): Promise<NodeInfo> {
  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) return { key, title: key, section: '', slug: key };
  const section = key.slice(0, colonIdx);
  const slug = key.slice(colonIdx + 1);
  try {
    const raw = await kv.get<Record<string, unknown>>(key);
    const title = raw && typeof raw.title === 'string' ? raw.title : slug;
    return { key, title, section, slug };
  } catch {
    return { key, title: slug, section, slug };
  }
}

export default async function LineagePage() {
  let edges: Array<{ from: string; to: string }> = [];
  try {
    edges = await listAllLineageEdges();
  } catch {
    edges = [];
  }

  // Collect all unique keys
  const allKeys = new Set<string>();
  for (const e of edges) {
    allKeys.add(e.from);
    allKeys.add(e.to);
  }

  // Resolve node info in parallel
  const nodeMap = new Map<string, NodeInfo>();
  if (allKeys.size > 0) {
    const infos = await Promise.all(Array.from(allKeys).map(resolveNodeInfo));
    for (const info of infos) {
      nodeMap.set(info.key, info);
    }
  }

  // Topological sort (Kahn's algorithm) for display ordering
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();
  for (const key of allKeys) {
    inDegree.set(key, 0);
    outEdges.set(key, []);
  }
  for (const e of edges) {
    outEdges.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const levels: string[][] = [];
  let frontier = Array.from(allKeys).filter((k) => inDegree.get(k) === 0);
  while (frontier.length > 0) {
    levels.push(frontier);
    const next: string[] = [];
    for (const node of frontier) {
      for (const child of outEdges.get(node) ?? []) {
        const deg = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, deg);
        if (deg === 0) next.push(child);
      }
    }
    frontier = next;
  }

  // Any remaining nodes (cycles) go in a final level
  const placed = new Set(levels.flat());
  const remaining = Array.from(allKeys).filter((k) => !placed.has(k));
  if (remaining.length > 0) levels.push(remaining);

  const FOOTER_COLS = [
    { title: 'Start', links: [{ label: 'Get Started', href: '/start' }, { label: 'Guides', href: '/guides' }, { label: 'Playbooks', href: '/playbooks' }, { label: 'Templates', href: '/templates' }] },
    { title: 'Learn', links: [{ label: 'Skills', href: '/skills' }, { label: 'Compare', href: '/compare' }, { label: 'Build Logs', href: '/build-logs' }, { label: 'About', href: '/about' }] },
    { title: 'Memory', links: [{ label: 'SOUL', href: '/soul' }, { label: 'MEMORY', href: '/memory' }, { label: 'Lineage', href: '/lineage' }] },
    { title: 'Explore', links: [{ label: 'Contributors', href: '#' }, { label: 'Skill', href: '#' }] },
    { title: 'Clawfable', links: [{ label: 'Home', href: '/' }] },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <nav className="border-b border-gray-800 px-4 py-3 flex items-center gap-4 text-sm sticky top-0 bg-[#0a0a0a]/90 backdrop-blur z-10">
        <Link href="/" className="text-gray-400 hover:text-white">Home</Link>
        <span className="text-gray-700">/</span>
        <Link href="/soul" className="text-gray-400 hover:text-white">SOUL</Link>
        <span className="text-gray-700">/</span>
        <Link href="/memory" className="text-gray-400 hover:text-white">MEMORY</Link>
        <span className="text-gray-700">/</span>
        <Link href="/lineage" className="text-gray-400 hover:text-white">Lineage</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-500">Contributors</span>
        <span className="text-gray-700">/</span>
        <span className="text-gray-500">Skill</span>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-white mb-2">Lineage Graph</h1>
        <p className="text-gray-500 text-sm mb-8">
          Directed provenance graph of all artifacts. Roots at top, leaves at bottom.
        </p>

        {levels.length === 0 ? (
          <div className="text-center py-20 text-gray-600">
            <p className="text-lg mb-2">No lineage data yet.</p>
            <p className="text-sm">
              Use <code className="font-mono text-gray-500">linkLineage()</code> to connect artifacts.
            </p>
          </div>
        ) : (
          <div className="lineage-graph">
            {levels.map((level, li) => (
              <div key={li}>
                <div className="lineage-level">
                  {level.map((key) => {
                    const info = nodeMap.get(key);
                    if (!info) return null;
                    const href = info.section && info.slug ? `/${info.section}/${info.slug}` : '#';
                    return (
                      <Link key={key} href={href} className="lineage-node">
                        {info.title}
                      </Link>
                    );
                  })}
                </div>
                {li < levels.length - 1 && (
                  <div className="lineage-edge">↓</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="footer-link-grid">
        <div className="footer-inner">
          <div className="footer-cols">
            {FOOTER_COLS.map((col) => (
              <div key={col.title} className="footer-col">
                <div className="footer-col-title">{col.title}</div>
                <ul>{col.links.map((link) => (<li key={link.label}><Link href={link.href}>{link.label}</Link></li>))}</ul>
              </div>
            ))}
          </div>
          <div className="footer-bottom">Clawfable · AI agent memory &amp; soul system</div>
        </div>
      </footer>
    </div>
  );
}
