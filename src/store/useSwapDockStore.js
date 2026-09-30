/**
 * THE TRADING DOCK — "this screen owns the bottom edge right now".
 * ---------------------------------------------------------------------------
 * Asked for, on the coin page: «ببین بنظرت بهتر نیست در صفحه هر توکن میایی
 * منو پایین صفحه محو و دکمه زیبا و ندرن سواپ ظاهر شود و دکمه داخل صففحه بیاد
 * پایین صفحه مثل یونی سواپ» — the bottom menu fades out and a modern swap
 * button takes its place, the way Uniswap's web app does.
 *
 * WHY A STORE AND NOT A PROP
 * The thing being hidden is not this page's child. `BottomNav` is rendered by
 * `AppChrome`, one level above every route, and it must decide from ROUTE and
 * SCROLL state whether it is still the most useful thing on the bottom edge.
 * Drilling a boolean through `App` → `AppChrome` → `AnimatedRoutes` → every
 * page would put trading-screen knowledge into the shell, and would make
 * every future page with a dock repeat the same plumbing.
 *
 * So the page publishes a fact about the SCREEN, and the shell renders it.
 * One store, two subscribers, and neither knows the other's name.
 *
 * `count` rather than a boolean: two docks on one screen (not possible today,
 * but cheap to be correct about) must not let the first one to unmount hide a
 * bar the other still owns.
 */
import { create } from 'zustand';

export const useSwapDockStore = create((set, get) => ({
  active: false,
  /** How many mounted docks want the edge. */
  count: 0,

  /** Show the dock (scrolled far enough, on a screen that has one). */
  acquire: () => set((s) => ({ count: s.count + 1, active: true })),

  /**
   * Release it. BUG THIS GUARDS: the release is the common case — the user
   * scrolled back up, or navigated away — and a plain `active: false` there
   * would blank the bar the instant the dock's own threshold effect re-ran.
   */
  release: () => {
    const next = Math.max(0, get().count - 1);
    set({ count: next, active: next > 0 });
  },

  /** For tests and hard resets (a route change that unmounts nothing). */
  reset: () => set({ count: 0, active: false })
}));
