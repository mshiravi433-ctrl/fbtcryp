/**
 * SOLANA ON-CHAIN INTELLIGENCE — whales, holders and DEX flow, from Solscan.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS IS FOR ─────────────────────────────────────────────────────
 * The Signals page already reads PRICE and STRUCTURE from the chart. It cannot
 * read POSITIONING: who is accumulating, how concentrated ownership is, whether
 * the DEX order flow leans buy or sell. Those are on-chain facts, and on Solana
 * the only place to read them cleanly is Solscan's indexed Pro API.
 *
 * This module turns four Solscan endpoints into four small, honest metrics that
 * the signal card renders — and it renders NONE of them when the data is not
 * really there. That fail-closed rule is the whole point: an invented "whales
 * are buying" line next to a real price is worse than no line at all.
 *
 * ─── WHY THIS RUNS ON THE SERVER ───────────────────────────────────────────
 * The Solscan key is a paid secret. A VITE_ variable is compiled into the
 * browser bundle (and the APK), so the key can NEVER live on the client. It is
 * read here from `process.env.SOLSCAN_API_KEY` and used only to authenticate
 * the upstream call — it is never echoed in a response body, a log line or an
 * error message. Without it the routes answer `{ configured:false }` and the
 * card simply hides the on-chain row, exactly as if the upstream were down.
 *
 * ─── NOTHING HERE IS FABRICATED ────────────────────────────────────────────
 * Every number is pulled from a real Solscan field and dropped (set to null,
 * which the client hides) the moment that field is missing or unparseable.
 * Exchange / wallet labels come ONLY from Solscan's own nametag field; an
 * address Solscan has not labelled stays "نامشخص" / "Unknown" — the same rule
 * as server/whales.js. We never guess a label, a direction or a percentage.
 *
 * @see server/whales.js for the fail-closed + label discipline this mirrors.
 */
import { withCache } from './cache.js';

const SOLSCAN_BASE = String(process.env.SOLSCAN_BASE || 'https://pro-api.solscan.io/v2.0');
/*
 * THE KEY, READ AT CALL TIME, NOT IMPORT TIME.
 *
 * Trimmed: a trailing newline in the env store changes the auth header and
 * every call silently 401s (see run.mjs's bot-token note for the same class
 * of bug). Read here rather than captured at module load so the probe can
 * exercise both the configured and unconfigured paths in one process, and so
 * a key added to the environment takes effect without a re-import. It is the
 * ONLY place the key is read — never VITE_, never logged, never returned.
 */
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

function solscanKey() {
  return String(process.env.SOLSCAN_API_KEY || '').trim();
}

/* Five minutes, matching the perp feed: on-chain positioning moves intraday
   but not second-to-second, and Solscan credits are metered. */
const TTL_MS = 300_000;

