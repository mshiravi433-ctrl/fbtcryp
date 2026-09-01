/**
 * FBT WALLET ENGINE — SEED ASSET CATALOG (Solana + Bitcoin)
 * ---------------------------------------------------------------------------
 * The Smart Asset Resolver builds its lookup index from injected catalogs. The
 * full EVM catalog is `TOKENS` in `src/lib/chains.js` and is injected by the
 * app layer. This file carries ONLY the non-EVM well-known assets that live in
 * `src/lib/solana.js` — kept here as a small, self-contained seed because
 * `solana.js` imports fee/payout config with extensionless specifiers that the
 * Node test loader cannot resolve.
 *
 * ─── KEEP IN SYNC ───────────────────────────────────────────────────────────
 * The mint addresses below MUST match `src/lib/solana.js` (SOL_MINT, USDC_MINT,
 * USDT_MINT). A wrong character routes a lookup — and any downstream action —
 * to the wrong token, and the resolver exists precisely to stop that.
 *
 * The resolver treats this catalog as REPLACEABLE. Injecting a richer list
 * (tokenLists.js for EVM, solanaAssets.js for Solana) always wins.
 */

export const SEED_CATALOG = Object.freeze([
  /* Bitcoin — no contract, no mint. The only address is the network itself. */
  { family: 'bitcoin', chainId: 'bitcoin:mainnet', symbol: 'BTC', name: 'Bitcoin', decimals: 8, coingeckoId: 'bitcoin', native: true, address: null },

  /* Solana — mint addresses mirror src/lib/solana.js exactly. */
  { family: 'solana', chainId: 'solana:mainnet', symbol: 'SOL', name: 'Solana', decimals: 9, coingeckoId: 'solana', native: true, address: 'So11111111111111111111111111111111111111112' },
  { family: 'solana', chainId: 'solana:mainnet', symbol: 'USDC', name: 'USD Coin', decimals: 6, coingeckoId: 'usd-coin', native: false, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { family: 'solana', chainId: 'solana:mainnet', symbol: 'USDT', name: 'Tether USD', decimals: 6, coingeckoId: 'tether', native: false, address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' }
]);

/** Merge any number of catalogs (each an array of token-ish rows) into one. */
export function mergeCatalogs(...catalogs) {
  const out = [];
  const seen = new Set();
  for (const list of catalogs) {
    for (const t of list || []) {
      const key = `${t.family || ''}:${t.chainId || ''}:${String(t.symbol || '').toUpperCase()}:${String(t.address || t.mint || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
