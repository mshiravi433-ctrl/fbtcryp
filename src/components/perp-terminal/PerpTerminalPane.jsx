/**
 * PERP TERMINAL PANE — the full trading desk, as a sub-view of the Perpetual tab.
 * ---------------------------------------------------------------------------
 * «در پرپچوال دو زیر تب جفت توکن و ترمینال باشد و نباید بازارها یکسان یا شبیه
 *  هم باشد … همه ثابت و با فاصله درست باشد … تمام صفحه باشد … برای انتخاب
 *  توکن ها با لوگو و باکس بازشونده باشد»
 *
 * This is the SAME desk the `/perp/terminal` route serves (the route mounts
 * this component with `embedded={false}`). It lives as the «ترمینال» sub-tab
 * of «پرپچوال», next to «جفت توکن» — and the two are not the same list:
 *
 *   جفت توکن  the market-cap catalogue (up to ~250 rows, logos, sparklines,
 *             price, change, a trade button per row)
 *   ترمینال     the execution universe: ONLY markets an in-app venue settles
 *             — searchable in the logo dropdown, priced and ranked by venue
 *
 * ─── WHAT «ALL FIXED» MEANS HERE ────────────────────────────────────────────
 * On desktop (≥1200px) the pane is a FIXED full-height grid: header bar →
 * range strip → chart/ticket → the book/tape/risk stack. Nothing scrolls the
 * page; each cell owns its height and internal lists scroll inside themselves.
 * Below that breakpoint the grid stacks and the page flows normally — a desk
 * cannot physically fit a phone viewport, and pretending otherwise just clips
 * the ticket. The sticky-bottom ticket that made «پایین صفحه ثابت و بالای
 * صفحه متحرک» true is GONE on purpose.
 *
 * ─── SERVER TRUTH, NOT A SPINNER ────────────────────────────────────────────
 * A venue that cannot be read keeps its LAST good catalogue, labelled stale.
 * When EVERY read fails the header says so, with a retry — instead of leaving
 * a connected user staring at a «connect your wallet» button whose real fault
 * is the network (the exact report: «با اینکه کیف پول وصله … میگه وصل کنی»).
 *
 * ─── THE WALLET BUTTON IS THE ROUTE'S TRUTH ────────────────────────────────
 * No wallet of the needed family → «اتصال کیف پول» (opens the in-app sheet,
 * or the Solana wallet for a Solana route). EVM wallet connected for a dYdX
 * route → «فعال‌سازی نشست dYdX» — one signature, not a reconnect. The session
 * is derived in memory; FBT never sees a key.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import FuturesMarketChart from '../FuturesMarketChart';
import DepthChart from './DepthChart';
import Tape from './Tape';
import RiskPanel from './RiskPanel';
import Ticket from './Ticket';
import PairSelect from './PairSelect';
import WalletConnectSheet from '../WalletConnectSheet';
import { topBar } from './desk.js';
import { pollWhileVisible } from '../../lib/visibilityPoll';
import { fmtPct, fmtPrice, fmtUsd } from '../../lib/format';
import { useWallet } from '../../context/WalletContext';
import { useSolanaWallet } from '../../hooks/useSolanaWallet';
import { useTelegram } from '../../context/TelegramContext';
import { getFuturesAccount, getFuturesMarkets, getFuturesPositions, prepareFutures, verifyFutures } from '../../lib/futuresClient';
import {
  ROUTE, ROUTE_META, indexVenueMarkets, pickRoute, leverageCeiling, dydxOrderSize, classifyDydxOrderError
} from '../../lib/perpRoutes';
import {
  dydxSessionAddress, getDydxMarkets, getDydxSubaccount, placeDydxOrder,
  getDydxOrderbook, getDydxTrades, getDydx24hRange, connectDydx, disconnectDydx, classifyDydxError
} from '../../lib/dydx';

const MARKET_POLL_MS = 30_000;
const BOOK_POLL_MS = 5_000;
const TAPE_POLL_MS = 4_000;
const ACCOUNT_POLL_MS = 15_000;

/** Third-column tabs: the panels under the chart. */
const TABS = ['book', 'tape', 'risk', 'funding'];

