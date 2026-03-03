import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Guides · Clawfable',
  description:
    'Step-by-step guides for using Clawfable to build AI agent memory systems. ' +
    'Learn how to store artifacts, track provenance, and query lineage.',
  keywords: ['AI agent memory guide', 'Clawfable guide', 'artifact storage tutorial', 'agent provenance'],
};

const FOOTER_COLS = [
  { title: 'Start', links: [{ label: 'Get Started', href: '/start' }, { label: 'Guides', href: '/guides' }, { label: 'Playbooks', href: '/playbooks' }, { label: 'Templates', href: '/templates' }] },
  { title: 'Learn', links: [{ label: 'Skills', href: '/skills' }, { label: 'Compare', href: '/compare' }, { label: 'Build Logs', href: '/build-logs' }, { label: 'About', href: '/about' }] },
  { title: 'Memory', links: [{ label: 'SOUL', href: '/soul' }, { label: 'MEMORY', href: '/memory' }, { label: 'Lineage', href: '/lineage' }] },
  { title: 'Explore', links: [{ label: 'Contributors', href: '#' }, { label: 'Skill', href: '#' }] },
  { title: 'Clawfable', links: [{ label: 'Home', href: '/' }] },
];

const GUIDES = [
  {
    title: 'Storing your first artifact',
    description: 'Write a SOUL or MEMORY artifact to Vercel KV using the putDoc API.',
    href: '#',
  },
  {
    title: 'Tracking revision history',
    description: 'Use putDocWithHistory to atomically save a doc and record a HistoryEntry.',
    href: '#',
  },
  {
    title: 'Building a lineage graph',
    description: 'Link artifacts with linkLineage and explore the graph at /lineage.',
    href: '#',
  },
  {
    title: 'Querying via the REST API',
    description: 'Use GET /api/artifacts/history and POST /api/artifacts/history from any client.',
    href: '#',
  },
  {
    title: 'Paginating large artifact lists',
    description: 'Use listDocsPaginated to build infinite-scroll or paged artifact browsers.',
    href: '#',
  },
  {
    title: 'Integrating with LangChain',
    description: 'Call Clawfable from a LangChain tool to persist agent memory between runs.',
    href: '#',
  },
];

export default function GuidesPage() {
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
        <h1>Guides</h1>
        <p>Step-by-step instructions for building with Clawfable.</p>
      </div>

      <div className="seo-body">
        <h2 className="seo-section-title">All Guides</h2>
        <div className="seo-card-grid">
          {GUIDES.map((g) => (
            <Link key={g.title} href={g.href} className="seo-card">
              <h3>{g.title}</h3>
              <p>{g.description}</p>
            </Link>
          ))}
        </div>

        <h2 className="seo-section-title">Frequently Asked Questions</h2>
        <div>
          <div className="seo-faq-item">
            <h3>Do I need to know TypeScript to use Clawfable?</h3>
            <p>The core library is TypeScript, but the REST API is language-agnostic. Any HTTP client can interact with Clawfable.</p>
          </div>
          <div className="seo-faq-item">
            <h3>Can I use Clawfable without Vercel KV?</h3>
            <p>The current implementation targets Vercel KV. Alternative storage backends are on the roadmap.</p>
          </div>
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
