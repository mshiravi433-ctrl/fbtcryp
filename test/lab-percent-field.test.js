/**
 * THE PERCENT FIELD'S ARITHMETIC — `src/lib/lab/percent.js`
 * ═══════════════════════════════════════════════════════════════════════════
 * A slider and a text box editing the same number is the kind of widget that
 * looks fine in a screenshot and is wrong in three ways the moment a real
 * person types into it. Every assertion below corresponds to one of those ways,
 * so a future "simplification" of the helpers fails here instead of in a
 * user's portfolio:
 *
 *   1. `Number(x) || 0` commits 0 while the field is mid-edit — the thumb
 *      jumps to the far end and the digit you were typing lands after a zero.
 *   2. An unclamped box shows 140 while the slider sits at 100 — the displayed
 *      number and the real one disagree, and the reader cannot tell which.
 *   3. Repeated ±step presses on a 0.5 grid produce 12.000000000000002, which
 *      then fails every later "is this on a step?" comparison.
 *
 * The file is plain JS with no DOM and no i18n, so this suite runs in the node
 * environment and takes milliseconds.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPercentInput,
  clampToRange,
  formatPercent,
  isIncompleteNumber,
  normaliseNumericText,
  parsePercentText,
  sliderPaintPercent,
  snapToStep,
  stepDecimals,
  stepDirection
} from '../src/lib/lab/percent.js';

describe('stepDecimals', () => {
  it('reads the precision off the step, not off the value', () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.25)).toBe(2);
    expect(stepDecimals('0.001')).toBe(3);
  });

  it('handles an exponent-form step instead of reading its digits as decimals', () => {
    /* `String(0.0000001)` is "1e-7": the naive `.split('.')` returns 0 and the
       rounding below would then keep seven decimals of float dust. */
    expect(stepDecimals(1e-7)).toBe(6);
  });
});

describe('snapToStep', () => {
  it('lands exactly on the grid', () => {
    expect(snapToStep(12.3, { min: 0, step: 1 })).toBe(12);
    expect(snapToStep(12.3, { min: 0, step: 0.5 })).toBe(12.5);
    expect(snapToStep(12, { min: 0, step: 2 })).toBe(12);
    expect(snapToStep(13, { min: 0, step: 2 })).toBe(14);
  });

  it('snaps relative to `min`, so a grid that does not start at zero still works', () => {
    expect(snapToStep(13, { min: 10, step: 5 })).toBe(15);
    expect(snapToStep(11, { min: 10, step: 5 })).toBe(10);
  });

  it('returns clean decimals instead of binary float dust', () => {
    /* The reported failure: ten presses of +0.5 from 7 yields
       12.000000000000002, and every subsequent comparison against the step
       grid then treats the value as "not on a step". */
    let v = 7;
    for (let i = 0; i < 10; i++) v = snapToStep(v + 0.5, { min: 0, step: 0.5 });
    expect(v).toBe(12);
    expect(String(v)).toBe('12');
  });

  it('is a no-op for a non-finite input rather than returning NaN', () => {
    expect(snapToStep(NaN, { min: 0, step: 1 })).toBe(0);
    expect(snapToStep(undefined, { min: 10, step: 1 })).toBe(10);
    expect(snapToStep('abc', { min: 5, step: 1 })).toBe(5);
  });
});

describe('clampToRange', () => {
  it('clamps to both ends', () => {
    expect(clampToRange(140, { min: 0, max: 100 })).toBe(100);
    expect(clampToRange(-5, { min: 0, max: 100 })).toBe(0);
    expect(clampToRange(40, { min: 0, max: 100 })).toBe(40);
  });

  it('clamps BEFORE snapping, so a value inside the range cannot be pushed out', () => {
    /* 99 with step 10 would snap to 100 (fine) and 96 to 100; but snapping a
       value of 4 with min 5, step 10 first would give 0, which is outside the
       range. Clamping first keeps the result representable by the control. */
    expect(clampToRange(99, { min: 5, max: 100, step: 10 })).toBe(95);
    expect(clampToRange(4, { min: 5, max: 100, step: 10 })).toBe(5);
  });

  it('survives a reversed range (max < min) by normalising it', () => {
    expect(clampToRange(50, { min: 100, max: 0 })).toBe(50);
    expect(clampToRange(150, { min: 100, max: 0 })).toBe(100);
  });
});

describe('normaliseNumericText + parsePercentText', () => {
  it('reads Persian and Arabic-Indic digits as the number they are', () => {
    /* A Persian keyboard emits ۰-۹. `Number('۴۰')` is NaN, so without this
       fold a Persian user cannot type a percent at all. */
    expect(parsePercentText('۴۰')).toBe(40);
    expect(parsePercentText('٠٤٠')).toBe(40);
    expect(parsePercentText('۱۲۳')).toBe(123);
  });

  it('accepts the Arabic decimal separator and the Persian thousands comma', () => {
    expect(parsePercentText('۴۰٫۵')).toBe(40.5);
    expect(parsePercentText('40٫5')).toBe(40.5);
    expect(parsePercentText('40,5')).toBe(40.5);
  });

  it('strips characters a phone keyboard drifts into', () => {
    expect(normaliseNumericText(' 4 0 % ')).toBe('40');
    expect(parsePercentText('40%')).toBe(40);
  });

  it('reports "still typing" as null instead of committing 0', () => {
    /* This is the whole point of the null: clearing the box to retype must not
       push 0 through the allocation totals. */
    for (const typing of ['', ' ', '-', '+', '.', '-.', 'abc', '٪']) {
      expect(parsePercentText(typing), `"${typing}" is not a number yet`).toBeNull();
    }
  });

  it('a trailing separator is still typing, not a finished number', () => {
    expect(isIncompleteNumber('12.')).toBe(true);
    expect(isIncompleteNumber('12')).toBe(false);
    expect(isIncompleteNumber('12.5')).toBe(false);
    expect(parsePercentText('12.')).toBe(12);
  });
});

