#!/usr/bin/env node
/**
 * FBT AI ORCHESTRATOR — AI JUDGE probe (Upgrade 14)
 * ────────────────────────────────────────────────────────────────────────────
 * The judge is the step that DECIDES. These assertions are its constitution:
 *
 *   · evidence outranks eloquence — a claim with a tool read behind it beats a
 *     more confident-sounding model with none;
 *   · AI consensus is not proof — two models agreeing with nothing read stays
 *     low-confidence and gets the UNSUPPORTED_NUMBERS / NO_EVIDENCE penalties;
 *   · tool-truth topics (a balance, a portfolio) ABSTAIN when no tool read
 *     backed them — never an invented number in a confident sentence;
 *   · disagreement is found (opposing stances, and numeric divergence for two
 *     different numbers on the same topic) and the losing side is preserved as
 *     dissent with its weight;
 *   · predictions are capped and labelled; dissent is not averaged away; and
 *     the whole thing is deterministic — same inputs, same verdict.
 *
 * Run: npm run test:upgrade14-judge
 */
import assert from 'node:assert/strict';
import {
  judge, measureAgreement, findNumericConflicts, extractClaims,
  renderJudgment, DECISIONS, JUDGE_SCHEMA
} from '../../src/lib/intent-ai/orchestrator/judge.js';
import { buildEvidencePlan } from '../../src/lib/intent-ai/orchestrator/evidencePlan.js';

const rows = [];
const t = (name, fn) => {
  try { fn(); rows.push([name, true, '']); } catch (error) { rows.push([name, false, String(error?.message || error).slice(0, 220)]); }
};

const marketPlan = () => buildEvidencePlan({ message: 'قیمت بیت‌کوین الان چنده؟', intentType: 'MARKET_ANALYSIS', locale: 'fa' });
const portfolioPlan = () => buildEvidencePlan({ message: 'کل دارایی‌هام چقدره؟', intentType: 'PORTFOLIO_ANALYSIS', locale: 'fa' });

const observedPrices = [{
  facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'observed',
  summary: { rows: [{ symbol: 'BTC', priceUsd: 63250.5, change24hPct: 1.8 }] }, provenance: { tool: 'fbt_get_market_snapshot' }
}];
/* The full gather a market turn would perform — the plan asks for regime and
   news too, so a complete read is what coverage is measured against. */
const observedFull = [
  ...observedPrices,
  {
    facetId: 'asset_regime', tool: 'fbt_get_signals', status: 'observed',
    summary: { asset: 'BTC', momentum: 'up', volatility: 'medium', change24hPct: 1.8 }, provenance: { tool: 'fbt_get_signals' }
  },
  {
    facetId: 'news_flow', tool: 'fbt_get_news', status: 'observed',
    summary: { items: [{ title: 'ETF inflows continue', source: 'fbt' }] }, provenance: { tool: 'fbt_get_news' }
  }
];

const seat = (provider, answer, { stance = 'neutral', confidence = 0.6, claims = null } = {}) => ({
  provider, model: `${provider}-test`, ok: true, answer, stance, confidence,
  claims: claims || extractClaims(answer)
});

const priceAnswer = 'قیمت لحظه‌ای BTC حدود ۶۳٬۲۵۰ دلار است و در ۲۴ ساعت گذشته ۱.۸٪ رشد داشته؛ این عدد از خوانش زندهٔ بازار می‌آید.';
const vagueAnswer = 'بازار ارز دیجیتال همیشه پرنوسان است و باید با احتیاط تصمیم بگیری، چون هیچ‌کس آینده را نمی‌داند.';

/* ── 1. evidence first ──────────────────────────────────────────────────── */

t('a tool-backed answer scores better than the same words with no read behind them', () => {
  const withRead = judge({ question: 'قیمت بیت‌کوین؟', plan: marketPlan(), analyses: [seat('openrouter', priceAnswer)], evidence: observedFull });
  const withoutRead = judge({ question: 'قیمت بیت‌کوین؟', plan: marketPlan(), analyses: [seat('openrouter', priceAnswer)], evidence: [] });
  assert.equal(withRead.decision, DECISIONS.ANSWER);
  assert.ok(withRead.confidence > withoutRead.confidence, `${withRead.confidence} should beat ${withoutRead.confidence}`);
  assert.ok(withoutRead.penalties.includes('NO_EVIDENCE'));
  assert.equal(withRead.evidence.coverage, 1, 'every planned facet was read');
  assert.ok(withRead.verdict.evidenceBacked.includes('market_prices:fbt_get_market_snapshot'));
});

t('agreement alone never becomes proof: two agreeing models with no read stay low', () => {
  const out = judge({
    question: 'قیمت بیت‌کوین؟', plan: marketPlan(),
    analyses: [seat('openrouter', priceAnswer), seat('groq', priceAnswer)],
    evidence: []
  });
  assert.ok(out.confidence <= 42, `consensus without evidence must stay capped, got ${out.confidence}`);
  assert.notEqual(out.decision, DECISIONS.ANSWER);
  assert.ok(out.limits.some((l) => l.code === 'MISSING_FACETS'));
  assert.equal(out.laws.aiConsensusIsNotProof, true);
});

