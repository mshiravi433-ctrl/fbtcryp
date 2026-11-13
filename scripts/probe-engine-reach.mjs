/**
 * DOES EVERY ENGINE REACH THE ANSWER?
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The dark-engine count was closed at ZERO once already, and it was
 * wrong. Every engine in `server/fios/` had a path from the brain, the
 * providers were mounted, the surface tests passed — and three engines
 * still did not answer, because each one was missing an INPUT the
 * deployment never sent:
 *
 *   · the route engine had no TRANSFER;
 *   · the why engine had no DECISION, and then had its why-lines
 *     thrown away by the provider;
 *   · the conversation machinery had its QUESTION replaced by a generic
 *     sentence.
 *
 * The surface tests could not see any of it, because they drove the
 * engines DIRECTLY. They proved the parts.
 *
 * So this harness asks the only question that matters: for EVERY
 * intent, in a REAL brain turn, does the engine's own output reach
 * the reply?
 *
 * It is a MEASUREMENT, not a verdict. A dark engine here is a line
 * with a reason attached, and the reason is the next thing to fix.
 *
 *   node scripts/probe-engine-reach.mjs
 */

import { createCentralBrain } from '../server/ci/brain.js';
import { createCentralStateStore } from '../server/ci/stateStore.js';

/**
 * One real sentence per intent. Not a synthetic label — a sentence a
 * person would type, because the classification is part of what is
 * being measured.
 */
const PROBES = [
  { intent: 'PORTFOLIO_ANALYSIS', message: 'ترکیب پرتفوی من چیست؟' },
  { intent: 'INSTRUMENT_QUERY', message: 'کدام ETF را بخرم؟' },
  { intent: 'CONDITIONAL_ALLOCATION', message: 'اگر طلا ۵٪ اصلاح کرد و BTC بالای X بود، ۱۰٪ سرمایه را به طلا اختصاص بده' },
  { intent: 'CONCENTRATION_CHECK', message: 'تمرکز پرتفوی من چقدر است؟' },
  { intent: 'YIELD_OPPORTUNITY', message: 'کدام استخر بیشترین APY را دارد؟' },
  { intent: 'SMART_MONEY_READ', message: 'پول هوشمند کجاست؟' },
  { intent: 'LIQUIDITY_RISK', message: 'نقدینگی استخر چقدر است؟' },
  { intent: 'STAKING_REWARD', message: 'پاداش استیکینگ چقدر است؟' },
  { intent: 'OPPORTUNITY_FIT', message: 'کدام گزینه مناسب من است؟' },
  { intent: 'ROUTE_INTELLIGENCE', message: 'کدام پل برای انتقال بیت‌کوین به پالیگان بهتر است؟' },
  { intent: 'WHY_DECISION', message: 'چرا این را گفتی؟' },
  { intent: 'ASSET_ANALYSIS', message: 'بیت‌کوین را تحلیل کن' },
  { intent: 'BALANCE_QUERY', message: 'موجودی من چقدر است؟' },
  { intent: 'LOAN_STATUS', message: 'وضعیت وام من چیست؟' },
  { intent: 'BORROW_CAPACITY', message: 'چقدر می‌توانم وام بگیرم؟' },
  { intent: 'FUTURES_RISK', message: 'ریسک آینده و پوزیشن‌های فیوچرز من چقدر است؟' },
  { intent: 'MARKET_OVERVIEW', message: 'وضعیت بازار چگونه است؟' },
  { intent: 'NEWS_SUMMARY', message: 'آخرین خبرها چیست؟' },
  { intent: 'SIGNAL_READING', message: 'سیگنال‌های بازار چه می‌گویند؟' },
  { intent: 'GOAL_PLAN', message: 'برای رسیدن به هدفم چه برنامه‌ای داشته باشم؟' },
  { intent: 'PROFIT_PLAN', message: 'برنامه سودآوری من چیست؟' },
  { intent: 'WHATIF_SIMULATION', message: 'اگر بازار ۲۰٪ بریزد چه می‌شود؟' },
  { intent: 'QUOTE_SWAP', message: 'قیمت سواپ بیت‌کوین چقدر است؟' },
  { intent: 'QUOTE_BRIDGE', message: 'پل بزنم از ۱ به ۱۳۷' },
  { intent: 'CREATE_GOAL', message: 'یک هدف برایم بساز' },
  { intent: 'SET_ALERT', message: 'برای بیت‌کوین هشدار بگذار' }
];

