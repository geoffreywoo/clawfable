export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/clawfable-logo.jpg"
      alt="Clawfable"
      width={size}
      height={size}
      style={{ flexShrink: 0, borderRadius: '6px', objectFit: 'cover' }}
    />
  );
}
