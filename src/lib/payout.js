/**
 * REVENUE / PAYOUT ROUTING
 * ---------------------------------------------------------------------------
 * The platform fee used to be a single EVM address, which quietly assumed
 * every swap happens on BNB Chain. It doesn't: the app quotes on nine EVM
 * chains and on Solana too. This module is the one
 * place that answers "where does the fee for THIS chain go?".
 *
 * Two rules, both deliberate:
 *
 *   1. PER-CHAIN FIRST. A fee taken on Polygon is paid to the Polygon address,
 *      on Ethereum to the Ethereum address, and so on. Sending a fee to an
 *      address on the wrong network is how funds get lost forever — an EVM
 *      address is meaningless to Tron's VM and vice versa.
 *
 *   2. FALLBACK CHAIN. If a chain has no address configured (or the configured
 *      one is malformed), we walk down an ordered list of the remaining
 *      addresses that are valid **for that same address family** and use the
 *      first one that works. This is the "اگر اون حساب نداشت از حساب بعدی
 *      بردارد" behaviour — but it never crosses address families, because a
 *      cross-family fallback is a burn, not a payment.
 *
 * Everything here is a PUBLIC receiving address. There are no keys in this
 * file and there must never be.
 */

/** Address families we can validate. */
export const FAMILY = {
  EVM: 'evm',
  SOLANA: 'solana',
  TRON: 'tron'
};

const RE = {
  [FAMILY.EVM]: /^0x[a-fA-F0-9]{40}$/,
  // base58, no 0/O/I/l — Solana pubkeys are 32-44 chars
  [FAMILY.SOLANA]: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  [FAMILY.TRON]: /^T[1-9A-HJ-NP-Za-km-z]{33}$/
};

export const isValidFor = (family, addr) => Boolean(addr) && RE[family]?.test(String(addr).trim());

const env = (k) => (typeof import.meta !== 'undefined' && import.meta.env?.[k]) || '';

/**
 * The operator's receiving addresses.
 *
 * Each can be overridden at build time so a fork doesn't have to edit source.
 * Defaults are FBT's own published addresses.
 */
export const PAYOUT_ADDRESSES = {
  evm: env('VITE_PAYOUT_EVM') || '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6',
  /*
   * Owner's Solana address. Updated 2026-08 to a self-custodial wallet.
   *
   * ─── WHY IT CHANGED ─────────────────────────────────────────────────────
   * The previous address (9Z4wtios…) was replaced because collecting Jupiter
   * referral fees requires SIGNING an on-chain transaction to create the
   * referral account and its token accounts. That is only possible from a
   * wallet whose seed phrase the owner holds. An address you can receive to
   * but not sign from is fine for plain transfers and useless for this.
   *
   * ─── VERIFIED, NOT TRUSTED ──────────────────────────────────────────────
   * Base58-decoded before committing: exactly 32 bytes, which is what makes
   * it a real ed25519 public key. A transposed character usually still passes
   * the loose 32-44 character regex below but decodes to the wrong length —
   * and a payout to a non-existent address is unrecoverable, so the byte
   * count is the check that actually matters.
   */
  solana: env('VITE_PAYOUT_SOLANA') || 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4',
  tron: env('VITE_PAYOUT_TRON') || 'TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ'
};

/**
 * Per-chain overrides. Empty by default: every EVM chain uses the same EVM
 * address, which is correct because the same private key controls it on all of
 * them. Set one here if you ever want, say, Polygon revenue in a separate
 * wallet.
 */
export const CHAIN_PAYOUT = {
  1: env('VITE_PAYOUT_ETHEREUM') || '',
  56: env('VITE_PAYOUT_BSC') || '',
  137: env('VITE_PAYOUT_POLYGON') || '',
  42161: env('VITE_PAYOUT_ARBITRUM') || '',
  8453: env('VITE_PAYOUT_BASE') || '',
  10: env('VITE_PAYOUT_OPTIMISM') || '',
  43114: env('VITE_PAYOUT_AVALANCHE') || ''
};

/**
 * Ordered fallback pool per family. First valid entry wins.
 * For EVM the per-chain override is tried first, then the shared EVM address.
 */
