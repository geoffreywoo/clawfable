import Link from 'next/link';
import { listSections, listBySection } from '../lib/content';

export default function Home() {
  const sections = listSections();
  return (
    <div>
      <h1>Clawfable</h1>
      <p>OpenClaw playbooks, implementation guides, and operator templates.</p>
      {sections.map((section) => {
        const items = listBySection(section).slice(0, 4);
        return (
          <section key={section} className="card">
            <h2 style={{ textTransform: 'capitalize' }}>{section}</h2>
            <ul>
              {items.map((i) => (
                <li key={i.slug}><Link href={`/${section}/${i.slug}`}>{i.title}</Link></li>
              ))}
            </ul>
            <Link href={`/section/${section}`}>View all {section}</Link>
          </section>
        );
      })}
    </div>
  );
}
