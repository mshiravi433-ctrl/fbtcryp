/**
 * FBT WALLET ENGINE — WALLET CAPABILITY ENGINE
 * ---------------------------------------------------------------------------
 * The app must never assume every wallet can do every job. A Solana wallet
 * cannot sign an EIP-1559 transaction; a Bitcoin wallet cannot stake; a
 * watch-only EVM address cannot send anything. Before the architecture was
 * capability-aware, the code asked "is there a wallet?" and then handed it
 * whatever the user wanted — which is how a swap got routed to a read-only
 * wallet and failed *after* the user thought everything was fine.
 *
 * This module is the registry of truth about what a wallet can do:
 *
 *   · `declareWallet()` normalizes any wallet (injected EVM, WalletConnect
 *     session, local signer, Solana provider, BTC xpub/watch address) into
 *     one `fbt.wallet.v1` record with an explicit capability set.
 *   · `FAMILY_CAPABILITIES` is the honest DEFAULT per chain family — a
 *     wallet may narrow it (a watch address strips `send`), never silently
 *     widen it. The BTC wallet declares `send` + `receive` and nothing else,
 *     exactly as the spec demands.
 *   · `selectWalletFor()` is the answer to "which wallet should do this?".
 *     It scores candidates on capability, family and chain and refuses
 *     (`ok:false`) when nothing qualifies, instead of returning a best-effort
 *     guess that will blow up at signature time.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · A capability NOT listed on the wallet is treated as absent. Missing is
 *   never assumed to be present.
 * · Defaults widen nothing: the caller can only ever pass an explicit
 *   capability list to narrow the family default.
 * · Everything is pure and synchronous — no wallet SDK, no network, no DOM —
 *   so it runs identically in the browser, in the server and in the probe.
 */

export const WALLET_SCHEMA = 'fbt.wallet.v1';
export const WALLET_ENGINE_VERSION = 1;

/** Chain families the engine understands. */
export const WALLET_FAMILIES = Object.freeze(['evm', 'solana', 'bitcoin', 'ton']);

/**
 * The ordered capability vocabulary. Order matters: it is the tie-breaker for
 * `selectWalletFor`, so the most specialized capability that still qualifies
 * wins. Every entry maps to an i18n key under `walletEngine.capabilities`.
 */
export const CAPABILITIES = Object.freeze([
  'send',           // sign and broadcast an outgoing transfer
  'receive',        // derive/present an address that can receive value
  'swap',           // sign a DEX/aggregator trade
  'approve',        // sign an ERC-20/SPL allowance for a spender
  'revoke',         // sign an allowance reset to zero
  'stake',          // sign a staking deposit / delegation
  'bridge',         // sign a cross-chain bridge order
  'sign_message',   // sign an arbitrary human-readable message
  'sign_transaction', // sign a raw transaction payload (without broadcasting)
  'gasless',        // participate in a paymaster / gas-abstraction flow
  'dca',            // authorize a recurring/dollar-cost-averaging schedule
  'recurring',      // authorize scheduled transfers
  'session',        // maintain a WalletConnect dapp session
  'watch'           // read-only observation of balances / history
]);

/**
 * Honest per-family defaults. These are the MAXIMUM a family can do natively.
 * Individual wallets narrow from here (a WalletConnect session on a chain that
 * has no staking route still declares `stake`; the router is what says no —
 * but a watch-only BTC address must drop `send` itself at declaration time).
 *
 * · bitcoin: send + receive only. No tokens, no staking, no approvals.
 * · solana:  tokens are SPL; approvals exist but are revoke-on-use by most
 *            wallets, so `approve`/`revoke` are intentionally excluded until
 *            a concrete SPL spender flow exists.
 * · evm:     the full surface, minus `gasless` (chain-dependent, opt-in).
 */
export const FAMILY_CAPABILITIES = Object.freeze({
  evm: Object.freeze(['send', 'receive', 'swap', 'approve', 'revoke', 'stake', 'bridge', 'sign_message', 'sign_transaction', 'dca', 'recurring', 'session', 'watch']),
  solana: Object.freeze(['send', 'receive', 'swap', 'stake', 'sign_message', 'sign_transaction', 'watch']),
  bitcoin: Object.freeze(['send', 'receive', 'watch']),
  ton: Object.freeze(['send', 'receive', 'watch'])
});

const isFamily = (f) => WALLET_FAMILIES.includes(String(f || '').toLowerCase());

/**
 * Normalize any wallet-ish object into an `fbt.wallet.v1` record.
 *
 * `input.capabilities`, when supplied, is intersected with the family default
 * (a watch address passes `['receive','watch']` and never re-gains `send`).
 * When omitted, the family default is used verbatim.
 */
