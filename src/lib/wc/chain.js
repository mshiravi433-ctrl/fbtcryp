/**
 * WALLETCONNECT CHAIN-ID RESOLUTION
 * ---------------------------------------------------------------------------
 * The chain id the EthereumProvider REPORTS after connect() is not the chain the
 * wallet is actually on.
 *
 * `EthereumProvider.connect()` ends with `setChainIds(this.rpc.chains)`, and
 * `this.rpc.chains` is the REQUIRED chain list we passed to init() — i.e.
 * DEFAULT_CHAIN — no matter which network the wallet approved the session on.
 * A Trust Wallet connected while it is on Ethereum therefore reports 56: the
 * wallet tab filters the asset list to BSC (the user's WBTC on Ethereum is
 * "gone"), and `request()` tags every call with `eip155:56` against a session
 * whose namespace is `eip155:1`, which the wallet rejects.
 *
 * The honest source is the SESSION: the first account in
 * `session.namespaces.eip155.accounts` carries the CAIP-2 chain the wallet
 * approved for it.
 */

/**
 * Normalize any chain-id spelling the wallet ecosystem uses into a number:
 *   56 → 56 · '56' → 56 · '0x38' → 56 · 'eip155:56' → 56
 * @returns {number|null} null for anything that is not a positive integer.
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
  if (/^0x[0-9a-f]+$/i.test(s)) {
    const hex = Number(s);
    return Number.isInteger(hex) && hex > 0 ? hex : null;
  }
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The chain the wallet actually approved the session on.
 *
 * 1. the first account of the approved eip155 namespace (CAIP-2 chain) — the
 *    closest thing to "the network the wallet is on" before any chainChanged;
 * 2. the provider's own chainId (correct after a chainChanged, wrong right
 *    after connect() — see the header);
 * 3. null, so the caller decides its default.
 *
 * Never throws: a malformed session object is a real-world wallet response.
 */
export function chainFromSession(wc) {
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
    /* fall through to the provider's own answer */
  }
  return parseChainId(wc?.chainId);
}
