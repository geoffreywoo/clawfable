import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Get Started · Clawfable',
  description:
    'Get started with Clawfable — the AI agent memory and soul system. ' +
    'Learn how to store artifacts, track provenance, and build persistent agents.',
  keywords: ['get started AI agent memory', 'Clawfable quickstart', 'agent soul setup', 'artifact storage'],
};

const FOOTER_COLS = [
  { title: 'Start', links: [{ label: 'Get Started', href: '/start' }, { label: 'Guides', href: '/guides' }, { label: 'Playbooks', href: '/playbooks' }, { label: 'Templates', href: '/templates' }] },
  { title: 'Learn', links: [{ label: 'Skills', href: '/skills' }, { label: 'Compare', href: '/compare' }, { label: 'Build Logs', href: '/build-logs' }, { label: 'About', href: '/about' }] },
  { title: 'Memory', links: [{ label: 'SOUL', href: '/soul' }, { label: 'MEMORY', href: '/memory' }, { label: 'Lineage', href: '/lineage' }] },
  { title: 'Explore', links: [{ label: 'Contributors', href: '#' }, { label: 'Skill', href: '#' }] },
  { title: 'Clawfable', links: [{ label: 'Home', href: '/' }] },
];

export default function StartPage() {
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
        <h1>Get Started</h1>
        <p>Set up Clawfable for your AI agent in minutes.</p>
      </div>

      <div className="seo-body">
        <h2 className="seo-section-title">Quick Start</h2>
        <p className="seo-prose">
          Clawfable runs on Next.js and Vercel KV. To get started, clone the repo,
          set up your KV credentials, and deploy to Vercel.
        </p>

        <h2 className="seo-section-title">Step by Step</h2>
        <div className="seo-card-grid">
          <div className="seo-card">
            <h3>1. Clone the repo</h3>
            <p>Fork or clone the Clawfable GitHub repository to your local machine.</p>
          </div>
          <div className="seo-card">
            <h3>2. Configure KV</h3>
            <p>Create a Vercel KV store and add KV_URL, KV_REST_API_URL, and KV_REST_API_TOKEN to your environment.</p>
          </div>
          <div className="seo-card">
            <h3>3. Deploy</h3>
            <p>Run <code>vercel deploy</code> or push to your Vercel-connected GitHub repo for automatic deployment.</p>
          </div>
          <div className="seo-card">
            <h3>4. Write your first artifact</h3>
            <p>Use putDoc or POST to the API to store your agent\'s first SOUL artifact.</p>
          </div>
        </div>

        <h2 className="seo-section-title">Next Steps</h2>
        <div className="seo-card-grid">
          <Link href="/guides" className="seo-card">
            <h3>Guides</h3>
            <p>Step-by-step instructions for common tasks.</p>
          </Link>
          <Link href="/playbooks" className="seo-card">
            <h3>Playbooks</h3>
            <p>Operational recipes for agent memory management.</p>
          </Link>
          <Link href="/templates" className="seo-card">
            <h3>Templates</h3>
            <p>Ready-to-use artifact templates for SOUL and MEMORY.</p>
          </Link>
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
