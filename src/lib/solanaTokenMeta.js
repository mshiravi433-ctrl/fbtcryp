/**
 * SOLANA TOKEN METADATA, CLIENT SIDE — names, logos, and an AI opinion.
 * ========================================================================
 *
 * WHY A CLIENT LIB AND NOT JUST fetch() IN THE PICKER
 * The picker (SolanaTokenPicker) is the only renderer, but the swap screen
 * ALSO wants a sentiment line under the selected pair, and the import flow
 * wants the same metadata a search row carries. One module owns the endpoint,
 * the session cache and the never-throw contract, so three callers cannot
 * drift into three error behaviours.
 *
 * THE NEVER-THROW CONTRACT
 * Every function resolves to null / [] on ANY failure — no backend deployed,
 * a 404 from an older deployment, a timeout on a blocked network. The picker
 * is a browsing surface: an empty answer degrades to «import by address», the
 * way the screen worked before this module existed. It must never turn a
 * cosmetic miss into a thrown error on a money screen.
 *
 * Data comes through OUR origin (`apiBase()`), the same rule as every other
 * client module since apiBase.js: inside the packaged APK a relative '/api'
 * points at the phone's own asset server, and apiBase() is the one place that
 * knows the honest origin.
 */

import { apiBase } from './apiBase.js';

/** One result row, normalised for the UI. `sentiment` rides along already
    scored server-side, so a row renders with zero extra requests. */
function normalizeRow(r) {
  if (!r || typeof r !== 'object') return null;
  const mint = typeof r.mint === 'string' ? r.mint : '';
  if (!mint) return null;
  return {
    mint,
    symbol: typeof r.symbol === 'string' ? r.symbol : null,
    name: typeof r.name === 'string' ? r.name : null,
    icon: typeof r.icon === 'string' ? r.icon : null,
    decimals: Number.isInteger(r.decimals) ? r.decimals : null,
    verified: r.verified === true,
    usdPrice: Number.isFinite(r.usdPrice) ? r.usdPrice : null,
    liquidity: Number.isFinite(r.liquidity) ? r.liquidity : null,
    holders: Number.isFinite(r.holders) ? r.holders : null,
    priceChange24h: Number.isFinite(r.priceChange24h) ? r.priceChange24h : null,
    organicScore: Number.isFinite(r.organicScore) ? r.organicScore : null,
    isMeme: r.isMeme === true,
    sentiment: r.sentiment && typeof r.sentiment === 'object' ? r.sentiment : null
  };
}

const searchCache = new Map();
const SEARCH_TTL_MS = 120_000;

/**
 * Search Jupiter's token index through our own backend.
 *
 * @param {string} query a symbol, a name, or a full mint address
 * @returns {Promise<Array<object>>} rows (possibly empty — never throws)
 */
export async function searchSolanaTokenMeta(query) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.rows;

  let rows = [];
  try {
    const res = await fetch(`${apiBase()}/solana/token-search?query=${encodeURIComponent(q)}`, {
      headers: { accept: 'application/json' }
    });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.ok && Array.isArray(body.rows)) rows = body.rows.map(normalizeRow).filter(Boolean);
    }
  } catch { /* the empty array IS the error path — see the contract above */ }

  searchCache.set(key, { at: Date.now(), rows });
  return rows;
}

const sentimentCache = new Map();
const SENTIMENT_TTL_MS = 10 * 60_000;

/**
 * Metadata for a KNOWN list of mints, in ONE request.
 *
 * The curated swap list ships with no artwork — the mint account cannot carry
 * an image and nobody typed one in. The picker wants real logos for exactly
 * those tokens, and Jupiter's search answers comma-joined mints in one call,
 * so the whole curated list costs one request, cached at the edge.
 *
 * @returns {Promise<Map<string, object>>} mint → meta row (possibly empty)
 */
export async function fetchSolanaTokensMeta(mints) {
  const list = [...new Set((Array.isArray(mints) ? mints : []).map((m) => String(m || '').trim()).filter(Boolean))].slice(0, 100);
  const out = new Map();
  if (!list.length) return out;
  let rows = [];
  try {
    const res = await fetch(`${apiBase()}/solana/token-search?mints=${encodeURIComponent(list.join(','))}`, {
      headers: { accept: 'application/json' }
    });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.ok && Array.isArray(body.rows)) rows = body.rows.map(normalizeRow).filter(Boolean);
    }
  } catch { /* empty map is the contract */ }
  for (const row of rows) out.set(row.mint, row);
  return out;
}
/**
 * The AI sentiment for one mint: a deterministic score + drivers, plus — when
 * the backend has an AI key — one short generated sentence, labelled by the
 * caller. Null when unreadable; the UI hides the strip, never guesses.
 */
export async function fetchSolanaTokenSentiment(mint, { lang = 'fa' } = {}) {
  const m = String(mint ?? '').trim();
  if (!m) return null;
  const key = `${m}|${lang}`;
  const hit = sentimentCache.get(key);
  if (hit && Date.now() - hit.at < SENTIMENT_TTL_MS) return hit.value;

  let value = null;
  try {
    const res = await fetch(`${apiBase()}/solana/token-sentiment?mint=${encodeURIComponent(m)}&lang=${encodeURIComponent(lang)}`, {
      headers: { accept: 'application/json' }
    });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.ok) {
        value = {
          mint: m,
          score: Number.isFinite(body.sentiment?.score) ? body.sentiment.score : null,
          label: typeof body.sentiment?.label === 'string' ? body.sentiment.label : 'unknown',
          drivers: Array.isArray(body.sentiment?.drivers) ? body.sentiment.drivers : [],
          hasData: body.sentiment?.data === true,
          aiText: typeof body.ai?.text === 'string' && body.ai.text ? body.ai.text : null
        };
      }
    }
  } catch { /* null is the contract */ }

  sentimentCache.set(key, { at: Date.now(), value });
  return value;
}

/** Test hook — the caches are module-global on purpose, but a test needs a way
    back to a clean slate without re-importing the world. */
export function _resetSolanaTokenMetaClientCaches() {
  searchCache.clear();
  sentimentCache.clear();
}
