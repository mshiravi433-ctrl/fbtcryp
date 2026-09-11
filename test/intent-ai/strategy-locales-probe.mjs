/**
 * FBT STRATEGY BRAIN — LOCALES PROBE.
 * ---------------------------------------------------------------------------
 * Proves the presentation half (strategyLocales.js) translates a built
 * strategy for a Persian reader WITHOUT touching the math:
 *
 *   A. fa translates titles/ideas/honesty/stages/monitors/limitations
 *   B. numbers, ids, routes and handoffs pass through byte-identical
 *   C. en (or unknown) returns the strategy untouched
 *   D. refusals pass through (the card owns their copies)
 *   E. the input is never mutated
 *
 * Pure: no network, no store. Run: node test/intent-ai/strategy-locales-probe.mjs
 */

import { localizeStrategy } from '../../src/lib/strategyBrain/strategyLocales.js';

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);

const fake = () => ({
  ok: true,
  schema: 'fbt.portfolio-strategy.v1',
  strategyId: 'strat_test',
  chosen: 'balanced_growth',
  confidence: 0.72,
  goal: { capitalUsd: 1000, targetPct: 20, horizonDays: 180, riskProfile: 'balanced', capitalSource: 'stated' },
  verdict: { reachable: false, requiredApyPct: 46.4, sourcedReturnPct: 8.2, priceGapPct: 11.8, rangePct: 22.5, expectedReturnPct: 9.1, expectedValueUsd: 1091 },
  marketView: { regime: 'risk_on', bias: 'up', conviction: 0.6, readDomains: ['markets'] },
  comparison: [
    { id: 'balanced_growth', title: 'Balanced growth', idea: 'English idea', role: 'default', expectedReturnPct: 9.1, riskPct: 12.4, costPct: 0.3, confidence: 0.72, correlationPenalty: 0, riskBandBreach: false, priceExposurePct: 40, rangePct: 22.5 },
    { id: 'stable_carry', title: 'Stable carry', idea: 'English idea 2', role: 'alt', expectedReturnPct: 4.2, riskPct: 2.1, costPct: 0.2, confidence: 0.9, correlationPenalty: 0, riskBandBreach: false, priceExposurePct: 0, rangePct: 1.2 }
  ],
  ranking: [
    { id: 'balanced_growth', verdict: 'CHOSEN', reason: 'top score' },
    { id: 'stable_carry', verdict: 'REJECTED', reason: 'lower return' }
  ],
  alternatives: { stretch: 'momentum' },
  sleeves: [{ id: 's1', family: 'lending', title: 'Aave USDC', weightPct: 60, amountUsd: 600, returnPctAnnual: 8.2, basis: 'apy', handoff: { route: '/loan' } }],
  stages: [
    { id: 'preflight', title: 'Preflight', objective: 'Verify capital.', movesFunds: false, rollback: 'Nothing to roll back.' },
    { id: 'deploy-yield', title: 'Deploy the yield core', objective: 'Deploy 60% of capital into sourced yield.', movesFunds: true, rollback: 'Withdraw.', actions: [{ route: '/loan' }] },
    { id: 'monitor', title: 'Monitor', objective: 'Track realised return.', movesFunds: false }
  ],
  monitors: [
    { id: 'drawdown-budget', condition: 'Portfolio drawdown exceeds 10%', action: 'Suggest de-risking', severity: 'high' },
    { id: 'rate-decay', condition: 'A sleeve APY fell 30%', action: 'Suggest rotation', severity: 'medium' }
  ],
  risk: { band: 'balanced', drawdownBudgetPct: 10, estimatedDrawdownPct: 12.4, breaches: [{ code: 'DRAWDOWN_ABOVE_BUDGET', detail: 'estimated 12.4% vs budget 10%' }] },
  cost: { totalPct: 0.3, complete: true },
  honesty: 'English honesty.',
  limitations: ['Expected returns come from live APYs.', 'Nothing here signs or broadcasts.']
});

