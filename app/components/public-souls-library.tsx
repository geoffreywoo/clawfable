'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Logo } from '@/app/components/logo';
import type { PublicSoulSummary } from '@/lib/open-source-souls';

interface PublicSoulsLibraryProps {
  souls: PublicSoulSummary[];
}

export function PublicSoulsLibrary({ souls }: PublicSoulsLibraryProps) {
  const [expandedHandle, setExpandedHandle] = useState<string | null>(null);
  const [forkingHandle, setForkingHandle] = useState<string | null>(null);

  const presetSouls = souls.filter((soul) => soul.sourceType === 'preset');
  const liveSouls = souls.filter((soul) => soul.sourceType === 'live');

  const handleFork = async (handle: string) => {
    setForkingHandle(handle);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forkHandle: handle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch {
      setForkingHandle(null);
    }
  };

  const renderSoulCard = (soul: PublicSoulSummary) => {
    const isExpanded = expandedHandle === soul.handle;
    const preview = soul.soulMd.split('\n').slice(0, 8).join('\n');
    const meta =
      soul.sourceType === 'live'
        ? `${soul.totalTracked} tracked posts · ${soul.avgLikes} avg likes`
        : 'Forkable starting point';

    return (
      <article key={soul.handle} className="soul-card">
        <div className="soul-card-top">
          <div className="soul-card-head">
            <div>
              <p className="soul-card-eyebrow">
                {soul.sourceType === 'live' ? `@${soul.handle}` : soul.category}
              </p>
              <h3 className="soul-card-title">{soul.name}</h3>
            </div>
            <span className={`soul-card-pill soul-card-pill-${soul.sourceType}`}>
              {soul.sourceType === 'live' ? 'Live voice' : 'Preset'}
            </span>
          </div>

          <p className="soul-card-summary">
            {soul.soulSummary || (soul.sourceType === 'live'
              ? 'A public Clawfable voice with live performance history.'
              : 'A ready-to-fork SOUL template with a strong point of view.')}
          </p>

          <div className="soul-card-meta">
            <span>{meta}</span>
            <span>{soul.soulMd.split('\n').length} lines</span>
          </div>
        </div>

        <div className="soul-card-actions">
          <button
            className="btn btn-primary"
            onClick={() => void handleFork(soul.handle)}
            disabled={forkingHandle === soul.handle}
          >
            {forkingHandle === soul.handle ? 'Connecting...' : 'Fork this voice'}
          </button>
          <Link href={`/souls/${soul.handle}`} className="btn btn-outline">
            View details
          </Link>
          <button
            className="btn btn-ghost"
            onClick={() => setExpandedHandle(isExpanded ? null : soul.handle)}
          >
            {isExpanded ? 'Hide SOUL.md' : 'Preview SOUL.md'}
          </button>
        </div>

        <div className={`soul-card-preview${isExpanded ? ' is-expanded' : ''}`}>
          <pre>{isExpanded ? soul.soulMd : preview}</pre>
        </div>
      </article>
    );
  };

  const renderSoulSection = (
    title: string,
    description: string,
    items: PublicSoulSummary[],
    emptyLabel: string,
  ) => (
    <section className="souls-section">
      <div className="souls-section-head">
        <div>
          <p className="souls-section-kicker">{title}</p>
          <h2 className="souls-section-title">{description}</h2>
        </div>
        <span className="souls-section-count">{items.length} voices</span>
      </div>

      {items.length === 0 ? (
        <div className="souls-empty-state">{emptyLabel}</div>
      ) : (
        <div className="souls-card-stack">
          {items.map(renderSoulCard)}
        </div>
      )}
    </section>
  );

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="site-header-brand">
          <Link href="/" className="site-header-home-link">
            <Logo size={32} />
            <div className="site-header-text">
              <h1>CLAWFABLE</h1>
              <p>AI publishing teammate for X</p>
            </div>
          </Link>
        </div>
        <div className="site-header-right">
          <nav className="site-header-nav">
            <Link href="/">Home</Link>
            <Link href="/pricing">Pricing</Link>
          </nav>
        </div>
      </header>

      <main className="page-main">
        <div className="content-wrap souls-library-shell">
          <section className="souls-library-hero">
            <div className="souls-library-copy">
              <p className="landing-kicker">PUBLIC SOUL LIBRARY</p>
              <h1>Browse preset voices and real public agents in one friendly library.</h1>
              <p>
                Some voices are bold starting points. Others are already running in public and
                learning from live data. Fork either one, then make it your own.
              </p>
            </div>
            <div className="souls-library-summary">
              <div className="souls-summary-card">
                <span>Preset voices</span>
                <strong>{presetSouls.length}</strong>
                <p>Character-rich templates like Morgan Freeman, Yoda, and other distinctive styles.</p>
              </div>
              <div className="souls-summary-card souls-summary-card-alt">
                <span>Live public agents</span>
                <strong>{liveSouls.length}</strong>
                <p>Real accounts with public SOULs and visible performance history.</p>
              </div>
            </div>
          </section>

          {souls.length === 0 ? (
            <div className="souls-empty-state">No souls have been published yet.</div>
          ) : (
            <>
              {renderSoulSection(
                'Preset voices',
                'Strong creative starting points you can fork immediately and shape into your own account.',
                presetSouls,
                'No preset souls are published yet.',
              )}
              {renderSoulSection(
                'Live public agents',
                'Public voices with real history, useful when you want to study a trained voice in the wild.',
                liveSouls,
                'No live public agents are published yet.',
              )}
            </>
          )}

          <div className="souls-library-footer">
            <p>Every Clawfable voice starts with a SOUL.md and then compounds through review, edits, and real performance.</p>
            <Link href="/" className="btn btn-outline">
              Back to home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
