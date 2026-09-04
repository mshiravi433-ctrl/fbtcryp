/**
 * SMART MONEY — OBSERVED-EVENT RING BUFFER
 * ---------------------------------------------------------------------------
 * The whale scan (server/whales.js) reads only the last ~2-3 minutes of
 * blocks per chain — that is what a keyless public RPC will serve. The page,
 * however, talks about 24h / 7d / 30d windows. Before this module every
 * window was computed from the SAME three-minute slice, so «24h», «7d» and
 * «30d» were byte-identical, exchange flow was whatever two Binance deposits
 * happened to land in that slice, and everything else read as zero.
 *
 * Now every scan is MERGED into a bounded buffer of observed events:
 *   · memory first (warm instance), so consecutive scans accumulate;
 *   · the shared durable store (Upstash / Blob, when configured) second, so
 *     a cold serverless instance inherits what earlier instances observed
 *     instead of starting from an empty page.
 *
 * Honesty contract: the buffer is what WE observed while someone was
 * looking, not a complete chain history. `observedSince` and event counts
 * travel with every aggregate so the UI can say «based on N events observed
 * over the last X hours» rather than implying full coverage.
 */

import { storeGet, storeGetFresh, storeSet, storeDurable } from '../store.js';
import { EVM_CHAINS } from '../chainsLite.js';

const KEY = 'smart-money:events:v2';
export const MAX_EVENTS = Number(process.env.SM_EVENT_BUFFER_MAX || 800);
export const MAX_AGE_MS = Number(process.env.SM_EVENT_BUFFER_AGE_MS || 7 * 24 * 3600_000);
const PERSIST_EVERY_MS = 120_000;

let mem = null;          // { events: Map<id, slim>, loadedAt }
let loading = null;
let lastPersistAt = 0;
let dirty = false;

/* ── slim ⇄ full ──────────────────────────────────────────────────────── */

/** Keep only what the aggregates and the UI actually read. */
export function slimEvent(e) {
  const tag = (p) => (p?.tag && (p.tag.label || p.tag.kind || p.tag.exchange)
    ? { l: p.tag.label || null, k: p.tag.kind || null, x: p.tag.exchange || null }
    : undefined);
  return {
    id: e.id,
    c: e.chainId,
    k: e.kind || 'transfer',
    t: e.timestamp || null,
    v: e.valueUsd == null ? null : Math.round(e.valueUsd),
    a: e.amount ?? null,
    h: e.hash || null,
    b: e.blockNumber || null,
    tk: {
      s: e.token?.symbol || '???',
      n: e.token?.name || null,
      a: e.token?.address || null,
      d: e.token?.decimals ?? null,
      g: e.token?.coingeckoId || null
    },
    f: { a: e.from?.address || null, l: e.from?.label || null, g: tag(e.from) },
    o: { a: e.to?.address || null, l: e.to?.label || null, g: tag(e.to) }
  };
}

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function inflateEvent(s) {
  const cfg = EVM_CHAINS[s.c] || {};
  const tag = (g) => (g ? { label: g.l || null, kind: g.k || null, exchange: g.x || null } : null);
  return {
    id: s.id,
    chainId: s.c,
    chainShort: cfg.short || String(s.c),
    chainName: cfg.name || String(s.c),
    chainColor: cfg.color || '#888',
    kind: s.k,
    token: { symbol: s.tk?.s || '???', name: s.tk?.n || null, address: s.tk?.a || null, decimals: s.tk?.d ?? null, coingeckoId: s.tk?.g || null, verified: !!s.tk?.g },
    amount: s.a,
    valueUsd: s.v,
    from: { address: s.f?.a || null, label: s.f?.l || null, short: short(s.f?.a), tag: tag(s.f?.g) },
    to: { address: s.o?.a || null, label: s.o?.l || null, short: short(s.o?.a), tag: tag(s.o?.g) },
    hash: s.h,
    blockNumber: s.b,
    timestamp: s.t,
    explorerTx: cfg.explorer && s.h ? `${cfg.explorer}/tx/${s.h}` : null,
    explorerFrom: cfg.explorer && s.f?.a ? `${cfg.explorer}/address/${s.f.a}` : null,
    explorerTo: cfg.explorer && s.o?.a ? `${cfg.explorer}/address/${s.o.a}` : null
  };
}

/* ── buffer maintenance ───────────────────────────────────────────────── */

