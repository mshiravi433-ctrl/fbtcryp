/**
 * FBT AI RISK ENGINE — THE EVIDENCE LAYER
 * ===========================================================================
 * The engine (lib/risk) is pure: it judges what it is given. This hook is where
 * the evidence comes from, and the budget it spends getting there is the whole
 * design of this file.
 *
 * ─── WHAT IT READS, AND WHY EACH ONE IS ALREADY PAID FOR ────────────────────
 *   portfolio      usePortfolioRoom()  — the SAME hook the wallet and the chat
 *                  use. Holdings, cost basis, allocation, correlation (daily
 *                  candles for the top four), measured 24h performance and the
 *                  per-chain read results. Nothing new is asked of the network.
 *   markets        the same room's `marketRows` — prices, 24h change, volume,
 *                  market cap and the 7-day sparkline that volatility is
 *                  measured from. No second market API.
 *   contracts      fetchTokenRisk() (lib/tokenRisk.js → GoPlus through our own
 *                  proxy) for AT MOST the four largest holdings that have a
 *                  contract address, each cached 5 minutes by that module.
 *                  A wallet with 40 tokens must not open 40 upstream scans to
 *                  paint a risk score.
 *   lending        readLendingBffPositions() for the connected wallet on a
 *                  chain the BFF supports — the health factor, read from the
 *                  pool. Only when a wallet is connected; never when not.
 *   leverage       the futures store's positions (already read by the perp
 *                  screen) — reusing them means opening the risk page does not
 *                  quote a venue again.
 *   providers      /api/providers/status, the operational truth about whether
 *                  the platforms a route passes through answer right now.
 *   settings       the device's own switches (auto-lock, session length,
 *                  hidden balances) — no request at all.
 *
 * ─── THE RULES ──────────────────────────────────────────────────────────────
 *   · Every fetch has its own try/catch: a failed contract scan must not stop
 *     the score, and a failed lending read must not stop the heat map. What
 *     failed becomes an `unavailable` entry the panel prints.
 *   · Nothing polls faster than it must. The book is re-scored when its inputs
 *     change; the only interval here is the provider status (5 minutes).
 *   · `enabled: false` mounts the hook and touches no network — that is how the
 *     chat can render a risk card without a second read of the world.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePortfolioRoom } from './useIntelligenceRooms';
import { useWallet } from '../context/WalletContext';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useFuturesStore } from '../lib/futures-engine/store.js';
import { fetchTokenRisk } from '../lib/tokenRisk.js';
import { readLendingBffPositions } from '../lib/lending-service.js';
import { buildRiskReport, createRiskMonitor } from '../lib/risk/riskEngine.js';
import { buildStressLegs, runAllScenarios } from '../lib/risk/stressTests.js';
import { apiBase } from '../lib/apiBase.js';
import { writeBookSnapshot } from '../lib/risk/bookSnapshot.js';

export const RISK_EVIDENCE_VERSION = 'fbt.risk-evidence.1';

/** How many holdings get a contract scan. Four is the request budget. */
export const CONTRACT_SCAN_LIMIT = 4;

/** Chains the lending BFF answers for (mirror of server/lending.js pools). */
const LENDING_CHAINS = [1, 10, 56, 137, 8453, 42161, 43114, 59144, 146];

/** A holding needs both an address and a chain to be scannable. */
const contractKeyOf = (row) => (
  row?.address && row?.chainId != null ? `${row.chainId}:${String(row.address).toLowerCase()}` : null
);

