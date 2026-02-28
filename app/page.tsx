import Link from 'next/link';
import { listBySection } from '../lib/content';

const featured = [
  {
    key: 'guides',
    title: 'Guides',
    blurb: 'Set up OpenClaw correctly and avoid common failure modes.',
    href: '/section/guides'
  },
  {
    key: 'playbooks',
    title: 'Playbooks',
    blurb: 'Deploy proven workflows for founder ops, content, lead gen, and support.',
    href: '/section/playbooks'
  },
  {
    key: 'templates',
    title: 'Templates',
    blurb: 'Use ready-made assets to ship faster with less guesswork.',
    href: '/section/templates'
  },
  {
    key: 'architecture',
    title: 'Architecture',
    blurb: 'Learn the key innovations: learning loops, SOUL/memory design, and production reliability patterns.',
    href: '/section/architecture'
  },
  {
    key: 'compare',
    title: 'Compare',
    blurb: 'Decide when OpenClaw is the right stack (and when it is not).',
    href: '/section/compare'
  }
];

export default function Home() {
  return (
    <div>
      <section className="card">
        <h1>Clawfable</h1>
        <p>OpenClaw guides, playbooks, and templates for operators building real systems.</p>
        <p>
          No fluff. No prompt spam. Just practical implementation paths that move from setup to outcomes.
        </p>
        <p>
          <Link href="/start">Start Here</Link>
        </p>
        <ul>
          <li>
            New here? Start with <Link href="/guides/openclaw-setup-guide-2026">Track A: Setup Guide (2026)</Link>
          </li>
          <li>
            Want results fast? Pick one: <Link href="/playbooks/openclaw-for-founder-ops">Track B: Founder Ops</Link> or{' '}
            <Link href="/playbooks/openclaw-for-lead-gen-workflows">Track C: Growth/Ops</Link>
          </li>
          <li>
            Need foundations first? Read <Link href="/architecture/openclaw-architecture-principles">Track D: Architecture Principles</Link>
          </li>
        </ul>
      </section>

      {featured.map((section) => {
        const items = listBySection(section.key).slice(0, 4);
        return (
          <section key={section.key} className="card">
            <h2>{section.title}</h2>
            <p>{section.blurb}</p>
            <ul>
              {items.map((i) => (
                <li key={i.slug}>
                  <Link href={`/${section.key}/${i.slug}`}>{i.title}</Link>
                </li>
              ))}
            </ul>
            <Link href={section.href}>View all {section.title.toLowerCase()}</Link>
          </section>
        );
      })}
    </div>
  );
}
