/**
 * PERCENT FIELDS — one source of truth for a number that a slider and a text
 * field both edit.
 * ───────────────────────────────────────────────────────────────────────────
 * ─── THE PROBLEM THIS FILE EXISTS FOR ──────────────────────────────────────
 * A slider bound to `value` and a number field bound to the same `value` looks
 * like two views of one thing until somebody types in the field. Then the
 * usual implementations diverge in three different ways at once:
 *
 *   1. The field is parsed with `Number(e.target.value) || 0`, so clearing it
 *      to type "40" instantly commits 0, the thumb jumps to the far end, and
 *      the digit the user was about to type lands after a zero. Half-typed
 *      text gets committed as data.
 *   2. The field shows the RAW state while the slider clamps it. Type 140 in
 *      a 10–100 field and the pill reads 140 while the thumb sits at 100 — the
 *      displayed value and the actual value disagree, which is exactly the bug
 *      a reader cannot diagnose ("it says 140% but the bar is full").
 *   3. A `step` like 0.5 with an arrow key produces 12.000000000000002, and
 *      every later comparison against the step fails.
 *
 * ─── THE SHAPE ─────────────────────────────────────────────────────────────
 * Pure functions only — no React, no DOM, no i18n. `Shared.jsx` owns the
 * widget, this file owns the arithmetic, and a test can therefore pin the
 * arithmetic without mounting anything.
 *
 * The contract every helper here keeps:
 *   · the returned number is always inside [min, max], always on the `step`
 *     grid, and always rounded to the step's own precision;
 *   · an entry that is NOT yet a number ("", "-", "٫", "1.") is reported as
 *     "still typing" rather than silently coerced to 0 or NaN;
 *   · out-of-range input is clamped AND written back into the field, so the
 *     number on screen is always the number the control actually holds.
 */

/**
 * Decimal places implied by a step, so `12.000000000000002` can be written as
 * `12` and `0.5` stays `0.5`. A step of 1 means we also round the product,
 * which is what removes the float noise from repeated ±step presses.
 */
export function stepDecimals(step) {
  const s = String(step ?? 1);
  if (s.includes('e-')) {
    const exp = Number(s.split('e-')[1]);
    return Number.isFinite(exp) ? Math.min(6, exp) : 0;
  }
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : Math.min(6, s.length - dot - 1);
}

/** Round to the grid described by (min, step), then to the step's precision. */
export function snapToStep(value, { min = 0, step = 1 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number(min) || 0;
  const st = Number(step) > 0 ? Number(step) : 1;
  const base = Number(min) || 0;
  const k = Math.round((n - base) / st);
  /* `toFixed` is the cheapest way to step off the binary-float dust; the
     Number() around it puts the value back into arithmetic. */
  return Number((base + k * st).toFixed(stepDecimals(st)));
}

/**
 * Full normalisation: clamp into range, then snap to the grid.
 * Order matters — snapping first can push a value that was inside the range to
 * the outside by up to half a step.
 */
export function clampToRange(value, { min = 0, max = 100, step = 1 } = {}) {
  const a = Number(min);
  const b = Number(max);
  const lo = Math.min(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 100);
  const hi = Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 100);
  const n = Number(value);
  if (!Number.isFinite(n)) return snapToStep(lo, { min: lo, step });
  const clamped = Math.max(lo, Math.min(hi, n));
  return Math.max(lo, Math.min(hi, snapToStep(clamped, { min: lo, step })));
}

/* Characters a phone keyboard (or a Persian keyboard) can produce that mean
   "this is a decimal separator". `٫` is the Arabic decimal separator, which is
   what a Persian numeric keypad sends — parsing only `.` reads «۴۰٫۵» as 40. */
const DECIMAL_SEPARATORS = /[٫،,]/g;

/**
 * Normalise typed text into something `Number()` understands, WITHOUT deciding
 * whether the result is valid yet.
 *
 * Eastern Arabic-Indic digits (۰-۹ and ٠-٩) are folded to ASCII: a Persian user
 * on a Persian keyboard produces those, and `Number('۴۰')` is NaN. This is a
 * translation of the glyph, not of the value.
 */
export function normaliseNumericText(input) {
  if (input == null) return '';
  return String(input)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(DECIMAL_SEPARATORS, '.')
    .replace(/[^0-9.eE+-]/g, '')
    .trim();
}

/**
 * Parse a typed percent. Returns `null` when the text is not a number YET
 * (empty field, a lone minus sign, a trailing decimal point).
 *
 * `null` is the important part: it lets the widget keep the field's text as the
 * user typed it and simply not commit anything, instead of writing 0 into the
 * slider and yanking the thumb away mid-word.
 */
