import SegIndicator from '../SegIndicator';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CollapsibleCard from '../CollapsibleCard';
import InfoBox from '../InfoBox';
import { fmtPrice, fmtUsd } from '../../lib/format';
import {
  cancelDydxConditionalOrder,
  getDydxOrders,
  placeDydxConditionalOrder
} from '../../lib/dydx';
import { TPSL_EXECUTION, validateTpSl } from '../../lib/dydxTpsl';
import '../../styles/futures-tpsl-history.css';

/*
 * ─── TAKE-PROFIT / STOP-LOSS FOR ONE dYdX POSITION ───────────────────────────
 *
 * The rules this card is built around, in the order a reader should check them:
 *   1. Nothing is sent by typing, by a timer, or by opening the card. The only
 *      path to a signature is the «تایید و ارسال» button, and it is disabled
 *      until `validateTpSl` returns ok.
 *   2. The preview shows the rounded trigger and limit that will be signed, and
 *      its PnL figures are labelled as an estimate.
 *   3. Open conditional orders are read from the indexer. If the indexer cannot
 *      answer, the card says so; it never shows an old list as current.
 *   4. Cancelling an order is a separate click per order, signed by the user.
 */
const SLIPPAGE_CHOICES = ['0.1', '0.5', '1'];

const ERR_KEY = (code) => `dydx.tpsl.err.${code}`;

