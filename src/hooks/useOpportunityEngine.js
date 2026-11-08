/**
 * THE OPPORTUNITY ENGINE, WIRED TO THE APP
 * ---------------------------------------------------------------------------
 * One hook, three consumers:
 *
 *   pages/Opportunities.jsx      the engine room (Top, Personalized, Scanner)
 *   pages/OpportunityDetail.jsx  one row, in depth (re-reads a single row from
 *                                the stored scan so a refresh never loses it)
 *   components/ai/OpportunityDashboard.jsx  the in-chat card
 *
 * ─── THE DATA SPINE ─────────────────────────────────────────────────────────
 *   wallet balances + prices   → buildCapitalSnapshot()   (capital, networks)
 *   /api/yields (+ venue pins) → normalizeYieldRows()     (LP, farms, lending)
 *   smart-money consensus      → normalizeWhaleRows()     (verified swaps only)
 *   /api/early-tokens          → normalizeEmergingRows()  (fresh pools only)
 *   /api/markets               → the price map used to pick a token for a row
 *
 * Every feed is isolated: one failing source lowers coverage, never the page.
 * Nothing is re-timed to the market poll — the scan is a deliberate action plus
 * a bounded auto-refresh, because ranking 300 pools is not a 30-second task.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext.jsx';
import { useMultiChainPortfolio } from './useMultiChainPortfolio.js';
import { getMarkets } from '../lib/api.js';
import { getYields } from '../lib/yields.js';
import { fetchIntelligence, fetchEarlyTokens } from '../lib/smartMoneyClient.js';
import { verifiedSignals } from '../lib/smartMoneyEvidence.js';
import {
  buildCapitalSnapshot, scanPersonalised, readRiskProfile, writeRiskProfile
} from '../lib/opportunity/feed.js';
import { attachTokenIds } from '../lib/opportunity/tokenMatch.js';
import { sanitizeScan, sanitizeOpportunityRow } from '../lib/opportunity/sanitize.js';

/** How long one scan is considered current before it is re-run on mount. */
const SCAN_TTL_MS = 3 * 60_000;
const SCAN_LIMIT = 60;
const SCAN_STORAGE_KEY = 'fbt.opportunity.scan.v1';
/** Rows kept from a stored scan. The whole 60-row result is ~90 KB of JSON; a
    phone in private mode must not pay for that, so it degrades to no cache. */
const STORED_ROWS = 40;

function readStoredScan(capital) {
  try {
    const raw = globalThis.localStorage?.getItem(SCAN_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.schema !== 'fbt.opportunity-scan.v1') return null;
    if (!Array.isArray(data.opportunities)) return null;
    if (Date.now() - Number(data.savedAt) > SCAN_TTL_MS * 4) return null;
    /* A stored scan priced the OLD capital. Re-using it as if it were current
       would show fees for a number the user no longer has, so it is dropped. */
    const storedCapital = Number(data.capitalUsd);
    const capitalNow = Number(capital?.investableUsd);
    if (!Number.isFinite(storedCapital) || !Number.isFinite(capitalNow) || Math.abs(storedCapital - capitalNow) > 0.5) return null;
    /* A STORED SHAPE IS NOT A VALIDATED SHAPE. The cache outlives builds: a row
       written by an older version is read by this one, and a field that used to
       be a string can be an object now (or vice versa). Sanitising on the way
       OUT is what keeps the room renderable across a deploy — see
       lib/opportunity/sanitize.js for the crash this fixes. */
    return { ...sanitizeScan(data), restored: true };
  } catch {
    return null;
  }
}

function writeStoredScan(scan) {
  try {
    const payload = {
      schema: 'fbt.opportunity-scan.v1',
      savedAt: Date.now(),
      capitalUsd: Number(scan?.capital?.investableUsd) || 0,
      riskProfile: scan?.profile?.riskProfile ?? null,
      profile: scan?.profile ?? null,
      opportunities: (scan?.opportunities ?? []).slice(0, STORED_ROWS),
      rejected: (scan?.rejected ?? []).slice(0, STORED_ROWS),
      coverage: scan?.coverage ?? [],
      feeds: scan?.feeds ?? null,
      personalisation: scan?.personalisation ?? null,
      scanner: (scan?.scanner ?? []).slice(0, STORED_ROWS),
      total: scan?.total ?? 0,
      eligibleTotal: scan?.eligibleTotal ?? 0,
      rejectedTotal: scan?.rejectedTotal ?? 0,
      cortex: scan?.cortex ?? null,
      byCategory: scan?.byCategory ?? {},
      updatedAt: scan?.updatedAt ?? null
    };
    globalThis.localStorage?.setItem(SCAN_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Read one stored row by id — used by the detail page after a reload. */
export function readStoredOpportunity(opportunityId) {
  try {
    const raw = globalThis.localStorage?.getItem(SCAN_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const all = [
      ...(Array.isArray(data?.opportunities) ? data.opportunities : []),
      ...(Array.isArray(data?.rejected) ? data.rejected : [])
    ];
    const found = all.find((r) => r && r.opportunityId === opportunityId) || null;
    return found ? sanitizeOpportunityRow(found) : null;
  } catch {
    return null;
  }
}

const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), ms);
  Promise.resolve(promise).then(
    (v) => { clearTimeout(timer); resolve(v); },
    (e) => { clearTimeout(timer); reject(e); }
  );
});
const errText = (e) => String(e?.message || e || 'ERROR').slice(0, 120);

