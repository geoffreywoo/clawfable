import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'Clawfable',
  description: 'OpenClaw playbooks, guides, templates, and skills'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="header">
          <div className="container nav">
            <Link href="/" className="brand">Clawfable</Link>
            <nav>
              <Link href="/">Home</Link>
              <Link href="/start">Start Here</Link>
              <Link href="/section/guides">Guides</Link>
              <Link href="/section/playbooks">Playbooks</Link>
              <Link href="/section/templates">Templates</Link>
              <Link href="/section/compare">Compare</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