const errCode = (err) => String(err?.code || err?.message || 'UNKNOWN');

export default function PerpTerminalPane({ embedded = false, images = null, testId = 'perp-terminal' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const wallet = useWallet();
  const solana = useSolanaWallet();
  const { haptic } = useTelegram();

  const [venues, setVenues] = useState({ velocity: [], ostium: [], dydx: [], dydxLoaded: false, stale: false });
  /* Same rule as before: never route on a static fallback before the first
     real read has landed — a flash of the wrong market is worse than a
     skeleton. */
  const [venuesReady, setVenuesReady] = useState(false);
  /* 'connecting' until the first read lands; then live|degraded|offline. */
  const [serverState, setServerState] = useState('connecting');
  const [serverNonce, setServerNonce] = useState(0);
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
  const [walletOpen, setWalletOpen] = useState(false);
  const [dydxAddress, setDydxAddress] = useState(() => dydxSessionAddress());
  const [dydxStage, setDydxStage] = useState(null);
  const [activating, setActivating] = useState(false);
  const alive = useRef(true);

  /* ── the selected pair ─────────────────────────────────────────────── */
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

  /* ── wallets ───────────────────────────────────────────────────────── */
  const wallets = useMemo(() => ({
    evm: wallet?.isConnected && wallet?.address ? { address: wallet.address } : null,
    solana: solana?.isConnected !== false && solana?.address ? { address: solana.address, publicKey: solana.publicKey } : (solana?.address ? { address: solana.address, publicKey: solana.publicKey } : null)
  }), [wallet, solana]);
  const evmReady = Boolean(wallet?.address) && wallet?.isConnected !== false;
  const solReady = Boolean(solana?.address);

  /* ── WHICH VENUE SETTLES THIS PAIR ─────────────────────────────────── */
  const routeIndex = useMemo(() => indexVenueMarkets(venues), [venues]);
  const route = useMemo(() => {
    const entry = routeIndex.get(selectedBase) || null;
    const picked = pickRoute(entry, { solana: solReady, evm: evmReady });
    return {
      entry,
      route: picked.route || null,
      reason: picked.reason || null,
      meta: picked.route ? ROUTE_META[picked.route] : null,
      options: picked.options || []
    };
  }, [routeIndex, selectedBase, solReady, evmReady]);

  const venueId = route.meta?.providerId || null;

  /* ── market list (visibility-gated; the raw material of the desk) ───── */
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
      const gotAll = Boolean(bff(v) && bff(o) && dydxRows);
      if (gotAny) setVenuesReady(true);
      /* The server badge: three reads, one verdict the header reports. */
      setServerState(gotAll ? 'live' : gotAny ? 'degraded' : 'offline');
      setVenues((cur) => ({
        velocity: bff(v) ?? cur.velocity,
        ostium: bff(o) ?? cur.ostium,
        dydx: dydxRows ?? cur.dydx,
        dydxLoaded: cur.dydxLoaded || Boolean(dydxRows),
        stale: (cur.velocity.length || cur.ostium.length || cur.dydx.length)
          ? !gotAny : false
      }));
    };
    const off = pollWhileVisible(load, MARKET_POLL_MS);
    load();
    return () => { stopped = true; alive.current = false; off(); };
  }, [serverNonce]);

  /* ── dYdX order book (the only venue with a public book) ───────────── */
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

  /* ── the tape ──────────────────────────────────────────────────────── */
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

  /* ── 24h high/low (one server read; the venue has no range field) ───── */
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

  /* ── THE ACCOUNT, FOR EVERY VENUE ─────────────────────────────────────
     dYdX (client session) · Ostium (BFF positions + balance) · Velocity
     (venue SDK positions). A venue that cannot answer says exactly which read
     failed; «—» never renders as 0. */
  const evmAddress = evmReady ? wallet.address : null;
  const solAddress = solReady ? solana.address : null;
  useEffect(() => {
    if (!route.route) { setAccount((s) => ({ ...s, loading: false, reason: 'NO_ROUTE', positions: [] })); return undefined; }
    let stopped = false;
    const base = { positions: [], equityUsd: null, maintenanceMarginUsd: null, availableBalanceUsd: null };

    if (route.route === ROUTE.DYDX) {
      if (!dydxAddress) { setAccount({ ...base, loading: false, reason: 'NO_WALLET' }); return undefined; }
      const load = async () => {
        setAccount((s) => ({ ...s, loading: true }));
        const r = await getDydxSubaccount(dydxAddress);
        if (stopped) return;
        const sub = r?.account?.subaccount || null;
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
          maintenanceMarginUsd: Number(sub?.maintenanceMargin) >= 0 ? Number(sub.maintenanceMargin) : null,
          availableBalanceUsd: Number(sub?.freeCollateral) >= 0 ? Number(sub.freeCollateral) : null,
          loading: false,
          reason: r?.live === false ? 'ACCOUNT_UNREADABLE' : null
        });
      };
      const off = pollWhileVisible(load, ACCOUNT_POLL_MS);
      load();
      return () => { stopped = true; off(); };
    }

    if (route.route === ROUTE.OSTIUM) {
      if (!evmAddress) { setAccount({ ...base, loading: false, reason: 'NO_WALLET' }); return undefined; }
      const load = async () => {
        setAccount((s) => ({ ...s, loading: true }));
        const [posRes, acctRes] = await Promise.allSettled([
          getFuturesPositions(evmAddress, 'ostium'),
          getFuturesAccount(evmAddress, 'ostium')
        ]);
        if (stopped) return;
        const posOk = posRes.status === 'fulfilled' && posRes.value?.ok;
        const posList = posOk && Array.isArray(posRes.value.data?.positions) ? posRes.value.data.positions : [];
        const positions = posList
          .map((p) => ({
            symbol: p.symbol,
            side: p.side === 'short' ? 'short' : 'long',
            notionalUsd: Number(p.notionalUsd) > 0 ? Number(p.notionalUsd) : null,
            entryPrice: Number(p.entryPrice) > 0 ? Number(p.entryPrice) : null,
            markPrice: Number(p.markPrice) > 0 ? Number(p.markPrice) : null,
            unrealizedPnlUsd: Number.isFinite(Number(p.grossPnlUsd)) ? Number(p.grossPnlUsd) : null,
            leverage: Number(p.leverage) > 0 ? Number(p.leverage) : null
          }))
          .filter((p) => p.notionalUsd != null);
        const acctData = acctRes.status === 'fulfilled' && acctRes.value?.ok ? acctRes.value.data : null;
        const balance = acctData && Number(acctData.balanceUsd) >= 0 ? Number(acctData.balanceUsd) : null;
        /* Equity ≈ posted collateral + unrealized PnL — the venue settles both
           in USDC, so the sum is meaningful; when either side is unknown, the
           equity cell renders «—» rather than a guess. */
        const pnlSum = positions.reduce((n, p) => n + (Number.isFinite(p.unrealizedPnlUsd) ? p.unrealizedPnlUsd : 0), 0);
        const equityUsd = balance != null ? balance + pnlSum : null;
        setAccount({
          positions,
          equityUsd,
          maintenanceMarginUsd: null,
          availableBalanceUsd: balance,
          loading: false,
          reason: posOk || acctData ? null : 'ACCOUNT_UNREADABLE'
        });
      };
      const off = pollWhileVisible(load, ACCOUNT_POLL_MS);
      load();
      return () => { stopped = true; off(); };
    }

    /* Velocity — positions live in the venue's own program; the SDK reads
       them. There is no server path, and inventing one would double-count. */
    if (!solAddress) { setAccount({ ...base, loading: false, reason: 'NO_WALLET' }); return undefined; }
    const load = async () => {
      setAccount((s) => ({ ...s, loading: true }));
      try {
        const { getVelocityPositions } = await import('../../lib/velocityTrade.js');
        const [result, markets] = await Promise.all([
          getVelocityPositions({ wallet: solAddress }),
          getFuturesMarkets('drift')
        ]);
        if (stopped) return;
        const rows = Array.isArray(result) ? result : (result?.positions || []);
        const byIndex = new Map((markets?.ok ? markets.data.markets : []).map((m) => [Number(m.marketId), m]));
        const positions = [];
        for (const r of rows) {
          const rawBase = Number(r.baseAssetAmount) || 0;
          if (rawBase === 0) continue;
          const mk = byIndex.get(Number(r.marketIndex));
          const mid = Number(mk?.mid) > 0 ? Number(mk.mid) : null;
          const baseSize = Math.abs(rawBase) / 1e9;
          const notionalUsd = mid ? baseSize * mid : null;
          if (!(notionalUsd > 0)) continue;
          const quoteUsd = Math.abs(Number(r.quoteAssetAmount) || 0) / 1e6;
          positions.push({
            symbol: mk?.symbol || `MKT-${r.marketIndex}`,
            side: rawBase >= 0 ? 'long' : 'short',
            notionalUsd,
            entryPrice: mid,
            markPrice: mid,
            leverage: quoteUsd > 0 ? notionalUsd / quoteUsd : null
          });
        }
        setAccount({
          positions,
          equityUsd: null,
          maintenanceMarginUsd: null,
          availableBalanceUsd: null,
          loading: false,
          reason: null
        });
      } catch {
        if (!stopped) setAccount({ ...base, loading: false, reason: 'ACCOUNT_UNREADABLE' });
      }
    };
    const off = pollWhileVisible(load, ACCOUNT_POLL_MS);
    load();
    return () => { stopped = true; off(); };
  }, [route.route, dydxAddress, evmAddress, solAddress]);

  /* dYdX session belongs to ONE wallet — switching must drop it. */
  const lastEvm = useRef(wallet?.address ?? null);
  useEffect(() => {
    const now = wallet?.address ?? null;
    if (lastEvm.current && now !== lastEvm.current) { disconnectDydx(); setDydxAddress(null); }
    lastEvm.current = now;
  }, [wallet?.address]);

  /* A pair change invalidates a built order. */
  useEffect(() => { setPrepared(null); setExecError(null); }, [selectedBase, side]);

  /* ── the quote the top bar reads ─────────────────────────────────────── */
  const quote = useMemo(() => {
    const fromRoute = (route.route && route.entry ? route.entry[route.route]?.row : null) || null;
    if (!fromRoute) return null;
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

  /* ── the venue-settled markets behind the dropdown ───────────────────── */
  const marketOptions = useMemo(() => {
    const rows = [];
    for (const [base, entry] of routeIndex.entries()) {
      const best = entry[ROUTE.DYDX] || entry[ROUTE.OSTIUM] || entry[ROUTE.VELOCITY] || null;
      const row = best?.row || null;
      rows.push({
        base,
        price: best?.mid ?? null,
        change24hPct: row?.priceChange24H ?? row?.priceChange24hPct ?? null,
        volume24hUsd: row?.volume24H ?? row?.volume24hUsd ?? null,
        venues: Object.keys(entry)
      });
    }
    rows.sort((a, b) => {
      if (a.base === selectedBase) return -1;
      if (b.base === selectedBase) return 1;
      const va = Number(a.volume24hUsd) || 0;
      const vb = Number(b.volume24hUsd) || 0;
      if (vb !== va) return vb - va;
      return a.base.localeCompare(b.base);
    });
    return rows;
  }, [routeIndex, selectedBase]);

  /* ── dYdX activation (one EIP-712 signature; key never leaves memory) ─── */
  const activateDydx = useCallback(async () => {
    haptic?.('light');
    if (!evmReady) { setWalletOpen(true); return; }
    setActivating(true);
    setExecError(null);
    try {
      const isLocal = wallet?.mode === 'local';
      const connected = await connectDydx({
        getProvider: () => wallet?.getEip1193Provider?.() || null,
        address: wallet.address,
        switchChain: wallet.switchChain,
        requireChain: !isLocal,
        restoreChain: wallet?.mode === 'wc',
        onStage: setDydxStage
      });
      setDydxAddress(connected.address);
      haptic?.('success');
    } catch (err) {
      setExecError(`dydx:${classifyDydxError(err)}`);
      haptic?.('error');
    } finally {
      setActivating(false);
      setDydxStage(null);
    }
  }, [evmReady, haptic, wallet]);

  const routeFamily = route.meta?.family || null;
  const routeWalletReady = routeFamily === 'solana' ? solReady : evmReady;
  /* The button mirrors the venue's own requirement: dYdX wants a connected
     EVM wallet AND an in-memory session (one more signature). Velocity wants
     a Solana wallet; Ostium an EVM wallet. */
  const needsActivation = route.route === ROUTE.DYDX && routeWalletReady && !dydxAddress;
  const ticketWalletReady = Boolean(route.route) && routeWalletReady;

  const handleConnect = useCallback(() => {
    haptic?.('light');
    if (routeFamily === 'solana') { solana?.connect?.(); return; }
    setWalletOpen(true);
  }, [routeFamily, solana, haptic]);

  /* ── placing an order ─────────────────────────────────────────────────── */
  const place = useCallback(async (order) => {
    setExecError(null);
    setPlacing(true);
    try {
      if (!route.route) throw new Error('MARKET_NOT_LISTED');
      if (route.route === ROUTE.DYDX) {
        const market = route.entry?.[route.route]?.row;
        if (!market?.raw) throw Object.assign(new Error('MARKET_NOT_LISTED'), { code: 'MARKET_NOT_LISTED' });
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
        haptic?.('success');
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
      if (!res?.ok) throw Object.assign(new Error(res?.error?.code || 'PROVIDER_UNAVAILABLE'), { code: res?.error?.code || 'PROVIDER_UNAVAILABLE' });
      if (res.data?.risk?.blocked) throw Object.assign(new Error('RISK_BLOCKED'), { code: 'RISK_BLOCKED' });
      setPrepared(res.data);
      return res.data;
    } catch (err) {
      setExecError(route.route === ROUTE.DYDX && !String(err?.code || '').startsWith('dydx:')
        ? classifyDydxOrderError(err)
        : (err?.code || err?.message || 'ORDER_FAILED'));
      haptic?.('error');
      return null;
    } finally {
      setPlacing(false);
    }
  }, [route, wallet, solana, haptic]);

  const signPrepared = useCallback(async () => {
    if (!prepared) return;
    setPlacing(true);
    setExecError(null);
    try {
      if (prepared.clientSign?.buildsInTab) {
        const { openVelocityPosition } = await import('../../lib/velocityTrade.js');
        const marketIndex = prepared.market?.marketIndex ?? route.entry?.[route.route]?.marketId;
        if (marketIndex == null) throw Object.assign(new Error('MARKET_NOT_LISTED'), { code: 'MARKET_NOT_LISTED' });
        const out = await openVelocityPosition({
          wallet: solana?.address,
          marketIndex: Number(marketIndex),
          side: prepared.order?.side ?? side,
          notionalUsd: prepared.order?.notionalUsd,
          oraclePrice: prepared.market?.mid,
          slippageBps: prepared.order?.slippageBps ?? 50,
          depositQuote: prepared.order?.collateralUsd
        });
        if (!out?.signature) throw Object.assign(new Error('BROADCAST_FAILED'), { code: 'BROADCAST_FAILED' });
        if (prepared.executionId) await verifyFutures({ executionId: prepared.executionId, txHash: out.signature });
      } else {
        const txs = prepared.transactions ?? [];
        const want = Number(txs[0]?.chainId ?? route.meta?.chainId);
        if (Number.isFinite(want) && want > 0 && wallet.chainId !== want) {
          const moved = await wallet.switchChain?.(want);
          if (!moved) throw Object.assign(new Error('WRONG_NETWORK'), { code: 'WRONG_NETWORK' });
        }
        const signer = (await wallet.ensureSigner?.()) || wallet.getSigner?.();
        if (!signer) throw Object.assign(new Error('WALLET_NOT_CONNECTED'), { code: 'WALLET_NOT_CONNECTED' });
        for (const tx of txs) {
          const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value && tx.value !== '0x0' ? tx.value : undefined });
          if (tx.kind === 'approve') { await sent.wait(); continue; }
          if (prepared.executionId && sent.hash) await verifyFutures({ executionId: prepared.executionId, txHash: sent.hash });
        }
      }
      setPrepared(null);
      haptic?.('success');
    } catch (err) {
      const code = /reject|denied|cancel|4001/i.test(String(err?.message || '')) ? 'USER_REJECTED' : errCode(err);
      setExecError(code);
      haptic?.('error');
    } finally {
      setPlacing(false);
    }
  }, [prepared, route, wallet, solana, side, haptic]);

  const serverLabel = serverState === 'live' ? t('perpTerminal.server.live', { defaultValue: 'Server connected' })
    : serverState === 'degraded' ? t('perpTerminal.server.degraded', { defaultValue: 'Some feeds unreachable' })
      : serverState === 'offline' ? t('perpTerminal.server.offline', { defaultValue: 'Server unreachable' })
        : t('perpTerminal.server.connecting', { defaultValue: 'Connecting to server…' });

  return (
    <div className={`ptx ${embedded ? 'ptx--embedded' : 'ptx--route'}`} data-testid={testId} dir="ltr">
      {/* ── top bar: picker · stats · server truth ─────────────────────── */}
      <header className="ptx-top panel">
        <div className="ptx-picker">
          <PairSelect
            options={marketOptions}
            selected={selectedBase}
            onSelect={setPair}
            images={images}
            loading={!venuesReady}
          />
          {route.meta && <span className="ptx-tag" data-testid="perp-terminal-venue">{route.meta.id}</span>}
          {venues.stale && <span className="ptx-tag ptx-tag-warn" data-testid="perp-terminal-stale">{t('perpTerminal.stale', { defaultValue: 'stale read' })}</span>}
        </div>

        <dl className="ptx-stats pt-mono" data-testid="perp-terminal-topbar">
          <div className="ptx-stat ptx-stat-mark">
            <dt>{t('perpTerminal.top.mark', { defaultValue: 'Mark' })}</dt>
            <dd data-testid="perp-top-mark" data-status={bar.dataStatus}>
              {bar.mark != null ? fmtPrice(bar.mark) : <span className="pt-skeleton-inline">—</span>}
            </dd>
          </div>
          <div className="ptx-stat">
            <dt>{t('perpTerminal.top.change', { defaultValue: '24h' })}</dt>
            <dd className={bar.change24hPct > 0 ? 'pt-up' : bar.change24hPct < 0 ? 'pt-down' : ''} data-testid="perp-top-change">
              {bar.change24hPct != null ? `${bar.change24hPct > 0 ? '▲ ' : bar.change24hPct < 0 ? '▼ ' : ''}${fmtPct(bar.change24hPct)}` : '—'}
            </dd>
          </div>
          <div className="ptx-stat">
            <dt>{t('perpTerminal.top.high', { defaultValue: '24h high' })}</dt>
            <dd data-testid="perp-top-high">{bar.high24h != null ? fmtPrice(bar.high24h) : '—'}</dd>
          </div>
          <div className="ptx-stat">
            <dt>{t('perpTerminal.top.low', { defaultValue: '24h low' })}</dt>
            <dd data-testid="perp-top-low">{bar.low24h != null ? fmtPrice(bar.low24h) : '—'}</dd>
          </div>
          <div className="ptx-stat">
            <dt>{t('perpTerminal.top.funding', { defaultValue: 'Funding' })}</dt>
            <dd data-testid="perp-top-funding">{bar.fundingAprPct != null ? `${fmtPct(bar.fundingAprPct)} APR` : '—'}</dd>
          </div>
          <div className="ptx-stat">
            <dt>{t('perpTerminal.top.nextFunding', { defaultValue: 'Next' })}</dt>
            <dd data-testid="perp-top-next">{bar.fundingInHours != null ? `${bar.fundingInHours.toFixed(1)}h` : '—'}</dd>
          </div>
        </dl>

        <div className={`ptx-server is-${serverState}`} data-testid="perp-terminal-server" role="status">
          <span className="ptx-server-dot" aria-hidden="true" />
          <span className="ptx-server-text">{serverLabel}</span>
          {serverState !== 'live' && (
            <button
              type="button"
              className="ptx-server-retry"
              onClick={() => { haptic?.('light'); setServerNonce((n) => n + 1); }}
              data-testid="perp-terminal-retry"
              aria-label={t('common.retry', { defaultValue: 'Retry' })}
              title={t('common.retry', { defaultValue: 'Retry' })}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3L21 8" /><path d="M21 3v5h-5" /></svg>
            </button>
          )}
        </div>
      </header>

      {/* ── the 24h range bar ──────────────────────────────────────────── */}
      {bar.rangePositionPct != null && (
        <div className="ptx-range" role="img" aria-label={t('perpTerminal.top.rangeAlt', { defaultValue: 'Where the mark sits inside the 24 hour range' })}>
          <span className="ptx-range-track"><span className="ptx-range-dot" style={{ insetInlineStart: `${bar.rangePositionPct.toFixed(1)}%` }} /></span>
        </div>
      )}

      {/* ── the desk: chart + ticket ────────────────────────────────────── */}
      <div className="ptx-main">
        <section className="ptx-chart panel" data-testid="perp-terminal-chart">
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
              spotId={images?.[selectedBase]?.id || null}
              height={embedded ? 380 : 440}
              testId="perp-terminal-candles"
            />
          ) : (
            <div className="pt-chart-skeleton" data-testid="perp-chart-none">
              <p className="pt-empty">{t('perpTerminal.chart.noVenue', { defaultValue: 'No in-app venue lists this pair, so there is no chart to show.' })}</p>
            </div>
          )}
        </section>

        <aside className="ptx-ticket panel" data-testid="perp-terminal-ticket-col">
          <Ticket
            venue={venueId}
            market={route.route && route.entry ? route.entry[route.route]?.row : null}
            quote={quote}
            side={side}
            onSideChange={setSide}
            onPlace={place}
            placing={placing}
            walletReady={ticketWalletReady}
            onConnect={handleConnect}
            needsActivation={needsActivation}
            onActivate={activateDydx}
            activating={activating}
            activationStage={dydxStage}
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

      {/* ── bottom stack: book / tape / risk / funding ──────────────────── */}
      <section className="ptx-bottom panel" data-testid="perp-terminal-bottom">
        <div className="pt-tabs" role="tablist">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={`pt-tab ${tab === k ? 'is-on' : ''}`}
              onClick={() => setTab(k)}
              data-testid={`perp-terminal-tab-${k}`}
            >
              {t(`perpTerminal.tabs.${k}`, { defaultValue: k })}
            </button>
          ))}
          {tab === 'risk' && account.loading && <span className="pt-muted pt-small pt-loading-note">{t('common.loading', { defaultValue: 'Loading…' })}</span>}
        </div>

        <div className="pt-tabpanel">
          {tab === 'book' && (
            isDydx
              ? <DepthChart book={book} testId="perp-terminal-depth" />
              : (
                <p className="pt-empty" data-testid="perp-book-unavailable">
                  {route.route === ROUTE.OSTIUM
                    ? t('perpTerminal.book.ostium', { defaultValue: 'Ostium is a peer-to-pool venue: it publishes no order book. Slippage is priced from the oracle instead.' })
                    : t('perpTerminal.book.velocity', { defaultValue: 'The Velocity book is not exposed to this screen yet. The price above is the venue’s own mid.' })}
                </p>
              )
          )}
          {tab === 'tape' && (
            isDydx
              ? <Tape trades={tape.trades} live={tape.live} loading={tape.loading} reason={tape.reason} testId="perp-terminal-tape" />
              : <p className="pt-empty" data-testid="perp-tape-unavailable">{t('perpTerminal.tape.unavailable', { defaultValue: 'The prints feed is dYdX-only. The 24h stats above are the venue’s own.' })}</p>
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
              {bar.nextFundingAtMs != null && (
                <p className="pt-note">
                  {t('perpTerminal.funding.settlesAt', { defaultValue: 'Settles at {{at}} — the next hourly funding on this venue.', at: new Date(bar.nextFundingAtMs).toLocaleString() })}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <footer className="ptx-foot">
        <p className="pt-note">
          {t('perpTerminal.foot.custody', { defaultValue: 'Non-custodial: orders are signed by your wallet on the venue’s own chain. No centralised-exchange trading API is used anywhere in this app.' })}
        </p>
        <p className="pt-note">
          {t('perpTerminal.foot.risk', { defaultValue: 'Leveraged perpetual futures can lose more than the margin posted. Liquidation prices are model output, not a guarantee.' })}
        </p>
      </footer>

      <WalletConnectSheet open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
