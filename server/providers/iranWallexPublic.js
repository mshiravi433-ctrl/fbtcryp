/**
 * Public USDT/TMN reference rate.
 *
 * This is the *public* market endpoint (`GET https://api.wallex.ir/v1/markets`)
 * — no API key, no account, no order. It exists so the Persian buy tab can
 * show a real, sourced market rate and an estimate before anyone signs or pays
 * anything, instead of a blank screen while the paid rail is being enabled.
 *
 * It is explicitly *not* a quote:
 *  - nothing here is ever used to price an order (an order is priced only by
 *    the authenticated OTC quote in providers/iranWallex.js);
 *  - if the response shape is not exactly what is expected, this returns
 *    `available: false` rather than guessing a number. A wrong rate shown to a
 *    buyer is worse than no rate.
 */
const RATE_TIMEOUT_MS = 8_000;
const MAX_JSON_BYTES = 4_000_000;
const CACHE_MS = 30_000;
const SYMBOL = 'USDTTMN';
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

let cache = { at: 0, value: null };

function positiveDecimal(value) {
  const raw = String(value ?? '').trim();
  if (!DECIMAL.test(raw)) return null;
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
  /* Trim the 16-decimal padding Wallex sends without rounding the integer part. */
  return raw.includes('.') ? raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : raw;
}

function boundedChange(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 100 ? Number(parsed.toFixed(2)) : null;
}

function findSymbolRow(result) {
  if (!result || typeof result !== 'object') return null;
  const containers = [result.symbols, result];
  for (const container of containers) {
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      const row = container[SYMBOL];
      if (row && typeof row === 'object') return row;
    }
  }
  if (Array.isArray(result)) {
    return result.find((row) => String(row?.symbol || '').toUpperCase() === SYMBOL) || null;
  }
  return null;
}

export function normalizePublicUsdtTmnRate(result) {
  const row = findSymbolRow(result);
  const stats = row?.stats && typeof row.stats === 'object' ? row.stats : row;
  if (!row || !stats) return null;
  /* Guard the pair itself: a renamed/reused symbol must not become a Toman
     price for something that is not Tether. */
  const base = String(row.baseAsset ?? row.base_asset ?? 'USDT').toUpperCase();
  const quote = String(row.quoteAsset ?? row.quote_asset ?? 'TMN').toUpperCase();
  if (base !== 'USDT' || quote !== 'TMN') return null;
  const ask = positiveDecimal(stats.askPrice);
  const bid = positiveDecimal(stats.bidPrice);
  const last = positiveDecimal(stats.lastPrice);
  const reference = ask || last;
  if (!reference) return null;
  return {
    symbol: SYMBOL,
    /* A buyer pays the ask. Falling back to lastPrice is labelled as such in
       the UI copy, never presented as an executable price. */
    buyPrice: reference,
    sellPrice: bid || null,
    lastPrice: last || null,
    change24h: boundedChange(stats['24h_ch']),
    source: 'wallex-public-markets',
    at: new Date().toISOString()
  };
}

export async function fetchPublicUsdtTmnRate({ fetchImpl = globalThis.fetch, timeoutMs = RATE_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || RATE_TIMEOUT_MS));
  try {
    const response = await fetchImpl('https://api.wallex.ir/v1/markets', {
      headers: { accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error'
    });
    if (!response.ok) return null;
    const text = await response.text().catch(() => '');
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) return null;
    let payload = null;
    try { payload = JSON.parse(text); } catch { return null; }
    if (payload?.success !== true) return null;
    return normalizePublicUsdtTmnRate(payload.result);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cached accessor used by the route. The cache is per-instance and short: this
 * endpoint is public and unauthenticated, so it must never be able to generate
 * one upstream request per browser poll.
 */
export async function publicUsdtTmnRate({ fetchImpl, now = Date.now() } = {}) {
  if (cache.value && now - cache.at < CACHE_MS) return cache.value;
  const value = await fetchPublicUsdtTmnRate({ fetchImpl });
  if (value) cache = { at: now, value };
  /* On failure keep serving the last good value for one extra minute, clearly
     stamped with its own `at`, then give up and report unavailable. */
  if (!value && cache.value && now - cache.at < CACHE_MS * 3) return cache.value;
  return value;
}

export function __resetPublicUsdtTmnRateCache() {
  cache = { at: 0, value: null };
}
