/**
 * Live Binance Seed / Monitoring classifications.
 *
 * These are exchange risk tags, not CoinGecko categories and not judgments
 * made by FBT. A tag must be present on a currently trading Binance product.
 * To join it to a CoinGecko price, both providers must identify the same
 * Binance base/quote pair and CoinGecko coin ID. Name + symbol are used only
 * to find candidates; they are never sufficient to admit a row. Ambiguous,
 * missing or unconfirmed identities are omitted rather than guessed.
 */
const PRODUCT_TTL = 60_000;
const IDENTITY_TTL = 15 * 60_000;
const CATALOG_TTL = 6 * 60 * 60_000;
const CANDIDATES_PER_BATCH = 25;
const MAX_TICKER_PAGES = 4;
const MAX_CANDIDATES = 500;

const symbolOf = (value) => {
  const symbol = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{1,32}$/.test(symbol) ? symbol : '';
};
const nameOf = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Parse the exchange's public product response, retaining only explicit tags. */
export function taggedBinanceAssets(payload, tag) {
  if (!['monitoring', 'seed'].includes(tag) || payload?.success !== true || payload?.code !== '000000' || !Array.isArray(payload.data)) {
    throw new Error('BINANCE_TAG_DATA_UNAVAILABLE');
  }
  const grouped = new Map();
  let taggedSchema = false;
  for (const product of payload.data) {
    if (!Array.isArray(product?.tags)) continue;
    taggedSchema = true;
    if (product.st !== 'TRADING' || !product.tags.some((item) => typeof item === 'string' && item.toLowerCase() === tag)) continue;
    const symbol = symbolOf(product.b);
    const quote = symbolOf(product.q);
    const name = nameOf(product.an);
    if (!symbol || !quote || !name) continue;
    let asset = grouped.get(symbol);
    if (!asset) {
      asset = { symbol, names: new Set(), quotes: new Set() };
      grouped.set(symbol, asset);
    }
    asset.names.add(name);
    asset.quotes.add(quote);
  }
  // An empty list is valid only when Binance actually supplied tag arrays.
  if (!taggedSchema) throw new Error('BINANCE_TAG_DATA_UNAVAILABLE');
  return [...grouped.values()].filter((asset) => asset.names.size === 1);
}

/** Find unambiguous candidates, but do not treat this name match as proof. */
export function candidateCoinIds(assets, catalog) {
  if (!Array.isArray(catalog)) throw new Error('COIN_CATALOG_UNAVAILABLE');
  const wanted = new Map(assets.map((asset) => [`${asset.symbol}:${[...asset.names][0]}`, asset]));
  const matches = new Map();
  for (const coin of catalog) {
    const symbol = symbolOf(coin?.symbol);
    const name = nameOf(coin?.name);
    const id = typeof coin?.id === 'string' && /^[a-z0-9_-]{1,120}$/.test(coin.id) ? coin.id : '';
    const key = `${symbol}:${name}`;
    if (!id || !wanted.has(key)) continue;
    if (!matches.has(key)) matches.set(key, new Set());
    matches.get(key).add(id);
  }
  const out = [];
  for (const [key, ids] of matches) {
    if (ids.size !== 1) continue; // a name and ticker can both be copied
    out.push({ ...wanted.get(key), id: [...ids][0] });
  }
  return out;
}

/** Verify the exact Binance pair and canonical ID against CoinGecko tickers. */
export function verifiedRiskIds(candidates, tickers) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const ids = new Set();
  for (const ticker of Array.isArray(tickers) ? tickers : []) {
    const candidate = byId.get(ticker?.coin_id);
    if (!candidate || ticker?.market?.identifier !== 'binance' || ticker.is_stale === true) continue;
    if (symbolOf(ticker.base) !== candidate.symbol || !candidate.quotes.has(symbolOf(ticker.target))) continue;
    ids.add(candidate.id);
  }
  return [...ids];
}

