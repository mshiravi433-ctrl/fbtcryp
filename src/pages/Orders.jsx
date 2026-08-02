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
  TRAIL_MAX_PCT,
  TRAIL_MIN_PCT,
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
  saveOrders,
  shouldNotify,
  syncWatches,
  updateOrder
} from '../lib/orders';
import { showLocalNotification } from '../lib/notify';
import { IconChevronLeft, IconClock, IconTrend } from '../components/Icons';
import { useHideBalances } from '../hooks/useHideBalances';

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

  useEffect(() => {
    // Mark stale limit orders on open so the list explains why one stopped,
    // rather than silently dropping it.
    const fresh = expireStale(loadOrders());
    saveOrders(fresh);
    setOrders(fresh);
  }, []);

  const chain = EVM_CHAINS[wallet.chainId] ?? EVM_CHAINS[56];
  const chainTokens = TOKENS[chain.id] ?? [];

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
      // Tagged per order so a re-fire replaces the old notification rather
      // than stacking a second copy in the shade.
      showLocalNotification(t('orders.notifyTitle'), {
        body: t('orders.notifyBody', {
          from: cur.fromToken.symbol,
          to: cur.toToken.symbol,
          amount: cur.amountIn
        }),
        tag: `fbt-order-${cur.id}`
      });
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
   * Keyed on the active limit orders only — re-sending on every render, or on
   * a DCA counter tick, would be a request per price poll for no benefit.
   */
  const watchKey = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'active' && o.type === 'limit')
        .map((o) => `${o.id}:${o.targetRate}:${o.direction}:${o.priceOf ?? 'from'}`)
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
    setOrders(updateOrder(order.id, advanceOrder(order)));
    const params = new URLSearchParams({
      from: order.fromToken.symbol,
      to: order.toToken.symbol,
      amount: order.amountIn,
      chain: String(order.chainId)
    });
    navigate(`/swap?${params.toString()}`);
  };

  const cancel = (id) => {
    haptic?.('light');
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
    const raw = rateFor(o);
    // Display in whichever unit the order was written in.
    const rate =
      o.type === 'limit' && o.priceOf === 'to' && Number.isFinite(raw) && raw > 0 ? 1 / raw : raw;
    const pct =
      o.type === 'limit' && Number.isFinite(rate) && o.targetRate
        ? ((rate - o.targetRate) / o.targetRate) * 100
        : null;

    return (
      <motion.div className={`ord-row ${isReady ? 'ord-ready' : ''}`} variants={riseIn}>
        <div className="ord-head">
          <span className={`ord-kind ord-${o.type}`}>{t(`orders.type.${o.type}`)}</span>
          <span className="ord-pair mono">
            {o.amountIn} {o.fromToken.symbol} → {o.toToken.symbol}
          </span>
        </div>

        {o.type === 'trailing' ? (
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
              <span className={`mono ${pct >= 0 ? 'up' : 'down'}`}>
                {t('orders.now')} {fmtQty(rate)} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
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
          {(o.status === 'active' || o.status === 'paused') && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => togglePause(o)}>
                {o.status === 'paused' ? t('orders.resume') : t('orders.pause')}
              </button>
              <button className="btn btn-ghost btn-sm" style={{ flex: isReady ? 0 : 1 }} onClick={() => cancel(o.id)}>
                {t('orders.cancel')}
              </button>
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

      <p className="muted">{t('orders.subtitle')}</p>

      <motion.div className="row" style={{ gap: 8 }} variants={riseIn} initial="hidden" animate="show">
        <button className="ord-new ord-new-limit" onClick={() => setSheet('limit')}>
          <IconTrend width={17} height={17} />
          {t('orders.newLimit')}
        </button>
        <button className="ord-new ord-new-trailing" onClick={() => setSheet('trailing')}>
          <IconTrend width={17} height={17} />
          {t('orders.newTrailing')}
        </button>
        <button className="ord-new ord-new-dca" onClick={() => setSheet('dca')}>
          <IconClock width={17} height={17} />
          {t('orders.newDca')}
        </button>
      </motion.div>

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

      <OrderSheet
        kind={sheet}
        onClose={() => setSheet(null)}
        onSubmit={submit}
        tokens={chainTokens}
        chainId={chain.id}
        prices={prices}
      />
    </PageTransition>
  );
}

/* -------------------------------------------------------------------------- */

function OrderSheet({ kind, onClose, onSubmit, tokens, chainId, prices }) {
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

            <div className="segmented">
              {['below', 'above'].map((d) => (
                <button key={d} className={direction === d ? 'active' : ''} onClick={() => setDirection(d)}>
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

            <p className="faint" style={{ lineHeight: 1.7 }}>
              {t('orders.willSwap', { from: fromSym, to: toSym })}
            </p>
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
                <button key={v} className={trailPct === v ? 'active' : ''} onClick={() => setTrailPct(v)}>
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
              trailPct: Number(trailPct)
            })
          }
        >
          {t('orders.create')}
        </button>
      </div>
    </Sheet>
  );
}
