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
import { setCiSource, resetCiSources } from '../server/ci/sources.js';
import { installFakes } from '../test/intent-ai/ci-fakes.mjs';

/*
 * THE SOURCES ARE FAKED, AND THAT IS THE POINT.
 *
 * The real wallet source reads the chain over RPC. In a sandbox there is
 * no RPC, so the read fails, the wallet section goes STALE, and the
 * wallet capability drops to UNAVAILABLE — and every EXECUTE intent is
 * down-scored, because an execution without a readable wallet is not
 * executable.
 *
 * That is CORRECT behaviour, and it made the probe measure the wrong
 * thing: a broken dependency, not a broken engine. It also hid a real
 * bug — «برو به شبکه پالیگان» classified as NAVIGATE — because the
 * broken wallet changed which intent won.
 *
 * So the sources are faked IN-PROCESS, the way the turn probes do it.
 * The fake answers the SAME dialect the real source answers, and the
 * brain, the registry, the policy and the state store are all REAL. The
 * measurement is about the BRAIN's wiring, and the brain's wiring does
 * not need a blockchain to be measured.
 */
for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);

/**
 * One real sentence per intent. Not a synthetic label — a sentence a
 * person would type, because the classification is part of what is
 * being measured.
 */
/*
 * `--json` prints the machine-readable form, which is what the GATE
 * (`test/intent-ai/intent-reach-gate.test.mjs`) reads. The gate runs
 * THIS probe rather than a copy of it, because a copy is a thing that
 * drifts.
 */
const AS_JSON = process.argv.includes('--json');

const PROBES = [
  { intent: 'PORTFOLIO_ANALYSIS', message: 'ترکیب پرتفوی من چیست؟' },
  { intent: 'INSTRUMENT_QUERY', message: 'کدام ETF را بخرم؟' },
  { intent: 'CONDITIONAL_ALLOCATION', message: 'اگر طلا ۵٪ اصلاح کرد و BTC بالای X بود، ۱۰٪ سرمایه را به طلا اختصاص بده' },
  { intent: 'CONCENTRATION_CHECK', message: 'تمرکز پرتفوی من چقدر است؟' },
  /* The plain risk verdict (§5.23). It is the SECOND half of
     «پورتفوی من چیست و ریسکش چقدر است», and it had no intent at all
     until that gap was closed. */
  { intent: 'RISK_OVERVIEW', message: 'ریسک من چقدر است؟' },
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
  { intent: 'QUOTE_BRIDGE', message: 'قیمت پل زدن از ۱ به ۱۳۷ چقدر است؟' },
  { intent: 'CREATE_GOAL', message: 'یک هدف برایم بساز' },
  { intent: 'SET_ALERT', message: 'برای بیت‌کوین هشدار بگذار' },
  /*
   * THE EXECUTION INTENTIONS — the ones with consequences.
   *
   * These were the last ten of the thirty-six, and they are the ones
   * that matter most: a misclassified EXECUTE is a transaction the user
   * did not ask for. So the sweep asks about them too, and it asks in
   * the shape that produces the most DANGEROUS confusion:
   *
   *   · a QUOTE that reads like an ORDER («قیمت سواپ بیت‌کوین چقدر
   *     است؟» wants a price; «ETH را به USDC سواپ کن» wants the
   *     trade);
   *   · a comparison that reads like a command — which is the shape that
   *     caught the bridge bug;
   *   · the confirmation and cancellation pair, which are the two
   *     intents that MUST NOT fire on their own.
   */
  { intent: 'EXECUTE_SWAP', message: 'ETH را به USDC سواپ کن' },
  { intent: 'EXECUTE_BRIDGE', message: 'برو به شبکه پالیگان' },
  { intent: 'EXECUTE_LEND', message: '۱۰۰ دلار را در Aave وام بگذار' },
  { intent: 'EXECUTE_BORROW', message: 'از Aave وام بگیر' },
  { intent: 'EXECUTE_REPAY', message: 'وام Aave را برگردان' },
  { intent: 'EXECUTE_REBALANCE', message: 'پرتفوی را دوباره متعادل کن' },
  /*
   * The confirmation pair are FOLLOW-UPS, not patterns.
   *
   * «بله، انجام بده» only means CONFIRM_PENDING when there is something
   * waiting to be confirmed — `detectFollowUp` looks for
   * `memory.pendingConfirmation` and returns nothing without one. So
   * these two probes carry a SETUP: a swap with an amount, which is
   * what creates a pending action.
   *
   * That is not a workaround. It is the truth about these two intents:
   * they are about an ACTION, and the action is what they need.
   */
  { intent: 'CONFIRM_PENDING', message: 'بله، انجام بده', setup: 'ETH را به USDC سواپ کن' },
  { intent: 'CANCEL_PENDING', message: 'نه، لغو کن', setup: 'ETH را به USDC سواپ کن' },
  { intent: 'NAVIGATE', message: 'برو به صفحه پورتفوی' }
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
      /* The setup turn, when the intent needs one. It is a REAL turn —
         the same brain, the same owner, the same state — because a
         confirmation is a property of a conversation, not of a
         sentence. */
      if (probe.setup) {
        try {
          await brain.handle({ owner, message: probe.setup, locale: 'fa' });
        } catch (setupErr) {
          error = `setup: ${String(setupErr?.message || setupErr).slice(0, 90)}`;
        }
      }
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

  if (AS_JSON) {
    const unmatched = rows.filter((r) => !r.matched);
    const allFailed = rows.filter((r) => r.ok === 0);
    console.log(JSON.stringify({
      rows,
      summary: {
        probes: rows.length,
        classifiedAsAsked: rows.length - unmatched.length,
        withOkFinding: rows.length - allFailed.length,
        withNoFinding: allFailed.length
      }
    }, null, 2));
    return;
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
