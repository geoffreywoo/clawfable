import Link from 'next/link';
import { listBySection } from '../../../lib/content';

export default async function SectionPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const items = listBySection(name);
  return (
    <div>
      <h1 style={{ textTransform: 'capitalize' }}>{name}</h1>
      <ul>
        {items.map((i) => (
          <li key={i.slug}><Link href={`/${name}/${i.slug}`}>{i.title}</Link></li>
        ))}
      </ul>
    </div>
  );
}
