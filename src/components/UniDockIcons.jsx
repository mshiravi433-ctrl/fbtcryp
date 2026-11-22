/**
 * THE FOUR SECTION GLYPHS — Farm · Loan · Protection · Auto Orders.
 * ---------------------------------------------------------------------------
 * The dock's three slots are the *other three* sections of this group (the
 * current page is the one you are standing on), plus the separate AI disc.
 * None of AnimatedIcon's glyphs says "farm" or "insurance", and inventing
 * them here keeps that shared file's promise intact: it is the general icon
 * set, this is the vocabulary of one four-screen group.
 *
 * Same conventions as the rest of the icon set — 24×24 viewBox, stroke
 * `currentColor`, round caps, no fills — so they sit beside each other at
 * the same optical weight. The only motion is a one-shot draw when the
 * button is tapped (`pulse`), driven by the dock, never a loop: a nav bar
 * that animates on its own competes with the live numbers behind it.
 */
import { motion } from 'framer-motion';

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

/** Draws once per tap; a still user gets the finished shape, no animation. */
const draw = (pulse, still, delay = 0) =>
  still || !pulse
    ? { pathLength: 1, opacity: 1 }
    : { pathLength: [0, 1], opacity: [0.35, 1] };

const drawTransition = (delay = 0) => ({ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] });

/** FARM — a sprout in soil: what "yield" actually means. */
export function UniFarmIcon({ pulse = 0, still, ...p }) {
  return (
    <svg {...BASE} {...p}>
      <motion.path
        d="M12 21v-7"
        initial={false}
        animate={draw(pulse, still)}
        transition={drawTransition()}
      />
      <motion.path
        d="M12 14c0-3.3-2.2-5-5-5 0 3 1.9 5 5 5z"
        initial={false}
        animate={draw(pulse, still, 0.06)}
        transition={drawTransition(0.06)}
      />
      <motion.path
        d="M12 14c0-3.3 2.2-5 5-5 0 3-1.9 5-5 5z"
        initial={false}
        animate={draw(pulse, still, 0.12)}
        transition={drawTransition(0.12)}
      />
      <motion.path
        d="M5.5 21h13"
        initial={false}
        animate={draw(pulse, still, 0.16)}
        transition={drawTransition(0.16)}
      />
    </svg>
  );
}

/** LOAN — a coin stack with an arrow out: borrowing, not saving. */
export function UniLoanIcon({ pulse = 0, still, ...p }) {
  return (
    <svg {...BASE} {...p}>
      <motion.path
        d="M4 8.2c0-1.2 1.8-2.2 4-2.2s4 1 4 2.2-1.8 2.2-4 2.2-4-1-4-2.2z"
        initial={false}
        animate={draw(pulse, still)}
        transition={drawTransition()}
      />
      <motion.path
        d="M4 8.2v3.6c0 1.2 1.8 2.2 4 2.2s4-1 4-2.2V8.2"
        initial={false}
        animate={draw(pulse, still, 0.08)}
        transition={drawTransition(0.08)}
      />
      <motion.path
        d="M4 11.8v3.6c0 1.2 1.8 2.2 4 2.2 1 0 1.9-.13 2.6-.36"
        initial={false}
        animate={draw(pulse, still, 0.14)}
        transition={drawTransition(0.14)}
      />
      <motion.path
        d="M15.5 20.5 20 16m0 0h-3.4M20 16v3.4"
        initial={false}
        animate={draw(pulse, still, 0.2)}
        transition={drawTransition(0.2)}
      />
    </svg>
  );
}

/** PROTECTION — the shield, with the tick drawn last. */
export function UniShieldIcon({ pulse = 0, still, ...p }) {
  return (
    <svg {...BASE} {...p}>
      <motion.path
        d="M12 3.2 5.4 6v5.6c0 4 2.7 7.5 6.6 9.2 3.9-1.7 6.6-5.2 6.6-9.2V6L12 3.2z"
        initial={false}
        animate={draw(pulse, still)}
        transition={drawTransition()}
      />
      <motion.path
        d="m9.2 12.1 2 2 3.6-3.9"
        initial={false}
        animate={draw(pulse, still, 0.16)}
        transition={drawTransition(0.16)}
      />
    </svg>
  );
}

/** AUTO ORDERS — a clock with a return arrow: an order that repeats. */
export function UniOrdersIcon({ pulse = 0, still, ...p }) {
  return (
    <svg {...BASE} {...p}>
      <motion.path
        d="M20.4 12a8.4 8.4 0 1 1-2.5-6"
        initial={false}
        animate={draw(pulse, still)}
        transition={drawTransition()}
      />
      <motion.path
        d="M20.6 3.6v4.2h-4.2"
        initial={false}
        animate={draw(pulse, still, 0.1)}
        transition={drawTransition(0.1)}
      />
      <motion.path
        d="M12 8.4V12l2.6 1.6"
        initial={false}
        animate={draw(pulse, still, 0.14)}
        transition={drawTransition(0.14)}
      />
    </svg>
  );
}
