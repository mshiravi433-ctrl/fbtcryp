/**
 * LearnOrbMark — the hub's emblem (the «prism»).
 * ---------------------------------------------------------------------------
 * A dashed outer ring with twelve ticks, a middle orbit carrying three light
 * nodes — one per source, in that source's colour (cyan راهنما, mint مستندات,
 * magenta ویدیوها) — and a glass core with the graduation cap, the one glyph
 * that says "learning" in any language. The whole thing floats by 2.5px.
 *
 * ─── WHY CSS, NOT JAVASCRIPT ───────────────────────────────────────────────
 * Every movement here is a composited `transform` on `<g>` elements driven by
 * CSS keyframes: no React state, no `requestAnimationFrame`, no re-render.
 * An rAF loop on a page that also mounts three heavy child screens competes
 * with them and shows up as scroll jank; a composited transform on a 96px box
 * does not.
 *
 * ─── WHY NOTHING FADES TO ZERO ─────────────────────────────────────────────
 * The halo breathes between 0.34 and 0.62, and each orbit's first and last
 * frame are identical. A loop that disappears reads as a loading placeholder,
 * and on a screen someone reads for minutes it reads as a fault.
 */
const NODES = [
  { angle: -90, color: '#00e5ff' },
  { angle: 30, color: '#00ff9d' },
  { angle: 150, color: '#ff2d95' }
];

const polar = (deg, r) => {
  const rad = (deg * Math.PI) / 180;
  return { x: 60 + r * Math.cos(rad), y: 60 + r * Math.sin(rad) };
};

export default function LearnOrbMark({ size = 96 }) {
  return (
    <svg
      className="lh-orb-svg"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="lh-orb-ring" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00e5ff" />
          <stop offset="52%" stopColor="#7c4dff" />
          <stop offset="100%" stopColor="#ff2d95" />
        </linearGradient>
        <linearGradient id="lh-orb-core" x1="34" y1="40" x2="88" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00e5ff" />
          <stop offset="100%" stopColor="#7c4dff" />
        </linearGradient>
        <linearGradient id="lh-orb-glass" x1="30" y1="30" x2="90" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(255,255,255,.14)" />
          <stop offset="100%" stopColor="rgba(255,255,255,.02)" />
        </linearGradient>
        <radialGradient id="lh-orb-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7c4dff" stopOpacity=".55" />
          <stop offset="100%" stopColor="#7c4dff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="60" cy="60" r="56" fill="url(#lh-orb-halo)" className="lh-orb-halo" />

      <g className="lh-orb-float">
        {/* outer dial: dashed ring + twelve ticks */}
        <g className="lh-orb-spin lh-orb-spin--a">
          <circle cx="60" cy="60" r="53" stroke="url(#lh-orb-ring)" strokeWidth="1.4" strokeOpacity=".55" strokeDasharray="2 6" />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = polar(i * 30, 49);
            const b = polar(i * 30, i % 3 === 0 ? 44 : 46.5);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="url(#lh-orb-ring)"
                strokeWidth={i % 3 === 0 ? 1.8 : 1.1}
                strokeOpacity={i % 3 === 0 ? .9 : .45}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* middle orbit: three light nodes, one per source */}
        <g className="lh-orb-spin lh-orb-spin--b">
          <circle cx="60" cy="60" r="40" stroke="url(#lh-orb-ring)" strokeWidth="1" strokeOpacity=".4" />
          {NODES.map(({ angle, color }) => {
            const p = polar(angle, 40);
            return (
              <g key={angle}>
                <circle cx={p.x} cy={p.y} r="6.5" fill={color} fillOpacity=".18" />
                <circle cx={p.x} cy={p.y} r="3.2" fill={color} />
                <circle cx={p.x} cy={p.y} r="1.2" fill="#fff" fillOpacity=".85" />
              </g>
            );
          })}
        </g>

        {/* a slow light sweep behind the core */}
        <g className="lh-orb-spin lh-orb-spin--c">
          <path d="M60 28a32 32 0 0 1 32 32" stroke="url(#lh-orb-ring)" strokeWidth="2.2" strokeLinecap="round" strokeOpacity=".7" />
        </g>

        {/* glass core */}
        <circle cx="60" cy="60" r="30" fill="rgba(9,13,26,.78)" stroke="rgba(255,255,255,.12)" />
        <circle cx="60" cy="60" r="30" fill="url(#lh-orb-glass)" />
        <circle cx="60" cy="60" r="30" stroke="url(#lh-orb-ring)" strokeWidth="1" strokeOpacity=".5" />

        {/* graduation cap */}
        <path d="M41 55.5 60 47l19 8.5-19 8.5-19-8.5Z" fill="url(#lh-orb-core)" />
        <path d="M49.5 61.5v7.2c0 3.6 4.7 6.6 10.5 6.6s10.5-3 10.5-6.6v-7.2" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round" />
        <path d="M79 56v10.5" stroke="#ff2d95" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="79" cy="69.5" r="2.4" fill="#ff2d95" />
        <circle cx="52" cy="52.5" r="1.3" fill="#fff" fillOpacity=".8" />
      </g>
    </svg>
  );
}
