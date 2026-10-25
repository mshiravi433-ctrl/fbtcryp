import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Sheet from '../Sheet';
import SegIndicator from '../SegIndicator';
import ModernSelect from '../ModernSelect';
import AssetIcon from '../AssetIcon';
import CollapsibleCard from '../CollapsibleCard';
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowUpRight,
  IconCheck,
  IconClock,
  IconExternal,
  IconFingerprint,
  IconInfo,
  IconRefresh,
  IconShield,
  IconTrend
} from '../Icons';
import { useWallet } from '../../context/WalletContext';
import { useTelegram } from '../../context/TelegramContext';
import { perpAutoCopyFor } from '../../lib/perpAutoCopy';
import {
  PERP_ERRORS,
  PERP_KIND,
  PERP_STATE,
  PERP_VENUE,
  PERP_VENUES,
  addPerpOrder,
  applyPerpState,
  createPerpOrder,
  expirePerpOrders,
  loadPerpOrders,
  perpFeePreview,
  perpOrdersDone,
  perpOrdersLive,
  planPerpOrder,
  savePerpOrders,
  updatePerpOrder
} from '../../lib/perpOrders';
import {
  cancelDydxOrder,
  dydxSessionAddress,
  getDydxMarkets,
  getDydxOrders,
  placeDydxAutoOrder
} from '../../lib/dydx';
import {
  OSTIUM_CHAIN_ID,
  buildApproveCollateral,
  buildCancelLimitOrder,
  buildOpenTrade,
  getOstiumMarkets,
  getOstiumOpenOrders
} from '../../lib/ostium';
import { SPECULATION_ENABLED } from '../../lib/features';
import { fmtPrice } from '../../lib/format';
import '../../styles/perp-auto-orders.css';

/*
 * ─── AUTO-ORDERS THAT A VENUE EXECUTES ───────────────────────────────────────
 *
 * Everything else on «سفارش خودکار» either watches a price and asks the user
 * to sign, or hands a swap to a solver network. This is the third thing: an
 * order that is placed ON a perpetual venue the app already has a signed,
 * non-custodial path to, and that the venue fills by itself — while the app
 * is closed, with no server of ours in the path, and with our builder fee
 * inside the signed order.
 *
 *   · dYdX Chain — LONG_TERM limit orders and CONDITIONAL trigger orders,
 *                  signed with a key derived in memory from the user's own
 *                  wallet signature. Builder fee 1000 ppm (10 bps).
 *   · Ostium     — limit and stop open orders on Arbitrum One, with TP and SL
 *                  enforced by the protocol. Builder fee up to 50 bps.
 *
 * The rules that decide whether an order may be placed live in
 * src/lib/perpOrders.js (pure, unit-tested). This file only renders them, asks
 * for one signature, and reads the venue's own answer back.
 *
 * ─── WHERE IT LIVES ON THE PAGE (2026-10-25) ─────────────────────────────────
 * Requested: «در سفارش خودکار یک باکس شبیه بقیه باکس‌های سفارش خودکار با نام
 * سفارش روی ونوو پرپتوال درست کن و از صفحه ببر … فقط مثل بقیه داخل باکس باشد
 * که به صورت پاپ اپ باز شود». So the standing section that used to sit inline
 * on the page is GONE: this component now renders ONE rail card
 * (`.ord-new-card`, twin of Limit / DCA / TWAP …) and the whole surface —
 * the section title and its paragraph, the order form, the «هشدار» fold and
 * the list of orders already resting on a venue — lives inside the popup
 * that card opens. Nothing was dropped to make room: a user with a live
 * venue order sees its count on the card itself, and cancel / state-read
 * moved into the popup alongside the form that created them.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *   · no timer, no interval and no effect that can send an order. The only path
 *     to a signature is the button, disabled until the plan says ok;
 *   · no strategy, no signal, no «profit». The user picks every number;
 *   · no copy of the order on our server. The venue holds the trigger, so a
 *     server-side watch would be a second source of truth that can disagree
 *     with the first — and a server that could act on it would be custody;
 *   · no state we cannot read. A venue that will not answer is shown as
 *     «خوانده نشد», never as an order that is still open.
 */

const EXPIRY_SECONDS = Object.freeze({ '1d': 86_400, '7d': 604_800, '28d': 2_419_200, '90d': 7_776_000 });

const fmtUsd = (n) => (Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : '—');
const fmtNum = (n, digits = 6) => (Number.isFinite(Number(n)) ? Number(Number(n).toPrecision(digits)).toString() : '—');

/* The base asset of a venue market label — «BTC-USD» and «BTC/USD» both give
 * BTC. This is what the logo is keyed by: venue-curated lists only, the same
 * rule AssetIcon documents for itself. */
const baseOf = (label) => String(label || '').split(/[-/]/)[0].trim().toUpperCase();

/* One glyph per order kind, so the kind cards say what they ARE before their
 * label is read: a resting level, a trigger crossing, an exit up, an exit
 * guarded. */
const KIND_ICON = Object.freeze({
  [PERP_KIND.ENTRY_LIMIT]: IconTrend,
  [PERP_KIND.ENTRY_STOP]: IconActivity,
  [PERP_KIND.TAKE_PROFIT]: IconArrowUpRight,
  [PERP_KIND.STOP_LOSS]: IconShield
});

/**
 * The venue's face. dYdX has vendored token artwork; Ostium has no token, so
 * it gets a drawn mark in the same 36px tile rather than a borrowed logo from
 * a CDN this app's users may not reach.
 */