/** One provider-status read, cached for five minutes, never thrown. */
async function readProviders() {
  try {
    const res = await fetch(`${apiBase()}/providers/status`, {
      headers: { accept: 'application/json' },
      cache: 'no-store'
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && Array.isArray(body.providers) ? body : null;
  } catch {
    return null;
  }
}

export function useRiskEngine({ enabled = true } = {}) {
  const wallet = useWallet();
  const connected = Boolean(enabled && wallet?.address);

  const room = usePortfolioRoom({ enabled });
  /*
   * ─── THREE SELECTORS, NOT ONE OBJECT ───────────────────────────────────
   * A zustand selector that RETURNS A NEW OBJECT is a new value on every store
   * read, which re-renders on every read, which asks the store again — the same
   * loop that once produced the `/api/system/state` storm. This hook feeds its
   * `settings` into a `useMemo`, so one object literal here would rebuild the
   * whole report on every render, forever. Caught by the page test: "Maximum
   * update depth exceeded".
   *
   * Selecting three primitives gives three stable values, and the object is
   * re-created inside the memo where a new identity is harmless.
   */
  const autoLockMinutes = useSettingsStore((s) => s.autoLockMinutes);
  const walletSessionMinutes = useSettingsStore((s) => s.walletSessionMinutes);
  const hideBalances = useSettingsStore((s) => s.hideBalances);

  const [providers, setProviders] = useState(null);
  const [scans, setScans] = useState({});
  const [scansState, setScansState] = useState('idle');
  const [lending, setLending] = useState(null);
  const [lendingState, setLendingState] = useState('idle');

  /* ── contract scans (bounded, cached upstream) ────────────────────────── */
  const targets = useMemo(() => {
    if (!enabled) return [];
    return (room.rows || [])
      .filter((r) => Number(r?.value) > 0)
      .map((r) => ({ row: r, key: contractKeyOf(r) }))
      .filter((x) => x.key)
      .sort((a, b) => Number(b.row.value) - Number(a.row.value))
      .slice(0, CONTRACT_SCAN_LIMIT);
  }, [enabled, room.rows]);
  const targetsKey = targets.map((t) => t.key).join('|');

  useEffect(() => {
    if (!enabled || !targets.length) {
      setScans({});
      setScansState('idle');
      return undefined;
    }
    let cancelled = false;
    setScansState('loading');
    (async () => {
      const out = {};
      /* SEQUENTIAL on purpose: the upstream scanner is rate-limited per IP and
         a burst of four is what gets a user throttled. Four cached reads are
         cheap; four simultaneous cold ones are not. */
      for (const target of targets) {
        if (cancelled) return;
        try {
          const verdict = await fetchTokenRisk({
            chainId: target.row.chainId,
            address: target.row.address
          });
          out[target.key] = verdict;
        } catch {
          /* Left out of the map: the engine treats a missing key as unscanned
             and names it, which is the honest outcome. */
        }
      }
      if (cancelled) return;
      setScans(out);
      setScansState('done');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, targetsKey]);

  /* ── lending position (only with a wallet, only on a BFF chain) ───────── */
  const lendingChainId = connected ? Number(wallet?.chainId) : null;
  useEffect(() => {
    if (!connected || !LENDING_CHAINS.includes(Number(lendingChainId))) {
      setLending(lendingChainId == null ? null : { status: 'unsupported-chain', reason: 'UNSUPPORTED_CHAIN' });
      setLendingState('idle');
      return undefined;
    }
    let cancelled = false;
    setLendingState('loading');
    (async () => {
      const res = await readLendingBffPositions({ chainId: Number(lendingChainId), wallet: wallet.address });
      if (cancelled) return;
      if (res.ok) {
        setLending({
          status: 'read',
          healthFactor: res.account?.healthFactor ?? null,
          totalCollateralUsd: res.account?.totalCollateralUsd ?? null,
          totalDebtUsd: res.account?.totalDebtUsd ?? null,
          ltvPct: res.account?.ltvPct ?? null,
          liquidationThresholdPct: res.account?.liquidationThresholdPct ?? null,
          source: res.account?.source ?? 'on-chain'
        });
      } else {
        setLending({ status: 'unavailable', reason: res.reason || 'LENDING_UNAVAILABLE' });
      }
      setLendingState('done');
    })();
    return () => { cancelled = true; };
  }, [connected, lendingChainId, wallet?.address]);

  /* ── provider status (5 minutes; failure stays null) ──────────────────── */
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const run = async () => {
      const body = await readProviders();
      if (alive && body) setProviders(body);
    };
    run();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      run();
    }, 5 * 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [enabled]);

  /* ── leverage (read from the shared futures store, not a second quote) ── */
  const positionsByProvider = useFuturesStore((s) => s.positionsByProvider);
  const leverage = useMemo(() => {
    if (!enabled) return { status: 'disabled' };
    const groups = Object.entries(positionsByProvider || {});
    const positions = groups.flatMap(([providerId, rows]) => (Array.isArray(rows) ? rows.map((r) => ({ ...r, providerId })) : []))
      .filter((p) => (Number(p?.notionalUsd) || 0) > 0 || (Number(p?.collateralUsd) || 0) > 0);
    if (!positions.length) return { status: 'read', positions: [], liquidationModel: 'none-open' };
    return { status: 'read', positions, liquidationModel: 'venue-model' };
  }, [enabled, positionsByProvider]);

  /* ── the report ───────────────────────────────────────────────────────── */
  const monitorRef = useRef(null);
  if (!monitorRef.current) monitorRef.current = createRiskMonitor({ max: 40 });
  const [monitor, setMonitor] = useState(null);

  const inputs = useMemo(() => ({
    holdings: room.intel?.rows || [],
    intel: room.intel || null,
    analysis: room.analysis || null,
    correlation: room.correlation || null,
    performance: room.performance || null,
    markets: room.markets || [],
    chainReads: room.chains?.map((c) => ({
      chainId: c.chainId,
      failed: Boolean(c.error),
      stale: Boolean(c.stale),
      unpriced: (c.rows || []).filter((r) => r.value == null).length,
      rows: (c.rows || []).length
    })) || [],
    scans,
    lending,
    leverage,
    providers,
    settings: { autoLockMinutes, walletSessionMinutes, hideBalances },
    /* NO `now: Date.now()` HERE. A timestamp captured inside a memo is a new
       value on every recompute, and recomputing to refresh a clock is a loop.
       `buildRiskReport` stamps its own `generatedAt` when none is supplied. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    room.intel, room.analysis, room.correlation, room.performance, room.markets,
    room.chains, scans, lending, leverage, providers,
    autoLockMinutes, walletSessionMinutes, hideBalances
  ]);

  /* The contract key has to travel WITH each holding for the scan map to be
     usable: the engine must not guess which address a symbol belongs to. */
  const holdingsWithKeys = useMemo(
    () => (inputs.holdings || []).map((h) => ({ ...h, contractKey: contractKeyOf(h) })),
    [inputs.holdings]
  );

  const report = useMemo(
    () => buildRiskReport({ ...inputs, holdings: holdingsWithKeys }),
    [inputs, holdingsWithKeys]
  );

  /* Push each settled reading into the monitor so the live panel can say what
     moved, and by how much, without inventing a trend. */
  useEffect(() => {
    if (report.score.value == null) return;
    const d = monitorRef.current.push({
      at: report.generatedAt,
      value: report.score.value,
      coverage: report.score.coverage,
      tone: report.score.tone,
      families: report.families
    });
    if (d) setMonitor(d);
  }, [report.score.value, report.score.coverage, report.score.tone, report.generatedAt]);

  const legs = useMemo(
    () => buildStressLegs({
      holdings: holdingsWithKeys,
      markets: inputs.markets,
      total: report.totalUsd,
      bookSigmaPct: report.families.find((f) => f.id === 'volatility')?.facts?.bookSigmaPct ?? null
    }),
    [holdingsWithKeys, inputs.markets, report.totalUsd, report.families]
  );

  const stress = useMemo(() => {
    if (!enabled || !legs.length) return [];
    const positions = (leverage.positions || []).map((p) => ({
      symbol: p.symbol, leverage: p.leverage, collateralUsd: p.collateralUsd,
      liquidationDistancePct: p.liquidationDistancePct ?? p.distancePct ?? null,
      sigmaPct: report.families.find((f) => f.id === 'volatility')?.facts?.bookSigmaPct ?? 4,
      beta: 1.3
    }));
    const facts = report.families.find((f) => f.id === 'volatility')?.facts ?? {};
    return runAllScenarios({
      legs,
      positions,
      bookSigmaPct: facts.bookSigmaPct ?? null,
      /* The same VaR the overview prints, so the correlation card measures the
         value of diversification against the number the user already saw. */
      var95Usd: facts.var95Usd ?? null
    });
  }, [enabled, legs, leverage.positions, report.families]);

  /*
   * ─── LEAVE A RECORD FOR THE SWAP REVIEW ────────────────────────────────
   * The pre-trade gate needs the book, and it is opened from /swap — a screen
   * that must not read sixteen chains while a review sheet is up. So the risk
   * page writes down the valued rows and the market rows that produced them,
   * and `evaluateSwapRisk` reads that record (and refuses to use it once it is
   * older than MAX_AGE_MS).
   *
   * Only a book with a real total is written: a zero-total read is "nothing
   * priced yet", and storing that would make every later trade look enormous.
   */
  useEffect(() => {
    if (!connected || !wallet?.address) return;
    if (!(report.totalUsd > 0)) return;
    writeBookSnapshot({
      address: wallet.address,
      rows: holdingsWithKeys,
      markets: inputs.markets,
      total: report.totalUsd,
      at: report.generatedAt
    });
  }, [connected, wallet?.address, holdingsWithKeys, inputs.markets, report.totalUsd, report.generatedAt]);

  const refresh = useCallback(() => {
    /* Re-run only the things that can be re-run from here; the portfolio room
       owns its own refresh button and polling. */
    readProviders().then((body) => { if (body) setProviders(body); }).catch(() => {});
  }, []);

  return {
    version: RISK_EVIDENCE_VERSION,
    connected: room.connected,
    loading: room.loading || scansState === 'loading' || lendingState === 'loading',
    report,
    stress,
    legs,
    monitor: monitor || monitorRef.current.delta(),
    evidence: {
      contractsScanned: Object.keys(scans).length,
      contractTargets: targets.length,
      lending: lendingState,
      providers: providers ? providers.summary ?? null : null,
      chains: room.chains?.length ?? 0,
      marketRows: inputs.markets.length
    },
    rows: room.rows,
    intel: room.intel,
    markets: inputs.markets,
    coverage: room.coverage,
    performance: room.performance,
    refresh,
    resetMonitor: () => { monitorRef.current.reset(); setMonitor(null); }
  };
}

export default useRiskEngine;
