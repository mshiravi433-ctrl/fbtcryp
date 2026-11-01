import { useRef } from 'react';

const IGNORE = 'input, textarea, select, button, a, [contenteditable="true"], [data-tab-swipe-ignore], [role="dialog"], canvas, video, [data-horizontal-scroll], .segmented, .ticker, .chart, .candle-chart';
const visible = (node) => {
  if (node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  for (let parent = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
};

/** Click the existing local tab so its validation/state remains authoritative.
 * No router navigation, wraparound, touchmove listener or scroll prevention. */
export default function PageTabSwipe({ routeKey, children }) {
  const start = useRef(null);
  const onTouchStart = (event) => {
    start.current = null;
    if (event.touches?.length !== 1 || event.target.closest(IGNORE)) return;
    let node = event.target;
    while (node && node !== event.currentTarget) {
      if (node.scrollWidth > node.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return;
      node = node.parentElement;
    }
    const panel = event.target.closest('[role="tabpanel"]');
    const lists = [...event.currentTarget.querySelectorAll('[role="tablist"], [data-page-tabs]')].filter((list) => visible(list) && list.getAttribute('aria-orientation') !== 'vertical');
    const list = (panel && lists.find((list) => [...list.querySelectorAll('[aria-controls]')].some((tab) => tab.getAttribute('aria-controls') === panel.id))) || lists[0];
    if (!list) return;
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY, at: Date.now(), list, routeKey };
  };
  const onTouchEnd = (event) => {
    const gesture = start.current;
    start.current = null;
    if (!gesture || gesture.routeKey !== routeKey || !gesture.list.isConnected || event.touches?.length || event.changedTouches?.length !== 1) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (Math.abs(dx) < 56 || Math.abs(dy) > Math.abs(dx) * .65 || Date.now() - gesture.at > 900) return;
    const tabs = [...gesture.list.querySelectorAll('[role="tab"], button[aria-pressed]')].filter(visible);
    const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('aria-pressed') === 'true' || tab.getAttribute('aria-current') === 'page');
    if (index < 0) return;
    const rtl = getComputedStyle(gesture.list).direction === 'rtl' || document.documentElement.dir === 'rtl';
    const next = tabs[index + ((rtl ? dx > 0 : dx < 0) ? 1 : -1)];
    if (next && !next.disabled && next.getAttribute('aria-disabled') !== 'true') next.click();
  };
  return <div className="app-tab-swipe-zone" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchMove={(event) => { if (event.touches?.length !== 1) start.current = null; }} onTouchCancel={() => { start.current = null; }}>{children}</div>;
}
