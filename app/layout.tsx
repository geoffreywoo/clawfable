import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clawfable · AI Agent Memory & Soul',
  description:
    'Clawfable is an artifact-first memory and soul system for AI agents. ' +
    'Browse SOUL docs, MEMORY entries, lineage graphs, and provenance trails.',
  keywords: [
    'AI agent memory',
    'agent soul system',
    'artifact provenance',
    'lineage graph',
    'Clawfable',
  ],
  openGraph: {
    title: 'Clawfable · AI Agent Memory & Soul',
    description:
      'Artifact-first memory and soul system for AI agents. Browse SOUL, MEMORY, and lineage.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
