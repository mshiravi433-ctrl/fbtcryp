/**
 * EXECUTION SOURCES — the one table that answers, per chain:
 *
 *   who QUOTES, who EXECUTES, who CARRIES OUR FEE, and who runs on which leash.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * That knowledge used to live in five places at once: `KYBER_LIVE` in
 * aggregator.js, `OO_SLUG` in openocean.js, `LIFI_SWAP_CHAINS` in lifi.js,
 * `SUPPORTED` in velora.js, and the leash wiring inline in swap.js's getQuote.
 * Each file was individually correct; the PICTURE — "on chain X, if the
 * primary dies, who is left and can they still carry our 0.70%?" — existed
 * nowhere. That is exactly the question a revenue outage asks, and it had to
 * be answered by re-reading five files.
 *
 * This module does not duplicate those sets — it IMPORTS the live predicates
 * and composes them, so it can never drift from what the swap engine actually
 * consults. It is load-bearing, not documentation: getQuote builds its source
 * list from `executionPlanFor`, and the outage probe in
 * test/execution-sources-probe.mjs fails if the picture regresses.
 *
 * ─── THE LEASH POLICY (why `shortLeash` is a thing) ─────────────────────────
 * Sources run CONCURRENTLY and the best EXECUTABLE quote wins (bestQuote.js).
 * A second opinion must never slow the quote down, so OpenOcean runs on a 3s
 * leash whenever KyberSwap is live on the chain. The failure mode that
 * produces: Kyber down + OpenOcean merely slow (>3s) = "no route", even
 * though a perfectly good fee-carrying executor exists. The fix is NOT a
 * longer default leash (that taxes every quote); it is DYNAMIC PROMOTION —
 * when the first round produces no winner, the short-leashed executor is
 * re-asked once with a primary-grade leash. swap.js owns that retry; this
 * table tells it who is eligible.
 *
 * ─── FEE DISCIPLINE ─────────────────────────────────────────────────────────
 * Every source listed here as `feeCarrying` charges the platform fee inside
 * the SAME transaction as the swap, and the executor paths verify it before
 * signing (Kyber's fee echo, OpenOcean's decoded referrer, LI.FI's signed
 * fee split). A source that cannot carry the fee is never added here as an
 * executor — swapping through it would be routing around our own revenue.
 */

import { EVM_CHAINS, EVM_CHAIN_ORDER } from './chains.js';
import { aggregatorSupports } from './aggregator.js';
import { openOceanSupports, OO_TIMEOUT_MS } from './openocean.js';
import { veloraSupports } from './velora.js';
import { lifiSupports, LIFI_TIMEOUT_MS } from './lifi.js';

/** Primary-grade timeout: what a SOLE source is allowed to take. */
export const PRIMARY_LEASH_MS = 12000;

/** Second-opinion timeout: OpenOcean's own default while Kyber is live. */
export const SECONDARY_LEASH_MS = OO_TIMEOUT_MS; /* 3000, single-sourced */

/** LI.FI's own budget — mirrored, not re-decided here. */
export const LIFI_LEASH_MS = LIFI_TIMEOUT_MS;

/*
 * Source profiles. `quotes` is the live predicate from each adapter, so this
 * table cannot disagree with the adapters without a test noticing.
 *
 *   executes     can this quote become the signed transaction?
 *   feeCarrying  does signing it pay the platform fee in the same tx?
 *
 * Velora is fee-carrying for QUOTES (partnerFeeBps) but deliberately
 * quote-only: it has no hardened signing path, and bestQuote.js never lets a
 * non-executable quote near the signer.
 */
const PROFILE = {
  kyberswap: {
    quotes: aggregatorSupports,
    executes: true,
    feeCarrying: true,
    feeMechanism: 'feeReceiver + feeAmount split inside the aggregator router tx (verified via fee echo before signing)',
    role: 'aggregator — primary wherever its gateway serves the chain'
  },
  openocean: {
    quotes: openOceanSupports,
    executes: true,
    feeCarrying: true,
    feeMechanism: 'referrer + referrerFee (percent; provider keeps 20%) — decoded from the swap calldata before signing',
    role: 'aggregator — sole source on the chains Kyber dropped; short-leashed second opinion elsewhere'
  },
  lifi: {
    quotes: lifiSupports,
    executes: true,
    feeCarrying: true,
    feeMechanism: 'integrator fee attached server-side (LIFI_FEE_READY gate) and re-verified in the signed request',
    role: 'bridge+swap — primary on Mantle/Scroll/zkSync Era, second opinion on Monad/Robinhood',
    needsFromAddress: true
  },
  velora: {
    quotes: veloraSupports,
    executes: false,
    feeCarrying: true,
    feeMechanism: 'partnerFeeBps (quote-only — reported as a beaten-by price, never signed)',
    role: 'third opinion — price transparency, not execution'
  }
};