describe('stepDirection — RTL follows the thumb', () => {
  it('ArrowRight/Left follow reading direction', () => {
    /* In an RTL document the native range paints `min` on the right, so
       ArrowRight walks toward min. A box that stepped UP on ArrowRight would
       visibly disagree with the slider under it. */
    expect(stepDirection('ArrowRight', false)).toBe(1);
    expect(stepDirection('ArrowLeft', false)).toBe(-1);
    expect(stepDirection('ArrowRight', true)).toBe(-1);
    expect(stepDirection('ArrowLeft', true)).toBe(1);
  });

  it('ArrowUp/Down never invert — "up is more" is not a reading direction', () => {
    expect(stepDirection('ArrowUp', false)).toBe(1);
    expect(stepDirection('ArrowUp', true)).toBe(1);
    expect(stepDirection('ArrowDown', true)).toBe(-1);
  });

  it('ignores every other key', () => {
    expect(stepDirection('Tab')).toBe(0);
    expect(stepDirection('Enter')).toBe(0);
    expect(stepDirection('a')).toBe(0);
  });
});

describe('sliderPaintPercent', () => {
  it('maps the value onto the 0–100 track', () => {
    expect(sliderPaintPercent(25, 0, 100)).toBe(25);
    expect(sliderPaintPercent(0, 0, 100)).toBe(0);
    expect(sliderPaintPercent(100, 0, 100)).toBe(100);
  });

  it('maps a non-zero-based range correctly', () => {
    expect(sliderPaintPercent(15, 10, 20)).toBe(50);
    expect(sliderPaintPercent(10, 10, 20)).toBe(0);
  });

  it('never divides by zero and never returns NaN', () => {
    expect(sliderPaintPercent(5, 100, 100)).toBe(0);
    expect(sliderPaintPercent(NaN, 0, 100)).toBe(0);
  });
});

describe('applyPercentInput — the state machine', () => {
  const range = { min: 0, max: 100, step: 1 };

  it('keeps half-typed text without committing anything', () => {
    const r = applyPercentInput('', 30, range);
    expect(r.committed).toBe(false);
    expect(r.value).toBe(30);
    expect(r.draft).toBe('');
  });

  it('commits a finished number and keeps the keystrokes verbatim', () => {
    const r = applyPercentInput('45', 30, range);
    expect(r.committed).toBe(true);
    expect(r.value).toBe(45);
    /* The draft is NOT normalised mid-edit: rewriting "45" as "45" is harmless,
       but rewriting "045" or "45٫" would move the caret under the finger. */
    expect(r.draft).toBe('45');
  });

  it('clamps an out-of-range entry AND writes the clamp back into the box', () => {
    const r = applyPercentInput('140', 30, range);
    expect(r.value).toBe(100);
    expect(r.clamped).toBe(true);
    /* This is the assertion that kills the "box says 140, thumb says 100"
       mismatch: the box is rewritten to the number the control holds. */
    expect(r.draft).toBe('100');
  });

  it('clamps a negative entry to the floor', () => {
    const r = applyPercentInput('-20', 30, range);
    expect(r.value).toBe(0);
    expect(r.clamped).toBe(true);
    expect(r.draft).toBe('0');
  });

  it('snaps a typed value that is off the step grid', () => {
    const r = applyPercentInput('42.7', 30, { min: 0, max: 100, step: 1 });
    expect(r.value).toBe(43);
  });

  it('accepts a Persian-typed number end to end', () => {
    const r = applyPercentInput('۴۲', 30, range);
    expect(r.value).toBe(42);
    expect(r.committed).toBe(true);
  });

  it('never returns NaN for any of the inputs a keyboard can produce', () => {
    const inputs = ['', ' ', '.', '-', '+', 'abc', '1.2.3', '۰', '٫', '999999999999999999999'];
    for (const text of inputs) {
      const r = applyPercentInput(text, 30, range);
      expect(Number.isFinite(r.value), `"${text}" produced ${r.value}`).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThanOrEqual(100);
    }
  });
});

describe('formatPercent', () => {
  it('formats on the step grid', () => {
    expect(formatPercent(40, 1)).toBe('40%');
    expect(formatPercent(12.5, 0.5)).toBe('12.5%');
    expect(formatPercent(12.34, 1)).toBe('12%');
  });

  it('does not print a trailing .0 on an integer step', () => {
    expect(formatPercent(7, 1)).toBe('7%');
  });

  it('accepts a different suffix for a non-percent caller', () => {
    expect(formatPercent(40, 1, '')).toBe('40');
  });
});
