/**
 * Smart Money Intelligence Engine — bounded acquisition → verified performance
 * → observed-trade index → consensus/graph/early activity → read-only clients.
 * Reuses the existing store, whale scanner, wallet analyser and cron. No trade
 * execution, no new secrets except the operator registry guard in app.js.
 *
 * ─── WHY THIS FILE WAS REWIRED (2026-09-28) ────────────────────────────────
 *   «با فکر عمیق هوش تایید شده اصلا به داده‌های واقعی وصل نیستند»
 *
 * Production answered `/api/v1/smart-money/intelligence` with
 * `indexedAt: null` — the verified index had NEVER been written, so every
 * surface that reads it (the «هوش تأییدشده» tab, the verified wallet board,
 * the token card, the overview teaser, Intent AI's deep-think path, FIOS)
 * rendered an honest but permanent «not indexed». Four faults stacked:
 *
 *   1. The ONLY writer was a cron (twice a day on Vercel Hobby) that also had
 *      to share a 60-second function with nine other daily jobs. A timeout or
 *      a missing CRON_SECRET meant no write, ever — and nothing else could
 *      build the index.
 *   2. Discovery fed it whale transfers ≥ $100k through routers: aggregators,
 *      solvers and exchange wallets that can never produce a paired
 *      stablecoin swap. When nothing was found it returned early WITHOUT
 *      recording the attempt.
 *   3. Qualification was unreachable for real wallets (performance.js).
 *   4. A profile expired after 36 h (consensus.js).
 *
 * Now: (a) the index is SELF-HEALING — a read that finds it missing or stale
 * starts one bounded, single-flight, lease-guarded cycle (first-ever reader
 * waits for it, later readers get the snapshot while it refreshes in the
 * background); (b) discovery reads live stablecoin↔DEX transfers from the
 * chain (dataSources.bsRecentStableSwappers) in addition to the whale stream
 * and the operator registry; (c) every cycle — success or not — is recorded as
 * `lastCycle`, so the UI can say "last attempt 3 min ago, upstream down"
 * instead of "never". Nothing is ever fabricated: an unreachable indexer
 * still produces an empty, labelled result.
 */
import { storeGet, storeGetFresh, storeSet, storeDurable } from '../store.js';
import { analyzeWallet } from './walletIntel.js';
import { readWalletRegistry } from './walletRegistry.js';
import { labelEvent, isNonWallet } from './moneyFlow.js';
import { readEvents } from './eventStore.js';
import { tokenMarkets } from './pricing.js';
import { bsRecentStableSwappers, BLOCKSCOUT } from './dataSources.js';
import { USD_QUOTES } from './performance.js';
import { DEX_SLUGS, WINDOWS } from './config.js';
import { buildConsensus } from './consensus.js';

const KEY = 'smart-money:verified-index:v1';
const LEASE_KEY = 'smart-money:verified-index:lease:v1';
const MAX_PROFILES = 160;
const MAX_SWAPS = 1200;
const INDEX_AGE = 7 * WINDOWS.H24;
/** A reader older than this triggers a background refresh. */
export const REFRESH_AFTER_MS = Math.max(60_000, Number(process.env.SM_INDEX_REFRESH_MS) || 15 * 60_000);
/** Never re-attempt a failed cycle more often than this (upstream courtesy). */
const RETRY_AFTER_MS = 2 * 60_000;
/** Cross-instance lease: one serverless instance indexes at a time. */
const LEASE_MS = 75_000;
/** How long the very first reader waits for the first-ever index. */
const FIRST_WAIT_MS = Math.max(3_000, Number(process.env.SM_INDEX_FIRST_WAIT_MS) || 19_000);
const DISCOVERY_MS = 7_000;
const PER_WALLET_MS = 12_000;
/** Chains the live discovery rotates through (Blockscout-indexed, has a USD quote). */
const DISCOVERY_CHAINS = [1, 42161, 8453, 10, 137, 56].filter((c) => BLOCKSCOUT[c] && USD_QUOTES[c]?.length);