function prune(map, now = Date.now()) {
  const cutoff = now - MAX_AGE_MS;
  for (const [id, s] of map) if (s.t && s.t < cutoff) map.delete(id);
  if (map.size > MAX_EVENTS) {
    // Drop the oldest (by timestamp) beyond the cap; unpriced events go first.
    const rows = [...map.values()].sort((a, b) => ((b.v ?? -1) - (a.v ?? -1)) || ((b.t || 0) - (a.t || 0)));
    map.clear();
    for (const s of rows.slice(0, MAX_EVENTS)) map.set(s.id, s);
  }
}

function fromStored(raw) {
  const map = new Map();
  const rows = Array.isArray(raw?.events) ? raw.events : [];
  for (const s of rows) if (s && s.id) map.set(s.id, s);
  prune(map);
  return map;
}

async function ensureLoaded() {
  if (mem) return mem;
  if (!loading) {
    loading = (async () => {
      let stored = null;
      try { stored = await storeGet(KEY, null); } catch { stored = null; }
      mem = { events: fromStored(stored), loadedAt: Date.now() };
      return mem;
    })().finally(() => { loading = null; });
  }
  return loading;
}

/**
 * Merge freshly scanned events into the buffer. Returns the whole buffer
 * (newest first) plus its observation span. A failed scan (`fresh` empty)
 * still returns what was observed before — the page degrades to «stale»,
 * never to a blank.
 */
export async function mergeEvents(fresh = []) {
  const state = await ensureLoaded();
  let added = 0;
  for (const e of fresh) {
    if (!e?.id) continue;
    const prev = state.events.get(e.id);
    const slim = slimEvent(e);
    if (prev) {
      // keep tags/labels learned earlier when the new scan has none
      if (!slim.f.g && prev.f?.g) slim.f.g = prev.f.g;
      if (!slim.o.g && prev.o?.g) slim.o.g = prev.o.g;
      if (slim.v == null && prev.v != null) slim.v = prev.v;
    } else {
      added += 1;
    }
    state.events.set(e.id, slim);
  }
  if (added) dirty = true;
  prune(state.events);
  void persistSoon();
  return snapshot(state);
}

/** Attach explorer tags learned after the merge (labels are an enrichment
 *  that arrives asynchronously; they must survive into the persisted copy). */
export async function rememberTags(chainId, tags) {
  const state = await ensureLoaded();
  let changed = false;
  for (const s of state.events.values()) {
    if (s.c !== chainId) continue;
    for (const side of ['f', 'o']) {
      const p = s[side];
      if (!p?.a || p.g) continue;
      const tag = tags.get(p.a);
      if (tag && (tag.label || tag.kind || tag.exchange)) {
        p.g = { l: tag.label || null, k: tag.kind || null, x: tag.exchange || null };
        changed = true;
      }
    }
  }
  if (changed) dirty = true;
}

function snapshot(state) {
  const events = [...state.events.values()].map(inflateEvent)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  let oldest = null;
  for (const e of events) if (e.timestamp && (oldest == null || e.timestamp < oldest)) oldest = e.timestamp;
  return { events, observedSince: oldest, size: events.length, durable: storeDurable() };
}

export async function readEvents() {
  return snapshot(await ensureLoaded());
}

/** Write-behind persistence: at most one durable write per two minutes, and
 *  the durable copy is re-read and merged first so two warm instances do not
 *  overwrite each other's observations (last-writer-wins on a union is
 *  lossless; on a replace it is not). */
async function persistSoon() {
  if (!dirty || !storeDurable()) return;
  const now = Date.now();
  if (now - lastPersistAt < PERSIST_EVERY_MS) return;
  lastPersistAt = now;
  try {
    const state = await ensureLoaded();
    let remote = null;
    try { remote = await storeGetFresh(KEY, null); } catch { remote = null; }
    const remoteMap = fromStored(remote);
    for (const [id, s] of remoteMap) if (!state.events.has(id)) state.events.set(id, s);
    prune(state.events);
    await storeSet(KEY, { v: 2, at: now, events: [...state.events.values()] });
    dirty = false;
  } catch {
    /* durable store hiccup — memory copy still serves; retried next window */
  }
}

/** Test seam: forget everything (memory only). */
export function __resetEventStoreForTests() {
  mem = null;
  loading = null;
  lastPersistAt = 0;
  dirty = false;
}
