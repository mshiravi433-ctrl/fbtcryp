/**
 * P2P CLASSIFIEDS — client.
 * ---------------------------------------------------------------------------
 * A thin wrapper over /api/board. All the rules live on the server, because a
 * check that only exists in the browser is not a check.
 *
 * ─── WHAT THIS DELIBERATELY CANNOT DO ───────────────────────────────────────
 * There is no "buy", no "accept offer", no escrow and no dispute call, and
 * there must never be. The board hosts advertisements; the two people settle
 * between themselves. That is the boundary that keeps this a forum rather than
 * a money transmitter — see server/board.js for the FinCEN language it is
 * built on.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/** ERC-20 transfer(address,uint256) selector. */
const TRANSFER_SELECTOR = '0xa9059cbb';

async function jfetch(path, init, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `HTTP_${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load the board.
 *
 * Returns an empty list rather than throwing: an unreachable API must leave
 * the screen usable and honest, not crash the tab the user is standing on.
 */
export async function fetchBoard(owner) {
  try {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : '';
    const data = await jfetch(`/board${q}`);
    return {
      rows: Array.isArray(data?.rows) ? data.rows : [],
      /* The caller's own row, which may be an unpaid draft nobody else sees. */
      mine: data?.mine ?? null,
      terms: data?.terms ?? null,
      live: true
    };
  } catch {
    return { rows: [], mine: null, terms: null, live: false };
  }
}

export function postListing(payload) {
  return jfetch('/board', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function deleteListing(owner) {
  return jfetch('/board/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner })
  });
}

export function publishListing(owner, txHash) {
  return jfetch('/board/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner, txHash })
  }, 20000);
}

/**
 * Pay for a promotion from the connected wallet.
 *
 * ─── WHY THIS BUILDS THE CALLDATA BY HAND ───────────────────────────────────
 * It is a plain ERC-20 `transfer`, so an ABI and a Contract instance would be
 * ~40 KB of ethers surface for one 68-byte payload. Encoding it directly keeps
 * the bundle small and makes the exact bytes being signed readable here rather
 * than three libraries away — which matters for the one function in this app
 * that moves the user's money on their behalf.
 *
 * ─── WHY THE CHAIN IS CHECKED FIRST ─────────────────────────────────────────
 * Sending Base calldata while the wallet sits on Ethereum would either revert
 * or, far worse, hit a different contract at the same address and lose the
 * money. `switchChain` is attempted, and if it fails we STOP instead of
 * sending anyway.
 *
 * @returns {Promise<{ok:boolean, hash?:string, reason?:string}>}
 */
export async function payForPromotion({ terms, tier, wallet }) {
  if (!terms || !tier) return { ok: false, reason: 'NO_TERMS' };
  if (!wallet?.isConnected) return { ok: false, reason: 'NOT_CONNECTED' };

  /*
   * The in-app vault can sign, but only after unlocking, and WalletConnect
   * sessions can go stale. Checking for a signer up front turns a confusing
   * mid-flow failure into one clear message before any wallet UI opens.
   */
  const signer = wallet.getSigner?.();
  if (!signer) return { ok: false, reason: 'NO_SIGNER' };

  if (wallet.chainId !== terms.chainId) {
    try {
      await wallet.switchChain?.(terms.chainId);
    } catch {
      return { ok: false, reason: 'WRONG_CHAIN' };
    }
    /* switchChain resolving is not proof the wallet moved — some wallets
       resolve and stay put. Re-read before spending. */
    if (wallet.chainId !== terms.chainId) return { ok: false, reason: 'WRONG_CHAIN' };
  }

  /*
   * The amount comes from the SELECTED TIER, and the server re-derives which
   * tier that buys from the amount it actually receives — so a tampered client
   * that sends $1 while asking for 30 days simply gets one day.
   */
  const units = BigInt(Math.round(tier.usd * 10 ** terms.decimals));
  const to = String(terms.recipient).toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amount = units.toString(16).padStart(64, '0');
  const data = `${TRANSFER_SELECTOR}${to}${amount}`;

  try {
    const tx = await signer.sendTransaction({ to: terms.token, data });
    /*
     * Wait for one confirmation before telling the server. Handing over a hash
     * that is still in the mempool would get NOT_FOUND from the receipt lookup
     * and read to the user as "your payment was rejected" seconds after their
     * wallet said it succeeded.
     */
    await tx.wait?.(1);
    return { ok: true, hash: tx.hash };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/user rejected|denied|cancel/i.test(msg)) return { ok: false, reason: 'REJECTED' };
    if (/insufficient/i.test(msg)) return { ok: false, reason: 'INSUFFICIENT' };
    return { ok: false, reason: 'FAILED' };
  }
}
