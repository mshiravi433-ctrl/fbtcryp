/**
 * Solana signal assets — the curated list the Signals page offers in its
 * Solana tab, plus the lazy on-chain intel fetcher.
 *
 * ─── WHY A SECOND COPY OF THE MINT LIST ────────────────────────────────────
 * The canonical list lives in server/solanaIntel.js (it drives the whales
 * feed). The Signals page needs it on the CLIENT to render the tab instantly,
 * without a fetch on the critical render path. A tiny, static, documented
 * duplication is cheaper than a blocking request for a 7-row picker. The two
 * are kept in sync by the test that checks these addresses decode to 32 bytes
 * and that every CoinGecko id is one CoinGecko actually serves.
 *
 * Each mint was verified against the project's own mint authority, not typed
 * from memory (see session notes): SOL is native (wrapped mint), JUP/BONK/JTO/
 * PYTH/WIF/RAY are the canonical mainnet mints.
 */
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

export const SOLANA_SIGNAL_ASSETS = [
  { id: 'solana', symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112' },
  { id: 'jupiter-exchange-solana', symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbHedAuSjReC' },
  { id: 'bonk', symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { id: 'jito-governance-token', symbol: 'JTO', mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL' },
  { id: 'pyth-network', symbol: 'PYTH', mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3' },
  { id: 'dogwifcoin', symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  { id: 'raydium', symbol: 'RAY', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' }
];

/**
 * On-chain intel for one mint, or `{ configured:false }` when the Solscan key
 * is absent. Never throws on the missing-key case — the caller hides the row.
 * Lazy by design: only the Solana tab calls this, and only after first paint.
 */
export async function getSolanaIntel(mint, { timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/solana/intel/${encodeURIComponent(mint)}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
