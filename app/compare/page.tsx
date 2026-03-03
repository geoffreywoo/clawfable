import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Compare AI Agent Memory Systems · Clawfable',
  description:
    'How does Clawfable compare to other AI agent memory and state management approaches? ' +
    'Side-by-side comparison of features, architecture, and trade-offs.',
  keywords: [
    'AI agent memory comparison',
    'agent state management',
    'Clawfable vs alternatives',
    'agent memory architecture',
  ],
};

const FOOTER_COLS = [
  { title: 'Start', links: [{ label: 'Get Started', href: '/start' }, { label: 'Guides', href: '/guides' }, { label: 'Playbooks', href: '/playbooks' }, { label: 'Templates', href: '/templates' }] },
  { title: 'Learn', links: [{ label: 'Skills', href: '/skills' }, { label: 'Compare', href: '/compare' }, { label: 'Build Logs', href: '/build-logs' }, { label: 'About', href: '/about' }] },
  { title: 'Memory', links: [{ label: 'SOUL', href: '/soul' }, { label: 'MEMORY', href: '/memory' }, { label: 'Lineage', href: '/lineage' }] },
  { title: 'Explore', links: [{ label: 'Contributors', href: '#' }, { label: 'Skill', href: '#' }] },
  { title: 'Clawfable', links: [{ label: 'Home', href: '/' }] },
];

const COMPARISON = [
  {
    feature: 'Artifact versioning',
    clawfable: '✓ Full history with snapshots',
    generic: '✗ Usually not built-in',
    notes: 'Clawfable stores every mutation as a HistoryEntry',
  },
  {
    feature: 'Lineage graph',
    clawfable: '✓ Directed parent→child graph',
    generic: '✗ Rarely supported',
    notes: 'Track which artifacts derived from which',
  },
  {
    feature: 'SOUL / identity layer',
    clawfable: '✓ Dedicated SOUL section',
    generic: '~ Ad-hoc system prompts',
    notes: 'Goals, values, constraints versioned like code',
  },
  {
    feature: 'MEMORY layer',
    clawfable: '✓ Structured episodic + semantic',
    generic: '~ Vector DB or raw text',
    notes: 'Structured JSON with full metadata',
  },
  {
    feature: 'Provenance API',
    clawfable: '✓ REST API for history & lineage',
    generic: '✗ Usually none',
    notes: 'GET/POST /api/artifacts/history',
  },
  {
    feature: 'Storage backend',
    clawfable: 'Vercel KV (Redis)',
    generic: 'Varies',
    notes: 'Simple, fast, serverless-native',
  },
  {
    feature: 'Framework coupling',
    clawfable: 'None (JSON API)',
    generic: 'Often tightly coupled',
    notes: 'Any agent runtime can call Clawfable',
  },
];

const FAQS = [
  {
    q: 'How is Clawfable different from a vector database?',
    a: 'Vector databases optimize for semantic similarity search. Clawfable optimizes for structured artifact storage, versioning, and provenance. They are complementary — you can use both.',
  },
  {
    q: 'Can I use Clawfable with LangChain or AutoGPT?',
    a: 'Yes. Clawfable exposes a simple JSON API. Any agent framework that can make HTTP requests can integrate with it.',
  },
  {
    q: 'Is Clawfable a replacement for a traditional database?',
    a: 'No. Clawfable is a purpose-built artifact store with provenance semantics. For relational data, use a traditional DB alongside Clawfable.',
  },
];

export default function ComparePage() {
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
        <h1>Compare Memory Systems</h1>
        <p>How Clawfable stacks up against other approaches to AI agent state.</p>
      </div>

      <div className="seo-body">
        <h2 className="seo-section-title">Feature Comparison</h2>
        <table className="seo-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Clawfable</th>
              <th>Generic Alternatives</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.feature}>
                <td className="font-medium text-gray-300">{row.feature}</td>
                <td className="text-green-400 font-mono text-xs">{row.clawfable}</td>
                <td className="text-gray-500 font-mono text-xs">{row.generic}</td>
                <td className="text-gray-600 text-xs">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="seo-section-title">Frequently Asked Questions</h2>
        <div>
          {FAQS.map((faq) => (
            <div key={faq.q} className="seo-faq-item">
              <h3>{faq.q}</h3>
              <p>{faq.a}</p>
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
