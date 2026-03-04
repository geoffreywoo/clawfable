export default function ClawfableLogo({ size = 28 }: { size?: number }) {
  /* 
   * SVG interpretation of the V1 claw-bracket logo.
   * Shape: two angular bracket arms ({}) forming a claw, 
   * meeting at a central V, with a vertical stem below.
   * Violet accent on the upper-right tip.
   * viewBox tuned so the mark sits in a 64x80 box (tall, narrow).
   */
  const h = size;
  const w = size * (64 / 80);
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 64 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Clawfable logo"
      style={{ flexShrink: 0 }}
    >
      {/* Left bracket-claw arm */}
      <path
        d="M20 4 L8 20 L16 28 L8 38 L20 60 L28 60 L16 38 L24 28 L16 20 L28 4 Z"
        fill="#22d3ee"
        fillRule="evenodd"
      />
      {/* Right bracket-claw arm */}
      <path
        d="M44 4 L56 20 L48 28 L56 38 L44 60 L36 60 L48 38 L40 28 L48 20 L36 4 Z"
        fill="#22d3ee"
        fillRule="evenodd"
      />
      {/* Central V meeting point + stem */}
      <path
        d="M28 4 L32 44 L36 4 L33 4 L32 32 L31 4 Z"
        fill="#22d3ee"
      />
      <rect x="30" y="44" width="4" height="32" rx="1" fill="#22d3ee" />
      {/* Violet accent - right tip */}
      <path
        d="M44 4 L48 0 L56 12 L56 20 L44 4 Z"
        fill="#a78bfa"
      />
    </svg>
  );
}
