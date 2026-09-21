#!/usr/bin/env node
/**
 * FEE MODE PER-CHAIN PROBE — the §2.1 acceptance test
 * ---------------------------------------------------------------------------
 * The bug this locks down (docs/REVENUE-RAIL-COMPLETION-FA.md §2.1):
 *
 *   feeEnabled() used to read ONE global VITE_FEE_ROUTER_ADDRESS. Setting it
 *   for BSC switched EVERY chain into contract mode — swaps on the other 15
 *   chains targeted an address with no code there and failed at signing.
 *
 * The fix under test: a per-chain map (VITE_FEE_ROUTERS), a BSC-only legacy
 * honouring of the old var, and `aggregatorFeeEnabled(chainId)` derived
 * per-chain so chains WITHOUT a router keep their fee-carrying aggregator
 * path.
 *
 * Three layers of proof:
 *   1. parseFeeRouters unit tests — every fail-safe (bad JSON, bad address,
 *      unknown chain) must fall toward the AGGREGATOR mode, which still earns.
 *   2. child-process import-time scenarios (env is read at module load):
 *      BSC-only map / legacy address / garbage env.
 *   3. the end-to-end regression that matters: with a BSC-only map and a
 *      stubbed network, a quote on BASE (8453) still returns a fee-carrying
 *      aggregator quote — while BSC (56) correctly leaves the aggregator
 *      path for its own contract path.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

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

const A1 = '0x1111111111111111111111111111111111111111';
const A2 = '0x2222222222222222222222222222222222222222';

/* ════════════════════════════════════════════════════════════════════════ */
/* 1. parseFeeRouters — the pure parser and its fail-safes                 */
/* ════════════════════════════════════════════════════════════════════════ */
const { parseFeeRouters, FEE_MODE, feeEnabledFor, aggregatorFeeEnabled, FEE_ROUTER_ADDRESS } =
  await import('../src/lib/chains.js');

report('parseFeeRouters unit', [
  ['empty inputs → no routers, nothing rejected', (() => { const r = parseFeeRouters(null, null); return Object.keys(r.routers).length === 0 && r.rejected.length === 0; })()],
  ['valid map parsed per chain', parseFeeRouters('{"56":"' + A1 + '","8453":"' + A2 + '"}').routers[56] === A1 && parseFeeRouters('{"56":"' + A1 + '","8453":"' + A2 + '"}').routers[8453] === A2],
  ['legacy single address lands on BSC only', (() => { const r = parseFeeRouters(null, A2); return r.routers[56] === A2 && Object.keys(r.routers).length === 1; })()],
  ['per-chain entry OVERRIDES the legacy address', parseFeeRouters('{"56":"' + A1 + '"}', A2).routers[56] === A1],
  ['malformed JSON → empty map + a reason, never a throw', (() => { const r = parseFeeRouters('{not json', A2); return r.routers[56] === A2 && r.rejected.some((x) => x.includes('not valid JSON')); })()],
  ['invalid address value → that chain dropped, reason kept', (() => { const r = parseFeeRouters('{"8453":"0xdeadbeef"}', null); return Object.keys(r.routers).length === 0 && r.rejected.some((x) => x.includes('8453')); })()],
  ['unknown chain id → dropped (a router where we do not swap is a mistake)', (() => { const r = parseFeeRouters('{"99999":"' + A1 + '"}', null); return Object.keys(r.routers).length === 0 && r.rejected.some((x) => x.includes('99999')); })()],
  ['non-object JSON (array) → rejected with a reason', parseFeeRouters('[]', null).rejected.length === 1]
]);

report('clean-import defaults (no env set)', [
  ['FEE_MODE is aggregator when nothing is configured', FEE_MODE === 'aggregator'],
  ['feeEnabledFor(56) is false', feeEnabledFor(56) === false],
  ['aggregatorFeeEnabled is true (the fee still earns)', aggregatorFeeEnabled(56) === true && aggregatorFeeEnabled(8453) === true],
  ['legacy export is null', FEE_ROUTER_ADDRESS === null]
]);

/* ════════════════════════════════════════════════════════════════════════ */
/* 2. Import-time scenarios — env is read at module load, so child procs   */
/* ════════════════════════════════════════════════════════════════════════ */

/** Run a small module script with extra env and collect its console lines. */
function child(script, env) {
  return execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { env: { ...process.env, ...env, FBT_ROOT: root }, encoding: 'utf8' }
  );
}

const importChains = `
  import { pathToFileURL } from 'node:url';
  const m = await import(pathToFileURL(process.env.FBT_ROOT + '/src/lib/chains.js').href);
`;

/* ── Scenario A: BSC-only map — the exact deployment §2.2 prescribes ────── */
const outA = child(
  importChains + `
  console.log('FEE_MODE=' + m.FEE_MODE);
  console.log('e56=' + m.feeEnabledFor(56));
  console.log('e8453=' + m.feeEnabledFor(8453));
  console.log('e1=' + m.feeEnabledFor(1));
  console.log('agg8453=' + m.aggregatorFeeEnabled(8453));
  console.log('agg56=' + m.aggregatorFeeEnabled(56));
  console.log('router56=' + m.feeRouterFor(56));
  console.log('legacy=' + m.FEE_ROUTER_ADDRESS);
  `,
  { VITE_FEE_ROUTERS: JSON.stringify({ 56: A1 }) }
);
const a = Object.fromEntries(outA.trim().split('\n').map((l) => l.split('=')));

