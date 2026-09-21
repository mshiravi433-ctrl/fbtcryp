#!/usr/bin/env node
/**
 * EXECUTION SOURCES PROBE — the Layer-1 acceptance test of the revenue rail
 * ---------------------------------------------------------------------------
 * Two jobs, matching docs/REVENUE-RAIL-COMPLETION-FA.md §2 (لایه ۱):
 *
 *   1. THE TABLE IS TRUE. lib/executionSources.js is the one place that
 *      answers "on chain X, if the primary dies, who is left and can they
 *      still carry our 0.70%?". This probe asserts the answer for every chain
 *      in the registry: no chain without a fee-carrying executor, no chain
 *      with a quote-only source counted as an executor, and every chain
 *      two-source or better (a regression to single-source must be a loud,
 *      deliberate act, not a silent drift).
 *
 *   2. THE OUTAGE FALLBACK IS REAL. With the external boundary stubbed — the
 *      repo's convention, same as cross-chain-probe.mjs — simulate KyberSwap
 *      being down and assert:
 *        a. a healthy OpenOcean still wins the race and its quote carries the
 *           fee (referrer + 0.7% in the actual request URL);
 *        b. a SLOW OpenOcean (fails the 3s second-opinion leash, answers on
 *           the promoted primary-grade re-ask) still produces a quote — the
 *           dynamic-promotion path that used to answer «مسیری بین این دو
 *           توکن وجود ندارد»;
 *        c. when everything is dead, the honest retriable error comes back —
 *           never a fee-free swap, never a fake quote.
 *
 * No network access. The real swap engine (lib/swap.js getQuote) runs against
 * the real adapters; only fetch is faked, per-source by URL.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/* ─── tiny reporter (same shape as the repo's other probes) ─────────────── */
let failed = 0;
function report(section, rows) {
  console.log(`\n▸ ${section}`);
  for (const [label, ok] of rows) {
    if (ok) console.log(`  ✓ ${label}`);
    else {
      failed += 1;
      console.log(`  ✗ ${label}`);
    }
  }
}

/* ════════════════════════════════════════════════════════════════════════ */
/* 1. The table — every chain, executor and redundancy invariants          */
/* ════════════════════════════════════════════════════════════════════════ */
const { executionPlanFor, chainCoverageReport, chainsWithoutFeeExecutor, singleExecutorChains, PRIMARY_LEASH_MS, SECONDARY_LEASH_MS } =
  await import('../src/lib/executionSources.js');
const { EVM_CHAIN_ORDER, FEE_BPS } = await import('../src/lib/chains.js');

const USER = '0x1111111111111111111111111111111111111111';
const coverage = chainCoverageReport({ fromAddress: USER });

console.log('Execution-source coverage (from lib/executionSources.js):');
for (const row of coverage) {
  console.log(
    `  ${String(row.chainId).padEnd(7)} ${row.chain.padEnd(16)} primary=${String(row.primary).padEnd(10)} executors=[${row.feeExecutors.join(', ')}]`
  );
}

report('table invariants', [
  ['every registered chain has a plan', coverage.length === EVM_CHAIN_ORDER.length && coverage.length > 0],
  ['no chain is left without a fee-carrying executor', chainsWithoutFeeExecutor({ fromAddress: USER }).length === 0],
  ['no chain depends on a single fee-carrying executor', singleExecutorChains({ fromAddress: USER }).length === 0],
  [
    'velora is never counted as an executor (quote-only)',
    coverage.every((r) => !r.feeExecutors.includes('velora'))
  ],
  [
    'BSC: kyberswap is primary and openocean runs the short leash',
    (() => {
      const p = executionPlanFor(56, { fromAddress: USER });
      return p.primaryId === 'kyberswap' && p.sources.openocean?.shortLeash === true && p.sources.openocean?.leashMs === SECONDARY_LEASH_MS;
    })()
  ],
  [
    'Mantle (kyber-dead): openocean runs PRIMARY-grade, lifi present',
    (() => {
      const p = executionPlanFor(5000, { fromAddress: USER });
      return p.primaryId === 'openocean' && p.sources.openocean?.shortLeash === false && p.sources.openocean?.leashMs === PRIMARY_LEASH_MS && p.feeExecutors.includes('lifi');
    })()
  ],
  [
    'without a fromAddress, lifi is honestly not live',
    executionPlanFor(5000, {}).feeExecutors.includes('lifi') === false
  ]
]);

/* ════════════════════════════════════════════════════════════════════════ */
/* 2. The wiring — the plan is load-bearing, not decoration                */
/* ════════════════════════════════════════════════════════════════════════ */
const swapSrc = readFileSync(path.join(root, 'src/lib/swap.js'), 'utf8');
report('wiring', [
  ['swap.js builds its source set from executionPlanFor', swapSrc.includes('executionPlanFor(chainId')],
  ['swap.js re-asks short-leashed sources with PRIMARY_LEASH_MS on a dead round', swapSrc.includes('quoteAsPrimary') && swapSrc.includes('PRIMARY_LEASH_MS')]
]);

/* ════════════════════════════════════════════════════════════════════════ */
/* 3. Kyber outage — real getQuote, faked network boundary                 */
/* ════════════════════════════════════════════════════════════════════════ */
const { getQuote } = await import('../src/lib/swap.js');
const { PAYOUT_ADDRESSES } = await import('../src/lib/payout.js');

