import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStill } from './AnimatedIcon';

/**
 * AUTO ORDERS — the box at the top of the screen.
 * ===========================================================================
 *
 * Requested: «باکس بالای صفحه خیلی باید مدرن‌تر، متناسب هر دو تم و بی‌نظیر
 * باشد و انیمیشن و svg استفاده بشه — خیلی باکس را قشنگ‌تر کن.»
 *
 * ─── WHAT IT REPLACES, AND WHY THAT MATTERED ────────────────────────────────
 * The previous hero was a gradient tile with a ring and three numbers in a
 * bordered grid. It was correct and it was anonymous: the same rounded panel,
 * the same 1px hairline, the same three-cell grid as a dozen other screens, so
 * it read as "a card that happens to be first" rather than as the instrument
 * panel for a screen called AUTO ORDERS.
 *
 * ─── THE IDEA: A BEACON, NOT A CARD ─────────────────────────────────────────
 * An auto order is a promise to keep watching while the user does something
 * else. So the artwork is a beacon: a radar sweep looking for a price, a
 * target core that pulses when something is ready, and an order strip along
 * the bottom where every stored order is one bar whose height is its distance
 * to its own target — a real reading of the user's own data, not a decoration.
 *
 *   · THE SWEEP turns forever, and only accelerates when something is ready.
 *   · THE CORE is filled when `ready > 0`, hollow otherwise, and it breathes.
 *   · THE STRIP gets one bar per order (capped), and the bars that belong to a
 *     READY order light up in the "up" ink. The strip is derived from props,
 *     so it is honest: an empty pipeline draws an empty strip.
 *
 * ─── BOTH THEMES, BY CONSTRUCTION ───────────────────────────────────────────
 * Every colour below is either a theme variable (`--bg-panel`, `--line`,
 * `--text-3`, `--rgb-*`) or an explicitly listed pair in orders-hero.css
 * (`:root[data-theme='light']` block at the bottom). No neon-on-white text:
 * the light block re-inks the title, the numerals and the SVG strokes, and
 * the dark block keeps the RGB spectrum. The card is legible in both without
 * a single `filter`.
 *
 * ─── THE PERFORMANCE RULES THIS REPO ALREADY WROTE DOWN ─────────────────────
 * Same budget as FARM's promo banner and the rest of this screen:
 *   · NO `filter: blur()` and NO `backdrop-filter` — the glow is a
 *     radial-gradient, which is a soft edge for free (see
 *     styles/orders-modern.css, and 2026-09-24-seo-landing-pages-and-motion-
 *     budget-fa.md §1.2 for the frame cost of a real blur).
 *   · Every continuous animation is CSS on `transform`, `opacity`,
 *     `stroke-dashoffset` or `height` of a 6px bar — composited, no layout.
 *   · ALL of it stops under `prefers-reduced-motion` and under the app's own
 *     reduce-motion switch, which is what `useStill()` reads. The card keeps
 *     its full design when still: the sweep parks at a fixed angle, the core
 *     stops mid-breath, and nothing disappears. A "reduced motion" screen that
 *     drops the illustration is a different screen, not a calmer one.
 *   · `memo` with primitives only. The orders screen re-renders on every price
 *     poll; this box must not be part of that reconciliation beyond the three
 *     numbers it actually displays.
 *
 * ─── NO INVENTED NUMBERS ────────────────────────────────────────────────────
 * `queuedUsd` renders as an em dash when the pipeline value is unknown, never
 * as "$0.00" — see orders.js `orderNotionalUsd`, which returns null rather
 * than zero for exactly this reason. `distancePct` is optional for the same
 * reason: a bar with no measurable distance renders at its neutral height.
 */

/** A bar's height, in percent, from how far its order is from its target. */
function barHeight(distancePct) {
  if (!Number.isFinite(distancePct)) return 34;
  /* Close to the target → tall. 40% away or further → the floor. */
  const closeness = Math.max(0, Math.min(1, 1 - Math.abs(distancePct) / 40));
  return Math.round(18 + closeness * 74);
}

