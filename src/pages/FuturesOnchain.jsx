/**
 * FUTURES — "On-Chain" tab (spec: FBT FUTURES ENGINE v3.0).
 * ---------------------------------------------------------------------------
 * The third tab of /perp, beside Perpetual and dYdX. It renders what the
 * Futures BFF (/api/v1/futures) says and nothing else:
 *
 *   · provider status comes from the registry (AVAILABLE / DEGRADED / READ_ONLY
 *     / UNAVAILABLE / MAINTENANCE / BLOCKED) — the tab never guesses;
 *   · markets, prices, funding, OI, balances and positions are live reads;
 *   · fee, risk and route come from /quote and /prepare (backend truth); the
 *     confirmation sheet shows the server's breakdown, not a local formula;
 *   · the wallet signs UNSIGNED calldata built by the BFF; the tab then
 *     reports the hash to /verify, which updates the ledger and publishes
 *     FUTURES_* events.
 *
 * Visually it reuses the same classes as the dYdX tab (derivatives-glass.css,
 * .card / .brg-quote / .dir-switch / .lev-row / .segmented) so it reads as the
 * same product. Copy is entirely i18n (`futures.*`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import SegIndicator from '../components/SegIndicator';
import Sheet from '../components/Sheet';
import WalletConnectSheet from '../components/WalletConnectSheet';
import TrendChart from '../components/TrendChart';
import { IconExternal, IconShield, IconTrend } from '../components/Icons';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import '../styles/derivatives-glass.css';
import {
  getFuturesProviders, getFuturesMarkets, getFuturesCandles, getFuturesPositions, getFuturesAccount,
  quoteFutures, prepareFutures, verifyFutures, manageFuturesPosition
} from '../lib/futuresClient';
import { useFuturesStore, emitFuturesEvent } from '../lib/futures-engine/store';
import { mapFuturesError } from '../lib/futures-engine/errors';
import { createFuturesTxMachine, FUTURES_TX_STATE } from '../lib/futures-engine/stateMachine';

const CATEGORY_ORDER = ['Crypto', 'Commodities', 'Forex', 'Indices', 'Stocks', 'ETFs'];
const friendlyCategory = (raw) => {
  const v = String(raw || '').toLowerCase();
  if (v.includes('crypto')) return 'Crypto';
  if (v.includes('commod')) return 'Commodities';
  if (v.includes('forex') || v.includes('fx')) return 'Forex';
  if (v.includes('indice') || v.includes('index')) return 'Indices';
  if (v.includes('stock') || v.includes('equit')) return 'Stocks';
  if (v.includes('etf')) return 'ETFs';
  return 'Other';
};
const RESOLUTIONS = [['15', '15m'], ['60', '1h'], ['240', '4h'], ['1D', '1d']];
const LEVERAGE_PRESETS = [2, 5, 10, 20, 50];
const STATUS_TONE = { AVAILABLE: 'pill-up', DEGRADED: 'pill-neutral', READ_ONLY: 'pill-neutral', UNAVAILABLE: 'pill-down', MAINTENANCE: 'pill-down', BLOCKED: 'pill-down' };
const EXPLORERS = { 42161: 'https://arbiscan.io/tx/' };

const errCode = (e) => mapFuturesError(e).code;
const isBps = (v) => Number.isFinite(Number(v));

/*
 * ─── INTENT OS HAND-OFF ─────────────────────────────────────────────────────
 * /perp?tab=onchain&market=BTC&side=long&collateral=100&leverage=5
 *
 * The chat resolves «BTC → لانگ → 5x → 100$ → انجامش بده» into a draft and
 * hands it here by URL. Only the FORM is pre-filled from it: the quote, fee
 * breakdown, risk verdict and the unsigned transaction are all produced by
 * the backend again, and the user still has to tap Review and then Confirm
 * before the wallet is asked to sign. A URL can never execute anything.
 * Leverage above the market's maximum is clamped by the same effect that
 * clamps typed input, so a link cannot push past protocol limits either.
 */
function readPrefill() {
  try {
    const raw = String(window.location.hash || window.location.search || '').split('?')[1] || '';
    const q = new URLSearchParams(raw);
    const side = String(q.get('side') || '').toLowerCase();
    const collateral = Number(q.get('collateral'));
    const leverage = Number(q.get('leverage'));
    return {
      market: String(q.get('market') || '').toUpperCase().replace(/[^A-Z0-9/-]/g, '').slice(0, 16) || null,
      side: side === 'long' || side === 'short' ? side : null,
      collateral: Number.isFinite(collateral) && collateral > 0 ? String(collateral) : null,
      leverage: Number.isFinite(leverage) && leverage >= 1 ? String(Math.min(leverage, 50)) : null,
      panel: q.get('panel') === 'positions' ? 'positions' : null
    };
  } catch { return { market: null, side: null, collateral: null, leverage: null, panel: null }; }
}

