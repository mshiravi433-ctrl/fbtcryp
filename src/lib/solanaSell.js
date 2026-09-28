/**
 * SOLANA SELL HANDOFF — the one URL shape for «فروش».
 *
 * WHY THIS FILE EXISTS
 * The Stocks page could buy a tokenized share (`/solana?to=<mint>`) but
 * nothing in the app could sell one. A user who bought AAPLx had to open the
 * swap screen, find AAPLx in the picker by hand, put it in the FROM box and
 * pick USDC for TO — four steps that most people never worked out, so the
 * question «چطور بفروشم؟» kept coming back. A Buy button without a Sell button
 * next to it also reads as a one-way door, which is the opposite of trust.
 *
 * The swap screen already understands `?fromMint=&toMint=` (the third URL
 * effect in SolanaSwap.jsx — the one written for stored orders). Every Sell
 * button in the app builds its link HERE, so the pair is always the same and a
 * change to the handoff is a one-line change.
 *
 * THE PAIR
 *   asset  → USDC   selling a share, gold, an LST, a memecoin: dollars out.
 *   USDC   → SOL    the only thing "selling USDC" can sensibly mean here.
 *
 * MINTS, NEVER SYMBOLS
 * The swap screen resolves `to=` through `findAsset(mint)`; a symbol there
 * pre-fills nothing (coinToSwap.js has exactly that latent bug for SOL). The
 * helper refuses anything that is not a Solana address so a broken row can
 * never produce a link that silently lands on the default pair.
 */
import { SOL_MINT, USDC_MINT, USDT_MINT, isSolanaAddress } from './solana.js';
import { COMMODITY_ASSETS, EQUITY_ASSETS } from './solanaAssets.js';

/** SOL and the two dollar stables: "selling" them is really just a swap. */
const SWAP_ONLY = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

/**
 * How the exit for a mint should be labelled. 'sell' for anything that is an
 * asset (a share, gold, an LST, a memecoin); 'swap' for SOL and the stables,
 * where the word «فروش» would be a small lie.
 * @param {string} mint
 * @returns {'sell'|'swap'}
 */
export function solanaExitKind(mint) {
  return SWAP_ONLY.has(String(mint ?? '').trim()) ? 'swap' : 'sell';
}

/**
 * The in-app path that opens the Solana swap screen with `mint` already in the
 * FROM box and the right counter-asset in TO.
 * @param {string} mint
 * @returns {string|null} null when `mint` is not a Solana address
 */
export function solanaSellUrl(mint) {
  const m = String(mint ?? '').trim();
  if (!isSolanaAddress(m)) return null;
  const counter = m === USDC_MINT ? SOL_MINT : USDC_MINT;
  return `/solana?fromMint=${encodeURIComponent(m)}&toMint=${encodeURIComponent(counter)}`;
}

/** The mints the Stocks page is about: tokenized shares and gold. */
const STOCK_MINTS = [...EQUITY_ASSETS, ...COMMODITY_ASSETS];

/**
 * Join wallet holdings with the Stocks page's price list so it can say
 * «در کیف پول شما ۰٫۴۲ AAPLx ≈ $95». Pure, so it is unit-tested directly.
 *
 * MEMBERSHIP comes from the curated list (EQUITY_ASSETS + COMMODITY_ASSETS),
 * not from the price list. The price feed fails on its own schedule, and a
 * user who holds AAPLx while the feed is down must still see the AAPLx row
 * (with «—» for the value) — not a card that says they own nothing. An
 * unknown SPL token in the wallet is NOT included: it belongs on the wallet
 * screen, where everything is shown, not in a list titled «سهام من».
 *
 * PRICE comes from `priced` when that mint is in it. The page's list can be
 * shorter than the curated one (the liquidity floor hides thin books), and a
 * held token that fell below the floor still needs its row and its Sell.
 *
 * @param {Array<{mint:string, amount:string|null, decimals?:number|null}>} holdings
 *   rows from readSolanaPortfolio()
 * @param {Array<{mint:string, symbol:string, name?:string, usdPrice?:number|null}>} priced
 *   the assets the page lists (equities + gold), with their live prices
 * @param {Array<{mint:string, symbol:string, name?:string}>} [curated]
 *   which mints count as "stocks" — injectable for tests
 * @returns {Array<{mint:string, symbol:string, name:string, amount:number,
 *   amountText:string, usdPrice:number|null, usdValue:number|null, asset:object, listed:boolean}>}
 *   sorted by USD value (unpriced rows last), never containing a zero balance
 */
export function joinEquityHoldings(holdings, priced, curated = STOCK_MINTS) {
  if (!Array.isArray(holdings)) return [];
  const known = new Map();
  for (const a of curated || []) if (a && typeof a.mint === 'string') known.set(a.mint, a);
  const prices = new Map();
  for (const a of priced || []) if (a && typeof a.mint === 'string') prices.set(a.mint, a);

  const out = [];
  for (const h of holdings) {
    const base = h && known.get(h.mint);
    if (!base) continue;
    const amount = Number(h.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const live = prices.get(h.mint) || null;
    const asset = live || base;
    const usdPrice = Number(live?.usdPrice);
    const priceOk = Number.isFinite(usdPrice) && usdPrice > 0;
    out.push({
      mint: h.mint,
      symbol: asset.symbol || h.symbol || '',
      name: asset.name || h.name || asset.symbol || '',
      amount,
      amountText: typeof h.amount === 'string' ? h.amount : String(amount),
      usdPrice: priceOk ? usdPrice : null,
      usdValue: priceOk ? amount * usdPrice : null,
      asset,
      listed: Boolean(live)
    });
  }
  out.sort((a, b) => {
    if (a.usdValue == null && b.usdValue == null) return b.amount - a.amount;
    if (a.usdValue == null) return 1;
    if (b.usdValue == null) return -1;
    return b.usdValue - a.usdValue;
  });
  return out;
}

/**
 * The total a list from joinEquityHoldings() is worth — or null when ANY row
 * has no price, because "$95" under a list that also contains an unpriced row
 * is a number the user would believe and should not.
 */
export function holdingsTotalUsd(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let total = 0;
  for (const r of rows) {
    if (r.usdValue == null) return null;
    total += r.usdValue;
  }
  return total;
}
