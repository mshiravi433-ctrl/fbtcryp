import { useEffect, useRef } from 'react';
import {
  activateTab,
  findTabStrip,
  isRtl,
  resolveTabStep,
  selectedIndex,
  SWIPE_IGNORE,
  tabsOf
} from '../lib/tabGesture.js';

/**
 * «کشیدن چپ/راست = تبِ قبل/بعد، نه صفحهٔ قبل/بعد»
 * ---------------------------------------------------------------------------
 * The app-level wrapper every route renders inside. It listens for ONE
 * horizontal drag on the screen the reader is already looking at and clicks
 * the neighbouring tab of THAT screen's own tab strip — nothing else. There is
 * no router call in this file, so no drag can ever leave the page: the only
 * way a gesture changes what is on screen is the strip's own `onClick`.
 *
 * ─── THE THREE THINGS THIS FIXES ───────────────────────────────────────────
 *
 * 1. A SCREEN WITH NO TABS DOES NOTHING. Not «navigates instead». The old
 *    behaviour (drag ⇒ previous/next ROUTE) is exactly the complaint: a swipe
 *    on a page with no tab strip moved the whole app. `findTabStrip` returns
 *    null there and the gesture dies at that line.
 *
 * 2. THE PANEL'S STRIP IS THE STRIP. A touch inside an open `tabpanel` drives
 *    the tablist whose `aria-controls` points at that panel. A touch elsewhere
 *    drives the page's first visible strip. A touch on a strip itself is left
 *    to the strip (it has to be scrollable on a narrow phone).
 *
 * 3. THE GESTURE ENDS AT THE END OF THE STRIP. Previous on the first tab and
 *    next on the last are both no-ops — never a wrap-around, which reads as
 *    having been sent somewhere else.
 *
 * ─── WHY THE LISTENERS ARE NATIVE AND ON THE ZONE ──────────────────────────
 * `touchstart` is captured (not bubbled) on the zone so nothing inside can
 * `stopPropagation()` a drag away from us, while `touchend`/`touchcancel` are
 * ordinary listeners. It is still decided ONCE, on the release — there is no
 * `touchmove` work per frame, so a long market list keeps native scrolling.
 * Framer Motion's drag surface in the drawers stops propagation itself, which
 * the capture listener sidesteps without fighting it.
 *
 * The route key is compared at the END: a gesture that began on one screen and
 * released after the router already swapped screens cannot change a tab the
 * reader never touched (see the pin in test/page-tab-swipe.test.jsx).
 */
export default function PageTabSwipe({ routeKey, children }) {
  const zoneRef = useRef(null);
  const gesture = useRef(null);

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone || typeof window === 'undefined') return undefined;

    const onStart = (event) => {
      gesture.current = null;
      if (event.touches?.length !== 1) return;
      const target = event.target;
      if (!target || target.closest?.(SWIPE_IGNORE)) return;
      const touch = event.touches[0];
      gesture.current = {
        x: touch.clientX,
        y: touch.clientY,
        at: Date.now(),
        target,
        routeKey
      };
    };

    const onEnd = (event) => {
      const start = gesture.current;
      gesture.current = null;
      if (!start || start.routeKey !== routeKey) return;
      if (event.touches?.length || event.changedTouches?.length !== 1) return;
      const touch = event.changedTouches[0];
      const tabs = tabsOf(findTabStrip(zone, start.target));
      const index = selectedIndex(tabs);
      const next = resolveTabStep(
        { dx: touch.clientX - start.x, dy: touch.clientY - start.y, ms: Date.now() - start.at },
        tabs,
        index,
        isRtl(zone)
      );
      activateTab(next);
    };

    const onCancel = () => { gesture.current = null; };

    zone.addEventListener('touchstart', onStart, { capture: true, passive: true });
    zone.addEventListener('touchend', onEnd, { passive: true });
    zone.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      zone.removeEventListener('touchstart', onStart, { capture: true });
      zone.removeEventListener('touchend', onEnd);
      zone.removeEventListener('touchcancel', onCancel);
      gesture.current = null;
    };
  }, [routeKey]);

  return <div className="app-tab-swipe-zone" ref={zoneRef}>{children}</div>;
}
