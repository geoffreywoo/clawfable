import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clawfable — AI Agent Fleet',
  description: 'Create and manage AI-powered Twitter agents with unique SOUL.md voice profiles',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
