/**
 * OPPORTUNITY → TOKEN PAGE, WITHOUT GUESSING
 * ---------------------------------------------------------------------------
 * «دکمه بازکردن باشد تا به صفحه توکن در اپ … بره»
 *
 * Most rows in the engine are pools and markets, not coins: `USDC`, `STETH`,
 * `ETH-USDC`, `SOL`. To give those a token page we have to answer "which coin is
 * this?" — and a wrong answer here is not cosmetic, it sends someone to the
 * wrong asset's chart and, from there, to the wrong swap.
 *
 * So the match is deliberately strict, and it is EXACT or nothing:
 *
 *   · the feed symbol must equal the market symbol (case-folded, no fuzzy
 *     "starts with" matching, no edit distance);
 *   · a pair symbol (`ETH-USDC`) never matches — a pool is not a coin, and the
 *     card opens the Farm row for it instead;
 *   · well-known tickers that several chains all use are NOT matched on symbol
 *     alone. `USDC` exists on eight networks and the CoinGecko id is `usd-coin`
 *     either way, so that one is safe; `ETH` on Binance-Peg is not Ethereum, so
 *     wrapped/pegged tickers carry a `WRAPPED_ALIAS` and are matched to their
 *     own id;
 *   · when a fee-tier suffix is present (`USDC.e`, `STETH`, `WSTETH`) the market
 *     index is asked for that exact uppercase symbol, and a miss stays a miss.
 *
 * The result is written onto the row (`ref.tokenId`) so every consumer — card,
 * detail page, chat — sees the same destination.
 */

const list = (v) => (Array.isArray(v) ? v : []);

/**
 * Symbols whose market identity is unambiguous across chains. Kept short on
 * purpose: this is an allow-list, not a heuristic.
 */
const SAFE_SYMBOLS = new Set([
  'BTC', 'WBTC', 'ETH', 'WETH', 'SOL', 'BNB', 'AVAX', 'MATIC', 'POL', 'ARB', 'OP',
  'USDT', 'USDC', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'PYUSD', 'LINK', 'UNI',
  'AAVE', 'MKR', 'CRV', 'LDO', 'STETH', 'WSTETH', 'RETH', 'CBETH', 'SFRXETH',
  'PAXG', 'XAUT', 'COMP', 'SNX', 'SUSDE', 'SUSDS', 'GMX', 'PENDLE', 'ENA', 'ONDO'
]);

const pairLike = (s) => /[-/]/.test(String(s ?? ''));

/**
 * Build the symbol → coin-id index from a market page.
 * First row wins, because the market API is market-cap ordered.
 */
export function buildSymbolIndex(markets = []) {
  const index = new Map();
  for (const row of list(markets)) {
    const sym = String(row?.symbol ?? '').trim().toUpperCase();
    const id = row?.id;
    if (!sym || !id || index.has(sym)) continue;
    index.set(sym, { id, symbol: sym, name: row?.name ?? null, price: row?.price ?? null, provenance: row?.dataProvenance ?? null });
  }
  return index;
}

/**
 * The token id for one opportunity row, or null.
 * @param {object} opportunity
 * @param {Map} index  buildSymbolIndex() output
 */
export function tokenIdFor(opportunity, index) {
  if (!index || !opportunity) return null;
  if (opportunity.ref?.tokenId) return opportunity.ref.tokenId;
  const raw = String(opportunity.symbol ?? '').trim().toUpperCase();
  if (!raw || pairLike(raw)) return null;
  if (!SAFE_SYMBOLS.has(raw)) return null;
  const hit = index.get(raw);
  if (!hit) return null;
  /* Only a live quote may become a destination: sending a user to a chart the
     app itself flagged as stale is a data-honesty break, not a convenience. */
  if (hit.provenance && !['live', 'live-bff'].includes(hit.provenance)) return null;
  return hit.id;
}

/**
 * Attach `ref.tokenId` to every row of a scan, in place.
 * Returns the number of rows that gained a destination, for the UI/probe.
 */
export function attachTokenIds(scan, markets = []) {
  if (!scan) return 0;
  const index = buildSymbolIndex(markets);
  if (!index.size) return 0;
  let attached = 0;
  const consider = (row) => {
    if (!row) return;
    const id = tokenIdFor(row, index);
    if (!id) return;
    if (row.ref?.tokenId === id) return;
    row.ref = { ...(row.ref || {}), tokenId: id };
    attached += 1;
  };
  for (const row of list(scan.opportunities)) consider(row);
  for (const row of list(scan.rejected)) consider(row);
  for (const item of list(scan.scanner)) {
    /* The scanner summary is a copy — update the id it reports too. */
    const source = [...list(scan.opportunities), ...list(scan.rejected)].find((r) => r.opportunityId === item.opportunityId);
    if (source?.ref?.tokenId) item.ref = { ...(item.ref || {}), tokenId: source.ref.tokenId };
  }
  return attached;
}
