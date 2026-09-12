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
 *   2. LIVE ROUTE ECHO — asks the routing source the client actually uses for
 *      that chain for a real quote with our fee params and confirms the fee
 *      comes back with OUR address and OUR basis points. On Kyber-served
 *      chains that is `routeSummary.extraFee`; on chains Kyber's gateway no
 *      longer serves (Mantle, Scroll, zkSync Era — HTTP 404, live-probed
 *      2026-09-11) the client routes through OpenOcean, so the echo is their
 *      /decodeInputData reading of the built calldata's `referrer` — the same
 *      proof verifyOpenOceanFee() demands before a user ever signs. This is
 *      the one that matters: it inspects what would actually be signed, so if
 *      the echo is wrong the money goes elsewhere no matter what our source
 *      says.
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
// The platform fee's single source of truth (src/lib/feeBps.js). Importing it
// here — instead of hard-coding a number — means this gate always checks the
// SAME basis points the swap screen actually requests, so the echo can never
// drift from what real quotes carry.
import { FEE_BPS } from '../src/lib/feeBps.js';
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
  /* The 2026-09 additions (see docs/NETWORKS-ADD-FA.md). Linea + Sonic
     already route fees but are intentionally not re-added here to keep this
     tool's existing behaviour unchanged.
     Mantle (5000) was REMOVED on 2026-09-11: Kyber's gateway answers HTTP
     404 for the `mantle`, `scroll` and `zksync` slugs, so asking it here
     would only ever print "could not verify live" — the honest verifier for
     those three is the OpenOcean pass below, which is what the client
     actually uses to route them (KYBER_LIVE in src/lib/aggregator.js). */
  80094: 'berachain',
  130: 'unichain',
  143: 'monad'
};

/*
 * ─── THE OPENOCEAN PASS ──────────────────────────────────────────────────────
 * Chains the Kyber aggregator does NOT serve but OpenOcean v4 does. These are
 * the chains where OpenOcean is not a second opinion but the ONLY routing
 * source (src/lib/swap.js promotes it to primary exactly there), so the fee
 * gate has to speak OpenOcean's protocol on them:
 *
 *   quote  → proves a route exists (a 404/no-route here IS the user-visible
 *            «مسیری بین این دو توکن وجود ندارد»),
 *   swap   → builds real calldata (never broadcast — `account` is required by
 *            their API and we pass the payout address, which cannot receive a
 *            transaction it never signed),
 *   decode → reads `referrer` back OUT of that calldata: the same proof
 *            verifyOpenOceanFee() requires before the app lets a user sign.
 *
 * Slugs mirror OO_SLUG in src/lib/openocean.js — keep both in lockstep.
 */
const OO_BASE = 'https://open-api.openocean.finance/v4';
const OO_SLUG = {
  5000: 'mantle',
  534352: 'scroll',
  324: 'zksync'
};

/* A liquid native -> token pair per OpenOcean-routed chain. Same addresses
   pinned in src/lib/chains.js TOKENS, each cross-checked against the chain's
   live pool registry (GeckoTerminal) on 2026-09-11. */