/**
 * One scan cycle. Exported so it can be called outside React (a probe, or a
 * server-side prewarm) with injected feeds.
 */
export async function runScan({
  capital, riskProfile, horizonDays = 30, cortexReadout = null,
  feeds = null, now = Date.now()
} = {}) {
  const load = {
    yields: async () => feeds?.yields ?? getYields(),
    whales: async () => feeds?.whales ?? fetchIntelligence('24h', undefined, { includePrices: false }),
    emerging: async () => feeds?.emerging ?? fetchEarlyTokens(24),
    markets: async () => feeds?.markets ?? getMarkets({ page: 1, perPage: 40, vs: 'usd' })
  };
  const jobs = await Promise.all(Object.entries(load).map(async ([key, job]) => {
    try { return [key, { value: await withTimeout(job(), 30000, key), error: null }]; }
    catch (e) { return [key, { value: null, error: errText(e) }]; }
  }));
  const got = Object.fromEntries(jobs);

  const yieldPayload = got.yields.value;
  const yieldStamp = Number(yieldPayload?.at);
  /* The feed's own freshness rule: an observation older than two hours is not
     a rate we may show as current. Same test server/yields.js enforces. */
  const yieldsFresh = Number.isFinite(yieldStamp) && yieldStamp > 0
    && yieldStamp <= now + 60_000 && now - yieldStamp < 2 * 3600_000;
  const pools = yieldsFresh && Array.isArray(yieldPayload?.pools) ? yieldPayload.pools : [];
  const venues = yieldsFresh && Array.isArray(yieldPayload?.venues) ? yieldPayload.venues : [];

  const consensus = verifiedSignals(got.whales.value);
  const whaleFresh = consensus?.dataStatus === 'observed' || consensus?.dataStatus === 'live';
  const early = got.emerging.value;
  const earlyStamp = Number(early?.at);
  const earlyFresh = early?.dataStatus === 'live' && Number.isFinite(earlyStamp)
    && now - earlyStamp < 10 * 60_000 && earlyStamp <= now + 60_000;

  const scan = scanPersonalised({
    capital,
    riskProfile,
    horizonDays,
    now,
    limit: SCAN_LIMIT,
    cortexReadout,
    feeds: {
      yields: pools,
      venues,
      whaleConsensus: whaleFresh ? consensus.rows : [],
      emergingTokens: earlyFresh && Array.isArray(early.tokens) ? early.tokens : [],
      arbitrage: [],
      rwaAssets: [],
      venuePrices: []
    }
  });

  scan.feeds = {
    yields: { status: yieldsFresh ? (pools.length ? 'live' : 'empty') : got.yields.error ? 'unavailable' : 'stale', at: yieldsFresh ? yieldStamp : null, rows: pools.length, error: got.yields.error },
    venues: { status: venues.length ? 'live' : 'empty', rows: venues.length },
    whales: { status: whaleFresh ? (consensus.rows.length ? 'observed' : 'insufficient-evidence') : got.whales.error ? 'unavailable' : 'stale', rows: consensus.rows.length, error: got.whales.error },
    emerging: { status: earlyFresh ? (early.tokens.length ? 'live' : 'empty') : got.emerging.error ? 'unavailable' : 'stale', at: earlyFresh ? earlyStamp : null, rows: earlyFresh ? early.tokens.length : 0, error: got.emerging.error },
    markets: { status: got.markets.value ? 'live' : got.markets.error ? 'unavailable' : 'unknown', rows: Array.isArray(got.markets.value) ? got.markets.value.length : 0, error: got.markets.error }
  };
  const marketRows = Array.isArray(got.markets.value) ? got.markets.value : [];
  scan.marketRows = marketRows;
  /* A chain-and-symbol exact match to a live market row is the ONLY evidence
     used to give a card a token page; see lib/opportunity/tokenMatch.js. */
  attachTokenIds(scan, marketRows);
  scan.dataStatus = [scan.feeds.yields.status, scan.feeds.whales.status, scan.feeds.emerging.status]
    .some((s) => s === 'live' || s === 'observed') ? 'live' : 'unavailable';
  /* ONE PASS, ONE SHAPE. The engine already labels its own rows, but `scanner`
     and `coverage` are assembled HERE from the same feed values, and this hook
     is also the thing that WRITES the cache. Sanitising the finished scan means
     the card, the detail page and the stored copy can never disagree — and no
     later refactor of a feed adapter can put an object inside a React child. */
  return sanitizeScan(scan);
}

