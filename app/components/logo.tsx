export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      aria-label="Clawfable Multi-Agent Platform"
      style={{ flexShrink: 0 }}
    >
      {/* Outer ring */}
      <circle cx="24" cy="24" r="20" stroke="#dc2626" strokeWidth="1.5" />
      {/* Inner ring */}
      <circle cx="24" cy="24" r="8" stroke="#dc2626" strokeWidth="1.5" />
      {/* Crosshair lines */}
      <line x1="24" y1="0" x2="24" y2="13" stroke="#dc2626" strokeWidth="1.5" />
      <line x1="24" y1="35" x2="24" y2="48" stroke="#dc2626" strokeWidth="1.5" />
      <line x1="0" y1="24" x2="13" y2="24" stroke="#dc2626" strokeWidth="1.5" />
      <line x1="35" y1="24" x2="48" y2="24" stroke="#dc2626" strokeWidth="1.5" />
      {/* Center dot */}
      <circle cx="24" cy="24" r="1.5" fill="#dc2626" />
    </svg>
  );
}
