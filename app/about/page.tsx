import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About Clawfable · AI Agent Memory & Soul System',
  description:
    'Learn about Clawfable — the artifact-first memory and soul system for AI agents. ' +
    'Our mission, architecture, and the team behind it.',
  keywords: ['about Clawfable', 'AI agent memory system', 'artifact provenance', 'agent soul'],
};

const FOOTER_COLS = [
  {
    title: 'Start',
    links: [
      { label: 'Get Started', href: '/start' },
      { label: 'Guides', href: '/guides' },
      { label: 'Playbooks', href: '/playbooks' },
      { label: 'Templates', href: '/templates' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { label: 'Skills', href: '/skills' },
      { label: 'Compare', href: '/compare' },
      { label: 'Build Logs', href: '/build-logs' },
      { label: 'About', href: '/about' },
    ],
  },
  {
    title: 'Memory',
    links: [
      { label: 'SOUL', href: '/soul' },
      { label: 'MEMORY', href: '/memory' },
      { label: 'Lineage', href: '/lineage' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { label: 'Contributors', href: '#' },
      { label: 'Skill', href: '#' },
    ],
  },
  {
    title: 'Clawfable',
    links: [
      { label: 'Home', href: '/' },
    ],
  },
];

export default function AboutPage() {
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
        <h1>About Clawfable</h1>
        <p>The artifact-first memory and soul system for AI agents.</p>
      </div>

      <div className="seo-body">
        <p className="seo-prose">
          <strong>Clawfable</strong> is a persistence and provenance layer built for AI agents.
          It stores the artifacts that make agents coherent across sessions: goals,
          constraints, memories, skills, decisions, and the lineage connecting them.
        </p>

        <h2 className="seo-section-title">Mission</h2>
        <p className="seo-prose">
          AI agents are only as good as their memory. Clawfable gives agents a structured,
          versionable, queryable store for everything they need to know — and a complete
          audit trail of how that knowledge evolved.
        </p>

        <h2 className="seo-section-title">Architecture</h2>
        <div className="seo-card-grid">
          <div className="seo-card">
            <h3>SOUL</h3>
            <p>Foundational identity: goals, values, constraints, and behavioral guidelines.</p>
          </div>
          <div className="seo-card">
            <h3>MEMORY</h3>
            <p>Episodic and semantic memory: events, facts, decisions, and learned patterns.</p>
          </div>
          <div className="seo-card">
            <h3>Lineage</h3>
            <p>Directed provenance graph: where every artifact came from and what it spawned.</p>
          </div>
          <div className="seo-card">
            <h3>History</h3>
            <p>Timestamped revision log for every artifact mutation, with full snapshots.</p>
          </div>
        </div>

        <h2 className="seo-section-title">Frequently Asked Questions</h2>
        <div>
          <div className="seo-faq-item">
            <h3>Is Clawfable open source?</h3>
            <p>Clawfable is currently in private development. Public release plans are TBD.</p>
          </div>
          <div className="seo-faq-item">
            <h3>What AI frameworks does Clawfable work with?</h3>
            <p>
              Clawfable is framework-agnostic. It exposes a simple KV-backed API that any
              agent runtime can call.
            </p>
          </div>
          <div className="seo-faq-item">
            <h3>How is data stored?</h3>
            <p>
              Artifacts are stored as JSON objects in Vercel KV (Redis-compatible).
              History and lineage use structured key patterns for fast lookups.
            </p>
          </div>
        </div>
      </div>

      <footer className="footer-link-grid">
        <div className="footer-inner">
          <div className="footer-cols">
            {FOOTER_COLS.map((col) => (
              <div key={col.title} className="footer-col">
                <div className="footer-col-title">{col.title}</div>
                <ul>
                  {col.links.map((link) => (
                    <li key={link.label}><Link href={link.href}>{link.label}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="footer-bottom">Clawfable · AI agent memory &amp; soul system</div>
        </div>
      </footer>
    </div>
  );
}
