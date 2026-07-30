import { lockBodyScroll, releaseAllScrollLocks } from '../src/lib/scrollLock.js';
export async function run() {
  const o = () => document.body.style.overflow;
  const out = [];
  releaseAllScrollLocks();

  const a = lockBodyScroll();
  out.push(['single lock hides overflow', o() === 'hidden']);
  a();
  out.push(['single unlock restores it', o() !== 'hidden']);

  // The real bug: nested locks released OUT OF ORDER.
  const x = lockBodyScroll();
  const y = lockBodyScroll();
  out.push(['nested locks still locked', o() === 'hidden']);
  x();                                    // outer released FIRST
  out.push(['still locked while inner is open', o() === 'hidden']);
  y();
  out.push(['unlocks out of order still restore scroll', o() !== 'hidden']);

  // Idempotency (React StrictMode double-invokes cleanups).
  const z = lockBodyScroll();
  z(); z(); z();
  out.push(['double-calling an unlock is safe', o() !== 'hidden']);

  const p = lockBodyScroll();
  const q = lockBodyScroll();
  releaseAllScrollLocks();
  out.push(['releaseAll clears every lock', o() !== 'hidden']);
  p(); q();
  out.push(['stale unlocks after releaseAll are harmless', o() !== 'hidden']);
  return out;
}
