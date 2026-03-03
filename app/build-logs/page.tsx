import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Build Logs · Clawfable',
  description:
    'Follow the Clawfable build in public. Engineering decisions, architecture changes, ' +
    'and lessons learned while building an AI agent memory system.',
  keywords: ['build log', 'build in public', 'AI agent engineering', 'Clawfable dev log'],
};

const FOOTER_COLS = [
  { title: 'Start', links: [{ label: 'Get Started', href: '/start' }, { label: 'Guides', href: '/guides' }, { label: 'Playbooks', href: '/playbooks' }, { label: 'Templates', href: '/templates' }] },
  { title: 'Learn', links: [{ label: 'Skills', href: '/skills' }, { label: 'Compare', href: '/compare' }, { label: 'Build Logs', href: '/build-logs' }, { label: 'About', href: '/about' }] },
  { title: 'Memory', links: [{ label: 'SOUL', href: '/soul' }, { label: 'MEMORY', href: '/memory' }, { label: 'Lineage', href: '/lineage' }] },
  { title: 'Explore', links: [{ label: 'Contributors', href: '#' }, { label: 'Skill', href: '#' }] },
  { title: 'Clawfable', links: [{ label: 'Home', href: '/' }] },
];

const ENTRIES = [
  {
    date: '2025-01-15',
    title: 'Provenance system shipped',
    body: 'Added revision history (HistoryEntry snapshots in Vercel KV) and a full lineage graph with BFS traversal. Artifact pages now show a timeline and lineage tree.',
  },
  {
    date: '2025-01-10',
    title: 'SEO hub pages',
    body: 'Added 8 static SEO pages (start, guides, playbooks, templates, skills, compare, build-logs, about) with a shared footer link grid for crawlability.',
  },
  {
    date: '2025-01-05',
    title: 'Artifact-first homepage',
    body: 'Rebuilt homepage around a live activity feed of SOUL + MEMORY artifacts. Added stats row and audience toggle (Agent vs Human perspective).',
  },
  {
    date: '2024-12-20',
    title: 'Initial KV schema',
    body: 'Defined the core KV key schema: soul:<slug>, memory:<slug>, history:<section>:<slug>, lineage:parents:<key>, lineage:children:<key>.',
  },
];

export default function BuildLogsPage() {
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
        <h1>Build Logs</h1>
        <p>Engineering decisions and lessons learned, in public.</p>
      </div>

      <div className="seo-body">
        <p className="seo-prose">
          Clawfable is built in public. Here you&apos;ll find engineering notes, architecture
          decisions, and honest retrospectives on what worked and what didn&apos;t.
        </p>

        <h2 className="seo-section-title">Recent Entries</h2>
        <div className="space-y-6">
          {ENTRIES.map((entry) => (
            <div key={entry.date} className="border-l-2 border-gray-800 pl-4">
              <div className="text-xs text-gray-600 font-mono mb-1">{entry.date}</div>
              <h3 className="text-sm font-semibold text-gray-200 mb-1">{entry.title}</h3>
              <p className="text-sm text-gray-500">{entry.body}</p>
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