const recordId = (chain, address) => `${chain}:${String(address || '').toLowerCase()}`;
const safeArray = (v) => Array.isArray(v) ? v : [];

function timeout(ms, label = 'TIMEOUT') {
  let timer;
  const promise = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); });
  return { promise, clear: () => clearTimeout(timer) };
}

async function withTimeout(promise, ms, label) {
  const t = timeout(ms, label);
  try { return await Promise.race([promise, t.promise]); }
  finally { t.clear(); }
}

async function waitAtMost(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise.then((value) => ({ timedOut: false, value }), (error) => ({ timedOut: false, error })),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); })
    ]);
  } finally { clearTimeout(timer); }
}

/**
 * Keep a background promise alive after the HTTP response on Vercel.
 * This is exactly what `@vercel/functions#waitUntil` does internally (reads
 * the request context the Node runtime publishes on this global symbol); it
 * is inlined so the API bundle does not gain a dependency for three lines. On
 * a long-lived `node server/index.js` the promise simply keeps running.
 */
function keepAlive(promise) {
  try {
    const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
    if (typeof ctx?.waitUntil === 'function') { ctx.waitUntil(promise.catch(() => {})); return 'waitUntil'; }
  } catch { /* not on Vercel */ }
  promise.catch(() => {});
  return 'detached';
}

export async function readVerifiedIndex({ fresh = false } = {}) {
  const raw = fresh ? await storeGetFresh(KEY, null) : await storeGet(KEY, null);
  return { profiles: safeArray(raw?.profiles), swaps: safeArray(raw?.swaps), indexedAt: raw?.indexedAt || null,
    lastCycle: raw?.lastCycle || null };
}

/** Candidate discovery is an acquisition queue, NOT classification. Scanned
 * router flows are only hints about addresses worth examining; they never
 * enter consensus until we independently reconstruct confirmed swap fills. */
export function candidateWallets(events = [], limit = 4) {
  const out = new Map();
  for (const e of safeArray(events).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))) {
    if (!['dex_buy', 'dex_sell'].includes(e.flow)) continue;
    const party = e.flow === 'dex_buy' ? e.to : e.from;
    if (isNonWallet(e.chainId, party)) continue;
    const id = recordId(e.chainId, party.address);
    if (!out.has(id)) out.set(id, { chain: e.chainId, address: party.address, basis: 'whale-dex-flow' });
    if (out.size >= limit) break;
  }
  return [...out.values()];
}

/** Live discovery: plain wallets swapping against the chain's main USD
 * stablecoin right now. Rotates chains per refresh slot so successive cycles
 * widen coverage instead of re-reading the same chain; each read is bounded
 * and one dead indexer costs only its own rows. */
export async function discoverLiveTraders({ now = Date.now(), chains = 3, perChain = 8, source = bsRecentStableSwappers } = {}) {
  if (!DISCOVERY_CHAINS.length) return [];
  const slot = Math.floor(now / REFRESH_AFTER_MS);
  // Ethereum anchors every cycle (deepest, most reliable indexer); the other
  // slots rotate so successive cycles widen coverage across L2s.
  const anchor = DISCOVERY_CHAINS.includes(1) ? [1] : [];
  const rest = DISCOVERY_CHAINS.filter((c) => !anchor.includes(c));
  const picked = [...anchor, ...Array.from({ length: Math.max(0, Math.min(chains, DISCOVERY_CHAINS.length) - anchor.length) },
    (_, i) => rest[(slot + i) % rest.length])].filter((c, i, a) => c != null && a.indexOf(c) === i);
  // Up to two USD stablecoins per chain (e.g. USDC + USDT): a single token's
  // latest page is dominated by pool↔router hops, the second doubles yield.
  const reads = picked.flatMap((chain) => USD_QUOTES[chain].slice(0, 2).map((quote) => ({ chain, quote })));
  const settled = await Promise.allSettled(reads.map(({ chain, quote }) =>
    withTimeout(source(chain, quote, { limit: perChain }), DISCOVERY_MS, 'DISCOVERY_TIMEOUT')));
  const out = new Map();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const row of safeArray(r.value?.rows)) {
      const id = recordId(row.chain, row.address);
      if (!out.has(id)) out.set(id, row);
    }
  }
  return [...out.values()].filter((r) => /^0x[a-f0-9]{40}$/.test(String(r.address || '')) && !isNonWallet(r.chain, { address: r.address }));
}