report('BSC-only map (import time)', [
  ['FEE_MODE reports contract (a deployment exists)', a.FEE_MODE === 'contract'],
  ['BSC is in contract mode', a.e56 === 'true'],
  ['Base is NOT in contract mode', a.e8453 === 'false' && a.e1 === 'false'],
  ['★ Base keeps its aggregator fee path — the §2.1 regression guard', a.agg8453 === 'true'],
  ['BSC leaves the aggregator path to its own contract', a.agg56 === 'false'],
  ['feeRouterFor(56) is the configured address', a.router56 === A1],
  ['legacy export mirrors BSC', a.legacy === A1]
]);

/* ── Scenario B: legacy single address — honoured, BSC-only ─────────────── */
const outB = child(
  importChains + `
  console.log('e56=' + m.feeEnabledFor(56));
  console.log('e8453=' + m.feeEnabledFor(8453));
  `,
  { VITE_FEE_ROUTER_ADDRESS: A2 }
);
const b = Object.fromEntries(outB.trim().split('\n').map((l) => l.split('=')));

report('legacy single address (backward compat)', [
  ['legacy address enables BSC only', b.e56 === 'true' && b.e8453 === 'false']
]);

/* ── Scenario C: garbage env — fail toward the earning mode ─────────────── */
const outC = child(
  importChains + `
  console.log('FEE_MODE=' + m.FEE_MODE);
  console.log('e56=' + m.feeEnabledFor(56));
  console.log('agg56=' + m.aggregatorFeeEnabled(56));
  `,
  { VITE_FEE_ROUTERS: '{"56": "0xtypo' }
);
const c = Object.fromEntries(outC.trim().split('\n').map((l) => l.split('=')));

report('garbage env fails safe', [
  ['broken JSON → aggregator mode everywhere (fees still earn)', c.FEE_MODE === 'aggregator' && c.e56 === 'false' && c.agg56 === 'true']
]);

/* ════════════════════════════════════════════════════════════════════════ */
/* 3. End-to-end: BSC-only map + stubbed network → Base still swaps        */
/* ════════════════════════════════════════════════════════════════════════ */
const outE2E = child(
  `
  import { pathToFileURL } from 'node:url';
  /* Same stub convention as execution-sources-probe: only the network
     boundary is fake; the real getQuote runs. Kyber dead, OpenOcean alive. */
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url.includes('kyberswap') || url.includes('velora')) {
      return Promise.reject(new TypeError('network unreachable (probe)'));
    }
    if (url.startsWith('/')) {
      return Promise.reject(new TypeError('network unreachable (probe)'));
    }
    if (url.includes('openocean') && url.includes('/quote?')) {
      return new Response(JSON.stringify({ code: 200, data: {
        outAmount: '990000000', exchange: '0x6352a561a2C1d0ad4EE3c5eE25F49f0BB18BB52F', dexes: ['aerodrome']
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return Promise.reject(new TypeError('network unreachable (probe)'));
  };

  const chains = await import(pathToFileURL(process.env.FBT_ROOT + '/src/lib/chains.js').href);
  const swap = await import(pathToFileURL(process.env.FBT_ROOT + '/src/lib/swap.js').href);
  const USER = '0x1111111111111111111111111111111111111111';

  /* BASE (8453): no FeeRouter configured → the aggregator path must run. */
  const usdc = chains.TOKENS[8453].find((t) => t.symbol === 'USDC');
  const dai  = chains.TOKENS[8453].find((t) => t.symbol === 'DAI');
  const qBase = await swap.getQuote({ provider: {}, chainId: 8453, fromToken: usdc, toToken: dai, amountIn: '10', slippage: 0.5, fromAddress: USER });

  /* BSC (56): FeeRouter configured → the aggregator path must NOT run; the
     contract/direct branch takes over and (with a hollow provider) answers
     the direct-path shape, never an aggregator quote. */
  const usdt = chains.TOKENS[56].find((t) => t.symbol === 'USDT');
  const cake = chains.TOKENS[56].find((t) => t.symbol === 'CAKE');
  const qBsc = await swap.getQuote({ provider: {}, chainId: 56, fromToken: usdt, toToken: cake, amountIn: '10', slippage: 0.5, fromAddress: USER });

  console.log('baseSource=' + (qBase.source || qBase.error));
  console.log('baseFee=' + qBase.feeBps);
  console.log('bscShape=' + (qBsc.source ? 'aggregator:' + qBsc.source : 'direct:' + qBsc.error));
  console.log('spender56=' + swap.spenderFor(56, {}));
  console.log('spender8453=' + swap.spenderFor(8453, {}));
  globalThis.fetch = realFetch;
  `,
  { VITE_FEE_ROUTERS: JSON.stringify({ 56: A1 }) }
);
const e = Object.fromEntries(outE2E.trim().split('\n').map((l) => l.split('=')));

report('end-to-end with a BSC-only map', [
  ['★ BASE still returns a fee-carrying aggregator quote', e.baseSource === 'openocean' && Number(e.baseFee) === 70],
  ['BSC does not leak into the aggregator path (contract/direct branch instead)', e.bscShape.startsWith('direct:')],
  ['approval spender on 56 is OUR router', e.spender56 === A1],
  ['approval spender on 8453 is the chain DEX router, not our router', e.spender8453 === '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24']
]);

/* ── verdict ─────────────────────────────────────────────────────────────── */
if (failed) {
  console.error(`\n${failed} FAILED\n`);
  process.exit(1);
}
console.log('\nAll fee-mode per-chain assertions passed.\n');
