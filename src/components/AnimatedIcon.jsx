import { motion, useReducedMotion } from 'framer-motion';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * ANIMATED SVG ICONS
 * ---------------------------------------------------------------------------
 * The nav icons were static SVGs that the parent scaled and rotated. Scaling a
 * whole glyph is the cheapest possible "animation" and it looks it — the shape
 * never changes, it just gets bigger.
 *
 * These animate the geometry itself: strokes draw themselves along their own
 * length (`pathLength`), arrows travel, coins flip, bells ring. That is only
 * possible with SVG, which is why these are hand-authored paths rather than an
 * icon font or emoji.
 *
 * TWO RULES THIS FILE FOLLOWS
 *
 * 1. Every animation is driven by an `active` prop, not by an internal timer.
 *    Perpetual motion in a bottom nav is visual noise that competes with the
 *    live price data, which is the thing that actually needs attention.
 *
 * 2. Motion is skipped entirely when the user asks for it to be. We honour
 *    both `prefers-reduced-motion` and the app's own "reduce motion" setting —
 *    for some people this is a vestibular-nausea trigger, not a preference,
 *    and an animated icon is never worth making someone ill.
 */

const svgBase = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

/** True when we should render the static shape and no motion at all. */
export function useStill() {
  const systemReduced = useReducedMotion();
  const appReduced = useSettingsStore((s) => s.reduceMotion);
  return Boolean(systemReduced || appReduced);
}

const spring = { type: 'spring', stiffness: 380, damping: 20 };

/* -------------------------------------------------------------------------- */
/* Swap — the two arrows slide past each other and swap places                */
/* -------------------------------------------------------------------------- */

