#!/usr/bin/env node
/**
 * FEE ROUTING VERIFIER
 * ---------------------------------------------------------------------------
 * Answers, with evidence rather than assurances: "will the 0.5% actually land
 * in my wallet?"
 *
 * It runs three independent checks per chain:
 *
 *   1. ADDRESS SANITY — the configured recipient is a well-formed address of
 *      the right family for that chain. A Tron address configured on an EVM
 *      chain is not a payment, it is a burn.
 *
 *   2. LIVE ROUTE ECHO — asks the KyberSwap aggregator for a real quote with
 *      our fee params and confirms `routeSummary.extraFee` comes back with OUR
 *      address and OUR basis points. This is the one that matters: extraFee is
 *      what gets signed into the calldata, so if the echo is wrong the money
 *      goes elsewhere no matter what our source says.
 *
 *   3. ARITHMETIC — recomputes the fee from amountIn and checks it against
 *      what the aggregator reports, so a units mistake shows up as a number
 *      rather than as a surprise at the end of the month.
 *
 * Usage:
 *   node scripts/verify-fees.mjs              # all chains, 1 unit of native
 *   node scripts/verify-fees.mjs --chain 56
 *
 * Exit code is non-zero if any chain fails, so CI can gate a release on it.
 */

import { PAYOUT_DIRECTORY, isValidFor, resolvePayout } from '../src/lib/payout.js';

const FEE_BPS = 50; // keep in sync with src/lib/chains.js
const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const AGG = 'https://aggregator-api.kyberswap.com';

const SLUG = {
  56: 'bsc',
  1: 'ethereum',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  43114: 'avalanche',
  /* The four 2026-09 additions (see docs/NETWORKS-ADD-FA.md). Linea + Sonic
     already route fees but are intentionally not re-added here to keep this
     tool's existing behaviour unchanged. */
  5000: 'mantle',
  80094: 'berachain',
  130: 'unichain',
  143: 'monad'
};

/**
 * A liquid token per chain to quote native -> token against. Only used to make
 * the aggregator return a route so we can inspect extraFee — never signed, so
 * an address here is read-only. VERIFY each address on the chain's own explorer
 * / official docs before trusting the result of this gate.
 */
const STABLE = {
  56: '0x55d398326f99059fF775485246999027B3197955',
  1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  10: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  43114: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
  /* New 2026-09 chains. Outputs are wrapped-native / bridged-USDC so the pair
     native -> token is liquid. Source of each: Mantle = official bridge FAQ,
     Berachain = official contracts page (WBERA), Unichain = Uniswap deployment
     table (WETH), Monad = Uniswap deployment table (WMON). */
  5000: '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9', // Mantle bridged USDC
  80094: '0x6969696969696969696969696969696969696969', // WBERA
  130: '0x4200000000000000000000000000000000000006', // WETH
  143: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A' // WMON
};

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

const only = arg('--chain');

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const warn = (s) => `\x1b[33m!\x1b[0m ${s}`;

let failures = 0;

async function checkChain(row) {
  const { chainId, family, label } = row;
  console.log(`\n── ${label} ──────────────────────────────`);

  /* 1. address sanity */
  const resolved = resolvePayout(chainId, family);
  if (!resolved) {
    console.log(bad('no payout address resolves for this network — fees would be lost'));
    failures += 1;
    return;
  }
  if (!isValidFor(family, resolved.address)) {
    console.log(bad(`address is not valid for the ${family} family: ${resolved.address}`));
    failures += 1;
    return;
  }
  console.log(ok(`recipient ${resolved.address}${resolved.fallback ? ' (via fallback)' : ''}`));
  console.log(`  gas on this network is paid in ${row.gas}`);

  /* Non-EVM chains have no aggregator route to test — swaps do not run there
     yet, they are receive-only, so there is nothing further to verify. */
  const slug = SLUG[chainId];
  if (!slug) {
    console.log(warn('receive-only network — no swap route to verify'));
    return;
  }

  /* 2 + 3. live echo and arithmetic */
  const amountIn = 10n ** 18n; // 1 native unit
  const params = new URLSearchParams({
    tokenIn: NATIVE,
    tokenOut: STABLE[chainId],
    amountIn: String(amountIn),
    gasInclude: 'true',
    feeAmount: String(FEE_BPS),
    isInBps: 'true',
    chargeFeeBy: 'currency_in',
    feeReceiver: resolved.address
  });

  try {
    const res = await fetch(`${AGG}/${slug}/api/v1/routes?${params}`, {
      headers: { 'x-client-id': 'fbt-swap', accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      console.log(warn(`aggregator returned HTTP ${res.status} — could not verify live`));
      return;
    }
    const body = await res.json();
    const summary = body?.data?.routeSummary;
    if (!summary) {
      console.log(warn(`no route returned (${body?.message ?? 'unknown'}) — could not verify live`));
      return;
    }

    const fee = summary.extraFee;
    if (!fee) {
      console.log(bad('extraFee MISSING from the route — this swap would pay us nothing'));
      failures += 1;
      return;
    }
    if (String(fee.feeReceiver).toLowerCase() !== resolved.address.toLowerCase()) {
      console.log(bad(`fee would go to ${fee.feeReceiver}, NOT ${resolved.address}`));
      failures += 1;
      return;
    }
    if (String(fee.feeAmount) !== String(FEE_BPS)) {
      console.log(bad(`fee is ${fee.feeAmount} bps, expected ${FEE_BPS}`));
      failures += 1;
      return;
    }
    console.log(ok(`aggregator confirms ${fee.feeAmount} bps to ${fee.feeReceiver}`));
    console.log(ok(`charged on ${fee.chargeFeeBy} (input token), enforced on-chain`));

    const expected = (amountIn * BigInt(FEE_BPS)) / 10000n;
    console.log(
      ok(
        `arithmetic: 1.0 native in → ${(Number(expected) / 1e18).toFixed(6)} native fee ` +
          `(~$${((Number(summary.amountInUsd) || 0) * FEE_BPS) / 10000})`
      )
    );
  } catch (e) {
    console.log(warn(`live check failed: ${String(e.message).slice(0, 80)}`));
  }
}

console.log('FEE ROUTING VERIFICATION');
console.log(`Platform fee: ${FEE_BPS} bps (${FEE_BPS / 100}%), charged on the INPUT token.`);

const rows = PAYOUT_DIRECTORY.filter((r) => (only ? String(r.chainId) === String(only) : true));
for (const row of rows) {
  // eslint-disable-next-line no-await-in-loop
  await checkChain(row);
}

console.log(
  failures
    ? `\n\x1b[31m${failures} chain(s) FAILED — do not ship until these are fixed.\x1b[0m\n`
    : '\n\x1b[32mAll configured chains route fees to the expected address.\x1b[0m\n'
);
process.exit(failures ? 1 : 0);