/** The curated Solana assets the Signals page offers in its Solana tab. */
export const SOLANA_SIGNAL_MINTS = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', coingeckoId: 'solana' },
  { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbHedAuSjReC', coingeckoId: 'jupiter-exchange-solana' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', coingeckoId: 'bonk' },
  { symbol: 'JTO', mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', coingeckoId: 'jito-governance-token' },
  { symbol: 'PYTH', mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', coingeckoId: 'pyth-network' },
  { symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', coingeckoId: 'dogwifcoin' },
  { symbol: 'RAY', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', coingeckoId: 'raydium' }
];

/**
 * A fetch seam the test suite overrides (see `__setSolscanFetchForTests`).
 * The production path uses the global; the probe hands in a fake that returns
 * canned JSON so the extraction can be asserted without spending a credit.
 */
let fetchImpl = (url, opts) => globalThis.fetch(url, opts);

/** Test-only fetch override. Restored with `__setSolscanFetchForTests(null)`. */
export function __setSolscanFetchForTests(fn) {
  fetchImpl = fn || ((url, opts) => globalThis.fetch(url, opts));
}

export function solscanConfigured() {
  return solscanKey().length > 0;
}

/**
 * One Solscan v2 call. Throws on any failure so withCache can fall back to a
 * stale copy; the route handler translates a thrown NOT_CONFIGURED into the
 * honest `{ configured:false }` shape rather than a 502.
 *
 * The auth header is Solscan's own: `token: <key>`.
 */
async function solscan(path, params = {}) {
  const key = solscanKey();
  if (!key) {
    const err = new Error('NOT_CONFIGURED');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const query = qs.toString();
  const url = `${SOLSCAN_BASE}${path}${query ? `?${query}` : ''}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', token: key }
    });
    if (!res.ok) throw new Error(`Solscan ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ─── small, defensive number/label helpers ──────────────────────────────── */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A Solscan owner label, or null. Solscan attaches nametags to well-known
 * accounts (Binance, Wintermute, Raydium pools…). The exact key has varied
 * across API versions, so we check the candidates Solscan's docs name and use
 * the first real string — never inventing one when none is present. This is the
 * "unknown address stays Unknown" rule from server/whales.js.
 */
function ownerLabel(row, side /* 'from' | 'to' */) {
  if (!row || typeof row !== 'object') return null;
  const keys = [
    `${side}_owner_address_label`,
    `${side}_account_label`,
    `${side}_owner_label`,
    `${side}_owner`,
    `${side}_label`
  ];
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim()) return v.name.trim();
  }
  return null;
}

const addr = (row, side) => {
  if (!row || typeof row !== 'object') return null;
  return String(row[`${side}_address`] || row[`${side}_owner_address`] || row[`${side}_account_address`] || '').slice(0, 64) || null;
};

const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

/**
 * Per-mint memory of the last TOP-10 concentration we measured, so a later
 * fetch can report a genuine RISING / FALLING direction rather than a snapshot
 * labelled "trend". Empty on a cold start → change stays null (hidden).
 */
const priorTop10 = new Map();

/* ─── metric builders (each nulls itself out when its data is absent) ─────── */

function buildWhaleFlow(transferRows, decimals) {
  if (!Array.isArray(transferRows) || transferRows.length === 0) return null;
  const dec = num(decimals);

  /* Materialize each transfer with a comparable token amount. */
  const items = [];
  for (const r of transferRows) {
    const raw = num(r.amount ?? r.token_amount);
    if (raw === null) continue;
    const amount = dec && dec > 0 ? raw / 10 ** dec : raw;
    const from = addr(r, 'from');
    const to = addr(r, 'to');
    if (!from || !to) continue;
    items.push({ amount, fromLabel: ownerLabel(r, 'from'), toLabel: ownerLabel(r, 'to') });
  }
  if (items.length === 0) return null;

  /* "Large" = the top quartile by token amount of what Solscan returned. */
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  const cut = Math.max(1, Math.ceil(sorted.length / 4));
  const large = sorted.slice(0, cut);

  /* Direction comes ONLY from real Solscan labels. A labelled exchange as the
     destination reads as distribution (coins leaving the market for a venue);
     a labelled exchange as the source reads as accumulation. Addresses
     Solscan has not tagged cannot contribute a direction, so an unlabelled
     transfer set yields direction:null and the UI shows the count alone. */
  let toVenue = 0;
  let fromVenue = 0;
  let sampleLabel = null;
  for (const t of large) {
    if (t.toLabel) { toVenue += 1; sampleLabel = sampleLabel || t.toLabel; }
    if (t.fromLabel) { fromVenue += 1; sampleLabel = sampleLabel || t.fromLabel; }
  }
  let direction = null;
  if (toVenue || fromVenue) {
    if (toVenue > fromVenue) direction = 'outflow';
    else if (fromVenue > toVenue) direction = 'inflow';
    else direction = 'mixed';
  }

  return { largeTransfers: large.length, direction, sampleLabel };
}

function buildHolderConcentration(holderRows, totalSupply) {
  if (!Array.isArray(holderRows) || holderRows.length === 0) return null;
  const supply = num(totalSupply);
  if (!supply || supply <= 0) return null;

  const shares = [];
  for (const h of holderRows) {
    const raw = num(h.amount ?? h.balance ?? h.value);
    if (raw === null) continue;
    const pct = (raw / supply) * 100;
    if (Number.isFinite(pct)) shares.push(pct);
  }
  if (shares.length === 0) return null;

  shares.sort((a, b) => b - a);
  const topHolderPct = round1(shares[0]);
  const top10Pct = round1(shares.slice(0, 10).reduce((s, p) => s + p, 0));
  return { topHolderPct, top10Pct, shares: shares.length };
}

function buildDexActivity(activityRows, mint) {
  if (!Array.isArray(activityRows) || activityRows.length === 0) return null;

  let buy = 0;
  let sell = 0;
  let volumeUsd = 0;
  let volumeSeen = false;
  let lastAt = null;

  for (const a of activityRows) {
    /* A swap where THIS mint is the token coming OUT (tokens_out) is a BUY of
       the mint; coming IN (tokens_in) is a SELL. Solscan nests the legs under
       activity_type ACTIVITY_TOKEN_SWAP / ACTIVITY_AGG_TOKEN_SWAP. We read the
       leg that names our mint and use its USD value when Solscan provides one. */
    const outLeg = pickLeg(a.tokens_out ?? a.token_out, mint);
    const inLeg = pickLeg(a.tokens_in ?? a.token_in, mint);
    const leg = outLeg || inLeg;
    if (!leg) continue;
    if (outLeg) buy += 1;
    else sell += 1;
    const v = num(leg.value_usd ?? leg.value);
    if (v !== null) { volumeUsd += v; volumeSeen = true; }
    const at = num(a.block_time ?? a.timestamp ?? a.time);
    if (at !== null && (lastAt === null || at > lastAt)) lastAt = at;
  }

  if (!buy && !sell) return null;

  let pressure = null;
  if (buy > sell) pressure = 'buy';
  else if (sell > buy) pressure = 'sell';
  else pressure = 'balanced';

  return {
    swaps: buy + sell,
    pressure,
    volumeUsd: volumeSeen ? Math.round(volumeUsd) : null,
    at: lastAt ? new Date(lastAt * 1000).toISOString() : null
  };
}

/** True when a swap leg concerns our mint. A leg may be an object or an array. */
function pickLeg(leg, mint) {
  if (!leg || typeof leg !== 'object') return null;
  const arr = Array.isArray(leg) ? leg : [leg];
  return arr.find((l) => l && typeof l === 'object'
    && String(l.token_address ?? l.address ?? l.mint ?? '').toLowerCase() === String(mint).toLowerCase()
  ) || null;
}

/**
 * GET /api/solana/intel/:mint → { whaleFlow, holderTrend, topHolderPct, dexActivity }
 *
 * Four Solscan calls, cached together for five minutes. Each metric is built
 * defensively and left null when its source fields are absent, so the card
 * hides whatever it cannot honestly show.
 */
export async function fetchSolanaIntel(mintRaw) {
  const mint = String(mintRaw || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    const err = new Error('BAD_MINT');
    err.code = 'BAD_MINT';
    throw err;
  }
  if (!solscanConfigured()) {
    /* The honest shape the client hides on. No error, no key, no detail. */
    return { configured: false };
  }

  const key = `solscan:intel:${mint}`;
  const { value } = await withCache(key, TTL_MS, async () => {
    /* Run the four reads concurrently; an individual failure zeroes only its
       own metric, never the whole payload (Promise.allSettled semantics). */
    const [transferRes, holderRes, metaRes, defiRes] = await Promise.allSettled([
      solscan('/token/transfer', { address: mint, limit: 40 }),
      solscan('/token/holders', { address: mint, limit: 20 }),
      solscan('/token/meta', { address: mint }),
      solscan('/token/defi/activities', { address: mint, limit: 40 })
    ]);

    const pick = (r) => (r.status === 'fulfilled' ? r.value : null);
    const transferData = pick(transferRes)?.data;
    const holderData = pick(holderRes)?.data;
    const meta = pick(metaRes)?.data ?? pick(metaRes);
    const defiData = pick(defiRes)?.data;

    const decimals = num(meta?.decimals);
    const totalSupply = num(meta?.supply ?? meta?.total_supply ?? meta?.max_supply);
    const totalHolders = num(meta?.holder ?? meta?.holders ?? meta?.holder_amount);

    const whaleFlow = buildWhaleFlow(transferData, decimals);
    const concentration = buildHolderConcentration(holderData, totalSupply);
    const dexActivity = buildDexActivity(defiData, mint);

    /* holderTrend: concentration now, plus a genuine rising/falling change vs
       the PREVIOUS successful snapshot for this mint (kept across the cache TTL
       in a side map). First-ever read → change null → the trend line is hidden. */
    let holderTrend = null;
    if (concentration || totalHolders !== null) {
      const prev = priorTop10.get(mint);
      let change = null;
      if (prev !== undefined && concentration?.top10Pct !== null) {
        const delta = concentration.top10Pct - prev;
        if (Math.abs(delta) >= 0.5) change = delta > 0 ? 'rising' : 'falling';
      }
      if (concentration?.top10Pct !== null) priorTop10.set(mint, concentration.top10Pct);
      holderTrend = {
        totalHolders,
        top10Pct: concentration?.top10Pct ?? null,
        change
      };
    }

    const topHolderPct = concentration?.topHolderPct ?? null;

    return {
      configured: true,
      schema: 'fbt.solana-intel.v1',
      mint,
      updatedAt: new Date().toISOString(),
      whaleFlow,
      holderTrend,
      topHolderPct,
      dexActivity
    };
  });

  return value;
}

/**
 * GET /api/solana/whales → recent large transfers across the curated Solana set.
 *
 * Aggregates each curated mint's recent token transfers, keeps the largest by
 * token amount, and returns them newest-first. A per-mint outage contributes
 * nothing rather than failing the whole feed. Labels come only from Solscan.
 */
export async function fetchSolanaWhales() {
  if (!solscanConfigured()) return { configured: false, schema: 'fbt.solana-whales.v1', transfers: [] };

  const { value } = await withCache('solscan:whales', TTL_MS, async () => {
    const results = await Promise.allSettled(
      SOLANA_SIGNAL_MINTS.map(async ({ symbol, mint, coingeckoId }) => {
        const res = await solscan('/token/transfer', { address: mint, limit: 30 });
        const rows = Array.isArray(res?.data) ? res.data : [];
        const dec = num((await metaSafe(mint))?.decimals);
        return rows
          .map((r) => normalizeTransfer(r, { symbol, mint, coingeckoId, decimals: dec }))
          .filter(Boolean);
      })
    );

    const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    all.sort((a, b) => (b.time ?? 0) - (a.time ?? 0) || b.amountRaw - a.amountRaw);

    return {
      configured: true,
      schema: 'fbt.solana-whales.v1',
      updatedAt: new Date().toISOString(),
      transfers: all.slice(0, 30)
    };
  });

  return value;
}

/* tiny meta cache so the whales feed does not refetch decimals per transfer */
const metaCache = new Map();
async function metaSafe(mint) {
  if (metaCache.has(mint)) return metaCache.get(mint);
  try {
    const res = await solscan('/token/meta', { address: mint });
    const data = res?.data ?? res;
    metaCache.set(mint, data);
    return data;
  } catch {
    metaCache.set(mint, null);
    return null;
  }
}

function normalizeTransfer(r, { symbol, mint, coingeckoId, decimals }) {
  const amountRaw = num(r.amount ?? r.token_amount);
  if (amountRaw === null) return null;
  const dec = num(decimals);
  const amount = dec && dec > 0 ? amountRaw / 10 ** dec : amountRaw;
  const time = num(r.block_time ?? r.timestamp ?? r.time);
  return {
    id: String(r.trans_id ?? r.signature ?? `${mint}:${r.from_address}:${time}`),
    symbol,
    mint,
    coingeckoId,
    fromAddress: addr(r, 'from'),
    toAddress: addr(r, 'to'),
    fromLabel: ownerLabel(r, 'from'),
    toLabel: ownerLabel(r, 'to'),
    amount,
    amountRaw,
    time: time !== null ? time * 1000 : null,
    signature: r.signature ? String(r.signature) : null
  };
}
