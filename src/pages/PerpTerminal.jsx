/**
 * FUTURES TERMINAL — `/perp/terminal`.
 * ---------------------------------------------------------------------------
 * A dedicated desk: markets on one side, chart in the middle, ticket on the
 * other, and the book/tape/risk stack underneath. It is a NEW ROUTE on purpose.
 *
 * ─── WHY NOT /perp ──────────────────────────────────────────────────────────
 * `/perp` is a pair LIST by design, and two suites pin that:
 * test/perp-redesign.test.jsx and test/perp-layout.test.jsx assert the absence
 * of a ticket, a fee table and a liquidation table on that page. Turning it
 * into a terminal would have to delete those assertions — i.e. it would break
 * the very thing they were written to protect. So the desk gets its own path,
 * behind its own flag, and `/perp` keeps behaving exactly as it does today.
 *
 * ─── WHAT IS REAL HERE ──────────────────────────────────────────────────────
 *   markets      the three in-app venues (dYdX, Ostium, Velocity), from the
 *                same reads `/perp` uses, refreshed only while visible
 *   chart        components/FuturesMarketChart — the venue's own candles
 *   book + tape  dYdX's public indexer via our BFF (2s / 5s caches)
 *   top bar      the venue's mark, 24h change, 24h HIGH/LOW (derived from the
 *                venue's 24 hourly candles — the market row has no range), the
 *                funding APR and the time to the next settlement
 *   risk         the position list and the engines in futures-engine/risk.js
 *   ticket       the SAME prepare → sign paths `/perp` uses (see Ticket.jsx)
 *
 * ─── WHAT IT SAYS WHEN IT CANNOT BE REAL ────────────────────────────────────
 * Every panel has an explicit empty/unknown state, and an unknown number is
 * «—», never 0. A venue that cannot be read keeps its last known list and is
 * labelled stale. Nothing on this screen is simulated, and nothing is labelled
 * "live" unless a read succeeded.
 *
 * ─── POLLING BUDGET (the reason this page does not melt the server) ──────────
 * Everything is visibility-gated (lib/visibilityPoll.js) and every cadence is
 * chosen against the cache in front of it, so the page hits the SERVER far less
 * often than the clock suggests:
 *   markets 30s · chart on demand · book 5s (route cache 5s) ·
 *   tape 4s (route cache 2s) · account 15s (no-store) — all paused when hidden.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';

import PageTransition from '../components/PageTransition';
import FuturesMarketChart from '../components/FuturesMarketChart';
import TokenIcon from '../lib/tokenIcon';
import DepthChart from '../components/perp-terminal/DepthChart';
import Tape from '../components/perp-terminal/Tape';
import RiskPanel from '../components/perp-terminal/RiskPanel';
import Ticket from '../components/perp-terminal/Ticket';
import { topBar } from '../components/perp-terminal/desk.js';
import { pollWhileVisible } from '../lib/visibilityPoll';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { useWallet } from '../context/WalletContext';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import { getFuturesFeePreview, getFuturesMarkets, prepareFutures, verifyFutures } from '../lib/futuresClient';
import {
  ROUTE, ROUTE_META, indexVenueMarkets, pickRoute, leverageCeiling, dydxOrderSize, classifyDydxOrderError
} from '../lib/perpRoutes';
import {
  dydxSessionAddress, getDydxMarkets, getDydxSubaccount, placeDydxOrder,
  getDydxOrderbook, getDydxTrades, getDydx24hRange
} from '../lib/dydx';
import '../styles/perp-terminal.css';

const MARKET_POLL_MS = 30_000;
const BOOK_POLL_MS = 5_000;
const TAPE_POLL_MS = 4_000;
const ACCOUNT_POLL_MS = 15_000;

/** Third-column tabs: the panels under the book. */
const TABS = ['book', 'tape', 'risk', 'funding'];