/* An owner with a portfolio, so the reads that need holdings have
   something to read. Without it the probe would measure the ABSENCE of
   a wallet, which is not what it is for. */
async function seedOwner(stateStore, owner) {
  await stateStore.write(owner, 'wallet', {
    data: { addresses: { evm: ['0x1111111111111111111111111111111111111111'] }, connected: true },
    source: 'probe-wallet', status: 'OK', now: Date.now()
  });
  await stateStore.write(owner, 'portfolio', {
    data: {
      holdings: [
        { symbol: 'USDC', amount: 2500, valueUsd: 2500, chainId: 1, priceUsd: 1 },
        { symbol: 'ETH', amount: 1.5, valueUsd: 4800, chainId: 1, priceUsd: 3200 }
      ],
      totalValueUsd: 7300, dataStatus: 'live'
    },
    source: 'probe-portfolio', status: 'OK', now: Date.now()
  });
  await stateStore.write(owner, 'markets', {
    data: { prices: { USDC: { priceUsd: 1 }, ETH: { priceUsd: 3200 } }, bySymbol: {} },
    source: 'probe-markets', status: 'OK', now: Date.now()
  });
  await stateStore.write(owner, 'goals', {
    data: { goals: [{ id: 'g1', targetUsd: 100000, horizonMonths: 36 }] },
    source: 'probe-goals', status: 'OK', now: Date.now()
  });
}

/** The findings a turn produced, by id. */
function findingMap(out) {
  const map = new Map();
  for (const f of out?.findings || []) if (f?.id) map.set(f.id, f);
  return map;
}

async function main() {
  const stateStore = createCentralStateStore();
  const brain = createCentralBrain({ stateStore });

  const rows = [];
  for (const probe of PROBES) {
    const owner = `probe-${probe.intent}`;
    await seedOwner(stateStore, owner);
    let out = null;
    let error = null;
    try {
      out = await brain.handle({ owner, message: probe.message, locale: 'fa' });
    } catch (err) {
      error = String(err?.message || err).slice(0, 120);
    }
    const findings = findingMap(out);
    const ok = [...findings.values()].filter((f) => f.status === 'OK' || f.status === 'PARTIAL');
    const failed = [...findings.values()].filter((f) => f.status !== 'OK' && f.status !== 'PARTIAL');
    rows.push({
      intent: probe.intent,
      classified: out?.intent?.intentType || null,
      matched: out?.intent?.intentType === probe.intent,
      text: String(out?.response?.text || '').length,
      ok: ok.length,
      failed: failed.length,
      failedIds: failed.map((f) => f.id).join(','),
      reasons: failed.map((f) => `${f.id}: ${f.reason || ''}`.slice(0, 70)).join(' | '),
      error
    });
  }

  console.log('');
  console.log('  DOES EVERY ENGINE REACH THE ANSWER?');
  console.log('  ' + '='.repeat(78));
  console.log(`  ${'intent'.padEnd(22)} {'class'.padEnd(8)} {'ok'.padStart(3)} {'no'.padStart(3)}  notes`);
  console.log('  ' + '-'.repeat(78));
  for (const row of rows) {
    const cls = row.matched ? 'ok' : String(row.classified || '—').slice(0, 8);
    const note = row.error || row.reasons || '';
    console.log(
      `  ${row.intent.padEnd(22)} ${cls.padEnd(8)} ${String(row.ok).padStart(3)} ${String(row.failed).padStart(3)}  ${note.slice(0, 40)}`
    );
  }

  const unmatched = rows.filter((r) => !r.matched);
  const allFailed = rows.filter((r) => r.ok === 0);
  console.log('');
  console.log('  ' + '-'.repeat(78));
  console.log(`  probes                ${rows.length}`);
  console.log(`  classified as asked   ${rows.length - unmatched.length}`);
  console.log(`  with an OK finding     ${rows.length - allFailed.length}`);
  console.log(`  with NO finding at all ${allFailed.length}`);
  if (unmatched.length) {
    console.log('');
    console.log('  THE SENTENCE DID NOT REACH ITS INTENT — the probe is wrong,');
    console.log('  not the engine:');
    for (const row of unmatched) console.log(`    ${row.intent} → ${row.classified}`);
  }
  console.log('');
}

main().catch((error) => {
  console.error('the probe failed:', error?.message || error);
  process.exitCode = 1;
});
