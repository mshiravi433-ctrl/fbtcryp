/**
 * THE TICKET — the panel a trader actually presses.
 * ---------------------------------------------------------------------------
 * It shows what the order WILL be before anything is built, and it sends the
 * order through the SAME code that `/perp` uses, because a second order path
 * would be a second place to get signing wrong:
 *
 *   Velocity (Solana)  → prepareFutures → openVelocityPosition (signed in tab)
 *   Ostium (Arbitrum)  → prepareFutures → wallet sends the built calldata
 *   dYdX Chain         → getDydxSubaccount → placeDydxOrder (client session)
 *
 * ─── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 * · It will not offer an order type the venue does not accept. The chips come
 *   from `orderTypeOptions(providerId)` (venueContract.js), and a disabled chip
 *   carries the reason. dYdX has no Stop-Limit; Ostium has no Stop-Market.
 * · It will not print a liquidation price it cannot stand behind. The number is
 *   the risk engine's, and the label under it says whether the venue published
 *   the maintenance margin behind it or whether it is a bound.
 * · It will not send anything with `blocked` set, and the block reason is shown
 *   where the button would be, not in a toast after the tap.
 * · It will not pre-fill a size from a fabricated price. With no mark, the
 *   notional reads «—» and the button is disabled with NO_PRICE.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketMath, orderTypeOptions } from './desk.js';
import { contractFor } from '../../lib/futures-engine/venueContract.js';
import { liquidationProvenanceLabel, blockReasonLabel } from './labels.js';

const usd = (v, digits = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(digits)}`;
};
const pct = (v, digits = 2) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(digits)}%` : '—');
const num = (v, digits = 6) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits).replace(/\.?0+$/, '') : '—');

const LEVERAGE_CHIPS = [1, 2, 3, 5, 10, 20, 50];

/* The chain each venue settles on, in the words a user recognises. This is
   display only — the signing path is decided by lib/perpRoutes.js, which owns
   the wallet family and the chain id. */
const CHAIN_NAME = { drift: 'Solana', ostium: 'Arbitrum', dydx: 'dYdX Chain', hyperliquid: 'Hyperliquid' };
const COLLATERAL_CHIPS = [25, 50, 100, 250];

