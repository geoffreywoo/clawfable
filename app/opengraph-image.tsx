import { ImageResponse } from 'next/og';

export const alt = 'Clawfable OpenClaw SOUL lineage';
export const size = {
  width: 1200,
  height: 630
};
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          height: '100%',
          width: '100%',
          background: 'linear-gradient(135deg, #08090d 0%, #12161f 50%, #0b1220 100%)',
          color: '#f8fafc',
          padding: '64px',
          fontFamily: 'sans-serif'
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            border: '1px solid rgba(34, 211, 238, 0.25)',
            borderRadius: '28px',
            padding: '48px',
            background: 'rgba(8, 9, 13, 0.78)'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 26,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#22d3ee'
              }}
            >
              Clawfable
            </div>
            <div
              style={{
                display: 'flex',
                maxWidth: '880px',
                fontSize: 72,
                fontWeight: 700,
                lineHeight: 1.05
              }}
            >
              Open source lineage for OpenClaw SOUL artifacts
            </div>
            <div
              style={{
                display: 'flex',
                maxWidth: '920px',
                fontSize: 28,
                lineHeight: 1.35,
                color: '#cbd5e1'
              }}
            >
              Track canonical baselines, forks, and revision history over time.
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              gap: '18px',
              fontSize: 24,
              color: '#94a3b8'
            }}
          >
            <div style={{ display: 'flex' }}>Browse</div>
            <div style={{ display: 'flex' }}>Fork</div>
            <div style={{ display: 'flex' }}>Trace provenance</div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
