/**
 * FBT — CROSS-ASSET PRICE READER (Phase 217).
 * ---------------------------------------------------------------------------
 * One function that answers «what is GOLD trading at?» with the same honesty
 * the crypto path already has, and — the part that matters — with the same
 * REFUSAL when there is no feed.
 *
 * Before this module the only priced asset in the whole app was a CoinGecko
 * id. Gold, the dollar index, WTI, a stock, a tokenised treasury: none of
 * them could be read, so none of them could be watched, so «اگر طلا ۵٪ اصلاح
 * کرد…» was a sentence the AI could classify and never act on. RWA / stocks /
 * forex / commodities had pages; they had no price in the decision path.
 *
 * THREE READ PATHS, in the order the registry declares them:
 *   crypto   providers.fetchSimplePrices([coinId])        — the existing rail
 *   macro    server/macroData.js (stooq → yahoo → FRED)   — gold, DXY, WTI, SPX
 *   global   the global-intel domain, read THROUGH the brain
 *            (Avantis equities, Ostium FX / metals / RWA)
 *   none     no feed. `{ ok:false, code:'NO_FEED_FOR_INSTRUMENT' }` — never a
 *            number, never a stale carry-over, never a default.
 *
 * Everything is injectable (`cryptoPrices`, `macroQuotes`, `globalSnapshot`,
 * `fetchPrices`, `fetchMacro`) so a probe can drive it with fixtures and the
 * runtime can drive it with live reads through the same code.
 *
 * This module READS. It never signs, never quotes a fee, never places an
 * order, and never invents a price when an upstream is quiet.
 */

import { instrumentFor, readPlanFor, isReadable } from '../src/lib/intent-ai/crossAssetInstruments.js';

export const CROSS_ASSET_PRICE_SCHEMA = 'fbt.cross-asset-price.v1';

const num = (v) => {
  /* null must stay null. `Number(null)` is 0, and an allocation whose
     `sizeUsd` is "not given" would then resolve to a zero-dollar plan
     instead of deriving the amount from the percentage — a silent wrong
     answer on real money rather than a loud one. */
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 6) => (v == null ? null : Number(Number(v).toFixed(d)));

/** One honest failure shape, so callers never have to guess what went wrong. */
const fail = (code, detail = null) => ({
  ok: false, value: null, change24hPct: null, source: null, at: null, code, detail
});
const ok = (value, source, at, extra = {}) => ({
  ok: true, value: round(num(value)), source: String(source || 'unknown').slice(0, 60), at: at ?? null, code: null, detail: null, ...extra
});

/**
 * Pull one instrument's price out of a global-intel snapshot domain.
 * The domain rows are `{ symbol, priceUsd, change24hPct, category }`; a
 * symbol match wins, and for the class-level instruments (RWA, TREAS, REALT)
 * the first priced row of the category is used and NAMED, so the number is
 * always attributable to something the feed actually reported.
 */
export function priceFromGlobalSnapshot(symbol, globalSnapshot = null) {
  const inst = instrumentFor(symbol);
  if (!inst || !globalSnapshot || typeof globalSnapshot !== 'object') return null;
  const plan = readPlanFor(symbol);
  const wanted = (plan?.chain || []).filter((c) => c.kind === 'global');
  const domains = globalSnapshot.domains || {};
  for (const p of wanted) {
    const domain = domains[p.domain];
    if (!domain || domain.status !== 'OK') continue;
    const rows = Array.isArray(domain.data?.instruments) ? domain.data.instruments : [];
    const upper = String(symbol).toUpperCase();
    const bySymbol = rows.find((r) => String(r?.symbol || '').toUpperCase() === upper && num(r?.priceUsd) !== null);
    if (bySymbol) {
      return ok(bySymbol.priceUsd, domain.source || `global-intel:${p.domain}`, domain.at || null,
        { change24hPct: round(num(bySymbol.change24hPct), 4), via: `global:${p.domain}:${bySymbol.symbol}` });
    }
    /* Class-level instrument: any priced row of that category stands in, and
       the row's own symbol is reported so nobody can mistake the proxy for a
       direct quote of the generic instrument. */
    if (p.category) {
      const inCategory = rows.find((r) => num(r?.priceUsd) !== null
        && (String(r?.category || '').toLowerCase() === String(p.category).toLowerCase() || p.domain === 'rwa'));
      if (inCategory) {
        return ok(inCategory.priceUsd, domain.source || `global-intel:${p.domain}`, domain.at || null,
          { change24hPct: round(num(inCategory.change24hPct), 4), via: `global:${p.domain}:${inCategory.symbol}`, proxiedBy: String(inCategory.symbol).toUpperCase() });
      }
    }
  }
  return null;
}

