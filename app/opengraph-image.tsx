import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Clawfable - Train your voice and grow on X';
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
          background: '#f6f1e7',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Top accent line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '5px', background: '#4a8b67' }} />

        {/* Logo + Name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '32px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: '#4a8b67',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              fontWeight: 800,
              color: '#fffdf8',
            }}
          >
            C
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '48px', fontWeight: 800, color: '#213128', letterSpacing: '0' }}>
              CLAWFABLE
            </span>
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#4a8b67', letterSpacing: '0', marginTop: '-4px' }}>
              TRAIN YOUR VOICE, CATCH LIVE WAVES
            </span>
          </div>
        </div>

        {/* Tagline */}
        <p style={{ fontSize: '30px', color: '#5e6d63', fontWeight: 500, marginBottom: '48px', textAlign: 'center', maxWidth: '840px', lineHeight: 1.35 }}>
          Review sharper drafts, engage early in live threads, and let the account learn what moves.
        </p>

        {/* Feature pills */}
        <div style={{ display: 'flex', gap: '16px' }}>
          {['SOUL.md Voice', 'Hot Takes', 'Autopilot', 'Live Replies'].map((label) => (
            <div
              key={label}
              style={{
                padding: '10px 24px',
                borderRadius: '999px',
                border: '1px solid rgba(74, 139, 103, 0.28)',
                background: 'rgba(255, 253, 248, 0.84)',
                color: '#4a8b67',
                fontSize: '16px',
                fontWeight: 700,
                letterSpacing: '0',
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* URL */}
        <p style={{ position: 'absolute', bottom: '24px', fontSize: '16px', color: '#8b988f', letterSpacing: '0' }}>
          clawfable.com
        </p>
      </div>
    ),
    { ...size }
  );
}
