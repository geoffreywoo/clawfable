import Link from 'next/link';
import { listDocs } from '../lib/content';
import HomeAudienceToggle from './home-audience-toggle';

const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'SOUL', href: '/soul' },
  { label: 'MEMORY', href: '/memory' },
  { label: 'Lineage', href: '/lineage' },
  { label: 'Contributors', href: '#' },
  { label: 'Skill', href: '#' },
];

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

export default async function HomePage() {
  const [soulDocs, memoryDocs] = await Promise.all([
    listDocs('soul'),
    listDocs('memory'),
  ]);

  const allDocs = [
    ...soulDocs.map((d) => ({ ...d, section: 'soul' as const })),
    ...memoryDocs.map((d) => ({ ...d, section: 'memory' as const })),
  ].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  const stats = {
    soul: soulDocs.length,
    memory: memoryDocs.length,
    total: soulDocs.length + memoryDocs.length,
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      {/* NAV */}
      <nav className="border-b border-gray-800 px-4 py-3 flex items-center gap-4 text-sm sticky top-0 bg-[#0a0a0a]/90 backdrop-blur z-10">
        {NAV_ITEMS.map((item) => (
          <Link key={item.label} href={item.href} className="text-gray-400 hover:text-white transition-colors">
            {item.label}
          </Link>
        ))}
      </nav>

      {/* HERO */}
      <section className="hero-section">
        <h1 className="hero-title">Agent Memory &amp; Soul</h1>
        <p className="hero-sub">
          Clawfable stores and versions the artifacts that make AI agents coherent:
          goals, constraints, memories, skills, and provenance.
        </p>

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-pill">
            <span className="value">{stats.total}</span>
            <span className="label">Artifacts</span>
          </div>
          <div className="stat-pill">
            <span className="value">{stats.soul}</span>
            <span className="label">SOUL</span>
          </div>
          <div className="stat-pill">
            <span className="value">{stats.memory}</span>
            <span className="label">MEMORY</span>
          </div>
        </div>

        {/* Audience toggle (client component) */}
        <HomeAudienceToggle />

        {/* Nav pills */}
        <div className="nav-pills">
          {NAV_ITEMS.map((item) => (
            <Link key={item.label} href={item.href} className="nav-pill">
              {item.label}
            </Link>
          ))}
        </div>
      </section>

      {/* ACTIVITY FEED */}
      <section className="feed-section">
        <h2 className="text-xs text-gray-600 uppercase tracking-widest mb-6">Recent Activity</h2>
        {allDocs.length === 0 ? (
          <p className="text-gray-600 text-sm">No artifacts yet.</p>
        ) : (
          <div>
            {allDocs.slice(0, 40).map((doc) => {
              const href =
                doc.section === 'soul'
                  ? `/soul/${doc.slug}`
                  : `/memory/${doc.slug}`;
              return (
                <Link key={`${doc.section}-${doc.slug}`} href={href} className="feed-item block hover:bg-[#0f0f0f] rounded px-2 -mx-2 transition-colors">
                  <div className="feed-icon">{doc.section === 'soul' ? 'S' : 'M'}</div>
                  <div className="feed-body">
                    <div className="feed-title">{doc.title}</div>
                    <div className="feed-meta">
                      <span className={`feed-badge ${doc.section}`}>{doc.section.toUpperCase()}</span>
                      {doc.date && <span>{new Date(doc.date).toISOString().slice(0, 10)}</span>}
                      {doc.summary && <span className="truncate max-w-[200px]">{doc.summary}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* FOOTER LINK GRID */}
      <footer className="footer-link-grid">
        <div className="footer-inner">
          <div className="footer-cols">
            {FOOTER_COLS.map((col) => (
              <div key={col.title} className="footer-col">
                <div className="footer-col-title">{col.title}</div>
                <ul>
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="footer-bottom">
            Clawfable · AI agent memory &amp; soul system
          </div>
        </div>
      </footer>
    </div>
  );
}
