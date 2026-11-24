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
import FullScreenSheet from '../FullScreenSheet';
import '../../styles/futures-surface.css';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import FuturesMarketChart from '../FuturesMarketChart';
import DepthChart from './DepthChart';
import Tape from './Tape';
import RiskPanel from './RiskPanel';
import Ticket from './Ticket';
import PairSelect from './PairSelect';
import useTerminalFeed from './useTerminalFeed';
import WalletConnectSheet from '../WalletConnectSheet';
import { topBar } from './desk.js';
import { isPollHidden, pollWhileVisible } from '../../lib/visibilityPoll';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';
import { useWallet } from '../../context/WalletContext';
import { useSolanaWallet } from '../../hooks/useSolanaWallet';
import { useTelegram } from '../../context/TelegramContext';
import { getFuturesAccount, getFuturesMarkets, getFuturesPositions, prepareFutures, verifyFutures } from '../../lib/futuresClient';
import {
  ROUTE, ROUTE_META, indexVenueMarkets, pickRoute, leverageCeiling, dydxOrderSize, classifyDydxOrderError
} from '../../lib/perpRoutes';
import {
  dydxSessionAddress, getDydxMarkets, getDydxSubaccount, placeDydxOrder,
  getDydxOrderbook, getDydxTrades, getDydx24hRange, getDydxFundingHistory, connectDydx, disconnectDydx, classifyDydxError
} from '../../lib/dydx';

/* Market lists are slowly changing reference data. Keep the active book,
   tape and wallet/account refreshes at their existing short cadences; order
   submission still performs current venue checks. Every loop is visibility-
   gated so a background tab remains idle. */
const MARKET_POLL_MS = 60_000;
const BOOK_POLL_MS = 5_000;
const TAPE_POLL_MS = 5_000;
const readTape = (ticker) => getDydxTrades(ticker, 40);
const readFunding = (ticker) => getDydxFundingHistory(ticker, 12);

function startTerminalPoll(read, interval) {
  let busy = false;
  const load = async () => {
    if (busy || isPollHidden()) return;
    busy = true;
    try { await read(); } catch { /* A later tick can recover. */ } finally { busy = false; }
  };
  const stop = pollWhileVisible(load, interval);
  load();
  return stop;
}

function fundingQuote(row, isDydx) {
  if (!row) return {};
  return {
    fundingAprPct: row.fundingAprPct,
    nextFundingRate: isDydx ? row.nextFundingRate : null,
    nextFundingAtMs: row.nextFundingAtMs ?? (row.nextFundingAt ? Date.parse(row.nextFundingAt) : null),
    openInterestUsd: row.openInterestUsd ?? (isDydx && row.openInterest != null && row.oraclePrice > 0
      ? row.openInterest * row.oraclePrice : null),
    volume24hUsd: row.volume24hUsd ?? row.volume24H
  };
}
const ACCOUNT_POLL_MS = 15_000;

/** Tabs in the full-screen market details. */
const TABS = ['book', 'funding', 'tape', 'risk'];

const reportedNumber = (value) => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

const errCode = (err) => String(err?.code || err?.message || 'UNKNOWN');