/**
 * The hook.
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled]   false mounts with no network at all
 * @param {boolean} [options.autoScan]  run one scan on mount when stale
 */
export function useOpportunityEngine({ enabled = true, autoScan = true } = {}) {
  const wallet = useWallet();
  const portfolio = useMultiChainPortfolio(enabled ? wallet : null);
  const [riskProfile, setRiskProfileState] = useState(() => readRiskProfile());
  const [horizonDays, setHorizonDays] = useState(30);
  const [manualCapital, setManualCapital] = useState(null);
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRunAt, setLastRunAt] = useState(0);
  const seq = useRef(0);

  const capital = useMemo(() => buildCapitalSnapshot({
    rows: portfolio.rows ?? [],
    priceDataStatus: portfolio.priceDataStatus,
    walletCanSign: Boolean((wallet?.isConnected && wallet?.address && !wallet?.locked) || wallet?.address),
    connected: Boolean(wallet?.address),
    failures: portfolio.failedChains ?? [],
    staleChains: portfolio.staleChains ?? []
  }), [portfolio.rows, portfolio.priceDataStatus, portfolio.failedChains, portfolio.staleChains, wallet?.isConnected, wallet?.address, wallet?.locked]);

  /* A user-entered capital overrides the wallet read: someone planning a
     position they have not funded yet is the normal case, not an error. It is
     stored on the snapshot so the UI can say which number is in use. */
  const effectiveCapital = useMemo(() => {
    if (manualCapital == null || !Number.isFinite(Number(manualCapital))) return capital;
    const amount = Math.max(0, Number(manualCapital));
    return { ...capital, investableUsd: amount, stableInvestableUsd: Math.min(amount, capital.stableUsd), capitalStatus: 'manual' };
  }, [capital, manualCapital]);

  /* The last scan is kept on the device so the room is never empty for the
     two seconds a fresh scan takes — marked `fromStorage` so the header can say
     the ranking on screen is the previous one. */
  const [restored, setRestored] = useState(null);
  const scanNow = useCallback(async (overrides = {}) => {
    const mine = ++seq.current;
    const capitalNow = overrides.capital ?? effectiveCapital;
    const riskNow = overrides.riskProfile ?? riskProfile;
    const horizonNow = overrides.horizonDays ?? horizonDays;
    setLoading(true);
    setError(null);
    /* A scan that priced capital the user no longer has is history, not a
       result: the restored snapshot is used for its shape only. */
    const stored = readStoredScan(capitalNow);
    if (stored) setRestored(stored);
    try {
      const result = await runScan({
        capital: capitalNow,
        riskProfile: riskNow,
        horizonDays: horizonNow,
        cortexReadout: overrides.cortexReadout ?? null
      });
      if (seq.current !== mine) return null;
      setScan(result);
      setRestored(null);
      setLastRunAt(Date.now());
      writeStoredScan(result);
      return result;
    } catch (e) {
      if (seq.current === mine) setError(errText(e));
      return null;
    } finally {
      if (seq.current === mine) setLoading(false);
    }
  }, [effectiveCapital, riskProfile, horizonDays]);

  /* One automatic scan per mount when there is nothing current. A deliberate
     refresh is the button; this only fills an empty room. */
  const booted = useRef(false);
  useEffect(() => {
    if (!enabled || !autoScan || booted.current || loading) return;
    booted.current = true;
    void scanNow();
  }, [enabled, autoScan, loading, scanNow]);

  const setRiskProfile = useCallback((id) => {
    setRiskProfileState(id);
    writeRiskProfile(id);
  }, []);

  /* What the UI should draw: the live scan, or the restored one while the
     fresh scan is in flight. */
  const shown = scan ?? restored;

  const rows = useMemo(() => {
    const accepted = shown?.opportunities ?? [];
    const rejected = shown?.rejected ?? [];
    return { accepted, rejected, all: [...accepted, ...rejected] };
  }, [shown]);

  return {
    capital: effectiveCapital,
    walletCapital: capital,
    riskProfile,
    setRiskProfile,
    horizonDays,
    setHorizonDays,
    manualCapital,
    setManualCapital,
    scan: shown,
    rows,
    loading,
    error,
    lastRunAt,
    scanNow,
    refresh: scanNow,
    /** true when a scan exists but is older than the TTL — the UI says «قدیمی». */
    stale: Boolean(shown) && !scan && Boolean(restored),
    fromStorage: Boolean(!scan && restored)
  };
}

export default useOpportunityEngine;
