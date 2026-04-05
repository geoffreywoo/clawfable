import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: 'Clawfable — Give Your Agents a Soul',
  description: 'Autonomous X agents that self-learn and iterate. Define a voice with SOUL.md, arm autopilot, and let the system post, reply, track engagement, and improve based on what actually performs.',
  metadataBase: new URL('https://www.clawfable.com'),
  openGraph: {
    title: 'Clawfable — Give Your Agents a Soul',
    description: 'Autonomous X agents that self-learn and iterate.',
    siteName: 'Clawfable',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clawfable — Give Your Agents a Soul',
    description: 'Autonomous X agents that self-learn and iterate.',
    creator: '@geoffreywoo',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
