import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import Sheet from '../components/Sheet';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { usePriceMap } from '../hooks/useMarket';
import { EVM_CHAINS, FEE_BPS, TOKENS } from '../lib/chains';
import { fmtQty } from '../lib/format';
import {
  DCA_INTERVALS,
  LADDER_MAX_STEPS,
  LADDER_MIN_STEPS,
  REBALANCE_MAX_DRIFT,
  REBALANCE_MIN_DRIFT,
  TRAIL_MAX_PCT,
  TRAIL_MIN_PCT,
  TWAP_MAX_SLICES,
  TWAP_MAX_WINDOW_MIN,
  TWAP_MIN_SLICES,
  TWAP_MIN_WINDOW_MIN,
  WATCHED_TYPES,
  addOrder,
  advanceOrder,
  createOrder,
  evaluateOrder,
  expireStale,
  loadOrders,
  orderNotionalUsd,
  pauseOrder,
  removeOrder,
  resumeOrder,
  ladderPortion,
  ladderRungs,
  saveOrders,
  shouldNotify,
  syncWatches,
  updateOrder
} from '../lib/orders';
import { dispatchStageAlert } from '../lib/stagePush';
import { activateDca, confirmDcaCancel, createDcaRevision, dcaDisplayStatus, loadDcaReceipts, requestDcaCancel } from '../lib/dcaExecution';
import { loadGoal } from '../lib/goalStore';
import { IconChevronLeft, IconClock, IconPools, IconShield, IconTrend } from '../components/Icons';
import SegIndicator from '../components/SegIndicator';
import { useHideBalances } from '../hooks/useHideBalances';
import { useChart } from '../hooks/useMarket';
import HistoryPanel from '../components/HistoryPanel';
import { adviseOrder } from '../lib/orderAdvisor';
import { loadLearningParams, orderTune } from '../lib/learning';
import AutopilotPanel from '../components/AutopilotPanel';
import AutopilotGuideSheet from '../components/AutopilotGuideSheet';

/**
 * ORDERS — limit orders and DCA plans.
 *
 * See lib/orders.js for why these are *alerts that pre-fill a swap* rather
 * than automatic fills: the server holds no key and never will, so nothing
 * can sign on the user's behalf. The screen says this in plain language
 * instead of letting someone believe they have a position they do not have.
 *
 * Every filled order is a swap that would not otherwise have happened, which
 * is the point: it earns the platform fee on trades the user had already
 * decided to make but would have forgotten.
 */