/* ── A. fa translates ─────────────────────────────────────────────────── */
{
  const out = localizeStrategy(fake(), 'fa');
  t('locale stamped', out.locale === 'fa');
  t('blueprint title translated', out.comparison[0].title === 'رشد متعادل' && out.comparison[1].title === 'سود استیبل');
  t('no English idea survives', !out.comparison.some((c) => /English/.test(c.idea || '')));
  t('honesty rewritten in fa', /هدفت به/.test(out.honesty) && /46/.test(out.honesty) && !/English/.test(out.honesty));
  t('honesty keeps both numbers', out.honesty.includes('46.4') && out.honesty.includes('180'));
  t('ranking reasons in fa', out.ranking[0].verdict === 'CHOSEN' && /بالاترین امتیاز/.test(out.ranking[0].reason));
  t('rejection reason in fa', /بازده موردانتظار کمتر/.test(out.ranking[1].reason));
  t('risk profile label in fa', out.goal.riskProfileFa === 'متعادل');
  t('regime label in fa', out.marketView.regimeFa === 'ریسک‌پذیر');
  t('stage titles in fa', out.stages[0].title === 'پیش‌پرواز' && out.stages[1].title === 'استقرار هسته سود');
  t('stage objective rebuilt with the number', /60/.test(out.stages[1].objective) && !/Deploy/.test(out.stages[1].objective));
  t('monitor condition in fa', /افت پرتفوی/.test(out.monitors[0].condition) && /10/.test(out.monitors[0].condition));
  t('monitor action in fa', /کم‌ریسک کردن/.test(out.monitors[0].action));
  t('limitations in fa', out.limitations.every((l) => !/Expected returns come|Nothing here signs/.test(l)));
  t('breach detail in fa', /برآورد 12.4٪ در برابر بودجه 10٪/.test(out.risk.breaches[0].detail));
}
{
  // A reachable verdict gets the reachable honesty, not the gap one.
  const s = fake();
  s.verdict = { ...s.verdict, reachable: true, expectedReturnPct: 21.2 };
  const out = localizeStrategy(s, 'fa');
  t('reachable honesty differs', /برنامه است نه یک قول/.test(out.honesty) && /21.2/.test(out.honesty));
}

/* ── B. math passes through ───────────────────────────────────────────── */
{
  const before = fake();
  const out = localizeStrategy(before, 'fa');
  t('verdict numbers identical', JSON.stringify(out.verdict) === JSON.stringify(before.verdict));
  t('goal numbers identical', out.goal.capitalUsd === 1000 && out.goal.targetPct === 20 && out.goal.horizonDays === 180);
  t('comparison numbers identical', out.comparison[0].expectedReturnPct === 9.1 && out.comparison[0].riskPct === 12.4);
  t('sleeves untouched', JSON.stringify(out.sleeves) === JSON.stringify(before.sleeves));
  t('handoff routes untouched', out.stages[1].actions[0].route === '/loan' && out.sleeves[0].handoff.route === '/loan');
  t('ids untouched', out.strategyId === 'strat_test' && out.stages[1].id === 'deploy-yield');
}

/* ── C. en passthrough ────────────────────────────────────────────────── */
{
  const before = fake();
  t('en returns input untouched', localizeStrategy(before, 'en') === before);
  t('unknown locale returns input untouched', localizeStrategy(before, 'de') === before);
  t('null-safe', localizeStrategy(null, 'fa') === null);
}

/* ── D. refusals ──────────────────────────────────────────────────────── */
{
  const refusal = { ok: false, code: 'CAPITAL_REQUIRED', detail: 'no readable capital' };
  t('refusal passes through', localizeStrategy(refusal, 'fa') === refusal);
}

/* ── E. no mutation ───────────────────────────────────────────────────── */
{
  const before = fake();
  const snapshot = JSON.stringify(before);
  localizeStrategy(before, 'fa');
  t('input never mutated', JSON.stringify(before) === snapshot);
}

const strategyLocalesFailed = rows.filter(([, ok]) => !ok);
console.log(`\nstrategy-locales probe: ${rows.length - strategyLocalesFailed.length}/${rows.length} passed`);
if (strategyLocalesFailed.length) {
  console.error(strategyLocalesFailed.map(([name]) => `  ✗ ${name}`).join('\n'));
  process.exit(1);
}
console.log('OK: intent-ai/strategy-locales-probe');
export default rows;
