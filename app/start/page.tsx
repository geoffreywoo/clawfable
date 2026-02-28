import { getRootDoc } from '@/lib/content';
import { marked } from 'marked';

export default async function StartPage() {
  const doc = getRootDoc('start');
  if (!doc) return <article><h1>Start</h1><p>Start page not found.</p></article>;
  const html = await marked.parse(doc.content);
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}