function profileFor(wallet, registry = null, now = Date.now(), discovery = null) {
  const sm = wallet.smartMoney || {};
  return {
    chain: wallet.chain, address: String(wallet.address).toLowerCase(),
    label: registry?.label || null, kind: registry?.kind || null,
    sourceUrl: registry?.sourceUrl || null, provenance: registry?.provenance || null,
    score: sm.score ?? null, coverage: sm.coverage ?? 0, measuredCoverage: sm.measuredCoverage ?? null,
    qualified: sm.qualified === true,
    closedTrades: wallet.performance?.closedTrades || 0, realizedUsd: wallet.performance?.realizedPnlUsd ?? null,
    winRate: wallet.performance?.winRate ?? null,
    status: sm.status || 'UNAVAILABLE',
    sample: sm.sample || null, discovery: registry ? 'operator-registry' : discovery, updatedAt: now
  };
}

async function recordCycle(lastCycle) {
  try {
    const prev = await readVerifiedIndex({ fresh: true });
    await storeSet(KEY, { indexedAt: prev.indexedAt, profiles: prev.profiles, swaps: prev.swaps, lastCycle }, 8 * WINDOWS.H24);
  } catch { /* recording an attempt is best-effort; never mask the result */ }
}

/** One sync. All external reads are bounded: ≤8 wallets/cycle in parallel,
 * each with its own time budget; one source failure does not erase the
 * previous index. Tests inject pre-observed candidates + analysis to prove
 * the path without HTTP. */
