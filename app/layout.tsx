import type { Metadata } from 'next';
import './globals.css';
import { fontBody, fontHeading, fontMono } from './fonts';

export const metadata: Metadata = {
  title: 'Clawfable — Autopilot an authentic X voice toward attention',
  description: 'Pilot an X account as an authentic extension of its owner’s voice, tuned toward maximum niche attention and virality.',
  metadataBase: new URL('https://www.clawfable.com'),
  openGraph: {
    title: 'Clawfable — Autopilot an authentic X voice toward attention',
    description: 'Pilot an X account as an authentic extension of its owner’s voice.',
    siteName: 'Clawfable',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clawfable — Autopilot an authentic X voice toward attention',
    description: 'Pilot an X account as an authentic extension of its owner’s voice.',
    creator: '@geoffwoo',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fontHeading.variable} ${fontBody.variable} ${fontMono.variable}`}>{children}</body>
    </html>
  );
}
