/**
 * THE WHALE ENGINE — «موتور نهنگ‌ها», actually read.
 * ===========================================================================
 * The app has shown whale boards for a while. What it could not do was answer
 * the question a board exists for:
 *
 *   · Is this PILE of whale activity on this TOKEN, and is it leaning anywhere?
 *   · Are the large SOL movements on Solana going INTO exchanges (sell intent)
 *     or OUT of them (accumulation), and how much of the chain did we see?
 *   · Is a whale's $40M "net in" one wallet moving house, or nine wallets
 *     agreeing?
 *
 * Three honesty rules shape everything below, and they are the reason this is
 * one module rather than a `.filter()` in each component:
 *
 *   1. A WHALE TRANSFER IS NOT A TRADE. `from → to` says capital moved; it says
 *      nothing about buying or selling unless one side is a venue we can name.
 *      So `direction` is null for unlabelled movements — never 0, never a
 *      guess — and only a labelled exchange side produces a real lean.
 *   2. BREADTH BEATS SIZE. Nine wallets each moving a little is a pattern; one
 *      wallet moving a lot is one wallet. Every read reports `wallets` next to
 *      `usd`, and the lean is scaled by breadth, not by dollars alone.
 *   3. A SAMPLE SAYS SO. The Solana feed is one sampled block per window; the
 *      EVM board is whatever our scanner observed while it ran. Both travel
 *      with their coverage, and a read that has coverage but no movements is
 *      «quiet», not «nothing happened».
 *
 * Pure arithmetic over payloads already in hand. No fetch, no timer, no storage.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sum = (rows, pick) => rows.reduce((acc, r) => acc + (num(pick(r)) ?? 0), 0);

/** Venue names the sources actually attach to a counterparty. */
const VENUE_HINTS = [
  ['binance', 'Binance'], ['coinbase', 'Coinbase'], ['kraken', 'Kraken'],
  ['okx', 'OKX'], ['okex', 'OKX'], ['bybit', 'Bybit'], ['bitfinex', 'Bitfinex'],
  ['gate', 'Gate'], ['kucoin', 'KuCoin'], ['htx', 'HTX'], ['huobi', 'HTX'],
  ['mexc', 'MEXC'], ['bitget', 'Bitget'], ['crypto.com', 'Crypto.com'],
  ['upbit', 'Upbit'], ['bithumb', 'Bithumb'], ['gemini', 'Gemini'],
  ['kraken', 'Kraken'], ['deribit', 'Deribit'], ['bitstamp', 'Bitstamp']
];

/**
 * Which venue a label names, or null.
 *
 * Case-folded substring match on the label the explorer/Solscan attached. A
 * label we do not recognise stays null: naming the wrong exchange is worse than
 * naming none, because it turns a transfer into a fabricated sell signal.
 */
export function venueOf(label) {
  const text = String(label || '').toLowerCase();
  if (!text) return null;
  for (const [hint, name] of VENUE_HINTS) if (text.includes(hint)) return name;
  return null;
}

/**
 * THE TOKEN READ — who is moving THIS token, from the whale board.
 *
 * The board ranks WALLETS, not tokens, so the token view has to be rebuilt from
 * each wallet's own footprint: its `tokens` symbols, its buy/sell dollars, and
 * its observed time. A wallet that touched the symbol contributes its net to
 * the token's net — that is the only claim the data supports, and it is stated
 * as "net capital into wallets that moved SYMBOL", not as "price pressure".
 *
 * @param {object} input
 * @param {Array}  input.wallets   `/api/v1/smart-money/whales` rows
 * @param {string} input.symbol    the ticker to read (case-insensitive)
 * @param {string} [input.window]
 * @param {number} [input.minUsd]  ignore wallets below this observed volume
 */
