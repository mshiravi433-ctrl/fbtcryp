#!/usr/bin/env node
/**
 * WHICH SOLANA ROUTES ACTUALLY ANSWER — ASKED LIVE, ONE COMMAND
 * ===========================================================================
 * The screen's route ladder is only as honest as the routes under it, and the
 * 2026-10-24 report («فقط با ژوپیتر می‌رود که کارمزد نمی‌گیریم») was possible
 * because a route can die WITHOUT ERRORING:
 *
 *   • De¹/OpenOcean answers HTTP 200 + `{"code":200,"data":{"message":
 *     "This chain is no longer supported"}}` for every Solana pair;
 *   • LI.FI answers a perfect quote that carries NO `Distributions` entry when
 *     the integrator/fee request is not honoured.
 *
 * Both look like "no liquidity" from the outside, and both are invisible from
 * the browser console. So this script asks the same three server modules the
 * app asks, prints the price AND the fee evidence, and exits non-zero when no
 * FEE-PAYING route could price the pair.
 *
 * Usage:
 *   node scripts/solana-routes-live.mjs
 *   node scripts/solana-routes-live.mjs --in So111…112 --out EPjFW…Dt1v --amount 10000000
 *   node scripts/solana-routes-live.mjs --account <a connected wallet, for the build path>
 *
 * It needs the same env the server needs (SOLANA_FEE_RECIPIENT / SOLANA_FEE_BPS,
 * optional OPENOCEAN_API_KEY, JUP_FEE_ACCOUNT). It never signs and never sends
 * a transaction: every route here is asked for a PRICE.
 */

import { oceanQuote, oceanStatus } from '../server/solanaOcean.js';
import { lifiSolanaStatus, lifiSolanaSwapQuote } from '../server/solanaLifi.js';
import { jupFeeQuote, jupFeeStatusAsync } from '../server/solanaJupFee.js';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inputMint = arg('in', SOL);
const outputMint = arg('out', USDC);
const amount = arg('amount', '10000000'); // 0.01 SOL
const account = arg('account', ''); // omitted ⇒ LI.FI price-only path

const row = (label, value) => `${label.padEnd(18)} ${value}`;

console.log(`\nSolana routes · ${inputMint.slice(0, 6)}… → ${outputMint.slice(0, 6)}… · ${amount} base units`);
console.log(`LI.FI mode: ${account ? `build for ${account.slice(0, 6)}…` : 'price-only (no wallet)'}\n`);

const results = [];

/* ── 1 · De¹/OpenOcean ───────────────────────────────────────────────────── */
{
  const s = oceanStatus();
  const r = await oceanQuote({ inputMint, outputMint, amount, slippageBps: 50 });
  results.push({ route: 'openocean', paid: true, ok: r.ok });
  console.log(row('De¹', r.ok
    ? `✓ out ${r.body.outAmount} · fee ${r.body.feeBps} bps → ${r.body.feeReceiver}`
    : `✗ ${r.body.error}${r.body.detail ? ` (${r.body.detail})` : ''}`));
  console.log(row('  status', `supported=${s.supported} feeReady=${s.feeReady} key=${s.keyConfigured}`));
}

/* ── 2 · LI.FI (fee via distributionFees) ────────────────────────────────── */
{
  const s = lifiSolanaStatus();
  const r = await lifiSolanaSwapQuote({
    inputMint,
    outputMint,
    amount,
    slippageBps: 50,
    ...(account ? { account } : {})
  });
  results.push({ route: 'lifi', paid: true, ok: r.ok });
  console.log(row('LI.FI', r.ok
    ? `✓ out ${r.body.outAmount} · our ${r.body.feeBps} bps · total ${r.body.totalFeeBps} bps · tool ${r.body.tool}`
    : `✗ ${r.body.error}${r.body.detail ? ` (${r.body.detail})` : ''}`));
  console.log(row('  status', `feeReady=${s.feeReady} receiver=${s.feeReceiver} integrator=${s.integrator}`));
  if (r.ok && r.body.priceOnly) {
    console.log(row('  price-only', 'true — the transaction LI.FI built was dropped server-side'));
  }
}

/* ── 3 · Jupiter Swap API with our platform fee ──────────────────────────── */
{
  const s = await jupFeeStatusAsync({ inputMint, outputMint });
  const r = await jupFeeQuote({ inputMint, outputMint, amount, slippageBps: 50 });
  results.push({ route: 'jupfee', paid: true, ok: r.ok });
  console.log(row('Jupiter (fee)', r.ok
    ? `✓ out ${r.body.outAmount} · fee ${r.body.feeBps} bps`
    : `✗ ${r.body.error}${r.body.detail ? ` (${r.body.detail})` : ''}`));
  console.log(row('  status', `configured=${s.configured} feeReady=${s.feeReady} feeMints=${JSON.stringify(s.feeMints ?? [])}`));
}

/* The free route is deliberately NOT asked: it always answers, it earns
   nothing, and asking it here would make a dead fee route look healthy. */
console.log('\n(Jupiter /order — the free fallback — is not probed: it always answers.)');

const paidAlive = results.filter((r) => r.paid && r.ok);
console.log(paidAlive.length
  ? `\n✓ fee-paying routes answering: ${paidAlive.map((r) => r.route).join(', ')}`
  : '\n✗ NO fee-paying Solana route priced this pair — the screen would fall back to the FREE Jupiter route.');

process.exit(paidAlive.length ? 0 : 1);
