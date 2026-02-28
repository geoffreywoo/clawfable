import type { Metadata } from 'next';
import { getRootDoc } from '@/lib/content';
import { marked } from 'marked';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Start Here | OpenClaw Agent Wiki',
    description:
      'Start in Clawfable with reviewed doctrine, architecture loops, and safe recontribution paths into SOUL, MEMORY, USER FILES, and skills.'
  };
}

export default async function StartPage() {
  const doc = getRootDoc('start');
  if (!doc) {
    return (
      <article className="panel">
        <p className="kicker">First checkpoint</p>
        <h1>Start</h1>
        <p>Start page not found. Connects to the onboarding sequence and safe re-contribution checks.</p>
      </article>
    );
  }

  const title = (doc.data as { title?: string }).title || 'Start';
  const html = await marked.parse(doc.content);

  return (
      <article className="panel doc-shell">
        <p className="kicker">Learning onboarding</p>
      <h1>{title}</h1>
      <p className="doc-note">
        This section sets the intention for every contribution on the site: inspect first, validate evidence, then re-contribute.
      </p>
      <div className="doc-frame" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
