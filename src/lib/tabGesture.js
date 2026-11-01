/**
 * HORIZONTAL DRAGS BELONG TO THE TAB STRIP OF THE PAGE YOU ARE ON.
 * ---------------------------------------------------------------------------
 * Requested (2026-11-01, second round):
 *
 *   «با لمسی که سمت چپی یا راست می‌کشیم می‌ره صفحه بعد یا قبل — این اشتباهه،
 *    باید وقتی می‌کشی سمت راست یا چپ بره تب قبل یا بعد، نه صفحه بعد یا قبل.
 *    اگر تب نداشته باشه با لمس چپ یا راست نره صفحه بعد یا قبل؛ تغییر نکنه.
 *    فقط صفحه‌ای که تب داره عملکرد داشته باشه، مهم است.»
 *
 * A drag must select the PREVIOUS or NEXT TAB of the screen the finger is
 * already on. It must never navigate. And a screen with no tab strip must have
 * no gesture at all — silence, not a different behaviour.
 *
 * ─── WHY THIS IS A PLAIN MODULE AND NOT A REACT HOOK ────────────────────────
 * The decision (is this a horizontal drag? which way is «next» here? is there
 * a tab strip that can take it?) is arithmetic over three numbers and a DOM
 * lookup. Keeping it out of the component is what lets a test pin every branch
 * — RTL and LTR, edge clamping, a vertical scroll, a multi-touch pinch, a
 * disabled tab, a strip that is a router `<NavLink>` rail — without mounting
 * the whole app or faking a scroll engine. The component below it only wires
 * events to these functions.
 *
 * ─── DIRECTION IS THE READING DIRECTION, NOT THE SCREEN SIDE ────────────────
 * In a Persian (RTL) document the NEXT tab sits physically to the LEFT, so a
 * finger moving +x (to the right) walks BACK towards the previous tab, exactly
 * like turning a page backwards in an RTL book. In LTR the mapping mirrors.
 * Everything below is expressed as «forward = towards the next tab», so the
 * callers never have to know which language is being read.
 */

/**
 * Containers that own their own horizontal drag and must never hand it to the
 * tab strip: form controls, links, anything already scrolling sideways, every
 * canvas/chart, and any surface that has explicitly opted out.
 *
 * `[role="tab"]` is in the list even though a tab strip is what we are trying
 * to reach: dragging ON the strip itself is how a reader tries to scroll the
 * strip on a narrow phone, and stealing that gesture to change the tab would
 * make the strip impossible to scroll. The strip is the DESTINATION of a drag,
 * never its source.
 */
export const SWIPE_IGNORE = [
  'input', 'textarea', 'select', 'button', 'a',
  '[contenteditable="true"]', '[data-tab-swipe-ignore]', '[role="dialog"]',
  '[role="tab"]', '[role="tablist"]', '[role="slider"]', '[data-horizontal-scroll]',
  'canvas', 'video', '.segmented', '.ticker', '.chart', '.candle-chart',
  '.perp-rail', '.news-mode-tabs', '.smx-dock', '.market-sectors-rail', '.mx-sector-rail'
].join(', ');

/** A drag shorter than this is a tap that wobbled: never a tab change. */
export const SWIPE_MIN_X = 56;
/** A drag must be mostly horizontal — this much flatter than 1:1. */
export const SWIPE_FLATNESS = 0.65;
/** …and must be a Flick, not a long press that drifted while reading. */
export const SWIPE_MAX_MS = 900;

const SCROLLABLE_X = /auto|scroll/;