export default function PerpTerminal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const wallet = useWallet();
  const solana = useSolanaWallet();

  const [venues, setVenues] = useState({ velocity: [], ostium: [], dydx: [], dydxLoaded: false, stale: false });
  /*
   * Has ANY venue read landed yet?
   *
   * `indexVenueMarkets` keeps a static Velocity fallback so a pair stays
   * routable when the feeds are down — correct for the list, wrong for the
   * first paint here: before the first read arrives it would route BTC to a
   * committed fallback venue and mount that venue's chart, then swap it a
   * moment later. A flash of the wrong market is worse than a skeleton, so the
   * desk holds the chart until a real read has produced a real route.
   */
  const [venuesReady, setVenuesReady] = useState(false);
  const [side, setSide] = useState('long');
  const [tab, setTab] = useState('book');
  const [book, setBook] = useState(null);
  const [bookState, setBookState] = useState({ loading: false, reason: null });
  const [tape, setTape] = useState({ trades: [], live: false, reason: null, loading: false });
  const [range, setRange] = useState(null);
  const [account, setAccount] = useState({ positions: [], equityUsd: null, maintenanceMarginUsd: null, availableBalanceUsd: null, loading: false, reason: null });
  const [placing, setPlacing] = useState(false);
  const [execError, setExecError] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const alive = useRef(true);

  /* ── the selected pair ─────────────────────────────────────────────────── */
  const selectedBase = String(params.get('market') || 'BTC').toUpperCase();
  const setPair = useCallback((base) => {
    const next = new URLSearchParams(params);
    next.set('market', base);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const dydxMarket = useMemo(
    () => venues.dydx.find((m) => String(m.ticker || '').toUpperCase().startsWith(`${selectedBase}-`)) || null,
    [venues.dydx, selectedBase]
  );
  const ticker = dydxMarket?.ticker || `${selectedBase}-USD`;
  const isDydx = Boolean(dydxMarket) || venues.dydxLoaded;

  /* ── wallets ───────────────────────────────────────────────────────────── */
  const wallets = useMemo(() => ({
    evm: wallet?.isConnected ? { address: wallet.address } : null,
    solana: solana?.isConnected ? { address: solana.address, publicKey: solana.publicKey } : null
  }), [wallet, solana]);

  /*
   * WHICH VENUE SETTLES THIS PAIR.
   *
   * `indexVenueMarkets` merges the three venue catalogues by base symbol, and
   * `pickRoute` chooses the one whose WALLET FAMILY the user actually has —
   * that is the whole reason the route layer exists (see lib/perpRoutes.js).
   * The ticket must be built for the venue that will sign it, so this is the
   * single source of `venueId` on this page; no component guesses.
   */
  const routeIndex = useMemo(() => indexVenueMarkets(venues), [venues]);
  const route = useMemo(() => {
    const entry = routeIndex.get(selectedBase) || null;
    const picked = pickRoute(entry, { solana: Boolean(wallets.solana), evm: Boolean(wallets.evm) });
    return {
      entry,
      route: picked.route || null,
      reason: picked.reason || null,
      meta: picked.route ? ROUTE_META[picked.route] : null,
      options: picked.options || []
    };
  }, [routeIndex, selectedBase, wallets]);

  const venueId = route.meta?.providerId || null;

  /* ── market list (same three reads as /perp, visibility-gated) ─────────── */
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    const load = async () => {
      const [v, o, d] = await Promise.allSettled([
        getFuturesMarkets('drift'),
        getFuturesMarkets('ostium'),
        getDydxMarkets()
      ]);
      if (stopped || !alive.current) return;
      const bff = (r) => (r.status === 'fulfilled' && r.value?.ok && Array.isArray(r.value.data?.markets) ? r.value.data.markets : null);
      const dydxRows = d.status === 'fulfilled' && Array.isArray(d.value?.markets) && d.value.markets.length ? d.value.markets : null;
      const gotAny = Boolean(bff(v) || bff(o) || dydxRows);
      if (gotAny) setVenuesReady(true);
      setVenues((cur) => ({
        velocity: bff(v) ?? cur.velocity,
        ostium: bff(o) ?? cur.ostium,
        dydx: dydxRows ?? cur.dydx,
        dydxLoaded: cur.dydxLoaded || Boolean(dydxRows),
        /* Stale = this tick failed for a venue we had data for. A flaky read
           must not empty the desk; it must be LABELLED. */
        stale: (cur.velocity.length || cur.ostium.length || cur.dydx.length)
          ? !(bff(v) || bff(o) || dydxRows) : false
      }));
    };
    const off = pollWhileVisible(load, MARKET_POLL_MS);
    load();
    return () => { stopped = true; alive.current = false; off(); };
  }, []);

  /* ── dYdX order book (the only venue with a public book) ───────────────── */
  useEffect(() => {
    if (!isDydx) return undefined;
    let stopped = false;
    const load = async () => {
      setBookState((s) => ({ ...s, loading: true }));
      const r = await getDydxOrderbook(ticker);
      if (stopped) return;
      if (r?.live) {
        setBook(r);
        setBookState({ loading: false, reason: null });
      } else {
        setBookState({ loading: false, reason: 'BOOK_UNAVAILABLE' });
      }
    };
    const off = pollWhileVisible(load, BOOK_POLL_MS);
    load();
    return () => { stopped = true; off(); };
  }, [ticker, isDydx]);

  /* ── the tape ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isDydx) return undefined;
    let stopped = false;
    const load = async () => {
      setTape((s) => ({ ...s, loading: true }));
      const r = await getDydxTrades(ticker, 40);
      if (stopped) return;
      setTape({ trades: r?.trades || [], live: Boolean(r?.live), reason: r?.reason || null, loading: false });
    };
    const off = pollWhileVisible(load, TAPE_POLL_MS);
    load();
    return () => { stopped = true; off(); };
  }, [ticker, isDydx]);

  /* ── 24h high/low (one server read; the venue has no range field) ──────── */
  useEffect(() => {
    if (!isDydx) { setRange(null); return undefined; }
    let stopped = false;
    const load = async () => {
      const r = await getDydx24hRange(ticker);
      if (stopped) return;
      setRange(r?.live ? r : null);
    };
    const off = pollWhileVisible(load, 60_000);
    load();
    return () => { stopped = true; off(); };
  }, [ticker, isDydx]);

  /* ── the account ───────────────────────────────────────────────────────── */
  const accountAddress = route.route === ROUTE.DYDX ? dydxSessionAddress() : route.route === ROUTE.VELOCITY ? solana?.address : wallet?.address;
  useEffect(() => {
    if (!route.route) { setAccount((s) => ({ ...s, loading: false, reason: 'NO_ROUTE' })); return undefined; }
    if (!accountAddress) { setAccount({ positions: [], equityUsd: null, maintenanceMarginUsd: null, availableBalanceUsd: null, loading: false, reason: 'NO_WALLET' }); return undefined; }
    if (route.route !== ROUTE.DYDX) {
      /* Velocity positions are read client-side by the venue SDK and Ostium's
         are read by its own tab; this desk does not have a read path for them
         yet, and inventing an empty book would read as "no positions". */
      setAccount({ positions: [], equityUsd: null, maintenanceMarginUsd: null, availableBalanceUsd: null, loading: false, reason: 'ACCOUNT_UNREADABLE' });
      return undefined;
    }
    let stopped = false;
    const load = async () => {
      setAccount((s) => ({ ...s, loading: true }));
      const r = await getDydxSubaccount(accountAddress);
      if (stopped) return;
      const sub = r?.account?.subaccount || null;
      /*
       * The indexer sends `openPerpetualPositions` as an OBJECT keyed by
       * market in the subaccount read and as an ARRAY in some SDK helpers, so
       * both shapes are accepted — but the guard is written as "if it is not an
       * array, take its values", because the first version tested
       * Array.isArray() and then called Object.values(), which silently
       * produced NO POSITIONS on the shape the indexer actually uses. An empty
       * position list is indistinguishable from a flat account on screen, which
       * is the worst possible failure for a risk panel.
       */
      const rawPositions = sub?.openPerpetualPositions;
      const positionList = Array.isArray(rawPositions)
        ? rawPositions
        : (rawPositions && typeof rawPositions === 'object' ? Object.values(rawPositions) : []);
      const positions = positionList
        .filter(Boolean)
        .map((p) => ({
          symbol: p.market,
          side: Number(p.size) < 0 ? 'short' : 'long',
          notionalUsd: Math.abs(Number(p.size)) * Number(p.entryPrice || 0) || null,
          entryPrice: Number(p.entryPrice),
          unrealizedPnlUsd: Number(p.unrealizedPnl),
          leverage: (() => {
            const n = Math.abs(Number(p.size)) * Number(p.entryPrice || 0);
            return Number.isFinite(n) && n > 0 ? n / Math.max(1e-9, Number(sub?.equity) || 0) : null;
          })()
        }))
        .filter((p) => Number.isFinite(p.notionalUsd) && p.notionalUsd > 0);
      setAccount({
        positions,
        equityUsd: Number(sub?.equity) >= 0 ? Number(sub.equity) : null,
        maintenanceMarginUsd: Number(sub?.openPerpetualPositions ? sub?.maintenanceMargin : NaN) >= 0 ? Number(sub.maintenanceMargin) : null,
        availableBalanceUsd: Number(sub?.freeCollateral) >= 0 ? Number(sub.freeCollateral) : null,
        loading: false,
        reason: r?.live === false ? 'ACCOUNT_UNREADABLE' : null
      });
    };
    const off = pollWhileVisible(load, ACCOUNT_POLL_MS);
    load();
    return () => { stopped = true; off(); };
  }, [route.route, accountAddress]);

  /* ── the quote the top bar reads ───────────────────────────────────────── */
  const quote = useMemo(() => {
    const fromRoute = (route.route && route.entry ? route.entry[route.route]?.row : null) || null;
    if (!fromRoute) return null;
    /* dYdX's market row is the richest, and the range is the one field it does
       not carry — merged here, from the indexer's own candles. */
    return {
      mark: fromRoute.mid ?? fromRoute.mark ?? fromRoute.oraclePrice,
      oraclePrice: fromRoute.oraclePrice,
      priceChange24H: fromRoute.priceChange24H ?? fromRoute.priceChange24hPct,
      volume24H: fromRoute.volume24H ?? fromRoute.volume24hUsd,
      openInterest: fromRoute.openInterest ?? fromRoute.openInterestUsd,
      fundingAprPct: fromRoute.fundingAprPct,
      nextFundingRate: fromRoute.nextFundingRate,
      nextFundingAtMs: fromRoute.nextFundingAtMs ?? null,
      maxLeverage: route.route && route.entry ? leverageCeiling(route.entry[route.route]) : null,
      spreadBps: book?.spreadBps ?? null,
      high24h: range?.high24h ?? fromRoute.high24h ?? null,
      low24h: range?.low24h ?? fromRoute.low24h ?? null
    };
  }, [route.route, route.entry, book, range]);

  const bar = useMemo(() => topBar(quote || {}), [quote]);

  /* ── placing an order ──────────────────────────────────────────────────── */
  const place = useCallback(async (order) => {
    setExecError(null);
    setPlacing(true);
    try {
      if (!route.route) throw new Error('MARKET_NOT_LISTED');
      if (route.route === ROUTE.DYDX) {
        const market = route.entry?.[route.route]?.row;
        if (!market?.raw) throw new Error('MARKET_NOT_LISTED');
        if (!dydxSessionAddress()) throw Object.assign(new Error('NOT_CONNECTED'), { code: 'dydx:NOT_CONNECTED' });
        const acct = await getDydxSubaccount(dydxSessionAddress());
        const equity = Number(acct?.account?.subaccount?.equity);
        if (acct?.live && !(equity >= order.collateralUsd)) {
          throw Object.assign(new Error('NO_COLLATERAL'), { code: 'dydx:NO_COLLATERAL' });
        }
        const size = dydxOrderSize({ notionalUsd: order.notionalUsd, price: market.oraclePrice, market });
        if (!size) throw new Error('BELOW_MIN');
        const res = await placeDydxOrder({
          market,
          side: order.side === 'long' ? 'buy' : 'sell',
          size,
          orderType: order.orderType === 'limit' ? 'limit' : 'market',
          limitPrice: order.price,
          slippagePct: 0.5
        });
        if (!res) throw new Error('BROADCAST_FAILED');
        setExecError(null);
        return res;
      }
      const res = await prepareFutures({
        provider: route.meta.providerId,
        market: route.entry[route.route].marketId,
        side: order.side,
        collateralUsd: order.collateralUsd,
        leverage: order.leverage,
        slippageBps: 50,
        wallet: route.route === ROUTE.VELOCITY ? solana?.address : wallet?.address
      });
      if (!res?.ok) throw new Error(res?.error?.code || 'PROVIDER_UNAVAILABLE');
      if (res.data?.risk?.blocked) throw new Error('RISK_BLOCKED');
      setPrepared(res.data);
      return res.data;
    } catch (err) {
      setExecError(route.route === ROUTE.DYDX ? classifyDydxOrderError(err) : (err?.message || 'ORDER_FAILED'));
      return null;
    } finally {
      setPlacing(false);
    }
  }, [route, wallet, solana]);

  const signPrepared = useCallback(async () => {
    if (!prepared) return;
    setPlacing(true);
    try {
      if (prepared.clientSign?.buildsInTab) {
        const { openVelocityPosition } = await import('../lib/velocityTrade.js');
        const marketIndex = prepared.market?.marketIndex ?? route.entry?.[route.route]?.marketId;
        const out = await openVelocityPosition({
          wallet: solana?.address,
          marketIndex: Number(marketIndex),
          side: prepared.order?.side ?? side,
          notionalUsd: prepared.order?.notionalUsd,
          oraclePrice: prepared.market?.mid,
          slippageBps: prepared.order?.slippageBps ?? 50,
          depositQuote: prepared.order?.collateralUsd
        });
        if (prepared.executionId && out?.signature) await verifyFutures({ executionId: prepared.executionId, txHash: out.signature });
      } else {
        const txs = prepared.transactions ?? [];
        const want = Number(txs[0]?.chainId ?? route.meta?.chainId);
        if (Number.isFinite(want) && want > 0 && wallet.chainId !== want) {
          const moved = await wallet.switchChain?.(want);
          if (!moved) throw new Error('WRONG_NETWORK');
        }
        const signer = (await wallet.ensureSigner?.()) || wallet.getSigner?.();
        if (!signer) throw new Error('WALLET_NOT_CONNECTED');
        for (const tx of txs) {
          const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value && tx.value !== '0x0' ? tx.value : undefined });
          if (tx.kind === 'approve') { await sent.wait(); continue; }
          if (prepared.executionId && sent.hash) await verifyFutures({ executionId: prepared.executionId, txHash: sent.hash });
        }
      }
      setPrepared(null);
    } catch (err) {
      setExecError(err?.message || 'SIGN_FAILED');
    } finally {
      setPlacing(false);
    }
  }, [prepared, route, wallet, solana, side]);

  /*
   * The markets column, built from the SAME index the route came from, so the
   * price in the list and the price in the top bar are the same read. A pair
   * with no price keeps its row (it is still tradable) and shows «—».
   */
  const markets = useMemo(() => [...routeIndex.entries()]
    .map(([base, entry]) => {
      const best = entry[ROUTE.DYDX] || entry[ROUTE.OSTIUM] || entry[ROUTE.VELOCITY] || null;
      return {
        base,
        price: best?.mid ?? null,
        change24hPct: best?.row?.priceChange24H ?? best?.row?.priceChange24hPct ?? null,
        venues: Object.keys(entry)
      };
    })
    .sort((a, b) => (a.base === selectedBase ? -1 : b.base === selectedBase ? 1 : a.base.localeCompare(b.base))),
  [routeIndex, selectedBase]);

  return (
    <PageTransition>
      <div className="perp-terminal" data-testid="perp-terminal" dir="ltr">
        {/* ── header ─────────────────────────────────────────────────────── */}
        <header className="pt-head">
          <button type="button" className="pt-back" onClick={() => navigate('/perp')} data-testid="perp-terminal-back">
            ‹ {t('perpTerminal.back', { defaultValue: 'Markets' })}
          </button>
          <div className="pt-head-pair">
            <TokenIcon token={{ symbol: selectedBase }} size={22} />
            <h1 className="pt-head-title">{selectedBase}<span className="pt-muted">-PERP</span></h1>
            {route.meta && <span className="pt-tag">{route.meta.id}</span>}
            {venues.stale && <span className="pt-tag pt-tag-warn" data-testid="perp-terminal-stale">{t('perpTerminal.stale', { defaultValue: 'stale read' })}</span>}
          </div>
          <dl className="pt-topbar pt-mono" data-testid="perp-terminal-topbar">
            <div className="pt-topbar-main">
              <dt>{t('perpTerminal.top.mark', { defaultValue: 'Mark' })}</dt>
              <dd data-testid="perp-top-mark" data-status={bar.dataStatus}>
                {bar.mark != null ? fmtPrice(bar.mark) : <span className="pt-skeleton-inline">—</span>}
              </dd>
            </div>
            <div>
              <dt>{t('perpTerminal.top.change', { defaultValue: '24h' })}</dt>
              <dd className={bar.change24hPct > 0 ? 'pt-up' : bar.change24hPct < 0 ? 'pt-down' : ''} data-testid="perp-top-change">
                {bar.change24hPct != null ? `${bar.change24hPct > 0 ? '▲ ' : bar.change24hPct < 0 ? '▼ ' : ''}${fmtPct(bar.change24hPct)}` : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('perpTerminal.top.high', { defaultValue: '24h high' })}</dt>
              <dd data-testid="perp-top-high">{bar.high24h != null ? fmtPrice(bar.high24h) : '—'}</dd>
            </div>
            <div>
              <dt>{t('perpTerminal.top.low', { defaultValue: '24h low' })}</dt>
              <dd data-testid="perp-top-low">{bar.low24h != null ? fmtPrice(bar.low24h) : '—'}</dd>
            </div>
            <div>
              <dt>{t('perpTerminal.top.funding', { defaultValue: 'Funding' })}</dt>
              <dd data-testid="perp-top-funding">{bar.fundingAprPct != null ? `${fmtPct(bar.fundingAprPct)} APR` : '—'}</dd>
            </div>
            <div>
              <dt>{t('perpTerminal.top.nextFunding', { defaultValue: 'Next' })}</dt>
              <dd data-testid="perp-top-next">{bar.fundingInHours != null ? `${bar.fundingInHours.toFixed(1)}h` : '—'}</dd>
            </div>
          </dl>
        </header>

        {/* ── the 24h range bar: where the mark sits between the extremes ── */}
        {bar.rangePositionPct != null && (
          <div className="pt-range" role="img" aria-label={t('perpTerminal.top.rangeAlt', { defaultValue: 'Where the mark sits inside the 24 hour range' })}>
            <span className="pt-range-track"><span className="pt-range-dot" style={{ insetInlineStart: `${bar.rangePositionPct.toFixed(1)}%` }} /></span>
          </div>
        )}

        <div className="pt-grid">
          {/* ── markets column ─────────────────────────────────────────── */}
          <aside className="pt-col pt-col-markets" data-testid="perp-terminal-markets">
            <div className="pt-panel-head">
              <span className="pt-panel-title">{t('perpTerminal.markets.title', { defaultValue: 'Markets' })}</span>
              <span className="pt-muted pt-mono">{markets.length}</span>
            </div>
            <ul className="pt-market-list">
              {markets.map((m) => (
                <li key={m.base}>
                  <button type="button" className={`pt-market-row ${m.base === selectedBase ? 'is-on' : ''}`}
                    onClick={() => setPair(m.base)} data-testid={`perp-market-${m.base}`}>
                    <TokenIcon token={{ symbol: m.base }} size={16} />
                    <span className="pt-market-sym">{m.base}</span>
                    <span className="pt-mono">{m.price != null ? fmtPrice(m.price) : '—'}</span>
                    <span className={`pt-mono ${m.change24hPct > 0 ? 'pt-up' : m.change24hPct < 0 ? 'pt-down' : 'pt-muted'}`}>
                      {m.change24hPct != null ? fmtPct(m.change24hPct) : '—'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {markets.length === 0 && (
              <p className="pt-empty">{t('perpTerminal.markets.empty', { defaultValue: 'No venue answered. The catalogue reappears when one does.' })}</p>
            )}
          </aside>

          {/* ── chart column ───────────────────────────────────────────── */}
          <section className="pt-col pt-col-chart" data-testid="perp-terminal-chart">
            {!venuesReady ? (
              <div className="pt-chart-skeleton" data-testid="perp-terminal-chart-loading">
                <div className="pt-skel pt-skel-block" />
                <p className="pt-note">{t('perpTerminal.chart.loading', { defaultValue: 'Reading the venue catalogue…' })}</p>
              </div>
            ) : route.meta ? (
              <FuturesMarketChart
                provider={route.meta.providerId}
                market={route.route && route.entry ? route.entry[route.route]?.marketId : null}
                symbol={`${selectedBase}/USD`}
                height={420}
                testId="perp-terminal-candles"
              />
            ) : (
              <p className="pt-empty">{t('perpTerminal.chart.noVenue', { defaultValue: 'No in-app venue lists this pair, so there is no chart to show.' })}</p>
            )}
          </section>

          {/* ── ticket column ──────────────────────────────────────────── */}
          <aside className="pt-col pt-col-ticket">
            <Ticket
              venue={venueId}
              market={route.route && route.entry ? route.entry[route.route]?.row : null}
              quote={quote}
              side={side}
              onSideChange={setSide}
              onPlace={place}
              placing={placing}
              walletReady={Boolean(accountAddress)}
              onConnect={() => { if (route.meta?.family === 'solana') navigate('/perp'); }}
              equityUsd={account.equityUsd}
              availableBalanceUsd={account.availableBalanceUsd}
              errorCode={execError}
            />
            {prepared && (
              <button type="button" className="pt-submit pt-submit-secondary" data-testid="perp-terminal-sign" disabled={placing} onClick={signPrepared}>
                {t('perpTerminal.ticket.signPrepared', { defaultValue: 'Sign the prepared order' })}
              </button>
            )}
          </aside>
        </div>

        {/* ── bottom stack: book / tape / risk / funding ───────────────── */}
        <section className="pt-bottom" data-testid="perp-terminal-bottom">
          <div className="pt-tabs" role="tablist">
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k}
                className={`pt-tab ${tab === k ? 'is-on' : ''}`} onClick={() => setTab(k)}
                data-testid={`perp-terminal-tab-${k}`}>
                {t(`perpTerminal.tabs.${k}`, { defaultValue: k })}
              </button>
            ))}
          </div>

          <motion.div className="pt-tabpanel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
            {tab === 'book' && (
              <DepthChart book={book} testId="perp-terminal-depth" />
            )}
            {tab === 'tape' && (
              <Tape trades={tape.trades} live={tape.live} loading={tape.loading} reason={tape.reason} testId="perp-terminal-tape" />
            )}
            {tab === 'risk' && (
              <RiskPanel
                positions={account.positions}
                equityUsd={account.equityUsd}
                maintenanceMarginUsd={account.maintenanceMarginUsd}
                availableBalanceUsd={account.availableBalanceUsd}
                fundingAprPct={bar.fundingAprPct}
                loading={account.loading}
                reason={account.reason}
                testId="perp-terminal-risk"
              />
            )}
            {tab === 'funding' && (
              <div className="pt-funding" data-testid="perp-terminal-funding">
                <dl className="pt-kv pt-mono">
                  <div><dt>{t('perpTerminal.funding.apr', { defaultValue: 'Funding APR' })}</dt><dd>{bar.fundingAprPct != null ? fmtPct(bar.fundingAprPct) : '—'}</dd></div>
                  <div><dt>{t('perpTerminal.funding.next', { defaultValue: 'Next settlement in' })}</dt><dd>{bar.fundingInHours != null ? `${bar.fundingInHours.toFixed(1)}h` : '—'}</dd></div>
                  <div><dt>{t('perpTerminal.funding.oi', { defaultValue: 'Open interest' })}</dt><dd>{bar.openInterestUsd != null ? fmtUsd(bar.openInterestUsd) : '—'}</dd></div>
                  <div><dt>{t('perpTerminal.funding.volume', { defaultValue: '24h volume' })}</dt><dd>{bar.volume24hUsd != null ? fmtUsd(bar.volume24hUsd) : '—'}</dd></div>
                </dl>
                {(route.route && route.entry ? route.entry[route.route]?.row : null)?.nextFundingAt && (
                  <p className="pt-note">
                    {t('perpTerminal.funding.settlesAt', { defaultValue: 'Settles at {{at}} — the next hourly funding on this venue.', at: String(route.entry[route.route].row.nextFundingAt) })}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </section>

        <footer className="pt-foot">
          <p className="pt-note">
            {t('perpTerminal.foot.custody', { defaultValue: 'Non-custodial: orders are signed by your wallet on the venue’s own chain. No centralised-exchange trading API is used anywhere in this app.' })}
          </p>
          <p className="pt-note">
            {t('perpTerminal.foot.risk', { defaultValue: 'Leveraged perpetual futures can lose more than the margin posted. Liquidation prices are model output, not a guarantee.' })}
          </p>
        </footer>
      </div>
    </PageTransition>
  );
}
