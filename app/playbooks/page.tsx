import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Playbooks · Clawfable',
  description:
    'Operational playbooks for common AI agent memory patterns. ' +
    'Proven recipes for SOUL setup, MEMORY management, and lineage tracking.',
  keywords: ['AI agent playbook', 'agent memory patterns', 'Clawfable playbook', 'agent soul setup'],
};

const FOOTER_COLS = [
  { title: 'Start', links: [{ label: 'Get Started', href: '/start' }, { label: 'Guides', href: '/guides' }, { label: 'Playbooks', href: '/playbooks' }, { label: 'Templates', href: '/templates' }] },
  { title: 'Learn', links: [{ label: 'Skills', href: '/skills' }, { label: 'Compare', href: '/compare' }, { label: 'Build Logs', href: '/build-logs' }, { label: 'About', href: '/about' }] },
  { title: 'Memory', links: [{ label: 'SOUL', href: '/soul' }, { label: 'MEMORY', href: '/memory' }, { label: 'Lineage', href: '/lineage' }] },
  { title: 'Explore', links: [{ label: 'Contributors', href: '#' }, { label: 'Skill', href: '#' }] },
  { title: 'Clawfable', links: [{ label: 'Home', href: '/' }] },
];

const PLAYBOOKS = [
  {
    title: 'Bootstrap a new agent',
    description: 'Set up SOUL artifacts (identity, goals, constraints) and an initial MEMORY baseline for a new AI agent.',
    steps: ['Define identity artifact in SOUL', 'Write goal and constraint docs', 'Create initial MEMORY seed', 'Link all with linkLineage'],
  },
  {
    title: 'Version a major goal change',
    description: 'When an agent\'s goals change significantly, create a new SOUL artifact and record the lineage.',
    steps: ['Snapshot current artifact via putDocWithHistory', 'Write new version', 'Link old → new with linkLineage', 'Update agent\'s SOUL reference'],
  },
  {
    title: 'Audit a decision trail',
    description: 'Trace the provenance of a decision artifact from origin through all derived artifacts.',
    steps: ['Fetch artifact with getArtifactLineage', 'Walk graph with walkLineageGraph', 'Review HistoryEntry log', 'Export for reporting'],
  },
  {
    title: 'Purge stale memory',
    description: 'Safely remove old MEMORY artifacts while preserving their lineage record.',
    steps: ['Identify stale slugs', 'Archive snapshot via appendHistory', 'Call deleteDoc', 'Optionally call deleteLineage'],
  },
];

export default function PlaybooksPage() {
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
        <h1>Playbooks</h1>
        <p>Proven recipes for common AI agent memory operations.</p>
      </div>

      <div className="seo-body">
        <h2 className="seo-section-title">All Playbooks</h2>
        <div className="space-y-8">
          {PLAYBOOKS.map((pb) => (
            <div key={pb.title} className="seo-card">
              <h3>{pb.title}</h3>
              <p className="mb-3">{pb.description}</p>
              <ol className="list-decimal list-inside space-y-1">
                {pb.steps.map((step) => (
                  <li key={step} className="text-xs text-gray-500 font-mono">{step}</li>
                ))}
              </ol>
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
