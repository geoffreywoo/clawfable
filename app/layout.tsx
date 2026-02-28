import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'Clawfable',
  description: 'Doctrine-first OpenClaw learning platform: SOUL, MEMORY, and self-learning loops.'
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
              <Link href="/section/doctrine">Doctrine</Link>
              <Link href="/section/protocols">Protocols</Link>
              <Link href="/section/lessons">Lessons</Link>
              <Link href="/section/benchmarks">Benchmarks</Link>
              <Link href="/status">Status</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