/** Is this node actually painted (not `display:none`, `hidden`, `inert`)? */
export function isRendered(node, win = typeof window !== 'undefined' ? window : null) {
  if (!node || !win) return false;
  const getStyle = win.getComputedStyle;
  if (node.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
  for (let parent = node; parent; parent = parent.parentElement) {
    const style = getStyle ? getStyle.call(win, parent) : null;
    if (!style) continue;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/**
 * Walk from the touched node up to the gesture zone, refusing the drag if any
 * container in between scrolls horizontally: that container is the reader's
 * own rail and a flick across it is a scroll, not a tab change.
 */
export function isInsideHorizontalScroller(target, zone) {
  if (!target || !zone) return false;
  const getStyle = typeof window !== 'undefined' ? window.getComputedStyle : null;
  for (let node = target; node && node !== zone.parentElement; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 4) {
      const style = getStyle ? getStyle.call(window, node) : null;
      if (!style || SCROLLABLE_X.test(style.overflowX || '')) return true;
    }
    if (node === zone) break;
  }
  return false;
}

/**
 * Find the tab strip a drag should drive, or `null` when this screen has none.
 *
 * ─── WHY THE PANEL WINS OVER THE FIRST STRIP ON THE PAGE ────────────────────
 * A screen can hold a sub-strip inside the open panel (a card's own segmented
 * control) as well as its page-level strip. The drag was started inside one
 * panel, so THAT panel's strip is the one whose tabs the reader means; only
 * when the touch is outside every panel does the page's first strip answer.
 *
 * ─── WHY `[data-page-tabs]` ALONE IS NOT ENOUGH ────────────────────────────
 * A page can be a shell around other pages (Orders hosts several sheets); one
 * of those sheets can put a two-button switch inside a modal, and a drag that
 * lands there must not re-order the page. Such a switch is inside a
 * `[role="dialog"]`, which the ignore list already refuses.
 */
export function findTabStrip(zone, target) {
  if (!zone) return null;
  const lists = [...zone.querySelectorAll('[role="tablist"], [data-page-tabs]')]
    .filter((list) => list.getAttribute('aria-orientation') !== 'vertical' && isRendered(list));
  if (!lists.length) return null;

  const panel = target?.closest?.('[role="tabpanel"]') ?? null;
  if (panel) {
    const owned = lists.find((list) => [...list.querySelectorAll('[aria-controls]')]
      .some((tab) => tab.getAttribute('aria-controls') === panel.id));
    return owned ?? null;
  }
  /* A touch on a page whose panels are not ARIA tabpanels (a plain segmented
     control with aria-pressed buttons) is still that page's gesture: the first
     VISIBLE horizontal strip is its own. */
  return lists[0];
}

/** The tabs of one strip, in DOM (reading) order, minus the unpainted ones. */
export function tabsOf(list) {
  if (!list) return [];
  return [...list.querySelectorAll('[role="tab"], button[aria-pressed]')].filter((tab) => isRendered(tab));
}

/** Which tab of the strip is the one currently selected. -1 when none is. */
export function selectedIndex(tabs) {
  return tabs.findIndex((tab) =>
    tab.getAttribute('aria-selected') === 'true'
    || tab.getAttribute('aria-pressed') === 'true'
    || tab.getAttribute('aria-current') === 'page'
    || tab.classList?.contains('active')
  );
}

/** The document's reading direction, from the computed style or the root. */
export function isRtl(node, win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  try {
    if (node && win.getComputedStyle && win.getComputedStyle.call(win, node).direction === 'rtl') return true;
    return win.document?.documentElement?.dir === 'rtl';
  } catch {
    return false;
  }
}

/**
 * THE WHOLE DECISION — one function, so it can be tested as arithmetic.
 *
 * @param {{dx:number, dy:number, ms:number}} drag the finished gesture
 * @param {Array<Element>} tabs the strip's tabs, in reading order
 * @param {number} index which one is selected
 * @param {boolean} rtl the reading direction
 * @returns {Element|null} the tab to activate. NEVER a wrap-around: at either
 *   end the answer is `null` — a drag past the last tab must do nothing rather
 *   than jump back to the first, which reads as a navigation.
 */
export function resolveTabStep({ dx, dy, ms }, tabs, index, rtl) {
  if (!Array.isArray(tabs) || !tabs.length) return null;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < SWIPE_MIN_X) return null;
  if (Math.abs(dy) > Math.abs(dx) * SWIPE_FLATNESS) return null;
  if (ms > SWIPE_MAX_MS) return null;
  if (index < 0 || index >= tabs.length) return null;

  /* «forward» = the next tab in reading order. RTL: dragging right walks back. */
  const forward = rtl ? dx > 0 : dx < 0;
  const next = tabs[index + (forward ? 1 : -1)];
  if (!next) return null;
  if (next.disabled || next.getAttribute('aria-disabled') === 'true') return null;
  return next;
}

/**
 * Activate a tab the way a reader's finger would: a real click, so whatever
 * validation, URL write or focus management the control already owns runs
 * unchanged. Presence of a handler is what makes a router `<NavLink>` rail
 * still be a tab change and not a synthetic navigation of our own.
 */
export function activateTab(tab) {
  if (!tab) return false;
  tab.click?.();
  return true;
}

/**
 * ONE GESTURE, START TO FINISH — the pure entry point the component uses.
 *
 * Returns `{ tab, index }` when a tab was (or would be) activated, `null` when
 * the screen has no tabs, the drag was a scroll, or the strip is at its end.
 */
export function runTabGesture({
  zone, target, routeKey, gestureRoute, start, end, ms,
  win = typeof window !== 'undefined' ? window : null,
  perform = true
} = {}) {
  if (!zone || !target) return null;
  /* A drag that began on another route is not a gesture on this one: the
     touchend arrives after the router has already swapped the screen, and
     answering it would change a tab the reader never touched. */
  if (routeKey != null && gestureRoute != null && routeKey !== gestureRoute) return null;
  if (!zone.isConnected) return null;
  if (target.closest?.(SWIPE_IGNORE)) return null;
  if (isInsideHorizontalScroller(target, zone)) return null;

  const list = findTabStrip(zone, target);
  const tabs = tabsOf(list);
  const index = selectedIndex(tabs);
  const next = resolveTabStep(
    { dx: (end?.x ?? 0) - (start?.x ?? 0), dy: (end?.y ?? 0) - (start?.y ?? 0), ms },
    tabs, index, isRtl(list, win)
  );
  if (!next) return null;
  if (perform) activateTab(next);
  return { tab: next, index: tabs.indexOf(next) };
}