export function AnimatedSwap({ active, still, ...p }) {
  const on = active && !still;
  return (
    <svg {...svgBase} {...p}>
      <motion.g animate={on ? { y: [0, -3, 0] } : { y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}>
        <path d="M6.5 4.5v13" />
        <path d="M3.3 14.3 6.5 17.5l3.2-3.2" />
      </motion.g>
      <motion.g animate={on ? { y: [0, 3, 0] } : { y: 0 }} transition={{ duration: 0.5, ease: 'easeOut', delay: 0.05 }}>
        <path d="M17.5 19.5v-13" />
        <path d="M20.7 9.7 17.5 6.5l-3.2 3.2" />
      </motion.g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity — the trace redraws itself along its own length                   */
/* -------------------------------------------------------------------------- */

export function AnimatedActivity({ active, still, ...p }) {
  const on = active && !still;
  return (
    <svg {...svgBase} {...p}>
      <motion.path
        d="M2.5 12.5h4l2.5-6.5 4 13 2.5-6.5h6"
        initial={false}
        animate={on ? { pathLength: [0, 1], opacity: [0.35, 1] } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Wallet — the flap opens                                                     */
/* -------------------------------------------------------------------------- */

export function AnimatedWallet({ active, still, ...p }) {
  const on = active && !still;
  return (
    <svg {...svgBase} {...p}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2" />
      <rect x="3" y="7.5" width="18" height="12" rx="2.5" />
      <motion.circle
        cx="16.5"
        cy="13.5"
        r="1.6"
        fill="currentColor"
        stroke="none"
        initial={false}
        animate={on ? { scale: [1, 1.5, 1], opacity: [1, 0.7, 1] } : { scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
        style={{ transformOrigin: '16.5px 13.5px' }}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Market — the bars grow, then the trend line draws over them                */
/* -------------------------------------------------------------------------- */

export function AnimatedMarket({ active, still, ...p }) {
  const on = active && !still;
  const bars = [
    { x: 4, h: 5 },
    { x: 9.5, h: 9 },
    { x: 15, h: 6.5 }
  ];
  return (
    <svg {...svgBase} {...p}>
      {bars.map((b, i) => (
        <motion.line
          key={b.x}
          x1={b.x + 0.5}
          x2={b.x + 0.5}
          y1={19}
          y2={19 - b.h}
          initial={false}
          animate={on ? { pathLength: [0.2, 1] } : { pathLength: 1 }}
          transition={{ duration: 0.4, delay: i * 0.06, ease: 'easeOut' }}
          strokeWidth={2.6}
        />
      ))}
      <motion.path
        d="M3 10.5 8 7l4 3 6.5-5.5"
        initial={false}
        animate={on ? { pathLength: [0, 1], opacity: [0, 1] } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.55, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        strokeWidth={1.7}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Plus / more — rotates into an X                                             */
/* -------------------------------------------------------------------------- */

export function AnimatedPlus({ active, still, ...p }) {
  return (
    <motion.svg
      {...svgBase}
      {...p}
      animate={still ? {} : { rotate: active ? 135 : 0 }}
      transition={spring}
      style={{ transformOrigin: 'center' }}
    >
      <path d="M12 5v14M5 12h14" strokeWidth={2} />
    </motion.svg>
  );
}

/* -------------------------------------------------------------------------- */
/* News — pages lift                                                           */
/* -------------------------------------------------------------------------- */

export function AnimatedNews({ active, still, ...p }) {
  const on = active && !still;
  return (
    <svg {...svgBase} {...p}>
      <path d="M16 9h3a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2h-2" />
      <motion.g
        initial={false}
        animate={on ? { y: [0, -1.5, 0], rotate: [0, -3, 0] } : { y: 0, rotate: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        style={{ transformOrigin: '10px 12px' }}
      >
        <path d="M4 5h11a1 1 0 0 1 1 1v13H5a1 1 0 0 1-1-1V5z" />
        {[8, 11.5, 15].map((y, i) => (
          <motion.line
            key={y}
            x1={7}
            x2={i === 2 ? 10 : 12}
            y1={y}
            y2={y}
            initial={false}
            animate={on ? { pathLength: [0, 1] } : { pathLength: 1 }}
            transition={{ duration: 0.35, delay: 0.1 + i * 0.06 }}
          />
        ))}
      </motion.g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Bell — actually rings                                                       */
/* -------------------------------------------------------------------------- */

export function AnimatedBell({ active, still, ...p }) {
  const on = active && !still;
  return (
    <svg {...svgBase} {...p}>
      <motion.g
        initial={false}
        animate={on ? { rotate: [0, 14, -11, 8, -5, 0] } : { rotate: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        style={{ transformOrigin: '12px 4px' }}
      >
        <path d="M18 8a6 6 0 1 0-12 0c0 4.5-1.5 6-1.5 6h15S18 12.5 18 8z" />
      </motion.g>
      <motion.path
        d="M10.3 20a2 2 0 0 0 3.4 0"
        initial={false}
        animate={on ? { y: [0, 1.2, 0] } : { y: 0 }}
        transition={{ duration: 0.5, delay: 0.06 }}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings — the cog turns                                                    */
/* -------------------------------------------------------------------------- */

export function AnimatedSettings({ active, still, ...p }) {
  return (
    <motion.svg
      {...svgBase}
      {...p}
      animate={still ? {} : { rotate: active ? 90 : 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      style={{ transformOrigin: 'center' }}
    >
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </motion.svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Coin — flips on its vertical axis                                           */
/* -------------------------------------------------------------------------- */

export function AnimatedCoin({ active, still, spin = false, ...p }) {
  const on = !still && (active || spin);
  return (
    <motion.svg
      {...svgBase}
      {...p}
      animate={on ? { rotateY: 360 } : { rotateY: 0 }}
      transition={
        spin
          ? { duration: 6, repeat: Infinity, ease: 'linear' }
          : { duration: 0.75, ease: [0.22, 1, 0.36, 1] }
      }
      style={{ transformOrigin: 'center' }}
    >
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.2 10.4a3.6 3.6 0 0 1 6.1-1.3" />
      <path d="M14.8 13.6a3.6 3.6 0 0 1-6.1 1.3" />
    </motion.svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Search — the lens sweeps                                                    */
/* -------------------------------------------------------------------------- */

export function AnimatedSearch({ active, still, ...p }) {
  const on = active && !still;
  return (
    <svg {...svgBase} {...p}>
      <motion.g
        initial={false}
        animate={on ? { x: [0, 1.5, -1, 0], y: [0, -1, 1, 0] } : { x: 0, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeInOut' }}
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.6-3.6" />
      </motion.g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Trophy — lifts and gleams                                                   */
/* -------------------------------------------------------------------------- */

export function AnimatedTrophy({ active, still, ...p }) {
  const on = active && !still;
  return (
    <svg {...svgBase} {...p}>
      <motion.g
        initial={false}
        animate={on ? { y: [0, -2.2, 0], scale: [1, 1.06, 1] } : { y: 0, scale: 1 }}
        transition={spring}
        style={{ transformOrigin: 'center' }}
      >
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M6 3h12v6a6 6 0 0 1-12 0V3zM9 21h6M12 15v6" />
      </motion.g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Globe / languages — the meridians sweep                                     */
/* -------------------------------------------------------------------------- */

export function AnimatedLanguages({ active, still, ...p }) {
  const on = active && !still;
  return (
    <svg {...svgBase} {...p}>
      <motion.path
        d="M3 5h11M9 3v2c0 5-2.5 8-6 9"
        initial={false}
        animate={on ? { pathLength: [0, 1] } : { pathLength: 1 }}
        transition={{ duration: 0.45 }}
      />
      <motion.path
        d="M6.5 10c1.6 3.1 4 5 7 6"
        initial={false}
        animate={on ? { pathLength: [0, 1] } : { pathLength: 1 }}
        transition={{ duration: 0.45, delay: 0.08 }}
      />
      <motion.path
        d="m12.5 21 4.5-10 4.5 10M14.5 17h6"
        initial={false}
        animate={on ? { pathLength: [0, 1], opacity: [0.3, 1] } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.45, delay: 0.14 }}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* MENU ICONS                                                                  */
/* -------------------------------------------------------------------------- */
/*
 * The drawer tiles used the static line-art set, so opening the menu showed
 * twelve motionless glyphs. These animate their own geometry on entry — each
 * one staggered by the tile index — which turns the drawer from a grid of
 * symbols into something that reads as a single deliberate motion.
 *
 * `delay` is passed by the tile so the sweep follows the grid order. Entry
 * animations only: nothing here loops, because a permanently moving menu is
 * noise, and because looping SVG filters on twelve tiles at once is exactly
 * how you drop frames on a budget phone.
 */

const entry = (delay = 0, duration = 0.5) => ({
  duration,
  delay,
  ease: [0.22, 1, 0.36, 1]
});

/** Trend line draws itself, then the arrowhead pops. */
export function MenuTrend({ still, delay = 0, ...p }) {
  return (
    <svg {...svgBase} {...p}>
      <motion.path
        d="M3 16.5 9 10l4 4 7.5-8"
        initial={still ? false : { pathLength: 0, opacity: 0.3 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={entry(delay, 0.6)}
      />
      <motion.path
        d="M21 3h-4M21 3v4"
        initial={still ? false : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={entry(delay + 0.28, 0.35)}
        style={{ transformOrigin: '19px 4px' }}
      />
    </svg>
  );
}

/** Liquidity pool: layers settle downward one by one. */
export function MenuPools({ still, delay = 0, ...p }) {
  return (
    <svg {...svgBase} {...p}>
      {[6, 12, 18].map((cy, i) => (
        <motion.ellipse
          key={cy}
          cx="12"
          cy={cy}
          rx="8.5"
          ry="3.2"
          initial={still ? false : { y: -7, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={entry(delay + i * 0.09, 0.45)}
        />
      ))}
      <motion.path
        d="M3.5 6v12M20.5 6v12"
        initial={still ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={entry(delay + 0.3, 0.3)}
      />
    </svg>
  );
}

/** Globe: the meridian sweeps across as if the sphere turns. */
export function MenuGlobe({ still, delay = 0, ...p }) {
  return (
    <svg {...svgBase} {...p}>
      <circle cx="12" cy="12" r="9" />
      <motion.path
        d="M3 12h18"
        initial={still ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={entry(delay + 0.1, 0.45)}
      />
      <motion.ellipse
        cx="12"
        cy="12"
        rx="4"
        ry="9"
        initial={still ? false : { rx: 0.5, opacity: 0 }}
        animate={{ rx: 4, opacity: 1 }}
        transition={entry(delay + 0.18, 0.55)}
      />
    </svg>
  );
}

/** Shield: outline draws, then the tick lands inside it. */
export function MenuShield({ still, delay = 0, ...p }) {
  return (
    <svg {...svgBase} {...p}>
      <motion.path
        d="M12 3l7.5 3v6c0 4.6-3.1 7.9-7.5 9.3C7.6 19.9 4.5 16.6 4.5 12V6L12 3z"
        initial={still ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={entry(delay, 0.6)}
      />
      <motion.path
        d="m8.8 12.2 2.2 2.2 4.2-4.4"
        initial={still ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={entry(delay + 0.3, 0.4)}
      />
    </svg>
  );
}

/** Document with lines that type themselves in. */
export function MenuDoc({ still, delay = 0, ...p }) {
  return (
    <svg {...svgBase} {...p}>
      <motion.path
        d="M6 3h8l4 4v14H6z"
        initial={still ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={entry(delay, 0.55)}
      />
      <path d="M14 3v4h4" />
      {[11, 14, 17].map((y, i) => (
        <motion.line
          key={y}
          x1="9"
          x2={i === 2 ? 13 : 15}
          y1={y}
          y2={y}
          initial={still ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={entry(delay + 0.25 + i * 0.07, 0.3)}
        />
      ))}
    </svg>
  );
}

/** Building: floors rise from the ground up. */
export function MenuBuilding({ still, delay = 0, ...p }) {
  return (
    <svg {...svgBase} {...p}>
      <motion.path
        d="M4 21V6.5L12 3l8 3.5V21"
        initial={still ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={entry(delay, 0.55)}
      />
      <path d="M2.5 21h19" />
      {[
        [9, 10],
        [14, 10],
        [9, 14],
        [14, 14]
      ].map(([x, y], i) => (
        <motion.rect
          key={`${x}-${y}`}
          x={x - 1.1}
          y={y - 1.1}
          width="2.2"
          height="2.2"
          rx="0.4"
          initial={still ? false : { scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={entry(delay + 0.22 + i * 0.05, 0.3)}
          style={{ transformOrigin: `${x}px ${y}px` }}
        />
      ))}
    </svg>
  );
}

/** Key: the bit swings out from the bow. */
export function MenuKey({ still, delay = 0, ...p }) {
  return (
    <svg {...svgBase} {...p}>
      <motion.circle
        cx="7.5"
        cy="15.5"
        r="4"
        initial={still ? false : { scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={entry(delay, 0.45)}
        style={{ transformOrigin: '7.5px 15.5px' }}
      />
      <motion.path
        d="m10.5 12.5 8-8M16 7l2.5 2.5M18.5 4.5 21 7"
        initial={still ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={entry(delay + 0.2, 0.45)}
      />
    </svg>
  );
}

/** Info: the dot drops onto the stem. */
export function MenuInfo({ still, delay = 0, ...p }) {
  return (
    <svg {...svgBase} {...p}>
      <motion.circle
        cx="12"
        cy="12"
        r="9"
        initial={still ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={entry(delay, 0.55)}
      />
      <motion.path
        d="M12 11v5"
        initial={still ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={entry(delay + 0.25, 0.3)}
      />
      <motion.circle
        cx="12"
        cy="7.8"
        r="0.9"
        fill="currentColor"
        stroke="none"
        initial={still ? false : { y: -5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={entry(delay + 0.32, 0.35)}
      />
    </svg>
  );
}

/** Cog for the menu tile — turns a quarter on entry. */
export function MenuSettings({ still, delay = 0, ...p }) {
  return (
    <motion.svg
      {...svgBase}
      {...p}
      initial={still ? false : { rotate: -70, opacity: 0 }}
      animate={{ rotate: 0, opacity: 1 }}
      transition={entry(delay, 0.6)}
      style={{ transformOrigin: 'center' }}
    >
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.2v2.6M12 19.2v2.6M2.2 12h2.6M19.2 12h2.6M5.1 5.1l1.9 1.9M17 17l1.9 1.9M18.9 5.1 17 7M7 17l-1.9 1.9" />
    </motion.svg>
  );
}

/** Two arrows circling — P2P / exchange between people. */
export function MenuP2P({ still, delay = 0, ...p }) {
  return (
    <svg {...svgBase} {...p}>
      <motion.path
        d="M4 9h12l-3-3M20 15H8l3 3"
        initial={still ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={entry(delay, 0.6)}
      />
      <motion.circle
        cx="12"
        cy="12"
        r="9.2"
        strokeDasharray="3 4"
        initial={still ? false : { rotate: -60, opacity: 0 }}
        animate={{ rotate: 0, opacity: 0.45 }}
        transition={entry(delay + 0.15, 0.6)}
        style={{ transformOrigin: 'center' }}
      />
    </svg>
  );
}

/** Trophy for the ranking tile — rises and settles. */
export function MenuTrophy({ still, delay = 0, ...p }) {
  return (
    <motion.svg
      {...svgBase}
      {...p}
      initial={still ? false : { y: 6, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 16, delay }}
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M6 3h12v6a6 6 0 0 1-12 0V3zM9 21h6M12 15v6" />
    </motion.svg>
  );
}

/** Candlestick chart — bars grow from the axis. */
export function MenuMarket({ still, delay = 0, ...p }) {
  const bars = [
    { x: 6, top: 6, bot: 15 },
    { x: 12, top: 4, bot: 18 },
    { x: 18, top: 9, bot: 20 }
  ];
  return (
    <svg {...svgBase} {...p}>
      {bars.map((b, i) => (
        <motion.g
          key={b.x}
          initial={still ? false : { scaleY: 0, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={entry(delay + i * 0.08, 0.45)}
          style={{ transformOrigin: `${b.x}px 21px` }}
        >
          <line x1={b.x} x2={b.x} y1={b.top} y2={b.bot} />
          <rect x={b.x - 2} y={b.top + 2} width="4" height={b.bot - b.top - 4} rx="1" />
        </motion.g>
      ))}
    </svg>
  );
}