export async function runIntelligenceCycle({ now = Date.now(), candidates = null, analyze = analyzeWallet,
  maxWallets = 6, stream = null, discover = discoverLiveTraders, perWalletMs = PER_WALLET_MS, reason = 'cron' } = {}) {
  const registry = await readWalletRegistry();
  const registered = registry.filter((r) => r.chain !== 'solana'); // no decoded Solana swap ledger yet
  let discovered = candidates;
  let discoveryStats = null;
  if (discovered == null) {
    let observed = stream;
    const [streamed, live] = await Promise.all([
      observed != null ? Promise.resolve(observed)
        // The persisted whale buffer, NOT a fresh chain scan: discovery must
        // not spend the cycle's budget re-scanning seven chains.
        : readEvents().then((b) => ({ events: safeArray(b?.events).filter((e) => e.valueUsd == null || e.valueUsd >= 25_000).map(labelEvent) }))
          .catch(() => ({ events: [] })),
      typeof discover === 'function' ? discover({ now }).catch(() => []) : Promise.resolve([])
    ]);
    observed = streamed;
    const fromStream = candidateWallets(observed?.events || [], 24);
    discovered = [...safeArray(live), ...fromStream];
    discoveryStats = { live: safeArray(live).length, whaleFlow: fromStream.length };
  }
  const targets = new Map();
  for (const row of registered) targets.set(recordId(row.chain, row.address), { chain: row.chain, address: row.address, registry: row, discovered: false, basis: 'operator-registry' });
  for (const row of discovered) {
    const id = recordId(row.chain, row.address);
    if (!targets.has(id)) targets.set(id, { chain: row.chain, address: row.address, registry: null, discovered: true, basis: row.basis || 'candidate' });
  }
  if (!targets.size) {
    const out = { checked: 0, qualified: 0, indexedSwaps: 0, status: 'no-candidates', durable: storeDurable(), discovery: discoveryStats };
    await recordCycle({ at: now, reason, ...out });
    return out;
  }
  // Rotation: never-analysed wallets first, oldest analysis next — but keep
  // up to two slots for QUALIFIED wallets whose measurement is >6 h old, so
  // the wallets that can actually vote keep contributing fresh fills instead
  // of being starved by an endless queue of new discoveries.
  const lastIndex = await readVerifiedIndex();
  const lastChecked = new Map(lastIndex.profiles.map((p) => [recordId(p.chain, p.address), p]));
  const budget = Math.max(1, Math.min(8, maxWallets));
  const staleQualified = lastIndex.profiles
    .filter((p) => p.qualified && now - (p.updatedAt || 0) > 6 * WINDOWS.H1)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
    .slice(0, Math.min(2, Math.max(0, budget - 1)))
    .map((p) => targets.get(recordId(p.chain, p.address)) || { chain: p.chain, address: p.address, registry: null, discovered: false, basis: p.discovery || 'requalify' });
  const chosenIds = new Set(staleQualified.map((r) => recordId(r.chain, r.address)));
  const rest = [...targets.values()].filter((r) => !chosenIds.has(recordId(r.chain, r.address))).sort((a, b) =>
    (lastChecked.get(recordId(a.chain, a.address))?.updatedAt || 0) - (lastChecked.get(recordId(b.chain, b.address))?.updatedAt || 0)
    || Number(b.discovered) - Number(a.discovered)
    || recordId(a.chain, a.address).localeCompare(recordId(b.chain, b.address)));
  const chosen = [...staleQualified, ...rest].slice(0, budget);

  const results = await Promise.allSettled(chosen.map(async (row) => {
    const w = await withTimeout(Promise.resolve().then(() => analyze(row.address, row.chain)), perWalletMs, 'WALLET_TIMEOUT');
    if (w.chain !== row.chain || String(w.address).toLowerCase() !== String(row.address).toLowerCase())
      throw new Error('MISMATCHED_WALLET');
    // An indexer outage is not a measurement: do not store an UNAVAILABLE
    // profile (it would also push the wallet to the back of the rotation).
    if (w.sources?.history && w.sources.history !== 'live') throw new Error('HISTORY_UNAVAILABLE');
    const profile = profileFor(w, row.registry, now, row.basis);
    const closed = new Map(safeArray(w.performance?.closed).map((c) => [c.hash, c]));
    // The public wallet response carries audited closed trades separately.
    const exits = new Map(safeArray(w.closedTrades).map((c) => [c.hash, c]));
    const swaps = safeArray(w.verifiedSwaps).filter((s) => s.evidence === 'paired-explorer-transfers'
      && s.chain === row.chain && s.wallet === profile.address && s.timestamp <= now && s.timestamp >= now - INDEX_AGE)
      .map((s) => ({ ...s,
        pairCreatedAt: Number.isFinite(s.pairCreatedAt) ? s.pairCreatedAt : null,
        realizedRoiPct: exits.get(s.hash)?.roiPct ?? closed.get(s.hash)?.roiPct ?? null }));
    return { profile, swaps };
  }));
  const successful = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!successful.length) {
    const out = { checked: chosen.length, qualified: 0, indexedSwaps: 0,
      errors: results.length, status: 'upstreams-unavailable', durable: storeDurable(), discovery: discoveryStats,
      reasons: [...new Set(results.map((r) => String(r.reason?.message || r.reason || '').slice(0, 40)))].slice(0, 4) };
    await recordCycle({ at: now, reason, ...out });
    return out;
  }

  // Union with the durable copy first; another serverless instance may have
  // indexed a different wallet. Blob is last-writer-wins, so writes remain
  // best-effort, not a financial ledger.
  const prev = await readVerifiedIndex({ fresh: true });
  const profiles = new Map(prev.profiles.filter((p) => p.updatedAt > now - INDEX_AGE)
    .map((p) => [recordId(p.chain, p.address), p]));
  const swaps = new Map(prev.swaps.filter((s) => s.timestamp > now - INDEX_AGE)
    .map((s) => [s.id, s]));
  for (const r of successful) {
    profiles.set(recordId(r.profile.chain, r.profile.address), r.profile);
    for (const s of r.swaps) swaps.set(s.id, s);
  }
  const out = { checked: chosen.length, qualified: successful.filter((r) => r.profile.qualified).length,
    indexedSwaps: successful.reduce((sum, r) => sum + r.swaps.length, 0),
    errors: chosen.length - successful.length, status: 'sampled', durable: storeDurable(), discovery: discoveryStats };
  await storeSet(KEY, {
    indexedAt: now,
    profiles: [...profiles.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROFILES),
    swaps: [...swaps.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_SWAPS),
    lastCycle: { at: now, reason, ...out }
  }, 8 * WINDOWS.H24);
  return out;
}

