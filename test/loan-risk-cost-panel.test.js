/**
 * THE LOAN RISK PANEL — the numbers, and the strings that name them.
 * ---------------------------------------------------------------------------
 * Two reports, one file.
 *
 *   A. «این عملیات چه هزینه‌ای می‌تواند داشته باشد — اطلاعات ان ناقص است … هم
 *      ارور ریسک پس از این عملیات قابل پیش‌بینی نبود می‌دهد و اطلاعات LTV فعلی،
 *      حداکثر LTV، آستانه لیکوئید شدن، loan.healthFactorNow نداره و آخرین با
 *      استرینگ هست حتی با وجود زبان فارسی انگلیسی نشان می‌دهد»
 *
 *      The last of those is the one that made the screen look broken: the key
 *      `loan.healthFactorNow` did not exist in ANY locale file, so i18next
 *      returned the key itself and a Persian user read the literal string
 *      "loan.healthFactorNow" where a label belongs. Section 2 below is the
 *      general fix: every static `t()` key the panel can render must resolve to
 *      a real translation in all three complete locales.
 *
 *   B. The three missing measurements — the distance to liquidation as a PRICE
 *      move, the interest the loan accrues at the pool's own rate, and the
 *      split between "max LTV" (the reserve's parameter) and "current LTV"
 *      (this wallet's ratio). Section 1 pins the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  liquidationTouchPoints, projectInterestCost, actionCostBreakdown
} from '../src/lib/lending-service.js';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';
import ar from '../src/i18n/locales/ar.json';

const root = resolve(__dirname, '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const resolveKey = (bundle, path) => path
  .split('.')
  .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), bundle);

/* ═══════════════ 1. the arithmetic ═══════════════ */

describe('the distance to liquidation, as a price move', () => {
  it('a health factor of 2.00 means the collateral can halve', () => {
    const touch = liquidationTouchPoints({ healthFactor: 2 });
    expect(touch.ok).toBe(true);
    expect(touch.collateralDropPct).toBeCloseTo(50, 6);
    /* …and the debt asset can double before the same point. */
    expect(touch.debtRisePct).toBeCloseTo(100, 6);
  });

  it('a thin position is described as thin', () => {
    const touch = liquidationTouchPoints({ healthFactor: 1.1 });
    expect(touch.collateralDropPct).toBeCloseTo(9.09, 1);
    expect(touch.debtRisePct).toBeCloseTo(10, 6);
  });

  it('can be derived when only the pool figures are known', () => {
    /* C = $1,000, T = 50%, D = $250 → HF = 2 → a 50% collateral drop. */
    const touch = liquidationTouchPoints({
      totalCollateralUsd: 1000, totalDebtUsd: 250, liquidationThresholdPct: 50
    });
    expect(touch.ok).toBe(true);
    expect(touch.healthFactor).toBeCloseTo(2, 6);
    expect(touch.collateralDropPct).toBeCloseTo(50, 6);
  });

  it('says WHY it cannot answer, instead of printing zero', () => {
    expect(liquidationTouchPoints({ totalDebtUsd: 0 }).reason).toBe('NO_DEBT');
    expect(liquidationTouchPoints({}).ok).toBe(false);
    expect(liquidationTouchPoints({ healthFactor: null, totalCollateralUsd: 100, totalDebtUsd: 50 }).reason)
      .toBe('LIQUIDATION_DISTANCE_UNAVAILABLE');
  });
});

describe('what holding the loan costs, at today’s rate', () => {
  it('is linear on purpose — a variable rate cannot be compounded honestly', () => {
    const cost = projectInterestCost({ amountUsd: 1000, apyPct: 5, days: 365 });
    expect(cost.ok).toBe(true);
    expect(cost.horizonUsd).toBeCloseTo(50, 6);
    expect(cost.perDayUsd).toBeCloseTo(50 / 365, 8);
  });

  it('refuses to invent a number it does not have', () => {
    expect(projectInterestCost({ amountUsd: null, apyPct: 5 }).reason).toBe('AMOUNT_UNAVAILABLE');
    expect(projectInterestCost({ amountUsd: 100, apyPct: null }).reason).toBe('RATE_UNAVAILABLE');
  });
});

describe('the cost breakdown of one action', () => {
  const borrow = () => actionCostBreakdown({
    action: 'borrow',
    amountUsd: 1000,
    apyPct: 6,
    healthFactorAfter: 1.8,
    assessmentAfter: { ltvPct: 42.5 },
    horizonDays: 30
  });

  it('carries interest, the liquidation distance and the resulting LTV', () => {
    const out = borrow();
    const ids = out.rows.map((r) => r.id);
    expect(ids).toContain('interestPerDay');
    expect(ids).toContain('interestHorizon');
    expect(ids).toContain('priceFall');
    expect(ids).toContain('priceRise');
    expect(ids).toContain('ltvAfter');
    expect(out.ltvAfterPct).toBeCloseTo(42.5, 6);
    /* HF 1.8 → (1 − 1/1.8)·100 = 44.4% of collateral value. */
    expect(out.dropPct).toBeCloseTo(44.44, 1);
  });

  it('a repayment reports the interest it STOPS, not an interest charge', () => {
    const out = actionCostBreakdown({ action: 'repay', amountUsd: 500, apyPct: 6, healthFactorAfter: 2.5 });
    const ids = out.rows.map((r) => r.id);
    expect(ids).toContain('savedPerDay');
    expect(ids).toContain('savedHorizon');
    expect(ids).not.toContain('interestPerDay');
  });

  it('a withdrawal carries no interest row at all — it is not a time cost', () => {
    const out = actionCostBreakdown({ action: 'withdraw', amountUsd: 500, apyPct: 6, healthFactorAfter: 1.4 });
    const ids = out.rows.map((r) => r.id);
    expect(ids).not.toContain('interestPerDay');
    expect(ids).not.toContain('savedPerDay');
    expect(ids).toContain('priceFall');
  });

  it('withholds every row it cannot compute rather than printing a zero', () => {
    const out = actionCostBreakdown({ action: 'borrow' });
    expect(out.rows).toHaveLength(0);
    expect(out.interest).toBeNull();
  });
});

