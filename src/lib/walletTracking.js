/**
 * WALLET TRACKING — «پیگیری کیف پول», as a read rather than a bookmark list.
 * ===========================================================================
 * «Track wallet» writes a row to localStorage and posts it to the server. What
 * the app could not tell the reader afterwards is the thing a watchlist is for:
 *
 *   · is this wallet still doing what made me track it?
 *   · has it gone quiet, or is it just that nothing has been re-read?
 *   · which of my tracked wallets actually moved since I last looked?
 *
 * All three are answerable from data the app already holds, and none of them
 * needs a new endpoint, a new poll or a new timer:
 *
 *   1. A tracked wallet has a BASELINE — the figures it had when the reader
 *      tapped the button. `trackWallet` already stamps `createdAt`; the caller
 *      may attach the snapshot it was looking at. Without a baseline the status
 *      is «unmeasured», never «quiet».
 *   2. A wallet's status is about CHANGE, not size. A $40M wallet that did
 *      nothing this week is quiet; a $40K wallet that tripled is active. Mixing
 *      the two is how a watchlist becomes a leaderboard.
 *   3. SILENCE IS NOT ZERO. A row whose read failed (`dataStatus` not live) is
 *      `unavailable`, and one that has never been read is `pending` — a watchlist
 *      that renders an outage as «۰ تغییر» is lying with a zero.
 *
 * Pure arithmetic over the rows and the payloads already in hand: no fetch, no
 * timer, no storage write. The snapshot is offered to `trackWallet`, which stays
 * the only writer.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A tracked wallet with no fresh read for this long is «stale», not «quiet». */
export const TRACK_STALE_MS = 24 * 3600_000;
/** Change smaller than this is noise, not activity. */
export const TRACK_MOVE_MIN_USD = 25_000;
/** How many wallets a single watchlist read will open at once. */
export const TRACK_MAX_READS = 8;

/**
 * The baseline a tracked row should carry. Attached by the UI at the moment of
 * tracking so a later read can say what CHANGED; every field is optional and a
 * missing one simply makes that comparison unmeasured.
 *
 * @param {object} wallet a `/api/v1/smart-money/wallet/:chain/:address` payload
 */
export function snapshotWallet(wallet) {
  if (!wallet || typeof wallet !== 'object') return null;
  const perf = wallet.performance || {};
  const pnl = wallet.pnl || {};
  return {
    at: Date.now(),
    portfolioUsd: num(wallet.portfolioUsd),
    realizedUsd: num(pnl.realizedUsd) ?? num(perf.realizedUsd),
    closedTrades: num(perf.closedTrades),
    txCount: num(wallet.txCount),
    ageMs: num(wallet.ageMs),
    dataStatus: wallet.dataStatus || null
  };
}

/**
 * One tracked wallet, read against its baseline.
 *
 * @param {object} input
 * @param {object} input.row      the localStorage row ({chain, address, label, createdAt, baseline})
 * @param {object} [input.wallet] a fresh wallet payload, or null if not read
 * @param {number} [input.now]
 */
export function readTrackedWallet({ row = null, wallet = null, now = Date.now() } = {}) {
  if (!row) return null;
  const since = num(row.createdAt) ?? null;
  const baseline = row.baseline && typeof row.baseline === 'object' ? row.baseline : null;
  const trackedForMs = since === null ? null : Math.max(0, now - since);

  /* No payload at all: the row exists and nothing has been read. That is
     `pending`, and it is a different sentence from «no change». */
  if (!wallet) {
    return {
      chain: row.chain ?? null,
      address: row.address ?? null,
      label: row.label || null,
      status: 'pending',
      reason: 'never-read',
      trackedForMs,
      change: null,
      live: false,
      note: null
    };
  }

  const live = wallet.dataStatus === 'live';
  const perf = wallet.performance || {};
  const pnl = wallet.pnl || {};
  const now_ = {
    portfolioUsd: num(wallet.portfolioUsd),
    realizedUsd: num(pnl.realizedUsd) ?? num(perf.realizedUsd),
    closedTrades: num(perf.closedTrades),
    txCount: num(wallet.txCount),
    ageMs: num(wallet.ageMs)
  };

  /* Every delta needs BOTH sides. A comparison against a missing baseline is
     not «۰» — it is the absence of a comparison, and it stays null. */
  const delta = (a, b) => (a === null || b === null ? null : a - b);
  const change = {
    portfolioUsd: delta(now_.portfolioUsd, baseline?.portfolioUsd ?? null),
    realizedUsd: delta(now_.realizedUsd, baseline?.realizedUsd ?? null),
    closedTrades: delta(now_.closedTrades, baseline?.closedTrades ?? null),
    txCount: delta(now_.txCount, baseline?.txCount ?? null)
  };

  const moved = [
    change.portfolioUsd !== null && Math.abs(change.portfolioUsd) >= TRACK_MOVE_MIN_USD,
    change.realizedUsd !== null && Math.abs(change.realizedUsd) >= TRACK_MOVE_MIN_USD,
    change.closedTrades !== null && change.closedTrades > 0,
    change.txCount !== null && change.txCount > 0
  ].some(Boolean);

  const compared = Object.values(change).some((v) => v !== null);
  const age = now_ .ageMs;
  const veryYoung = age !== null && age <= 48 * 3600_000;

  /* The status ladder, strongest claim first. `unavailable` outranks everything
     because an outage is not a statement about the wallet. */
  let status = 'quiet';
  let reason = 'no-measured-change';
  if (!live) { status = 'unavailable'; reason = wallet.dataStatus || 'source-offline'; }
  else if (!compared) { status = 'unmeasured'; reason = 'no-baseline-to-compare-against'; }
  else if (moved) { status = 'active'; reason = 'moved-since-you-tracked-it'; }
  else if (trackedForMs !== null && trackedForMs > TRACK_STALE_MS) { status = 'stale'; reason = 'tracked-but-nothing-new'; }

  /* A tracked wallet that is STILL young is the one case where «quiet» is
     interesting: it means the early read has not been invalidated yet. */
  const stillEarly = veryYoung && status !== 'unavailable';

  return {
    chain: row.chain ?? null,
    address: row.address ?? null,
    label: row.label || null,
    status,
    reason,
    trackedForMs,
    live,
    compared,
    change,
    moved,
    stillEarly,
    heldUsd: now_.portfolioUsd,
    realizedUsd: now_.realizedUsd,
    closedTrades: now_.closedTrades,
    txCount: now_.txCount,
    ageMs: age,
    /* What this wallet is being watched FOR, said plainly: the tracked types
       are already in the row, and a watchlist row that does not say why it
       exists is a bookmark. */
    watching: Array.isArray(row.types) && row.types.length ? row.types.slice(0, 6) : null,
    note: status === 'active'
      ? 'Change is measured against the figures at the moment you tracked this wallet.'
      : status === 'unavailable'
        ? 'The source did not answer, so this row says nothing about the wallet right now.'
        : null
  };
}

