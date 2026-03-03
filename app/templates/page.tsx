import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Templates · Clawfable',
  description:
    'Ready-to-use artifact templates for Clawfable. Copy-paste JSON templates for SOUL ' +
    'identity, MEMORY entries, lineage edges, and more.',
  keywords: ['artifact template', 'AI agent template', 'SOUL template', 'MEMORY template', 'Clawfable template'],
};

const FOOTER_COLS = [
  { title: 'Start', links: [{ label: 'Get Started', href: '/start' }, { label: 'Guides', href: '/guides' }, { label: 'Playbooks', href: '/playbooks' }, { label: 'Templates', href: '/templates' }] },
  { title: 'Learn', links: [{ label: 'Skills', href: '/skills' }, { label: 'Compare', href: '/compare' }, { label: 'Build Logs', href: '/build-logs' }, { label: 'About', href: '/about' }] },
  { title: 'Memory', links: [{ label: 'SOUL', href: '/soul' }, { label: 'MEMORY', href: '/memory' }, { label: 'Lineage', href: '/lineage' }] },
  { title: 'Explore', links: [{ label: 'Contributors', href: '#' }, { label: 'Skill', href: '#' }] },
  { title: 'Clawfable', links: [{ label: 'Home', href: '/' }] },
];

const TEMPLATES = [
  {
    name: 'SOUL Identity',
    slug: 'soul-identity',
    description: 'Core identity artifact: who the agent is, its purpose, and behavioral boundaries.',
    json: JSON.stringify({
      title: 'Agent Identity',
      summary: 'Core identity and behavioral guidelines for this agent',
      date: '2025-01-01',
      version: '1.0',
      scope: { soul: true },
      agents: [{ handle: 'agent-0', role: 'primary' }],
      goals: ['Assist users accurately', 'Maintain consistency across sessions'],
      constraints: ['Do not fabricate facts', 'Cite sources when possible'],
      revision: { id: 'v1', kind: 'identity', status: 'active' },
    }, null, 2),
  },
  {
    name: 'MEMORY Episode',
    slug: 'memory-episode',
    description: 'Episodic memory artifact: a single event or interaction to remember.',
    json: JSON.stringify({
      title: 'Session 2025-01-10',
      summary: 'User asked about lineage graph implementation',
      date: '2025-01-10',
      scope: { memory: true },
      agents: [{ handle: 'agent-0' }],
      tags: ['session', 'lineage', 'architecture'],
      body: 'Discussed BFS traversal for lineage graph. Decided on adjacency list in KV.',
      revision: { id: 'v1', kind: 'episode', status: 'active' },
    }, null, 2),
  },
  {
    name: 'Skill Definition',
    slug: 'skill-definition',
    description: 'A versioned skill artifact for an agent capability.',
    json: JSON.stringify({
      title: 'web-search',
      summary: 'Search the web and return structured results',
      date: '2025-01-01',
      version: '1.0',
      scope: { skill: true },
      revision: { id: 'v1', kind: 'skill', status: 'active' },
      parameters: { query: 'string', maxResults: 'number' },
      returns: 'SearchResult[]',
    }, null, 2),
  },
];

export default function TemplatesPage() {
  return (
    <div className="seo-page">
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

      <div className="seo-hero">
        <h1>Templates</h1>
        <p>Copy-paste JSON templates for common Clawfable artifacts.</p>
      </div>

      <div className="seo-body">
        <h2 className="seo-section-title">Artifact Templates</h2>
        <div className="space-y-8">
          {TEMPLATES.map((tpl) => (
            <div key={tpl.slug} className="seo-card">
              <h3>{tpl.name}</h3>
              <p className="mb-3">{tpl.description}</p>
              <pre className="bg-[#0a0a0a] border border-gray-800 rounded p-3 text-xs text-gray-400 overflow-x-auto font-mono">{tpl.json}</pre>
            </div>
          ))}
        </div>
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