export function readWhalesOnToken({ wallets = [], symbol = null, window = null, minUsd = 250_000 } = {}) {
  const ticker = String(symbol || '').toUpperCase().trim();
  if (!ticker) return null;
  const rows = (Array.isArray(wallets) ? wallets : []).filter((w) => {
    if (!w) return false;
    const tokens = Array.isArray(w.tokens) ? w.tokens.map((t) => String(t || '').toUpperCase()) : [];
    if (!tokens.includes(ticker)) return false;
    const moved = num(w.movedUsd);
    return moved === null || moved >= minUsd;
  });
  if (!rows.length) return null;

  const netUsd = sum(rows, (w) => w.netUsd);
  const buyUsd = sum(rows, (w) => w.buys);
  const sellUsd = sum(rows, (w) => w.sells);
  /* GROSS volume, which is what the board itself ranks by. `netUsd` is a
     different quantity (received − sent) and mixing the two denominators is how
     a "share of the story" ends up over 100 %. */
  const movedUsd = sum(rows, (w) => Math.abs(num(w.movedUsd) ?? 0));
  const netMovedUsd = sum(rows, (w) => Math.abs(num(w.netUsd) ?? 0));
  /* Only the labelled DEX sides are a lean. Wallet-to-wallet movement is not,
     however large it is — that is the rule this whole module exists for. */
  const directionalUsd = buyUsd + sellUsd;
  const direction = directionalUsd <= 0 ? null
    : buyUsd > sellUsd * 1.15 ? 'ACCUMULATION'
      : sellUsd > buyUsd * 1.15 ? 'DISTRIBUTION'
        : null;
  const breadth = rows.length;
  const top = [...rows].sort((a, b) => Math.abs(num(b.movedUsd) ?? 0) - Math.abs(num(a.movedUsd) ?? 0))[0] || null;
  /* One wallet carrying most of the money is concentration, not consensus. */
  const topShare = top && movedUsd > 0
    ? clamp(Math.abs(num(top.movedUsd) ?? 0) / movedUsd, 0, 1) : null;

  return {
    measured: true,
    symbol: ticker,
    window: window || null,
    wallets: breadth,
    netUsd: Math.round(netUsd),
    buyUsd: Math.round(buyUsd),
    sellUsd: Math.round(sellUsd),
    movedUsd: Math.round(movedUsd),
    netMovedUsd: Math.round(netMovedUsd),
    direction,
    /* 0…1: how much of this token's whale story is ONE wallet. */
    topSharePct: topShare === null ? null : Math.round(topShare * 1000) / 10,
    topWallet: top ? { address: top.address, short: top.short || null, label: top.label || null, movedUsd: top.movedUsd } : null,
    chainIds: [...new Set(rows.map((w) => w.chainId).filter((c) => c != null))],
    /* A direction needs breadth AND balance; a single wallet's DEX fill does
       not make a token's whale board lean. */
    confident: direction !== null && breadth >= 2 && (topShare === null || topShare <= 0.7)
  };
}

/**
 * THE SOLANA READ — large SOL movements, read for what they can and cannot say.
 *
 * A row carries `from`/`to` and, from Solscan, a LABEL for either side. That
 * label is the only thing that turns a movement into intent:
 *
 *   · `to` a venue   → capital heading to an exchange: sell intent (bearish);
 *   · `from` a venue → capital leaving an exchange: accumulation (bullish);
 *   · wallet → wallet → NO direction. Reported as flow, never as a signal.
 *
 * The feed is a sample, so the read always carries its coverage: which sources
 * answered, which slot was sampled, how old the oldest row is, and how many
 * rows exist. A quiet sample is «quiet», and a read with no sample is
 * `measured:false` — the two must never look the same on screen.
 */
