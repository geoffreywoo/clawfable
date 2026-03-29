import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clawfable — Multi-Agent Twitter Bot Ops',
  description: 'Multi-agent platform for managing Twitter bots with SOUL.md voice profiles',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