/* ── self-healing refresh ─────────────────────────────────────────────── */

let inflight = null;
let lastAttemptAt = 0;

/** Single-flight per instance + a best-effort lease across instances, so a
 * burst of readers on a cold index starts ONE cycle, not one per request. */
export function refreshVerifiedIndex({ reason = 'on-demand', maxWallets = 6, force = false, cycle = runIntelligenceCycle } = {}) {
  if (inflight) return inflight;
  lastAttemptAt = Date.now();
  inflight = (async () => {
    if (!force) {
      const lease = await storeGetFresh(LEASE_KEY, null).catch(() => null);
      if (lease && Number(lease.until) > Date.now()) return { status: 'leased-elsewhere', until: lease.until };
    }
    await storeSet(LEASE_KEY, { until: Date.now() + LEASE_MS, reason }, LEASE_MS * 2).catch(() => {});
    try {
      return await cycle({ now: Date.now(), maxWallets, reason });
    } finally {
      await storeSet(LEASE_KEY, { until: 0 }, 60_000).catch(() => {});
    }
  })().catch((err) => ({ status: 'unavailable', error: String(err?.message || err).slice(0, 100) }))
    .finally(() => { inflight = null; });
  return inflight;
}

export function __resetRefreshForTests() { inflight = null; lastAttemptAt = 0; }

function onDemandEnabled() {
  if (process.env.SM_ONDEMAND_INDEX === '0') return false;
  if (process.env.SM_ONDEMAND_INDEX === '1') return true;
  return process.env.NODE_ENV !== 'test';
}

/**
 * Decide whether this read should (re)build the index.
 *   refresh: 'auto'       — wait (bounded) when the index has never been built
 *                            so the first reader sees real data; otherwise
 *                            refresh in the background.
 *            'background' — never block the caller (overview teaser, token
 *                            card, AI context), only kick a refresh.
 *            'never'       — read-only (cron-internal readers).
 */
async function maybeRefresh(snapshot, refresh, { refreshFn = refreshVerifiedIndex } = {}) {
  const wall = Date.now();
  const age = snapshot.indexedAt ? wall - snapshot.indexedAt : Infinity;
  const lastTry = Math.max(lastAttemptAt, Number(snapshot.lastCycle?.at) || 0);
  const state = { status: 'idle', ageMs: Number.isFinite(age) ? age : null, refreshAfterMs: REFRESH_AFTER_MS,
    lastCycle: snapshot.lastCycle || null };
  if (refresh === 'never' || !onDemandEnabled()) return { snapshot, state: { ...state, status: 'disabled' } };
  if (inflight) return { snapshot, state: { ...state, status: 'refreshing' } };
  if (age <= REFRESH_AFTER_MS) return { snapshot, state };
  if (wall - lastTry < RETRY_AFTER_MS) return { snapshot, state: { ...state, status: 'cooldown' } };
  const job = refreshFn({ reason: snapshot.indexedAt ? 'stale-read' : 'first-read' });
  if (refresh === 'auto' && !snapshot.profiles.length) {
    const res = await waitAtMost(job, FIRST_WAIT_MS);
    if (!res.timedOut) {
      const next = await readVerifiedIndex();
      return { snapshot: next, state: { ...state, status: 'refreshed', ageMs: next.indexedAt ? Date.now() - next.indexedAt : null,
        lastCycle: next.lastCycle || res.value || null } };
    }
    keepAlive(job);
    return { snapshot, state: { ...state, status: 'refreshing' } };
  }
  keepAlive(job);
  return { snapshot, state: { ...state, status: 'refreshing' } };
}

