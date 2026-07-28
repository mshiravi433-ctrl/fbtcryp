import { motion } from 'framer-motion';

/**
 * Consistent enter/exit motion for every route.
 *
 * WHY THERE IS NO `filter: blur()` HERE ANY MORE
 *
 * This used to animate `filter: 'blur(6px)' → 'blur(0px)'` across the whole
 * page on every single navigation. That one line was the biggest cause of the
 * "the app stutters when I open a new tab" feeling, for two compounding
 * reasons:
 *
 *   1. `filter` is not a compositor-only property the way `opacity` and
 *      `transform` are. Animating it forces the browser to re-rasterise the
 *      entire page bitmap on every frame — not move an existing texture, but
 *      redraw it and then run a separable Gaussian blur over it, ~19 times
 *      for a 0.32s transition.
 *   2. Every `.card` inside that page had `backdrop-filter: blur(16px)`. A
 *      backdrop-filter has to sample what is painted *behind* it — and what
 *      was behind it was being re-blurred every frame by (1). So the cost was
 *      not additive, it was nested: an animated blur containing 5–11 more
 *      blurs that all had to be recomputed each time the parent changed.
 *
 * On a desktop GPU you never notice. On the mid-range Android WebView this app
 * actually ships to, that is a dropped-frame burst exactly at the moment the
 * user taps — which is precisely when a person is watching for a response and
 * is least forgiving.
 *
 * `opacity` + `transform` are both handled by the compositor from an already
 * rasterised layer, so the same motion now costs approximately nothing.
 *
 * The exit is also much shorter than the enter (0.12s vs 0.26s). `AnimatePresence
 * mode="wait"` will not mount the incoming route until the outgoing one has
 * finished leaving, so the exit duration is dead time added to every single
 * navigation before anything new can even start loading.
 */
export default function PageTransition({ children, className = 'page' }) {
  return (
    <motion.main
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      // The per-variant `transition` is the supported way to give exit its own
      // timing; there is no `exitTransition` prop.
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12, ease: 'easeIn' } }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.main>
  );
}

/** Staggered children helper. */
export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } }
};

export const riseIn = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }
};