const OrdersHero = memo(function OrdersHero({
  watching = 0,
  ready = 0,
  queuedUsd = null,
  bars = []
}) {
  const { t } = useTranslation();
  const still = useStill();

  const armed = ready > 0;
  /* One bar per order, at most 14: past that the strip stops reading as a
     count and starts reading as a texture. */
  const strip = Array.isArray(bars) ? bars.slice(0, 14) : [];
  const empty = strip.length === 0;

  return (
    <section
      className={`ordx-hero${armed ? ' is-armed' : ''}${still ? ' is-still' : ''}`}
      data-testid="orders-hero"
      data-armed={armed ? 'true' : 'false'}
      aria-label={t('orders.bannerTitle')}
    >
      <span className="ordx-orb ordx-orb-a" aria-hidden="true" />
      <span className="ordx-orb ordx-orb-b" aria-hidden="true" />
      <span className="ordx-sheen" aria-hidden="true" />

      <div className="ordx-head">
        {/* ─── THE BEACON ───────────────────────────────────────────────────
            Inline SVG, ~1.6 KB, no request and no icon font — the same rule
            every other illustration in this app follows, and the reason the
            card cannot break when an icon CDN is unreachable (which, for a
            large part of this audience, it is). */}
        <span className="ordx-beacon" aria-hidden="true">
          <svg viewBox="0 0 72 72" fill="none" focusable="false">
            <defs>
              <linearGradient id="ordxCore" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#00e5ff" />
                <stop offset="100%" stopColor="#7c4dff" />
              </linearGradient>
              <linearGradient id="ordxSweep" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#00ff9d" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.15" />
              </linearGradient>
              <radialGradient id="ordxHalo" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* the dish: a soft radial halo, drawn — never blurred */}
            <circle cx="36" cy="36" r="33" fill="url(#ordxHalo)" />
            {/* three range rings, the outer one dashed and turning */}
            <circle cx="36" cy="36" r="30" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
            <circle className="ordx-ring-dash" cx="36" cy="36" r="23" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="2.5 6" strokeLinecap="round" />
            <circle cx="36" cy="36" r="16" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />

            {/* the sweep — one arm, turning. `transform-origin` is set in CSS
                in user units so it rotates about the dish centre, not the
                SVG box (which is what silently offsets every rotating icon
                drawn this way). */}
            <g className="ordx-sweep">
              <path d="M36 36 L36 6 A30 30 0 0 1 57.2 15.8 Z" fill="url(#ordxSweep)" opacity="0.3" />
              <path d="M36 36 L36 6" stroke="#00ff9d" strokeOpacity="0.6" strokeWidth="1.2" strokeLinecap="round" />
            </g>

            {/* the pulse: an expanding ring, opacity only */}
            <circle className="ordx-pulse" cx="36" cy="36" r="16" stroke="#00ff9d" strokeWidth="1.2" fill="none" />

            {/* the core. Hollow while nothing is armed, filled when one is. */}
            <circle className="ordx-core-halo" cx="36" cy="36" r="11" fill="#00ff9d" fillOpacity="0.12" />
            <circle
              className="ordx-core"
              cx="36" cy="36" r="7.4"
              fill={armed ? 'url(#ordxCore)' : 'none'}
              stroke="url(#ordxCore)"
              strokeWidth="1.8"
            />
            <circle className="ordx-core-dot" cx="36" cy="36" r="2.4" fill={armed ? '#04121a' : '#00ff9d'} />

            {/* the target crosshair, four ticks that never move: the levels the
                sweep is looking for */}
            <g stroke="currentColor" strokeOpacity="0.32" strokeWidth="1.4" strokeLinecap="round">
              <path d="M36 3.5v4" />
              <path d="M36 64.5v4" />
              <path d="M3.5 36h4" />
              <path d="M64.5 36h4" />
            </g>
          </svg>
        </span>

        <div className="ordx-copy">
          <span className="ordx-live">
            <span className="ordx-live-dot" aria-hidden="true" />
            {t('orders.heroLive')}
          </span>
          <h2 className="ordx-title">{t('orders.bannerTitle')}</h2>
          <p className="ordx-sub">{t('orders.bannerSub')}</p>
        </div>
      </div>

      <div className="ordx-stats">
        <div className="ordx-stat">
          <span className="ordx-stat-val" data-testid="orders-hero-watching">{watching}</span>
          <span className="ordx-stat-lbl">{t('orders.statWatching')}</span>
        </div>
        <div className={`ordx-stat${armed ? ' is-ready' : ''}`}>
          <span className="ordx-stat-val" data-testid="orders-hero-ready">{ready}</span>
          <span className="ordx-stat-lbl">{t('orders.statReady')}</span>
        </div>
        <div className="ordx-stat ordx-stat-wide">
          <span className="ordx-stat-val ordx-stat-usd" dir="ltr">
            {queuedUsd > 0 ? `$${queuedUsd.toFixed(2)}` : '—'}
          </span>
          <span className="ordx-stat-lbl">{t('orders.pipelineTitle')}</span>
        </div>
      </div>

      {/* ─── THE STRIP ───────────────────────────────────────────────────────
          One bar per live order. `height` animates on a 6px-wide element, so
          the repaint is a strip 90px tall and ~200px wide — not the card. */}
      <div className="ordx-strip" aria-hidden="true" data-empty={empty ? 'true' : 'false'}>
        {empty
          ? Array.from({ length: 14 }, (_, i) => (
            <span className="ordx-bar is-idle" key={`idle-${i}`} style={{ '--i': i }} />
          ))
          : strip.map((b, i) => (
            <span
              className={`ordx-bar${b?.ready ? ' is-ready' : ''}`}
              key={b?.id ?? `bar-${i}`}
              style={{ '--i': i, '--h': `${barHeight(b?.distancePct)}%` }}
            />
          ))}
      </div>
    </section>
  );
});

export default OrdersHero;