export function readSolanaWhales({ watch = null, priceUsd = null, minSol = null, now = Date.now() } = {}) {
  if (!watch || typeof watch !== 'object') return null;
  const coverage = watch.coverage || null;
  const rows = Array.isArray(watch.transfers) ? watch.transfers : [];
  const floor = num(watch.floorSol);
  const floorSol = minSol ?? (floor ?? 0);
  const kept = rows.filter((r) => {
    const sol = num(r.sol);
    return sol !== null && sol >= floorSol;
  });

  const price = num(priceUsd) ?? num(watch.solPrice);
  const toVenue = [];
  const fromVenue = [];
  const walletToWallet = [];
  for (const row of kept) {
    const toName = row.toLabel ? venueOf(row.toLabel) : null;
    const fromName = row.fromLabel ? venueOf(row.fromLabel) : null;
    if (toName && !fromName) toVenue.push({ ...row, venue: toName });
    else if (fromName && !toName) fromVenue.push({ ...row, venue: fromName });
    else walletToWallet.push(row);
  }

  const solOf = (list) => sum(list, (r) => r.sol);
  const usdOf = (list) => (price === null ? null : solOf(list) * price);

  const intoVenuesSol = solOf(toVenue);
  const outOfVenuesSol = solOf(fromVenue);
  const labelled = toVenue.length + fromVenue.length;
  const direction = labelled === 0 ? null
    : intoVenuesSol > outOfVenuesSol * 1.15 ? 'DISTRIBUTION'
      : outOfVenuesSol > intoVenuesSol * 1.15 ? 'ACCUMULATION'
        : null;

  const newestAt = kept.length ? Math.max(...kept.map((r) => num(r.at) ?? 0)) : null;
  const oldestAt = kept.length ? Math.min(...kept.map((r) => num(r.at) ?? Infinity)) : null;

  return {
    /* `available:false` from the server means the node did not answer — that is
       an outage, not a quiet chain, and this read refuses to print it as one. */
    measured: kept.length > 0,
    available: watch.available !== false,
    reason: watch.reason || null,
    sampled: coverage ? {
      sources: coverage.sources || [],
      blocksPerRefresh: num(coverage.blocksPerRefresh),
      sampleReused: !!coverage.sampleReused,
      slot: num(coverage.lastSample?.slot),
      at: coverage.lastSample?.at || null
    } : null,
    movements: kept.length,
    solMoved: solOf(kept),
    usdMoved: usdOf(kept),
    largestSol: kept.length ? Math.max(...kept.map((r) => num(r.sol) ?? 0)) : null,
    intoVenuesSol,
    outOfVenuesSol,
    intoVenuesUsd: usdOf(toVenue),
    outOfVenuesUsd: usdOf(fromVenue),
    walletToWalletSol: solOf(walletToWallet),
    labelledMovements: labelled,
    venues: [...new Set([...toVenue, ...fromVenue].map((r) => r.venue))],
    direction,
    /* Direction is only as good as the number of labelled movements behind it. */
    confident: direction !== null && labelled >= 3,
    newestAt,
    oldestAt,
    ageMs: newestAt === null ? null : Math.max(0, now - newestAt),
    priceUsd: price,
    floorSol: floorSol
  };
}

/**
 * Both chains in one shape, so a screen does not have to know which feed it is
 * holding. `direction` follows each chain's own rules above; `comparable` is
 * false whenever the two halves measure different things (which they do).
 */
export function readWhaleEngine({ wallets = [], symbol = null, window = null, solana = null, now = Date.now() } = {}) {
  const evm = readWhalesOnToken({ wallets, symbol, window });
  const sol = readSolanaWhales({ watch: solana, now });
  if (!evm && !sol) return null;

  /* A token-level lean comes from the chain that has a TOKEN view. Solana's
     whale feed is native SOL movements across the chain, not a statement about
     one mint, so it is context — it must never be added to `evm.netUsd`. */
  const direction = evm?.direction ?? null;
  return {
    measured: !!(evm || sol?.measured),
    symbol: symbol ? String(symbol).toUpperCase() : null,
    window: window || null,
    direction,
    confident: !!evm?.confident,
    evm,
    solana: sol,
    comparable: false,
    note: 'evm: net capital into wallets that moved this token (labelled DEX sides only). '
      + 'solana: sampled native-SOL movements; direction only when a movement has a named venue '
      + 'on exactly one side. The two are different measurements and are never summed.'
  };
}

export default readWhaleEngine;
