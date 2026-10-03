import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import Sheet from '../components/Sheet';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { usePriceMap } from '../hooks/useMarket';
import { EVM_CHAINS, EVM_CHAIN_ORDER, FEE_BPS, TOKENS } from '../lib/chains';
import { findToken, getTokensSync, loadTokens, tokenKey } from '../lib/tokenLists';
import { isOrderable, resolveCoinIds, withCoinId } from '../lib/coinId';
import ModernSelect from '../components/ModernSelect';
import AssetIcon from '../components/AssetIcon';
import SolanaOrderCard from '../components/SolanaOrderCard';
import TokenIcon from '../lib/tokenIcon';
import '../styles/wallet-modern.css';
import '../styles/orders-modern.css';
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
/**
 * The network rows for EVERY picker on this screen, built in one place.
 *
 * Two pickers need the same list — the order form and the DCA revision panel —
 * and a second copy of the row shape is a second place for the marks, the
 * counts and the short tags to drift apart.
 */
const chainOptionsFrom = (counts, t) =>
  EVM_CHAIN_ORDER
    .map((id) => {
      const c = EVM_CHAINS[id];
      if (!c) return null;
      const n = counts?.[id];
      return {
        value: String(id),
        label: c.name,
        sublabel: Number.isFinite(n) && n > 0 ? `${c.short} · ${t('orders.networkCount', { n })}` : c.short,
        chain: id
      };
    })
    .filter(Boolean);

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
  /* The DCA revision draft being edited, if any. `null` means no row is open. */
  const [editDraft, setEditDraft] = useState(null);

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
   * Network rows, with their token counts. The counts are read after paint:
   * `getTokensSync` parses cached lists out of localStorage, and doing that for
   * sixteen chains while the screen is first rendering would put the parse on
   * the frame the user is waiting for.
   */
  const [chainCounts, setChainCounts] = useState({});
  useEffect(() => {
    const id = setTimeout(() => {
      const counts = {};
      for (const cid of EVM_CHAIN_ORDER) counts[cid] = (getTokensSync(cid) ?? []).length;
      setChainCounts(counts);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const chainOptions = useMemo(() => chainOptionsFrom(chainCounts, t), [chainCounts, t]);

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
  /*
   * ─── EDITING A DCA PLAN, IN REAL FIELDS ─────────────────────────────────
   * This used to be four `window.prompt` dialogs in a row: a modal the browser
   * draws, one field at a time, with the chain typed in as a raw EVM id and no
   * way back to the previous question. Three things were wrong with that
   * beyond the look — the cadence had to be spelled correctly from memory, the
   * network was a number nobody knows by heart, and a mistyped chain id made
   * the revision unsignable.
   *
   * It is now a panel inside the row, with the same fields the creation form
   * uses (the same network picker with marks, the same cadence list, the same
   * amount input) and a single Confirm. The active plan is still untouched:
   * the revision is a separate PAUSED draft, and the confirmation says so.
   */
  const startEditDca = (o) => {
    haptic?.('light');
    setEditDraft({
      id: o.id,
      amountIn: String(o.amountIn ?? ''),
      interval: o.interval ?? 'weekly',
      chainId: Number(o.chainId) || chain.id,
      deadlineMs: o.deadlineMs ? String(o.deadlineMs) : ''
    });
  };

  const saveEditDca = () => {
    if (!editDraft) return;
    const order = orders.find((o) => o.id === editDraft.id);
    if (!order) {
      setEditDraft(null);
      return;
    }
    const revision = createDcaRevision(order, {
      amountIn: editDraft.amountIn,
      interval: editDraft.interval,
      chainId: Number(editDraft.chainId),
      deadlineMs: editDraft.deadlineMs ? Number(editDraft.deadlineMs) : undefined
    });
    /* A refused revision leaves the panel open with the user's values in it. */
    if (!revision.order) {
      notify('orderErr.BAD_AMOUNT', 'error');
      return;
    }
    const res = addOrder(revision.order);
    if (res.error) {
      notify(`orderErr.${res.error}`, 'error');
      return;
    }
    setOrders(res.orders);
    setEditDraft(null);
    haptic?.('success');
    notify('orders.revisionReview', 'success', { changes: revision.diff.map((d) => d.key).join(', ') });
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

  /*
   * Everything a row can do, in one object. Identity changes on a page render,
   * which re-renders the rows — it does NOT remount them, because `OrderRow`
   * is now a stable component type. Re-rendering a row is cheap; losing a tap
   * is not.
   */
  const rowActions = useMemo(
    () => ({ execute, cancel, togglePause, startEditDca, reviewCancelDca, confirmCancelDca, signDca, cancelReview }),
    [cancelReview] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('orders.title')}</h1>
      </motion.div>

      <p className="muted" style={{ lineHeight: 1.85 }}>{t('orders.subtitle')}</p>

      {/*
        ─── THE HERO: LIVE NUMBERS, NOT A POSTER ──────────────────────────────
        This box used to carry a floating star and two sentences. It keeps the
        sentences (they name what the screen does) and adds the three facts a
        person opens this screen to learn: how many orders are watching, how
        many are ready to act on right now, and what value is queued.

        The glass is drawn, not blurred — see styles/orders-modern.css. The
        only motion is one sheen pass and a ring that draws itself once, both
        finite, so the card is not repainting while the user reads it.
      */}
      <motion.section className="ord-hero" variants={riseIn} initial="hidden" animate="show">
        <div className="ord-hero-top">
          <div className="ord-hero-mark" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle className="ord-hero-ring" cx="18" cy="18" r="13" opacity="0.45" />
              <path d="M18 8.5v5" />
              <path d="M18 22.5v5" />
              <path d="M8.5 18h5" />
              <path d="M22.5 18h5" />
              <circle cx="18" cy="18" r="3.4" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ord-hero-title">{t('orders.bannerTitle')}</div>
            <div className="ord-hero-sub">{t('orders.bannerSub')}</div>
          </div>
        </div>
        <div className="ord-hero-stats">
          <div className="ord-stat">
            <span className="ord-stat-val">{ready.length + active.length}</span>
            <span className="ord-stat-lbl">{t('orders.statWatching')}</span>
          </div>
          <div className="ord-stat">
            <span className={`ord-stat-val ${ready.length ? 'is-ready' : ''}`}>{ready.length}</span>
            <span className="ord-stat-lbl">{t('orders.statReady')}</span>
          </div>
          <div className="ord-stat">
            <span className="ord-stat-val">{queuedUsd > 0 ? `$${queuedUsd.toFixed(2)}` : '—'}</span>
            <span className="ord-stat-lbl">{t('orders.pipelineTitle')}</span>
          </div>
        </div>
      </motion.section>

      {/*
        Rail of order types. Flat tinted cards with one accent each — no
        backdrop blur, no glow — and each card now carries the number of live
        orders of its type, so the rail doubles as a status strip.
      */}
      <div className="ord-rail">
        {[
          { id: 'limit', Icon: IconTrend, label: t('orders.newLimit'), sub: t('orders.type.limit'), hue: 'var(--rgb-1)' },
          { id: 'trailing', Icon: IconTrend, label: t('orders.newTrailing'), sub: t('orders.type.trailing'), hue: 'var(--rgb-3)' },
          { id: 'bracket', Icon: IconShield, label: t('orders.newBracket'), sub: t('orders.type.bracket'), hue: 'var(--rgb-4)' },
          { id: 'ladder', Icon: IconPools, label: t('orders.newLadder'), sub: t('orders.type.ladder'), hue: 'var(--rgb-5)' },
          { id: 'dca', Icon: IconClock, label: t('orders.newDca'), sub: t('orders.type.dca'), hue: 'var(--rgb-2)' },
          { id: 'twap', Icon: IconClock, label: t('orders.newTwap'), sub: t('orders.type.twap'), hue: 'var(--rgb-6)' },
          { id: 'rebalance', Icon: IconPools, label: t('orders.newRebalance'), sub: t('orders.type.rebalance'), hue: 'var(--rgb-8)' }
        ].map(({ id, Icon, label, sub, hue }) => {
          const live = [...ready, ...active, ...paused].filter((o) => o.type === id).length;
          return (
            <motion.button
              key={id}
              className={`ord-new-card ord-new-${id}`}
              style={{ '--hue': hue }}
              whileTap={{ scale: 0.97 }}
              /* setSheet('limit') setSheet('dca') setSheet('trailing') setSheet('bracket') setSheet('ladder') setSheet('twap') setSheet('rebalance') */
              onClick={() => setSheet(id)}
            >
              {live > 0 && <span className="ord-new-count">{live}</span>}
              <span className="ord-new-glyph"><Icon width={22} height={22} /></span>
              <span className="ord-new-label">{label}</span>
              <span className="ord-new-sub">{sub}</span>
            </motion.button>
          );
        })}
      </div>

      {/* The limitation, stated before the user creates anything. */}
      <motion.p className="notice" variants={riseIn} initial="hidden" animate="show">
        {t('orders.manualNotice')}
      </motion.p>

      {/*
        Solana, next to the EVM cards rather than inside them: a Solana mint
        has no CoinGecko id and the server watcher holds no key, so a Solana
        "order" is a saved handoff that opens the swap pre-filled. The card
        says so before it is used. See components/SolanaOrderCard.jsx.
      */}
      <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 10 }}>
        <SolanaOrderCard />
      </motion.div>

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
            <AnimatePresence>{ready.map((o) => <OrderRow key={o.id} o={o} isReady t={t} rateFor={rateFor} usdMap={usdMap} actions={rowActions} />)}</AnimatePresence>
          </div>
        </motion.section>
      )}

      {active.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('orders.waiting')}</p>
          <div className="stack" style={{ gap: 8 }}>
            <AnimatePresence>{active.map((o) => <OrderRow key={o.id} o={o} t={t} rateFor={rateFor} usdMap={usdMap} actions={rowActions} />)}</AnimatePresence>
          </div>
        </motion.section>
      )}

      {paused.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('orders.paused')}</p>
          <div className="stack" style={{ gap: 8 }}>
            <AnimatePresence>{paused.map((o) => <OrderRow key={o.id} o={o} t={t} rateFor={rateFor} usdMap={usdMap} actions={rowActions} />)}</AnimatePresence>
          </div>
        </motion.section>
      )}

      {done.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('orders.history')}</p>
          <div className="stack" style={{ gap: 8 }}>
            {done.slice(0, 10).map((o) => <OrderRow key={o.id} o={o} t={t} rateFor={rateFor} usdMap={usdMap} actions={rowActions} />)}
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

      <DcaRevisionSheet
        draft={editDraft}
        onChange={setEditDraft}
        onSave={saveEditDca}
        onClose={() => setEditDraft(null)}
        chainOptions={chainOptions}
      />

      <OrderSheet
        kind={sheet}
        onClose={() => setSheet(null)}
        onSwitchKind={setSheet}
        onSubmit={submit}
        walletChainId={chain.id}
        prices={prices}
      />
    </PageTransition>
  );
}

