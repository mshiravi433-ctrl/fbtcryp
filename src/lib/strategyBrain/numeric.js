/**
 * FBT STRATEGY BRAIN — NUMBER HANDLING.
 * ---------------------------------------------------------------------------
 * One rule, and it is the rule that decides whether a plan is honest:
 *
 *   `null` / `undefined` / `''` are NOT zero. They are "not read".
 *
 * `Number(null) === 0`, so the obvious `Number.isFinite(Number(v))` guard
 * silently turns every unread field into a real 0 — a drawdown estimate of 0%,
 * an APY of 0%, a capital of $0. The first version of this module shipped that
 * guard and every sleeve came back with `drawdownPct: 0`, which made a levered
 * momentum plan look as safe as a stablecoin carry. A number that was never
 * read must stay absent so the caller can report the gap.
 */

/** Coerce to a finite number, or null when the value is absent/unreadable. */
export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Round to two decimals, preserving absence. */
export const r2 = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n * 100) / 100;
};

/** Round to an integer, preserving absence. */
export const r0 = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

export const clamp = (v, lo, hi) => {
  const n = num(v);
  return n === null ? null : Math.max(lo, Math.min(hi, n));
};
