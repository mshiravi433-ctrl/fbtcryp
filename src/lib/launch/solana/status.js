/**
 * SOLANA LAUNCH — the honesty gate.
 * ============================================================================
 *
 * Solana is a DIFFERENT workstream: creating a token there is not a contract
 * deployment, the wallet stack is different (Web3 provider / Wallet-Standard
 * mobile / Mobile Wallet Adapter), and the pool side is a third-party program
 * (Raydium) rather than a factory we can call with Uniswap-shaped bytes.
 *
 * ── THE RULE THIS FILE EXISTS TO ENFORCE ───────────────────────────────────
 * A signing path that is not finished AND tested does not ship. Not behind a
 * flag for power users, not "beta": if the bytes cannot be proven, the UI
 * shows COMING_SOON and the user is told what is missing. The EVM launchpad
 * (direct deploy + the 7 verified DEX chains) does not depend on any of this.
 *
 * The status below is the SINGLE source the UI reads, so the badge and the
 * explanation under it can never disagree — and each pending part names the
 * concrete thing that is missing rather than a vague "in progress".
 *
 * Nothing here imports @solana/web3.js: this module is tiny, ships with the
 * page, and must not pull a 19 MB library into the entry chunk (the same rule
 * src/lib/solanaWallet.js follows with dynamic imports).
 */

export const SOLANA_STATUS = 'COMING_SOON';

/**
 * What is DONE and TESTED in this repository right now
 * (`test/launch-solana-probe.mjs`, mock provider only — no mainnet calls):
 *
 *   ✓ the capability model — the same "decide once, then it is locked"
 *     semantics as the EVM bitmap, expressed in Solana's own terms
 *     (mint authority, freeze authority, revoke-on-create)
 *   ✓ the SPL token plan — SystemProgram.createAccount, InitializeMint,
 *     associated token account, MintTo, and the optional SetAuthority, with
 *     the account list and instruction data asserted through an INDEPENDENT
 *     decoder (never against our own encoder)
 *
 * What is NOT done, and therefore NOT shipped:
 *
 *   ✗ the wallet signing path — partial-signing a transaction with the
 *     ephemeral mint keypair AND the user's wallet (Wallet-Standard mobile /
 *     Mobile Wallet Adapter) is still unbuilt here
 *   ✗ the Raydium pool flow — pool creation/fee-account instructions need the
 *     OFFICIAL IDL pinned and reviewed; the adapter refuses to emit guessed
 *     bytes in the meantime
 *   ✗ post-signature verification against a live cluster (mint account state,
 *     metadata, pool back-check that mintA/mintB are the two tokens)
 *
 * Until all three are done and proven, `shipping` stays false and the UI keeps
 * the COMING_SOON badge. This is a product decision, not a technical debt note.
 */
export const SOLANA_PARTS = Object.freeze([
  {
    id: 'capability-model',
    status: 'READY',
    detail: 'Token decisions (mint authority, freeze authority, revoke-on-create) map the same capability semantics as the EVM token, and are tested.'
  },
  {
    id: 'spl-token-plan',
    status: 'READY',
    detail: 'The SPL instruction plan (mint account, InitializeMint, associated token account, MintTo, and the optional SetAuthority revoke) is built and its accounts/data are asserted by an independent decoder, against a mock provider.'
  },
  {
    id: 'wallet-signing',
    status: 'PENDING',
    detail: 'Partial signing with the ephemeral mint keypair plus the user\'s wallet is not finished or tested, so no Solana transaction is ever requested.'
  },
  {
    id: 'raydium-pool',
    status: 'PENDING',
    detail: 'Raydium pool creation needs the official IDL pinned and reviewed. The adapter refuses to build bytes from anything else.'
  },
  {
    id: 'on-chain-verification',
    status: 'PENDING',
    detail: 'Live-cluster verification (mint account, metadata, and a pool back-check that mintA/mintB are the two tokens) is not implemented. Tests use a mock provider only.'
  }
]);

/** The object the UI renders. `shipping:false` is what keeps the badge. */
export function solanaLaunchStatus() {
  const pending = SOLANA_PARTS.filter((p) => p.status !== 'READY').map((p) => p.id);
  return {
    chain: 'solana',
    status: SOLANA_STATUS,
    badge: SOLANA_STATUS,
    shipping: false,
    parts: SOLANA_PARTS.map((p) => ({ ...p })),
    pending,
    statement: pending.length
      ? `Solana token launching is not shipped yet: ${pending.join(', ')}. No Solana transaction is requested from your wallet until all of it is finished and tested.`
      : 'Solana token launching is shipped.'
  };
}

/** True only when NOTHING is pending — the UI may then offer the flow. */
export function solanaLaunchEnabled() {
  return solanaLaunchStatus().pending.length === 0;
}
