/**
 * P2P DESK MARK — the animated logo in the hero box of the P2P page.
 * ---------------------------------------------------------------------------
 * Requested as «در باکس بالایی لوگو اگر انیمیشنی بشه بهتره بدون افت سرعت»:
 * the logo in the top box should animate, without costing any speed.
 *
 * ─── WHY IT IS CSS, NOT JAVASCRIPT ─────────────────────────────────────────
 * Every moving part here is a CSS keyframe on `transform` alone. No React
 * state, no `requestAnimationFrame` loop, no re-render, no layout invalidation.
 * A JS-driven animation on a wallet-adjacent screen competes with price
 * polling for the main thread and shows up as scroll jank; a composited
 * transform on a 148px box does not. The hero can therefore keep moving while
 * the offer list below it is fetching and rendering.
 *
 * ─── WHY NOTHING HERE BLINKS ───────────────────────────────────────────────
 * «بدون … لامپ زدن چشمک زدن باگی» — no flicker, no blinking. Three rules:
 *
 *   1. No opacity keyframe ever reaches 0 or 1 from the other end. The two
 *      arrows hold full opacity and only translate; the sparks pulse between
 *      0.55 and 1 with an ease-in-out on both sides, so there is never a hard
 *      on/off edge. A strobe at the top of a payment screen reads as a fault.
 *   2. Every loop is continuous — `infinite`, with matching first and last
 *      keyframes — so there is no restart frame where the element snaps.
 *   3. Nothing animates geometry (`width`, `top`, `stroke-width`). Those run on
 *      the main thread and re-layout the box on every frame.
 *
 * ─── AND IT STOPS COMPLETELY WHEN ASKED ────────────────────────────────────
 * `is-still` (the page sets it from `useStill()`, which honours BOTH the OS
 * `prefers-reduced-motion` setting and the app's own reduce-motion toggle) and
 * the `prefers-reduced-motion` media query both switch every animation off.
 * The mark is still dressed — the gradient rim, the dashed orbits, the sparks
 * all stay — it just holds still. Motion is never load-bearing here; the
 * shape reads as the P2P desk with or without it.
 */

export default function P2PHeroMark({ still = false }) {
  return (
    <div className={`p2p-mark${still ? ' is-still' : ''}`} aria-hidden="true" data-testid="p2p-hero-mark">
      {/* Soft accent bloom behind the disc. A gradient, not a blur filter:
          `filter: blur()` on a large element is one of the most expensive
          things a phone browser can be asked to repaint. */}
      <span className="p2p-mark-aura" />

      {/* Two elliptical orbits, tilted and counter-rotating. */}
      <span className="p2p-mark-orbit p2p-mark-orbit-outer" />
      <span className="p2p-mark-orbit p2p-mark-orbit-inner" />

      {/* The rim: a conic gradient turning under an opaque disc, so only a
          moving 3px lip of colour is ever visible. */}
      <span className="p2p-mark-rim" />
      <span className="p2p-mark-disc">
        <svg className="p2p-mark-glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {/* Two peers, and the exchange between them. */}
          <circle className="p2p-mark-node p2p-mark-node-a" cx="15" cy="17.5" r="4.6" />
          <circle className="p2p-mark-node p2p-mark-node-b" cx="33" cy="30.5" r="4.6" />
          {/* The link: a dash pattern that slides, so value visibly travels. */}
          <path className="p2p-mark-link" d="M18.6 20.2 29.4 27.8" strokeDasharray="3 3.4" />
          <path className="p2p-mark-link p2p-mark-link-b" d="M29.4 20.2 18.6 27.8" strokeDasharray="3 3.4" />
          {/* The two arrows of the swap, sliding past one another. */}
          <g className="p2p-mark-arrow p2p-mark-arrow-a">
            <path d="M33.5 36v-9" />
            <path d="M30.2 30.3 33.5 27l3.3 3.3" />
          </g>
          <g className="p2p-mark-arrow p2p-mark-arrow-b">
            <path d="M14.5 12v9" />
            <path d="M17.8 17.7 14.5 21l-3.3-3.3" />
          </g>
        </svg>
      </span>

      {/* Two sparks riding the orbits. The wrapper rotates; the dot sits off
          centre, so one transform produces a full orbit. */}
      <span className="p2p-mark-spark p2p-mark-spark-a"><i /></span>
      <span className="p2p-mark-spark p2p-mark-spark-b"><i /></span>
    </div>
  );
}