/** Fast read from the indexed snapshot (refreshing it when stale — see
 * maybeRefresh). Optional price enrichment only for EARLY qualified fills. */
export async function getVerifiedIntelligence({ window = '24h', chain = null, token = null,
  includePrices = false, now = null, index = null, events = null, refresh = 'auto', refreshFn = undefined } = {}) {
  let snapshot = index || await readVerifiedIndex();
  let refreshState = { status: index ? 'injected' : 'idle' };
  if (!index) {
    // Another instance may have refreshed: re-read the durable copy before
    // deciding this one has to do the work.
    if (!snapshot.indexedAt || Date.now() - snapshot.indexedAt > REFRESH_AFTER_MS) {
      snapshot = await readVerifiedIndex({ fresh: true }).catch(() => snapshot);
    }
    const decided = await maybeRefresh(snapshot, refresh, refreshFn ? { refreshFn } : undefined);
    snapshot = decided.snapshot;
    refreshState = decided.state;
  }
  const observed = events || await readEvents().catch(() => ({ events: [] }));
  // Evaluated AFTER a possible refresh: profiles written by the cycle carry a
  // later updatedAt than a clock read at call start, and `updatedAt <= now`
  // would silently drop the data this very request just indexed.
  const at = now ?? Date.now();
  const out = buildConsensus({ profiles: snapshot.profiles, swaps: snapshot.swaps, events: observed.events,
    indexedAt: snapshot.indexedAt, window, chain, token, durable: storeDurable(), now: at });
  out.refresh = refreshState;
  out.lastCycle = snapshot.lastCycle || null;
  if (includePrices && (out.earlyEntries.length || out.observed?.flow?.length)) {
    const byChain = new Map();
    const add = (id, tokenAddr) => {
      if (!byChain.has(id)) byChain.set(id, new Set());
      byChain.get(id).add(tokenAddr);
    };
    for (const row of out.earlyEntries) add(row.chain, row.token);
    for (const row of (out.observed?.flow || []).slice(0, 8)) add(row.chain, row.token);
    const markets = new Map();
    await Promise.all([...byChain].map(async ([id, tokens]) => {
      try { markets.set(id, await tokenMarkets([...tokens].slice(0, 12), { chain: DEX_SLUGS[id] })); }
      catch { /* unpriced ≠ 0 */ }
    }));
    for (const row of out.earlyEntries) {
      const m = markets.get(row.chain)?.get(row.token);
      if (m?.priceUsd > 0) {
        row.currentPriceUsd = m.priceUsd;
        row.changePct = row.averageEntryUsd > 0 ? Math.round((m.priceUsd / row.averageEntryUsd - 1) * 1000) / 10 : null;
        row.liquidityUsd = m.liquidityUsd ?? null;
      }
    }
    for (const row of (out.observed?.flow || [])) {
      const m = markets.get(row.chain)?.get(row.token);
      if (m?.priceUsd > 0) {
        row.currentPriceUsd = m.priceUsd;
        row.liquidityUsd = m.liquidityUsd ?? null;
      }
    }
  }
  return out;
}
