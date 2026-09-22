/**
 * ETF + Gold read surface — thin orchestration over the Alpha Vantage provider.
 * ---------------------------------------------------------------------------
 * Keeps route handlers small and gives Central Brain a single import for
 * etfMarkets / goldSpot sources. Read-only: no order, quote-for-trade, or
 * execution path lives here.
 */

import {
  ALL_ETF_SYMBOLS,
  ETF_UNIVERSE,
  alphaVantageConfigured,
  alphaVantageHealth,
  etfCategory,
  fetchEtfProfile,
  fetchEtfQuote,
  fetchEtfUniverse,
  fetchGoldHistory,
  fetchGoldSpot,
  getAlphaVantageProbeState,
  isKnownEtf,
  probeAlphaVantage,
  recordAlphaVantageProbe,
  AlphaVantageError,
  AV_PROVIDER,
  AV_SCHEMA,
  TTL
} from './providers/alphaVantage.js';

export {
  ALL_ETF_SYMBOLS,
  ETF_UNIVERSE,
  alphaVantageConfigured,
  isKnownEtf,
  etfCategory,
  TTL,
  AV_PROVIDER,
  AV_SCHEMA
};

function errBody(err, fallback = 'UPSTREAM_FAILED') {
  const code = err?.code || fallback;
  const status =
    code === 'PROVIDER_NOT_CONFIGURED' ? 503
      : code === 'SYMBOL_NOT_ALLOWLISTED' ? 400
        : code === 'RATE_LIMITED' ? 429
          : code === 'TIMEOUT' ? 504
            : 502;
  return {
    status,
    body: {
      ok: false,
      error: code,
      detail: String(err?.detail || err?.message || code).slice(0, 160),
      provider: AV_PROVIDER,
      schema: AV_SCHEMA,
      readOnly: true,
      executes: false,
      /* Never echo anything that could contain a key. */
      meta: {
        provider: AV_PROVIDER,
        schema: AV_SCHEMA,
        fetchedAt: Date.now(),
        cached: false,
        stale: false,
        cacheAgeMs: 0,
        delayed: true,
        realtime: false
      }
    }
  };
}

export async function getEtfList({ category = null } = {}) {
  if (!alphaVantageConfigured()) {
    return {
      ok: false,
      status: 503,
      error: 'PROVIDER_NOT_CONFIGURED',
      message: 'منبع داده ETF تنظیم نشده — ALPHA_VANTAGE_API_KEY is not set on the server',
      messageEn: 'ETF data source is not configured',
      symbols: ALL_ETF_SYMBOLS,
      universe: ETF_UNIVERSE,
      readOnly: true,
      executes: false,
      provider: AV_PROVIDER,
      schema: AV_SCHEMA
    };
  }
  try {
    const data = await fetchEtfUniverse({ category: category || null });
    recordAlphaVantageProbe(true, { kind: 'etf-universe' });
    return {
      ok: true,
      ...data,
      universe: ETF_UNIVERSE,
      message: data.meta?.stale ? 'آخرین داده معتبر' : null,
      messageEn: data.meta?.stale ? 'Last valid data (stale cache)' : null
    };
  } catch (err) {
    recordAlphaVantageProbe(false, { error: err?.code || 'ETF_LIST_FAILED' });
    const { status, body } = errBody(err, 'ETF_LIST_FAILED');
    return { ...body, status, universe: ETF_UNIVERSE, symbols: ALL_ETF_SYMBOLS };
  }
}

export async function getEtfQuote(symbol) {
  if (!alphaVantageConfigured()) {
    return {
      ok: false,
      status: 503,
      error: 'PROVIDER_NOT_CONFIGURED',
      message: 'منبع داده ETF تنظیم نشده',
      readOnly: true,
      executes: false,
      provider: AV_PROVIDER,
      schema: AV_SCHEMA
    };
  }
  try {
    const data = await fetchEtfQuote(symbol);
    recordAlphaVantageProbe(true, { kind: 'etf-quote' });
    return {
      ok: true,
      ...data,
      message: data.meta?.stale ? 'آخرین داده معتبر' : null,
      messageEn: data.meta?.stale ? 'Last valid data (stale cache)' : null
    };
  } catch (err) {
    if (err?.code !== 'SYMBOL_NOT_ALLOWLISTED') {
      recordAlphaVantageProbe(false, { error: err?.code || 'ETF_QUOTE_FAILED' });
    }
    const { status, body } = errBody(err, 'ETF_QUOTE_FAILED');
    return { ...body, status };
  }
}