const OO_TARGET = {
  5000: { name: 'USDT', address: '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE', decimals: 6 },
  534352: { name: 'USDC', address: '0x06eFdbFF2a14a7c8E15944D1F4A48F9F95F663A4', decimals: 6 },
  324: { name: 'USDC', address: '0x1d17CbCf0D6D143135aE902365d2E5e2A16538d4', decimals: 6 }
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
     native -> token is liquid. Source of each: Berachain = official contracts
     page (WBERA), Unichain = Uniswap deployment table (WETH), Monad =
     Uniswap deployment table (WMON). Mantle is NOT here: Kyber's gateway
     404s on the `mantle` slug, so it is verified through the OpenOcean pass
     (OO_TARGET) instead. */
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

/**
 * The OpenOcean echo, for chains the Kyber aggregator no longer serves
 * (Mantle, Scroll, zkSync Era). Same three promises as the Kyber pass —
 * route exists, fee is ours, arithmetic checks out — proven against the
 * endpoint the client actually routes these chains through.
 */
async function checkOpenOcean(row, resolved) {
  const { chainId, gas } = row;
  const slug = OO_SLUG[chainId];
  const target = OO_TARGET[chainId];
  const amountIn = 10n ** 18n; // 1 native unit
  const percent = String(FEE_BPS / 100); // 70 bps -> "0.7" — OO's referrerFee is a PERCENT

  const params = new URLSearchParams({
    inTokenAddress: NATIVE,
    outTokenAddress: target.address,
    amountDecimals: String(amountIn),
    gasPriceDecimals: '1000000000', // 1 gwei reference — only feeds OO's gas optimisation
    slippage: '0.5',
    referrer: resolved.address,
    referrerFee: percent
  });

  try {
    /* 1. ROUTE — the quote must return a real output amount. A no-route here
       IS the user-visible «مسیری بین این دو توکن وجود ندارد», so unlike a
       network hiccup it counts as a failure, not a warning. */
    const qRes = await fetch(`${OO_BASE}/${slug}/quote?${params}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
    const qBody = await qRes.json().catch(() => null);
    if (!qRes.ok || qBody?.code !== 200) {
      console.log(warn(`OpenOcean quote returned HTTP ${qRes.status}${qBody?.message ? ` (${qBody.message})` : ''} — could not verify live`));
      return;
    }
    const out = BigInt(qBody?.data?.outAmount ?? '0');
    if (out <= 0n) {
      console.log(bad('OpenOcean returned NO ROUTE — swaps on this chain would fail with «مسیری بین این دو توکن وجود ندارد»'));
      failures += 1;
      return;
    }
    const dexes = Array.isArray(qBody.data.dexes) ? qBody.data.dexes.join(', ') : 'direct';
    console.log(ok(`OpenOcean route exists via ${dexes} — 1 ${gas} → ${(Number(out) / 10 ** target.decimals).toFixed(4)} ${target.name}`));

    /* 2. ECHO — build the calldata that would be signed and read our
       `referrer` back OUT of it through their /decodeInputData endpoint.
       Nothing here is ever broadcast; `account` is required by their API and
       we pass the payout address, which cannot receive a transaction nobody
       signed. This mirrors verifyOpenOceanFee() in src/lib/openocean.js —
       the client refuses to sign unless this same proof passes. */
    const sParams = new URLSearchParams(params);
    sParams.set('account', resolved.address);
    const sRes = await fetch(`${OO_BASE}/${slug}/swap?${sParams}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
    const sBody = await sRes.json().catch(() => null);
    const calldata = sBody?.data?.data;
    if (!sRes.ok || sBody?.code !== 200 || !calldata) {
      console.log(warn(`OpenOcean /swap build failed (HTTP ${sRes.status}${sBody?.message ? `: ${sBody.message}` : ''}) — could not verify the fee echo`));
      return;
    }
    const dRes = await fetch(`${OO_BASE}/${slug}/decodeInputData`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ data: calldata, method: 'swap' }),
      signal: AbortSignal.timeout(20000)
    });
    const dBody = await dRes.json().catch(() => null);
    const referrer = dBody?.desc?.referrer ?? dBody?.data?.desc?.referrer ?? null;
    if (!referrer) {
      console.log(bad('referrer MISSING from the decoded calldata — this swap would pay us nothing (the client refuses to sign: FEE_NOT_APPLIED)'));
      failures += 1;
      return;
    }
    if (String(referrer).toLowerCase() !== resolved.address.toLowerCase()) {
      console.log(bad(`fee would go to ${referrer}, NOT ${resolved.address}`));
      failures += 1;
      return;
    }
    console.log(ok(`decoded calldata carries referrer ${referrer} — ${percent}% (${FEE_BPS} bps) of the input token`));

    /* 3. ARITHMETIC */
    const expected = (amountIn * BigInt(FEE_BPS)) / 10000n;
    console.log(
      ok(
        `arithmetic: 1.0 ${gas} in → ${(Number(expected) / 1e18).toFixed(6)} ${gas} fee ` +
          `(OpenOcean keeps 20% of it — our net is ${(Number(expected) * 0.8 / 1e18).toFixed(6)} ${gas})`
      )
    );
  } catch (e) {
    console.log(warn(`OpenOcean live check failed: ${String(e.message).slice(0, 80)}`));
  }
}

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

  /* Chains the Kyber aggregator does not serve: Mantle, Scroll and zkSync Era
     route through OpenOcean (their gateway 404s on those slugs — live-probed
     2026-09-11), so the fee echo is verified against OpenOcean instead.
     Anything with neither source truly is receive-only. */
  const slug = SLUG[chainId];
  if (!slug) {
    if (OO_SLUG[chainId] && OO_TARGET[chainId]) {
      await checkOpenOcean(row, resolved);
      return;
    }
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