export function parsePercentText(input) {
  const raw = normaliseNumericText(input);
  if (!raw || raw === '-' || raw === '+' || raw === '.' || raw === '-.' || raw === '+.') return null;
  const n = Number(raw);
  /* `Number('1.')` is 1 and `Number('')` is 0 — both would commit a value the
     user has not finished expressing. Everything else that is not a finite
     number here is a genuine "not a number" and also reports null. */
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Direction of travel for one arrow key on the percent box.
 *
 * ARROW KEYS FOLLOW THE THUMB, NOT THE NUMBER LINE. In an RTL document the
 * native range input paints `min` on the right, so ArrowRight moves the thumb
 * toward the right edge — i.e. toward `min`. A text box that stepped UP on
 * ArrowRight would then disagree with the slider sitting directly under it,
 * and the reader would see the number grow while the handle walks the other
 * way. `rtl` inverts both horizontal arrows to match; up/down never invert,
 * because "up is more" is not a reading direction.
 *
 * Returns +1 (more), -1 (less) or 0 (not a stepping key).
 */
export function stepDirection(key, rtl = false) {
  if (key === 'ArrowUp') return 1;
  if (key === 'ArrowDown') return -1;
  if (key === 'ArrowRight') return rtl ? -1 : 1;
  if (key === 'ArrowLeft') return rtl ? 1 : -1;
  return 0;
}

/** True while `text` is a prefix of a number rather than a finished one. */
export function isIncompleteNumber(input) {
  const raw = normaliseNumericText(input);
  if (!raw) return true;
  return /[.eE+-]$/.test(raw) || raw === '-' || raw === '+';
}

/**
 * THE VISUAL MAPPING, MIRRORED.
 *
 * `<input type=range>` in an RTL document lays its track out right-to-left, so
 * `min` sits at the RIGHT edge. The slider CSS paints the "filled" part from a
 * fixed edge, which does NOT mirror with it — so on an RTL page a value of 20%
 * painted from the left looked like 80%.
 *
 * Two ways to fix it: mirror the paint, or mirror the control. Mirroring the
 * paint is a two-line change and leaves the native pointer/keyboard mapping
 * untouched — ArrowRight still moves the thumb right, which is the direction
 * the reader's thumb physically travels.
 *
 * Returns how much of the track is filled, 0–100.
 */
export function sliderPaintPercent(value, min = 0, max = 100) {
  const a = Number(min);
  const b = Number(max);
  const lo = Math.min(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 100);
  const hi = Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 100);
  if (hi <= lo) return 0;
  const v = Math.max(lo, Math.min(hi, Number(value) || 0));
  return ((v - lo) / (hi - lo)) * 100;
}

/**
 * One keystroke of the percent field, as a state transition.
 *
 * `draft` is what the box shows while the reader is typing; `value` is the
 * committed number the slider and the rest of the screen read.
 *
 * · Still typing ("", "-", "12.") → draft kept, value unchanged, committed:false.
 * · A finished number inside the range → committed, draft kept verbatim, so the
 *   caret never jumps while you are still adding digits.
 * · A finished number outside the range → committed CLAMPED and the draft
 *   rewritten to that exact number. Rewriting is the point: leaving "140" on
 *   screen while the control holds 100 is the mismatch this fixes.
 */
export function applyPercentInput(draftText, current, range = {}) {
  const typed = String(draftText ?? '');
  const parsed = parsePercentText(typed);
  const min = Number(range.min ?? 0);
  const max = Number(range.max ?? 100);

  if (parsed == null) {
    return { draft: typed, value: current, committed: false, clamped: false };
  }

  const next = clampToRange(parsed, range);
  const outOfRange = parsed < Math.min(min, max) || parsed > Math.max(min, max);
  return {
    draft: outOfRange ? String(next) : typed,
    value: next,
    committed: true,
    clamped: outOfRange
  };
}

/**
 * Format a committed value for the display pill.
 *
 * Digits stay European (`dir="ltr"` on the pill) even in Persian: the app's
 * numeric read-outs are tabular Latin numerals throughout, and mixing ۴۰٪ into
 * a row of `40%` values is the kind of inconsistency that reads as a bug. The
 * NUMBER the user typed accepts Persian digits; the number it echoes back uses
 * one format everywhere.
 */
export function formatPercent(value, step = 1, suffix = '%') {
  const n = snapToStep(Number(value) || 0, { min: 0, step });
  return `${n.toFixed(stepDecimals(step))}${suffix}`;
}