export async function getEtfProfile(symbol) {
  if (!alphaVantageConfigured()) {
    return {
      ok: false,
      status: 503,
      error: 'PROVIDER_NOT_CONFIGURED',
      message: 'منبع داده ETF تنظیم نشده',
      readOnly: true,
      executes: false,
      provider: AV_PROVIDER,
      schema: AV_SCHEMA
    };
  }
  try {
    const data = await fetchEtfProfile(symbol);
    recordAlphaVantageProbe(true, { kind: 'etf-profile' });
    return {
      ok: true,
      ...data,
      message: data.meta?.stale ? 'آخرین داده معتبر' : null,
      messageEn: data.meta?.stale ? 'Last valid data (stale cache)' : null
    };
  } catch (err) {
    if (err?.code !== 'SYMBOL_NOT_ALLOWLISTED') {
      recordAlphaVantageProbe(false, { error: err?.code || 'ETF_PROFILE_FAILED' });
    }
    const { status, body } = errBody(err, 'ETF_PROFILE_FAILED');
    return { ...body, status };
  }
}

export async function getGoldSpot() {
  if (!alphaVantageConfigured()) {
    return {
      ok: false,
      status: 503,
      error: 'PROVIDER_NOT_CONFIGURED',
      message: 'منبع داده طلا تنظیم نشده — ALPHA_VANTAGE_API_KEY is not set on the server',
      messageEn: 'Gold data source is not configured',
      readOnly: true,
      executes: false,
      provider: AV_PROVIDER,
      schema: AV_SCHEMA
    };
  }
  try {
    const data = await fetchGoldSpot();
    recordAlphaVantageProbe(true, { kind: 'gold-spot' });
    return {
      ok: true,
      ...data,
      message: data.meta?.stale ? 'آخرین داده معتبر' : null,
      messageEn: data.meta?.stale ? 'Last valid data (stale cache)' : null
    };
  } catch (err) {
    recordAlphaVantageProbe(false, { error: err?.code || 'GOLD_SPOT_FAILED' });
    const { status, body } = errBody(err, 'GOLD_SPOT_FAILED');
    return { ...body, status };
  }
}

export async function getGoldHistory({ interval = 'daily' } = {}) {
  if (!alphaVantageConfigured()) {
    return {
      ok: false,
      status: 503,
      error: 'PROVIDER_NOT_CONFIGURED',
      message: 'منبع داده طلا تنظیم نشده',
      readOnly: true,
      executes: false,
      provider: AV_PROVIDER,
      schema: AV_SCHEMA
    };
  }
  try {
    const data = await fetchGoldHistory({ interval });
    recordAlphaVantageProbe(true, { kind: 'gold-history' });
    return {
      ok: true,
      ...data,
      message: data.meta?.stale ? 'آخرین داده معتبر' : null,
      messageEn: data.meta?.stale ? 'Last valid data (stale cache)' : null
    };
  } catch (err) {
    recordAlphaVantageProbe(false, { error: err?.code || 'GOLD_HISTORY_FAILED' });
    const { status, body } = errBody(err, 'GOLD_HISTORY_FAILED');
    return { ...body, status };
  }
}

export function getEtfGoldStatus() {
  const probe = getAlphaVantageProbeState();
  const health = alphaVantageHealth({
    hasValidCache: probe.lastOkAt > 0,
    servingStale: false
  });
  return {
    ok: health.status === 'HEALTHY' || health.status === 'DEGRADED',
    ...health,
    probe,
    provider: AV_PROVIDER,
    schema: AV_SCHEMA,
    ttl: TTL,
    universe: {
      bitcoin: ETF_UNIVERSE.bitcoin.length,
      ethereum: ETF_UNIVERSE.ethereum.length,
      goldEtfs: ETF_UNIVERSE.gold.length,
      spotMetal: ['XAU']
    },
    readOnly: true,
    executes: false
  };
}