export default function FuturesOnchain() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const { haptic } = useTelegram();
  const slippagePct = useSettingsStore((s) => s.defaultSlippage);
  const prefill = useMemo(readPrefill, []);
  /*
   * Store ACTIONS only. Subscribing to the whole store here would re-create
   * every callback each time the store changed — and the callbacks change the
   * store, which is an infinite fetch loop. Zustand actions are stable.
   */
  const store = useMemo(() => {
    const s = useFuturesStore.getState();
    return { setSelection: s.setSelection, setProviders: s.setProviders, setQuote: s.setQuote, setRisk: s.setRisk, setExecution: s.setExecution, setPositions: s.setPositions };
  }, []);

  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providerId, setProviderId] = useState('ostium');
  const [markets, setMarkets] = useState([]);
  const [marketsState, setMarketsState] = useState({ loading: true, live: false, stale: false, code: null });
  const [category, setCategory] = useState('Crypto');
  const [marketId, setMarketId] = useState('');
  const [search, setSearch] = useState('');
  const [resolution, setResolution] = useState('60');
  const [candles, setCandles] = useState({ rows: [], live: false, loading: false });
  const [side, setSide] = useState(prefill.side || 'long');
  const [collateral, setCollateral] = useState(prefill.collateral || '50');
  const [leverage, setLeverage] = useState(prefill.leverage || '5');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState({ rows: [], live: null, loading: false });
  const [walletOpen, setWalletOpen] = useState(false);
  const [prepared, setPrepared] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [txState, setTxState] = useState(FUTURES_TX_STATE.IDLE);
  const [lastTx, setLastTx] = useState(null);
  const [managing, setManaging] = useState(null);
  const [manageAction, setManageAction] = useState('close');
  const [manageValue, setManageValue] = useState('100');
  const machineRef = useRef(createFuturesTxMachine({ action: 'open' }));
  /* futures_close hand-off lands on the positions list (?panel=positions). */
  const positionsRef = useRef(null);
  useEffect(() => {
    if (prefill.panel !== 'positions' || !wallet.isConnected) return;
    const id = setTimeout(() => { try { positionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* jsdom */ } }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.isConnected]);

  const provider = providers.find((p) => p.providerId === providerId) || null;
  const executable = Boolean(provider?.executable);
  const readOnly = provider && !executable;

  /* ── providers (registry) ────────────────────────────────────────────── */
  const providerIdRef = useRef(providerId);
  providerIdRef.current = providerId;
  const loadProviders = useCallback(async () => {
    const res = await getFuturesProviders();
    const rows = res.ok ? res.data.providers : [];
    setProviders(rows);
    store.setProviders(rows, res.ok ? 'live' : 'unavailable');
    /* Prefer the first executable venue; fall back to any venue with a server adapter. */
    if (rows.length && !rows.some((p) => p.providerId === providerIdRef.current)) {
      const first = rows.find((p) => p.executable) || rows.find((p) => p.execution === 'ONCHAIN_UNSIGNED_TX') || rows[0];
      if (first) setProviderId(first.providerId);
    }
    setProvidersLoading(false);
  }, [store]);

  useEffect(() => { loadProviders(); const id = setInterval(loadProviders, 30_000); return () => clearInterval(id); }, [loadProviders]);

  /* ── markets ─────────────────────────────────────────────────────────── */
  const loadMarkets = useCallback(async () => {
    const res = await getFuturesMarkets(providerId);
    if (res.ok) {
      const rows = (res.data.markets || []).map((m) => ({ ...m, uiCategory: friendlyCategory(m.category) }));
      setMarkets(rows);
      setMarketsState({ loading: false, live: res.data.live, stale: res.data.stale, code: null });
    } else {
      setMarkets([]);
      setMarketsState({ loading: false, live: false, stale: false, code: res.error?.code || 'PROVIDER_UNAVAILABLE' });
    }
  }, [providerId]);

  useEffect(() => {
    setMarketsState((s) => ({ ...s, loading: true }));
    loadMarkets();
    const id = setInterval(loadMarkets, 15_000);
    return () => clearInterval(id);
  }, [loadMarkets]);

  const categories = useMemo(() => {
    const found = new Set(markets.map((m) => m.uiCategory));
    return [...CATEGORY_ORDER, 'Other'].filter((c) => found.has(c));
  }, [markets]);
  useEffect(() => { if (categories.length && !categories.includes(category)) setCategory(categories[0]); }, [categories, category]);

  const visible = useMemo(() => {
    let rows = markets.filter((m) => m.uiCategory === category);
    const q = search.trim().toLowerCase();
    if (q) rows = markets.filter((m) => m.symbol.toLowerCase().includes(q));
    return rows;
  }, [markets, category, search]);
  useEffect(() => {
    if (visible.length && !visible.some((m) => m.marketId === marketId)) setMarketId(visible[0].marketId);
  }, [visible, marketId]);

  /* The hand-off market wins the first time the catalogue lists it. */
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (prefillApplied.current || !prefill.market || !markets.length) return;
    const want = prefill.market.replace('-', '/');
    const hit = markets.find((m) => m.symbol === want || m.symbol === `${want}/USD` || m.symbol.split('/')[0] === want || m.marketId === prefill.market);
    prefillApplied.current = true;
    if (!hit) return;
    setCategory(hit.uiCategory);
    setMarketId(hit.marketId);
  }, [markets, prefill.market]);

  const market = markets.find((m) => m.marketId === marketId) || null;
  useEffect(() => {
    if (market) store.setSelection({ selectedProviderId: providerId, selectedMarketId: market.marketId, selectedSide: side });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, market?.marketId, side]);

  const effectiveMax = market?.isDayTradingClosed && market.overnightMaxLeverage > 0 ? market.overnightMaxLeverage : market?.maxLeverage;
  useEffect(() => { if (effectiveMax && Number(leverage) > effectiveMax) setLeverage(String(effectiveMax)); }, [effectiveMax, leverage]);

  /* ── candles ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!market) return undefined;
    let alive = true;
    setCandles((c) => ({ ...c, loading: true }));
    getFuturesCandles({ provider: providerId, market: market.marketId, resolution, limit: 96 }).then((res) => {
      if (!alive) return;
      const rows = res.ok ? res.data.candles || [] : [];
      setCandles({ rows, live: res.ok && res.data.live === true, loading: false });
    });
    return () => { alive = false; };
  }, [providerId, market?.marketId, resolution]);

  const candlePoints = useMemo(() => candles.rows.map((c) => ({ x: c.startedAt, y: c.close })), [candles.rows]);
  const candleChange = useMemo(() => {
    if (candles.rows.length < 2) return 0;
    const a = candles.rows[0].close; const b = candles.rows[candles.rows.length - 1].close;
    return a > 0 ? ((b - a) / a) * 100 : 0;
  }, [candles.rows]);

  /* ── account + positions (wallet-scoped, never cached) ───────────────── */
  const refreshWallet = useCallback(async () => {
    if (!wallet.address || !provider || provider.execution !== 'ONCHAIN_UNSIGNED_TX') { setAccount(null); setPositions({ rows: [], live: null, loading: false }); return; }
    setPositions((p) => ({ ...p, loading: true }));
    const [acc, pos] = await Promise.all([getFuturesAccount(wallet.address, providerId), getFuturesPositions(wallet.address, providerId)]);
    setAccount(acc.ok ? acc.data : null);
    if (pos.ok) { setPositions({ rows: pos.data.positions, live: true, loading: false }); store.setPositions(providerId, pos.data.positions); }
    else setPositions({ rows: [], live: false, loading: false });
  }, [wallet.address, providerId, provider, store]);

  useEffect(() => { refreshWallet(); }, [refreshWallet, lastTx]);

  /* ── live quote (debounced) — fee + risk + route from the backend ────── */
  useEffect(() => {
    if (!market || !Number(collateral) || !Number(leverage)) { setQuote(null); setQuoteError(null); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      setQuoting(true);
      const res = await quoteFutures({
        provider: providerId, market: market.marketId, side, collateralUsd: Number(collateral), leverage: Number(leverage),
        takeProfit: takeProfit === '' ? null : Number(takeProfit), stopLoss: stopLoss === '' ? null : Number(stopLoss),
        slippageBps: Math.round(Number(slippagePct) * 100), wallet: wallet.address || null
      });
      if (!alive) return;
      if (res.ok) { setQuote(res.data); setQuoteError(null); store.setQuote({ providerId, marketId: market.marketId, requestId: res.data.requestId }); store.setRisk(res.data.risk); }
      else { setQuote(null); setQuoteError(res.error?.code || 'PROVIDER_UNAVAILABLE'); }
      setQuoting(false);
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, market?.marketId, market?.mid, side, collateral, leverage, takeProfit, stopLoss, slippagePct, wallet.address]);

  const fee = quote?.fee || null;
  const risk = quote?.risk || null;
  const needsApproval = Boolean(quote?.account?.needsApproval);
  const insufficient = Boolean(quote?.account && quote.account.balanceUsd != null && quote.account.balanceUsd + 1e-9 < Number(collateral || 0));

  const ensureChain = async () => {
    if (!provider?.chainId) return true;
    if (wallet.chainId === provider.chainId) return true;
    const ok = await wallet.switchChain?.(provider.chainId);
    if (!ok) throw Object.assign(new Error('WRONG_NETWORK'), { code: 'WRONG_NETWORK' });
    return true;
  };

  const setMachine = (next, meta) => { const r = machineRef.current.transition(next, meta); if (r.ok) setTxState(next); return r.ok; };
  const resetMachine = () => { machineRef.current = createFuturesTxMachine({ action: 'open' }); setTxState(FUTURES_TX_STATE.IDLE); };

  /* ── review: build the unsigned order server-side ────────────────────── */
  const openReview = async () => {
    setError(null);
    if (!wallet.isConnected) return setWalletOpen(true);
    if (!executable) return setError(provider?.status === 'READ_ONLY' ? 'PROVIDER_READ_ONLY' : 'PROVIDER_UNAVAILABLE');
    resetMachine();
    setBusy(true);
    try {
      setMachine(FUTURES_TX_STATE.VALIDATING);
      await ensureChain();
      setMachine(FUTURES_TX_STATE.QUOTING);
      const res = await prepareFutures({
        provider: providerId, market: market.marketId, side, collateralUsd: Number(collateral), leverage: Number(leverage),
        takeProfit: takeProfit === '' ? null : Number(takeProfit), stopLoss: stopLoss === '' ? null : Number(stopLoss),
        slippageBps: Math.round(Number(slippagePct) * 100), wallet: wallet.address
      });
      if (!res.ok) {
        const code = res.error?.code || 'PROVIDER_UNAVAILABLE';
        setMachine(code === 'RISK_BLOCKED' ? FUTURES_TX_STATE.BLOCKED : FUTURES_TX_STATE.FAILED, { code });
        throw Object.assign(new Error(code), { code, risk: res.error?.risk });
      }
      setMachine(FUTURES_TX_STATE.RISK_CHECK);
      if (res.data.risk?.blocked) { setMachine(FUTURES_TX_STATE.BLOCKED); throw Object.assign(new Error('RISK_BLOCKED'), { code: 'RISK_BLOCKED' }); }
      setMachine(FUTURES_TX_STATE.READY);
      setPrepared(res.data);
      store.setExecution({ executionId: res.data.executionId, state: 'PREPARED' });
      setConfirming(true);
    } catch (e) {
      setError(errCode(e));
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  /* ── sign the server-built calldata; report the hash to /verify ──────── */
  const submit = async () => {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      if (Date.now() > prepared.expiresAt) throw Object.assign(new Error('QUOTE_EXPIRED'), { code: 'QUOTE_EXPIRED' });
      await ensureChain();
      const signer = wallet.getSigner?.();
      if (!signer) throw Object.assign(new Error('WALLET_NOT_CONNECTED'), { code: 'WALLET_NOT_CONNECTED' });
      setMachine(FUTURES_TX_STATE.SIMULATING);
      setMachine(FUTURES_TX_STATE.AWAITING_SIGNATURE);
      let hash = null;
      for (const tx of prepared.transactions) {
        /* The BFF only ever returns two targets; refuse anything else before signing. */
        if (![prepared.transactions[0].to, ...prepared.transactions.map((x) => x.to)].includes(tx.to)) throw Object.assign(new Error('CONTRACT_MISMATCH'), { code: 'CONTRACT_MISMATCH' });
        let sent;
        try {
          sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value && tx.value !== '0x0' ? tx.value : undefined });
        } catch (e) {
          const code = errCode(e);
          setMachine(code === 'USER_REJECTED' ? FUTURES_TX_STATE.REJECTED : FUTURES_TX_STATE.FAILED, { code });
          if (code === 'USER_REJECTED') await verifyFutures({ executionId: prepared.executionId, status: 'REJECTED' });
          throw e;
        }
        if (tx.kind === 'approve') { await sent.wait(); continue; }
        hash = sent.hash;
        setMachine(FUTURES_TX_STATE.SIGNED);
        setMachine(FUTURES_TX_STATE.BROADCASTING);
        setMachine(FUTURES_TX_STATE.PENDING);
        await verifyFutures({ executionId: prepared.executionId, txHash: hash });
        emitFuturesEvent('FUTURES_ORDER_SUBMITTED', { executionId: prepared.executionId, txHash: hash, providerId });
        setLastTx({ hash, chainId: tx.chainId, executionId: prepared.executionId, state: 'PENDING' });
        setConfirming(false);
        haptic?.('success');
        /* Confirm in the background; the receipt drives the ledger. */
        sent.wait().then(async () => {
          setMachine(FUTURES_TX_STATE.CONFIRMED);
          setMachine(FUTURES_TX_STATE.VERIFYING);
          const v = await verifyFutures({ executionId: prepared.executionId, txHash: hash });
          const done = v.ok && v.data.state === 'COMPLETED';
          setMachine(done ? FUTURES_TX_STATE.COMPLETED : FUTURES_TX_STATE.FAILED);
          setLastTx((prev) => ({ ...(prev || {}), state: done ? 'COMPLETED' : 'FAILED' }));
          emitFuturesEvent(done ? 'FUTURES_ORDER_CONFIRMED' : 'FUTURES_ORDER_FAILED', { executionId: prepared.executionId, txHash: hash, providerId });
          if (done) emitFuturesEvent('FUTURES_POSITION_OPENED', { executionId: prepared.executionId, providerId, marketId: market?.marketId });
          refreshWallet();
        }).catch(async () => {
          setMachine(FUTURES_TX_STATE.FAILED);
          await verifyFutures({ executionId: prepared.executionId, txHash: hash });
          setLastTx((prev) => ({ ...(prev || {}), state: 'FAILED' }));
        });
      }
      setPrepared(null);
    } catch (e) {
      setError(errCode(e));
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  /* ── position management: TP / SL / increase / reduce / close ────────── */
  const submitManagement = async () => {
    if (!managing) return;
    setBusy(true);
    setError(null);
    try {
      await ensureChain();
      const signer = wallet.getSigner?.();
      if (!signer) throw Object.assign(new Error('WALLET_NOT_CONNECTED'), { code: 'WALLET_NOT_CONNECTED' });
      const payload = { positionId: managing.positionId, action: manageAction, wallet: wallet.address, provider: providerId, slippageBps: Math.round(Number(slippagePct) * 100) };
      if (manageAction === 'close' || manageAction === 'decrease') payload.closePercent = Number(manageValue);
      else if (manageAction === 'increase') payload.amountUsd = Number(manageValue);
      else payload.value = Number(manageValue);
      const res = await manageFuturesPosition(payload);
      if (!res.ok) throw Object.assign(new Error(res.error?.code || 'PROVIDER_UNAVAILABLE'), { code: res.error?.code || 'PROVIDER_UNAVAILABLE', detail: res.error?.detail });
      let hash = null;
      for (const tx of res.data.transactions) {
        const sent = await signer.sendTransaction({ to: tx.to, data: tx.data });
        if (tx.kind === 'approve') { await sent.wait(); continue; }
        hash = sent.hash;
      }
      if (hash) {
        await verifyFutures({ executionId: res.data.executionId, txHash: hash });
        setLastTx({ hash, chainId: provider?.chainId, executionId: res.data.executionId, state: 'PENDING', action: manageAction });
        emitFuturesEvent('FUTURES_ORDER_SUBMITTED', { executionId: res.data.executionId, txHash: hash, providerId, action: manageAction });
      }
      setManaging(null);
      haptic?.('success');
    } catch (e) {
      const code = errCode(e);
      if (code === 'USER_REJECTED') { /* not retried; the sheet stays open for the user */ }
      setError(code);
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = !wallet.isConnected
    ? t('futures.connect')
    : provider?.chainId && wallet.chainId !== provider.chainId
      ? t('futures.switchNetwork', { chain: provider.chainName })
      : readOnly
        ? t('futures.readOnlyButton')
        : needsApproval
          ? t('futures.approveAndReview')
          : t('futures.review');
  const canReview = !busy && executable && market && quote && !risk?.blocked && !insufficient && !quoting;

  const statusLabel = (p) => t(`futures.status.${p.status}`, { defaultValue: p.status });
  const reasonLabel = (p) => (p.reason ? t(`futures.reason.${p.reason}`, { defaultValue: p.reason }) : '');

  return (
    <PageTransition>
      <div className="derivatives-hall">
        <div className="derivatives-aurora" aria-hidden="true" />

        <motion.section className="derivatives-hero" variants={riseIn} initial="hidden" animate="show">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="derivatives-title"><span className="derivatives-title-glow">{t('futures.onchain.title')}</span></div>
              <p className="derivatives-subtitle">{t('futures.onchain.subtitle')}</p>
            </div>
            {provider && (
              <span className={`pill ${STATUS_TONE[provider.status] || 'pill-neutral'}`} style={{ alignSelf: 'flex-start' }} data-testid="futures-provider-status">
                {statusLabel(provider)}
              </span>
            )}
          </div>
        </motion.section>

        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <div className="glass-notice" style={{ borderColor: 'rgba(255,59,107,0.16)', background: 'rgba(255,59,107,0.08)' }}>{t('futures.riskNotice')}</div>
        </motion.div>

        {/* ── providers / multi-protocol comparison ─────────────────────── */}
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <p className="section-label" style={{ marginBottom: 8 }}>{t('futures.providers')}</p>
          {providersLoading && !providers.length ? <div className="skel" style={{ height: 64 }} /> : !providers.length ? (
            <p className="notice">{t('futures.providersUnavailable')}</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {providers.filter((p) => p.execution !== 'CLIENT_SIGNED_SESSION').map((p) => (
                <button
                  key={p.providerId}
                  type="button"
                  className="wallet-option"
                  aria-pressed={p.providerId === providerId}
                  onClick={() => { setProviderId(p.providerId); haptic?.('light'); }}
                  style={{ borderColor: p.providerId === providerId ? 'rgba(0,229,255,0.35)' : undefined }}
                  data-testid={`futures-provider-${p.providerId}`}
                >
                  <span className="wallet-badge" style={{ color: p.executable ? 'var(--rgb-1)' : 'var(--text-3)' }}>{p.name.slice(0, 3).toUpperCase()}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{p.name} <span className="faint">· {p.chainName}</span></span>
                    <span className="set-row-sub">{p.executable ? t('futures.providerExecutable', { count: p.marketCount }) : reasonLabel(p) || t('futures.providerNotExecutable')}</span>
                  </span>
                  <span className={`pill ${STATUS_TONE[p.status] || 'pill-neutral'}`}>{statusLabel(p)}</span>
                </button>
              ))}
            </div>
          )}
          <p className="faint" style={{ marginTop: 8 }}>{t('futures.routerNote')}</p>
        </motion.section>

        {readOnly && (
          <p className="notice" style={{ marginTop: 12 }} data-testid="futures-readonly-notice">
            {provider.status === 'READ_ONLY' ? t('futures.readOnlyNotice') : t('futures.unavailableNotice', { reason: reasonLabel(provider) })}
          </p>
        )}

        {/* ── market selection ──────────────────────────────────────────── */}
        <div className="tag-scroll" style={{ gap: 8, paddingBottom: 2, marginTop: 16 }}>
          {categories.map((c) => (
            <button key={c} className={`tag ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
              {t(`futures.category.${c.toLowerCase()}`, { defaultValue: c })}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('futures.searchPlaceholder', { count: markets.length })} style={{ flex: 1, fontSize: 12.5 }} />
          {search && <button className="tag" onClick={() => setSearch('')}>{t('futures.clearSearch')}</button>}
        </div>

        <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16, width: '100%', boxSizing: 'border-box' }}>
          {marketsState.loading && !markets.length ? <div className="skel" style={{ height: 240 }} /> : !markets.length ? (
            <div className="empty" data-testid="futures-markets-unavailable">
              <span className="empty-icon">⌁</span>
              <p>{t(`futures.err.${marketsState.code || 'PROVIDER_UNAVAILABLE'}`, { defaultValue: t('futures.marketsUnavailable') })}</p>
              <button className="btn btn-ghost" onClick={loadMarkets}>{t('common.retry')}</button>
            </div>
          ) : (
            <>
              {marketsState.stale && (
                <div className="feed-offline-note"><span className="pulse-dot" aria-hidden="true" />{t('futures.staleNotice')}</div>
              )}
              <label className="field-label">{t('futures.market')}</label>
              <select value={market?.marketId || ''} onChange={(e) => setMarketId(e.target.value)} data-testid="futures-market-select">
                {visible.map((m) => <option key={m.marketId} value={m.marketId}>{m.symbol}</option>)}
              </select>

              {market && (
                <div className="row-between" style={{ margin: '12px 0' }}>
                  <div>
                    <div className="faint">{t('futures.midPrice')}</div>
                    <div className="stat-mini mono">${fmtPrice(market.mid)}</div>
                    <span className={`pill ${market.isMarketOpen ? 'pill-up' : 'pill-down'}`}>{market.isMarketOpen ? t('futures.marketOpen') : t('futures.marketClosed')}</span>
                  </div>
                  <div style={{ textAlign: 'end' }}>
                    <div className="faint">{t('futures.spread')}</div>
                    <div className="mono" style={{ fontSize: 12 }}>${fmtPrice(market.bid)} — ${fmtPrice(market.ask)}</div>
                    <div className="faint" style={{ marginTop: 5 }}>{t('futures.maxLeverage', { value: effectiveMax ?? '—' })}</div>
                  </div>
                </div>
              )}

              {/* chart — real candles or an honest "unavailable" */}
              <div className="dydx-chart" data-testid="futures-chart">
                <div className="dydx-chart-head">
                  <span className="faint">{candles.live ? t('futures.chartTitle') : t('futures.chartUnavailableShort')}</span>
                  <div className="dydx-chart-res">
                    {RESOLUTIONS.map(([res, label]) => (
                      <button key={res} type="button" className={resolution === res ? 'active' : ''} onClick={() => setResolution(res)}>{label}</button>
                    ))}
                  </div>
                </div>
                <TrendChart
                  points={candlePoints}
                  height={132}
                  up={candleChange >= 0}
                  loading={candles.loading}
                  emptyLabel={candles.loading ? '' : t('futures.chartUnavailable')}
                  formatValue={(v) => `$${fmtPrice(v)}`}
                  testId="futures-trend"
                />
                {candles.live && (
                  <div className="dydx-chart-foot">
                    <span className={`mono ${candleChange >= 0 ? 'up' : 'down'}`}>{fmtPct(candleChange)}</span>
                    <span className="faint">{t('futures.chartSource', { provider: provider?.name || providerId })}</span>
                  </div>
                )}
              </div>

              {/* market info */}
              {market && (
                <div className="brg-quote" style={{ marginTop: 12 }} data-testid="futures-market-info">
                  <div className="row-between"><span className="faint">{t('futures.funding')}</span><span className="mono">{market.fundingAprPct == null ? '—' : `${fmtPct(market.fundingAprPct)} ${t('futures.perYear')}`}</span></div>
                  <div className="row-between"><span className="faint">{t('futures.fundingSide')}</span><span className="mono">{market.fundingAprPct == null ? '—' : market.fundingAprPct > 0 ? t('futures.longsPay') : t('futures.shortsPay')}</span></div>
                  <div className="row-between"><span className="faint">{t('futures.openInterest')}</span><span className="mono">{fmtUsd(market.openInterestUsd)}{market.maxOpenInterestUsd ? ` / ${fmtUsd(market.maxOpenInterestUsd)}` : ''}</span></div>
                  <div className="row-between"><span className="faint">{t('futures.oiSplit')}</span><span className="mono">{fmtUsd(market.openInterestLongUsd)} · {fmtUsd(market.openInterestShortUsd)}</span></div>
                  <div className="row-between"><span className="faint">{t('futures.protocolFee')}</span><span className="mono">{market.openFeeBps} bps</span></div>
                </div>
              )}

              {/* ticket */}
              <div className="dir-switch" style={{ marginTop: 12 }}>
                <button type="button" className={`dir-btn long ${side === 'long' ? 'active' : ''}`} onClick={() => setSide('long')}>
                  <span className="dir-ico"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg></span>
                  {t('futures.long')}<span className="dir-sub">{t('futures.longSub')}</span>
                </button>
                <button type="button" className={`dir-btn short ${side === 'short' ? 'active' : ''}`} onClick={() => setSide('short')}>
                  <span className="dir-ico"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg></span>
                  {t('futures.short')}<span className="dir-sub">{t('futures.shortSub')}</span>
                </button>
              </div>

              <div className="row" style={{ gap: 10 }}>
                <label style={{ flex: 1 }}>
                  <span className="field-label">{t('futures.collateral', { asset: provider?.collateral || 'USDC' })}</span>
                  <input type="number" min="5" inputMode="decimal" value={collateral} onChange={(e) => setCollateral(e.target.value)} data-testid="futures-collateral" />
                </label>
                <label style={{ flex: 1 }}>
                  <span className="field-label">{t('futures.leverage')}</span>
                  <input type="number" min="1" max={effectiveMax || 50} step="0.25" inputMode="decimal" value={leverage} onChange={(e) => setLeverage(e.target.value)} data-testid="futures-leverage" />
                </label>
              </div>
              <div className="lev-row" style={{ marginTop: 8 }}>
                {LEVERAGE_PRESETS.filter((n) => n <= (effectiveMax || 50)).map((n) => (
                  <button key={n} type="button" className={`lev-chip ${Number(leverage) === n ? 'active' : ''}`} onClick={() => setLeverage(String(n))}>{n}×</button>
                ))}
              </div>
              <input type="range" min="1" max={Math.min(effectiveMax || 50, 50)} step="0.25" value={Math.min(Number(leverage) || 1, effectiveMax || 50)} onChange={(e) => setLeverage(e.target.value)} style={{ width: '100%', marginTop: 8, accentColor: 'var(--rgb-1)' }} />

              <InfoBox title={t('futures.riskControls')} tone="info" id="futures-controls">
                <div className="row" style={{ gap: 10 }}>
                  <label style={{ flex: 1 }}><span className="faint">{t('futures.takeProfit')}</span><input type="number" min="0" inputMode="decimal" placeholder="0" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} /></label>
                  <label style={{ flex: 1 }}><span className="faint">{t('futures.stopLoss')}</span><input type="number" min="0" inputMode="decimal" placeholder="0" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} /></label>
                </div>
                <p>{t('futures.slippage', { value: slippagePct })}</p>
              </InfoBox>

              {/* fee + risk — backend numbers only */}
              {quoteError && !quote && <p className="notice" style={{ marginTop: 10 }}>{t(`futures.err.${quoteError}`, { defaultValue: t('futures.quoteUnavailable') })}</p>}
              {fee && (
                <div className="brg-quote" style={{ marginTop: 12 }} data-testid="futures-fee-breakdown">
                  <div className="row-between"><span className="faint">{t('futures.notional')}</span><span className="mono">{fmtUsd(fee.notionalUsd)}</span></div>
                  <div className="row-between"><span className="faint">{t('futures.fee.protocol')}</span><span className="mono">{fee.protocol.known ? fmtUsd(fee.protocol.feeUsd) : t('futures.unknown')}</span></div>
                  <div className="row-between"><span className="faint">{t('futures.fee.network')}</span><span className="mono">{fee.network.known ? fmtUsd(fee.network.feeUsd) : t('futures.fee.networkAtReview')}</span></div>
                  <div className="row-between"><span className="faint">{t('futures.fee.fbt', { bps: fee.fbt.bps })}</span><span className="mono">{fmtUsd(fee.fbt.feeUsd)}</span></div>
                  <div className="row-between"><strong>{t('futures.fee.total')}</strong><strong className="mono">{fee.complete ? fmtUsd(fee.totalFeeUsd) : t('futures.fee.totalAtReview')}</strong></div>
                  <p className="faint" style={{ margin: '7px 0 0' }}>{t('futures.fee.honesty', { pct: (fee.fbt.pctOfCollateral ?? 0).toFixed(2) })}</p>
                </div>
              )}
              {risk && (
                <div className="brg-quote" style={{ marginTop: 10 }} data-testid="futures-risk">
                  <div className="row-between">
                    <span className="faint">{t('futures.riskLevel')}</span>
                    <span className={`pill ${risk.riskLevel === 'LOW' ? 'pill-up' : risk.riskLevel === 'MEDIUM' ? 'pill-neutral' : 'pill-down'}`}>{t(`futures.risk.${risk.riskLevel}`)} · {risk.riskScore}/100</span>
                  </div>
                  <div className="row-between"><span className="faint">{t('futures.liquidationDistance')}</span><span className="mono">{risk.liquidationDistancePct == null ? '—' : `${fmtPct(-Math.abs(risk.liquidationDistancePct))} → $${fmtPrice(risk.liquidationPrice)}`}</span></div>
                  {risk.maxRecommendedCollateralUsd != null && <div className="row-between"><span className="faint">{t('futures.maxRecommended')}</span><span className="mono">{fmtUsd(risk.maxRecommendedCollateralUsd)}</span></div>}
                  {risk.warnings.map((w) => <p key={w} className="faint" style={{ margin: '5px 0 0' }}>⚠ {t(`futures.warn.${w}`, { defaultValue: w })}</p>)}
                  {risk.blockReasons.map((w) => <p key={w} className="notice notice-danger" style={{ margin: '6px 0 0' }}>{t(`futures.block.${w}`, { defaultValue: w })}</p>)}
                </div>
              )}

              {wallet.isConnected && quote?.account && (
                <div className="row-between" style={{ marginTop: 12 }}>
                  <span className="faint">{shortAddress(wallet.address)} · {provider?.chainName}</span>
                  <span className="mono" style={{ fontSize: 12 }}>{quote.account.balanceUsd == null ? '—' : `${quote.account.balanceUsd.toFixed(2)} ${provider?.collateral || 'USDC'}`}</span>
                </div>
              )}
              {insufficient && <p className="notice notice-danger" style={{ marginTop: 9 }}>{t('futures.err.INSUFFICIENT_BALANCE')}</p>}
              {error && <p className="notice notice-danger" style={{ marginTop: 9 }} data-testid="futures-error">{t(`futures.err.${error}`, { defaultValue: error })}</p>}

              <button className={`btn ${side === 'long' ? 'btn-success' : 'btn-danger'}`} style={{ width: '100%', marginTop: 12 }} disabled={wallet.isConnected && !canReview} onClick={openReview} data-testid="futures-review">
                {busy ? t('common.loading') : buttonLabel}
              </button>
              <p className="faint" style={{ marginTop: 7 }}>{t('futures.exactApproval')}</p>
              {txState !== FUTURES_TX_STATE.IDLE && (
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }} data-testid="futures-tx-state">
                  {machineRef.current.progress().map((s) => (
                    <span key={s.id} className={`pill ${s.status === 'done' ? 'pill-up' : s.status === 'active' ? 'pill-rgb' : 'pill-neutral'}`}>{t(s.labelKey)}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </motion.section>

        {lastTx && (
          <div className="notice" style={{ marginTop: 16 }} data-testid="futures-last-tx">
            <strong>{t(`futures.txState.${lastTx.state}`, { defaultValue: lastTx.state })}</strong>
            {EXPLORERS[lastTx.chainId] && (
              <a className="row" style={{ gap: 6, marginTop: 7 }} href={`${EXPLORERS[lastTx.chainId]}${lastTx.hash}`} target="_blank" rel="noopener noreferrer">
                {t('futures.viewTransaction')} <IconExternal width={14} height={14} />
              </a>
            )}
          </div>
        )}

        {/* ── my positions ──────────────────────────────────────────────── */}
        {wallet.isConnected && provider?.execution === 'ONCHAIN_UNSIGNED_TX' && (
          <section style={{ marginTop: 18 }} data-testid="futures-positions" ref={positionsRef}>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <p className="section-label">{t('futures.positions')}</p>
              <button className="tag" onClick={refreshWallet}>{t('common.refresh')}</button>
            </div>
            {positions.loading && !positions.rows.length ? <div className="skel" style={{ height: 80 }} /> : positions.live === false ? <p className="notice">{t('futures.positionsUnavailable')}</p> : positions.rows.length === 0 ? (
              <div className="empty"><IconTrend width={28} height={28} /><p>{t('futures.noPositions')}</p></div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {positions.rows.map((p) => (
                  <div key={p.positionId} className="card card-tight">
                    <div className="row-between">
                      <div><strong>{p.symbol}</strong> <span className={`pill ${p.side === 'long' ? 'pill-up' : 'pill-down'}`}>{t(`futures.${p.side}`)}</span></div>
                      <span className="mono">{p.leverage}×</span>
                    </div>
                    <div className="row-between" style={{ marginTop: 7 }}><span className="faint">{t('futures.collateralLabel')}</span><span className="mono">{fmtUsd(p.collateralUsd)}</span></div>
                    <div className="row-between"><span className="faint">{t('futures.entryMark')}</span><span className="mono">${fmtPrice(p.entryPrice)} / {p.markPrice != null ? `$${fmtPrice(p.markPrice)}` : '—'}</span></div>
                    <div className="row-between"><span className="faint">{t('futures.grossPnl')}</span><span className={`mono ${p.grossPnlPct == null ? '' : p.grossPnlPct >= 0 ? 'up' : 'down'}`}>{p.grossPnlPct == null ? '—' : `${fmtPct(p.grossPnlPct)} (${fmtUsd(p.grossPnlUsd)})`}</span></div>
                    <div className="row-between"><span className="faint">{t('futures.liquidationDistance')}</span><span className="mono">{p.health?.distanceToLiquidationPct == null ? '—' : `${p.health.distanceToLiquidationPct.toFixed(2)}%`}</span></div>
                    <div className="row-between"><span className="faint">{t('futures.tpSl')}</span><span className="mono">{p.takeProfit ? `$${fmtPrice(p.takeProfit)}` : '—'} / {p.stopLoss ? `$${fmtPrice(p.stopLoss)}` : '—'}</span></div>
                    <p className="faint" style={{ margin: '6px 0 0' }}>{t('futures.pnlBasis')}</p>
                    <div className="row" style={{ gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                      {[['tp', t('futures.manage.tp')], ['sl', t('futures.manage.sl')], ['increase', t('futures.manage.increase')], ['decrease', t('futures.manage.decrease')], ['close', t('futures.manage.close')]].map(([a, label]) => (
                        <button key={a} className="btn btn-ghost btn-sm" onClick={() => { setManaging(p); setManageAction(a); setManageValue(a === 'close' ? '100' : a === 'decrease' ? '50' : a === 'increase' ? '10' : a === 'tp' ? String(p.takeProfit || '') : String(p.stopLoss || '')); setError(null); }}>{label}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 18 }}>
          <div className="sheen" />
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <IconShield width={21} height={21} style={{ color: 'var(--rgb-1)', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('futures.nonCustodialTitle')}</div>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>{t('futures.nonCustodialBody')}</p>
            </div>
          </div>
        </motion.section>

        <div style={{ marginTop: 18 }}>
          <InfoBox title={t('futures.whatYouTrade')} tone="warn" id="futures-product">
            <p>{t('futures.derivativeNotice')}</p>
            <p>{t('futures.noGuarantee')}</p>
          </InfoBox>
        </div>

        <WalletConnectSheet open={walletOpen} onClose={() => setWalletOpen(false)} />

        {/* ── confirmation preview — every number from /prepare ─────────── */}
        <Sheet open={confirming && Boolean(prepared)} onClose={() => { if (!busy) { setConfirming(false); setPrepared(null); resetMachine(); } }} title={t('futures.confirmTitle')}>
          {prepared && (
            <div className="stack" style={{ gap: 10 }} data-testid="futures-confirm">
              <div className="card card-tight stack" style={{ gap: 8 }}>
                <div className="row-between"><span className="faint">{t('futures.provider')}</span><strong>{provider?.name} · {provider?.chainName}</strong></div>
                <div className="row-between"><span className="faint">{t('futures.market')}</span><strong>{prepared.market.symbol}</strong></div>
                <div className="row-between"><span className="faint">{t('futures.direction')}</span><strong>{t(`futures.${prepared.order.side}`)}</strong></div>
                <div className="row-between"><span className="faint">{t('futures.collateralLabel')}</span><span className="mono">{fmtUsd(prepared.order.collateralUsd)} × {prepared.order.leverage}</span></div>
                <div className="row-between"><span className="faint">{t('futures.notional')}</span><span className="mono">{fmtUsd(prepared.order.notionalUsd)}</span></div>
                <div className="row-between"><span className="faint">{t('futures.entryPrice')}</span><span className="mono">${fmtPrice(prepared.order.entryPrice)}</span></div>
                <div className="row-between"><span className="faint">{t('futures.tpSl')}</span><span className="mono">{prepared.order.takeProfit ? `$${fmtPrice(prepared.order.takeProfit)}` : '—'} / {prepared.order.stopLoss ? `$${fmtPrice(prepared.order.stopLoss)}` : '—'}</span></div>
                <div className="row-between"><span className="faint">{t('futures.liquidationDistance')}</span><span className="mono">{prepared.risk.liquidationDistancePct == null ? '—' : `${prepared.risk.liquidationDistancePct.toFixed(2)}% → $${fmtPrice(prepared.risk.liquidationPrice)}`}</span></div>
                <div className="row-between"><span className="faint">{t('futures.fee.protocol')}</span><span className="mono">{prepared.fee.protocol.known ? fmtUsd(prepared.fee.protocol.feeUsd) : t('futures.unknown')}</span></div>
                <div className="row-between"><span className="faint">{t('futures.fee.network')}</span><span className="mono">{prepared.fee.network.known ? fmtUsd(prepared.fee.network.feeUsd) : t('futures.fee.networkWallet')}</span></div>
                <div className="row-between"><span className="faint">{t('futures.fee.fbt', { bps: prepared.fee.fbt.bps })}</span><span className="mono">{fmtUsd(prepared.fee.fbt.feeUsd)}</span></div>
                <div className="row-between"><strong>{t('futures.fee.total')}</strong><strong className="mono">{prepared.fee.complete ? fmtUsd(prepared.fee.totalFeeUsd) : t('futures.fee.totalPartial', { known: fmtUsd((prepared.fee.protocol.feeUsd || 0) + prepared.fee.fbt.feeUsd) })}</strong></div>
                <div className="row-between"><span className="faint">{t('futures.riskLevel')}</span><span className={`pill ${prepared.risk.riskLevel === 'LOW' ? 'pill-up' : prepared.risk.riskLevel === 'MEDIUM' ? 'pill-neutral' : 'pill-down'}`}>{t(`futures.risk.${prepared.risk.riskLevel}`)}</span></div>
                <div className="row-between"><span className="faint">{t('futures.route')}</span><span className="mono">{prepared.route?.providerId}</span></div>
                {prepared.account.needsApproval && <p className="faint" style={{ margin: 0 }}>{t('futures.approvalStep', { amount: fmtUsd(prepared.order.collateralUsd) })}</p>}
                {prepared.simulation?.attempted && prepared.simulation.ok === false && <p className="notice notice-danger" style={{ margin: 0 }}>{t('futures.err.SIMULATION_FAILED')}</p>}
                <p className="faint" style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{prepared.executionId}</p>
              </div>
              <p className="notice notice-danger">{t('futures.confirmRisk')}</p>
              {error && <p className="notice notice-danger" data-testid="futures-confirm-error">{t(`futures.err.${error}`, { defaultValue: error })}</p>}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={() => { setConfirming(false); setPrepared(null); resetMachine(); }}>{t('common.cancel')}</button>
                <button className={`btn ${prepared.order.side === 'long' ? 'btn-success' : 'btn-danger'}`} style={{ flex: 1 }} disabled={busy || (prepared.simulation?.attempted && prepared.simulation.ok === false)} onClick={submit} data-testid="futures-confirm-submit">
                  {busy ? t('common.loading') : t('futures.confirmAndSign')}
                </button>
              </div>
            </div>
          )}
        </Sheet>

        {/* ── manage position sheet ─────────────────────────────────────── */}
        <Sheet open={Boolean(managing)} onClose={() => !busy && setManaging(null)} title={t('futures.manageTitle')}>
          {managing && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="card card-tight">
                <div className="row-between"><strong>{managing.symbol}</strong><span className={`pill ${managing.side === 'long' ? 'pill-up' : 'pill-down'}`}>{t(`futures.${managing.side}`)} · {managing.leverage}×</span></div>
                <div className="row-between" style={{ marginTop: 6 }}><span className="faint">{t('futures.entryMark')}</span><span className="mono">${fmtPrice(managing.entryPrice)} / {managing.markPrice != null ? `$${fmtPrice(managing.markPrice)}` : '—'}</span></div>
              </div>
              <div className="segmented" role="tablist" style={{ isolation: 'isolate' }}>
                {['tp', 'sl', 'increase', 'decrease', 'close'].map((a) => (
                  <button key={a} role="tab" aria-selected={manageAction === a} className={manageAction === a ? 'active' : ''} onClick={() => { setManageAction(a); setManageValue(a === 'close' ? '100' : a === 'decrease' ? '50' : a === 'increase' ? '10' : ''); }} style={{ isolation: 'isolate' }}>
                    {manageAction === a && <SegIndicator id="futures-manage" />}
                    {t(`futures.manage.${a}`)}
                  </button>
                ))}
              </div>
              <label>
                <span className="field-label">{t(`futures.manageField.${manageAction}`)}</span>
                <input type="number" min="0" inputMode="decimal" value={manageValue} onChange={(e) => setManageValue(e.target.value)} />
              </label>
              <p className="faint" style={{ margin: 0 }}>{t(`futures.manageHint.${manageAction}`)}</p>
              {error && <p className="notice notice-danger">{t(`futures.err.${error}`, { defaultValue: error })}</p>}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={() => setManaging(null)}>{t('common.cancel')}</button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !isBps(manageValue) || (Number(manageValue) <= 0 && manageAction !== 'tp' && manageAction !== 'sl')} onClick={submitManagement}>
                  {busy ? t('common.loading') : t('futures.confirmAndSign')}
                </button>
              </div>
            </div>
          )}
        </Sheet>
      </div>
    </PageTransition>
  );
}
