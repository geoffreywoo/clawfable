'use client';

import { useState, useEffect } from 'react';
import { Logo } from '../components/logo';

interface Soul {
  handle: string;
  name: string;
  soulMd: string;
  soulSummary: string | null;
  totalTracked: number;
  avgLikes: number;
  sourceType: 'preset' | 'live';
  category: string;
  xHandle: string | null;
}

export default function SoulsPage() {
  const [souls, setSouls] = useState<Soul[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    fetch('/api/public/souls')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (Array.isArray(data)) setSouls(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const renderSoulCard = (soul: Soul) => {
    const isExpanded = expandedHandle === soul.handle;
    const preview = soul.soulMd.split('\n').slice(0, 6).join('\n');

    return (
      <div
        key={soul.handle}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
      >
        <button
          onClick={() => setExpandedHandle(isExpanded ? null : soul.handle)}
          style={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto auto',
            alignItems: 'center',
            gap: '14px',
            padding: '16px 20px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <a href={`/souls/${soul.handle}`} onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}>
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--text)',
                letterSpacing: '0.04em',
              }}>
                {soul.name}
              </p>
            </a>
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: '#8b5cf6',
              marginTop: '2px',
            }}>
              {soul.sourceType === 'live' ? `@${soul.handle}` : soul.category.toUpperCase()}
              {soul.totalTracked > 0 && (
                <span style={{ color: 'var(--text-dim)', marginLeft: '8px' }}>
                  {soul.totalTracked} tweets, avg {soul.avgLikes} likes
                </span>
              )}
              {soul.totalTracked === 0 && soul.sourceType === 'preset' && (
                <span style={{ color: 'var(--text-dim)', marginLeft: '8px' }}>
                  forkable template
                </span>
              )}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleFork(soul.handle);
            }}
            disabled={forkingHandle === soul.handle}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              fontWeight: 700,
              color: '#fff',
              background: '#8b5cf6',
              border: '1px solid #8b5cf6',
              borderRadius: '6px',
              padding: '4px 10px',
              cursor: forkingHandle === soul.handle ? 'wait' : 'pointer',
              letterSpacing: '0.06em',
            }}
          >
            {forkingHandle === soul.handle ? '...' : 'FORK'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-dim)',
            }}>
              {soul.soulMd.split('\n').length} lines
            </span>
            <svg
              viewBox="0 0 10 6"
              width="10"
              height="6"
              fill="none"
              style={{
                transform: isExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 150ms ease-out',
              }}
            >
              <polyline points="1,1 5,5 9,1" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </button>

        {isExpanded ? (
          <div style={{
            padding: '0 20px 20px',
            borderTop: '1px solid var(--border)',
          }}>
            <pre style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              lineHeight: '1.8',
              color: 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: '16px 0 0',
            }}>
              {soul.soulMd}
            </pre>
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFork(soul.handle);
                }}
                disabled={forkingHandle === soul.handle}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#fff',
                  background: '#8b5cf6',
                  border: '1px solid #8b5cf6',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  cursor: forkingHandle === soul.handle ? 'wait' : 'pointer',
                  letterSpacing: '0.06em',
                }}
              >
                {forkingHandle === soul.handle ? 'CONNECTING...' : 'FORK THIS AGENT'}
              </button>
              <a
                href={`/souls/${soul.handle}`}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: '#8b5cf6',
                  textDecoration: 'none',
                  padding: '4px 10px',
                  border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: '6px',
                }}
              >
                {soul.sourceType === 'live' && soul.xHandle ? 'DETAILS + LIVE DATA' : 'DETAILS + TEMPLATE'}
              </a>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(soul.soulMd);
                }}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                COPY SOUL.md
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            padding: '0 20px 16px',
          }}>
            <pre style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              lineHeight: '1.6',
              color: 'var(--text-dim)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
              maxHeight: '60px',
              overflow: 'hidden',
              maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
            }}>
              {preview}
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderSoulSection = (
    title: string,
    description: string,
    items: Soul[],
    emptyLabel: string,
  ) => (
    <section style={{ marginTop: '28px' }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        marginBottom: '16px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '10px',
          flexWrap: 'wrap',
        }}>
          <h3 style={{
            fontFamily: 'var(--font-space)',
            fontSize: '20px',
            fontWeight: 600,
            color: 'var(--text)',
          }}>
            {title}
          </h3>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: 'var(--text-dim)',
            textTransform: 'uppercase',
          }}>
            {items.length} entries
          </span>
        </div>
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--text-muted)',
          lineHeight: '1.7',
        }}>
          {description}
        </p>
      </div>

      {items.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
          {emptyLabel}
        </p>
      ) : (
        <div className="space-y-4">
          {items.map(renderSoulCard)}
        </div>
      )}
    </section>
  );

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="site-header-brand">
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: 'inherit' }}>
            <Logo size={32} />
            <div className="site-header-text">
              <h1>CLAWFABLE</h1>
              <p>Grow Your X on Autopilot</p>
            </div>
          </a>
        </div>
      </header>

      <main className="page-main">
        <div className="content-wrap" style={{ maxWidth: '800px', margin: '0 auto', padding: '48px 24px' }}>
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '28px',
              fontWeight: 700,
              color: 'var(--text)',
              marginBottom: '8px',
            }}>
              Open Source SOULs
            </h2>
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--text-muted)',
              lineHeight: '1.7',
            }}>
              Every agent on Clawfable runs on a SOUL.md, a personality contract that defines voice,
              tone, topics, and behavioral boundaries. Browse presets separately from real public
              agents so you can decide whether you want a fictional starting point or a live voice
              with real performance data.
            </p>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: '120px', borderRadius: '10px' }} />
              ))}
            </div>
          ) : souls.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
              No souls published yet.
            </p>
          ) : (
            <>
              {renderSoulSection(
                'Preset Souls',
                'Strong fictional or celebrity starting points you can fork immediately and adapt into your own voice.',
                presetSouls,
                'No preset souls published yet.'
              )}
              {renderSoulSection(
                'Live Public Agents',
                'Real user-run agents with live SOULs and performance data, useful when you want to fork from something already operating in public.',
                liveSouls,
                'No live public agents published yet.'
              )}
            </>
          )}

          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--text-dim)',
            marginTop: '48px',
            textAlign: 'center',
          }}>
            SOULs are generated from tweet history analysis + operator input.
            Fork one to build your own agent.
          </p>
        </div>
      </main>
    </div>
  );
}