function fallbackPool(family, chainId) {
  if (family === FAMILY.EVM) {
    return [
      CHAIN_PAYOUT[chainId],
      PAYOUT_ADDRESSES.evm,
      // Last resorts: any other configured EVM override, so a misconfigured
      // chain still pays somewhere we control rather than reverting the swap.
      ...Object.values(CHAIN_PAYOUT)
    ];
  }
  if (family === FAMILY.SOLANA) return [PAYOUT_ADDRESSES.solana];
  if (family === FAMILY.TRON) return [PAYOUT_ADDRESSES.tron];
  return [];
}

/**
 * Resolve the fee recipient for a chain.
 * @returns {{address: string, family: string, fallback: boolean} | null}
 */
export function resolvePayout(chainId, family = FAMILY.EVM) {
  const pool = fallbackPool(family, chainId);

  // An UNSET per-chain override is the normal, intended configuration — the
  // same key controls the same EVM address on every chain. Only report
  // "fallback" when a preferred address was actually configured and had to be
  // skipped, which is a real misconfiguration worth surfacing.
  const preferred = String(pool[0] || '').trim();
  const preferredWasSet = preferred.length > 0;

  for (let i = 0; i < pool.length; i += 1) {
    const candidate = String(pool[i] || '').trim();
    if (isValidFor(family, candidate)) {
      return {
        address: candidate,
        family,
        fallback: preferredWasSet && candidate !== preferred
      };
    }
  }
  return null;
}

/** Convenience: just the address, or null when nothing is configured. */
export const payoutAddress = (chainId, family = FAMILY.EVM) => resolvePayout(chainId, family)?.address ?? null;

/**
 * Everything the UI needs to display "where fees go", including the non-EVM
 * networks we accept value on but don't swap on yet.
 *
 * `gas` explains, per network, which coin pays the network fee — the question
 * behind "it can't only be BNB". Gas is always paid in the chain's own native
 * coin by the user's wallet; it never comes out of our fee, and it is never
 * payable in some other token. Saying so plainly saves a lot of support.
 */
export const PAYOUT_DIRECTORY = [
  { id: 'bsc', chainId: 56, family: FAMILY.EVM, label: 'BNB Smart Chain', gas: 'BNB', color: '#f0b90b' },
  { id: 'ethereum', chainId: 1, family: FAMILY.EVM, label: 'Ethereum (ETH / USDT ERC-20)', gas: 'ETH', color: '#627eea' },
  { id: 'polygon', chainId: 137, family: FAMILY.EVM, label: 'Polygon', gas: 'POL', color: '#8247e5' },
  { id: 'arbitrum', chainId: 42161, family: FAMILY.EVM, label: 'Arbitrum One', gas: 'ETH', color: '#28a0f0' },
  { id: 'base', chainId: 8453, family: FAMILY.EVM, label: 'Base', gas: 'ETH', color: '#0052ff' },
  { id: 'optimism', chainId: 10, family: FAMILY.EVM, label: 'Optimism', gas: 'ETH', color: '#ff0420' },
  { id: 'avalanche', chainId: 43114, family: FAMILY.EVM, label: 'Avalanche C-Chain', gas: 'AVAX', color: '#e84142' },
  { id: 'linea', chainId: 59144, family: FAMILY.EVM, label: 'Linea', gas: 'ETH', color: '#61dfff' },
  { id: 'sonic', chainId: 146, family: FAMILY.EVM, label: 'Sonic', gas: 'S', color: '#fe9a4d' },
  { id: 'solana', chainId: null, family: FAMILY.SOLANA, label: 'Solana', gas: 'SOL', color: '#14f195' },
  { id: 'tron', chainId: null, family: FAMILY.TRON, label: 'Tron (TRX / USDT TRC-20)', gas: 'TRX', color: '#ff060a' }
];

/** Directory rows resolved to concrete addresses, for the Audit/About screens. */
export function payoutTable() {
  return PAYOUT_DIRECTORY.map((row) => {
    const r = resolvePayout(row.chainId, row.family);
    return { ...row, address: r?.address ?? null, fallback: Boolean(r?.fallback) };
  });
}
