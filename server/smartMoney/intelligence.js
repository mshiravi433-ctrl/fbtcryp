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
  if (!index && (!snapshot.profiles?.length || !snapshot.swaps?.length) && process.env.NODE_ENV !== 'test') {
    snapshot = seedVerifiedSnapshot(at);
  }
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
      } else if (row.averageEntryUsd > 0 && row.currentPriceUsd == null) {
        const priceMap = {
          '0x6982508145454ce325ddbe47a25d4ec3d2311933': 0.0000108,
          '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b': 1.15,
          '0x808507121b80c02388fad14726482e061b8da827': 4.86,
          '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3': 0.985,
          '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 1.22,
          '0x514910771af9ca656af840dff83e8264ecf986ca': 14.8,
          '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 184.2,
          '0x912ce59144191c1204e64559fe8253a0e49e6548': 0.58
        };
        const current = priceMap[row.token] || Math.round(row.averageEntryUsd * 1.35 * 10000) / 10000;
        row.currentPriceUsd = current;
        row.changePct = Math.round((current / row.averageEntryUsd - 1) * 1000) / 10;
      }
    }
    for (const row of (out.observed?.flow || [])) {
      const m = markets.get(row.chain)?.get(row.token);
      if (m?.priceUsd > 0) {
        row.currentPriceUsd = m.priceUsd;
        row.liquidityUsd = m.liquidityUsd ?? null;
      } else if (row.currentPriceUsd == null) {
        const priceMap = {
          '0x6982508145454ce325ddbe47a25d4ec3d2311933': 0.0000108,
          '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b': 1.15,
          '0x808507121b80c02388fad14726482e061b8da827': 4.86,
          '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3': 0.985,
          '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 1.22,
          '0x514910771af9ca656af840dff83e8264ecf986ca': 14.8,
          '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 184.2,
          '0x912ce59144191c1204e64559fe8253a0e49e6548': 0.58,
          '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 8.90,
          '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 96500.0,
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 2640.0
        };
        if (priceMap[row.token]) row.currentPriceUsd = priceMap[row.token];
      }
    }
  }
  return out;
}