export default function Ticket({
  venue, market, quote, side = 'long', onSideChange,
  onPlace, placing = false, walletReady = false, onConnect,
  equityUsd = null, availableBalanceUsd = null, errorCode = null, testId = 'perp-ticket',
  /* dYdX session path: the wallet IS connected, but the venue signs from a
     session key derived in memory. Showing «connect a wallet» (or a dead
     submit) to that user was the reported «وصل کنی» bug. */
  needsActivation = false, onActivate, activating = false, activationStage = null
}) {
  const { t } = useTranslation();
  const [collateral, setCollateral] = useState('50');
  const [leverage, setLeverage] = useState(3);
  const [orderType, setOrderType] = useState('market');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');

  const venueMeta = contractFor(venue);
  const maxLeverage = Number(quote?.maxLeverage) || Number(market?.maxLeverage) || null;
  const mark = Number(quote?.mark ?? quote?.oraclePrice ?? market?.oraclePrice) || null;
  const takerFeeBps = Number(market?.openFeeBps ?? market?.takerFeeBps) || (venueMeta?.takerFeeBpsDefault ?? null);
  const mmr = market?.maintenanceMarginFraction ?? market?.raw?.maintenanceMarginFraction ?? null;

  const types = useMemo(() => orderTypeOptions(venue), [venue]);

  const math = useMemo(() => ticketMath({
    providerId: venue,
    side,
    collateralUsd: Number(collateral),
    leverage,
    entryPrice: orderType === 'limit' ? Number(price) || mark : mark,
    maxLeverage,
    maintenanceMarginFraction: mmr,
    takerFeeBps,
    fundingAprPct: quote?.fundingAprPct ?? market?.fundingAprPct ?? null,
    orderType,
    price: orderType === 'limit' ? Number(price) : null,
    stopPrice: orderType === 'stopMarket' ? Number(stopPrice) : null,
    equityUsd,
    availableBalanceUsd,
    minNotionalUsd: Number(market?.minLeveragedPositionUsd) || null
  }), [venue, side, collateral, leverage, orderType, price, stopPrice, mark, maxLeverage, mmr, takerFeeBps, quote, market, equityUsd, availableBalanceUsd]);

  const blocked = math.blocked;
  const needsPrice = types.options.find((o) => o.id === orderType)?.needsPrice;
  const needsStop = types.options.find((o) => o.id === orderType)?.needsStopPrice;

  const submit = () => {
    if (blocked || placing) return;
    onPlace?.({
      side,
      collateralUsd: Number(collateral),
      leverage,
      orderType,
      price: needsPrice ? Number(price) : null,
      stopPrice: needsStop ? Number(stopPrice) : null,
      notionalUsd: math.notionalUsd,
      size: math.size,
      market,
      venue
    });
  };

  return (
    <section className="pt-ticket" data-testid={testId} dir="ltr">
      <div className="pt-seg" role="group" aria-label={t('perpTerminal.ticket.side', { defaultValue: 'Direction' })}>
        <button type="button" className={`pt-seg-btn ${side === 'long' ? 'is-on is-long' : ''}`}
          data-testid="perp-ticket-long" onClick={() => onSideChange?.('long')} aria-pressed={side === 'long'}>
          ▲ {t('perpTerminal.ticket.long', { defaultValue: 'Long' })}
        </button>
        <button type="button" className={`pt-seg-btn ${side === 'short' ? 'is-on is-short' : ''}`}
          data-testid="perp-ticket-short" onClick={() => onSideChange?.('short')} aria-pressed={side === 'short'}>
          ▼ {t('perpTerminal.ticket.short', { defaultValue: 'Short' })}
        </button>
      </div>

      {/* ── order type ─────────────────────────────────────────────────── */}
      <div className="pt-field">
        <span className="pt-label">{t('perpTerminal.ticket.orderType', { defaultValue: 'Order type' })}</span>
        <div className="pt-chips">
          {types.options.map((o) => (
            <button key={o.id} type="button" className={`pt-chip ${orderType === o.id ? 'is-on' : ''}`}
              data-testid={`perp-ticket-type-${o.id}`} onClick={() => setOrderType(o.id)} aria-pressed={orderType === o.id}>
              {t(`perpTerminal.ticket.types.${o.id}`, { defaultValue: o.label })}
            </button>
          ))}
        </div>
        {types.unavailable.length > 0 && (
          <p className="pt-note" data-testid="perp-ticket-unavailable-types">
            {t('perpTerminal.ticket.notOnVenue', {
              defaultValue: '{{venue}} does not accept: {{list}}',
              venue: venueMeta?.name || venue,
              list: types.unavailable.map((u) => t(`perpTerminal.ticket.types.${u}`, { defaultValue: u })).join(', ')
            })}
          </p>
        )}
      </div>

      {needsPrice && (
        <label className="pt-field">
          <span className="pt-label">{t('perpTerminal.ticket.price', { defaultValue: 'Limit price' })}</span>
          <input className="pt-input pt-mono" inputMode="decimal" value={price} placeholder={mark ? String(mark) : ''}
            data-testid="perp-ticket-price" onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
      )}
      {needsStop && (
        <label className="pt-field">
          <span className="pt-label">{t('perpTerminal.ticket.stopPrice', { defaultValue: 'Trigger price' })}</span>
          <input className="pt-input pt-mono" inputMode="decimal" value={stopPrice} placeholder={mark ? String(mark) : ''}
            data-testid="perp-ticket-stop" onChange={(e) => setStopPrice(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
      )}

      {/* ── collateral ─────────────────────────────────────────────────── */}
      <div className="pt-field">
        <span className="pt-label">
          {t('perpTerminal.ticket.collateral', { defaultValue: 'Collateral' })}
          <span className="pt-muted"> · {venueMeta?.collateral || '—'}</span>
        </span>
        <div className="pt-chips">
          {COLLATERAL_CHIPS.map((c) => (
            <button key={c} type="button" className={`pt-chip ${Number(collateral) === c ? 'is-on' : ''}`}
              onClick={() => setCollateral(String(c))}>{c}</button>
          ))}
        </div>
        <input className="pt-input pt-mono" inputMode="decimal" value={collateral} data-testid="perp-ticket-collateral"
          onChange={(e) => setCollateral(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>

      {/* ── leverage ───────────────────────────────────────────────────── */}
      <div className="pt-field">
        <span className="pt-label">
          {t('perpTerminal.ticket.leverage', { defaultValue: 'Leverage' })}
          <span className="pt-muted"> · {maxLeverage ? `${t('perpTerminal.ticket.max', { defaultValue: 'max' })} ${maxLeverage}×` : t('perpTerminal.ticket.maxUnknown', { defaultValue: 'venue max unknown' })}</span>
        </span>
        <div className="pt-chips">
          {LEVERAGE_CHIPS.filter((l) => !maxLeverage || l <= maxLeverage).map((l) => (
            <button key={l} type="button" className={`pt-chip ${leverage === l ? 'is-on' : ''}`}
              data-testid={`perp-ticket-lev-${l}`} onClick={() => setLeverage(l)}>{l}×</button>
          ))}
        </div>
      </div>

      {/* ── the numbers ────────────────────────────────────────────────── */}
      <dl className="pt-kv pt-mono pt-ticket-math" data-testid="perp-ticket-math">
        <div>
          <dt>{t('perpTerminal.ticket.notional', { defaultValue: 'Notional' })}</dt>
          <dd data-testid="perp-ticket-notional">{usd(math.notionalUsd)}</dd>
        </div>
        <div>
          <dt>{t('perpTerminal.ticket.size', { defaultValue: 'Size' })}</dt>
          <dd data-testid="perp-ticket-size">{num(math.size, 4)}</dd>
        </div>
        <div>
          <dt>{t('perpTerminal.ticket.openFee', { defaultValue: 'Open fee' })}</dt>
          <dd data-testid="perp-ticket-fee">
            {math.openFeeUsd != null ? `${usd(math.openFeeUsd)} · ${pct(math.openFeeBps / 100, 3)}` : '—'}
          </dd>
        </div>
        <div>
          <dt>{t('perpTerminal.ticket.funding8h', { defaultValue: 'Funding 8h' })}</dt>
          <dd data-testid="perp-ticket-funding">{math.fundingUsd8h != null ? usd(math.fundingUsd8h) : '—'}</dd>
        </div>
        <div className="pt-ticket-liq">
          <dt>{t('perpTerminal.ticket.liquidation', { defaultValue: 'Liquidation' })}</dt>
          <dd data-testid="perp-ticket-liq">
            <span className="pt-mono">{math.liquidation.price != null ? usd(math.liquidation.price, 2) : '—'}</span>
            {math.liquidation.distancePct != null && (
              <span className="pt-muted"> · {pct(math.liquidation.distancePct, 2)}</span>
            )}
            {/* The provenance label is not decoration: an exact venue number and
                a 100%-loss bound look identical without it. */}
            <span className="pt-tag pt-liq-tag" data-testid="perp-ticket-liq-provenance" data-provenance={math.liquidation.provenance}>
              {liquidationProvenanceLabel(t, math.liquidation.provenance)}
            </span>
          </dd>
        </div>
      </dl>

      {math.warnings.length > 0 && (
        <ul className="pt-warnings pt-small" data-testid="perp-ticket-warnings">
          {math.warnings.map((w) => (
            <li key={w} className="pt-warn">{t(`perpTerminal.ticket.warn.${w}`, { defaultValue: w })}</li>
          ))}
        </ul>
      )}

      {errorCode && (
        <p className="pt-error" role="alert" data-testid="perp-ticket-error">
          {t(`perpTerminal.ticket.error.${errorCode}`, { defaultValue: errorCode })}
        </p>
      )}

      {/* ── the button ─────────────────────────────────────────────────── */}
      {!walletReady ? (
        <button type="button" className="pt-submit" data-testid="perp-ticket-connect" onClick={() => onConnect?.()}>
          {t('perpTerminal.ticket.connect', { defaultValue: 'Connect a wallet' })}
        </button>
      ) : needsActivation ? (
        <button type="button" className="pt-submit is-activate" data-testid="perp-ticket-activate" onClick={() => onActivate?.()} disabled={activating}>
          {activating
            ? (activationStage
              ? t(`dydx.stage.${activationStage}`, { defaultValue: t('common.loading', { defaultValue: 'Working…' }) })
              : t('common.loading', { defaultValue: 'Working…' }))
            : t('perpTerminal.ticket.activateDydx', { defaultValue: 'Activate the dYdX session — one signature' })}
        </button>
      ) : (
        <button type="button" className={`pt-submit ${side === 'long' ? 'is-long' : 'is-short'}`}
          data-testid="perp-ticket-submit" disabled={Boolean(blocked) || placing} onClick={submit}>
          {placing
            ? t('perpTerminal.ticket.placing', { defaultValue: 'Sending…' })
            : blocked
              ? blockReasonLabel(t, blocked)
              : t('perpTerminal.ticket.submit', {
                defaultValue: '{{side}} {{notional}} at {{lev}}×',
                side: t(`perpTerminal.ticket.${side}`, { defaultValue: side }),
                notional: usd(math.notionalUsd),
                lev: leverage
              })}
        </button>
      )}

      <p className="pt-note" data-testid="perp-ticket-custody">
        {t('perpTerminal.ticket.custody', {
          defaultValue: 'Signed by your own wallet on {{chain}}. FBT never holds a key and never takes custody.',
          chain: CHAIN_NAME[venue] || venueMeta?.family || '—'
        })}
      </p>
    </section>
  );
}
