import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Sheet from '../Sheet';
import SegIndicator from '../SegIndicator';
import ModernSelect from '../ModernSelect';
import InfoBox from '../InfoBox';
import { IconExternal, IconShield, IconTrend } from '../Icons';
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

/*
 * ─── AUTO-ORDERS THAT A VENUE EXECUTES ───────────────────────────────────────
 *
 * Everything else on «سفارش خودکار» either watches a price and asks the user
 * to sign, or hands a swap to a solver network. This section is the third
 * thing: an order that is placed ON a perpetual venue the app already has a
 * signed, non-custodial path to, and that the venue fills by itself — while
 * the app is closed, with no server of ours in the path, and with our builder
 * fee inside the signed order.
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
  const sideLabel = o.venue === PERP_VENUE.DYDX
    ? (o.side === 'buy' ? c.sideBuy : c.sideSell)
    : (o.side === 'long' ? c.sideBuy : c.sideSell);
  return (
    <motion.div className="card" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid={`perp-order-${o.id}`}>
      <div className="row-between" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 7, minWidth: 0 }}>
          {/* The venue badge reuses the execution-mode badge the limit orders
              already wear: same shape, same colour language, and no new CSS
              for a reader of this page to learn. */}
          <span className="ord-badge is-keeper">{o.venue === PERP_VENUE.DYDX ? 'dYdX' : 'Ostium'}</span>
          <strong style={{ fontSize: 13.5 }}>{o.market}</strong>
          <span className="faint" style={{ fontSize: 12 }}>{sideLabel}</span>
        </div>
        <span className={o.venueState === PERP_STATE.FILLED ? 'ord-status-ready'
          : o.venueState === PERP_STATE.OPEN ? 'ord-status-quote-below'
            : o.venueState === PERP_STATE.UNKNOWN ? 'ord-status-unavailable'
              : 'ord-badge is-watch'}
        style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
          {c[stateKey]}
        </span>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
        <span className="faint">{c.kinds[o.kind] || o.kind}</span>
        {o.size != null && <span className="mono">{c.reviewSize}: {fmtNum(o.size)}</span>}
        {o.collateralUsd != null && <span className="mono">{c.reviewCollateral}: {fmtUsd(o.collateralUsd)}</span>}
        {o.leverage != null && <span className="mono">{c.reviewLeverage}: {fmtNum(o.leverage, 3)}×</span>}
        {o.triggerPrice != null && <span className="mono">{c.reviewTrigger}: {fmtPrice(o.triggerPrice)}</span>}
        {o.price != null && <span className="mono">{c.reviewPrice}: {fmtPrice(o.price)}</span>}
      </div>

      {stale && o.status === 'active' && (
        <p className="ord-warn" style={{ margin: 0, fontSize: 11.5 }}>{c.stateUnknown}</p>
      )}

      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
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
 * The sheet: venue → kind → market → numbers → review → one signature
 * ──────────────────────────────────────────────────────────────────────────── */
