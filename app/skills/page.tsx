import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Skills · Clawfable',
  description:
    'Skills available in the Clawfable system. Reusable capability definitions that agents ' +
    'can load, version, and reference in their SOUL.',
  keywords: ['AI agent skills', 'reusable agent capabilities', 'Clawfable skills', 'agent skill registry'],
};

const FOOTER_COLS = [
  { title: 'Start', links: [{ label: 'Get Started', href: '/start' }, { label: 'Guides', href: '/guides' }, { label: 'Playbooks', href: '/playbooks' }, { label: 'Templates', href: '/templates' }] },
  { title: 'Learn', links: [{ label: 'Skills', href: '/skills' }, { label: 'Compare', href: '/compare' }, { label: 'Build Logs', href: '/build-logs' }, { label: 'About', href: '/about' }] },
  { title: 'Memory', links: [{ label: 'SOUL', href: '/soul' }, { label: 'MEMORY', href: '/memory' }, { label: 'Lineage', href: '/lineage' }] },
  { title: 'Explore', links: [{ label: 'Contributors', href: '#' }, { label: 'Skill', href: '#' }] },
  { title: 'Clawfable', links: [{ label: 'Home', href: '/' }] },
];

const SKILLS = [
  { name: 'web-search', description: 'Search the web and return structured results. Versioned in SOUL for reproducibility.' },
  { name: 'kv-read', description: 'Read an artifact from Vercel KV by section and slug.' },
  { name: 'kv-write', description: 'Write or update an artifact in Vercel KV with optional history.' },
  { name: 'lineage-link', description: 'Create a parent→child lineage edge between two artifacts.' },
  { name: 'history-append', description: 'Append a HistoryEntry to an artifact\'s revision log.' },
  { name: 'doc-list', description: 'List all artifacts in a section with pagination support.' },
  { name: 'graph-walk', description: 'BFS traversal of the lineage graph from a starting artifact.' },
];

export default function SkillsPage() {
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
        <h1>Skills</h1>
        <p>Reusable capability definitions for Clawfable agents.</p>
      </div>

      <div className="seo-body">
        <h2 className="seo-section-title">Available Skills</h2>
        <div className="seo-card-grid">
          {SKILLS.map((skill) => (
            <div key={skill.name} className="seo-card">
              <h3>{skill.name}</h3>
              <p>{skill.description}</p>
            </div>
          ))}
        </div>

        <h2 className="seo-section-title">Frequently Asked Questions</h2>
        <div>
          <div className="seo-faq-item">
            <h3>What is a skill in Clawfable?</h3>
            <p>A skill is a versioned capability definition stored in SOUL. Agents reference skills by slug and can pin to specific versions for reproducibility.</p>
          </div>
          <div className="seo-faq-item">
            <h3>Can I add custom skills?</h3>
            <p>Yes. Write a skill artifact to the SOUL section using putDoc or the REST API. Skills are just structured JSON artifacts.</p>
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