/**
 * The whole watchlist, read at once.
 *
 * @param {object} input
 * @param {Array}  input.rows     localStorage rows
 * @param {object} [input.wallets] map of `${chain}:${address}` → payload
 * @param {number} [input.now]
 */
export function readWatchlist({ rows = [], wallets = {}, now = Date.now() } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.address);
  if (!list.length) {
    return { measured: false, count: 0, rows: [], active: 0, quiet: 0, pending: 0, unavailable: 0, note: 'empty-watchlist' };
  }

  const keyOf = (chain, address) => `${chain}:${chain === 'solana' ? address : String(address || '').toLowerCase()}`;
  const read = list.map((row) => readTrackedWallet({
    row,
    wallet: wallets[keyOf(row.chain, row.address)] || null,
    now
  }));

  const count = (s) => read.filter((r) => r.status === s).length;
  const active = count('active');
  const pending = count('pending');
  const unavailable = count('unavailable');
  const quiet = count('quiet') + count('stale');
  const readCount = read.filter((r) => r.live).length;

  return {
    measured: true,
    count: read.length,
    rows: read,
    active,
    quiet,
    pending,
    unavailable,
    stillEarly: read.filter((r) => r.stillEarly).length,
    /* How much of the list was actually opened. A watchlist that shows three
       rows and read none of them must say so, because the other rows' status
       is «pending», not «quiet». */
    reads: readCount,
    breadth: read.length ? clamp(readCount / read.length, 0, 1) : 0,
    /* The note describes the LIST, so it may not claim «quiet» on the strength
       of the one row that happened to be read while two were never opened. */
    note: !readCount ? 'nothing-read-yet'
      : active > 0 ? 'movement-since-tracking'
        : unavailable >= readCount ? 'sources-offline'
          : pending > readCount ? 'mostly-unread'
            : 'quiet-since-tracking'
  };
}

/**
 * Which tracked wallets are worth opening on this visit, capped so a watchlist
 * cannot turn into a page-load fan-out. Pure ordering over the read; the caller
 * decides when to fetch.
 *
 * @param {object} input
 * @param {Array}  input.rows
 * @param {number} [input.now]
 */
export function nextToRead({ rows = [], now = Date.now(), limit = TRACK_MAX_READS } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.address);
  const keyOf = (r) => `${r.chain}:${r.address}`;
  const lastAt = (r) => num(r.lastReadAt) ?? 0;
  return [...list]
    .sort((a, b) => {
      /* Never-read rows first (they are the ones showing «pending»), then the
         longest-unread, then the newest tracked. Deterministic, so a re-render
         cannot reshuffle a fetch order. */
      const ar = lastAt(a);
      const br = lastAt(b);
      if (ar !== br) return ar - br;
      return (num(b.createdAt) ?? 0) - (num(a.createdAt) ?? 0);
    })
    .slice(0, Math.max(1, limit))
    .map((r) => ({ key: keyOf(r), chain: r.chain, address: r.address, lastReadAt: num(r.lastReadAt) ?? null }));
}

export default readTrackedWallet;