/**
 * The execution plan for one chain.
 *
 * @param {number} chainId
 * @param {{fromAddress?: string|null}} [opts] LI.FI needs the user's address
 *        for its fee-collection step; without it the source is not live.
 * @returns {{
 *   chainId: number,
 *   chain: string,
 *   sources: Record<string, {id:string, quotes:boolean, executes:boolean,
 *     feeCarrying:boolean, feeMechanism:string, role:string, leashMs:number,
 *     shortLeash:boolean, needsFromAddress:boolean}>,
 *   feeExecutors: string[],        fee-carrying EXECUTABLE source ids
 *   redundancy: number,            how many independent ways a swap on this
 *                                  chain can execute AND pay us
 *   singlePointOfFailure: boolean, redundancy === 1 — adding a chain with
 *                                  this flag deserves a second source first
 *   primaryId: string|null         long-leash preference, informational
 * }}
 */
export function executionPlanFor(chainId, { fromAddress = null } = {}) {
  const id = Number(chainId);
  const sources = {};

  for (const [sid, profile] of Object.entries(PROFILE)) {
    let live = profile.quotes(id);
    if (profile.needsFromAddress && !fromAddress) live = false;
    if (!live) continue;

    /* The leash follows the wiring in swap.js, stated here so it is readable
       in one place: OpenOcean is short-leashed exactly when Kyber is live on
       the chain; a sole or Kyber-less OpenOcean runs primary-grade; LI.FI
       always runs its own budget. */
    const shortLeash = sid === 'openocean' && aggregatorSupports(id);
    const leashMs = sid === 'lifi' ? LIFI_LEASH_MS : shortLeash ? SECONDARY_LEASH_MS : PRIMARY_LEASH_MS;

    sources[sid] = {
      id: sid,
      quotes: true,
      executes: profile.executes,
      feeCarrying: profile.feeCarrying,
      feeMechanism: profile.feeMechanism,
      role: profile.role,
      leashMs,
      shortLeash,
      needsFromAddress: Boolean(profile.needsFromAddress)
    };
  }

  const feeExecutors = Object.values(sources)
    .filter((s) => s.executes && s.feeCarrying)
    .map((s) => s.id);

  return {
    chainId: id,
    chain: EVM_CHAINS[id]?.name ?? `chain ${id}`,
    sources,
    feeExecutors,
    redundancy: feeExecutors.length,
    singlePointOfFailure: feeExecutors.length === 1,
    primaryId: aggregatorSupports(id)
      ? 'kyberswap'
      : sources.openocean
        ? 'openocean'
        : sources.lifi
          ? 'lifi'
          : null
  };
}

/** Chains in the app's registry with NO fee-carrying executor at all. */
export function chainsWithoutFeeExecutor(opts = {}) {
  return EVM_CHAIN_ORDER.filter((id) => executionPlanFor(id, opts).feeExecutors.length === 0);
}

/** Chains with exactly ONE fee-carrying executor — one outage from dead. */
export function singleExecutorChains(opts = {}) {
  return EVM_CHAIN_ORDER.filter((id) => executionPlanFor(id, opts).singlePointOfFailure);
}

/**
 * Human/ops view: one row per chain, for dashboards and review. Cheap to
 * compute, no network.
 */
export function chainCoverageReport(opts = {}) {
  return EVM_CHAIN_ORDER.map((id) => {
    const plan = executionPlanFor(id, opts);
    return {
      chainId: id,
      chain: plan.chain,
      primary: plan.primaryId,
      feeExecutors: plan.feeExecutors,
      redundancy: plan.redundancy,
      singlePointOfFailure: plan.singlePointOfFailure
    };
  });
}
