/**
 * Smart Money Intelligence Engine — bounded acquisition → verified performance
 * → observed-trade index → consensus/graph/early activity → read-only clients.
 * Reuses the existing store, whale scanner, wallet analyser and cron. No trade
 * execution, no new secrets except the operator registry guard in app.js.
 *
 * The current deployment's cron is twice DAILY (Vercel Hobby); a 30-minute
 * observation condition is best-effort on indexed samples, NOT 24/7 realtime.
 */
import { storeGet, storeGetFresh, storeSet, storeDurable } from '../store.js';
import { analyzeWallet } from './walletIntel.js';
import { readWalletRegistry } from './walletRegistry.js';
import { labelledEvents, isNonWallet } from './moneyFlow.js';
import { readEvents } from './eventStore.js';
import { tokenMarkets } from './pricing.js';
import { DEX_SLUGS, WINDOWS } from './config.js';
import { buildConsensus } from './consensus.js';

const KEY = 'smart-money:verified-index:v1';
const MAX_PROFILES = 160;
const MAX_SWAPS = 1200;
const INDEX_AGE = 7 * WINDOWS.H24;
const recordId = (chain, address) => `${chain}:${String(address || '').toLowerCase()}`;
const safeArray = (v) => Array.isArray(v) ? v : [];

export async function readVerifiedIndex({ fresh = false } = {}) {
  const raw = fresh ? await storeGetFresh(KEY, null) : await storeGet(KEY, null);
  return { profiles: safeArray(raw?.profiles), swaps: safeArray(raw?.swaps), indexedAt: raw?.indexedAt || null };
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
    if (!out.has(id)) out.set(id, { chain: e.chainId, address: party.address });
    if (out.size >= limit) break;
  }
  return [...out.values()];
}

function profileFor(wallet, registry = null, now = Date.now()) {
  const sm = wallet.smartMoney || {};
  return {
    chain: wallet.chain, address: String(wallet.address).toLowerCase(),
    label: registry?.label || null, kind: registry?.kind || null,
    sourceUrl: registry?.sourceUrl || null, provenance: registry?.provenance || null,
    score: sm.score ?? null, coverage: sm.coverage ?? 0, qualified: sm.qualified === true,
    closedTrades: wallet.performance?.closedTrades || 0, realizedUsd: wallet.performance?.realizedPnlUsd ?? null,
    winRate: wallet.performance?.winRate ?? null,
    status: sm.status || 'UNAVAILABLE',
    sample: sm.sample || null, updatedAt: now
  };
}

/** One scheduled sync. All external reads are bounded: max 4 wallets/cycle,
 * parallel; one source failure does not erase the previous index. Tests inject
 * pre-observed candidates + analysis to prove the path without HTTP. */
export async function runIntelligenceCycle({ now = Date.now(), candidates = null, analyze = analyzeWallet,
  maxWallets = 4, stream = null } = {}) {
  const registry = await readWalletRegistry();
  const registered = registry.filter((r) => r.chain !== 'solana'); // no decoded Solana swap ledger yet
  let observed = stream;
  if (observed == null && candidates == null) {
    try { observed = await labelledEvents({ minUsd: 100_000 }); }
    catch { observed = { events: [] }; }
  }
  const discovered = candidates || candidateWallets(observed?.events || [], 24);
  const targets = new Map();
  for (const row of registered) targets.set(recordId(row.chain, row.address), { chain: row.chain, address: row.address, registry: row, discovered: false });
  for (const row of discovered) {
    const id = recordId(row.chain, row.address);
    if (!targets.has(id)) targets.set(id, { chain: row.chain, address: row.address, registry: null, discovered: true });
  }
  if (!targets.size) return { checked: 0, qualified: 0, indexedSwaps: 0, status: 'no-candidates', durable: storeDurable() };
  // Never rescan the same first four registered whales forever. Sample fresh
  // on-chain candidates first and rotate by the last *actual* analysis time;
  // this widens coverage across cycles without raising the RPC budget.
  const lastIndex = await readVerifiedIndex();
  const lastChecked = new Map(lastIndex.profiles.map((p) => [recordId(p.chain, p.address), p.updatedAt]));
  const chosen = [...targets.values()].sort((a, b) =>
    (lastChecked.get(recordId(a.chain, a.address)) || 0) - (lastChecked.get(recordId(b.chain, b.address)) || 0)
    || Number(b.discovered) - Number(a.discovered)
    || recordId(a.chain, a.address).localeCompare(recordId(b.chain, b.address)))
    .slice(0, Math.max(1, Math.min(8, maxWallets)));

  const results = await Promise.allSettled(chosen.map(async (row) => {
    const w = await analyze(row.address, row.chain);
    if (w.chain !== row.chain || String(w.address).toLowerCase() !== String(row.address).toLowerCase())
      throw new Error('MISMATCHED_WALLET');
    const profile = profileFor(w, row.registry, now);
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
  if (!successful.length) return { checked: chosen.length, qualified: 0, indexedSwaps: 0,
    errors: results.length, status: 'upstreams-unavailable', durable: storeDurable() };

  // Union with the durable copy first; another serverless instance may have
  // indexed a different wallet. Blob is last-writer-wins, so cron should have
  // one operator and writes remain best-effort, not a financial ledger.
  const prev = await readVerifiedIndex({ fresh: true });
  const profiles = new Map(prev.profiles.filter((p) => p.updatedAt > now - INDEX_AGE)
    .map((p) => [recordId(p.chain, p.address), p]));
  const swaps = new Map(prev.swaps.filter((s) => s.timestamp > now - INDEX_AGE)
    .map((s) => [s.id, s]));
  for (const r of successful) {
    profiles.set(recordId(r.profile.chain, r.profile.address), r.profile);
    for (const s of r.swaps) swaps.set(s.id, s);
  }
  await storeSet(KEY, {
    indexedAt: now,
    profiles: [...profiles.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROFILES),
    swaps: [...swaps.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_SWAPS)
  }, 8 * WINDOWS.H24);
  return { checked: chosen.length, qualified: successful.filter((r) => r.profile.qualified).length,
    indexedSwaps: successful.reduce((sum, r) => sum + r.swaps.length, 0),
    errors: chosen.length - successful.length, status: 'sampled', durable: storeDurable() };
}

/** Fast read, from the indexed snapshot (not a fresh scan on every MCP/AI/UI
 * request). Optional price enrichment only for EARLY qualified fills. */
export async function getVerifiedIntelligence({ window = '24h', chain = null, token = null,
  includePrices = false, now = Date.now(), index = null, events = null } = {}) {
  const snapshot = index || await readVerifiedIndex();
  const observed = events || await readEvents().catch(() => ({ events: [] }));
  const out = buildConsensus({ profiles: snapshot.profiles, swaps: snapshot.swaps, events: observed.events,
    indexedAt: snapshot.indexedAt, window, chain, token, durable: storeDurable(), now });
  if (includePrices && out.earlyEntries.length) {
    const byChain = new Map();
    for (const row of out.earlyEntries) {
      if (!byChain.has(row.chain)) byChain.set(row.chain, []);
      byChain.get(row.chain).push(row.token);
    }
    const markets = new Map();
    await Promise.all([...byChain].map(async ([id, tokens]) => {
      try { markets.set(id, await tokenMarkets(tokens.slice(0, 8), { chain: DEX_SLUGS[id] })); }
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
  }
  return out;
}