/* ═══════════════ 2. nothing renders as its own key ═══════════════ */

/**
 * Every STATIC `t('loan.…')` key inside a source region must resolve to a real
 * sentence in the three complete locales.
 *
 * Static means a literal string with no `${}` — a template key is resolved at
 * runtime from a value the engine produced, and those are covered by their own
 * tests (loan-errors-l10n.test.js walks the error codes).
 */
function staticKeys(region) {
  const keys = new Set();
  const pattern = /t\(\s*'((?:loan|common)\.[A-Za-z0-9_.]+)'/g;
  let match = pattern.exec(region);
  while (match) {
    keys.add(match[1]);
    match = pattern.exec(region);
  }
  return [...keys];
}

const regionOf = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end === -1 ? undefined : end);
};

describe('the loan screens never print a raw key', () => {
  const riskMeter = regionOf(read('src/pages/Loan.jsx'), 'function RiskMeter(', '/* ═══════════════════════════════════════════════════════════════════════════\n   §9/§28');
  const solanaPanel = read('src/components/SolanaLendingPanel.jsx');

  /*
   * Keys that are assembled from a value at runtime. Listed explicitly so this
   * test keeps checking the ones it CAN check instead of being skipped whole.
   */
  const DYNAMIC_PREFIXES = ['loan.riskLevel.', 'loan.status.', 'loan.error.', 'loan.machine.', 'loan.progress.', 'loan.sheetTitle.'];

  const check = (keys, label) => {
    for (const key of keys) {
      if (DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      for (const [name, bundle] of [['en', en], ['fa', fa], ['ar', ar]]) {
        const value = resolveKey(bundle, key);
        expect(typeof value === 'string' || typeof value === 'object',
          `${label}: ${key} is missing from ${name}.json — it would render as its own key`).toBe(true);
      }
    }
  };

  it('the risk panel’s labels all exist — including loan.healthFactorNow', () => {
    const keys = staticKeys(riskMeter);
    expect(keys.length).toBeGreaterThan(5);
    check(keys, 'RiskMeter');
    /* The exact key the report named. */
    expect(keys).toContain('loan.healthFactorNow');
    expect(en.loan.healthFactorNow).not.toBe('loan.healthFactorNow');
    expect(fa.loan.healthFactorNow).not.toMatch(/^loan\./);
  });

  it('every health band the meter can print has a name, in every complete locale', () => {
    /* The badge reads t(`loan.riskLevel.${band.level}`) — a value assembled at
       runtime, so the static scan above cannot see it. Missing one of these is
       exactly how «loan.healthFactorNow» reached a Persian screen. */
    for (const level of ['healthy', 'moderate', 'warning', 'critical', 'liquidatable', 'none']) {
      for (const [name, bundle] of [['en', en], ['fa', fa], ['ar', ar]]) {
        const value = resolveKey(bundle, `loan.riskLevel.${level}`);
        expect(typeof value, `loan.riskLevel.${level} missing from ${name}.json`).toBe('string');
      }
    }
  });

  it('the cost rows all exist in both the label and the value key space', () => {
    const costKeys = ['title', 'approx', 'perDay', 'overDays', 'rateIsVariable',
      'interestPerDay', 'interestHorizon', 'savedPerDay', 'savedHorizon',
      'earnPerDay', 'earnHorizon', 'priceFall', 'priceRise', 'ltvAfter'];
    for (const key of costKeys) {
      for (const [name, bundle] of [['en', en], ['fa', fa], ['ar', ar]]) {
        expect(typeof resolveKey(bundle, `loan.cost.${key}`), `loan.cost.${key} in ${name}`).toBe('string');
      }
    }
    /* Every id the engine can emit has a label. */
    const emitted = new Set();
    for (const action of ['borrow', 'repay', 'supply', 'withdraw']) {
      actionCostBreakdown({ action, amountUsd: 100, apyPct: 5, healthFactorAfter: 1.5, assessmentAfter: { ltvPct: 10 } })
        .rows.forEach((row) => emitted.add(row.id));
    }
    for (const id of emitted) {
      expect(typeof resolveKey(en, `loan.cost.${id}`), `engine emits ${id} but en.json has no label`).toBe('string');
      expect(costKeys).toContain(id);
    }
  });

  it('the Solana panel’s labels all exist, box by box', () => {
    const keys = staticKeys(solanaPanel);
    expect(keys.length).toBeGreaterThan(10);
    check(keys, 'SolanaLendingPanel');
  });

  it('every analysis fact the insights module can emit has a sentence', () => {
    const ids = [
      'utilization', 'rateSpread', 'depositCap', 'liquidityDepth', 'ltvBuffer',
      'positionHealth', 'liquidationBuffer', 'ltvUsed', 'borrowRoom', 'notAdvice'
    ];
    for (const id of ids) {
      for (const [name, bundle] of [['en', en], ['fa', fa], ['ar', ar]]) {
        expect(typeof resolveKey(bundle, `loan.solana.analysis.${id}`), `loan.solana.analysis.${id} in ${name}`).toBe('string');
      }
    }
  });
});
