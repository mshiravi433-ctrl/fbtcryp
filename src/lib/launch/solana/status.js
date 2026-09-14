/**
 * SOLANA LAUNCH — the honesty gate.
 * ============================================================================
 *
 * Solana is a DIFFERENT workstream: creating a token there is not a contract
 * deployment, the wallet stack is different (injected provider / Wallet
 * Standard / Mobile Wallet Adapter), and the pool side is a third-party
 * program (Raydium LaunchLab) rather than a factory we call with
 * Uniswap-shaped bytes.
 *
 * ── THE RULE THIS FILE EXISTS TO ENFORCE ───────────────────────────────────
 * A signing path that is not finished AND tested does not ship. For a long
 * time that rule kept this workstream on COMING_SOON: the wallet signing
 * path, the pool flow and live-cluster verification were all unfinished, and
 * `shipping` stayed false.
 *
 * As of 2026-09-14 all three are finished, and "tested" means the same three
 * things it means on the EVM side:
 *
 *   1. OFFLINE BYTE PROOFS (test/launch-solana-probe.mjs, no network): the
 *      config PDA derived here reproduces Raydium's API-published address;
 *      discriminators are recomputed from sha256("global:<name>"); every
 *      instruction's bytes are decoded BY HAND against the pinned SDK
 *      layouts; the curve math is asserted against known answers; and the
 *      two-signer assembly (mint keypair + wallet) is proven with generated
 *      keypairs, signatures verified.
 *   2. A PRE-SIGNATURE SIMULATION GATE (src/lib/launch/solana/signing.js):
 *      every transaction is simulated on the USER's cluster before any wallet
 *      prompt opens — the exact equivalent of the EVM estimateGas gate. A
 *      reverting transaction costs the user nothing and names its reason.
 *   3. LIVE-CLUSTER VERIFICATION (src/lib/launch/solana/verify.js): after
 *      confirmation the pool, mint, vaults and metadata accounts are read
 *      back and reconciled with the plan before the launch is called LIVE.
 *
 * The wallet half of signing (provider.signTransaction on the partially
 * signed transaction) is the same provider call the Solana swap path already
 * uses in production — no new wallet primitive was invented for launches.
 *
 * Nothing here imports @solana/web3.js: this module is tiny, ships with the
 * page, and must not pull a 19 MB library into the entry chunk (the same rule
 * src/lib/solanaWallet.js follows with dynamic imports).
 */

export const SOLANA_STATUS = 'READY';

/**
 * What is DONE and TESTED in this repository right now:
 *
 *   ✓ the capability model — fixed supply, no freeze authority, mint
 *     authority revoked at creation: LaunchLab's own fixed rules, disclosed
 *     as read-only facts (there is nothing to toggle)
 *   ✓ the LaunchLab plan — initialize_v2 (+ the optional first-buy legs),
 *     with addresses derived, config bounds checked, and bytes asserted
 *     through an INDEPENDENT hand decoder
 *   ✓ the wallet signing path — mint-keypair partial signing plus the
 *     user's wallet through the production swap-path provider calls, with a
 *     simulation gate before every signature and sequential execution
 *     (the buy is only built after the create confirms)
 *   ✓ the Raydium pool flow — the official SDK interface pinned and
 *     reviewed (see the pin list in ./launchlab.js); the adapter still
 *     refuses with named errors whenever a live input is missing
 *   ✓ post-signature verification against a live cluster (pool state,
 *     mint state, vault reconciliation, metadata back-check)
 */
export const SOLANA_PARTS = Object.freeze([
  {
    id: 'capability-model',
    status: 'READY',
    detail: 'Fixed supply, no freeze authority, mint authority revoked at creation — LaunchLab’s fixed rules, shown as read-only facts and re-verified on-chain after confirmation.'
  },
  {
    id: 'launchlab-plan',
    status: 'READY',
    detail: 'The initialize_v2 plan (+ optional first buy) is built from pinned layouts; addresses are derived, config bounds are checked, and the bytes are asserted by an independent hand decoder.'
  },
  {
    id: 'wallet-signing',
    status: 'READY',
    detail: 'Mint-keypair partial signing plus the user’s wallet through the production swap-path provider calls. Every transaction is simulated on the user’s cluster before any prompt; legs run sequentially.'
  },
  {
    id: 'raydium-pool',
    status: 'READY',
    detail: 'The official SDK interface is pinned and reviewed. The adapter still refuses with named errors whenever a live input is missing or out of bounds.'
  },
  {
    id: 'on-chain-verification',
    status: 'READY',
    detail: 'After confirmation the pool, mint, vaults and metadata are read back and reconciled with the plan before the launch is reported live.'
  }
]);

/** The object the UI renders. `shipping:true` offers the flow. */
export function solanaLaunchStatus() {
  const pending = SOLANA_PARTS.filter((p) => p.status !== 'READY').map((p) => p.id);
  return {
    chain: 'solana',
    status: SOLANA_STATUS,
    badge: SOLANA_STATUS,
    shipping: pending.length === 0,
    parts: SOLANA_PARTS.map((p) => ({ ...p })),
    pending,
    statement: pending.length
      ? `Solana token launching is not shipped yet: ${pending.join(', ')}. No Solana transaction is requested from your wallet until all of it is finished and tested.`
      : 'Solana token launching is shipped: Raydium LaunchLab bonding-curve launches with pre-signature simulation and post-confirmation verification.'
  };
}

/** True only when NOTHING is pending — the UI may then offer the flow. */
export function solanaLaunchEnabled() {
  return solanaLaunchStatus().pending.length === 0;
}