const BSC_USDT = { symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 };
const BSC_CAKE = { symbol: 'CAKE', name: 'PancakeSwap', address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', decimals: 18 };
const OO_SPENDER = '0x6352a561a2C1d0ad4EE3c5eE25F49f0BB18BB52F';

const realFetch = globalThis.fetch;
let ooQuoteCalls = 0;
let ooFirstCallFails = false;
let ooLastQuery = null;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const deadNetwork = () => Promise.reject(new TypeError('network unreachable (probe)'));

globalThis.fetch = async (input) => {
  const url = String(input?.url || input);

  /* KyberSwap direct + its same-origin proxy retry: DEAD. This is the
     simulated outage — network-level, exactly the failure class the proxy
     exists for, so both attempts must fail for the probe to be honest. */
  if (url.includes('kyberswap')) return deadNetwork();
  if (url.includes('/api/swap/') || url.startsWith('/')) return deadNetwork();

  /* Velora: dead too — a cleaner race (it is quote-only anyway). */
  if (url.includes('velora')) return deadNetwork();

  /* OpenOcean quote endpoint. */
  if (url.includes('openocean') && url.includes('/quote?')) {
    ooQuoteCalls += 1;
    ooLastQuery = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    if (ooFirstCallFails && ooQuoteCalls === 1) {
      /* 503 = upstream broken = network-class failure → the adapter will try
         the same-origin proxy (dead above) and surface the original error.
         First round is therefore a LOSS for OpenOcean; the promoted re-ask
         (call #2) succeeds. This models "OpenOcean merely slow" without
         making the probe sleep for real seconds. */
      return json({ message: 'upstream overloaded' }, 503);
    }
    return json({
      code: 200,
      data: {
        outAmount: '9900000000000000000', /* 9.9 CAKE for 10 USDT */
        exchange: OO_SPENDER,
        dexes: ['pancakeswap']
      }
    });
  }

  return deadNetwork();
};

async function quoteBsc() {
  return getQuote({
    provider: {},
    chainId: 56,
    fromToken: BSC_USDT,
    toToken: BSC_CAKE,
    amountIn: '10',
    slippage: 0.5,
    fromAddress: USER
  });
}

/* ── 3a. Kyber down, OpenOcean healthy → the race is won by OpenOcean ──── */
ooFirstCallFails = false;
const q1 = await quoteBsc();
report('kyber outage, healthy openocean', [
  ['a fee-carrying quote comes back at all', Boolean(q1 && !q1.error)],
  ['it is the openocean route', q1?.source === 'openocean'],
  ['it charges the platform fee (feeBps = FEE_BPS)', q1?.feeBps === FEE_BPS],
  ['the fee amount is arithmetically right (0.70% of 10 USDT)', q1?.platformFeeWei === 70000000000000000n],
  ['it is executable (spender named for approval)', q1?.executable === true && q1?.spender === OO_SPENDER],
  ['the fee really travelled in the request (referrer + 0.7%)', ooLastQuery?.get('referrer') === PAYOUT_ADDRESSES.evm && Number(ooLastQuery?.get('referrerFee')) === 0.7],
  ['no promotion was needed', q1?.promotedFrom === null]
]);

/* ── 3b. Kyber down AND OpenOcean loses the 3s leash → promotion rescues ── */
ooQuoteCalls = 0;
ooFirstCallFails = true;
const q2 = await quoteBsc();
report('kyber outage, openocean slow (dynamic promotion)', [
  ['first round failed, second round quoted (exactly 2 direct OO calls)', ooQuoteCalls === 2],
  ['a quote came back despite both failures', Boolean(q2 && !q2.error)],
  ['it is still the openocean route with the fee on it', q2?.source === 'openocean' && q2?.feeBps === FEE_BPS],
  ['the receipt says the winner was promoted, not a normal race win', Array.isArray(q2?.promotedFrom) && q2.promotedFrom.includes('openocean')],
  ['the trace records the promoted re-ask', (q2?.executionTrace?.candidates ?? []).some((c) => c.solver === 'openocean:promoted' && c.status === 'quoted')]
]);

/* ── 3c. Everything dead → the honest retriable error, never a fake quote ── */
ooQuoteCalls = 0;
ooFirstCallFails = true;
globalThis.fetch = async (input) => {
  const url = String(input?.url || input);
  /* Same URL dispatch as above, but OpenOcean COUNTS its calls and always
     fails: this proves the promoted re-ask really fired (call #2 exists)
     even when the whole ecosystem is down. */
  if (url.includes('openocean') && url.includes('/quote?')) {
    ooQuoteCalls += 1;
    return deadNetwork();
  }
  return deadNetwork();
};
const q3 = await quoteBsc();
report('total aggregator outage', [
  ['no quote is invented', Boolean(q3?.error)],
  ['the error is retriable (user should tap again, not change tokens)', q3?.retriable === true],
  ['the promoted re-ask really fired (2 direct OO calls, both dead)', ooQuoteCalls === 2]
]);

globalThis.fetch = realFetch;

/* ── verdict ─────────────────────────────────────────────────────────────── */
if (failed) {
  console.error(`\n${failed} FAILED\n`);
  process.exit(1);
}
console.log('\nAll execution-source assertions passed.\n');
