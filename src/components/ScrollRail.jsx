/**
 * SCROLL RAIL — one line that scrolls instead of wrapping or overflowing.
 * ---------------------------------------------------------------------------
 * Reported: «باید به صورت ریلی در یک خط و امکان حرکت ریلی باشد که از صفحه
 * بیرون نزند». A row of chips that wraps onto three lines (or, worse, is
 * `flex-wrap: nowrap` with no scroller) is what pushes content past the edge of
 * a phone screen. This is the single fix, used by every rail in the app:
 *
 *   · the track never wraps and never grows past its container — `min-width: 0`
 *     on the shell is what stops a flex child from forcing the page wider
 *   · scrolling is horizontal only, with `overscroll-behavior-x: contain` so a
 *     swipe at the end of the rail does not navigate the page back
 *   · the edge fades appear ONLY on the side that has more content, so they are
 *     a signal ("there is more this way") and not decoration. They are drawn
 *     with a mask, not a coloured overlay, which means they work on glass and
 *     in the light theme without a second colour to keep in sync
 *   · no scrollbar: on a phone it costs height and does nothing
 *
 * RTL is handled by measuring `Math.abs(scrollLeft)` — in a right-to-left
 * scroller the browser reports 0 → -max, so the same two comparisons work in
 * both directions.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export default function ScrollRail({
  className = '',
  children,
  ariaLabel,
  role = 'group',
  fade = 22,
  ...rest
}) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const x = Math.abs(el.scrollLeft);
    setEdges({ start: x > 4, end: x < max - 4 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    measure();

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
      for (const child of Array.from(el.children)) observer.observe(child);
    }
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const shellCls = [
    'scroll-rail',
    edges.start ? 'has-start' : '',
    edges.end ? 'has-end' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={shellCls}>
      <div
        ref={ref}
        className={`scroll-rail-track ${className}`.trim()}
        role={role}
        aria-label={ariaLabel}
        style={{ '--rail-fade': `${fade}px` }}
        data-testid="scroll-rail"
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}
