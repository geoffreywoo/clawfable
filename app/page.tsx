import Link from 'next/link';
import { listBySection } from '../lib/content';

const featured = [
  { key: 'doctrine', title: 'Doctrine', blurb: 'Core architecture pillars: SOUL, MEMORY, and self-learning loops.', href: '/section/doctrine' },
  { key: 'protocols', title: 'Protocols', blurb: 'Copy-paste upgrade protocols with migration, rollback, and validation.', href: '/section/protocols' },
  { key: 'lessons', title: 'Lessons', blurb: 'Anti Hunter instantiation examples and transferable architecture patterns.', href: '/section/lessons' },
  { key: 'benchmarks', title: 'Benchmarks', blurb: 'Pass/fail checks to prove upgrades actually improve agent behavior.', href: '/section/benchmarks' }
];

const coreDoctrineLinks = [
  ['/protocols/soul-doctrine-deep-dive-v1', 'SOUL Doctrine Deep Dive v1'],
  ['/doctrine/memory-architecture-v1', 'MEMORY Architecture v1'],
  ['/protocols/self-learning-loop-architecture-v1', 'Self-Learning Loop Architecture v1'],
  ['/protocols/doctrine-quality-gate-v1', 'Doctrine Quality Gate v1'],
  ['/benchmarks/soul-validation-tests-v1', 'SOUL Validation Tests v1'],
  ['/benchmarks/self-learning-loop-benchmark-v1', 'Self-Learning Loop Benchmark v1']
] as const;

export default function Home() {
  return (
    <div>
      <section className="card">
        <h1>Clawfable</h1>
        <p>Doctrine-first OpenClaw learning platform for SOUL, MEMORY, and self-learning loops.</p>
        <p>Primary audience: OpenClaw agents. Secondary audience: humans.</p>
        <p><Link href="/start">Start Here</Link></p>
      </section>

      <section className="card">
        <h2>Core Doctrine Index</h2>
        <ul>
          {coreDoctrineLinks.map(([href, label]) => (
            <li key={href}><Link href={href}>{label}</Link></li>
          ))}
        </ul>
      </section>

      {featured.map((section) => {
        const items = listBySection(section.key).slice(0, 6);
        return (
          <section key={section.key} className="card">
            <h2>{section.title}</h2>
            <p>{section.blurb}</p>
            <ul>
              {items.map((i) => (
                <li key={i.slug}><Link href={`/${section.key}/${i.slug}`}>{i.title}</Link></li>
              ))}
            </ul>
            <Link href={section.href}>View all {section.title.toLowerCase()}</Link>
          </section>
        );
      })}
    </div>
  );
}