/* ── 2. tool truth ──────────────────────────────────────────────────────── */

t('a portfolio question with no wallet read ABSTAINS instead of inventing a balance', () => {
  const out = judge({
    question: 'کل دارایی‌هام چقدره؟', plan: portfolioPlan(),
    analyses: [seat('openrouter', 'کل دارایی شما حدود ۱۲٬۴۰۰ دلار است که عمدتاً در ETH نگه داشته شده.', { stance: 'neutral' })],
    evidence: [{ facetId: 'portfolio_state', tool: 'fbt_get_portfolio', status: 'unavailable', error: 'CAPABILITY_UNAVAILABLE' }]
  });
  assert.equal(out.decision, DECISIONS.ABSTAIN);
  assert.ok(out.why.some((w) => w.startsWith('TOOL_TRUTH_REQUIRED')));
  assert.equal(out.laws.numbersFromToolsOnly, true);
});

t('…and ANSWERS once the portfolio was actually read', () => {
  const out = judge({
    question: 'کل دارایی‌هام چقدره؟', plan: portfolioPlan(),
    analyses: [seat('openrouter', 'بر اساس خوانش پرتفوی، ارزش دارایی شما ۱٬۲۰۰ دلار است و بزرگ‌ترین بخش آن ETH است.')],
    evidence: [{
      facetId: 'portfolio_state', tool: 'fbt_get_portfolio', status: 'observed',
      summary: { totalValueUsd: 1200, holdings: [{ symbol: 'ETH', valueUsd: 800 }] }
    }]
  });
  assert.equal(out.decision, DECISIONS.ANSWER);
  assert.ok(!out.why.some((w) => w.startsWith('TOOL_TRUTH_REQUIRED')));
});

/* ── 3. disagreement ────────────────────────────────────────────────────── */

t('opposing stances are a conflict, and the losing side is preserved as dissent', () => {
  const bull = seat('openrouter', 'روند BTC صعودی است و momentum خریداران قوی‌تر شده؛ در این بازه انتظار ادامهٔ رشد منطقی است.', { stance: 'bullish', confidence: 0.7 });
  const bear = seat('groq', 'روند BTC نزولی است و فشار فروش در ۲۴ ساعت گذشته بیشتر شده؛ در این بازه ادامهٔ ریزش منطقی است.', { stance: 'bearish', confidence: 0.6 });
  const out = judge({ question: 'وضعیت BTC؟', plan: marketPlan(), analyses: [bull, bear], evidence: observedPrices });
  assert.ok(out.conflicts.some((c) => c.kind === 'OPPOSING_STANCE'));
  assert.equal(out.agreement.stanceAgreement, 0.5);
  assert.equal(out.dissent.length, 1);
  assert.ok(out.dissent[0].weight > 0 && out.dissent[0].weight < 1);
  assert.ok(out.penalties.includes('STANCE_CONFLICT'));
  assert.ok(out.whatWouldChangeMyMind.some((w) => w.code === 'CONFLICT_RESOLVED'));
});

t('two different numbers on the same topic are flagged as numeric divergence', () => {
  const a = seat('openrouter', 'نرخ استیکینگ ETH در این پلتفرم حدود 3.4 درصد است و از خوانش بازده به‌دست آمده.', { claims: [{ text: 'نرخ استیکینگ ETH 3.4 درصد است', kind: 'number' }] });
  const b = seat('groq', 'نرخ استیکینگ ETH در این پلتفرم حدود 5.9 درصد است و از خوانش بازده به‌دست آمده.', { claims: [{ text: 'نرخ استیکینگ ETH 5.9 درصد است', kind: 'number' }] });
  const out = judge({ question: 'بازده استیکینگ ETH؟', plan: marketPlan(), analyses: [a, b], evidence: observedPrices });
  const spread = out.conflicts.find((c) => c.kind === 'NUMERIC_DIVERGENCE');
  assert.ok(spread, `expected numeric divergence, got ${JSON.stringify(out.conflicts)}`);
  assert.ok(out.penalties.includes('NUMERIC_DIVERGENCE'));
  assert.ok(findNumericConflicts([a, b]).length >= 1);
});

t('agreement is measured on two axes, not as a single vibe', () => {
  const same = measureAgreement([
    seat('openrouter', 'قیمت BTC در حال افزایش است و روند صعودی ادامه دارد.', { stance: 'bullish' }),
    seat('groq', 'قیمت BTC در حال افزایش است و روند صعودی ادامه دارد.', { stance: 'bullish' })
  ]);
  assert.equal(same.stanceAgreement, 1);
  assert.ok(same.wording > 0.5, `identical wording should be near 1, got ${same.wording}`);
  const different = measureAgreement([
    seat('openrouter', 'قیمت BTC در حال افزایش است و روند صعودی ادامه دارد.', { stance: 'bullish' }),
    seat('groq', 'داده‌های در دسترس کافی نیست و باید منتظر ماند.', { stance: 'neutral' })
  ]);
  assert.ok(different.agreement < same.agreement);
});