function VenueMark({ venue }) {
  if (venue === PERP_VENUE.DYDX) return <AssetIcon symbol="DYDX" size={36} />;
  return (
    <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
      <defs>
        <linearGradient id="pao-ostium-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b1437" />
          <stop offset="1" stopColor="#0a0c14" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" fill="url(#pao-ostium-g)" />
      <circle cx="18" cy="18" r="8.5" fill="none" stroke="#c9a7ff" strokeWidth="2.6" />
      <circle cx="18" cy="18" r="3" fill="#c9a7ff" />
      <circle cx="26.5" cy="9.5" r="1.7" fill="#7ef0c9" />
    </svg>
  );
}

/** One row in the venue list. Module-level: a component re-created on every
 *  render is a component React has never seen, and this page re-renders on
 *  every state read. */
function PerpOrderRow({ o, c, lang, onCancel, cancelling, stale }) {
  const isFa = /^fa\b/i.test(String(lang || 'fa'));
  const stateKey = o.venueState === PERP_STATE.FILLED ? 'stateFilled'
    : o.venueState === PERP_STATE.CANCELLED ? 'stateCancelled'
      : o.venueState === PERP_STATE.EXPIRED ? 'stateExpired'
        : o.venueState === PERP_STATE.OPEN ? 'stateOpen'
          : 'stateUnknown';
  const isLong = o.venue === PERP_VENUE.DYDX ? o.side === 'buy' : o.side === 'long';
  const sideLabel = isLong ? c.sideBuy : c.sideSell;
  const stateCls = o.venueState === PERP_STATE.FILLED ? 'is-filled'
    : o.venueState === PERP_STATE.OPEN ? 'is-open'
      : o.venueState === PERP_STATE.UNKNOWN ? 'is-unknown'
        : '';
  return (
    <motion.div className="pao-order" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      data-testid={`perp-order-${o.id}`}>
      <div className="pao-order-top">
        <span className="pao-order-logo"><AssetIcon symbol={baseOf(o.market)} size={34} /></span>
        <div className="pao-order-id">
          <span className="pao-order-market">{o.market}</span>
          <span className="pao-order-meta">
            <span>{o.venue === PERP_VENUE.DYDX ? 'dYdX' : 'Ostium'}</span>
            <span aria-hidden="true">·</span>
            <span>{c.kinds[o.kind] || o.kind}</span>
          </span>
        </div>
        <span className={`pao-side-chip ${isLong ? 'is-long' : 'is-short'}`}>{sideLabel}</span>
      </div>

      <div className="pao-order-nums">
        {o.size != null && <span>{c.reviewSize}: <b className="mono">{fmtNum(o.size)}</b></span>}
        {o.collateralUsd != null && <span>{c.reviewCollateral}: <b className="mono">{fmtUsd(o.collateralUsd)}</b></span>}
        {o.leverage != null && <span>{c.reviewLeverage}: <b className="mono">{fmtNum(o.leverage, 3)}×</b></span>}
        {o.triggerPrice != null && <span>{c.reviewTrigger}: <b className="mono">{fmtPrice(o.triggerPrice)}</b></span>}
        {o.price != null && <span>{c.reviewPrice}: <b className="mono">{fmtPrice(o.price)}</b></span>}
      </div>

      <span className={`pao-state ${stateCls}`}>{c[stateKey]}</span>

      {stale && o.status === 'active' && (
        <p className="pao-alert is-warn" style={{ fontSize: 11.3 }}>
          <IconAlertTriangle width={14} height={14} />{c.stateUnknown}
        </p>
      )}

      <div className="pao-order-actions">
        {o.txHash && (
          <a className="row" style={{ gap: 4, fontSize: 11.5, color: 'inherit' }}
            href={o.venue === PERP_VENUE.DYDX
              ? `https://dydx.trade/${isFa ? '' : ''}profile/${encodeURIComponent(o.wallet || '')}`
              : `https://arbiscan.io/tx/${encodeURIComponent(o.txHash)}`}
            target="_blank" rel="noreferrer noopener">
            <IconExternal width={13} height={13} />{c.viewOnExplorer}
          </a>
        )}
        {o.status === 'active' && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(cancelling)}
            onClick={() => onCancel(o)} data-testid={`perp-cancel-${o.id}`}>
            {cancelling === o.id ? c.cancelling : c.cancel}
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The popup: hero → venue → kind → market (with its logo) → side → numbers →
 * lifetime → «هشدار» → review → one signature → the orders already resting.
 * It carries the list as well as the form because the card that opens it is
 * now the only door: an order you cannot see or cancel any more would be a
 * worse product than the inline section this replaced.
 * ──────────────────────────────────────────────────────────────────────────── */
function PerpVenuePopup({ open, onClose, lang, onPlaced, book }) {
  const c = perpAutoCopyFor(lang);
  const isFa = /^fa\b/i.test(String(lang || 'fa'));
  const navigate = useNavigate();
  const wallet = useWallet();
  const { haptic } = useTelegram();

  const [venue, setVenue] = useState(PERP_VENUE.DYDX);
  const [kind, setKind] = useState(PERP_KIND.ENTRY_LIMIT);
  const [side, setSide] = useState('buy');
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('');
  const [collateral, setCollateral] = useState('50');
  const [leverage, setLeverage] = useState('5');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [expiryKey, setExpiryKey] = useState('28d');
  const [marketId, setMarketId] = useState('');

  const [dydxMarkets, setDydxMarkets] = useState({ list: [], live: false });
  const [ostiumPairs, setOstiumPairs] = useState({ list: [], live: false });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [allowance, setAllowance] = useState(null);
  /* The answer after a successful placement. The old sheet simply closed,
     so the user's only proof was a row appearing further down the page;
     «دکمه انجام را درست کن» starts with the button's end state saying what
     it did. */
  const [placed, setPlaced] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const caps = PERP_VENUES.find((v) => v.id === venue);
  const isDydx = venue === PERP_VENUE.DYDX;

  /* A venue change resets what the venue cannot express: the kind list is
     different, and Ostium's side vocabulary is long/short, not buy/sell. */
  const pickVenue = (v) => {
    setVenue(v);
    const next = PERP_VENUES.find((x) => x.id === v);
    if (next && !next.kinds.includes(kind)) setKind(next.kinds[0]);
    setSide(v === PERP_VENUE.DYDX ? 'buy' : 'long');
    setMarketId('');
    setError(null);
    setReviewing(false);
  };

  /* ── market lists, read live and never fabricated ─────────────────────── */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    if (isDydx) {
      getDydxMarkets().then((r) => { if (alive && mounted.current) setDydxMarkets({ list: r.markets || [], live: r.live }); });
    } else {
      getOstiumMarkets().then((r) => { if (alive && mounted.current) setOstiumPairs({ list: r.pairs || [], live: r.live }); });
    }
    return () => { alive = false; };
  }, [open, isDydx]);

  /* Every market row wears its logo («بازار دارای لوگو باشد»): `symbol` for a
     dYdX base asset, `base`+`quote` for an Ostium pair — the two artwork
     paths ModernSelect already documents. Price and the 24h move go into the
     row's meta column, where the picker colours them, instead of being
     concatenated into the sublabel as text. */
  const marketOptions = useMemo(() => (isDydx
    ? dydxMarkets.list
      .filter((m) => String(m.status || '').toUpperCase() === 'ACTIVE')
      .map((m) => {
        const base = baseOf(m.ticker);
        return {
          value: m.ticker,
          label: m.ticker,
          symbol: base,
          sublabel: `${base} / USD`,
          meta: fmtPrice(m.oraclePrice),
          change: Number(m.priceChange24H) || 0
        };
      })
    : ostiumPairs.list
      .map((p) => ({
        value: String(p.pairId),
        label: `${String(p.from || '').toUpperCase()}/${String(p.to || '').toUpperCase()}`,
        base: String(p.from || '').toUpperCase(),
        quote: String(p.to || 'USD').toUpperCase(),
        sublabel: p.isMarketOpen === false
          ? (isFa ? 'بسته' : 'closed')
          : (p.group?.name || p.category || '').toString().slice(0, 18),
        meta: p.isMarketOpen === false ? null : fmtPrice(p.mid),
        disabled: p.isMarketOpen === false
      }))
  ), [isDydx, dydxMarkets.list, ostiumPairs.list, isFa]);

  const market = useMemo(() => (isDydx
    ? dydxMarkets.list.find((m) => m.ticker === marketId) || null
    : ostiumPairs.list.find((p) => String(p.pairId) === String(marketId)) || null
  ), [isDydx, marketId, dydxMarkets.list, ostiumPairs.list]);

  const feedLive = isDydx ? dydxMarkets.live : ostiumPairs.live;
  const currentPrice = isDydx ? Number(market?.oraclePrice) : Number(market?.mid);
  const change24h = isDydx && market ? Number(market.priceChange24H) || 0 : null;

  /*
   * ── A dYdX EXIT IS SIZED BY THE POSITION IT CLOSES ─────────────────────────
   * Declared above the plan on purpose: the plan reads `positionSide`, and a
   * `const` referenced before its declaration is a TDZ error at render, not a
   * subtle bug later. The planner refuses a take-profit or stop-loss whose side
   * does not close the position — a long is closed by SELL, a short by BUY —
   * because the venue only enforces reduce-only on an order that is actually
   * reduce-only.
   */
  const [positions, setPositions] = useState([]);
  const [positionSide, setPositionSide] = useState(null);
  const isExit = kind === PERP_KIND.TAKE_PROFIT || kind === PERP_KIND.STOP_LOSS;
  useEffect(() => {
    if (!open || !isDydx || !dydxSessionAddress()) { setPositions([]); return; }
    const address = dydxSessionAddress();
    let alive = true;
    import('../../lib/dydx')
      .then(({ getDydxSubaccount }) => getDydxSubaccount(address, 0))
      .then((r) => {
        if (!alive || !mounted.current) return;
        const rows = Array.isArray(r?.account?.positions) ? r.account.positions : [];
        setPositions(rows.filter((p) => Number(p?.size) !== 0));
      })
      .catch(() => { if (alive && mounted.current) setPositions([]); });
    return () => { alive = false; };
  }, [open, isDydx]);

  const chosenPosition = positions.find((p) => p.market === marketId) || null;
  const chosenPositionSide = chosenPosition?.side === 'SHORT' ? 'SHORT' : chosenPosition?.side === 'LONG' ? 'LONG' : null;
  useEffect(() => {
    if (!isExit) { setPositionSide(null); return; }
    setPositionSide(chosenPositionSide);
    if (chosenPosition && !size) setSize(String(Math.abs(Number(chosenPosition.size))));
    if (chosenPosition) setSide(chosenPosition.side === 'LONG' ? 'sell' : 'buy');
    /* Deliberately keyed on the position, not on `size`: re-running this when
       the user edits the size would overwrite what they typed. */
  }, [isExit, chosenPosition?.market, chosenPositionSide]);

  /* ── Ostium needs an exact-amount USDC allowance before it can open ───── */
  useEffect(() => {
    if (!open || isDydx || !wallet.address || !Number(collateral)) { setAllowance(null); return; }
    let alive = true;
    (async () => {
      try {
        const { Contract, formatUnits } = await import('ethers');
        const provider = await wallet.getReadProvider(OSTIUM_CHAIN_ID);
        const { OSTIUM_COLLATERAL, OSTIUM_SPENDER } = await import('../../lib/ostium');
        const usdc = new Contract(OSTIUM_COLLATERAL, ['function allowance(address,address) view returns (uint256)'], provider);
        const value = Number(formatUnits(await usdc.allowance(wallet.address, OSTIUM_SPENDER), 6));
        if (alive && mounted.current) setAllowance(value);
      } catch {
        if (alive && mounted.current) setAllowance(null);
      }
    })();
    return () => { alive = false; };
  }, [open, isDydx, wallet.address, collateral, wallet.getReadProvider]);

  const dydxAddress = isDydx ? dydxSessionAddress() : null;
  const needsApproval = !isDydx && allowance != null && allowance + 1e-9 < Number(collateral || 0);

  /* ── the plan. This is the object that gets signed. ───────────────────── */
  const plan = useMemo(() => planPerpOrder({
    venue,
    kind,
    side,
    ...(isDydx
      ? {
        market,
        size,
        /* One price field, two meanings, decided by the kind: for a resting
           limit it is the price the order sits at, and for a trigger it is the
           price that fires it. The planner turns a trigger into the worst
           price the triggered market order may pay, so the user never types
           two numbers for one decision. */
        price,
        triggerPrice: kind === PERP_KIND.ENTRY_LIMIT ? null : price,
        currentPrice,
        goodTilSeconds: EXPIRY_SECONDS[expiryKey],
        /* A TP/SL auto-order is an exit, so it is reduce-only by definition.
           The planner refuses it unless a position side is known, which is why
           the exit kinds are only offered with a position selected — see the
           position picker below. */
        reduceOnly: kind === PERP_KIND.TAKE_PROFIT || kind === PERP_KIND.STOP_LOSS ? true : false,
        positionSide: positionSide || null,
        slippagePct: 0.5
      }
      : {
        pair: market,
        collateralUsd: collateral,
        leverage,
        price,
        currentPrice,
        takeProfit: takeProfit === '' ? null : takeProfit,
        stopLoss: stopLoss === '' ? null : stopLoss
      })
  }), [venue, kind, side, isDydx, market, size, price, currentPrice, expiryKey, collateral, leverage, takeProfit, stopLoss, positionSide]);

  const fee = plan.ok ? perpFeePreview(plan.request, { pairOpenFeeBps: market?.openFeeBps ?? market?.takerFeeP ?? null }) : null;
  const canReview = plan.ok && feedLive && Boolean(market) && (isDydx ? Boolean(dydxAddress) : Boolean(wallet.address));

  const errText = error ? (c.err[error] || error) : null;

  const isLongSide = side === 'buy' || side === 'long';

  /* A display-only notional, from the same numbers the planner will check.
     It never feeds the request — the planner recomputes and the review shows
     ITS figure — it only lets the user see the size of what they are typing
     before they reach the review. */
  const notionalPreview = isDydx
    ? (Number(size) > 0 && Number(price) > 0 ? Number(size) * Number(price) : null)
    : (Number(collateral) > 0 && Number(leverage) > 0 ? Number(collateral) * Number(leverage) : null);

  /* Closing is also a reset of the transient ends of the flow: reopening the
     popup onto yesterday's success panel or a stale review would be a lie
     about what is about to be signed. The typed numbers stay — they are the
     user's, and the plan re-validates them on every render. */
  const close = () => {
    setPlaced(null);
    setReviewing(false);
    setError(null);
    onClose();
  };

  /* ── ONE signature. Nothing schedules this. ───────────────────────────── */
  const place = async () => {
    if (!canReview || busy) return;
    setBusy(c.stageSign);
    setError(null);
    try {
      let record;
      if (isDydx) {
        const sent = await placeDydxAutoOrder({ market, request: plan.request });
        record = createPerpOrder({
          request: { ...plan.request, clientId: sent.clientId },
          venueOrderId: String(sent.clientId),
          txHash: sent.hash,
          wallet: dydxAddress,
          fee
        });
      } else {
        setBusy(c.stageSwitchChain);
        if (wallet.chainId !== OSTIUM_CHAIN_ID) {
          const ok = await wallet.switchChain?.(OSTIUM_CHAIN_ID);
          if (!ok) throw new Error('WRONG_CHAIN');
        }
        const signer = (await wallet.ensureSigner?.()) || wallet.getSigner?.();
        if (!signer) throw new Error('NOT_CONNECTED');

        if (needsApproval) {
          setBusy(c.stageApprove);
          /* Exact amount, never MaxUint256, and only as much as this order
             needs — the same rule the Ostium screen follows. */
          const approval = await buildApproveCollateral({ amountUsd: Number(collateral) });
          const sentApproval = await signer.sendTransaction({ to: approval.to, data: approval.data });
          await sentApproval.wait();
        }

        setBusy(c.stageSubmit);
        const tx = await buildOpenTrade({
          trader: wallet.address,
          pairId: plan.request.pairId,
          buy: plan.request.buy,
          price: plan.request.price,
          collateralUsd: plan.request.collateralUsd,
          leverage: plan.request.leverage,
          takeProfit: plan.request.takeProfit,
          stopLoss: plan.request.stopLoss,
          orderType: plan.request.orderType,
          /* The planner already forces 0 for a non-market order; passing it
             through keeps the two in agreement rather than trusting a default. */
          slippageBps: plan.request.slippageBps
        });
        const sent = await signer.sendTransaction({ to: tx.to, data: tx.data });
        record = createPerpOrder({
          request: plan.request,
          venueOrderId: null,
          txHash: sent.hash,
          wallet: wallet.address,
          fee
        });
      }

      if (!record) throw new Error(PERP_ERRORS.NO_MARKET);
      onPlaced(record);
      haptic?.('success');
      setReviewing(false);
      /* The popup stays open on its success panel: the order list below has
         just gained the row, and closing over the user's thumb to prove a
         placement is how a placement gets doubted and placed twice. */
      setPlaced(record);
    } catch (e) {
      const msg = String(e?.shortMessage || e?.reason || e?.message || '');
      const code = /rejected|denied|user rejected/i.test(msg) ? 'REJECTED'
        : /insufficient funds for gas/i.test(msg) ? 'SUBMIT_FAILED'
          : c.err[msg] ? msg : null;
      setError(code || (msg.length > 140 ? `${msg.slice(0, 137)}…` : msg) || 'SUBMIT_FAILED');
      haptic?.('error');
    } finally {
      if (mounted.current) setBusy('');
    }
  };

  if (!open) return null;

  const helpKey = isDydx
    ? (kind === PERP_KIND.ENTRY_LIMIT ? 'dydxLimit' : 'dydxTrigger')
    : (kind === PERP_KIND.ENTRY_LIMIT ? 'ostiumLimit' : 'ostiumStop');

  /* The warnings that are always true, in the order a reader meets them:
     the risk, the custody line, then whatever THIS venue adds. Ostium's two
     protocol facts (slippage must be zero; a cancel does not refund the
     placement fee) used to be a loose paragraph and a review-only footnote;
     inside «هشدار» they are read before the numbers are even finished. */
  const warnItems = [
    c.riskBody,
    c.nonCustodyBody,
    ...(!isDydx ? [c.slippageNote, c.cancelCostNote] : [])
  ];

  return (
    <Sheet open onClose={close} title={c.sectionTitle} size="lg" className="pao-sheet" testId="perp-auto-sheet">
      <div className="pao" data-testid="perp-auto-popup">
        {placed ? (
          /* ── PLACED: the button's end state, said out loud ─────────────── */
          <motion.div className="pao-done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-testid="perp-placed">
            <span className="pao-done-check"><IconCheck width={26} height={26} /></span>
            <p className="pao-done-title">{c.placedTitle}</p>
            <p className="pao-done-body">{c.placedBody}</p>
            <div className="pao-done-row">
              <button type="button" className="pao-cta" onClick={() => { setPlaced(null); setError(null); }} data-testid="perp-placed-new">
                {c.placedNew}
              </button>
              <button type="button" className="pao-back" onClick={close}>
                {c.placedClose}
              </button>
            </div>
          </motion.div>
        ) : (
          <>
            {/* ── HERO: the section's own paragraph, now inside its box ─── */}
            <div className="pao-hero">
              <div className="pao-hero-top">
                <span className="pao-hero-glyph"><IconActivity width={21} height={21} /></span>
                <p className="pao-hero-body">{c.sectionBody}</p>
              </div>
              <div className="pao-hero-chips">
                <span className="pao-chip"><IconCheck width={12} height={12} />{c.heroChip1}</span>
                <span className="pao-chip"><IconClock width={12} height={12} />{c.heroChip2}</span>
                <span className="pao-chip"><IconFingerprint width={12} height={12} />{c.heroChip3}</span>
              </div>
            </div>

            {/* ── VENUE TABS ──────────────────────────────────────────────── */}
            <div>
              <p className="pao-label" id="pao-venue-label"><IconTrend width={14} height={14} />{c.venueLabel}</p>
              <div className="pao-venues" role="radiogroup" aria-labelledby="pao-venue-label" style={{ marginTop: 7 }}>
                {PERP_VENUES.map((v) => (
                  <button key={v.id} type="button" role="radio" aria-checked={venue === v.id}
                    className={`pao-venue ${venue === v.id ? 'is-on' : ''}`}
                    onClick={() => { haptic?.('select'); pickVenue(v.id); }}
                    data-testid={`perp-venue-${v.id}`}>
                    <span className="pao-venue-mark"><VenueMark venue={v.id} /></span>
                    <span className="pao-venue-copy">
                      <span className="pao-venue-name">{v.label}</span>
                      <span className="pao-venue-sub">{v.id === PERP_VENUE.DYDX ? c.venueSubDydx : c.venueSubOstium}</span>
                    </span>
                    <span className="pao-venue-check" aria-hidden="true"><IconCheck width={11} height={11} /></span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── KIND CARDS ──────────────────────────────────────────────── */}
            <div>
              <p className="pao-label" id="pao-kind-label"><IconActivity width={14} height={14} />{c.kindLabel}</p>
              <div className="pao-kinds" role="radiogroup" aria-labelledby="pao-kind-label" style={{ marginTop: 7 }} data-testid="perp-kind-select">
                {(caps?.kinds || []).map((k) => {
                  const KindIcon = KIND_ICON[k] || IconTrend;
                  const tone = k === PERP_KIND.TAKE_PROFIT ? 'is-tp' : k === PERP_KIND.STOP_LOSS ? 'is-sl' : '';
                  return (
                    <button key={k} type="button" role="radio" aria-checked={kind === k} title={c.kinds[k] || k}
                      className={`pao-kind ${tone} ${kind === k ? 'is-on' : ''}`}
                      onClick={() => { haptic?.('select'); setKind(k); setError(null); setReviewing(false); }}
                      data-testid={`perp-kind-${k}`}>
                      <span className="pao-kind-ico"><KindIcon width={17} height={17} /></span>
                      <span className="pao-kind-copy">
                        <span className="pao-kind-name">{c.kindShort[k] || c.kinds[k] || k}</span>
                        <span className="pao-kind-sub">{c.kindSub[k] || ''}</span>
                      </span>
                      <span className="pao-kind-dot" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <p className="pao-help" style={{ marginTop: 8 }}>
                <IconInfo width={15} height={15} />
                <span>{c.kindHelp[helpKey]}</span>
              </p>
            </div>

            {/* ── MARKET, WITH ITS LOGO ───────────────────────────────────── */}
            <div>
              <label className="ord-field">
                <span className="faint">{c.marketLabel}</span>
                <ModernSelect value={marketId} onChange={(v) => { setMarketId(v); setError(null); setReviewing(false); }}
                  options={marketOptions} title={c.marketLabel} placeholder={c.marketLabel} ariaLabel={c.marketLabel}
                  testId="perp-market-select" searchable />
              </label>

              {market && (
                <div className="pao-market-live" style={{ marginTop: 8 }}>
                  <span className="pao-market-live-logo">
                    {isDydx
                      ? <AssetIcon symbol={baseOf(market.ticker)} size={38} />
                      : <AssetIcon base={String(market.from || '').toUpperCase()} quote={String(market.to || 'USD').toUpperCase()} size={38} />}
                  </span>
                  <div className="pao-market-live-copy">
                    <span className="pao-market-live-name">
                      {isDydx ? market.ticker : `${String(market.from || '').toUpperCase()}/${String(market.to || '').toUpperCase()}`}
                    </span>
                    <span className="pao-market-live-sub">
                      <span className={`pao-live-dot ${feedLive ? '' : 'is-off'}`} aria-hidden="true" />
                      {c.currentPriceLabel}
                    </span>
                  </div>
                  <div className="pao-market-live-price">
                    <span className="mono">{Number.isFinite(currentPrice) && currentPrice > 0 ? fmtPrice(currentPrice) : '—'}</span>
                    {change24h != null && (
                      <span className={`pao-chg ${change24h >= 0 ? 'is-up' : 'is-down'}`}>
                        {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!feedLive && (
                <p className="pao-alert is-warn" style={{ marginTop: 8 }}>
                  <IconAlertTriangle width={15} height={15} /><span>{c.marketsUnread}</span>
                </p>
              )}

              {/* ── AN EXIT IS SIZED BY THE POSITION IT CLOSES ──────────── */}
              {isExit && (
                <p className="pao-alert is-warn" style={{ marginTop: 8 }}>
                  <IconShield width={15} height={15} />
                  <span>
                    {chosenPosition
                      ? (isFa
                        ? `این سفارش فقط پوزیشن ${chosenPosition.market} (${chosenPosition.side === 'LONG' ? 'لانگ' : 'شورت'}) را می‌بندد؛ reduce-only توسط خودِ dYdX اعمال می‌شود.`
                        : `This order can only reduce your ${chosenPosition.market} position (${chosenPosition.side}); dYdX enforces reduce-only.`)
                      : (isFa
                        ? 'برای این بازار پوزیشن بازی پیدا نشد. حد سود و حد ضرر فقط روی پوزیشن باز ثبت می‌شود.'
                        : 'No open position found on this market. Take profit and stop loss can only be placed against an open position.')}
                  </span>
                </p>
              )}
            </div>

            {/* ── LONG / SHORT ────────────────────────────────────────────── */}
            {!isExit && (
              <div>
                <p className="pao-label" id="pao-side-label">
                  {isLongSide
                    ? <IconArrowUpRight width={14} height={14} />
                    : <IconArrowUpRight width={14} height={14} style={{ transform: 'rotate(90deg)' }} />}
                  {c.sideLabel}
                </p>
                <div className="pao-side" role="radiogroup" aria-labelledby="pao-side-label" style={{ marginTop: 7 }}>
                  {(isDydx
                    ? [['buy', c.sideLong, 'LONG', true], ['sell', c.sideShort, 'SHORT', false]]
                    : [['long', c.sideLong, 'LONG', true], ['short', c.sideShort, 'SHORT', false]]
                  ).map(([v, label, latin, up]) => (
                    <button key={v} type="button" role="radio" aria-checked={side === v}
                      className={`pao-side-btn ${up ? 'is-long' : 'is-short'} ${side === v ? 'is-on' : ''}`}
                      onClick={() => { haptic?.('select'); setSide(v); setReviewing(false); }}
                      data-testid={`perp-side-${v}`}>
                      <span className="pao-side-arrow">
                        <IconArrowUpRight width={16} height={16} style={up ? undefined : { transform: 'rotate(90deg)' }} />
                      </span>
                      <span className="pao-side-copy">
                        <span className="pao-side-name">{label}</span>
                        <span className="pao-side-latin">{latin}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── NUMBERS ─────────────────────────────────────────────────── */}
            <div className="pao-panel">
              <p className="pao-label" style={{ margin: 0 }}><IconTrend width={14} height={14} />{c.detailsLabel}</p>

              {isDydx ? (
                <label className="ord-field">
                  <span className="faint">{c.sizeLabel}</span>
                  <input type="number" inputMode="decimal" value={size} onChange={(e) => { setSize(e.target.value); setReviewing(false); }}
                    placeholder="0.001" data-testid="perp-size" />
                  <span className="faint" style={{ fontSize: 11 }}>{c.sizeHint}</span>
                </label>
              ) : (
                <div className="pao-grid2">
                  <label className="ord-field">
                    <span className="faint">{c.collateralLabel}</span>
                    <input type="number" inputMode="decimal" value={collateral} onChange={(e) => { setCollateral(e.target.value); setReviewing(false); }}
                      placeholder="50" data-testid="perp-collateral" />
                  </label>
                  <label className="ord-field">
                    <span className="faint">{c.leverageLabel}</span>
                    <input type="number" inputMode="decimal" value={leverage} onChange={(e) => { setLeverage(e.target.value); setReviewing(false); }}
                      placeholder="5" data-testid="perp-leverage" />
                  </label>
                </div>
              )}

              <label className="ord-field">
                <span className="faint">{kind === PERP_KIND.ENTRY_LIMIT ? c.priceLabel : c.triggerLabel}</span>
                <input type="number" inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); setReviewing(false); }}
                  placeholder={Number.isFinite(currentPrice) && currentPrice > 0 ? String(currentPrice) : '0.00'} data-testid="perp-price" />
                {Number.isFinite(currentPrice) && currentPrice > 0 && (
                  /* The live price as a tappable chip: the most-typed number in
                     this form is "near the market", and copying six digits by
                     hand is how a fat finger becomes an order. */
                  <button type="button" className="pao-price-now"
                    onClick={() => { setPrice(String(currentPrice)); setReviewing(false); }}
                    data-testid="perp-price-now">
                    {c.currentPriceLabel}: <span className="mono">{fmtPrice(currentPrice)}</span>
                  </button>
                )}
              </label>

              {!isDydx && (
                <div className="pao-grid2">
                  <label className="ord-field">
                    <span className="faint">{c.tpLabel}</span>
                    <input type="number" inputMode="decimal" value={takeProfit} onChange={(e) => { setTakeProfit(e.target.value); setReviewing(false); }} placeholder="—" />
                  </label>
                  <label className="ord-field">
                    <span className="faint">{c.slLabel}</span>
                    <input type="number" inputMode="decimal" value={stopLoss} onChange={(e) => { setStopLoss(e.target.value); setReviewing(false); }} placeholder="—" />
                  </label>
                </div>
              )}

              {notionalPreview != null && (
                <div className="pao-notional">
                  <span className="faint">{c.reviewNotional}</span>
                  <span className="mono">{fmtUsd(notionalPreview)}</span>
                </div>
              )}
            </div>

            {/* ── LIFETIME (dYdX only — Ostium resting orders have none) ── */}
            {isDydx && (
              <div>
                <p className="pao-label" id="pao-expiry-label"><IconClock width={14} height={14} />{c.expiryLabel}</p>
                <div className="segmented pao-seg" role="radiogroup" aria-labelledby="pao-expiry-label" style={{ marginTop: 7 }} data-testid="perp-expiry-select">
                  {Object.keys(EXPIRY_SECONDS).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={expiryKey === k}
                      className={expiryKey === k ? 'active' : ''} aria-pressed={expiryKey === k}
                      onClick={() => { haptic?.('select'); setExpiryKey(k); setReviewing(false); }}
                      style={{ isolation: 'isolate' }} data-testid={`perp-expiry-${k}`}>
                      {expiryKey === k && <SegIndicator id={`perp-expiry-${k}`} />}
                      {c.expiryOptions[k] || k}
                    </button>
                  ))}
                </div>
                <p className="pao-expiry-hint" style={{ marginTop: 7 }}>
                  <IconInfo width={13} height={13} /><span>{c.expiryHint}</span>
                </p>
              </div>
            )}

            {/* ── «هشدار»: the process and the warnings, in one fold ─────── */}
            <CollapsibleCard
              id="perp-warn-fold"
              className="pao-warn-fold"
              title={c.warnTitle}
              subtitle={c.warnSub}
              icon={<IconAlertTriangle width={18} height={18} />}
              badge={warnItems.length}
              defaultOpen
            >
              <div className="pao-warn-body">
                <div>
                  <p className="pao-warn-h"><IconActivity width={14} height={14} />{c.howTitle}</p>
                  <ol className="pao-steps" style={{ marginTop: 9 }}>
                    {[c.howStep1, c.howStep2, c.howStep3].map((s, i) => (
                      <li key={i} className="pao-step">
                        <span className="pao-step-n">{i + 1}</span>
                        <p>{s}</p>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="pao-warn-h"><IconShield width={14} height={14} />{c.riskTitle}</p>
                  <div className="pao-warn-list" style={{ marginTop: 8 }}>
                    {warnItems.map((s, i) => (
                      <p key={i} className="pao-warn-item">
                        <IconAlertTriangle width={14} height={14} /><span>{s}</span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </CollapsibleCard>

            {/* ── WHY IT CANNOT BE PLACED, SAID BEFORE THE BUTTON ───────── */}
            {((!plan.ok && market) || (isDydx && !dydxAddress) || (!isDydx && !wallet.address)
              || (!isDydx && wallet.address && wallet.chainId !== OSTIUM_CHAIN_ID) || needsApproval) && (
              <div className="pao-alerts" data-testid="perp-alerts">
                {!plan.ok && market && (
                  <p className="pao-alert is-error">
                    <IconAlertTriangle width={15} height={15} /><span>{c.err[plan.error] || plan.error}</span>
                  </p>
                )}
                {isDydx && !dydxAddress && (
                  <p className="pao-alert is-info">
                    <IconInfo width={15} height={15} />
                    <span>
                      {c.connectDydxFirst}{' '}
                      <button type="button" className="pao-alert-link" onClick={() => { close(); navigate('/perp?tab=dydx'); }}>
                        dYdX →
                      </button>
                    </span>
                  </p>
                )}
                {!isDydx && !wallet.address && (
                  <p className="pao-alert is-warn">
                    <IconAlertTriangle width={15} height={15} /><span>{c.connectWalletFirst}</span>
                  </p>
                )}
                {!isDydx && wallet.address && wallet.chainId !== OSTIUM_CHAIN_ID && (
                  <p className="pao-alert is-warn">
                    <IconAlertTriangle width={15} height={15} /><span>{c.switchNetwork}</span>
                  </p>
                )}
                {needsApproval && (
                  <p className="pao-alert is-info">
                    <IconInfo width={15} height={15} /><span>{c.approveFirst}</span>
                  </p>
                )}
              </div>
            )}

            {/* ── REVIEW, THEN ONE SIGNATURE ──────────────────────────────── */}
            {plan.ok && !reviewing && (
              <div>
                <button type="button" className="pao-cta" disabled={!canReview}
                  onClick={() => { haptic?.('select'); setReviewing(true); }} data-testid="perp-review">
                  <IconCheck width={18} height={18} />
                  {c.reviewTitle}
                </button>
                {!canReview && !market && <p className="pao-cta-hint" style={{ marginTop: 7 }}>{c.err.NO_MARKET}</p>}
              </div>
            )}

            {plan.ok && reviewing && (
              <motion.div className="pao-review" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-testid="perp-review-card">
                <div className="pao-review-head">
                  <span className="pao-market-live-logo" style={{ width: 34, height: 34, borderRadius: 11 }}>
                    {isDydx
                      ? <AssetIcon symbol={baseOf(plan.request.ticker)} size={34} />
                      : <AssetIcon symbol={baseOf(plan.request.pairLabel)} size={34} />}
                  </span>
                  <div className="pao-market-live-copy">
                    <span className="pao-market-live-name">{isDydx ? plan.request.ticker : plan.request.pairLabel}</span>
                    <span className="pao-market-live-sub">{caps.label} · {c.kindShort[kind] || kind}</span>
                  </div>
                  <span className={`pao-side-chip ${isLongSide ? 'is-long' : 'is-short'}`}>
                    {isLongSide ? c.sideLong : c.sideShort}
                  </span>
                </div>

                <div>
                  <Row k={c.reviewVenue} v={caps.label} />
                  <Row k={c.reviewKind} v={c.kinds[kind] || kind} />
                  <Row k={c.reviewMarket} v={isDydx ? plan.request.ticker : plan.request.pairLabel} />
                  <Row k={c.reviewSide} v={isLongSide ? c.sideBuy : c.sideSell} />
                  {isDydx && <Row k={c.reviewSize} v={`${fmtNum(plan.request.size)} ${String(plan.request.ticker).split('-')[0]}`} mono />}
                  {isDydx && <Row k={c.reviewPrice} v={fmtPrice(plan.request.price)} mono />}
                  {plan.request.triggerPrice != null && <Row k={c.reviewTrigger} v={fmtPrice(plan.request.triggerPrice)} mono />}
                  {!isDydx && <Row k={c.reviewCollateral} v={fmtUsd(plan.request.collateralUsd)} mono />}
                  {!isDydx && <Row k={c.reviewLeverage} v={`${fmtNum(plan.request.leverage, 3)}×`} mono />}
                  {!isDydx && <Row k={c.reviewNotional} v={fmtUsd(plan.request.notionalUsd)} mono />}
                  {!isDydx && plan.request.takeProfit !== '0' && <Row k={c.reviewTp} v={fmtPrice(Number(plan.request.takeProfit))} mono />}
                  {!isDydx && plan.request.stopLoss !== '0' && <Row k={c.reviewSl} v={fmtPrice(Number(plan.request.stopLoss))} mono />}
                  {isDydx && <Row k={c.reviewExpiry} v={c.expiryOptions[expiryKey] || expiryKey} />}
                </div>

                {fee && (
                  <div>
                    <Row k={c.reviewFeeOurs} v={`${fmtUsd(fee.ourFeeUsd)} · ${fmtNum(fee.ourBps, 4)} bps`} mono />
                    {fee.venueFeeUsd != null && <Row k={c.reviewFeeVenue} v={fmtUsd(fee.venueFeeUsd)} mono />}
                    {fee.oracleFeeUsd > 0 && <Row k={c.reviewFeeOracle} v={fmtUsd(fee.oracleFeeUsd)} mono />}
                    {fee.totalFeeUsd != null && <Row k={c.reviewFeeTotal} v={fmtUsd(fee.totalFeeUsd)} mono />}
                    {fee.totalFeeUsd == null && <p className="faint" style={{ margin: 0, fontSize: 11.5 }}>{c.reviewFeeUnknown}</p>}
                    {fee.ourFeePctOfCollateral != null && fee.ourFeePctOfCollateral > 0.005 && (
                      <p className="faint" style={{ margin: 0, fontSize: 11.5 }}>
                        {c.feePctOfCollateral.replace('{{pct}}', fee.ourFeePctOfCollateral.toFixed(2))}
                      </p>
                    )}
                  </div>
                )}

                <p className="faint" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.7 }}>{c.roundedNote}</p>

                <div className="pao-review-risk">
                  <p className="pao-review-risk-title">
                    <IconShield width={15} height={15} />{c.riskTitle}
                  </p>
                  <p>{c.riskBody}</p>
                  <p>{c.nonCustodyBody}</p>
                </div>

                {errText && (
                  <p className="pao-alert is-error" data-testid="perp-error">
                    <IconAlertTriangle width={15} height={15} /><span>{errText}</span>
                  </p>
                )}

                <button type="button" className={`pao-cta pao-place ${isLongSide ? 'is-long' : 'is-short'}`}
                  disabled={!canReview || Boolean(busy)} onClick={place} data-testid="perp-place">
                  {busy
                    ? <><span className="pao-spin" aria-hidden="true" />{busy}</>
                    : <><IconFingerprint width={19} height={19} />{c.place}</>}
                </button>
                <button type="button" className="pao-back" disabled={Boolean(busy)} onClick={() => setReviewing(false)}>
                  {c.backLabel}
                </button>
              </motion.div>
            )}
          </>
        )}

        {/* ── ORDERS ALREADY RESTING ON A VENUE ─────────────────────────── */}
        <div className="pao-divider"><span>{c.listTitle}</span></div>

        {book.notice && (
          <p className="pao-alert is-warn">
            <IconAlertTriangle width={15} height={15} /><span>{book.notice}</span>
          </p>
        )}

        {book.live.length > 0 && (
          <>
            <div className="pao-label-row">
              <span className="faint" style={{ fontSize: 11.5 }}>{c.listTitle} · {book.live.length}</span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={book.reading} onClick={book.onRefresh}
                style={{ minHeight: 34, fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 5 }} data-testid="perp-refresh">
                <IconRefresh width={13} height={13} />
                {book.reading ? '…' : c.refreshState}
              </button>
            </div>
            {!book.readLive && (
              <p className="pao-alert is-warn" style={{ fontSize: 11.5 }}>
                <IconAlertTriangle width={14} height={14} /><span>{c.feedDown}</span>
              </p>
            )}
            <div className="stack" style={{ gap: 8 }}>
              <AnimatePresence>
                {book.live.map((o) => (
                  <PerpOrderRow key={o.id} o={o} c={c} lang={lang} onCancel={book.onCancel} cancelling={book.cancelling} stale={!book.readLive} />
                ))}
              </AnimatePresence>
            </div>
          </>
        )}

        {book.done.length > 0 && (
          <CollapsibleCard
            id="perp-done-fold"
            className="pao-done-fold"
            title={c.listDone}
            icon={<IconCheck width={17} height={17} />}
            badge={book.done.length}
          >
            <div className="stack" style={{ gap: 8 }}>
              {book.done.slice(0, 10).map((o) => (
                <PerpOrderRow key={o.id} o={o} c={c} lang={lang} onCancel={book.onCancel} cancelling={book.cancelling} stale={false} />
              ))}
            </div>
          </CollapsibleCard>
        )}

        {book.total === 0 && (
          <div className="pao-empty">
            <IconActivity width={20} height={20} />
            <p>{c.listEmpty}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Row({ k, v, mono }) {
  return (
    <div className="pao-rrow">
      <span className="pao-rrow-k">{k}</span>
      <span className={`pao-rrow-v ${mono ? 'mono' : ''}`}>{v}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * What «سفارش خودکار» mounts: ONE rail card, twin of the other order types,
 * and the popup behind it. The card carries the live-order count the rail
 * already uses as its status strip, so moving the section into the popup
 * does not hide a resting order from the page.
 * ──────────────────────────────────────────────────────────────────────────── */
export default function PerpAutoOrders({ lang }) {
  const c = perpAutoCopyFor(lang);
  const wallet = useWallet();
  const { haptic } = useTelegram();
  const [orders, setOrders] = useState([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [readLive, setReadLive] = useState(true);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    setOrders(expirePerpOrders(loadPerpOrders()));
  }, []);

  const persist = useCallback((next) => {
    setOrders(next);
    savePerpOrders(next);
  }, []);

  /*
   * READ THE VENUE, NEVER GUESS.
   *
   * dYdX answers from its indexer by clientId; a resting limit is OPEN and a
   * trigger is UNTRIGGERED until it fires. Ostium answers from its subgraph,
   * where a cancelled limit leaves no row at all — so absence is reported as
   * «read failed / unknown», not as a cancel we invented.
   */
  const readStates = useCallback(async () => {
    setReading(true);
    let live = true;
    try {
      const dydxAddr = dydxSessionAddress();
      const next = [...orders];

      const dydxRows = next.filter((o) => o.venue === PERP_VENUE.DYDX && o.status === 'active');
      if (dydxRows.length) {
        if (!dydxAddr) {
          live = false;
        } else {
          const [open, untriggered] = await Promise.all([
            getDydxOrders({ address: dydxAddr, subaccount: 0, status: 'OPEN' }),
            getDydxOrders({ address: dydxAddr, subaccount: 0, status: 'UNTRIGGERED' })
          ]);
          if (!open.live || !untriggered.live) live = false;
          const resting = new Map([...(open.orders || []), ...(untriggered.orders || [])]
            .map((o) => [String(o.clientId), o]));
          for (const row of dydxRows) {
            const i = next.findIndex((o) => o.id === row.id);
            if (i < 0) continue;
            const found = resting.get(String(row.venueOrderId));
            if (found) {
              next[i] = applyPerpState(next[i], PERP_STATE.OPEN, { live: true });
            } else {
              /* Not resting any more. FILLED and CANCELED are separate reads,
                 and only one of them can be true. */
              const [filled, canceled] = await Promise.all([
                getDydxOrders({ address: dydxAddr, subaccount: 0, status: 'FILLED' }),
                getDydxOrders({ address: dydxAddr, subaccount: 0, status: 'CANCELED' })
              ]);
              const isFilled = (filled.orders || []).some((o) => String(o.clientId) === String(row.venueOrderId));
              const isCancelled = (canceled.orders || []).some((o) => String(o.clientId) === String(row.venueOrderId));
              next[i] = applyPerpState(next[i],
                isFilled ? PERP_STATE.FILLED : isCancelled ? PERP_STATE.CANCELLED : PERP_STATE.UNKNOWN,
                { live: filled.live || canceled.live });
              if (!filled.live && !canceled.live) live = false;
            }
          }
        }
      }

      const ostiumRows = next.filter((o) => o.venue === PERP_VENUE.OSTIUM && o.status === 'active');
      if (ostiumRows.length) {
        const trader = ostiumRows.find((o) => o.wallet)?.wallet || wallet.address;
        const r = trader ? await getOstiumOpenOrders({ trader }) : { orders: [], live: false };
        if (!r.live) live = false;
        for (const row of ostiumRows) {
          const i = next.findIndex((o) => o.id === row.id);
          if (i < 0) continue;
          const found = (r.orders || []).find((x) => String(x.pairId) === String(row.marketId)
            && (row.cancelRef?.index == null || x.index === row.cancelRef.index));
          if (found) {
            next[i] = applyPerpState(next[i], PERP_STATE.OPEN, { live: true, venueOrderId: found.id });
            /* The slot is only known once the subgraph has indexed the order;
               a cancel needs it, so it is captured the first time it appears. */
            if (found.index != null && next[i].cancelRef?.index == null) {
              next[i] = { ...next[i], cancelRef: { ...next[i].cancelRef, index: found.index } };
            }
          } else {
            next[i] = applyPerpState(next[i], PERP_STATE.UNKNOWN, { live: r.live });
          }
        }
      }

      if (mounted.current) {
        setReadLive(live);
        persist(expirePerpOrders(next));
      }
    } finally {
      if (mounted.current) setReading(false);
    }
  }, [orders, wallet.address, persist]);

  useEffect(() => {
    if (!orders.some((o) => o.status === 'active')) return;
    let alive = true;
    const id = setTimeout(() => { if (alive) readStates(); }, 400);
    return () => { alive = false; clearTimeout(id); };
    /* Runs on mount and after a placement, not on a timer: the venue holds the
       order, so polling it from a phone is a battery cost with no upside. */
  }, [orders.length]);

  const cancel = async (o) => {
    if (cancelling) return;
    setCancelling(o.id);
    setNotice(null);
    try {
      if (o.venue === PERP_VENUE.DYDX) {
        const address = dydxSessionAddress();
        if (!address) throw new Error('NOT_CONNECTED');
        const { getDydxMarkets: markets } = await import('../../lib/dydx');
        const r = await markets();
        const market = (r.markets || []).find((m) => m.ticker === o.marketId);
        if (!market) throw new Error('NO_MARKET');
        await cancelDydxOrder({
          market,
          clientId: o.cancelRef?.clientId ?? o.venueOrderId,
          orderFlags: o.cancelRef?.orderFlags || 'CONDITIONAL',
          goodTilSeconds: o.expiresAt ? Math.max(60, Math.round((o.expiresAt - Date.now()) / 1000)) : null
        });
      } else {
        if (wallet.chainId !== OSTIUM_CHAIN_ID) {
          const ok = await wallet.switchChain?.(OSTIUM_CHAIN_ID);
          if (!ok) throw new Error('WRONG_CHAIN');
        }
        const signer = (await wallet.ensureSigner?.()) || wallet.getSigner?.();
        if (!signer) throw new Error('NOT_CONNECTED');
        const idx = o.cancelRef?.index;
        /* The slot is a uint8 the subgraph reports; without it there is nothing
           to cancel by, and guessing one could cancel another order. */
        if (idx == null) {
          const r = await getOstiumOpenOrders({ trader: o.wallet || wallet.address });
          const found = (r.orders || []).find((x) => String(x.pairId) === String(o.marketId));
          if (!found || found.index == null) throw new Error('CANCEL_FAILED');
          const tx = await buildCancelLimitOrder({ pairId: found.pairId, index: found.index });
          const sent = await signer.sendTransaction({ to: tx.to, data: tx.data });
          await sent.wait();
        } else {
          const tx = await buildCancelLimitOrder({ pairId: o.marketId, index: idx });
          const sent = await signer.sendTransaction({ to: tx.to, data: tx.data });
          await sent.wait();
        }
      }
      persist(updatePerpOrder(orders, o.id, { status: 'cancelled', cancelledAt: Date.now(), venueState: PERP_STATE.CANCELLED }));
      haptic?.('success');
    } catch (e) {
      const msg = String(e?.shortMessage || e?.reason || e?.message || '');
      setNotice(/rejected|denied/i.test(msg) ? c.err.REJECTED : (c.err[msg] || c.err.CANCEL_FAILED));
    } finally {
      if (mounted.current) setCancelling(null);
    }
  };

  /* Perpetuals are speculation: in a build where the flag is off the routes,
     the pages and this card are all absent, not hidden. */
  if (!SPECULATION_ENABLED) return null;

  const live = perpOrdersLive(orders);
  const done = perpOrdersDone(orders);

  return (
    <>
      {/* The eighth card in the order-type rail. Same geometry, same count
          badge, its own hue — rgb-7 was the one rail accent no other type
          had claimed. */}
      <motion.button
        type="button"
        className="ord-new-card ord-new-perp"
        style={{ '--hue': 'var(--rgb-7)' }}
        whileTap={{ scale: 0.97 }}
        onClick={() => { haptic?.('select'); setSheetOpen(true); }}
        data-testid="perp-open-sheet"
      >
        {live.length > 0 && <span className="ord-new-count">{live.length}</span>}
        <span className="ord-new-glyph"><IconActivity width={22} height={22} /></span>
        <span className="ord-new-label">{c.openSheet}</span>
        <span className="ord-new-sub">{c.cardSub}</span>
      </motion.button>

      <PerpVenuePopup
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        lang={lang}
        onPlaced={(record) => persist(addPerpOrder(orders, record))}
        book={{
          live,
          done,
          total: orders.length,
          cancelling,
          readLive,
          reading,
          notice,
          onRefresh: readStates,
          onCancel: cancel
        }}
      />
    </>
  );
}
