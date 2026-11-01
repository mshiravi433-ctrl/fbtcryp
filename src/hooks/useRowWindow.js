import { useEffect, useRef, useState } from 'react';

/**
 * ─── DRAW WHAT IS ON SCREEN, KEEP EVERYTHING IN THE DOM ─────────────────────
 *   «صفحه بازار خیلی کند هست … علت سرعت کم هنگام اسکرول و لود شدگی چیه»
 *
 * The market list renders 60 rows at a time (up to 500 once the reader has
 * paged). Rendering was never the whole cost: the cost is that all sixty are
 * PAINTED at once — sixty SVG sparklines, each with its own gradient `<defs>`,
 * inside sixty rounded cards. That first paint is the visible "slow load", and
 * during the scroll every one of those tiles is a candidate for compositor
 * eviction and re-paint, which is the «چشمک میزنه».
 *
 * `content-visibility: auto` was tried for exactly this and reverted (see
 * §14.7 of market-modern.css): skipping LAYOUT under a row taller than its
 * `contain-intrinsic-size` moved the scroll height, and Chromium will not paint
 * backdrop-filtered descendants inside a skipped subtree — that was the "black
 * bands mid-list". The revert was right. What it threw away, though, is worth
 * having: not painting what nobody can see.
 *
 * So this does that job in JS, with none of those side effects:
 *
 *   · the row is ALWAYS in the DOM — measured, focusable, findable by
 *     find-in-page, and present for every test. Only its decorative spark line
 *     is withheld until the row has been near the viewport;
 *   · the observer is `rootMargin: 400px` — a row is drawn about a screen
 *     ahead of the scroll, so nothing pops in at the edge of the screen;
 *   · once drawn it STAYS drawn (`near` is never reset), so scrolling back up
 *     never re-renders a row;
 *   · no height is reserved and no layout is skipped, so the scrollbar
 *     geometry is exactly what it was: this cannot bring the jump back.
 *
 * ─── AND IT DEGRADES TO "DRAW EVERYTHING" ──────────────────────────────────
 * No IntersectionObserver (an old WebView, jsdom, an exotic browser) means the
 * row draws immediately — the pre-2026-11-01 behaviour, which is correct, just
 * heavier. A missing observer must never leave a row blank. `eager` is the
 * caller's decision for the first screenful, which only the list can know.
 */
export function useNearViewport({ eager = false, rootMargin = '400px' } = {}) {
  const ref = useRef(null);
  const [near, setNear] = useState(Boolean(eager));

  useEffect(() => {
    if (near) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setNear(true);
      return undefined;
    }
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, rootMargin]);

  return [ref, near];
}
