/**
 * THE TICKET — Redesigned modular Obsidian-Prism order panel.
 * ---------------------------------------------------------------------------
 * Preserves every venue contract, exact liquidation provenance badge, and
 * non-custodial signing path while presenting Order Type, Collateral, Leverage,
 * Long/Short direction, and Order Math in crisp, spacious glass pods.
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
const CHAIN_NAME = { drift: 'Solana', ostium: 'Arbitrum', dydx: 'dYdX Chain', hyperliquid: 'Hyperliquid' };
const COLLATERAL_CHIPS = [25, 50, 100, 250];

export default function Ticket({
  venue, market, quote, side = 'long', onSideChange,
  onPlace, placing = false, walletReady = false, onConnect,
  equityUsd = null, availableBalanceUsd = null, errorCode = null, testId = 'perp-ticket',
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
  const sliderMax = maxLeverage && Number.isFinite(maxLeverage) && maxLeverage >= 1 ? Math.floor(maxLeverage) : 20;
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
    <section className="pt-ticket" data-testid={testId}>
      {/* Header strip */}
      <div className="pt-ticket-head">
        <span className="pt-ticket-title">
          {t('perpTerminal.ticket.headerTitle', { defaultValue: 'Order Ticket' })}
        </span>
        {venueMeta?.name && (
          <span className={`pt-ticket-venue pt-venue-${venue || 'default'}`}>
            <i aria-hidden="true" />
            {venueMeta.name}
          </span>
        )}
      </div>

      {/* ── Long / Short tactile directional selector ──────────────────── */}
      <div className="pt-seg" role="group" aria-label={t('perpTerminal.ticket.side', { defaultValue: 'Direction' })}>
        <button
          type="button"
          className={`pt-seg-btn is-long ${side === 'long' ? 'is-on' : ''}`}
          data-testid="perp-ticket-long"
          onClick={() => onSideChange?.('long')}
          aria-pressed={side === 'long'}
        >
          <span className="pt-seg-ico" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7" />
              <path d="M8 7h9v9" />
            </svg>
          </span>
          <span className="pt-seg-copy">
            <span className="pt-seg-main">{t('perpTerminal.ticket.long', { defaultValue: 'Long' })}</span>
            <span className="pt-seg-sub">{t('perpTerminal.ticket.longSub', { defaultValue: 'Profit on upside' })}</span>
          </span>
        </button>

        <button
          type="button"
          className={`pt-seg-btn is-short ${side === 'short' ? 'is-on' : ''}`}
          data-testid="perp-ticket-short"
          onClick={() => onSideChange?.('short')}
          aria-pressed={side === 'short'}
        >
          <span className="pt-seg-ico" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 7l10 10" />
              <path d="M17 8v9H8" />
            </svg>
          </span>
          <span className="pt-seg-copy">
            <span className="pt-seg-main">{t('perpTerminal.ticket.short', { defaultValue: 'Short' })}</span>
            <span className="pt-seg-sub">{t('perpTerminal.ticket.shortSub', { defaultValue: 'Profit on downside' })}</span>
          </span>
        </button>
      </div>

      {/* ── Order Type Pod ─────────────────────────────────────────────── */}
      <div className="pt-field pt-field-card">
        <div className="pt-label-row">
          <span className="pt-label">{t('perpTerminal.ticket.orderType', { defaultValue: 'Order type' })}</span>
          <span className="pt-label-pill">
            {t(`perpTerminal.ticket.types.${orderType}`, { defaultValue: orderType })}
          </span>
        </div>

        <div className="pt-type-bar">
          {types.options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`pt-type-btn ${orderType === o.id ? 'is-on' : ''}`}
              data-testid={`perp-ticket-type-${o.id}`}
              onClick={() => setOrderType(o.id)}
              aria-pressed={orderType === o.id}
            >
              {t(`perpTerminal.ticket.types.${o.id}`, { defaultValue: o.label })}
            </button>
          ))}
        </div>

        {types.unavailable.length > 0 && (
          <p className="pt-venue-note" data-testid="perp-ticket-unavailable-types">
            <span className="pt-venue-note-dot" aria-hidden="true">i</span>
            <span>
              {t('perpTerminal.ticket.notOnVenue', {
                defaultValue: '{{venue}} does not accept: {{list}}',
                venue: venueMeta?.name || venue,
                list: types.unavailable.map((u) => t(`perpTerminal.ticket.types.${u}`, { defaultValue: u })).join(', ')
              })}
            </span>
          </p>
        )}

        {needsPrice && (
          <label className="pt-sub-field">
            <span className="pt-label">{t('perpTerminal.ticket.price', { defaultValue: 'Limit price' })}</span>
            <div className="pt-input-well">
              <span className="pt-input-prefix pt-mono">$</span>
              <input
                className="pt-input pt-mono"
                inputMode="decimal"
                value={price}
                placeholder={mark ? String(mark) : ''}
                data-testid="perp-ticket-price"
                onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
              />
              <span className="pt-input-unit pt-mono">USD</span>
            </div>
          </label>
        )}

        {needsStop && (
          <label className="pt-sub-field">
            <span className="pt-label">{t('perpTerminal.ticket.stopPrice', { defaultValue: 'Trigger price' })}</span>
            <div className="pt-input-well">
              <span className="pt-input-prefix pt-mono">$</span>
              <input
                className="pt-input pt-mono"
                inputMode="decimal"
                value={stopPrice}
                placeholder={mark ? String(mark) : ''}
                data-testid="perp-ticket-stop"
                onChange={(e) => setStopPrice(e.target.value.replace(/[^\d.]/g, ''))}
              />
              <span className="pt-input-unit pt-mono">USD</span>
            </div>
          </label>
        )}
      </div>

      {/* ── Collateral Pod ─────────────────────────────────────────────── */}
      <div className="pt-field pt-field-card">
        <div className="pt-label-row">
          <span className="pt-label">{t('perpTerminal.ticket.collateral', { defaultValue: 'Collateral' })}</span>
          <span className="pt-unit-tag pt-mono">{venueMeta?.collateral || 'USDC'}</span>
        </div>

        <div className="pt-input-well">
          <span className="pt-input-prefix pt-mono">$</span>
          <input
            className="pt-input pt-mono"
            inputMode="decimal"
            value={collateral}
            data-testid="perp-ticket-collateral"
            onChange={(e) => setCollateral(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <span className="pt-input-unit pt-mono">{venueMeta?.collateral || 'USD'}</span>
        </div>

        <div className="pt-preset-grid">
          {COLLATERAL_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              className={`pt-chip pt-mono ${Number(collateral) === c ? 'is-on' : ''}`}
              onClick={() => setCollateral(String(c))}
            >
              ${c}
            </button>
          ))}
        </div>
      </div>

      {/* ── Leverage Pod ───────────────────────────────────────────────── */}
      <div className="pt-field pt-field-card">
        <div className="pt-label-row">
          <span className="pt-label">{t('perpTerminal.ticket.leverage', { defaultValue: 'Leverage' })}</span>
          <span className="pt-lev-readout pt-mono">
            <strong>{leverage}×</strong>
            <small>
              {maxLeverage
                ? ` · ${t('perpTerminal.ticket.max', { defaultValue: 'max' })} ${maxLeverage}×`
                : ` · ${t('perpTerminal.ticket.maxUnknown', { defaultValue: 'venue max unknown' })}`}
            </small>
          </span>
        </div>

        <div className="pt-lev-chips">
          {LEVERAGE_CHIPS.filter((l) => !maxLeverage || l <= maxLeverage).map((l) => (
            <button
              key={l}
              type="button"
              className={`pt-chip pt-mono ${leverage === l ? 'is-on' : ''}`}
              data-testid={`perp-ticket-lev-${l}`}
              onClick={() => setLeverage(l)}
            >
              {l}×
            </button>
          ))}
        </div>

        <div className="pt-slider-wrap">
          <input
            type="range"
            min={1}
            max={sliderMax}
            step={1}
            value={Math.min(leverage, sliderMax)}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="pt-slider"
            aria-label={t('perpTerminal.ticket.leverage', { defaultValue: 'Leverage' })}
          />
        </div>
      </div>

      {/* ── Order & Liquidation Telemetry Receipt ──────────────────────── */}
      <div className="pt-math-box">
        <div className="pt-math-head">
          {t('perpTerminal.ticket.summaryTitle', { defaultValue: 'Order & Liquidation Preview' })}
        </div>
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
              <span
                className={`pt-tag pt-liq-tag is-${String(math.liquidation.provenance || '').toLowerCase()}`}
                data-testid="perp-ticket-liq-provenance"
                data-provenance={math.liquidation.provenance}
              >
                {liquidationProvenanceLabel(t, math.liquidation.provenance)}
              </span>
            </dd>
          </div>
        </dl>
      </div>

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

      {/* ── Primary Action Button ──────────────────────────────────────── */}
      {!walletReady ? (
        <button type="button" className="pt-submit is-connect" data-testid="perp-ticket-connect" onClick={() => onConnect?.()}>
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
        <button
          type="button"
          className={`pt-submit ${side === 'long' ? 'is-long' : 'is-short'}`}
          data-testid="perp-ticket-submit"
          disabled={Boolean(blocked) || placing}
          onClick={submit}
        >
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

      <p className="pt-custody" data-testid="perp-ticket-custody">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2L3 7v6c0 5.25 3.75 9.75 9 11 5.25-1.25 9-5.75 9-11V7l-9-5z" />
        </svg>
        <span>
          {t('perpTerminal.ticket.custody', {
            defaultValue: 'Signed by your own wallet on {{chain}}. FBT never holds a key and never takes custody.',
            chain: CHAIN_NAME[venue] || venueMeta?.family || '—'
          })}
        </span>
      </p>
    </section>
  );
}