export default function PerpTerminalPane({ embedded = false, images = null, testId = 'perp-terminal' }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const wallet = useWallet();
  const solana = useSolanaWallet();
  const { haptic } = useTelegram();

  const [venues, setVenues] = useState({ velocity: [], ostium: [], dydx: [], stale: {}, dydxUnavailable: false });
  /* Same rule as before: never route on a static fallback before the first
     real read has landed — a flash of the wrong market is worse than a
     skeleton. */
  const [venuesReady, setVenuesReady] = useState(false);
  /* 'connecting' until the first read lands; then live|degraded|offline. */
  const [serverState, setServerState] = useState('connecting');
  const [serverNonce, setServerNonce] = useState(0);
  const [side, setSide] = useState('long');
  const [tab, setTab] = useState(null);
  const infoId = useId();
  const infoTitle = t('perpTerminal.detailsTitle');
  const [feedRevision, setFeedRevision] = useState(0);
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
  const isDydx = route.route === ROUTE.DYDX;
  const ticker = isDydx ? route.entry[ROUTE.DYDX].marketId : null;
  // Public analytics may use a separately labelled dYdX feed for the same
  // asset; neither the chart nor the execution route changes as a result.
  const publicMarket = route.entry?.[ROUTE.DYDX];
  const publicTicker = publicMarket?.marketId ?? null;
  const executionRow = route.entry?.[route.route]?.row;
  const detailFundingVenue = !isDydx && publicTicker && reportedNumber(executionRow?.fundingAprPct) == null
    ? ROUTE.DYDX : route.route;
  const bookFeed = useTerminalFeed(tab === 'book' ? publicTicker : null, getDydxOrderbook, BOOK_POLL_MS, feedRevision);
  const tapeFeed = useTerminalFeed(tab === 'tape' ? publicTicker : null, readTape, TAPE_POLL_MS, feedRevision);
  const fundingFeed = useTerminalFeed(tab === 'funding' && detailFundingVenue === ROUTE.DYDX ? publicTicker : null, readFunding, 60_000, feedRevision);
  const rangeFeed = useTerminalFeed(ticker, getDydx24hRange, 60_000, serverNonce);
  const currentRange = rangeFeed?.value?.live ? rangeFeed.value : null;
  const activeFeed = { book: bookFeed, tape: tapeFeed, funding: fundingFeed }[tab];

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
        dydxUnavailable: !dydxRows,
        stale: {
          velocity: !bff(v) && cur.velocity.length > 0,
          ostium: !bff(o) && cur.ostium.length > 0,
          dydx: !dydxRows && cur.dydx.length > 0
        }
      }));
    };
    const off = startTerminalPoll(load, MARKET_POLL_MS);
    return () => { stopped = true; alive.current = false; off(); };
  }, [serverNonce]);

  /* ── THE ACCOUNT, FOR EVERY VENUE ─────────────────────────────────────
     dYdX (client session) · Ostium (BFF positions + balance) · Velocity
     (venue SDK positions). A venue that cannot answer says exactly which read
     failed; «—» never renders as 0. */
  const evmAddress = evmReady ? wallet.address : null;
  const solAddress = solReady ? solana.address : null;
  useEffect(() => {
    if (!route.route) { setAccount({ equityUsd: null, maintenanceMarginUsd: null, availableBalanceUsd: null, loading: false, reason: 'NO_ROUTE', positions: [] }); return undefined; }
    let stopped = false;
    const base = { positions: [], equityUsd: null, maintenanceMarginUsd: null, availableBalanceUsd: null };
    setAccount({ ...base, loading: true, reason: null });

    if (route.route === ROUTE.DYDX) {
      if (!dydxAddress) { setAccount({ ...base, loading: false, reason: evmAddress ? 'NO_DYDX_SESSION' : 'NO_WALLET' }); return undefined; }
      const load = async () => {
        const r = await getDydxSubaccount(dydxAddress).catch(() => null);
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
            side: p.side === 'SHORT' || Number(p.size) < 0 ? 'short' : 'long',
            notionalUsd: Math.abs(Number(p.size)) * Number(p.entryPrice || 0) || null,
            entryPrice: Number(p.entryPrice),
            unrealizedPnlUsd: reportedNumber(p.unrealizedPnl),
            leverage: (() => {
              const n = Math.abs(Number(p.size)) * Number(p.entryPrice || 0);
              return Number.isFinite(n) && n > 0 && Number(sub?.equity) > 0 ? n / Number(sub.equity) : null;
            })()
          }))
          .filter((p) => Number.isFinite(p.notionalUsd) && p.notionalUsd > 0);
        setAccount({
          positions,
          equityUsd: reportedNumber(sub?.equity),
          maintenanceMarginUsd: reportedNumber(sub?.maintenanceMargin),
          availableBalanceUsd: reportedNumber(sub?.freeCollateral),
          loading: false,
          reason: !r?.live ? 'ACCOUNT_UNREADABLE' : null
        });
      };
      const off = startTerminalPoll(load, ACCOUNT_POLL_MS);
      return () => { stopped = true; off(); };
    }

    if (route.route === ROUTE.OSTIUM) {
      if (!evmAddress) { setAccount({ ...base, loading: false, reason: 'NO_WALLET' }); return undefined; }
      const load = async () => {
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
            unrealizedPnlUsd: reportedNumber(p.grossPnlUsd),
            leverage: Number(p.leverage) > 0 ? Number(p.leverage) : null
          }))
          .filter((p) => p.notionalUsd != null);
        const acctData = acctRes.status === 'fulfilled' && acctRes.value?.ok ? acctRes.value.data : null;
        // This endpoint reads spendable wallet USDC, not posted account equity.
        const balance = reportedNumber(acctData?.balanceUsd);
        setAccount({
          positions,
          equityUsd: null,
          maintenanceMarginUsd: null,
          availableBalanceUsd: balance,
          loading: false,
          reason: posOk ? null : 'ACCOUNT_UNREADABLE'
        });
      };
      const off = startTerminalPoll(load, ACCOUNT_POLL_MS);
      return () => { stopped = true; off(); };
    }

    /* Velocity — positions live in the venue's own program; the SDK reads
       them. There is no server path, and inventing one would double-count. */
    if (!solAddress) { setAccount({ ...base, loading: false, reason: 'NO_WALLET' }); return undefined; }
    const load = async () => {
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
    const off = startTerminalPoll(load, ACCOUNT_POLL_MS);
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
      ...fundingQuote(fromRoute, isDydx),
      maxLeverage: leverageCeiling(route.entry[route.route]),
      spreadBps: fromRoute.spreadBps ?? null,
      high24h: currentRange?.high24h ?? fromRoute.high24h ?? null,
      low24h: currentRange?.low24h ?? fromRoute.low24h ?? null
    };
  }, [route.route, route.entry, currentRange, isDydx]);

  const bar = useMemo(() => topBar(quote || {}), [quote]);

  const fundingRow = route.entry?.[detailFundingVenue]?.row;
  const fundingBar = detailFundingVenue === route.route ? bar : topBar(fundingQuote(fundingRow, true));
  const details = (tab === 'book' || tab === 'tape') && publicTicker ? ROUTE.DYDX
    : tab === 'funding' ? detailFundingVenue : route.route;
  const sourceLabel = details ? t(`perpTerminal.venue.${details}`, { defaultValue: details }) : null;

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

  const TAB_ICON = {
    book: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6h7M4 12h10M4 18h6M16 6h4M17 12h3M14 18h6" />
      </svg>
    ),
    tape: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="22 12 18 12 15 20 9 4 6 12 2 12" />
      </svg>
    ),
    risk: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2L3 7v6c0 5.25 3.75 9.75 9 11 5.25-1.25 9-5.75 9-11V7l-9-5z" />
      </svg>
    ),
    funding: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    )
  };

  return (
    <div className={`ptx ${embedded ? 'ptx--embedded' : 'ptx--route'}`} data-testid={testId}>
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
          <button type="button" className="ptx-info-icon" aria-haspopup="dialog" aria-label={infoTitle}
            title={infoTitle} onClick={() => setTab('book')} data-testid="perp-terminal-info-open">
            <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.1"/>
            </svg>
          </button>
          {venues.stale[route.route] && <span className="ptx-tag ptx-tag-warn" data-testid="perp-terminal-stale">{t('perpTerminal.stale', { defaultValue: 'stale read' })}</span>}
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
        <div className="ptx-range" role="img" dir="ltr" aria-label={t('perpTerminal.top.rangeAlt', { defaultValue: 'Where the mark sits inside the 24 hour range' })}>
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
              <div className="pt-empty-box">
                <span className="pt-empty-ico" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18" />
                    <path d="M7 14l4-4 4 3 5-6" />
                  </svg>
                </span>
                <p className="pt-empty">{t('perpTerminal.chart.noVenue', { defaultValue: 'No in-app venue lists this pair, so there is no chart to show.' })}</p>
              </div>
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

      <FullScreenSheet manageFocus open={Boolean(tab)} onClose={() => setTab(null)} className="futures-full-sheet"
        title={infoTitle} subtitle={selectedBase} icon={TAB_ICON.book}
        closeLabel={t('common.close')} testId="perp-terminal-info-sheet">
        <div className="ptx ptx--info futures-info-layout">
          <div className="futures-info-tabs" role="tablist" aria-label={infoTitle} aria-orientation="vertical"
            onKeyDown={(event) => {
              const index = TABS.indexOf(tab);
              const next = { ArrowDown: (index + 1) % TABS.length, ArrowUp: (index + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 }[event.key];
              if (next === undefined) return;
              event.preventDefault();
              setTab(TABS[next]);
              event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
            }}>
            {TABS.map((key) => (
              <button key={key} type="button" role="tab" id={`${infoId}-${key}`}
                aria-selected={tab === key} aria-controls={`${infoId}-panel`} tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)} data-testid={`perp-terminal-tab-${key}`}>
                <span className="pt-tab-ico" aria-hidden="true">{TAB_ICON[key]}</span>
                {t(`perpTerminal.tabs.${key}`)}
              </button>
            ))}
          </div>
          <div className="futures-info-content" role="tabpanel" id={`${infoId}-panel`}
            aria-labelledby={`${infoId}-${tab}`} tabIndex={0}>
          {sourceLabel && <p className="pt-detail-source" data-testid="perp-detail-source">
            {t('perpTerminal.detailsSource', { venue: sourceLabel, market: (details === ROUTE.DYDX && tab !== 'risk' ? publicTicker : selectedBase) || selectedBase })}
            {details !== route.route && <small>{t('perpTerminal.detailsReference')}</small>}
          </p>}
          {!publicTicker && (!venuesReady || venues.dydxUnavailable) && (tab === 'book' || tab === 'tape') && (
            <div className="pt-detail-status" role="status">
              {serverState === 'connecting' ? t('common.loading') : t('perpTerminal.detailsUnavailable')}
              {serverState !== 'connecting' && <button type="button" className="pt-detail-retry" onClick={() => setServerNonce((n) => n + 1)}>{t('common.retry', { defaultValue: 'Retry' })}</button>}
            </div>
          )}
          {venues.stale[details] && (tab === 'risk' || tab === 'funding') && (
            <p className="pt-note" role="status">{t('perpTerminal.detailsStale')}</p>
          )}
          {activeFeed?.failed && (tab !== 'tape' || activeFeed.value?.reason || !activeFeed.value) && (
            <div className="pt-detail-status" role="status">
              {t(activeFeed.lastGood ? 'perpTerminal.detailsStale' : 'perpTerminal.detailsUnavailable')}
              <button type="button" className="pt-detail-retry" onClick={() => setFeedRevision((n) => n + 1)}>{t('common.retry', { defaultValue: 'Retry' })}</button>
            </div>
          )}
          {tab === 'book' && (
            publicTicker
              ? bookFeed ? <DepthChart book={bookFeed.lastGood} testId="perp-terminal-depth" />
                : <p className="pt-note" role="status">{t('common.loading')}</p>
              : (
                <div className="pt-empty-box">
                  <span className="pt-empty-ico" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 6h7M4 12h10M4 18h6M16 6h4M17 12h3M14 18h6" />
                    </svg>
                  </span>
                  {executionRow?.bid > 0 && executionRow?.ask > 0 && <p className="pt-note">
                    {t('perpTerminal.oracleQuote', { bid: fmtPrice(executionRow.bid), ask: fmtPrice(executionRow.ask) })}
                  </p>}
                  <p className="pt-empty" data-testid="perp-book-unavailable">
                    {!route.route ? t('perpTerminal.chart.noVenue') : route.route === ROUTE.OSTIUM
                      ? t('perpTerminal.book.ostium', { defaultValue: 'Ostium is a peer-to-pool venue: it publishes no order book. Slippage is priced from the oracle instead.' })
                      : t('perpTerminal.book.velocity', { defaultValue: 'The Velocity book is not exposed to this screen yet. The price above is the venue’s own mid.' })}
                  </p>
                </div>
              )
          )}
          {tab === 'tape' && (
            publicTicker
              ? <Tape trades={tapeFeed?.lastGood?.trades ?? tapeFeed?.value?.trades} live={!tapeFeed?.failed && tapeFeed?.value?.live}
                  loading={!tapeFeed} reason={tapeFeed?.value?.reason} testId="perp-terminal-tape" />
              : (
                <div className="pt-empty-box">
                  <span className="pt-empty-ico" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 12 18 12 15 20 9 4 6 12 2 12" />
                    </svg>
                  </span>
                  <p className="pt-empty" data-testid="perp-tape-unavailable">
                    {t('perpTerminal.noPublicTape')}
                  </p>
                </div>
              )
          )}
          {tab === 'risk' && (
            <>
            {executionRow && <div className="pt-funding-grid pt-mono" data-testid="perp-market-risk">
              {[
                [t('perpTerminal.marketMark'), bar.mark != null ? fmtPrice(bar.mark) : null],
                [t('perpTerminal.marketLeverage'), executionRow.maxLeverage > 0 ? `${executionRow.maxLeverage}×` : null],
                [t('perpTerminal.marketSpread'), bar.spreadBps != null ? fmtPct(bar.spreadBps / 100) : null],
                [t('perpTerminal.marketMaintenance'), executionRow.maintenanceMarginFraction > 0 ? fmtPct(executionRow.maintenanceMarginFraction * 100) : null]
              ].map(([label, value]) => value != null && <div className="pt-funding-card" key={label}>
                <span className="pt-funding-label">{label}</span><strong className="pt-funding-val">{value}</strong>
              </div>)}
            </div>}
            <RiskPanel
              positions={account.positions}
              equityUsd={account.equityUsd}
              maintenanceMarginUsd={account.maintenanceMarginUsd}
              availableBalanceUsd={account.availableBalanceUsd}
              fundingAprPct={account.positions.length && account.positions.every((position) =>
                String(position.symbol).split(/[-/]/)[0].toUpperCase() === selectedBase) ? bar.fundingAprPct : null}
              loading={account.loading}
              reason={account.reason}
              testId="perp-terminal-risk"
            />
            </>
          )}
          {tab === 'funding' && (
            <div className="pt-funding" data-testid="perp-terminal-funding">
              <div className="pt-funding-grid pt-mono">
                <div className="pt-funding-card">
                  <span className="pt-funding-label">{t('perpTerminal.funding.apr', { defaultValue: 'Funding APR' })}</span>
                  <strong className={`pt-funding-val ${fundingBar.fundingAprPct > 0 ? 'pt-up' : fundingBar.fundingAprPct < 0 ? 'pt-down' : ''}`}>
                    {fundingBar.fundingAprPct != null ? fmtPct(fundingBar.fundingAprPct) : '—'}
                  </strong>
                </div>
                <div className="pt-funding-card">
                  <span className="pt-funding-label">{t('perpTerminal.funding.next', { defaultValue: 'Next settlement in' })}</span>
                  <strong className="pt-funding-val">{fundingBar.fundingInHours != null ? `${fundingBar.fundingInHours.toFixed(1)}h` : '—'}</strong>
                </div>
                <div className="pt-funding-card">
                  <span className="pt-funding-label">{t('perpTerminal.funding.oi', { defaultValue: 'Open interest' })}</span>
                  <strong className="pt-funding-val">{fundingBar.openInterestUsd != null ? fmtCompact(fundingBar.openInterestUsd) : '—'}</strong>
                </div>
                <div className="pt-funding-card">
                  <span className="pt-funding-label">{t('perpTerminal.funding.volume', { defaultValue: '24h volume' })}</span>
                  <strong className="pt-funding-val">{fundingBar.volume24hUsd != null ? fmtCompact(fundingBar.volume24hUsd) : '—'}</strong>
                </div>
              </div>
              {[fundingBar.fundingAprPct, fundingBar.fundingInHours, fundingBar.openInterestUsd, fundingBar.volume24hUsd].some((value) => value == null) && (
                <p className="pt-note">{t('perpTerminal.funding.missing')}</p>
              )}
              {fundingRow?.rolloverAprPct != null && <p className="pt-note">{t('perpTerminal.rolloverApr', { value: fmtPct(fundingRow.rolloverAprPct) })}</p>}
              {detailFundingVenue === ROUTE.DYDX && publicTicker && !fundingFeed && <p className="pt-note" role="status">{t('common.loading')}</p>}
              {!!fundingFeed?.lastGood?.rows?.length && <div className="pt-funding-history">
                <h4>{t('perpTerminal.fundingHistory')}</h4>
                {fundingFeed.lastGood.rows.slice(-6).reverse().map((row) => <div key={row.atMs}>
                  <time dateTime={row.at}>{new Date(row.atMs).toLocaleString(i18n.language)}</time>
                  <strong dir="ltr">{row.rateHourlyPct != null ? fmtPct(row.rateHourlyPct, 5) : '—'}</strong>
                </div>)}
              </div>}
              {fundingBar.nextFundingAtMs != null && (
                <p className="pt-funding-banner">
                  {t('perpTerminal.funding.settlesAt', { defaultValue: 'Next reported settlement: {{at}}', at: new Date(fundingBar.nextFundingAtMs).toLocaleString(i18n.language) })}
                </p>
              )}
            </div>
          )}
          </div>
        </div>
      </FullScreenSheet>

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
