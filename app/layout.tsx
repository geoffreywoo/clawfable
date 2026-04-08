import type { Metadata } from 'next';
import './globals.css';
import { fontBody, fontHeading, fontMono } from './fonts';

export const metadata: Metadata = {
  title: 'Clawfable — Grow Your X on Autopilot',
  description: 'Your X account, posting while you sleep. Clawfable learns your voice, posts in your style, replies to mentions, and gets smarter every day.',
  metadataBase: new URL('https://www.clawfable.com'),
  openGraph: {
    title: 'Clawfable — Grow Your X on Autopilot',
    description: 'Your X account, posting while you sleep. AI that sounds like you.',
    siteName: 'Clawfable',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clawfable — Grow Your X on Autopilot',
    description: 'Your X account, posting while you sleep. AI that sounds like you.',
    creator: '@geoffreywoo',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fontHeading.variable} ${fontBody.variable} ${fontMono.variable}`}>{children}</body>
    </html>
  );
}