export async function runEtfGoldProbe() {
  return probeAlphaVantage();
}

/** CI source shape: ETF markets for the brain. */
export async function etfMarketsSource() {
  if (!alphaVantageConfigured()) {
    return { ok: false, code: 'PROVIDER_NOT_CONFIGURED', detail: 'ALPHA_VANTAGE_API_KEY not set' };
  }
  try {
    const data = await fetchEtfUniverse({});
    recordAlphaVantageProbe(true, { kind: 'etf-universe' });
    const instruments = (data.rows || []).map((r) => ({
      symbol: r.symbol,
      name: r.name,
      priceUsd: r.priceUsd,
      change24hPct: r.changePct,
      category: r.category,
      assetClass: 'etf',
      latestTradingDay: r.latestTradingDay || null,
      volume: r.volume ?? null,
      currency: 'USD'
    }));
    return {
      ok: instruments.length > 0,
      code: instruments.length ? null : 'NO_ETF_QUOTES',
      instruments,
      rows: instruments,
      byCategory: data.byCategory || null,
      count: instruments.length,
      partial: data.partial === true,
      failed: data.failed || [],
      stale: data.meta?.stale === true,
      staleReason: data.meta?.staleReason || null,
      readOnly: true,
      executes: false,
      venue: AV_PROVIDER,
      source: `etf-feed:${AV_PROVIDER}`,
      provider: AV_PROVIDER,
      schema: AV_SCHEMA,
      meta: data.meta,
      at: Date.now()
    };
  } catch (err) {
    recordAlphaVantageProbe(false, { error: err?.code || 'ETF_FEED_FAILED' });
    return {
      ok: false,
      code: err?.code || 'ETF_FEED_FAILED',
      detail: String(err?.detail || err?.message || '').slice(0, 160),
      source: `etf-feed:${AV_PROVIDER}`,
      at: Date.now()
    };
  }
}

/** CI source shape: gold spot as a commodities-compatible instrument row. */
export async function goldSpotSource() {
  if (!alphaVantageConfigured()) {
    return { ok: false, code: 'PROVIDER_NOT_CONFIGURED', detail: 'ALPHA_VANTAGE_API_KEY not set' };
  }
  try {
    const data = await fetchGoldSpot();
    recordAlphaVantageProbe(true, { kind: 'gold-spot' });
    const spot = data.spot;
    const instrument = {
      symbol: 'XAU',
      name: 'Gold Spot',
      priceUsd: spot.priceUsd,
      change24hPct: spot.changePct ?? null,
      category: 'commodities',
      assetClass: 'commodities',
      kind: 'spot_metal',
      unit: 'USD per troy ounce',
      currency: 'USD'
    };
    return {
      ok: true,
      instrument,
      instruments: [instrument],
      rows: [instrument],
      spot,
      stale: data.meta?.stale === true,
      staleReason: data.meta?.staleReason || null,
      readOnly: true,
      executes: false,
      venue: AV_PROVIDER,
      source: `gold-feed:${AV_PROVIDER}`,
      provider: AV_PROVIDER,
      schema: AV_SCHEMA,
      meta: data.meta,
      at: Date.now()
    };
  } catch (err) {
    recordAlphaVantageProbe(false, { error: err?.code || 'GOLD_FEED_FAILED' });
    return {
      ok: false,
      code: err?.code || 'GOLD_FEED_FAILED',
      detail: String(err?.detail || err?.message || '').slice(0, 160),
      source: `gold-feed:${AV_PROVIDER}`,
      at: Date.now()
    };
  }
}

export { AlphaVantageError, getAlphaVantageProbeState, alphaVantageHealth, recordAlphaVantageProbe };
