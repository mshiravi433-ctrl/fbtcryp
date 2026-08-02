import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Subscribe a screen to the "hide balances" switch.
 *
 * The masking itself happens inside `fmtUsd` / `fmtCompact` / `fmtQty`, which
 * read a module-level flag. That flag changes what those functions return, but
 * it cannot make React re-render — and Wallet, Header and Market never
 * subscribed to the settings store, so the numbers on screen would have stayed
 * exactly as they were until the user navigated away and back.
 *
 * Calling this hook creates that subscription. The return value is usually
 * ignored; the point is the re-render.
 *
 * This lives in its own module rather than in lib/format.js because format.js
 * is imported by non-React code (the order engine, the server-side helpers)
 * and must not pull React or zustand in with it.
 */
export function useHideBalances() {
  return useSettingsStore((s) => s.hideBalances);
}

export default useHideBalances;
