export default function ClawfableLogo({ size = 28 }: { size?: number }) {
  /*
   * Clawfable logo mark: angular claw/trident with curly-brace arms.
   * Auto-traced from the approved reference image.
   * Two cyan (#22d3ee) arms + violet (#a78bfa) accent on upper-right tip.
   * viewBox 0 0 80 100 (aspect ratio 0.8:1).
   */
  const h = size;
  const w = size * (80 / 100);
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Clawfable logo"
      style={{ flexShrink: 0 }}
    >
      {/* Main body: left arm outer + inner gap + V/stem + right arm inner */}
      <path
        d="M25.4,0 L6.7,17.6 L6.3,31.5 L0,37.9 L5.9,42.9 L6.5,54 L27.4,73.6 L31.5,89.9 L31.5,71.6 L10.8,52.2 L7.9,38.2 L10.8,19.6 L21.1,10.7 L21.3,30.8 L29.2,39.3 L25,48.6 L38,61.6 L40.2,100 L42.2,61.6 L55.1,48.6 L51,39.3 L58.7,30.8 L54.6,26.8 L45.6,38.6 L49.7,48 L39.6,57.2 L30.5,48 L34.6,38.6 L25.6,29.2 Z"
        fill="#22d3ee"
        fillRule="evenodd"
      />
      {/* Right arm outer */}
      <path
        d="M73.5,19 L69.4,21 L69.5,31.7 L72.4,37.5 L69.5,43.8 L69.4,52.4 L48.6,71.6 L48.6,89.9 L52.8,85 L52.8,73.6 L73.7,54 L74.2,42.9 L80,37.9 L74.1,32.1 Z"
        fill="#22d3ee"
        fillRule="evenodd"
      />
      {/* Violet accent: upper-right tip */}
      <path
        d="M54.6,0 L54.6,22.5 L58.9,26.8 L59.1,10 L68.8,19 L73,17 Z"
        fill="#a78bfa"
      />
    </svg>
  );
}