function PerpAutoOrderSheet({ open, onClose, lang, onPlaced }) {
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

  const marketOptions = useMemo(() => (isDydx
    ? dydxMarkets.list
      .filter((m) => String(m.status || '').toUpperCase() === 'ACTIVE')
      .map((m) => ({ value: m.ticker, label: m.ticker, sublabel: `${fmtPrice(m.oraclePrice)} · 24h ${(Number(m.priceChange24H) || 0).toFixed(1)}%` }))
    : ostiumPairs.list
      .map((p) => ({
        value: String(p.pairId),
        label: `${String(p.from || '').toUpperCase()}/${String(p.to || '').toUpperCase()}`,
        sublabel: `${p.isMarketOpen === false ? (isFa ? 'بسته' : 'closed') : fmtPrice(p.mid)} · ${(p.group?.name || p.category || '').toString().slice(0, 18)}`,
        disabled: p.isMarketOpen === false
      }))
  ), [isDydx, dydxMarkets.list, ostiumPairs.list, isFa]);

  const market = useMemo(() => (isDydx
    ? dydxMarkets.list.find((m) => m.ticker === marketId) || null
    : ostiumPairs.list.find((p) => String(p.pairId) === String(marketId)) || null
  ), [isDydx, marketId, dydxMarkets.list, ostiumPairs.list]);

  const feedLive = isDydx ? dydxMarkets.live : ostiumPairs.live;
  const currentPrice = isDydx ? Number(market?.oraclePrice) : Number(market?.mid);

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
      onClose();
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

  const kindOptions = (caps?.kinds || []).map((k) => ({ value: k, label: c.kinds[k] || k }));
  const helpKey = isDydx
    ? (kind === PERP_KIND.ENTRY_LIMIT ? 'dydxLimit' : 'dydxTrigger')
    : (kind === PERP_KIND.ENTRY_LIMIT ? 'ostiumLimit' : 'ostiumStop');

  return (
    <Sheet open onClose={onClose} title={c.openSheet}>
      <div className="stack" style={{ gap: 11 }}>
        <p className="muted" style={{ lineHeight: 1.8, fontSize: 12.5, margin: 0 }}>{c.sectionBody}</p>

        {/* ── VENUE ─────────────────────────────────────────────────────── */}
        <div className="ord-mode" role="group" aria-label={c.venueLabel}>
          <div className="segmented">
            {PERP_VENUES.map((v) => (
              <button key={v.id} type="button" className={venue === v.id ? 'active' : ''}
                aria-pressed={venue === v.id} onClick={() => pickVenue(v.id)}
                style={{ isolation: 'isolate', minHeight: 44 }} data-testid={`perp-venue-${v.id}`}>
                {venue === v.id && <SegIndicator id={`perp-venue-${v.id}`} />}
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── KIND ──────────────────────────────────────────────────────── */}
        <label className="ord-field">
          <span className="faint">{c.kindLabel}</span>
          <ModernSelect value={kind} onChange={(v) => { setKind(v); setError(null); setReviewing(false); }}
            options={kindOptions} title={c.kindLabel} placeholder={c.kindLabel} ariaLabel={c.kindLabel}
            testId="perp-kind-select" />
        </label>
        <p className="faint" style={{ lineHeight: 1.75, fontSize: 12, margin: 0 }}>{c.kindHelp[helpKey]}</p>

        {/* ── MARKET ────────────────────────────────────────────────────── */}
        <label className="ord-field">
          <span className="faint">{c.marketLabel}</span>
          <ModernSelect value={marketId} onChange={(v) => { setMarketId(v); setError(null); setReviewing(false); }}
            options={marketOptions} title={c.marketLabel} placeholder={c.marketLabel} ariaLabel={c.marketLabel}
            testId="perp-market-select" searchable />
        </label>
        {!feedLive && (
          <p className="ord-warn" style={{ margin: 0 }}>{isFa ? 'فهرست بازارها از ونوو خوانده نشد؛ بدون قیمت زنده سفارشی ثبت نمی‌شود.' : 'The market list could not be read from the venue. Nothing is placed without a live price.'}</p>
        )}

        {/* ── AN EXIT IS SIZED BY THE POSITION IT CLOSES ────────────────── */}
        {isExit && (
          <InfoBox tone="warn" title={c.riskTitle}>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.75 }}>
              {chosenPosition
                ? (isFa
                  ? `این سفارش فقط پوزیشن ${chosenPosition.market} (${chosenPosition.side === 'LONG' ? 'لانگ' : 'شورت'}) را می‌بندد؛ reduce-only توسط خودِ dYdX اعمال می‌شود.`
                  : `This order can only reduce your ${chosenPosition.market} position (${chosenPosition.side}); dYdX enforces reduce-only.`)
                : (isFa
                  ? 'برای این بازار پوزیشن بازی پیدا نشد. حد سود و حد ضرر فقط روی پوزیشن باز ثبت می‌شود.'
                  : 'No open position found on this market. Take profit and stop loss can only be placed against an open position.')}
            </p>
          </InfoBox>
        )}

        {/* ── SIDE ──────────────────────────────────────────────────────── */}
        {!isExit && (
          <div className="ord-mode" role="group" aria-label={c.sideLabel}>
            <div className="segmented">
              {(isDydx ? [['buy', c.sideBuy], ['sell', c.sideSell]] : [['long', c.sideBuy], ['short', c.sideSell]]).map(([v, label]) => (
                <button key={v} type="button" className={side === v ? 'active' : ''} aria-pressed={side === v}
                  onClick={() => { setSide(v); setReviewing(false); }} style={{ isolation: 'isolate', minHeight: 44 }}
                  data-testid={`perp-side-${v}`}>
                  {side === v && <SegIndicator id={`perp-side-${v}`} />}
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── NUMBERS ───────────────────────────────────────────────────── */}
        {isDydx ? (
          <label className="ord-field">
            <span className="faint">{c.sizeLabel}</span>
            <input type="number" inputMode="decimal" value={size} onChange={(e) => { setSize(e.target.value); setReviewing(false); }}
              placeholder="0.001" data-testid="perp-size" />
            <span className="faint" style={{ fontSize: 11 }}>{c.sizeHint}</span>
          </label>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <label className="ord-field" style={{ flex: 1, minWidth: 0 }}>
              <span className="faint">{c.collateralLabel}</span>
              <input type="number" inputMode="decimal" value={collateral} onChange={(e) => { setCollateral(e.target.value); setReviewing(false); }}
                placeholder="50" data-testid="perp-collateral" />
            </label>
            <label className="ord-field" style={{ flex: 1, minWidth: 0 }}>
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
            <span className="faint" style={{ fontSize: 11 }}>{c.currentPriceLabel}: {fmtPrice(currentPrice)}</span>
          )}
        </label>

        {!isDydx && (
          <div className="row" style={{ gap: 8 }}>
            <label className="ord-field" style={{ flex: 1, minWidth: 0 }}>
              <span className="faint">{c.tpLabel}</span>
              <input type="number" inputMode="decimal" value={takeProfit} onChange={(e) => { setTakeProfit(e.target.value); setReviewing(false); }} placeholder="—" />
            </label>
            <label className="ord-field" style={{ flex: 1, minWidth: 0 }}>
              <span className="faint">{c.slLabel}</span>
              <input type="number" inputMode="decimal" value={stopLoss} onChange={(e) => { setStopLoss(e.target.value); setReviewing(false); }} placeholder="—" />
            </label>
          </div>
        )}

        {isDydx && (
          <label className="ord-field">
            <span className="faint">{c.expiryLabel}</span>
            <ModernSelect value={expiryKey} onChange={setExpiryKey}
              options={Object.keys(EXPIRY_SECONDS).map((k) => ({ value: k, label: c.expiryOptions[k] || k }))}
              title={c.expiryLabel} placeholder={c.expiryLabel} ariaLabel={c.expiryLabel} testId="perp-expiry-select" />
          </label>
        )}

        {!isDydx && <p className="faint" style={{ lineHeight: 1.75, fontSize: 11.5, margin: 0 }}>{c.slippageNote}</p>}

        {/* ── WHY IT CANNOT BE PLACED, SAID BEFORE THE BUTTON ───────────── */}
        {!plan.ok && market && (
          <p className="ord-warn" style={{ margin: 0 }}>{c.err[plan.error] || plan.error}</p>
        )}
        {isDydx && !dydxAddress && (
          <InfoBox tone="info">
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.75 }}>
              {c.connectDydxFirst}{' '}
              <button type="button" onClick={() => { onClose(); navigate('/perp?tab=dydx'); }}
                style={{ background: 'none', border: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
                dYdX →
              </button>
            </p>
          </InfoBox>
        )}
        {!isDydx && !wallet.address && (
          <p className="ord-warn" style={{ margin: 0 }}>{c.connectWalletFirst}</p>
        )}
        {!isDydx && wallet.address && wallet.chainId !== OSTIUM_CHAIN_ID && (
          <p className="ord-warn" style={{ margin: 0 }}>{c.switchNetwork}</p>
        )}
        {needsApproval && <p className="ord-warn" style={{ margin: 0 }}>{c.approveFirst}</p>}

        {/* ── REVIEW ────────────────────────────────────────────────────── */}
        {plan.ok && !reviewing && (
          <button type="button" className="btn" disabled={!canReview} onClick={() => { haptic?.('select'); setReviewing(true); }}
            style={{ minHeight: 44 }} data-testid="perp-review">
            {c.reviewTitle}
          </button>
        )}

        {plan.ok && reviewing && (
          <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <p className="section-label" style={{ margin: 0 }}>{c.reviewTitle}</p>
            <Row k={c.reviewVenue} v={caps.label} />
            <Row k={c.reviewKind} v={c.kinds[kind] || kind} />
            <Row k={c.reviewMarket} v={isDydx ? plan.request.ticker : plan.request.pairLabel} />
            <Row k={c.reviewSide} v={side === 'buy' || side === 'long' ? c.sideBuy : c.sideSell} />
            {isDydx && <Row k={c.reviewSize} v={`${fmtNum(plan.request.size)} ${String(plan.request.ticker).split('-')[0]}`} mono />}
            {isDydx && <Row k={c.reviewPrice} v={fmtPrice(plan.request.price)} mono />}
            {plan.request.triggerPrice != null && <Row k={c.reviewTrigger} v={fmtPrice(plan.request.triggerPrice)} mono />}
            {!isDydx && <Row k={c.reviewCollateral} v={fmtUsd(plan.request.collateralUsd)} mono />}
            {!isDydx && <Row k={c.reviewLeverage} v={`${fmtNum(plan.request.leverage, 3)}×`} mono />}
            {!isDydx && <Row k={c.reviewNotional} v={fmtUsd(plan.request.notionalUsd)} mono />}
            {!isDydx && plan.request.takeProfit !== '0' && <Row k={c.reviewTp} v={fmtPrice(Number(plan.request.takeProfit))} mono />}
            {!isDydx && plan.request.stopLoss !== '0' && <Row k={c.reviewSl} v={fmtPrice(Number(plan.request.stopLoss))} mono />}
            {isDydx && <Row k={c.reviewExpiry} v={c.expiryOptions[expiryKey] || expiryKey} />}

            {fee && (
              <>
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
              </>
            )}

            <p className="faint" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.7 }}>{c.roundedNote}</p>
            {!isDydx && <p className="faint" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.7 }}>{c.cancelCostNote}</p>}

            <div className="card" style={{ padding: 10, background: 'color-mix(in srgb, var(--warn, #b45309) 8%, transparent)' }}>
              <p className="row" style={{ gap: 6, margin: '0 0 5px', fontSize: 12.5, fontWeight: 700 }}>
                <IconShield width={14} height={14} />{c.riskTitle}
              </p>
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.75 }}>{c.riskBody}</p>
              <p style={{ margin: '5px 0 0', fontSize: 11.5, lineHeight: 1.75 }}>{c.nonCustodyBody}</p>
            </div>

            {errText && <p className="ord-warn" style={{ margin: 0 }}>{errText}</p>}

            <button type="button" className="btn" disabled={!canReview || Boolean(busy)} onClick={place}
              style={{ minHeight: 46 }} data-testid="perp-place">
              <IconTrend width={16} height={16} style={{ marginRight: 6, verticalAlign: '-3px' }} />
              {busy || c.place}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setReviewing(false)} style={{ minHeight: 40 }}>
              {isFa ? 'بازگشت' : 'Back'}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Row({ k, v, mono }) {
  return (
    <div className="row-between" style={{ gap: 10, fontSize: 12.5 }}>
      <span className="faint">{k}</span>
      <span className={mono ? 'mono' : undefined} style={{ fontWeight: 600, textAlign: 'left' }}>{v}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The section mounted on «سفارش خودکار»
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
     the pages and this section are all absent, not hidden. */
  if (!SPECULATION_ENABLED) return null;

  const live = perpOrdersLive(orders);
  const done = perpOrdersDone(orders);

  return (
    <motion.section variants={{ show: { transition: { staggerChildren: 0.04 } } }} initial="hidden" animate="show"
      style={{ marginTop: 4 }} data-testid="perp-auto-section">
      <div className="row-between" style={{ marginBottom: 8, gap: 10 }}>
        <p className="section-label" style={{ margin: 0 }}>{c.sectionTitle}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { haptic?.('select'); setSheetOpen(true); }}
          data-testid="perp-open-sheet" style={{ minHeight: 38 }}>
          {c.openSheet}
        </button>
      </div>

      <p className="muted" style={{ fontSize: 12, lineHeight: 1.8, margin: '0 0 10px' }}>{c.sectionBody}</p>

      {notice && <p className="ord-warn" style={{ marginBottom: 8 }}>{notice}</p>}

      {live.length > 0 && (
        <>
          <div className="row-between" style={{ marginBottom: 6, gap: 8 }}>
            <span className="faint" style={{ fontSize: 11.5 }}>{c.listTitle} · {live.length}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={reading} onClick={readStates}
              style={{ minHeight: 34, fontSize: 11.5 }} data-testid="perp-refresh">
              {reading ? '…' : c.refreshState}
            </button>
          </div>
          {!readLive && <p className="ord-warn" style={{ marginBottom: 8, fontSize: 11.5 }}>{c.feedDown}</p>}
          <div className="stack" style={{ gap: 8 }}>
            <AnimatePresence>
              {live.map((o) => (
                <PerpOrderRow key={o.id} o={o} c={c} lang={lang} onCancel={cancel} cancelling={cancelling} stale={!readLive} />
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      {done.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="faint" style={{ fontSize: 11.5, cursor: 'pointer' }}>{c.listTitle} · {done.length}</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {done.slice(0, 10).map((o) => (
              <PerpOrderRow key={o.id} o={o} c={c} lang={lang} onCancel={cancel} cancelling={cancelling} stale={false} />
            ))}
          </div>
        </details>
      )}

      {orders.length === 0 && (
        <div className="card" style={{ padding: 12 }}>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.8, margin: 0 }}>{c.listEmpty}</p>
        </div>
      )}

      <PerpAutoOrderSheet open={sheetOpen} onClose={() => setSheetOpen(false)} lang={lang}
        onPlaced={(record) => persist(addPerpOrder(orders, record))} />
    </motion.section>
  );
}