/** Pull one instrument's price out of a `fetchMacroQuotes()` payload. */
export function priceFromMacroQuotes(symbol, macroQuotes = null) {
  const inst = instrumentFor(symbol);
  if (!inst) return null;
  const wanted = (readPlanFor(symbol)?.chain || []).find((c) => c.kind === 'macro');
  if (!wanted) return null;
  const items = Array.isArray(macroQuotes?.items) ? macroQuotes.items
    : (Array.isArray(macroQuotes) ? macroQuotes : []);
  const row = items.find((r) => String(r?.symbol || '').toUpperCase() === wanted.symbol.toUpperCase() && num(r?.priceUsd) !== null);
  if (!row) return null;
  return ok(row.priceUsd, row.source || macroQuotes?.source || 'macroData', row.at || macroQuotes?.at || null,
    { change24hPct: round(num(row.change1dPct), 4), via: `macro:${wanted.symbol}` });
}

/**
 * Read every named instrument once, through whichever path its registry row
 * declares. Returns a plain object keyed by symbol.
 *
 * A symbol the registry does not know is `UNKNOWN_INSTRUMENT`. A symbol the
 * registry knows but no feed serves is `NO_FEED_FOR_INSTRUMENT`. Neither is
 * ever a number — that distinction is the whole reason this file exists.
 */
export async function readCrossAssetPrices(symbols = [], {
  cryptoPrices = null,
  macroQuotes = null,
  globalSnapshot = null,
  fetchPrices = null,
  fetchMacro = null,
  now = Date.now()
} = {}) {
  const list = (Array.isArray(symbols) ? symbols : [symbols])
    .map((s) => String(s || '').toUpperCase())
    .filter(Boolean)
    .slice(0, 24);
  const out = {};
  for (const s of list) {
    const inst = instrumentFor(s);
    if (!inst) { out[s] = { ...fail('UNKNOWN_INSTRUMENT', `${s} is not in the cross-asset registry`), assetClass: null }; continue; }
    out[s] = { ...fail('NO_FEED_FOR_INSTRUMENT', `${s} has no configured price feed in this deployment`), assetClass: inst.assetClass };
  }

  const plan = {};
  for (const s of list) {
    const p = readPlanFor(s);
    if (p) plan[s] = p;
  }

  /* ── crypto: one batched call for every coin id ────────────────────────── */
  const coinIds = [...new Set(Object.values(plan)
    .flatMap((p) => p.chain.filter((c) => c.kind === 'crypto').map((c) => c.coinId)))];
  let priceMap = cryptoPrices;
  if (coinIds.length) {
    if (!priceMap && fetchPrices) {
      try { priceMap = await fetchPrices(coinIds); } catch { priceMap = null; }
    }
    if (!priceMap) {
      try {
        const { fetchSimplePrices } = await import('./providers.js');
        priceMap = await fetchSimplePrices(coinIds);
      } catch { priceMap = null; }
    }
    for (const [s, p] of Object.entries(plan)) {
      const c = p.chain.find((x) => x.kind === 'crypto');
      if (!c) continue;
      const v = num(priceMap?.[c.coinId]?.usd);
      if (v !== null && v > 0) {
        out[s] = ok(v, priceMap?.[c.coinId]?.source || 'coingecko', now,
          { assetClass: p.assetClass, change24hPct: round(num(priceMap?.[c.coinId]?.usd_24h_change), 4), via: `crypto:${c.coinId}` });
      }
    }
  }

  /* ── macro: gold / DXY / WTI / SPX, keyless upstreams ──────────────────── */
  const macroSymbols = Object.entries(plan).filter(([, p]) => p.chain.some((c) => c.kind === 'macro') && !out[p.symbol]?.ok);
  if (macroSymbols.length) {
    let quotes = macroQuotes;
    if (!quotes) {
      if (fetchMacro) {
        try { quotes = await fetchMacro(); } catch { quotes = null; }
      } else {
        try {
          const mod = await import('./macroData.js');
          quotes = await mod.fetchMacroQuotes();
        } catch { quotes = null; }
      }
    }
    for (const [s] of macroSymbols) {
      const got = priceFromMacroQuotes(s, quotes);
      if (got) out[s] = { ...got, assetClass: out[s].assetClass };
    }
  }

  /* ── global: the brain's equities / FX / metals / RWA read ─────────────── */
  for (const [s, p] of Object.entries(plan)) {
    if (out[s]?.ok) continue;
    if (!p.chain.some((c) => c.kind === 'global')) continue;
    const got = priceFromGlobalSnapshot(s, globalSnapshot);
    if (got) out[s] = { ...got, assetClass: p.assetClass };
  }

  return out;
}

/** True when the registry says a feed exists (used to refuse at CREATE time,
 *  before a single network call is made). */
export function canRead(symbol) {
  return isReadable(symbol);
}

export { instrumentFor, readPlanFor };
