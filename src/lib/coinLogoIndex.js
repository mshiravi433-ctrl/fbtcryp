/*
 * BULK LOGO INDEX — one request that can put a face on every row.
 *
 * ─── THE HOLE THIS FILLS ────────────────────────────────────────────────────
 * The fallback market rows come from CoinLore tickers, which carry no artwork.
 * CoinGecko can supply a logo per coin, but only ONE COIN PER REQUEST
 * (`/search?query=`), on a tier that answers about thirty calls a minute — so
 * a 250-row page needs eight minutes of logo lookups, and the screen shows
 * monograms for all of it. The rows the vendored brand set already covers keep
 * their real marks (see components/CoinLogo.jsx); the rest waited on that
 * queue, which is what «بقیه توکن‌ها لوگو ندارن» is.
 *
 * A coin-list endpoint answers the whole question at once: thousands of
 * tickers, each with the artwork URL, in a single keyless request. This module
 * keeps that response for a day and hands it to the rows.
 *
 * ─── SYMBOL MATCHING, WITH A NAME GUARD ─────────────────────────────────────
 * The list is keyed by ticker, and two different projects can share one
 * ticker (`/search?query=BTC` returns half a dozen "BTC" impostors). A logo
 * is only attached when BOTH agree:
 *
 *   • the ticker matches exactly, and
 *   • the row's name equals (or contains / is contained by) one of the names
 *     the list gives for that ticker.
 *
 * A row whose name does not line up is left without a logo. A monogram is a
 * worse picture and a better answer than another coin's face.
 *
 * ─── FAIL-SILENT ────────────────────────────────────────────────────────────
 * Unreachable host, changed shape, oversized payload, a name we cannot
 * verify — all of it leaves the row exactly as it arrived. This layer can only
 * ever add an image URL; it never touches a number.
 */

const LIST_URL = 'https://min-api.cryptocompare.com/data/all/coinlist?summary=true';
const IMAGE_HOST = 'https://www.cryptocompare.com';

/** The list changes when a project rebrands, not hourly. */
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

/** A dead host stays dead for a while — this is a nice-to-have, not a gate. */
const BREAKER_MS = 15 * 60 * 1000;

/** Refuse absurd payloads rather than parsing them on a serverless box. */
const MAX_BYTES = 12 * 1024 * 1024;

let index = null;
let inflight = null;
let blockedUntil = 0;

const nowMs = () => Date.now();

/** Tests and hard resets only. */
export function clearLogoIndex() {
  index = null;
  inflight = null;
  blockedUntil = 0;
}

/** Case- and punctuation-insensitive form used for the name guard. */
function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function namesAgree(rowName, entry) {
  const mine = normalizeName(rowName);
  if (!mine || mine.length < 2) return false;
  for (const candidate of [entry?.Name, entry?.CoinName, entry?.FullName]) {
    const theirs = normalizeName(candidate);
    if (!theirs) continue;
    if (theirs === mine) return true;
    /* "Binance Coin" vs "Binance Coin (BNB)" — containment in either
       direction, but only for names long enough to mean something. */
    if (mine.length >= 4 && theirs.includes(mine)) return true;
    if (theirs.length >= 4 && mine.includes(theirs)) return true;
  }
  return false;
}

function imageUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const absolute = /^https:\/\//i.test(value)
    ? value
    : /^\//.test(value)
      ? `${IMAGE_HOST}${value}`
      : null;
  return absolute && /^https:\/\//i.test(absolute) ? absolute : null;
}

function buildIndex(payload) {
  const data = payload?.Data && typeof payload.Data === 'object' ? payload.Data : null;
  if (!data) return null;
  const map = new Map();
  for (const entry of Object.values(data)) {
    const symbol = String(entry?.Symbol || '').toUpperCase();
    const image = imageUrl(entry?.ImageUrl);
    /* First entry per ticker wins; the list itself is keyed by ticker, so a
       duplicate here means two rows claimed the same symbol. */
    if (symbol && image && !map.has(symbol)) map.set(symbol, { image, entry });
  }
  return map.size ? map : null;
}

/**
 * The ticker → artwork map, fetched once a day, single-flight, fail-silent.
 * Returns null when the index is unavailable — callers treat that as "no
 * logos from here", never as an error.
 */
export async function loadLogoIndex({ fetchJson, timeoutMs } = {}) {
  if (index && nowMs() - index.at < INDEX_TTL_MS) return index.map;
  if (typeof fetchJson !== 'function') return null;
  if (nowMs() < blockedUntil) return null;
  if (inflight) return inflight;

  inflight = (async () => {
    const raw = await fetchJson(LIST_URL, { timeoutMs });
    let parsed = raw;
    if (typeof raw === 'string') {
      if (raw.length > MAX_BYTES) throw new Error('logo index too large');
      parsed = JSON.parse(raw);
    }
    const map = buildIndex(parsed);
    if (!map) throw new Error('logo index had no usable entries');
    index = { at: nowMs(), map };
    return map;
  })()
    .catch(() => {
      blockedUntil = nowMs() + BREAKER_MS;
      return null;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * Attach artwork to rows that have none.
 *
 * @param {Array<object>} rows  live market rows
 * @param {object} opts
 * @param {(url: string, opts?: object) => Promise<any>} opts.fetchJson
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<Array<object>>} rows; unmatched rows are unchanged
 */
export async function attachIndexLogos(rows = [], { fetchJson, timeoutMs } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const map = await loadLogoIndex({ fetchJson, timeoutMs });
  if (!map) return list;
  return list.map((row) => {
    if (!row || row.image) return row;
    const hit = map.get(String(row.symbol || '').toUpperCase());
    if (!hit || !namesAgree(row.name, hit.entry)) return row;
    return { ...row, image: hit.image, imageSource: 'cryptocompare-list' };
  });
}