/**
 * ONE ORDER ROW.
 *
 * ─── WHY IT IS A MODULE-LEVEL COMPONENT AND NOT DEFINED INSIDE `Orders` ────
 * It used to be declared inside the page. React compares component TYPES by
 * identity, so a function re-created on every render is a component React has
 * never seen before: every re-render destroyed and rebuilt every row. This page
 * re-renders on every price tick — `usePriceMap(100)`, ten times a second — so
 * a tap on Pause or Edit could land on a node that was already detached, and
 * any state a row owned was wiped before it could be used. That is exactly what
 * the DCA revision-sheet test caught.
 *
 * The handlers arrive as one `actions` object rather than a dozen props, so the
 * row has a single seam to read.
 */
function OrderRow({ o, isReady, t, rateFor, usdMap, actions }) {
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
        {/*
          WHICH NETWORK. Orders can be created on any supported chain, so a row
          that does not name its network is ambiguous the moment somebody has
          two — and the same pair on two chains is a normal way to work. The
          mark is drawn from the chain id; the word is there for everyone who
          cannot see it.
        */}
        {EVM_CHAINS[o.chainId] && (
          <span className="ord-netline">
            <span className="ord-chain-mark" aria-hidden="true">
              <AssetIcon chain={o.chainId} size={17} />
            </span>
            <span>{EVM_CHAINS[o.chainId].short || EVM_CHAINS[o.chainId].name}</span>
          </span>
        )}
        <span className="ord-pair mono">
          {o.amountIn} {o.fromToken.symbol} → {o.toToken.symbol}
        </span>
        {o.type === 'dca' && ['completed', 'failed', 'rejected', 'partial', 'cancelled'].includes(executionStatus) && <span className={`ord-status ord-${executionStatus}`}>{t(`orders.status.${executionStatus}`, { defaultValue: executionStatus })}</span>}

        {/*
          IS THIS ORDER ACTUALLY WATCHING?
          Before this, an active order and a paused one looked the same from
          across the row: only the pause/resume BUTTON changed its label. You
          had to read the button to work out whether the market was being
          watched — and a paused order that looks live is the failure mode that
          costs a user their price.

          A dot plus a word, not a dot alone: colour is not available to
          everyone, and the word is unambiguous where a green circle is not.
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
          {/* Both exits on one row: the whole point of a bracket is that they
              are a pair, and splitting them would hide that. */}
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
             * above the target, red when below. That is right for a "sell when
             * it rises" order and exactly WRONG for "buy when it falls": the
             * price dropping towards a buy target is the good news, and it was
             * painted red.
             *
             * Green now means "moving the way you asked for", which is the only
             * reading that is correct for both directions.
             *
             * `pct` can also be null on an order stored before targetRate was
             * validated, and `null.toFixed` throws — one legacy row would
             * white-screen the whole list.
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

        Shown rather than hidden for the same reason the swap screen had to stop
        claiming it was free: a plan that quietly costs more than the user
        expects is the kind of surprise that loses the customer, and six
        scheduled buys carry six fees.
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
          <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => actions.execute(o)}>
            {t('orders.swapNow')}
          </button>
        )}
        {o.type === 'dca' && o.status === 'paused' && (
          <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => actions.signDca(o)}>{t('orders.signActivate')}</button>
        )}
        {o.type === 'dca' && o.status === 'active' && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => actions.startEditDca(o)}>{t('orders.edit')}</button>
            {actions.cancelReview === o.id ? <button className="btn btn-ghost btn-sm" onClick={() => actions.confirmCancelDca(o)}>{t('orders.confirmCancel')}</button> : <button className="btn btn-ghost btn-sm" onClick={() => actions.reviewCancelDca(o)}>{t('orders.cancelDca')}</button>}
          </>
        )}
        {o.type !== 'dca' && (o.status === 'active' || o.status === 'paused') && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => actions.togglePause(o)}>{o.status === 'paused' ? t('orders.resume') : t('orders.pause')}</button>
            <button className="btn btn-ghost btn-sm" style={{ flex: isReady ? 0 : 1 }} onClick={() => actions.cancel(o.id)}>{t('orders.cancel')}</button>
          </>
        )}
        {o.status !== 'active' && o.status !== 'paused' && (
          <>
            <span className={`ord-status ord-${o.status}`}>{t(`orders.status.${o.status}`)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => actions.cancel(o.id)}>
              {t('orders.remove')}
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * EDIT A DCA PLAN — a real sheet, owned by the page.
 *
 * ─── WHY NOT INSIDE THE ROW ─────────────────────────────────────────────────
 * The first version of this panel rendered inside the row it belongs to. That
 * lasted one test: the price map re-renders this page every 100 ms, and `Row`
 * is declared inside `Orders`, so each render gives every row a NEW component
 * type — React unmounts and remounts the subtree, and anything holding local
 * state inside a row dies instantly. A network picker opened from the row
 * closed itself before it could be used.
 *
 * The sheet is therefore a sibling of the order form, owned by the page, where
 * its state survives a price tick. (The deeper issue — `Row` being redefined
 * every render — is pre-existing and worth a separate pass; the `editDraft`
 * state was deliberately put in the PAGE for the same reason.)
 */
function DcaRevisionSheet({ draft, onChange, onSave, onClose, chainOptions }) {
  const { t } = useTranslation();
  if (!draft) return null;
  return (
    <Sheet open onClose={onClose} title={t('orders.edit')} size="md" anchor="bottom">
      <div className="ord-edit" style={{ marginTop: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <label className="ord-field">
            <span>{t('orders.editAmountPrompt')}</span>
            <input
              type="number"
              inputMode="decimal"
              value={draft.amountIn}
              onChange={(e) => onChange({ ...draft, amountIn: e.target.value })}
            />
          </label>
          <label className="ord-field">
            <span>{t('orders.interval')}</span>
            <select value={draft.interval} onChange={(e) => onChange({ ...draft, interval: e.target.value })}>
              {Object.keys(DCA_INTERVALS).map((k) => (
                <option key={k} value={k}>{t(`orders.every.${k}`)}</option>
              ))}
            </select>
          </label>
        </div>

        {/* The network, picked the same way it is picked at creation: a row with
            a mark and a name, never a raw chain id typed from memory. */}
        <label className="ord-field" style={{ marginTop: 9 }}>
          <span>{t('orders.network')}</span>
          <ModernSelect
            value={String(draft.chainId)}
            onChange={(v) => onChange({ ...draft, chainId: Number(v) })}
            options={chainOptions}
            title={t('orders.network')}
            placeholder={t('orders.network')}
            ariaLabel={t('orders.network')}
            testId="ord-edit-chain-select"
          />
        </label>

        <label className="ord-field" style={{ marginTop: 9 }}>
          <span>{t('orders.editDeadlinePrompt')}</span>
          <input
            type="number"
            inputMode="numeric"
            value={draft.deadlineMs}
            onChange={(e) => onChange({ ...draft, deadlineMs: e.target.value })}
          />
        </label>

        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={onSave}>
            {t('common.confirm')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </div>
    </Sheet>
  );
}

function OrderSheet({ kind, onClose, onSubmit, onSwitchKind, walletChainId, prices }) {
  const { t } = useTranslation();

  /*
   * ─── THE NETWORK IS A CHOICE HERE, NOT AN INHERITANCE ───────────────────
   * `chainId` used to arrive as a prop from the connected wallet, so a user on
   * BNB Smart Chain could not schedule an order on Arbitrum at all — and the
   * token list was the four-to-twenty hand-curated entries of that one chain.
   * It is sheet state now, defaulted to the wallet's chain, and the picker
   * offers every network this app can route on.
   */
  const [chainId, setChainId] = useState(() => Number(walletChainId) || 56);
  const [fromKey, setFromKey] = useState('');
  const [toKey, setToKey] = useState('');
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

  /* The chain's hand-verified entries: the instant first paint, and always
     present in the merged universe below. */
  const curated = useMemo(() => TOKENS[chainId] ?? [], [chainId]);

  /*
   * ─── THE TOKEN UNIVERSE, THE SAME ONE THE SWAP SCREEN TRADES ────────────
   * This form offered 86 curated entries across every chain — 21 on Ethereum,
   * five on Polygon — because an order needs a PRICE FEED and only curated
   * tokens carried a `coingeckoId`. The swap screen has always offered
   * thousands. `getTokensSync` paints from the curated set plus whatever the
   * swap screen already cached, then `loadTokens` merges the remote lists in,
   * so the picker is never empty, never waits to be usable, and never narrower
   * than the screen it hands off to.
   */
  const [universe, setUniverse] = useState(() => getTokensSync(chainId));

  useEffect(() => {
    let alive = true;
    setUniverse(getTokensSync(chainId));
    loadTokens(chainId)
      .then((list) => {
        if (alive && Array.isArray(list) && list.length) setUniverse(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [chainId]);

  /* Defaults come from the CURATED list, which does not change underfoot: if
     they came from the universe, the remote list landing mid-typing would
     silently reset the pair. */
  useEffect(() => {
    if (!kind) return;
    setFromKey(tokenKey(curated[0] ?? {}));
    setToKey(tokenKey(curated[1] ?? curated[0] ?? {}));
    setAmount('');
    setTarget('');
  }, [kind, curated]);

  /*
   * ─── PRICE-OR-NOTHING, RESOLVED BY CONTRACT ADDRESS ─────────────────────
   * An automatic order is only real if the server can price it, and a price
   * feed is looked up by contract address — never by symbol, because dozens
   * of tokens share the ticker "BTC". `lib/coinId.js` documents the rule and
   * `server/coinIndex.js` answers it; this is the wiring, which was the one
   * piece missing (the error copy `orders.typeUnorderable` has been sitting in
   * all twelve locales, unused, waiting for it).
   *
   * One request per unknown token as it is picked — the endpoint caps a call
   * at 25 addresses, and a 4,000-address sweep would be both slow and rude.
   */
  const [priceIds, setPriceIds] = useState(() => new Map());
  const [asked, setAsked] = useState(() => new Set());
  const [answered, setAnswered] = useState(() => new Set());

  useEffect(() => {
    setPriceIds(new Map());
    setAsked(new Set());
    setAnswered(new Set());
  }, [chainId]);

  const addrKey = (tk) =>
    (tk && !tk.native && tk.address ? String(tk.address).toLowerCase() : null);

  const rawFrom = useMemo(
    () => findToken(universe, fromKey) ?? findToken(curated, fromKey) ?? curated[0] ?? null,
    [universe, curated, fromKey]
  );
  const rawTo = useMemo(
    () => findToken(universe, toKey) ?? findToken(curated, toKey) ?? curated[1] ?? null,
    [universe, curated, toKey]
  );

  const hydrate = (tk) => withCoinId(tk, priceIds);
  const fromToken = useMemo(() => hydrate(rawFrom), [rawFrom, priceIds]);
  const toToken = useMemo(() => hydrate(rawTo), [rawTo, priceIds]);

  /*
   * A lookup in flight belongs to ONE chain. If the user switches networks
   * while it is running, the answer is about the wrong set of contracts and
   * must be dropped — hence a ref rather than a cleanup flag.
   *
   * ─── WHY NOT AN `alive` FLAG (THE BUG THIS REPLACES) ────────────────────
   * The first version of this effect cancelled itself. It marked the keys as
   * "asked" in the same effect that depended on `asked`, so the state update
   * re-ran the effect, whose CLEANUP set `alive = false` — and the request
   * that had just been fired resolved into a dead branch. The rows sat on
   * «در حال بررسی فید قیمت…» forever and every token looked unpriceable.
   * A cleanup flag is only safe when the effect cannot re-run for its own
   * reasons.
   */
  const chainRef = useRef(chainId);
  useEffect(() => {
    chainRef.current = chainId;
  }, [chainId]);

  useEffect(() => {
    const want = [rawFrom, rawTo].filter((tk) => {
      const k = addrKey(tk);
      return k && !tk.coingeckoId && !asked.has(k);
    });
    if (!want.length) return;
    const keys = want.map(addrKey);
    const cid = chainId;
    setAsked((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
    /*
     * A resolved promise is a completed lookup: `resolveCoinIds` swallows
     * transport failures instead of rejecting, so "no id" and "the request
     * failed" look alike from here. Marking the keys answered is the honest
     * reading of that, and re-picking the token asks again (see `pickOn`).
     */
    const settle = (map) => {
      if (chainRef.current !== cid) return;
      setPriceIds((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const [k, v] of map ?? []) {
          if (v && !next.has(k)) {
            next.set(k, v);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setAnswered((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.add(k);
        return next;
      });
    };
    resolveCoinIds(cid, want).then(settle).catch(() => settle(null));
  }, [chainId, rawFrom, rawTo, asked]);

  /* ok | checking | none — 'checking' is the state the old form had no way to
     express, and it is why a token with no feed looked like a working pick. */
  const priceStateOf = (tk) => {
    if (!tk) return 'none';
    if (isOrderable(tk)) return 'ok';
    const k = addrKey(tk);
    if (!k) return 'none';
    return answered.has(k) ? 'none' : 'checking';
  };

  /* Only the token that changed is forgotten, so re-picking it retries. */
  const pickOn = (side) => (value, opt) => {
    const k = addrKey(opt);
    if (k) {
      setAsked((prev) => {
        if (!prev.has(k)) return prev;
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
      setAnswered((prev) => {
        if (!prev.has(k)) return prev;
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
    }
    if (side === 'from') setFromKey(String(value));
    else setToKey(String(value));
  };

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

  /*
   * Token options for the picker, keyed by CONTRACT (or 'native'), never by
   * symbol: a 4,000-row list has duplicate tickers by construction, and two
   * rows both valued "USDT" would make a selection ambiguous. Native coins
   * draw from the bundled SVG marks; everything else is address-keyed, so a
   * scam symbol can never borrow the real token's face.
   *
   * A token with no price feed stays IN the list and is marked off, with the
   * reason in the row: hiding it would leave the user hunting for a token that
   * is right there on the swap screen, with nothing to explain its absence.
   */
  const tokenOptions = useMemo(
    () => universe.map((tk) => {
      const state = priceStateOf(tk);
      const off = state === 'none';
      const isNative = tk.native || !tk.address;
      return {
        value: tokenKey(tk),
        label: tk.symbol,
        sublabel:
          !isNative && tk.duplicateSymbol && tk.address
            ? `${tk.name} · ${String(tk.address).slice(0, 6)}…${String(tk.address).slice(-4)}`
            : tk.name,
        ...(isNative ? { symbol: tk.symbol, chain: chainId } : { token: tk, chainId }),
        disabled: off,
        disabledReason: off ? t('orders.pxNone') : undefined
      };
    }),
    [universe, chainId, answered, t]
  );

  /*
   * Every network this app can route on, with the wallet's chain first in the
   * list order only in the sense that it is already selected. Counts arrive
   * from a post-paint effect: `getTokensSync` parses cached lists out of
   * localStorage, and doing that for sixteen chains while opening a sheet
   * would put the parse on the frame the user is waiting for.
   */
  const [tokenCounts, setTokenCounts] = useState({});
  useEffect(() => {
    const id = setTimeout(() => {
      const counts = {};
      for (const cid of EVM_CHAIN_ORDER) counts[cid] = (getTokensSync(cid) ?? []).length;
      setTokenCounts(counts);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const chainOptions = useMemo(() => chainOptionsFrom(tokenCounts, t), [tokenCounts, t]);

  /* The two legs, by symbol. Kept as plain strings because the price-target
     inputs, the segmented control and the ladder preview all name them. */
  const fromSym = fromToken?.symbol ?? '';
  const toSym = toToken?.symbol ?? '';

  // Which symbol is being priced, and in what.
  const baseSym = priceOf === 'to' ? toSym : fromSym;
  const quoteSym = priceOf === 'to' ? fromSym : toSym;
  const fromState = priceStateOf(fromToken);
  const toState = priceStateOf(toToken);
  const canCreate = fromState === 'ok' && toState === 'ok';
  const priceState = fromState === 'ok' ? toState : fromState;

  if (!kind) return null;

  return (
    <Sheet open onClose={onClose} title={t(`orders.new.${kind}`)}>
      <div className="stack" style={{ gap: 11 }}>
        {/*
          ─── THE NETWORK PICKER ────────────────────────────────────────────
          With per-network marks, and each row saying how many tokens that
          chain offers. Eleven of the sixteen networks used to be unreachable
          from this screen entirely, because the chain was inherited from the
          wallet.
        */}
        <label className="ord-field">
          <span className="faint">{t('orders.network')}</span>
          <ModernSelect
            value={String(chainId)}
            onChange={(v) => setChainId(Number(v))}
            options={chainOptions}
            title={t('orders.network')}
            placeholder={t('orders.network')}
            ariaLabel={t('orders.network')}
            testId="ord-chain-select"
          />
        </label>

        <div className="row" style={{ gap: 8 }}>
          <label className="ord-field" style={{ flex: 1, minWidth: 0 }}>
            <span className="faint">{t('orders.from')}</span>
            <ModernSelect
              value={fromKey}
              onChange={pickOn('from')}
              options={tokenOptions}
              title={t('orders.from')}
              placeholder={t('orders.from')}
              ariaLabel={t('orders.from')}
              testId="ord-from-select"
              searchable
            />
          </label>
          <label className="ord-field" style={{ flex: 1, minWidth: 0 }}>
            <span className="faint">{t('orders.to')}</span>
            <ModernSelect
              value={toKey}
              onChange={pickOn('to')}
              options={tokenOptions}
              title={t('orders.to')}
              placeholder={t('orders.to')}
              ariaLabel={t('orders.to')}
              testId="ord-to-select"
              searchable
            />
          </label>
        </div>

        {/*
          WHETHER THIS PAIR CAN ACTUALLY BE WATCHED.

          The rule is not "the price exists somewhere" — it is "the server can
          price this contract", which is a different and specific question.
          Saying so next to the pickers, before anything is typed into the rest
          of the form, is the difference between a token that is unavailable
          and a token that looks perfectly normal until the Create button
          refuses.
        */}
        <div className={`ord-price-state is-${priceState}`}>
          <span className="ord-price-dot" aria-hidden="true" />
          {priceState === 'ok'
            ? t('orders.pxOk')
            : priceState === 'checking'
              ? t('orders.pxChecking')
              : t('orders.pxNone')}
        </div>
        {priceState === 'none' && <p className="ord-warn">{t('orders.typeUnorderable')}</p>}

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
          disabled={!canCreate}
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