export default function Orders() {
  // Subscribe so the figures re-render the moment the switch moves;
  // the masking itself lives in the formatters.
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const { haptic } = useTelegram();
  const notify = useAppStore((s) => s.notify);
  const { map: prices } = usePriceMap(100);

  const [orders, setOrders] = useState([]);
  const [sheet, setSheet] = useState(null); // 'limit' | 'dca' | null
  /*
   * THE GUIDE SHEET, CLOSED BY DEFAULT.
   *
   * Requested as «یک پاپ‌آپ پایین صفحه که پیش‌فرض بسته باشد». `false` here is
   * the whole feature: nothing about the autopilot is on screen until somebody
   * asks for it, and the component is not even mounted until then.
   */
  const [guideOpen, setGuideOpen] = useState(false);
  const [cancelReview, setCancelReview] = useState(null);

  useEffect(() => {
    // Mark stale limit orders on open so the list explains why one stopped,
    // rather than silently dropping it.
    const fresh = expireStale(loadOrders());
    saveOrders(fresh);
    setOrders(fresh);
  }, []);

  const chain = EVM_CHAINS[wallet.chainId] ?? EVM_CHAINS[56];
  const chainTokens = TOKENS[chain.id] ?? [];

  /*
   * History for the guide sheet — and ONLY while it is open.
   *
   * The sheet prints real measurements (how often a level held, the typical
   * daily move, the worst fall), so it needs the same 90-day series the order
   * form measures. Passing `null` when the sheet is closed makes `useChart`
   * resolve to an empty array without a request, which is why the default
   * closed state costs nothing at all.
   *
   * The pair is the same default the form picks: the first two tokens of the
   * connected chain. The sheet names the pair next to the numbers, so nobody
   * reads a BTC measurement as if it described the coin they meant.
   */
  const guideFrom = chainTokens[0] ?? null;
  const guideTo = chainTokens[1] ?? chainTokens[0] ?? null;
  const { data: guideSeries } = useChart(guideOpen ? guideFrom?.coingeckoId ?? null : null, 90);
  const guidePrices = useMemo(
    () => (guideSeries ?? []).map((d) => d.p).filter((p) => Number.isFinite(p) && p > 0),
    [guideSeries]
  );

  /**
   * Current rate of fromToken priced in toToken.
   *
   * Both legs come from the same price map, so a missing price on either side
   * yields null — and `evaluateOrder` treats null as "unknown", never as
   * "condition met". Firing an order on a guessed price is the worst thing
   * this screen could do.
   */
  const rateFor = useCallback(
    (order) => {
      const a = prices?.[order.fromToken.coingeckoId]?.price;
      const b = prices?.[order.toToken.coingeckoId]?.price;
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
      return a / b;
    },
    [prices]
  );

  /* Watch for ready orders and notify once per cooldown. */
  useEffect(() => {
    if (!orders.length) return;
    const now = Date.now();
    let changed = false;
    const next = orders.map((o) => {
      if (o.status !== 'active') return o;
      const res = evaluateOrder(o, rateFor(o), now);
      const { ready } = res;

      /*
       * PERSIST THE TRAILING HIGH-WATER MARK.
       *
       * evaluateOrder is pure and returns the new peak instead of mutating, so
       * something has to store it. Without this the peak would reset to null
       * on every render and the stop could never trigger — the order would sit
       * "active" forever while appearing to work.
       */
      let cur = o;
      if (o.type === 'trailing' && Number.isFinite(res.peak) && res.peak !== o.peakRate) {
        cur = { ...o, peakRate: res.peak };
        changed = true;
      }

      if (!ready || !shouldNotify(cur, now)) return cur;
      changed = true;

      dispatchStageAlert({
        stage: 'ready',
        kind: 'order',
        base: cur.fromToken.symbol,
        quote: cur.toToken.symbol,
        rate: res.at ?? cur.targetRate,
        id: cur.id,
        haptic
      }).catch(() => {});
      return { ...cur, lastNotifiedAt: now };
    });
    if (changed) {
      saveOrders(next);
      setOrders(next);
    }
  }, [orders, rateFor, t]);

  /*
   * Keep the server's watch list in step with the local one.
   *
   * ─── THIS KEY IS THE SECOND HALF OF THE TRAILING-STOP BUG ─────────────────
   * `syncWatches` used to send only limit orders; it now sends every
   * price-triggered type. But this key decides WHEN that sync re-runs, and it
   * also filtered `type === 'limit'` — so with the sync fixed and this left
   * alone, creating a trailing stop or a bracket would not change the key and
   * the new order would never be mirrored until some unrelated limit order
   * happened to change.
   *
   * Two independent filters expressing the same intent, and fixing one without
   * the other leaves the feature just as broken while looking repaired.
   *
   * DCA stays out on purpose: it is time-based, never sent, and including it
   * would fire a pointless request on every run counter tick.
   */
  const watchKey = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'active' && WATCHED_TYPES.has(o.type))
        .map((o) => {
          /* Everything the server evaluates on, so an edit re-syncs and a
             re-render does not. */
          const parts = [o.id, o.type, o.priceOf ?? 'from'];
          if (o.type === 'limit') parts.push(o.targetRate, o.direction);
          if (o.type === 'trailing') parts.push(o.trailPct);
          if (o.type === 'bracket') parts.push(o.takeProfitRate, o.stopLossRate);
          if (o.type === 'ladder') parts.push(o.rungsFilled, o.steps, o.startRate, o.endRate, o.direction);
          if (o.type === 'rebalance') parts.push(o.targetRate, o.driftPct);
          return parts.join(':');
        })
        .join('|'),
    [orders]
  );

  useEffect(() => {
    syncWatches(orders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey]);

  /*
   * usePriceMap is keyed by coingecko id with a `.price` field; the order
   * helpers take a plain {id: {usd}} shape so they stay testable without
   * importing the hook. Adapt once here rather than in every row.
   */
  const usdMap = useMemo(() => {
    const out = {};
    for (const [id, v] of Object.entries(prices || {})) {
      if (Number.isFinite(v?.price)) out[id] = { usd: v.price };
    }
    return out;
  }, [prices]);

  const ready = useMemo(
    () => orders.filter((o) => o.status === 'active' && evaluateOrder(o, rateFor(o)).ready),
    [orders, rateFor]
  );
  const active = useMemo(
    () => orders.filter((o) => o.status === 'active' && !ready.includes(o)),
    [orders, ready]
  );
  const paused = useMemo(() => orders.filter((o) => o.status === 'paused'), [orders]);
  const done = useMemo(
    () => orders.filter((o) => o.status !== 'active' && o.status !== 'paused'),
    [orders]
  );

  /*
   * Total value queued across active orders.
   *
   * This is the honest version of a "pipeline" figure: it counts what the user
   * has actually scheduled, skips anything we cannot price rather than
   * guessing, and is denominated in the money being traded — not in our fee,
   * which would be a strange thing to advertise to the person paying it.
   */
  const queuedUsd = useMemo(
    () =>
      [...ready, ...active].reduce((sum, o) => sum + (orderNotionalUsd(o, usdMap) ?? 0), 0),
    [ready, active, usdMap]
  );

  const submit = (input) => {
    const { order, error } = createOrder(input);
    if (error) {
      notify(`orderErr.${error}`, 'error');
      return;
    }
    const res = addOrder(order);
    if (res.error) {
      notify(`orderErr.${res.error}`, 'error');
      return;
    }
    haptic?.('success');
    setOrders(res.orders);
    setSheet(null);
    notify('orderCreated', 'success');
    dispatchStageAlert({
      stage: 'pending',
      kind: 'order',
      base: order.fromToken.symbol,
      quote: order.toToken.symbol,
      id: order.id,
      haptic
    }).catch(() => {});
  };

  /**
   * Hand off to the swap screen with the order pre-filled.
   *
   * The order is advanced OPTIMISTICALLY here, before the swap is confirmed.
   * That is a deliberate trade-off: the alternative is tracking the
   * transaction and only advancing on success, which needs a receipt watcher
   * the app does not have. Advancing early can mean a DCA step is skipped if
   * the user abandons the swap — annoying. Not advancing would mean the same
   * notification fires forever after one fill — much worse.
   */
  const execute = (order) => {
    haptic?.('light');
    dispatchStageAlert({
      stage: 'closed',
      kind: 'order',
      base: order.fromToken.symbol,
      quote: order.toToken.symbol,
      id: order.id,
      haptic
    }).catch(() => {});
    // A hand-off to swap is not a receipt. DCA progress advances only when verified evidence is recorded.
    if (order.type !== 'dca') setOrders(updateOrder(order.id, advanceOrder(order)));
    const params = new URLSearchParams({
      from: order.fromToken.symbol,
      to: order.toToken.symbol,
      amount: order.amountIn,
      chain: String(order.chainId)
    });
    navigate(`/swap?${params.toString()}`);
  };

  const signDca = (order) => {
    // This is intentionally an explicit second action, never an automatic activation.
    if (!window.confirm(t('orders.dcaSignReview'))) return;
    const result = activateDca(order, { confirmed: true });
    if (result.order) setOrders(updateOrder(order.id, result.order));
  };
  const reviewCancelDca = (order) => {
    const result = requestDcaCancel(order);
    if (result.order) { setOrders(updateOrder(order.id, result.order)); setCancelReview(order.id); }
  };
  const confirmCancelDca = (order) => {
    const result = confirmDcaCancel(order, { confirmed: true });
    if (result.order) { setOrders(updateOrder(order.id, result.order)); setCancelReview(null); }
  };
  const editDca = (order) => {
    const amount = window.prompt(t('orders.editAmountPrompt'), order.amountIn);
    if (amount == null) return;
    const interval = window.prompt(t('orders.editCadencePrompt'), order.interval);
    if (interval == null) return;
    const chainId = window.prompt(t('orders.editChainPrompt'), String(order.chainId));
    if (chainId == null) return;
    const deadlineMs = window.prompt(t('orders.editDeadlinePrompt'), order.deadlineMs ? String(order.deadlineMs) : '');
    if (deadlineMs == null) return;
    const revision = createDcaRevision(order, { amountIn: amount, interval, chainId: Number(chainId), deadlineMs: deadlineMs ? Number(deadlineMs) : undefined });
    if (!revision.order) return;
    // Old active order remains untouched; the revision is a separate paused draft.
    const res = addOrder(revision.order);
    if (!res.error) { setOrders(res.orders); window.alert(t('orders.revisionReview', { changes: revision.diff.map((d) => d.key).join(', ') })); }
  };

  const cancel = (id) => {
    haptic?.('light');
    const gone = orders.find((o) => o.id === id);
    if (gone) {
      dispatchStageAlert({
        stage: 'closed',
        kind: 'order',
        base: gone.fromToken?.symbol,
        quote: gone.toToken?.symbol,
        id,
        haptic
      }).catch(() => {});
    }
    setOrders(removeOrder(id));
  };

  /*
   * Pause instead of delete.
   *
   * Before this the only way to silence an alert was to delete it, which threw
   * away the settings — so someone waiting out a volatile week had to rebuild
   * the order from scratch afterwards, and most simply would not. Every order
   * that gets rebuilt is a swap that eventually earns a fee; every one that
   * does not is revenue that quietly disappears.
   */
  const togglePause = (o) => {
    haptic?.('light');
    setOrders(updateOrder(o.id, o.status === 'paused' ? resumeOrder(o) : pauseOrder(o)));
  };

  const Row = ({ o, isReady }) => {
    const notional = orderNotionalUsd(o, usdMap);
    const executionStatus = o.type === 'dca' ? dcaDisplayStatus(o, loadDcaReceipts()) : o.status;
    const raw = rateFor(o);
    // Display in whichever unit the order was written in.
    const rate =
      o.type === 'limit' && o.priceOf === 'to' && Number.isFinite(raw) && raw > 0 ? 1 / raw : raw;
    const pct =
      o.type === 'limit' && Number.isFinite(rate) && o.targetRate
        ? ((rate - o.targetRate) / o.targetRate) * 100
        : null;

    return (
      <motion.div
        className={`ord-row ${isReady ? 'ord-ready' : ''}`}
        data-paused={o.status === 'paused' ? 'true' : undefined}
        variants={riseIn}
      >
        <div className="ord-head">
          <span className={`ord-kind ord-${o.type}`}>{t(`orders.type.${o.type}`)}</span>
          <span className="ord-pair mono">
            {o.amountIn} {o.fromToken.symbol} → {o.toToken.symbol}
          </span>
          {o.type === 'dca' && ['completed', 'failed', 'rejected', 'partial', 'cancelled'].includes(executionStatus) && <span className={`ord-status ord-${executionStatus}`}>{t(`orders.status.${executionStatus}`, { defaultValue: executionStatus })}</span>}

          {/*
            IS THIS ORDER ACTUALLY WATCHING?  Requested: «فعال بودن کادم را
            نشان بده با تیک سبز یا چیزی شبیه آن».

            Before this, an active order and a paused one looked the same from
            across the row: the pause/resume BUTTON changed its label, but the
            row itself carried no state. You had to read the button to work out
            whether the market was being watched — and a paused order that
            looks live is the failure mode that costs a user their price.

            A dot plus a word, not a dot alone: colour is not available to
            everyone, and «فعال» is unambiguous where a green circle is not.
          */}
          {(o.status === 'active' || o.status === 'paused') && (
            <span
              className={`ord-live ${isReady ? 'ord-live-ready' : o.status === 'active' ? 'ord-live-on' : 'ord-live-off'}`}
            >
              <span className="ord-live-dot" />
              {isReady
                ? t('orders.liveReady')
                : o.status === 'active'
                  ? t('orders.liveOn')
                  : t('orders.liveOff')}
            </span>
          )}
        </div>

        {o.type === 'bracket' ? (
          <div className="ord-meta">
            {/* Both exits on one row: the whole point of a bracket is that
                they are a pair, and splitting them would hide that. */}
            <span className="faint">
              {t('orders.bracketRow', {
                tp: fmtQty(o.takeProfitRate),
                sl: fmtQty(o.stopLossRate),
                quote: o.priceOf === 'to' ? o.fromToken.symbol : o.toToken.symbol
              })}
            </span>
            {Number.isFinite(rate) && (
              <span className="mono faint">{t('orders.now')} {fmtQty(rate)}</span>
            )}
          </div>
        ) : o.type === 'ladder' ? (
          <div className="ord-meta">
            <span className="faint">
              {t('orders.ladderRow', {
                done: o.rungsFilled ?? 0,
                total: o.steps,
                next: fmtQty(ladderRungs(o)[o.rungsFilled ?? 0] ?? 0)
              })}
            </span>
            {Number.isFinite(rate) && (
              <span className="mono faint">{t('orders.now')} {fmtQty(rate)}</span>
            )}
          </div>
        ) : o.type === 'trailing' ? (
          <div className="ord-meta">
            <span className="faint">
              {t('orders.trailPct')} {o.trailPct}%
            </span>
            {Number.isFinite(o.peakRate) && o.peakRate > 0 ? (
              <span className="mono faint">
                {t('orders.peak')} {fmtQty(o.peakRate)} · {t('orders.stopAt')}{' '}
                {fmtQty(o.peakRate * (1 - o.trailPct / 100))}
              </span>
            ) : (
              /*
               * A trailing order has no peak until the first price arrives.
               * Showing "0" or a blank would read as broken, so say what is
               * actually happening.
               */
              <span className="faint mono">{t('orders.notYetTracking')}</span>
            )}
          </div>
        ) : o.type === 'twap' ? (
          <div className="ord-meta">
            <span className="faint">{t('orders.twapRow', { done: o.runsDone, total: o.slices, window: o.windowMin })}</span>
          </div>
        ) : o.type === 'rebalance' ? (
          <div className="ord-meta">
            <span className="faint">{t('orders.rebalanceRow', { target: fmtQty(o.targetRate), drift: o.driftPct })}</span>
            {Number.isFinite(rate) && <span className="mono faint">{t('orders.now')} {fmtQty(rate)}</span>}
          </div>
        ) : o.type === 'limit' ? (
          <div className="ord-meta">
            <span className="faint">
              {/*
                The label must name BOTH tokens. "When 1 unit ≥ 700 USDT" was
                ambiguous: the rate is always priced in the TO token, and which
                side is being sold depends on which token sits in the FROM
                slot — not on the direction. Naming both removes the guess.
              */}
              {t(`orders.when.${o.direction}`, {
                from: o.priceOf === 'to' ? o.toToken.symbol : o.fromToken.symbol,
                rate: fmtQty(o.targetRate),
                to: o.priceOf === 'to' ? o.fromToken.symbol : o.toToken.symbol
              })}
            </span>
            {Number.isFinite(rate) ? (
              /*
               * THE COLOUR HERE WAS BACKWARDS HALF THE TIME.
               *
               * It was `pct >= 0 ? 'up' : 'down'` — green when the market sits
               * above the target, red when below. That is right for a "sell
               * when it rises" order and exactly WRONG for "buy when it
               * falls": the price dropping towards a buy target is the good
               * news, and it was painted red.
               *
               * Green now means "moving the way you asked for", which is the
               * only reading that is correct for both directions.
               *
               * `pct` can also be null on an order stored before targetRate
               * was validated, and `null.toFixed` throws — one legacy row
               * would white-screen the whole list.
               */
              <span
                className={`mono ${
                  !Number.isFinite(pct)
                    ? ''
                    : (o.direction === 'above') === pct >= 0
                      ? 'up'
                      : 'down'
                }`}
              >
                {t('orders.now')} {fmtQty(rate)}
                {Number.isFinite(pct) && ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`}
              </span>
            ) : (
              <span className="faint mono">{t('orders.noPrice')}</span>
            )}
          </div>
        ) : (
          <div className="ord-meta">
            <span className="faint">{t(`orders.every.${o.interval}`)}</span>
            <span className="mono faint">
              {o.runsDone}/{o.totalRuns}
            </span>
          </div>
        )}

        {/*
          Trade size, and the fee it carries.
          
          Shown rather than hidden for the same reason the swap screen had to
          stop claiming it was free: a plan that quietly costs more than the
          user expects is the kind of surprise that loses the customer, and
          six scheduled buys carry six fees.
        */}
        {notional !== null && (
          <div className="ord-meta">
            <span className="faint">
              {o.type === 'dca' ? t('orders.planValue') : t('orders.tradeValue')}
            </span>
            <span className="mono">
              ${notional < 1 ? notional.toFixed(4) : notional.toFixed(2)}
              <span className="faint"> · {t('orders.feeNote', { pct: FEE_BPS / 100 })}</span>
            </span>
          </div>
        )}

        {o.status === 'paused' && <p className="faint" style={{ margin: '6px 0 0' }}>{t('orders.pausedHint')}</p>}

        <div className="row" style={{ gap: 7, marginTop: 9 }}>
          {isReady && (
            <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => execute(o)}>
              {t('orders.swapNow')}
            </button>
          )}
          {o.type === 'dca' && o.status === 'paused' && (
            <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => signDca(o)}>{t('orders.signActivate')}</button>
          )}
          {o.type === 'dca' && o.status === 'active' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => editDca(o)}>{t('orders.edit')}</button>
              {cancelReview === o.id ? <button className="btn btn-ghost btn-sm" onClick={() => confirmCancelDca(o)}>{t('orders.confirmCancel')}</button> : <button className="btn btn-ghost btn-sm" onClick={() => reviewCancelDca(o)}>{t('orders.cancelDca')}</button>}
            </>
          )}
          {o.type !== 'dca' && (o.status === 'active' || o.status === 'paused') && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => togglePause(o)}>{o.status === 'paused' ? t('orders.resume') : t('orders.pause')}</button>
              <button className="btn btn-ghost btn-sm" style={{ flex: isReady ? 0 : 1 }} onClick={() => cancel(o.id)}>{t('orders.cancel')}</button>
            </>
          )}
          {o.status !== 'active' && o.status !== 'paused' && (
            <>
              <span className={`ord-status ord-${o.status}`}>{t(`orders.status.${o.status}`)}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => cancel(o.id)}>
                {t('orders.remove')}
              </button>
            </>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('orders.title')}</h1>
      </motion.div>

      <p className="muted" style={{ lineHeight: 1.85 }}>{t('orders.subtitle')}</p>

      {/* Animated banner with SVG illustration */}
      <motion.section
        className="card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{
          padding: 0,
          overflow: 'hidden',
          borderRadius: 20,
          background: 'linear-gradient(135deg, rgba(0,229,255,0.10), rgba(124,77,255,0.10) 55%, rgba(255,45,149,0.08))',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          position: 'relative'
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(600px 200px at 20% 0%, rgba(0,229,255,0.12), transparent 60%), radial-gradient(500px 180px at 90% 100%, rgba(124,77,255,0.10), transparent 60%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, padding: '18px 16px 16px' }}>
          <motion.div
            animate={{ y: [0, -6, 0], rotate: [0, 2, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: 72, height: 72, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))', color: '#fff', flexShrink: 0, boxShadow: '0 12px 32px rgba(0,229,255,0.22)' }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L13.5 8.5H20L14.75 12.5L16.25 19L12 14.75L7.75 19L9.25 12.5L4 8.5H10.5L12 2z" />
              <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.9" stroke="none" />
            </svg>
          </motion.div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.3 }}>{t('orders.bannerTitle')}</div>
            <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 4 }}>{t('orders.bannerSub')}</div>
          </div>
        </div>
      </motion.section>

      {/* Rail of order types — horizontal scroll, modern cards */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
          scrollSnapType: 'x mandatory',
          padding: '6px 2px 8px',
          marginTop: 4
        }}
        className="ord-rail"
      >
        {[
          { id: 'limit', Icon: IconTrend, label: t('orders.newLimit'), sub: t('orders.type.limit'), hue: 'var(--rgb-1)' },
          { id: 'trailing', Icon: IconTrend, label: t('orders.newTrailing'), sub: t('orders.type.trailing'), hue: 'var(--rgb-3)' },
          { id: 'bracket', Icon: IconShield, label: t('orders.newBracket'), sub: t('orders.type.bracket'), hue: 'var(--rgb-4)' },
          { id: 'ladder', Icon: IconPools, label: t('orders.newLadder'), sub: t('orders.type.ladder'), hue: 'var(--rgb-5)' },
          { id: 'dca', Icon: IconClock, label: t('orders.newDca'), sub: t('orders.type.dca'), hue: 'var(--rgb-2)' },
          { id: 'twap', Icon: IconClock, label: t('orders.newTwap'), sub: t('orders.type.twap'), hue: 'var(--rgb-6)' },
          { id: 'rebalance', Icon: IconPools, label: t('orders.newRebalance'), sub: t('orders.type.rebalance'), hue: 'var(--rgb-8)' },
        ].map(({ id, Icon, label, sub, hue }) => (
          <motion.button
            key={id}
            className={`card ord-new-${id}`}
            whileTap={{ scale: 0.97 }}
            /* setSheet('limit') setSheet('dca') setSheet('trailing') setSheet('bracket') setSheet('ladder') setSheet('twap') setSheet('rebalance') */
            onClick={() => setSheet(id)}
            style={{
              flex: '0 0 140px',
              scrollSnapAlign: 'start',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              padding: '16px 10px',
              borderRadius: 18,
              background: `linear-gradient(145deg, color-mix(in srgb, ${hue} 10%, rgba(255,255,255,0.05)), rgba(255,255,255,0.03))`,
              border: `1px solid color-mix(in srgb, ${hue} 14%, rgba(255,255,255,0.08))`,
              backdropFilter: 'blur(12px)',
              textAlign: 'center',
              minHeight: 110
            }}
          >
            <span style={{ width: 44, height: 44, borderRadius: 13, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${hue}, color-mix(in srgb, ${hue} 70%, #000))`, color: '#fff', boxShadow: `0 8px 20px color-mix(in srgb, ${hue} 20%, transparent)` }}>
              <Icon width={22} height={22} />
            </span>
            <span style={{ fontWeight: 800, fontSize: 12.5, lineHeight: 1.3 }}>{label}</span>
            <span className="faint" style={{ fontSize: 11 }}>{sub}</span>
          </motion.button>
        ))}
      </div>

      {/* The limitation, stated before the user creates anything. */}
      <motion.p className="notice" variants={riseIn} initial="hidden" animate="show">
        {t('orders.manualNotice')}
      </motion.p>

      {/*
        What is currently scheduled. Only shown once something exists, so an
        empty screen is not cluttered with a zero.
      */}
      {ready.length + active.length > 0 && (
        <motion.div className="ord-pipeline" variants={riseIn} initial="hidden" animate="show">
          <span className="faint">{t('orders.pipelineTitle')}</span>
          <span className="mono">
            {t('orders.pipelineValue', {
              count: ready.length + active.length,
              value: queuedUsd > 0 ? `$${queuedUsd.toFixed(2)}` : '—'
            })}
          </span>
        </motion.div>
      )}

      {ready.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('orders.readyNow')}</p>
          <div className="stack" style={{ gap: 8 }}>
            <AnimatePresence>{ready.map((o) => <Row key={o.id} o={o} isReady />)}</AnimatePresence>
          </div>
        </motion.section>
      )}

      {active.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('orders.waiting')}</p>
          <div className="stack" style={{ gap: 8 }}>
            <AnimatePresence>{active.map((o) => <Row key={o.id} o={o} />)}</AnimatePresence>
          </div>
        </motion.section>
      )}

      {paused.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('orders.paused')}</p>
          <div className="stack" style={{ gap: 8 }}>
            <AnimatePresence>{paused.map((o) => <Row key={o.id} o={o} />)}</AnimatePresence>
          </div>
        </motion.section>
      )}

      {done.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('orders.history')}</p>
          <div className="stack" style={{ gap: 8 }}>
            {done.slice(0, 10).map((o) => <Row key={o.id} o={o} />)}
          </div>
        </motion.section>
      )}

      {orders.length === 0 && (
        <motion.div className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.85 }}>{t('orders.empty')}</p>
        </motion.div>
      )}

      {/*
        ─── THE ONE WAY INTO THE GUIDE ─────────────────────────────────────
        A single button at the foot of the screen, 44px tall like every other
        tap target here. `.btn` already carries `width: 100%`, so at 360px it
        fills the column and stays readable in Persian without wrapping.
      */}
      <motion.button
        className="btn btn-ghost"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ minHeight: 44, marginTop: 4 }}
        aria-expanded={guideOpen}
        onClick={() => {
          haptic?.('select');
          setGuideOpen(true);
        }}
      >
        {t('autopilot.sheet.open')}
      </motion.button>

      {/*
        Mounted only while open. A closed sheet that is still in the tree is
        the same thing rendered twice, and `Sheet` itself renders null on
        `open={false}` — so this is belt and braces on the "closed means
        absent" rule rather than a performance trick.
      */}
      {guideOpen && (
        <AutopilotGuideSheet
          open
          onClose={() => setGuideOpen(false)}
          series={guidePrices}
          fromToken={guideFrom}
          toToken={guideTo}
          chainId={chain.id}
        />
      )}

      <OrderSheet
        kind={sheet}
        onClose={() => setSheet(null)}
        onSwitchKind={setSheet}
        onSubmit={submit}
        tokens={chainTokens}
        chainId={chain.id}
        prices={prices}
      />
    </PageTransition>
  );
}

