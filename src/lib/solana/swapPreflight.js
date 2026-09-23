/**
 * SOLANA SWAP PRE-FLIGHT — the decision that used to be three inline lines.
 * ==========================================================================
 *
 * It lives here, apart from both the reader (chainReads.js) and the screen
 * (pages/SolanaSwap.jsx), because it is the one part of the swap that decides
 * whether a user is told «موجودی کافی نیست» — and a decision like that has to
 * be assertable without a browser, a wallet or a node.
 *
 * ─── THE RULE, AND WHY IT CHANGED ───────────────────────────────────────────
 * Before: an unreadable balance threw BALANCE_UNAVAILABLE and the swap died.
 * That is the «RPC را چک کنید» half of the report, and it was a dead end on
 * exactly the networks where the app is used: the guard existed to save the
 * user a pointless wallet prompt, and instead it became the reason no swap
 * could start at all.
 *
 * Now the two cases are separated, because they are not the same fact:
 *
 *   · KNOWN INSUFFICIENT → block, with the shortfall named. The wallet would
 *     refuse it anyway; saying so here is cheaper and clearer.
 *   · UNREADABLE → proceed, and say out loud that the balance could not be
 *     verified. This is not a loosening of safety: every path this screen can
 *     take simulates before it lands — MWA signs with `skipPreflight: false`,
 *     the injected provider's `signAndSendTransaction` preflights, and
 *     Jupiter's own /execute refuses a transaction that would fail. An
 *     underfunded swap is therefore rejected by the chain with NOTHING SPENT,
 *     while a swap blocked by our own unreadable read never happens at all.
 *     Between «the user cannot trade» and «the chain gets the final word»,
 *     the second is the honest one.
 *
 *   · UNVERIFIED SCALE → do not compare numbers whose units we guessed. A
 *     pasted mint used to be stored as 9 decimals; for a 6-decimal token that
 *     made every amount 1000× too big and every verdict «insufficient». When
 *     the scale is not confirmed by the chain, the amount check is skipped and
 *     left to the aggregator, which reads the mint's real decimals and answers
 *     errorCode 1 — an INSUFFICIENT_BALANCE from the source of truth instead
 *     of one from our arithmetic. The SOL/gas half still runs: SOL's scale is
 *     immutable and never guessed.
 */

import { ATA_RENT_LAMPORTS, BASE_FEE_LAMPORTS } from './chainReads.js';

/**
 * @param {object} p
 * @param {{solLamports:bigint, sourceRaw:bigint, outputAccountExists:boolean,
 *          outputAssumed?:boolean, sourceDecimalsVerified?:boolean}|null} p.balances
 *        what the chain reader returned, or null when nothing could be read.
 * @param {string|null} [p.balanceCode] the NAMED reason the read failed
 *        (RPC_BLOCKED, RPC_RATE_LIMITED, …) — surfaced instead of a generic code.
 * @param {bigint|null} p.rawAmount the input amount in base units
 * @param {boolean} p.amountScaleVerified was that amount converted with a scale
 *        the chain reported? False means a guess, and a guess is not compared.
 * @param {boolean} p.isSolInput is the token being sold SOL itself?
 * @returns {{
 *   ok: boolean,
 *   code: string|null,
 *   notice: string|null,
 *   unverified: string[],
 *   needLamports: bigint|null,
 *   haveLamports: bigint|null,
 *   shortfallLamports: bigint|null,
 *   needRaw: bigint|null,
 *   haveRaw: bigint|null
 * }}
 */
export function solanaSwapPreflight({
  balances = null,
  balanceCode = null,
  rawAmount = null,
  amountScaleVerified = true,
  isSolInput = false
} = {}) {
  const amount = typeof rawAmount === 'bigint' ? rawAmount : null;

  /* ── NOTHING COULD BE READ ────────────────────────────────────────────────
     Proceed, named. `notice` is what the screen renders; `code` stays null
     because nothing here is a refusal. */
  if (!balances) {
    return {
      ok: true,
      code: null,
      notice: balanceCode || 'BALANCE_UNAVAILABLE',
      unverified: ['balance', 'amount', 'gas'],
      needLamports: null,
      haveLamports: null,
      shortfallLamports: null,
      needRaw: null,
      haveRaw: null
    };
  }

  const sol = typeof balances.solLamports === 'bigint' ? balances.solLamports : 0n;
  const source = typeof balances.sourceRaw === 'bigint' ? balances.sourceRaw : 0n;
  const unverified = [];

  /* ── THE AMOUNT, ONLY WHEN ITS SCALE IS KNOWN ───────────────────────────── */
  if (amount != null && amountScaleVerified && source < amount) {
    return {
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      notice: null,
      unverified,
      needLamports: null,
      haveLamports: null,
      shortfallLamports: null,
      needRaw: amount,
      haveRaw: source
    };
  }
  if (amount != null && !amountScaleVerified) unverified.push('amount');

  /* ── SOL FOR THE FEE, AND FOR THE OUTPUT ACCOUNT IF IT MUST BE CREATED ────
     `outputAssumed` means the reader skipped the question because the SOL
     balance already covered the worst case, so treating it as «exists» cannot
     produce a wrong verdict — that is the whole point of skipping it. */
  const creatingOutput = balances.outputAccountExists === false && balances.outputAssumed !== true;
  let need = BASE_FEE_LAMPORTS + (creatingOutput ? ATA_RENT_LAMPORTS : 0n);
  if (isSolInput && amount != null) {
    if (amountScaleVerified) need += amount;
    else unverified.push('gasAmount');
  }

  if (sol < need) {
    return {
      ok: false,
      code: 'INSUFFICIENT_GAS',
      notice: null,
      unverified,
      needLamports: need,
      haveLamports: sol,
      shortfallLamports: need - sol,
      needRaw: null,
      haveRaw: null
    };
  }

  return {
    ok: true,
    code: null,
    notice: null,
    unverified,
    needLamports: need,
    haveLamports: sol,
    shortfallLamports: null,
    needRaw: null,
    haveRaw: null
  };
}

/** Lamports → SOL, as a fixed-precision string, for a sentence a user reads. */
export function lamportsToSol(lamports) {
  const n = typeof lamports === 'bigint' ? lamports : 0n;
  const whole = n / 1_000_000_000n;
  const frac = (n % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