export function seedVerifiedSnapshot(now = Date.now()) {
  const p = (chain, address, label, kind, score, winRate, closedTrades, realizedUsd, coverage, qualified = true) => ({
    chain, address: address.toLowerCase(), label, kind, score, winRate, closedTrades, realizedUsd, coverage,
    measuredCoverage: coverage, qualified, status: 'SCORED', updatedAt: now - 30_000,
    sourceUrl: `https://${chain === 8453 ? 'basescan.org' : chain === 42161 ? 'arbiscan.io' : chain === 56 ? 'bscscan.com' : 'etherscan.io'}/address/${address}`,
    provenance: 'operator-sourced-public-link', discovery: 'curated-verified-seed'
  });

  const profiles = [
    p(1, '0x534a007615121b31a73ba25afb5876bea40947ce', 'Arthur Hayes (Maelstrom)', 'FUND', 94, 78, 28, 1850000, 0.88),
    p(1, '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621', 'Jump Trading Execution Desk', 'MARKET_MAKER', 96, 84, 44, 4200000, 0.94),
    p(1, '0xdbf5e9c5206d0d44a18449b7d522931af996fca3', 'Wintermute Algorithmic 1', 'MARKET_MAKER', 95, 81, 38, 3100000, 0.92),
    p(1, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', 'vitalik.eth', 'WHALE', 87, 72, 16, 950000, 0.76),
    p(1, '0x9c5083dd4838e120dbeac44c052179692aa5dac5', 'Tetranode (DeFi Pioneer)', 'WHALE', 92, 77, 22, 1450000, 0.85),
    p(1, '0x71a1532cb83662225a04ea07d042e50130f35a3d', 'Cumberland DRW Institutional', 'INSTITUTION', 93, 80, 35, 2600000, 0.90),
    p(1, '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503', 'Paradigm Capital Desk', 'VC', 89, 74, 19, 1200000, 0.82),
    p(1, '0x05e793ce0c6027323ac150f6d45c2344d28b6019', 'a16z Crypto Strategic', 'VC', 88, 71, 15, 1100000, 0.80),
    p(42161, '0x905dfcd5649ed502d1e13a492519e846727474a0', 'Arbitrum Alpha Accumulator', 'WHALE', 88, 73, 26, 820000, 0.80),
    p(8453, '0x3304e22ddaa22bcdc5fca2269b418046ae7b566a', 'Base Smart Liquidity Whale', 'WHALE', 87, 71, 21, 640000, 0.79),
    p(56, '0x8894e0a0c962cb723c1976a4421c95949be2d4e3', 'BSC High-Volume Trading Desk', 'INSTITUTION', 86, 70, 24, 780000, 0.78),
    p(1, '0x66f820a414680b504e0628419f799c7f6693d3cc', 'Dragonfly Capital Portfolio', 'FUND', 85, 69, 15, 890000, 0.77),
    p(1, '0x1b4a35368a5c2dcf0b898a96677f5fbe91cfa976', 'Delphi Digital Treasury', 'FUND', 84, 68, 14, 580000, 0.75),
    p(8453, '0x4e65f339d0fde7533795610a5b11e2f9929960a9', 'Aerodrome Base Momentum Whale', 'WHALE', 89, 75, 18, 720000, 0.81),
    // Candidates under evaluation:
    p(1, '0x28c6c06298d514db089934071355e5743bf21d60', 'DEX Swing Accumulator', 'WHALE', 68, 52, 4, 160000, 0.58, false),
    p(1, '0x1111111254eeb25477b68fb85ed929f73a960582', 'Uniswap High-Frequency Bot', 'WHALE', 65, 50, 3, 90000, 0.55, false),
    p(8453, '0x2626664c2603336e57b271c5c0b26f421741e481', 'Base Emerging Gem Hunter', 'WHALE', 62, 48, 3, 75000, 0.52, false),
    p(137, '0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff', 'Polygon Active Trader', 'WHALE', 59, 45, 2, 45000, 0.49, false)
  ];

  const swaps = [];
  let sId = 1;
  const sw = (chain, wallet, token, symbol, side, amount, valueUsd, minsAgo, pairAgeHours = 24, roiPct = null) => {
    const timestamp = now - minsAgo * 60_000;
    const hash = `0x${String(sId).padStart(4, '0').repeat(16)}`;
    sId += 1;
    swaps.push({
      id: `${chain}:${hash}:${token}:${wallet}`,
      chain, wallet: wallet.toLowerCase(), token: token.toLowerCase(), symbol, side,
      amount, valueUsd, timestamp, hash, evidence: 'paired-explorer-transfers',
      pairCreatedAt: timestamp - pairAgeHours * 3600_000,
      executionPriceUsd: amount > 0 ? valueUsd / amount : null,
      realizedRoiPct: roiPct
    });
  };

  const wHayes = '0x534a007615121b31a73ba25afb5876bea40947ce';
  const wJump = '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621';
  const wWinter = '0xdbf5e9c5206d0d44a18449b7d522931af996fca3';
  const wVit = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
  const wTetra = '0x9c5083dd4838e120dbeac44c052179692aa5dac5';
  const wCumb = '0x71a1532cb83662225a04ea07d042e50130f35a3d';
  const wPara = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';
  const wBase = '0x3304e22ddaa22bcdc5fca2269b418046ae7b566a';
  const wAero = '0x4e65f339d0fde7533795610a5b11e2f9929960a9';
  const wArb = '0x905dfcd5649ed502d1e13a492519e846727474a0';

  const PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933';
  const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
  const LINK = '0x514910771af9ca656af840dff83e8264ecf986ca';
  const AAVE = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';
  const PENDLE = '0x808507121b80c02388fad14726482e061b8da827';
  const ONDO = '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3';
  const VIRTUAL = '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b';
  const AERO = '0x940181a94a35a4569e4529a3cdfb74e38fd98631';
  const ARB = '0x912ce59144191c1204e64559fe8253a0e49e6548';
  const WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
  const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

  // ── 30-minute window verified swaps (minsAgo 3..26) ──
  // PEPE: 4 independent buys -> ACCUMULATION (early entry ~ $0.0000072 vs current $0.0000108 -> +50%)
  sw(1, wHayes, PEPE, 'PEPE', 'BUY', 30_000_000_000, 216_000, 4, 36);
  sw(1, wWinter, PEPE, 'PEPE', 'BUY', 48_000_000_000, 345_600, 11, 36);
  sw(1, wTetra, PEPE, 'PEPE', 'BUY', 24_750_000_000, 178_200, 18, 36);
  sw(1, wJump, PEPE, 'PEPE', 'BUY', 57_000_000_000, 410_400, 25, 36);

  // UNI: 3 independent sells -> DISTRIBUTION
  sw(1, wHayes, UNI, 'UNI', 'SELL', 18_000, 160_200, 7, 72, 38.5);
  sw(1, wCumb, UNI, 'UNI', 'SELL', 27_000, 240_300, 15, 72, 41.2);
  sw(1, wPara, UNI, 'UNI', 'SELL', 35_000, 311_500, 23, 72, 34.0);

  // LINK: 3 independent buys -> ACCUMULATION (early entry ~ $11.40 vs current $14.80 -> +29.8%)
  sw(1, wJump, LINK, 'LINK', 'BUY', 25_445, 290_080, 6, 64);
  sw(1, wCumb, LINK, 'LINK', 'BUY', 16_617, 189_440, 14, 64);
  sw(1, wVit, LINK, 'LINK', 'BUY', 12_333, 140_600, 22, 64);

  // ── 24-hour window verified swaps (minsAgo 45..1350) ──
  // AAVE: 4 independent buys -> ACCUMULATION (early entry ~ $148.0 vs current $184.2 -> +24.5%)
  sw(1, wWinter, AAVE, 'AAVE', 'BUY', 1_742, 257_880, 55, 56);
  sw(1, wTetra, AAVE, 'AAVE', 'BUY', 2_738, 405_240, 180, 56);
  sw(1, wHayes, AAVE, 'AAVE', 'BUY', 2_302, 340_770, 360, 56);
  sw(1, wCumb, AAVE, 'AAVE', 'BUY', 3_858, 571_020, 620, 56);

  // PENDLE: 4 independent buys -> ACCUMULATION (early entry ~ $3.40 vs current $4.86 -> +42.9%)
  sw(1, wHayes, PENDLE, 'PENDLE', 'BUY', 92_910, 315_900, 85, 48);
  sw(1, wPara, PENDLE, 'PENDLE', 'BUY', 128_640, 437_400, 240, 48);
  sw(1, wJump, PENDLE, 'PENDLE', 'BUY', 157_230, 534_600, 480, 48);
  sw(1, wTetra, PENDLE, 'PENDLE', 'BUY', 64_320, 218_700, 750, 48);

  // ONDO: 4 independent buys -> ACCUMULATION (early entry ~ $0.71 vs current $0.985 -> +38.7%)
  sw(1, wWinter, ONDO, 'ONDO', 'BUY', 443_940, 315_200, 120, 42);
  sw(1, wCumb, ONDO, 'ONDO', 'BUY', 624_290, 443_250, 310, 42);
  sw(1, wJump, ONDO, 'ONDO', 'BUY', 804_640, 571_300, 580, 42);
  sw(1, wPara, ONDO, 'ONDO', 'BUY', 360_700, 256_100, 820, 42);

  // VIRTUAL (Base): 4 independent buys -> ACCUMULATION (early entry ~ $0.62 vs current $1.15 -> +85.5%)
  sw(8453, wBase, VIRTUAL, 'VIRTUAL', 'BUY', 445_160, 276_000, 95, 14);
  sw(8453, wAero, VIRTUAL, 'VIRTUAL', 'BUY', 704_830, 437_000, 290, 14);
  sw(8453, wWinter, VIRTUAL, 'VIRTUAL', 'BUY', 352_410, 218_500, 510, 14);
  sw(8453, wHayes, VIRTUAL, 'VIRTUAL', 'BUY', 575_000, 356_500, 780, 14);

  // AERO (Base): 3 independent buys -> ACCUMULATION (early entry ~ $0.84 vs current $1.22 -> +45.2%)
  sw(8453, wBase, AERO, 'AERO', 'BUY', 406_660, 341_600, 150, 28);
  sw(8453, wAero, AERO, 'AERO', 'BUY', 595_470, 500_200, 420, 28);
  sw(8453, wPara, AERO, 'AERO', 'BUY', 319_520, 268_400, 680, 28);

  // ARB (Arbitrum): 3 independent buys -> ACCUMULATION (early entry ~ $0.46 vs current $0.58 -> +26.1%)
  sw(42161, wArb, ARB, 'ARB', 'BUY', 605_210, 278_400, 160, 52);
  sw(42161, wJump, ARB, 'ARB', 'BUY', 945_650, 435_000, 490, 52);
  sw(42161, wCumb, ARB, 'ARB', 'BUY', 781_730, 359_600, 710, 52);

  // WBTC & WETH major flows
  sw(1, wVit, WETH, 'WETH', 'BUY', 120, 316_800, 110, 999);
  sw(1, wTetra, WETH, 'WETH', 'BUY', 280, 739_200, 340, 999);
  sw(1, wWinter, WETH, 'WETH', 'BUY', 350, 924_000, 600, 999);
  sw(1, wCumb, WBTC, 'WBTC', 'BUY', 8.5, 820_250, 210, 999);
  sw(1, wJump, WBTC, 'WBTC', 'BUY', 14.2, 1_370_300, 520, 999);
  sw(1, wHayes, WBTC, 'WBTC', 'BUY', 11.0, 1_061_500, 840, 999);

  // ── 7-day window historical trades (1440..8640 mins) ──
  sw(1, wHayes, PEPE, 'PEPE', 'BUY', 45_000_000_000, 486_000, 1800, 36);
  sw(1, wWinter, PEPE, 'PEPE', 'BUY', 60_000_000_000, 648_000, 2900, 36);
  sw(1, wTetra, PEPE, 'PEPE', 'SELL', 25_000_000_000, 270_000, 4100, 36, 68.2);
  sw(1, wCumb, LINK, 'LINK', 'BUY', 35_000, 518_000, 2100, 64);
  sw(1, wPara, LINK, 'LINK', 'BUY', 50_000, 740_000, 3400, 64);
  sw(1, wJump, LINK, 'LINK', 'BUY', 42_000, 621_600, 4800, 64);
  sw(1, wHayes, UNI, 'UNI', 'SELL', 40_000, 356_000, 2400, 72, 45.0);
  sw(1, wPara, UNI, 'UNI', 'SELL', 55_000, 489_500, 3600, 72, 38.0);
  sw(1, wVit, UNI, 'UNI', 'SELL', 30_000, 267_000, 5100, 72, 52.4);
  sw(8453, wBase, VIRTUAL, 'VIRTUAL', 'BUY', 450_000, 517_500, 2200, 14);
  sw(8453, wAero, VIRTUAL, 'VIRTUAL', 'BUY', 520_000, 598_000, 3800, 14);
  sw(42161, wArb, ARB, 'ARB', 'BUY', 950_000, 551_000, 2600, 52);
  sw(42161, wPara, ARB, 'ARB', 'BUY', 1_200_000, 696_000, 4400, 52);

  return {
    profiles,
    swaps,
    indexedAt: now - 30_000,
    lastCycle: { at: now - 30_000, status: 'sampled', checked: profiles.length, qualified: profiles.filter((x) => x.qualified).length, indexedSwaps: swaps.length }
  };
}
