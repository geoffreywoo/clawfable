import { getDoc } from '../../../lib/content';
import { marked } from 'marked';

export default async function DocPage({ params }: { params: Promise<{ section: string; slug: string }> }) {
  const { section, slug } = await params;
  const doc = getDoc(section, slug);
  if (!doc) return <div>Not found</div>;
  const html = await marked.parse(doc.content);
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}