/** A short single-flight cache: failed refreshes are never served as fresh. */
function cached(ttl, producer) {
  let value;
  let at = 0;
  let inflight;
  return async () => {
    if (at && Date.now() - at < ttl) return value;
    if (inflight) return inflight;
    inflight = Promise.resolve().then(producer).then((result) => {
      value = result;
      at = Date.now();
      return value;
    }).finally(() => { inflight = null; });
    return inflight;
  };
}

/** Dependencies are injected so every failure path can be tested offline. */
export function createBinanceRiskSource({ fetchProducts, fetchCatalog, fetchTickers, fetchMarkets, normalizeCoin }) {
  const products = cached(PRODUCT_TTL, fetchProducts);
  const catalog = cached(CATALOG_TTL, fetchCatalog);
  // Cache exchange identity evidence independently of rapidly changing tags.
  // The evidence is re-intersected with the CURRENT tagged pairs on every use.
  const tickerCache = new Map();

  const tickersFor = async (ids) => {
    const key = [...ids].sort().join(',');
    if (!tickerCache.has(key)) {
      if (tickerCache.size >= 20) tickerCache.delete(tickerCache.keys().next().value);
      tickerCache.set(key, cached(IDENTITY_TTL, async () => {
        const rows = [];
        for (let page = 1; page <= MAX_TICKER_PAGES; page += 1) {
          const response = await fetchTickers(ids, page);
          if (!Array.isArray(response?.tickers)) throw new Error('BINANCE_IDENTITY_UNAVAILABLE');
          rows.push(...response.tickers);
          if (response.tickers.length < 100) break;
        }
        return rows;
      }));
    }
    return tickerCache.get(key)();
  };

  const buildList = async (tag, vs) => {
    const payload = await products();
    const assets = taggedBinanceAssets(payload, tag);
    if (!assets.length) return [];

    const candidates = candidateCoinIds(assets, await catalog()).slice(0, MAX_CANDIDATES);
    if (!candidates.length) throw new Error('BINANCE_IDENTITY_UNAVAILABLE');
    const batches = [];
    for (let i = 0; i < candidates.length; i += CANDIDATES_PER_BATCH) {
      batches.push(candidates.slice(i, i + CANDIDATES_PER_BATCH));
    }
    // One failed batch must not turn an unverified ticker into a verified one.
    // Other successful batches can still provide a truthful (partial) list.
    const results = await Promise.allSettled(batches.map((batch) => tickersFor(batch.map((item) => item.id))));
    const verified = new Set();
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        for (const id of verifiedRiskIds(batches[i], result.value)) verified.add(id);
      }
    });
    if (!verified.size) throw new Error('BINANCE_IDENTITY_UNAVAILABLE');

    const ids = [...verified];
    const quotes = await Promise.all(Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) =>
      fetchMarkets(ids.slice(i * 200, (i + 1) * 200), vs)
    ));
    const seen = new Set();
    const rows = quotes.flat().filter((coin) => {
      if (!coin || !verified.has(coin.id) || seen.has(coin.id)) return false;
      seen.add(coin.id);
      return true;
    }).map((coin) => ({ ...normalizeCoin(coin), marketProvider: 'coingecko', classificationProvider: 'binance' }));
    if (!rows.length) throw new Error('CATEGORY_DATA_UNAVAILABLE');
    rows.sort((a, b) => (Number(a.rank) > 0 ? Number(a.rank) : Infinity) - (Number(b.rank) > 0 ? Number(b.rank) : Infinity));
    return rows;
  };
  const listCache = new Map();
  return async (tag, { perPage = 50, page = 1, vs = 'usd' } = {}) => {
    const size = Math.min(250, Math.max(1, Math.floor(Number(perPage) || 50)));
    const pageNo = Math.min(10, Math.max(1, Math.floor(Number(page) || 1)));
    const key = `${tag}:${vs}`;
    if (!listCache.has(key)) {
      if (listCache.size >= 20) listCache.delete(listCache.keys().next().value);
      listCache.set(key, cached(PRODUCT_TTL, () => buildList(tag, vs)));
    }
    const rows = await listCache.get(key)();
    return rows.slice((pageNo - 1) * size, pageNo * size);
  };
}