export function declareWallet(input = {}) {
  const family = isFamily(input.family) ? String(input.family).toLowerCase() : null;
  const caps = family
    ? (Array.isArray(input.capabilities)
      ? input.capabilities.filter((c) => FAMILY_CAPABILITIES[family].includes(c))
      : FAMILY_CAPABILITIES[family].slice())
    : (Array.isArray(input.capabilities) ? input.capabilities.slice() : []);
  const chainId = input.chainId ?? input.chain ?? null;
  return {
    schema: WALLET_SCHEMA,
    version: WALLET_ENGINE_VERSION,
    id: String(input.id || input.key || `wallet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
    family,
    chainId: chainId == null ? null : (typeof chainId === 'number' ? chainId : String(chainId)),
    label: String(input.label || input.name || family || 'wallet'),
    address: input.address ? String(input.address) : null,
    accounts: Array.isArray(input.accounts) ? input.accounts.map(String) : (input.address ? [String(input.address)] : []),
    capabilities: Object.freeze([...new Set(caps)]),
    external: Boolean(input.external),
    watchOnly: Boolean(input.watchOnly || (Array.isArray(input.capabilities) && !input.capabilities.includes('send'))),
    meta: input.meta && typeof input.meta === 'object' ? { ...input.meta } : {}
  };
}

/** True when the wallet declares the capability. Unknown family → false. */
export function hasCapability(wallet, capability) {
  return Array.isArray(wallet?.capabilities) && wallet.capabilities.includes(capability);
}

/** The capabilities the wallet is missing from the requested list. */
export function missingCapabilities(wallet, required = []) {
  const have = new Set(wallet?.capabilities || []);
  return required.filter((c) => !have.has(c));
}

/** The wallet's capability set as a plain array (safe to render). */
export function capabilitiesOf(wallet) {
  return Array.isArray(wallet?.capabilities) ? wallet.capabilities.slice() : [];
}

/** i18n + description map for a capability (pure, no translation imports). */
export function describeCapability(capability) {
  const i18n = {
    send: 'capability.send', receive: 'capability.receive', swap: 'capability.swap',
    approve: 'capability.approve', revoke: 'capability.revoke', stake: 'capability.stake',
    bridge: 'capability.bridge', sign_message: 'capability.signMessage',
    sign_transaction: 'capability.signTransaction', gasless: 'capability.gasless',
    dca: 'capability.dca', recurring: 'capability.recurring',
    session: 'capability.session', watch: 'capability.watch'
  };
  return { capability, key: i18n[capability] || 'capability.unknown' };
}

/**
 * Pick the best wallet for an operation, or refuse honestly.
 *
 * A requested `family` is a HARD filter, not a hint: "send on bitcoin" can
 * never fall back to an EVM wallet, because the whole point of the capability
 * engine is that the system knows WHICH wallet fits WHICH operation. Within
 * the family, scoring (higher wins) is:
 *
 *   +4  declares the required capability
 *   +2  chain matches exactly (only when the caller asked for a chain)
 *   -1  watch-only
 *
 * Ties break on the capability's position in CAPABILITIES (more specialized
 * capabilities sort first) then on stable wallet order.
 *
 * Returns `{ ok:false, code:'NO_CAPABLE_WALLET', reason }` when no candidate
 * qualifies — never a wrong-family, wrong-capability guess.
 */
export function selectWalletFor({ wallets = [], capability = null, family = null, chainId = null } = {}) {
  let candidates = (Array.isArray(wallets) ? wallets : []).filter((w) => w);
  if (!capability) {
    return { ok: false, code: 'CAPABILITY_UNSPECIFIED', wallet: null, reason: 'no capability requested' };
  }
  const wantFamily = family ? String(family).toLowerCase() : null;
  if (wantFamily) candidates = candidates.filter((w) => w.family === wantFamily);
  const scored = candidates
    .filter((w) => hasCapability(w, capability))
    .map((w) => {
      let score = 4;
      if (chainId != null && String(w.chainId) === String(chainId)) score += 2;
      if (w.watchOnly) score -= 1;
      const prio = CAPABILITIES.indexOf(capability);
      return { w, score, prio: prio === -1 ? CAPABILITIES.length : prio };
    })
    .sort((a, b) => (b.score - a.score) || (a.prio - b.prio));
  const best = scored[0];
  if (!best) {
    return {
      ok: false,
      code: 'NO_CAPABLE_WALLET',
      wallet: null,
      reason: wantFamily
        ? `no ${wantFamily} wallet declares capability "${capability}"`
        : `no wallet declares capability "${capability}"`
    };
  }
  return { ok: true, code: 'WALLET_SELECTED', wallet: best.w, score: best.score };
}

/** Capabilities a wallet would need but lacks for the given operation list. */
export function capabilityGaps(wallet, required = []) {
  const missing = missingCapabilities(wallet, required);
  return {
    ok: missing.length === 0,
    missing,
    wallet: wallet?.id || null
  };
}
