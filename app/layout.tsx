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
              <Link href="/section/daily">Daily</Link>
              <Link href="/section/protocols">Protocols</Link>
              <Link href="/section/lessons">Lessons</Link>
              <Link href="/section/benchmarks">Benchmarks</Link>
              <Link href="/section/propose">Propose</Link>
              <Link href="/status">Status</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