export default function DydxTpSlCard({ position, market, address, onChanged }) {
  const { t } = useTranslation();
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [execution, setExecution] = useState(TPSL_EXECUTION.MARKET);
  const [tpLimit, setTpLimit] = useState('');
  const [slLimit, setSlLimit] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [orders, setOrders] = useState({ list: [], live: true, loadedAt: null, reason: null });
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const positionSide = position?.side === 'SHORT' ? 'SHORT' : position?.side === 'LONG' ? 'LONG' : null;
  const size = Math.abs(Number(position?.size));
  const entry = Number(position?.entryPrice);
  const current = Number(market?.oraclePrice);
  const tickSize = market?.raw?.tickSize ?? null;
  const ticker = market?.ticker || position?.market || '';

  const plan = useMemo(() => validateTpSl({
    positionSide,
    size,
    entryPrice: entry,
    currentPrice: current,
    tickSize,
    tp: tp === '' ? null : tp,
    sl: sl === '' ? null : sl,
    execution,
    tpLimit: tpLimit === '' ? null : tpLimit,
    slLimit: slLimit === '' ? null : slLimit,
    slippagePct: Number(slippage)
  }), [positionSide, size, entry, current, tickSize, tp, sl, execution, tpLimit, slLimit, slippage]);

  /* Open (untriggered) conditional orders for this market. */
  const loadOrders = useCallback(async () => {
    if (!address) return;
    setLoadingOrders(true);
    const r = await getDydxOrders({ address, subaccount: 0, status: 'UNTRIGGERED' });
    if (!mounted.current) return;
    const list = (r.orders || []).filter((o) => String(o?.orderFlags) === '32' && o?.ticker === ticker);
    setOrders({ list, live: r.live, loadedAt: Date.now(), reason: r.reason || null });
    setLoadingOrders(false);
  }, [address, ticker]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const canSend = Boolean(address && market?.raw && plan.ok && !busy);

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    setSubmitError(null);
    setResults(null);
    const out = [];
    try {
      /* Each leg is one signing request, all started from the same click. A
         rejection on one leg is reported against that leg only. */
      for (const leg of plan.legs) {
        try {
          const r = await placeDydxConditionalOrder({ market, leg });
          out.push({ kind: leg.kind, ok: true, hash: r.hash, triggerPrice: leg.triggerPrice });
        } catch (err) {
          const msg = String(err?.message || '');
          out.push({ kind: leg.kind, ok: false, code: /rejected|denied|cancel/i.test(msg) ? 'REJECTED' : 'SUBMIT_FAILED' });
        }
      }
      setResults(out);
      if (out.some((o) => o.ok)) onChanged?.();
      await loadOrders();
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const cancel = async (order) => {
    if (cancelling) return;
    setCancelling(order.clientId);
    setSubmitError(null);
    try {
      await cancelDydxConditionalOrder({ market, clientId: order.clientId, goodTilBlockTime: order.goodTilBlockTime });
      await loadOrders();
    } catch (err) {
      setSubmitError(/rejected|denied|cancel/i.test(String(err?.message || '')) ? 'REJECTED' : 'CANCEL_FAILED');
    } finally {
      if (mounted.current) setCancelling(null);
    }
  };

  const legLabel = (kind) => (kind === 'tp' ? t('dydx.tpsl.tp') : t('dydx.tpsl.sl'));
  const execLabel = (ex) => (ex === TPSL_EXECUTION.LIMIT ? t('dydx.tpsl.exec.limit') : t('dydx.tpsl.exec.market'));
  const dirLabel = (side) => (side === 'SELL' ? t('dydx.tpsl.closesLong') : t('dydx.tpsl.closesShort'));
  const hasInput = tp !== '' || sl !== '';

  return (
    <CollapsibleCard
      id={`dydx-tpsl-${position?.market}`}
      title={t('dydx.tpsl.title')}
      subtitle={t('dydx.tpsl.subtitle')}
      badge={orders.list.length ? String(orders.list.length) : null}
      className="tpsl-card"
    >
      {!address && <p className="notice">{t('dydx.tpsl.notConnected')}</p>}

      {address && !market?.raw && <p className="notice">{t('dydx.tpsl.marketUnknown')}</p>}

      {address && market?.raw && (
        <>
          <div className="tpsl-grid">
            <div className="tpsl-field">
              <label className="field-label" htmlFor={`tp-${position.market}`}>{t('dydx.tpsl.tpLabel')}</label>
              <input
                id={`tp-${position.market}`}
                type="number"
                inputMode="decimal"
                min="0"
                dir="ltr"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                placeholder={t('dydx.tpsl.optional')}
              />
            </div>
            <div className="tpsl-field">
              <label className="field-label" htmlFor={`sl-${position.market}`}>{t('dydx.tpsl.slLabel')}</label>
              <input
                id={`sl-${position.market}`}
                type="number"
                inputMode="decimal"
                min="0"
                dir="ltr"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                placeholder={t('dydx.tpsl.optional')}
              />
            </div>
          </div>

          <div className="tpsl-field">
            <div className="field-label">{t('dydx.tpsl.execLabel')}</div>
            <div className="segmented" role="group" aria-label={t('dydx.tpsl.execLabel')}>
              {[TPSL_EXECUTION.MARKET, TPSL_EXECUTION.LIMIT].map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className={execution === ex ? 'active' : ''}
                  aria-pressed={execution === ex}
                  onClick={() => setExecution(ex)}
                >
                  {execution === ex && <SegIndicator id="tpsl-exec" />}{execLabel(ex)}
                </button>
              ))}
            </div>
          </div>

          {execution === TPSL_EXECUTION.LIMIT && (
            <div className="tpsl-grid">
              <div className="tpsl-field">
                <label className="field-label" htmlFor={`tpl-${position.market}`}>{t('dydx.tpsl.tpLimitLabel')}</label>
                <input id={`tpl-${position.market}`} type="number" inputMode="decimal" min="0" dir="ltr" value={tpLimit} onChange={(e) => setTpLimit(e.target.value)} />
              </div>
              <div className="tpsl-field">
                <label className="field-label" htmlFor={`sll-${position.market}`}>{t('dydx.tpsl.slLimitLabel')}</label>
                <input id={`sll-${position.market}`} type="number" inputMode="decimal" min="0" dir="ltr" value={slLimit} onChange={(e) => setSlLimit(e.target.value)} />
              </div>
            </div>
          )}

          {execution === TPSL_EXECUTION.MARKET && (
            <div className="tpsl-field">
              <div className="field-label">{t('dydx.tpsl.slippageLabel')}</div>
              <div className="row" style={{ gap: 8 }}>
                {SLIPPAGE_CHOICES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`tag tpsl-tag ${slippage === s ? 'active' : ''}`}
                    aria-pressed={slippage === s}
                    onClick={() => setSlippage(s)}
                  >
                    {s}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasInput && plan.errors.length > 0 && (
            <div className="notice notice-danger tpsl-errors" role="alert">
              {plan.errors.map((code) => <div key={code}>{t(ERR_KEY(code), { defaultValue: code })}</div>)}
              {plan.legErrors.map((e) => (
                <div key={`${e.kind}-${e.code}`}>{legLabel(e.kind)}: {t(ERR_KEY(e.code), { defaultValue: e.code })}</div>
              ))}
            </div>
          )}

          {plan.ok && (
            <InfoBox title={t('dydx.tpsl.previewTitle')} tone="info" id={`tpsl-preview-${position.market}`}>
              <p className="faint" style={{ fontSize: 12 }}>{t('dydx.tpsl.estimateNote')}</p>
              <ul className="tpsl-preview">
                {plan.legs.map((leg) => {
                  const est = plan.estimates.find((e) => e.kind === leg.kind);
                  return (
                    <li key={leg.kind}>
                      <div className="row-between">
                        <strong>{legLabel(leg.kind)}</strong>
                        <span className="mono" dir="ltr">{fmtPrice(leg.triggerPrice)}</span>
                      </div>
                      <div className="faint tpsl-preview-meta">
                        {dirLabel(leg.side)} · {execLabel(leg.execution)}
                        {leg.execution === TPSL_EXECUTION.MARKET ? ` · ${t('dydx.tpsl.limitAt')} ${fmtPrice(leg.limitPrice)}` : ` · ${fmtPrice(leg.limitPrice)}`}
                      </div>
                      <div className="faint tpsl-preview-meta">
                        {t('dydx.tpsl.sizeLabel')}: <span className="mono" dir="ltr">{leg.size}</span>
                        {' · '}
                        {t('dydx.tpsl.estPnl')}: <span className={`mono ${est?.pnlUsd >= 0 ? 'up' : 'down'}`} dir="ltr">{est?.pnlUsd == null ? '—' : fmtUsd(est.pnlUsd)}</span>
                        {est?.pnlPct != null && <span className="mono" dir="ltr"> ({est.pnlPct >= 0 ? '+' : ''}{est.pnlPct.toFixed(2)}%)</span>}
                        {' · '}{t('dydx.tpsl.estimated')}
                      </div>
                      {Math.abs(leg.roundedBy) > 0 && (
                        <div className="faint tpsl-preview-meta">{t('dydx.tpsl.roundedNote', { from: fmtPrice(leg.requestedTrigger), to: fmtPrice(leg.triggerPrice) })}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>{t('dydx.tpsl.feeNote')}</p>
            </InfoBox>
          )}

          <button
            type="button"
            className="btn btn-primary tpsl-submit"
            disabled={!canSend}
            onClick={submit}
            data-testid="dydx-tpsl-submit"
          >
            {busy ? t('common.loading') : t('dydx.tpsl.confirmSend')}
          </button>
          <p className="faint tpsl-hint">{t('dydx.tpsl.signHint')}</p>

          {results && (
            <ul className="tpsl-results" aria-live="polite">
              {results.map((r) => (
                <li key={r.kind} className={r.ok ? 'up' : 'down'}>
                  <span aria-hidden="true">{r.ok ? '✓' : '✕'}</span>{' '}
                  {legLabel(r.kind)}: {r.ok ? t('dydx.tpsl.submitted') : t(`dydx.tpsl.err.${r.code}`)}
                  {r.ok && r.hash && <span className="mono faint tpsl-hash" dir="ltr"> {r.hash.slice(0, 10)}…</span>}
                </li>
              ))}
            </ul>
          )}

          {submitError && <p className="notice notice-danger">{t(`dydx.tpsl.err.${submitError}`)}</p>}

          <div className="tpsl-open">
            <div className="row-between">
              <span className="field-label" style={{ margin: 0 }}>{t('dydx.tpsl.openTitle')}</span>
              <button type="button" className="btn btn-ghost btn-sm tpsl-touch" onClick={loadOrders} disabled={loadingOrders}>
                {t('dydx.tpsl.refresh')}
              </button>
            </div>
            {!orders.live ? (
              <p className="notice notice-danger" role="status">{t('dydx.tpsl.indexerUnavailable')}</p>
            ) : orders.list.length === 0 ? (
              <p className="faint">{t('dydx.tpsl.noOpen')}</p>
            ) : (
              <ul className="tpsl-open-list">
                {orders.list.map((o) => (
                  <li key={o.id || o.clientId} className="tpsl-open-row">
                    <div>
                      <strong>{o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' || o.type === 'TAKE_PROFIT_LIMIT' ? t('dydx.tpsl.tp') : t('dydx.tpsl.sl')}</strong>
                      <span className="faint"> · {o.side === 'SELL' ? t('dydx.tpsl.closesLong') : t('dydx.tpsl.closesShort')}</span>
                    </div>
                    <div className="mono faint" dir="ltr">
                      {t('dydx.tpsl.triggerAt')} {fmtPrice(Number(o.triggerPrice))} · {t('dydx.tpsl.sizeLabel')} {o.size}
                    </div>
                    <div className="faint" style={{ fontSize: 11.5 }}>
                      {t('dydx.tpsl.status.untriggered')}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm tpsl-touch"
                      onClick={() => cancel(o)}
                      disabled={Boolean(cancelling)}
                      data-testid={`dydx-tpsl-cancel-${o.clientId}`}
                    >
                      {cancelling === o.clientId ? t('common.loading') : t('dydx.tpsl.cancelOrder')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}
