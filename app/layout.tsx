import type { Metadata } from 'next';
import './globals.css';
import { fontBody, fontHeading, fontMono } from './fonts';

export const metadata: Metadata = {
  title: 'Clawfable — Train an X voice that gets better every week',
  description: 'Train an AI publishing teammate on your real X voice. Review the first batch, see what it learns, and turn on autopilot when it feels right.',
  metadataBase: new URL('https://www.clawfable.com'),
  openGraph: {
    title: 'Clawfable — Train an X voice that gets better every week',
    description: 'Train an AI publishing teammate on your real X voice.',
    siteName: 'Clawfable',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clawfable — Train an X voice that gets better every week',
    description: 'Train an AI publishing teammate on your real X voice.',
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