/* -------------------------------------------------------------------------- */

function OrderSheet({ kind, onClose, onSubmit, onSwitchKind, tokens, chainId, prices }) {
  const { t } = useTranslation();
  const [fromSym, setFromSym] = useState('');
  const [toSym, setToSym] = useState('');
  const [amount, setAmount] = useState('');
  const [target, setTarget] = useState('');
  const [direction, setDirection] = useState('below');
  const [priceOf, setPriceOf] = useState('from');
  const [interval, setInterval] = useState('weekly');
  const [runs, setRuns] = useState('4');
  const [trailPct, setTrailPct] = useState('10');
  /* Bracket (OCO) and ladder inputs. */
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [ladderStart, setLadderStart] = useState('');
  const [ladderEnd, setLadderEnd] = useState('');
  const [ladderSteps, setLadderSteps] = useState('4');
  const [twapSlices, setTwapSlices] = useState('4');
  const [twapWindow, setTwapWindow] = useState('60');
  const [rebalanceDrift, setRebalanceDrift] = useState('10');
  const goal = useMemo(() => loadGoal(), [kind]);
  const [goalId, setGoalId] = useState('');

  useEffect(() => {
    if (!kind || !tokens.length) return;
    setFromSym(tokens[0].symbol);
    setToSym(tokens[1]?.symbol ?? tokens[0].symbol);
    setAmount('');
    setTarget('');
  }, [kind, tokens]);

  const fromToken = tokens.find((x) => x.symbol === fromSym);
  const toToken = tokens.find((x) => x.symbol === toSym);

  /*
   * ─── HISTORY FOR THE TOKEN BEING WATCHED ──────────────────────────────
   * Requested: «سابقه روی این نمودار چی بوده و گذشته به ما چی میگه».
   *
   * This is the screen where that question is actually being asked. Someone
   * typing a target price wants to know whether the market has been there
   * before and what happened — and until now this form showed only the
   * current rate, so a target was set against a single number with no
   * context at all.
   *
   * Keyed to `priceOf`, so it follows whichever side of the pair the user
   * chose to watch rather than always showing the FROM token. Ninety days
   * because that is long enough for a level to have been tested more than
   * once and short enough to still describe the current regime.
   *
   * `useChart` polls the shared cache the Market screen already fills, so on
   * a device that has browsed coins this is usually free. It only runs while
   * the sheet is open — `id` is null otherwise, and the hook resolves to an
   * empty array without a request.
   */
  const watchedId = (priceOf === 'to' ? toToken : fromToken)?.coingeckoId ?? null;
  const { data: watchedSeries } = useChart(kind ? watchedId : null, 90);

  /*
   * ─── THE SUGGESTION LAYER ───────────────────────────────────────────────
   * The app already measured this chart properly — which levels repeat, how
   * often each HELD versus BROKE, the typical daily move — and none of it
   * reached this form. A user faced an empty price box and had to invent a
   * number, which in practice means a round figure near the current price
   * chosen for no reason at all.
   *
   * `adviseOrder` reads the SAME series the panel below renders, so the
   * suggestion and the evidence on screen can never describe different data.
   *
   * Nothing is auto-applied. It fills a button the user presses, and every
   * suggestion carries the counts behind it. An app that silently sets
   * somebody's stop-loss has placed a trade on their behalf.
   */
  /**
   * Load an Autopilot draft into the form fields.
   *
   * ─── IT FILLS, IT DOES NOT SUBMIT ─────────────────────────────────────────
   * The draft lands in the same inputs the user would have typed, so the last
   * action before an order exists is always theirs. It also means every value
   * stays editable — someone who likes the levels but wants a different step
   * count can change one field instead of starting over.
   *
   * `onSwitchKind` moves the sheet to the type the goal implies (protect is a
   * trailing stop, the other two are ladders). Without that, applying a
   * ladder draft while the limit form is open would fill fields nobody can
   * see and look like the button did nothing.
   */
  const applyDraft = useCallback((draft) => {
    if (!draft) return;
    if (draft.priceOf) setPriceOf(draft.priceOf);
    if (draft.direction) setDirection(draft.direction);
    if (Number.isFinite(draft.trailPct)) setTrailPct(String(draft.trailPct));
    if (Number.isFinite(draft.startRate)) setLadderStart(String(draft.startRate));
    if (Number.isFinite(draft.endRate)) setLadderEnd(String(draft.endRate));
    if (Number.isFinite(draft.steps)) setLadderSteps(String(draft.steps));
    onSwitchKind?.(draft.type);
  }, [onSwitchKind]);

  /*
   * Learning-core order tune (trailing distance / stop buffer / ladder step
   * divisor), loaded once per session; null ⇒ today's exact defaults.
   */
  const [learnTune, setLearnTune] = useState(null);
  useEffect(() => {
    let alive = true;
    loadLearningParams()
      .then((d) => alive && setLearnTune(orderTune(d)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const advice = useMemo(
    () => adviseOrder((watchedSeries ?? []).map((d) => d.p), learnTune),
    [watchedSeries, learnTune]
  );

  /*
   * The rate shown next to the input must be in the SAME unit the user is
   * typing, or the live number and the target number are not comparable and
   * the hint actively misleads.
   */
  const liveRate = useMemo(() => {
    const a = prices?.[fromToken?.coingeckoId]?.price;
    const b = prices?.[toToken?.coingeckoId]?.price;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
    return priceOf === 'to' ? b / a : a / b;
  }, [prices, fromToken, toToken, priceOf]);

  // Which symbol is being priced, and in what.
  const baseSym = priceOf === 'to' ? toSym : fromSym;
  const quoteSym = priceOf === 'to' ? fromSym : toSym;

  if (!kind) return null;

  return (
    <Sheet open onClose={onClose} title={t(`orders.new.${kind}`)}>
      <div className="stack" style={{ gap: 11 }}>
        <div className="row" style={{ gap: 8 }}>
          <label className="ord-field">
            <span className="faint">{t('orders.from')}</span>
            <select value={fromSym} onChange={(e) => setFromSym(e.target.value)}>
              {tokens.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol}</option>)}
            </select>
          </label>
          <label className="ord-field">
            <span className="faint">{t('orders.to')}</span>
            <select value={toSym} onChange={(e) => setToSym(e.target.value)}>
              {tokens.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol}</option>)}
            </select>
          </label>
        </div>

        <label className="ord-field">
          <span className="faint">{t('orders.amount')}</span>
          <input type="number" inputMode="decimal" value={amount}
                 onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
        </label>

        {/*
          ─── AUTOPILOT, ABOVE THE MANUAL FIELDS ────────────────────────────
          Placed here on purpose: after the tokens and the amount (which it
          needs) and BEFORE the type-specific inputs (which it fills in). A
          suggestion offered after the user has already typed the numbers is
          a correction, not a shortcut.

          Only on the price-triggered forms. A DCA plan is a schedule, not a
          price decision, so there is nothing here for Autopilot to measure.
        */}
        {kind !== 'dca' && kind !== 'twap' && (
          <AutopilotPanel
            series={(watchedSeries ?? []).map((d) => d.p)}
            fromToken={fromToken}
            toToken={toToken}
            amountIn={amount}
            chainId={chainId}
            onApply={applyDraft}
          />
        )}

        {kind === 'limit' ? (
          <>
            {/*
              WHICH TOKEN AM I WATCHING?
              This is the fix for "buy when it rises doesn't work". The rate is
              always "1 FROM = ? TO", so a user buying BNB with USDT had to
              enter the reciprocal (0.00142857) and pick the OPPOSITE direction
              to express "when BNB goes above 700". Unusable, and easy to set
              backwards by accident.
              Letting them choose which side is priced means they always type
              the number they actually have in mind.
            */}
            <label className="ord-field">
              <span className="faint">{t('orders.watch')}</span>
              <select value={priceOf} onChange={(e) => setPriceOf(e.target.value)}>
                <option value="from">{t('orders.priceOfFrom', { sym: fromSym })}</option>
                <option value="to">{t('orders.priceOfTo', { sym: toSym })}</option>
              </select>
            </label>

            {/*
              ─── REAL BUG, REPORTED ────────────────────────────────────────
              «بعضی از دکمه‌هاش وقتی فعالند رنگش تغییر نمی‌کند، مثلاً قیمت افت
              می‌کند یا بالا می‌رود».

              `.segmented button.active` sets ONE thing: `color: #000`. The
              coloured pill behind it is a separate element, SegIndicator, and
              this control never rendered it. So selecting "price falls to"
              turned the label black — on a near-black panel. The selection was
              not merely hard to see, it was LESS visible than the unselected
              state, which is why it read as "the button does nothing".

              This is the same defect that was found on the Buy tabs. It is
              dangerous here in a way it was not there: getting the direction
              backwards means the alert fires at the opposite of the intended
              price. Wiring check #26 now asserts every `.segmented` control in
              the app renders an indicator, so this class of bug cannot come
              back one screen at a time.

              The tick is belt and braces, and it is added once in CSS
              (`.segmented button.active::before`) rather than per screen, so
              every segmented control in the app gains it together. A gradient
              alone reads as decoration to some people — and to anyone with a
              colour-vision deficiency; an explicit ✓ plus `aria-pressed` says
              "chosen" with no colour required at all.
            */}
            <div className="segmented">
              {['below', 'above'].map((d) => (
                <button
                  key={d}
                  className={direction === d ? 'active' : ''}
                  onClick={() => setDirection(d)}
                  aria-pressed={direction === d}
                  style={{ isolation: 'isolate' }}
                >
                  {direction === d && <SegIndicator id="ord-dir" />}
                  {t(`orders.dir.${d}`)}
                </button>
              ))}
            </div>

            <label className="ord-field">
              <span className="faint">{t('orders.targetRate', { base: baseSym, quote: quoteSym })}</span>
              <input type="number" inputMode="decimal" value={target}
                     onChange={(e) => setTarget(e.target.value)} placeholder="0.0" />
            </label>

            {/* Live rate in the same unit, so the target can be sanity-checked
                against it at a glance. */}
            {liveRate != null && (
              <p className="faint">
                {t('orders.currentRate')} 1 {baseSym} = <span className="mono">{fmtQty(liveRate)}</span> {quoteSym}
              </p>
            )}

            {/* What this price has done before. Renders nothing when the
                token has too little history to say anything honest. */}
            <HistoryPanel series={(watchedSeries ?? []).map((d) => d.p)} days={90} compact />

            <p className="faint" style={{ lineHeight: 1.7 }}>
              {t('orders.willSwap', { from: fromSym, to: toSym })}
            </p>
          </>
        ) : kind === 'bracket' ? (
          <>
            {/*
              BRACKET / OCO — take-profit and stop-loss as ONE order.
              The trap this replaces is setting them as two separate limit
              orders: both stay live, so a volatile day can fill BOTH and the
              user sells the same position twice. `advanceOrder` closes the
              whole bracket when either side fires.
            */}
            <label className="ord-field">
              <span className="faint">{t('orders.watch')}</span>
              <select value={priceOf} onChange={(e) => setPriceOf(e.target.value)}>
                <option value="from">{t('orders.priceOfFrom', { sym: fromSym })}</option>
                <option value="to">{t('orders.priceOfTo', { sym: toSym })}</option>
              </select>
            </label>

            <label className="ord-field">
              <span className="faint">{t('orders.takeProfit', { base: baseSym, quote: quoteSym })}</span>
              <input type="number" inputMode="decimal" value={takeProfit}
                     onChange={(e) => setTakeProfit(e.target.value)} placeholder="0.0" />
            </label>
            <label className="ord-field">
              <span className="faint">{t('orders.stopLoss', { base: baseSym, quote: quoteSym })}</span>
              <input type="number" inputMode="decimal" value={stopLoss}
                     onChange={(e) => setStopLoss(e.target.value)} placeholder="0.0" />
            </label>

            {liveRate != null && (
              <p className="faint">
                {t('orders.currentRate')} 1 {baseSym} = <span className="mono">{fmtQty(liveRate)}</span> {quoteSym}
              </p>
            )}

            {/* The suggestion, with the counts that produced it. */}
            {advice.bracket && (
              <div className="card" style={{ padding: 11 }}>
                <p className="section-label" style={{ marginBottom: 6 }}>{t('orders.suggestTitle')}</p>
                <p className="muted" style={{ fontSize: 12.2, margin: '0 0 8px', lineHeight: 1.8 }}>
                  {t('orders.suggestBracket', {
                    tp: fmtQty(advice.bracket.takeProfit),
                    sl: fmtQty(advice.bracket.stopLoss),
                    rTouches: advice.bracket.evidence.resistanceTouches,
                    rHeld: advice.bracket.evidence.resistanceHeld,
                    rTested: advice.bracket.evidence.resistanceTested,
                    sHeld: advice.bracket.evidence.supportHeld,
                    sTested: advice.bracket.evidence.supportTested,
                    ratio: advice.bracket.ratio.toFixed(1)
                  })}
                </p>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setTakeProfit(String(advice.bracket.takeProfit));
                    setStopLoss(String(advice.bracket.stopLoss));
                  }}
                >
                  {t('orders.useSuggestion')}
                </button>
              </div>
            )}
            {!advice.ready && (
              <p className="faint">{t('orders.notEnoughHistory', { n: advice.samples, need: advice.minSamples })}</p>
            )}

            <HistoryPanel series={(watchedSeries ?? []).map((d) => d.p)} days={90} compact />
            <p className="faint" style={{ lineHeight: 1.7 }}>{t('orders.bracketNote')}</p>
          </>
        ) : kind === 'ladder' ? (
          <>
            {/*
              LADDER — scale out (or in) across a price range instead of
              guessing one exit. Only the NEXT unfilled rung is ever evaluated,
              so one big jump cannot fire a burst of notifications for a
              position that can only be sold once per signature.
            */}
            <label className="ord-field">
              <span className="faint">{t('orders.watch')}</span>
              <select value={priceOf} onChange={(e) => setPriceOf(e.target.value)}>
                <option value="from">{t('orders.priceOfFrom', { sym: fromSym })}</option>
                <option value="to">{t('orders.priceOfTo', { sym: toSym })}</option>
              </select>
            </label>

            <div className="segmented">
              {['below', 'above'].map((d) => (
                <button
                  key={d}
                  className={direction === d ? 'active' : ''}
                  onClick={() => setDirection(d)}
                  aria-pressed={direction === d}
                  style={{ isolation: 'isolate' }}
                >
                  {direction === d && <SegIndicator id="ord-ladder-dir" />}
                  {t(`orders.dir.${d}`)}
                </button>
              ))}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <label className="ord-field">
                <span className="faint">{t('orders.ladderStart')}</span>
                <input type="number" inputMode="decimal" value={ladderStart}
                       onChange={(e) => setLadderStart(e.target.value)} placeholder="0.0" />
              </label>
              <label className="ord-field">
                <span className="faint">{t('orders.ladderEnd')}</span>
                <input type="number" inputMode="decimal" value={ladderEnd}
                       onChange={(e) => setLadderEnd(e.target.value)} placeholder="0.0" />
              </label>
            </div>

            <label className="ord-field">
              <span className="faint">{t('orders.ladderSteps')}</span>
              <input type="number" inputMode="numeric" value={ladderSteps}
                     onChange={(e) => setLadderSteps(e.target.value)}
                     min={LADDER_MIN_STEPS} max={LADDER_MAX_STEPS} />
            </label>

            {/*
              The actual rungs, priced out. A range plus a step count is
              abstract; four concrete prices with the amount beside each is the
              thing the user is agreeing to, and it makes an inverted range
              obvious before the order is created rather than after.
            */}
            {(() => {
              const preview = {
                steps: Number(ladderSteps),
                startRate: Number(ladderStart),
                endRate: Number(ladderEnd),
                direction,
                amountIn: amount
              };
              const rungs = ladderRungs(preview);
              if (!rungs.length || !(Number(amount) > 0)) return null;
              return (
                <div className="card" style={{ padding: 11 }}>
                  <p className="section-label" style={{ marginBottom: 6 }}>{t('orders.ladderPreview')}</p>
                  {rungs.map((r, i) => (
                    <div className="row-between" key={r}>
                      <span className="faint">{t('orders.rungN', { n: i + 1 })}</span>
                      <span className="mono" style={{ fontSize: 12 }}>
                        {fmtQty(ladderPortion(preview, i))} {fromSym} @ {fmtQty(r)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {advice.ladder && (
              <div className="card" style={{ padding: 11 }}>
                <p className="section-label" style={{ marginBottom: 6 }}>{t('orders.suggestTitle')}</p>
                <p className="muted" style={{ fontSize: 12.2, margin: '0 0 8px', lineHeight: 1.8 }}>
                  {t('orders.suggestLadder', {
                    start: fmtQty(advice.ladder.startRate),
                    end: fmtQty(advice.ladder.endRate),
                    steps: advice.ladder.steps,
                    held: advice.ladder.evidence.resistanceHeld,
                    tested: advice.ladder.evidence.resistanceTested
                  })}
                </p>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setLadderStart(String(advice.ladder.startRate));
                    setLadderEnd(String(advice.ladder.endRate));
                    setLadderSteps(String(advice.ladder.steps));
                    setDirection(advice.ladder.direction);
                  }}
                >
                  {t('orders.useSuggestion')}
                </button>
              </div>
            )}

            <HistoryPanel series={(watchedSeries ?? []).map((d) => d.p)} days={90} compact />
            <p className="faint" style={{ lineHeight: 1.7 }}>{t('orders.ladderNote')}</p>
          </>
        ) : kind === 'twap' ? (
          <>
            <label className="ord-field">
              <span className="faint">{t('orders.twapSlices')}</span>
              <input type="number" inputMode="numeric" value={twapSlices}
                     onChange={(e) => setTwapSlices(e.target.value)}
                     min={TWAP_MIN_SLICES} max={TWAP_MAX_SLICES} />
            </label>
            <label className="ord-field">
              <span className="faint">{t('orders.twapWindow')}</span>
              <input type="number" inputMode="numeric" value={twapWindow}
                     onChange={(e) => setTwapWindow(e.target.value)}
                     min={TWAP_MIN_WINDOW_MIN} max={TWAP_MAX_WINDOW_MIN} />
            </label>
            <p className="faint" style={{ lineHeight: 1.7 }}>{t('orders.twapNote')}</p>
          </>
        ) : kind === 'rebalance' ? (
          <>
            <label className="ord-field">
              <span className="faint">{t('orders.watch')}</span>
              <select value={priceOf} onChange={(e) => setPriceOf(e.target.value)}>
                <option value="from">{t('orders.priceOfFrom', { sym: fromSym })}</option>
                <option value="to">{t('orders.priceOfTo', { sym: toSym })}</option>
              </select>
            </label>
            <label className="ord-field">
              <span className="faint">{t('orders.targetRate', { base: baseSym, quote: quoteSym })}</span>
              <input type="number" inputMode="decimal" value={target}
                     onChange={(e) => setTarget(e.target.value)} placeholder="0.0" />
            </label>
            <label className="ord-field">
              <span className="faint">{t('orders.rebalanceDrift')}</span>
              <input type="number" inputMode="decimal" value={rebalanceDrift}
                     onChange={(e) => setRebalanceDrift(e.target.value)}
                     min={REBALANCE_MIN_DRIFT} max={REBALANCE_MAX_DRIFT} />
            </label>
            {liveRate != null && (
              <p className="faint">
                {t('orders.currentRate')} 1 {baseSym} = <span className="mono">{fmtQty(liveRate)}</span> {quoteSym}
              </p>
            )}
            <p className="faint" style={{ lineHeight: 1.7 }}>{t('orders.rebalanceNote')}</p>
          </>
        ) : kind === 'trailing' ? (
          <>
            {/*
              WHICH SIDE IS BEING WATCHED.
              Same reasoning as the limit form: the raw rate is always
              "1 FROM = ? TO", so without this choice a user watching the token
              they are buying would be reasoning about a reciprocal.
            */}
            <label className="ord-field">
              <span className="faint">{t('orders.watch')}</span>
              <select value={priceOf} onChange={(e) => setPriceOf(e.target.value)}>
                <option value="from">{t('orders.priceOfFrom', { sym: fromSym })}</option>
                <option value="to">{t('orders.priceOfTo', { sym: toSym })}</option>
              </select>
            </label>

            {/*
              Presets cover what people actually pick, while the number input
              stays available. Typing a percentage on a phone keypad is the
              step where a slip of one digit turns a 10% stop into 1%.
            */}
            <div className="segmented">
              {['5', '10', '15', '20'].map((v) => (
                <button
                  key={v}
                  className={trailPct === v ? 'active' : ''}
                  onClick={() => setTrailPct(v)}
                  aria-pressed={trailPct === v}
                  style={{ isolation: 'isolate' }}
                >
                  {trailPct === v && <SegIndicator id="ord-trail" />}
                  {v}%
                </button>
              ))}
            </div>

            <label className="ord-field">
              <span className="faint">{t('orders.trailPct')}</span>
              <input type="number" inputMode="decimal" value={trailPct}
                     onChange={(e) => setTrailPct(e.target.value)}
                     min={TRAIL_MIN_PCT} max={TRAIL_MAX_PCT} step="0.5" />
            </label>

            <p className="faint" style={{ lineHeight: 1.7 }}>{t('orders.trailHint')}</p>

            {/*
              Say where this is tracked, before it is created.
              
              A trailing stop needs a peak that only moves one way, which means
              per-order state the server would have to keep. Our cron runs once
              a day on the free plan, and a trailing stop checked daily is not
              a trailing stop - it would miss the whole move. Rather than ship
              something that looks live and is not, this one is app-open only
              and says so.
            */}
            <p className="notice">{t('orders.trailScope')}</p>

            {/* Show where the stop would sit if the price never moved again,
                so the abstraction becomes a concrete number before saving. */}
            {liveRate != null && Number(trailPct) > 0 && (
              <p className="faint">
                {t('orders.currentRate')} 1 {baseSym} = <span className="mono">{fmtQty(liveRate)}</span> {quoteSym}
                {' · '}
                {t('orders.stopAt')}{' '}
                <span className="mono">{fmtQty(liveRate * (1 - Number(trailPct) / 100))}</span>
              </p>
            )}
          </>
        ) : (
          <>
            {goal && <label className="ord-field"><span className="faint">{t('orders.goalLink')}</span><select value={goalId} onChange={(e) => setGoalId(e.target.value)}><option value="">{t('orders.noGoalLink')}</option><option value={goal.id}>{t('orders.currentGoal')}</option></select></label>}
            <label className="ord-field">
              <span className="faint">{t('orders.interval')}</span>
              <select value={interval} onChange={(e) => setInterval(e.target.value)}>
                {Object.keys(DCA_INTERVALS).map((k) => (
                  <option key={k} value={k}>{t(`orders.every.${k}`)}</option>
                ))}
              </select>
            </label>
            <label className="ord-field">
              <span className="faint">{t('orders.runs')}</span>
              <input type="number" inputMode="numeric" value={runs}
                     onChange={(e) => setRuns(e.target.value)} min="1" max="365" />
            </label>
            {Number(amount) > 0 && Number(runs) > 0 && (
              <p className="faint">
                {t('orders.dcaTotal', {
                  total: fmtQty(Number(amount) * Number(runs)),
                  symbol: fromSym
                })}
              </p>
            )}
          </>
        )}

        <button
          className="btn btn-primary"
          onClick={() =>
            onSubmit({
              type: kind,
              chainId,
              fromToken,
              toToken,
              amountIn: amount,
              targetRate: target,
              direction,
              priceOf,
              interval,
              totalRuns: Number(runs),
              trailPct: Number(trailPct),
              takeProfitRate: Number(takeProfit),
              stopLossRate: Number(stopLoss),
              startRate: Number(ladderStart),
              endRate: Number(ladderEnd),
              steps: Number(ladderSteps),
              slices: Number(twapSlices),
              windowMin: Number(twapWindow),
              driftPct: Number(rebalanceDrift),
              goalId: kind === 'dca' && goalId ? goalId : undefined
            })
          }
        >
          {t('orders.create')}
        </button>
      </div>
    </Sheet>
  );
}