/* ── 4. honesty about the future ────────────────────────────────────────── */

t('a prediction caps confidence and is labelled, never sold as certainty', () => {
  const withPrediction = judge({
    question: 'BTC تا ماه آینده چقدر می‌شود؟', plan: marketPlan(),
    analyses: [seat('openrouter', 'پیش‌بینی می‌شود BTC تا ماه آینده به ۸۰٬۰۰۰ دلار خواهد رسید و روند صعودی است.')],
    evidence: observedPrices
  });
  assert.ok(withPrediction.confidence <= 62);
  assert.ok(withPrediction.penalties.includes('PREDICTION_PRESENT'));
  assert.ok(withPrediction.limits.some((l) => l.code === 'NO_PREDICTION'));
});

t('numbers with no tool read behind them carry no weight and are reported', () => {
  const out = judge({
    question: 'قیمت بیت‌کوین؟', plan: marketPlan(),
    analyses: [seat('openrouter', 'قیمت BTC الان ۷۹٬۰۰۰ دلار است و کارمزد سواپ ۰.۳٪ می‌باشد؛ این اعداد از حافظهٔ من می‌آید.')],
    evidence: [{ facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'unavailable', error: 'TIMEOUT' }]
  });
  assert.ok(out.penalties.includes('UNSUPPORTED_NUMBERS'));
  assert.ok(out.limits.some((l) => l.code === 'UNSUPPORTED_NUMBERS'));
});

/* ── 5. determinism, shape, rendering ───────────────────────────────────── */

t('the same analyses produce the same verdict (auditable, not stochastic)', () => {
  const args = { question: 'قیمت بیت‌کوین؟', plan: marketPlan(), analyses: [seat('openrouter', priceAnswer)], evidence: observedPrices };
  const a = judge({ ...args, now: () => 1 });
  const b = judge({ ...args, now: () => 2 });
  assert.deepEqual(
    { d: a.decision, c: a.confidence, w: a.why, p: a.penalties, v: a.verdict, dis: a.dissent },
    { d: b.decision, c: b.confidence, w: b.why, p: b.penalties, v: b.verdict, dis: b.dissent }
  );
  assert.equal(a.schema, JUDGE_SCHEMA);
  assert.equal(a.laws.executionAuthority, false);
});

t('an empty panel is an honest abstention with NO_ANALYSIS', () => {
  const out = judge({ question: 'قیمت BTC؟', plan: marketPlan(), analyses: [], evidence: observedPrices });
  assert.equal(out.decision, DECISIONS.ABSTAIN);
  assert.ok(out.why.includes('NO_ANALYSIS'));
  assert.ok(out.penalties.includes('NO_USABLE_ANALYSIS'));
});

t('a high-stakes turn with thin coverage refuses to sound sure', () => {
  const plan = buildEvidencePlan({ message: 'همه سرمایه‌ام را در ETH بگذارم یا نه؟', intentType: 'GENERAL', locale: 'fa' });
  assert.equal(plan.stakes.level, 'HIGH');
  const out = judge({
    question: 'همه سرمایه‌ام را در ETH بگذارم؟', plan,
    analyses: [seat('openrouter', 'بله، به‌نظر می‌رسد ورود کامل به ETH منطقی باشد چون روند کلی صعودی است.')],
    evidence: []
  });
  assert.ok(out.confidence <= 58);
  assert.ok(out.limits.some((l) => l.code === 'MISSING_FACETS'));
  assert.notEqual(out.decision, DECISIONS.ANSWER);
});

t('the rendered answer never turns an abstention into a confident sentence', () => {
  const abstain = judge({ question: 'کل دارایی‌هام؟', plan: portfolioPlan(), analyses: [], evidence: [] });
  const fa = renderJudgment(abstain, { locale: 'fa' });
  assert.ok(!/۱۲٬۴۰۰|12,400|\$\d/.test(fa), `an abstention must not contain an invented figure: ${fa}`);
  assert.ok(fa.includes('اطمینان'));
  const answered = judge({ question: 'قیمت بیت‌کوین؟', plan: marketPlan(), analyses: [seat('openrouter', priceAnswer)], evidence: observedPrices });
  const text = renderJudgment(answered, { locale: 'fa' });
  assert.ok(text.includes('۶۳٬۲۵۰') || text.includes('63,250'), 'an answered turn carries the read price');
  assert.ok(text.includes('market_prices:fbt_get_market_snapshot'));
});

let passed = 0;
console.log('\n=== FBT AI ORCHESTRATOR — judge probe ===\n');
for (const [name, ok, detail] of rows) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else console.error(`  ✗ ${name}\n    ${detail}`);
}
console.log(`\n=== JUDGE PROBE: ${passed}/${rows.length} passed ===\n`);
if (passed !== rows.length) process.exit(1);
