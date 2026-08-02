import { motion } from 'framer-motion';
import { useStill } from './AnimatedIcon';
import { isNativeShell } from '../lib/nativeShell';

/**
 * The highlight pill behind the selected tab of a `.segmented` control.
 *
 * ─── THE BUG ────────────────────────────────────────────────────────────────
 * Reported on Signals: tapping 1D / 7D / 30D "jumps" before the blue pill
 * settles on the new option.
 *
 * All 14 of these controls used a Framer Motion SHARED LAYOUT animation:
 *
 *     {selected && <motion.span layoutId="hz" className="seg-indicator" />}
 *
 * `layoutId` is not an ordinary transition. Because the element is removed
 * from one button and added to another, Framer has to:
 *
 *   1. let React perform that move,
 *   2. read the new box with getBoundingClientRect() — a forced synchronous
 *      reflow,
 *   3. invert the delta and animate back to where it came from.
 *
 * Between steps 1 and 2 the pill has genuinely been laid out at its
 * destination. In a desktop browser the inversion lands in the same frame and
 * nobody sees it. Inside an Android WebView the forced reflow can miss the
 * frame budget, so that intermediate state gets painted: the pill flashes at
 * the new tab, disappears, then slides in. That is the reported jump — and the
 * same measure-then-animate pattern is behind the general "popups flicker like
 * a fluorescent tube" complaint.
 *
 * ─── THE FIX, AND WHY IT IS SHAPED THIS WAY ─────────────────────────────────
 * The obvious fix — one absolutely-positioned pill per control driven by a
 * percentage transform — would need `.segmented` to become a positioning
 * context and would have to account for its 3px gap and 3px padding in the
 * arithmetic. That is a rewrite of 14 call sites and their CSS to fix a defect
 * that only appears on one platform.
 *
 * So instead: keep the DOM exactly as it is, and drop the layout animation
 * where it misbehaves. On native (and whenever motion is reduced) the pill is
 * a plain span that simply appears under the selected tab — no measurement, no
 * inversion, no intermediate paint, nothing to stutter. In a browser the
 * original sliding animation is untouched.
 *
 * A tab indicator that arrives instantly reads as responsive. One that
 * stutters reads as broken. Losing the slide on the phone costs nothing worth
 * defending.
 *
 * @param {string} id         the shared layoutId, unique among MOUNTED elements
 * @param {string} [className] defaults to the segmented pill
 * @param {object} [style]     per-instance colours (Trade tints buy/sell)
 * @param {object} [transition] spring override (the nav glow is stiffer)
 */
export default function SegIndicator({
  id,
  className = 'seg-indicator',
  style,
  transition = { type: 'spring', stiffness: 420, damping: 32 }
}) {
  const still = useStill();

  /*
   * Deliberately not reactive. A WebView cannot stop being a WebView, so
   * subscribing to it would be wasted work.
   *
   * Both branches render the same tag with the same class, so the switch is
   * invisible except for the motion.
   */
  if (still || isNativeShell()) {
    return <span className={className} style={style} />;
  }

  return <motion.span layoutId={id} className={className} style={style} transition={transition} />;
}
