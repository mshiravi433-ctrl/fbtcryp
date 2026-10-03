/**
 * THE SOLANA TOKEN UNIVERSE — what the swap screen offers, and how fast.
 * ---------------------------------------------------------------------------
 *   «تعداد توکن ها کم است» (the Solana swap page).
 *
 * The page shipped with three hand-written rows — SOL, USDC, USDT — plus the
 * liquid-staking and tokenized-equity mints, and everything else arrived only
 * if the user already knew an address to paste. On the chain where the trade
 * IS the browse, that is the wrong default.
 *
 * ─── WHY IT IS A CLIENT CACHE AND NOT JUST A FETCH ────────────────────────
 * The catalogue is BROWSE data: names, logos, liquidity, the 24h move. It
 * changes over hours, and it is the payload behind the swap screen's first
 * paint on a phone that may be on a metered connection. So:
 *
 *   • the CURATED list paints FIRST, synchronously, with no network at all —
 *     the screen is never empty and never waits to be usable;
 *   • the remote catalogue merges in when it answers, and is remembered for a
 *     day, so the second visit paints the FULL list with no request at all;
 *   • a failed fetch leaves the curated list exactly as it was. The picker
 *     keeps its paste-a-mint escape hatch, so a network problem costs breadth
 *     and never capability.
 *
 * ─── NEVER A PRICE SOURCE ─────────────────────────────────────────────────
 * Nothing here is what a user signs against. Quotes still come from the live
 * order endpoint at swap time, through the venue's own router. This list only
 * decides what is one tap away and what a row says about itself.
 */

import { apiBase } from './apiBase.js';

/*
 * The curated starting points, defined ONCE.
 *
 * These rows lived inside pages/SolanaSwap.jsx until the Auto Orders screen
 * needed the same five mints. A second copy of a mint address is a second
 * chance to transpose a base58 character, and one of the six equity addresses
 * was wrong on first write — caught only by querying the API. So the list
 * moved here and both screens import it.
 */
import { SOL_MINT, USDC_MINT, USDT_MINT } from './solana.js';
import { COMMODITY_ASSETS, EQUITY_ASSETS, LST_ASSETS } from './solanaAssets.js';

/**
 * Curated starting points. Everything else arrives from the remote catalogue
 * or by pasted mint address.
 *
 * The liquid-staking tokens, the tokenized equities and the tokenized gold
 * mints are spread in from lib/solanaAssets.js rather than retyped: someone
 * who arrives from Stocks with a mint in mind should find it pickable, and
 * the mints with their own Buy buttons must never fall back to USDC.
 *
 * `decimalsVerified: true` — these scales were read from the chain (or from
 * the issuer's own list) when the mint was added, so an amount converted with
 * them may be compared against a balance. A token imported by pasted address
 * starts FALSE and becomes true only when the chain answers.
 */
export const SOLANA_BASE_TOKENS = [
  { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9 },
  { mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: USDT_MINT, symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  ...LST_ASSETS.map(({ mint, symbol, name, decimals }) => ({ mint, symbol, name, decimals })),
  ...EQUITY_ASSETS.map(({ mint, symbol, name, decimals }) => ({ mint, symbol, name, decimals })),
  ...COMMODITY_ASSETS.map(({ mint, symbol, name, decimals }) => ({ mint, symbol, name, decimals }))
].map((tk) => ({ ...tk, decimalsVerified: true }));

const CACHE_KEY = 'fbt-solana-universe-v1';
const DAY = 24 * 60 * 60 * 1000;

/** The shape a row must have to be usable as a swap leg. */
function normalize(row) {
  /* `mint` is our own endpoint's field; `id` is Jupiter's. Accepting both
     means a change of shape upstream degrades to "some rows missing" rather
     than to a silently EMPTY catalogue — the one failure mode here that
     looks like a bug in the app rather than in the data. */
  const mint = String(row?.mint ?? row?.id ?? '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  const symbol = String(row.symbol ?? '').trim().slice(0, 24);
  if (!symbol) return null;
  return {
    mint,
    symbol,
    name: String(row.name ?? symbol).trim().slice(0, 64) || symbol,
    icon: typeof row.icon === 'string' && /^https:\/\//i.test(row.icon) ? row.icon : null,
    /* decimalsVerified is the load-bearing field here. A row whose scale the
       CHAIN has not confirmed is picked and quoted, but the balance check
       refuses to compare against it — see resolveTokenScale in the page. */
    decimals: Number.isInteger(Number(row.decimals)) ? Number(row.decimals) : null,
    decimalsVerified: Number.isInteger(Number(row.decimals)),
    verified: row.verified === true || row.isVerified === true,
    usdPrice: Number.isFinite(Number(row.usdPrice)) ? Number(row.usdPrice) : null,
    liquidity: Number.isFinite(Number(row.liquidity)) ? Number(row.liquidity) : null,
    priceChange24h: Number.isFinite(Number(row.priceChange24h)) ? Number(row.priceChange24h) : null,
    volume24h: Number.isFinite(Number(row.volume24h)) ? Number(row.volume24h) : null
  };
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, rows } = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length || Date.now() - at > DAY) return null;
    return rows.map(normalize).filter(Boolean);
  } catch {
    return null;
  }
}

function writeCache(rows) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    /* quota exhausted on a small device — the in-memory copy still works */
  }
}

let memory = [];
let inflight = null;

/** Whatever we already have, with no network access. Never null. */
export function getSolanaUniverseSync() {
  return memory.length ? memory : readCache() ?? [];
}

/**
 * The full catalogue. Resolves with whatever is known — the cached list if
 * there is one, the curated list otherwise — and refreshes in place through
 * `onReady` when the network answers.
 *
 * @param {(rows: object[]) => void} onReady called when the remote list lands
 */
export async function loadSolanaUniverse(onReady, { timeout = 12000 } = {}) {
  const cached = readCache();
  if (cached?.length) {
    memory = cached;
    onReady?.(cached);
  }

  if (!inflight) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    inflight = fetch(`${apiBase()}/solana/tokens`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const rows = (body?.rows ?? []).map(normalize).filter(Boolean);
        if (!rows.length) return null;
        memory = rows;
        writeCache(rows);
        return rows;
      })
      .catch(() => null)
      .finally(() => {
        clearTimeout(timer);
        inflight = null;
      });
  }

  const fresh = await inflight;
  if (fresh) onReady?.(fresh);
  return memory;
}

/**
 * Merge the catalogue with the curated mints the app ships, in that order.
 *
 * Curated first and never displaced: the assets the Stocks screen and the
 * gold screen hand off BY MINT must keep their identity, artwork and scale
 * even when the upstream ranks them low or renames them. A remote row only
 * ever ADDS to the list.
 */
export function mergeSolanaUniverse(curated = [], remote = []) {
  const seen = new Set();
  const out = [];
  for (const raw of [...curated, ...remote]) {
    const row = typeof raw === 'string'
      ? { mint: raw, symbol: String(raw).slice(0, 4), name: String(raw).slice(0, 4) }
      : raw;
    const mint = String(row?.mint ?? row?.id ?? '').trim();
    if (!mint || seen.has(mint)) continue;
    seen.add(mint);
    out.push(row);
  }
  return out;
}

/** Reset, for tests. */
export function _resetSolanaUniverse() {
  memory = [];
  inflight = null;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* private mode */ }
}
