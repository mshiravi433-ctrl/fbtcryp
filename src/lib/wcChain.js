/**
 * WALLETCONNECT CHAIN-ID RESOLUTION
 * ---------------------------------------------------------------------------
 * The chain id the EthereumProvider REPORTS after connect() is not the chain
 * the wallet is actually on:
 *
 *   `EthereumProvider.connect()` ends with
 *     setChainIds(this.rpc.chains.length ? this.rpc.chains : accounts)
 *   and `this.rpc.chains` is the REQUIRED chain list we passed to init() —
 *   i.e. DEFAULT_CHAIN (56, BNB Chain) — no matter what network the wallet
 *   approved the session on. (Verified against @walletconnect/ethereum-provider
 *   2.23.10 dist.) A Trust Wallet connected while it is on Ethereum therefore
 *   reports chainId 56, and every follow-up problem is a symptom of that lie:
 *   the Wallet tab filters the asset list to BSC (the user's WBTC on Ethereum
 *   is "gone"), and `request()` tags every call with `eip155:56` against a
 *   session whose namespace is `eip155:1`, which the wallet rejects.
 *
 * The honest source of the wallet's network is the SESSION itself: the first
 * account in `session.namespaces.eip155.accounts` carries the CAIP-2 chain the
 * wallet approved for it. `chainFromWcSession()` prefers that, then falls back
 * to `provider.chainId`, then to the caller's default. Pure module, no SDK
 * import, so it is unit-testable — see test/wc-chain-probe.mjs.
 */

/**
 * Normalize any chain-id spelling the wallet ecosystem uses into a number:
 *   56            → 56
 *   '56'          → 56
 *   '0x38'        → 56
 *   'eip155:56'   → 56
 * Returns null for anything that is not a positive integer chain id.
 */
export function parseChainId(cid) {
  if (cid == null || cid === '') return null;
  if (typeof cid === 'number' && Number.isInteger(cid) && cid > 0) return cid;
  let s = String(cid).trim();
  if (s.startsWith('eip155:')) s = s.slice(7);
  /* A full CAIP-10 account ('eip155:1:0x…') may arrive where a chain id was
     expected; the chain is the segment right after the namespace. */
  const colon = s.indexOf(':');
  if (colon !== -1) s = s.slice(0, colon);
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The chain id of the network the wallet actually approved the session on.
 *
 * 1. First account of the approved eip155 namespace (CAIP-2 chain) — this is
 *    what the wallet signed off on, and it is the closest thing to "the
 *    network the wallet is on" that exists before any chainChanged event.
 * 2. The provider's own chainId (correct after a chainChanged, wrong right
 *    after connect() — see the header comment).
 * 3. null — the caller decides its default.
 *
 * Never throws: a malformed session object is a real-world wallet response,
 * not a bug we can crash on.
 */
export function chainFromWcSession(wc) {
  try {
    const accounts = wc?.session?.namespaces?.eip155?.accounts;
    if (Array.isArray(accounts)) {
      for (const account of accounts) {
        if (typeof account !== 'string' || !account.startsWith('eip155:')) continue;
        const n = parseChainId(account.split(':')[1]);
        if (n != null) return n;
      }
    }
  } catch {
    /* fall through to the provider chainId */
  }
  return parseChainId(wc?.chainId);
}
