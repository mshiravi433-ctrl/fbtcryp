import { useEffect, useRef, useState } from 'react';
import { useStill } from '../components/AnimatedIcon';

/**
 * HIDE-ON-SCROLL-DOWN, SHOW-ON-SCROLL-UP — one state for header AND dock.
 * ---------------------------------------------------------------------------
 * Requested for the Farm / Loan / Protection / Auto-Orders screens:
 * «وقتی اسکرول می‌کنی پایین هیدر و فوتر محو شود و اسکرول بالا دوباره بیاد»
 * — scrolling down fades the header and the footer away, scrolling back up
 * brings them back.
 *
 * One hook, one boolean, consumed by both bars in AppChrome, so the two can
 * never disagree about whether the chrome is on screen. Two independent
 * listeners (one in Header, one in the dock) would drift a frame apart and
 * read as a glitch.
 *
 * THE RULES, AND WHY EACH NUMBER IS WHAT IT IS
 *
 *   · Below 48px the chrome is ALWAYS visible. At the top of the page the
 *     user is orienting, not reading — hiding the nav there strands them.
 *   · Hiding needs BOTH a downward move (> 6px in one frame batch) AND a
 *     position past 140px. The position gate stops a short page that barely
 *     scrolls from ever losing its nav; the direction gate stops a single
 *     jittery wheel tick from flickering it.
 *   · Any upward move (> 6px) shows it again immediately. That is the whole
 *     point of the pattern: the moment the user reaches for the nav, it is
 *     there. No dwell, no threshold on the way back.
 *   · `locked` (a sheet is open) forces visible. Hiding the bar out from
 *     under an open menu would orphan the menu's own close affordance.
 *   · Reduced motion (system OR the app's own setting, via `useStill`)
 *     disables hiding entirely. A bar that slides away on scroll is motion
 *     tied to the user's own gesture, but for someone who asked for still
 *     the contract is "nothing moves" — so nothing does.
 *
 * rAF-throttled: a scroll listener that setStates per event would re-render
 * the shell on every wheel tick of a long Farm list. One frame batch, one
 * comparison, at most one state write.
 */
export const HIDE_AFTER_PX = 140;
export const SHOW_NEAR_TOP_PX = 48;
export const DIRECTION_EPS_PX = 6;

export function useHideOnScroll({ enabled = true, locked = false } = {}) {
  const still = useStill();
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const raf = useRef(0);

  /* Entering (or leaving) a screen that uses this chrome starts visible and
     re-anchors the direction baseline, so the first scroll frame after a
     navigation cannot read as a huge downward jump and hide instantly. */
  useEffect(() => {
    setHidden(false);
    lastY.current = typeof window !== 'undefined' ? Math.max(0, window.scrollY) : 0;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || still || locked) {
      setHidden(false);
      return undefined;
    }
    if (typeof window === 'undefined') return undefined;

    const onScroll = () => {
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        const y = Math.max(0, window.scrollY);
        const delta = y - lastY.current;
        lastY.current = y;
        if (y <= SHOW_NEAR_TOP_PX) setHidden(false);
        else if (delta > DIRECTION_EPS_PX && y > HIDE_AFTER_PX) setHidden(true);
        else if (delta < -DIRECTION_EPS_PX) setHidden(false);
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [enabled, still, locked]);

  return hidden;
}

export default useHideOnScroll;
