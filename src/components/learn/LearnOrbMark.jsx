/**
 * LearnOrbMark — the hub's emblem.
 * ---------------------------------------------------------------------------
 * Two orbits with a light node on each, a graduation-cap core and four marks
 * around it (the three sources plus the reader).
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
        <radialGradient id="lh-orb-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7c4dff" stopOpacity=".5" />
          <stop offset="100%" stopColor="#7c4dff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="60" cy="60" r="54" fill="url(#lh-orb-halo)" className="lh-orb-halo" />

      <g className="lh-orb-spin lh-orb-spin--a">
        <circle cx="60" cy="60" r="52" stroke="url(#lh-orb-ring)" strokeWidth="1.6" strokeOpacity=".7" strokeDasharray="5 7" />
        <circle cx="60" cy="8" r="3.4" fill="#00e5ff" />
      </g>

      <g className="lh-orb-spin lh-orb-spin--b">
        <circle cx="60" cy="60" r="41" stroke="url(#lh-orb-ring)" strokeWidth="1.4" strokeOpacity=".5" strokeDasharray="3 9" />
        <circle cx="101" cy="60" r="2.8" fill="#ff2d95" />
      </g>

      <circle cx="60" cy="60" r="31" fill="rgba(9,13,26,.72)" stroke="rgba(255,255,255,.1)" />
      <circle cx="60" cy="60" r="31" stroke="url(#lh-orb-ring)" strokeWidth="1" strokeOpacity=".45" />

      {/* graduation cap: the one glyph that says "learning" in any language */}
      <path d="M42 54 60 46l18 8-18 8-18-8Z" fill="url(#lh-orb-core)" />
      <path d="M50 60v8c0 3.6 4.5 6.5 10 6.5s10-2.9 10-6.5v-8" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round" />
      <path d="M78 51v10" stroke="#ff2d95" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="78" cy="64" r="2.4" fill="#ff2d95" />

      {/* four marks: the three sources and the reader */}
      <circle cx="60" cy="21" r="2" fill="#00e5ff" fillOpacity=".8" />
      <circle cx="99" cy="60" r="2" fill="#7c4dff" fillOpacity=".8" />
      <circle cx="60" cy="99" r="2" fill="#ff2d95" fillOpacity=".8" />
      <circle cx="21" cy="60" r="2" fill="#00ff9d" fillOpacity=".8" />
    </svg>
  );
}
