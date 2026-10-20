/**
 * ROVING-TABINDEX ARROW KEYS
 * ---------------------------------------------------------------------------
 * Shared by the Learn hub's main tab rail and by every sub-tab rail inside it,
 * so both behave identically for a keyboard or a switch device.
 *
 * Two things in here are deliberate and easy to undo by accident:
 *
 *  1. `event.currentTarget` is read BEFORE the animation frame. React nulls it
 *     once the handler returns, so reading it inside the rAF callback throws a
 *     TypeError on the very first arrow press — the bug this helper was
 *     written to kill.
 *  2. Direction follows the document direction. In RTL, ArrowRight walks
 *     backwards: it is the physical key on the LEFT of the pair that should
 *     move left, and `dir` is the only thing that knows which way the rail
 *     is laid out.
 */
export function onTabListKeyDown(event, items, activeId, onPick) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();

  const tablistId = event.currentTarget.dataset.tablistId;
  const idx = Math.max(0, items.findIndex((i) => i.id === activeId));
  const rtl = document.documentElement.dir === 'rtl';
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
  const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';

  let next = idx;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (forward) next = (idx + (rtl ? -1 : 1) + items.length) % items.length;
  else if (backward) next = (idx + (rtl ? 1 : -1) + items.length) % items.length;

  const item = items[next];
  if (!item) return;
  onPick(item);
  requestAnimationFrame(() => document.getElementById(`${tablistId}-${item.id}`)?.focus());
}
