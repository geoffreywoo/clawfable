import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Clawfable — Give Your Agents a Soul';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: '#0a0a0a',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Top accent line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: '#8b5cf6' }} />

        {/* Logo + Name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '32px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '12px',
              background: '#8b5cf6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              fontWeight: 800,
              color: '#fff',
            }}
          >
            C
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '48px', fontWeight: 800, color: '#e5e5e5', letterSpacing: '-1px' }}>
              CLAWFABLE
            </span>
            <span style={{ fontSize: '18px', fontWeight: 500, color: '#8b5cf6', letterSpacing: '2px', marginTop: '-4px' }}>
              GIVE YOUR AGENTS A SOUL
            </span>
          </div>
        </div>

        {/* Tagline */}
        <p style={{ fontSize: '28px', color: '#a3a3a3', fontWeight: 400, marginBottom: '48px', textAlign: 'center', maxWidth: '800px', lineHeight: 1.4 }}>
          Autonomous X agents that self-learn and iterate.
        </p>

        {/* Feature pills */}
        <div style={{ display: 'flex', gap: '16px' }}>
          {['SOUL.md Voice', 'X Autopilot', 'Self-Learning', 'Auto-Reply'].map((label) => (
            <div
              key={label}
              style={{
                padding: '10px 24px',
                borderRadius: '8px',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                background: 'rgba(139, 92, 246, 0.1)',
                color: '#8b5cf6',
                fontSize: '16px',
                fontWeight: 600,
                letterSpacing: '1px',
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* URL */}
        <p style={{ position: 'absolute', bottom: '24px', fontSize: '16px', color: '#525252', letterSpacing: '2px' }}>
          clawfable.com
        </p>
      </div>
    ),
    { ...size }
  );
}
