import React from 'react';
import AssetIcon from '../AssetIcon';
import LoopFold from './LoopFold.jsx';
import { LOOP_MAX_ROUNDS } from '../../lib/loopMath.js';
import { weiToDecimalString } from '../../lib/loopPlan.js';
import { formatFactor, formatMultiple, formatPct, formatToken, formatUsd, hfTone, tr } from './loopFormat.js';

const HF_PRESETS = ['1.25', '1.35', '1.5', '2'];
/* Codes that are a prompt ("do this next"), not a failure. */
const SOFT_ERRORS = new Set(['AMOUNT_REQUIRED', 'COLLATERAL_REQUIRED', 'BORROW_REQUIRED']);

function AssetChoice({ t, role, assets, reserves, selectedId, onPick, disabled, testPrefix }) {
  return (
    <div className="loop-asset-row" role="radiogroup" aria-label={tr(t, `loan.loop.plan.${role}`)}>
      {assets.map((asset) => {
        const reserve = reserves?.[asset.id] ?? null;
        const selected = asset.id === selectedId;
        const blocked = role === 'borrow'
          ? reserve?.borrowingEnabled === false || reserve?.status === 'paused' || reserve?.status === 'frozen'
          : (reserve?.listed && !(Number(reserve?.ltvPct) > 0)) || reserve?.status === 'paused' || reserve?.status === 'frozen';
        const rate = role === 'borrow' ? reserve?.borrowApyPct : reserve?.supplyApyPct;
        return (
          <button
            key={asset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`loop-asset-chip${selected ? ' is-selected' : ''}${blocked ? ' is-blocked' : ''}`}
            data-testid={`${testPrefix}-${asset.symbol}`}
            onClick={() => onPick(asset.id)}
            disabled={disabled}
          >
            <AssetIcon symbol={asset.symbol} size={22} radius={7} className="asset-icon loop-asset-icon" />
            <span className="loop-asset-copy">
              <strong>{asset.symbol}</strong>
              <small><bdi dir="ltr">{rate == null ? '—' : formatPct(rate)}</bdi></small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HealthMeter({ t, value, floor }) {
  /* 1.0 = liquidation, 3.0+ = full bar. The floor tick is the user's own. */
  const clamp = (n) => Math.max(0, Math.min(1, (n - 1) / 2));
  const fill = value === Infinity ? 1 : value == null ? 0 : clamp(Number(value));
  const tick = floor == null ? null : clamp(Number(floor));
  const tone = hfTone(value);
  return (
    <div className={`loop-meter is-${tone}`} data-testid="loop-plan-meter" aria-hidden="true">
      <div className="loop-meter-track">
        <span className="loop-meter-fill" style={{ inlineSize: `${Math.round(fill * 100)}%` }} />
        {tick != null && <span className="loop-meter-tick" style={{ insetInlineStart: `${Math.round(tick * 100)}%` }} />}
      </div>
      <div className="loop-meter-scale">
        <span>{tr(t, 'loan.loop.plan.meterLiquidation')}</span>
        <span>{tr(t, 'loan.loop.plan.meterSafe')}</span>
      </div>
    </div>
  );
}

/**
 * Stage 1 — the live plan: real assets, real reserve parameters, the
 * protocol oracle's prices and the user's actual position.
 */
export default function LoopPlanner({
  t,
  assets = [],
  reserves = {},
  plan,
  collateralId,
  borrowId,
  amount,
  settings,
  onCollateral,
  onBorrow,
  onAmount,
  onSettings,
  locked = false,
  lockedNote = 'loan.loop.plan.locked',
  liveWalletWei,
  loading = false,
  isConnected = false,
  swapFeeBps = 70
}) {
  const market = plan?.market ?? null;
  const collateral = market?.collateral ?? null;
  const borrow = market?.borrow ?? null;
  const summary = plan?.summary ?? null;
  const decimals = market?.collateralDecimals ?? collateral?.decimals ?? 18;
  /* The balance line is always the wallet NOW (a frozen run plan carries the
     balance from when it started); MAX still fills from the plan's own read. */
  const walletWei = plan?.walletWei ?? null;
  const shownWalletWei = liveWalletWei !== undefined ? liveWalletWei : walletWei;
  const errors = plan?.errors ?? [];
  const softOnly = errors.length > 0 && errors.every((code) => SOFT_ERRORS.has(code));
  const hardErrors = errors.filter((code) => !SOFT_ERRORS.has(code));
  const setSetting = (key, value) => onSettings({ ...settings, [key]: value });

  const fillMax = () => {
    if (walletWei == null) return;
    onAmount(weiToDecimalString(walletWei, decimals) || '0');
  };

  if (!assets.length) {
    return (
      <section className="loop-section" data-testid="loop-live-plan" data-state="no-market">
        <p className="loop-muted">{tr(t, 'loan.loop.plan.noMarket')}</p>
      </section>
    );
  }

  return (
    <section className={`loop-section${locked ? ' is-locked' : ''}`} data-testid="loop-live-plan" data-state={plan?.ok ? 'ready' : 'incomplete'}>
      <header className="loop-section-head">
        <span className="loop-section-index" aria-hidden="true">1</span>
        <h3>{tr(t, 'loan.loop.plan.title')}</h3>
        <span className={`loop-chip ${loading ? 'is-wait' : 'is-live'}`}>
          <span className="loop-chip-dot" aria-hidden="true" />
          {tr(t, loading ? 'loan.loop.plan.loadingBadge' : 'loan.loop.plan.liveBadge')}
        </span>
      </header>
      {locked && <p className="loop-note" data-testid="loop-plan-locked">{tr(t, lockedNote)}</p>}

      <div className="loop-pair">
        <div className="loop-pair-col">
          <span className="loop-label">{tr(t, 'loan.loop.plan.collateral')}</span>
          <AssetChoice t={t} role="collateral" assets={assets} reserves={reserves} selectedId={collateralId} onPick={onCollateral} disabled={locked} testPrefix="loop-plan-collateral" />
        </div>
        <div className="loop-pair-col">
          <span className="loop-label">{tr(t, 'loan.loop.plan.borrow')}</span>
          <AssetChoice t={t} role="borrow" assets={assets} reserves={reserves} selectedId={borrowId} onPick={onBorrow} disabled={locked} testPrefix="loop-plan-borrow" />
        </div>
      </div>

      {market && collateral && borrow && (
        <dl className="loop-market-strip" data-testid="loop-plan-market">
          <div><dt>{tr(t, 'loan.loop.plan.ltv')}</dt><dd><bdi dir="ltr">{formatPct(market.ltvPct)}</bdi></dd></div>
          <div><dt>{tr(t, 'loan.loop.plan.liqThreshold')}</dt><dd><bdi dir="ltr">{formatPct(market.liquidationThresholdPct)}</bdi></dd></div>
          <div><dt>{tr(t, 'loan.loop.plan.supplyApy', { symbol: collateral.symbol })}</dt><dd className="is-up"><bdi dir="ltr">{formatPct(market.supplyApyPct)}</bdi></dd></div>
          <div><dt>{tr(t, 'loan.loop.plan.borrowApy', { symbol: borrow.symbol })}</dt><dd className="is-down"><bdi dir="ltr">{formatPct(market.borrowApyPct)}</bdi></dd></div>
          <div className="loop-market-route">
            <dt>{tr(t, 'loan.loop.plan.route')}</dt>
            <dd>{market.sameAsset
              ? tr(t, 'loan.loop.plan.routeSame')
              : tr(t, 'loan.loop.plan.routeSwap', { from: borrow.symbol, to: collateral.symbol, fee: (Number(swapFeeBps) / 100).toFixed(2) })}
            </dd>
          </div>
        </dl>
      )}

      <div className="loop-amount">
        <label className="loop-label" htmlFor="loop-plan-amount-input">
          {tr(t, 'loan.loop.plan.amount', { symbol: collateral?.symbol ?? '' })}
        </label>
        <div className="loop-amount-box">
          {collateral && <AssetIcon symbol={collateral.symbol} size={26} radius={9} className="asset-icon loop-asset-icon" />}
          <input
            id="loop-plan-amount-input"
            data-testid="loop-plan-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            dir="ltr"
            value={amount}
            disabled={locked}
            onChange={(event) => onAmount(event.target.value.replace(/[^0-9.]/g, ''))}
          />
          <span className="loop-amount-unit">{collateral?.symbol ?? ''}</span>
          <button type="button" className="loop-max" data-testid="loop-plan-max" onClick={fillMax} disabled={locked || walletWei == null}>
            {tr(t, 'loan.loop.plan.max')}
          </button>
        </div>
        <span className="loop-amount-meta">
          {isConnected
            ? <>{tr(t, 'loan.loop.plan.walletBalance')}: <bdi dir="ltr">{shownWalletWei == null ? '—' : formatToken(shownWalletWei, decimals, collateral?.symbol ?? '')}</bdi></>
            : tr(t, 'loan.loop.plan.connectForBalance')}
          {' · '}{tr(t, 'loan.loop.plan.zeroHint')}
        </span>
      </div>

      <div className="loop-controls">
        <div className="loop-control">
          <span className="loop-label">{tr(t, 'loan.loop.plan.rounds')}</span>
          <div className="loop-seg" role="radiogroup" aria-label={tr(t, 'loan.loop.plan.rounds')}>
            {Array.from({ length: LOOP_MAX_ROUNDS }, (_, i) => String(i + 1)).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={String(settings.rounds) === n}
                className={String(settings.rounds) === n ? 'is-on' : ''}
                data-testid={`loop-plan-rounds-${n}`}
                onClick={() => setSetting('rounds', n)}
                disabled={locked}
              >
                <bdi dir="ltr">{n}</bdi>
              </button>
            ))}
          </div>
        </div>
        <div className="loop-control">
          <span className="loop-label">{tr(t, 'loan.loop.plan.targetHf')}</span>
          <div className="loop-seg" role="radiogroup" aria-label={tr(t, 'loan.loop.plan.targetHf')}>
            {HF_PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={Number(settings.minHealthFactor) === Number(value)}
                className={Number(settings.minHealthFactor) === Number(value) ? 'is-on' : ''}
                data-testid={`loop-plan-hf-${value}`}
                onClick={() => setSetting('minHealthFactor', value)}
                disabled={locked}
              >
                <bdi dir="ltr">{value}</bdi>
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="loop-muted loop-hf-caption">{tr(t, 'loan.loop.plan.targetHfHint')}</p>

      <LoopFold testId="loop-plan-advanced" className="is-inline" title={tr(t, 'loan.loop.plan.advanced')} subtitle={tr(t, 'loan.loop.plan.advancedSub')}>
        <div className="loop-advanced-grid">
          <label className="loop-field">
            <span>{tr(t, 'loan.loop.plan.customHf')}</span>
            <input data-testid="loop-plan-input-minHealthFactor" type="number" inputMode="decimal" step="0.05" min="1.05" max="5" dir="ltr"
              value={settings.minHealthFactor} disabled={locked} onChange={(e) => setSetting('minHealthFactor', e.target.value)} />
          </label>
          <label className="loop-field">
            <span>{tr(t, 'loan.loop.plan.headroom')}</span>
            <input data-testid="loop-plan-input-headroomPct" type="number" inputMode="decimal" step="1" min="0" max="90" dir="ltr"
              value={settings.headroomPct} disabled={locked} onChange={(e) => setSetting('headroomPct', e.target.value)} />
          </label>
          <label className="loop-field">
            <span>{tr(t, 'loan.loop.plan.slippage')}</span>
            <input data-testid="loop-plan-input-slippagePct" type="number" inputMode="decimal" step="0.05" min="0.05" max="3" dir="ltr"
              value={settings.slippagePct} disabled={locked || market?.sameAsset} onChange={(e) => setSetting('slippagePct', e.target.value)} />
          </label>
        </div>
        <p className="loop-muted">{tr(t, 'loan.loop.plan.advancedHint')}</p>
      </LoopFold>

      {softOnly && (
        <p className="loop-note" data-testid="loop-plan-hint">{tr(t, `loan.loop.plan.error.${errors[0]}`)}</p>
      )}
      {hardErrors.length > 0 && (
        <div className="loop-callout is-danger" role="alert" data-testid="loop-plan-errors">
          {hardErrors.map((code) => <p key={code}>{tr(t, `loan.loop.plan.error.${code}`)}</p>)}
        </div>
      )}

      {summary && plan.rows.length > 0 && (
        <>
          <div className="loop-stats" data-testid="loop-plan-summary">
            <div className={`loop-stat is-hero is-${hfTone(summary.finalHealthFactor)}`} data-testid="loop-plan-final-hf">
              <span>{tr(t, 'loan.loop.plan.finalHf')}</span>
              <strong><bdi dir="ltr">{formatFactor(summary.finalHealthFactor)}</bdi></strong>
              <small><bdi dir="ltr">{tr(t, 'loan.loop.plan.lowestHf')}: {formatFactor(summary.lowestHealthFactor)}</bdi></small>
            </div>
            <div className="loop-stat is-hero" data-testid="loop-plan-leverage">
              <span>{tr(t, 'loan.loop.plan.leverage')}</span>
              <strong><bdi dir="ltr">{formatMultiple(summary.leverage)}</bdi></strong>
              <small><bdi dir="ltr">{formatUsd(summary.finalCollateralUsd)} / {formatUsd(summary.finalDebtUsd)}</bdi></small>
            </div>
            <div className={`loop-stat${summary.netApyPct != null && summary.netApyPct < 0 ? ' is-danger' : ' is-safe'}`} data-testid="loop-plan-net-apy">
              <span>{tr(t, 'loan.loop.plan.netApy')}</span>
              <strong><bdi dir="ltr">{formatPct(summary.netApyPct, 2, { signed: true })}</bdi></strong>
              <small><bdi dir="ltr">{summary.yearlyNetUsd == null ? '—' : `${formatUsd(summary.yearlyNetUsd)} / ${tr(t, 'loan.loop.plan.year')}`}</bdi></small>
            </div>
            <div className="loop-stat" data-testid="loop-plan-liq-drop">
              <span>{tr(t, 'loan.loop.plan.liqDrop')}</span>
              <strong><bdi dir="ltr">{formatPct(summary.liquidationDropPct)}</bdi></strong>
            </div>
            <div className="loop-stat" data-testid="loop-plan-total-borrow">
              <span>{tr(t, 'loan.loop.plan.totalBorrow')}</span>
              <strong><bdi dir="ltr">{formatUsd(summary.totalBorrowUsd)}</bdi></strong>
            </div>
            <div className="loop-stat" data-testid="loop-plan-costs">
              <span>{tr(t, 'loan.loop.plan.swapCost')}</span>
              <strong><bdi dir="ltr">{market?.sameAsset ? '—' : formatUsd(summary.swapCostUsd)}</bdi></strong>
            </div>
          </div>
          <HealthMeter t={t} value={summary.finalHealthFactor} floor={plan.settings?.minHealthFactor} />

          {plan.warnings.length > 0 && (
            <div className="loop-callout is-warn" role="status" data-testid="loop-plan-warnings">
              {plan.warnings.map((code) => <p key={code}>{tr(t, `loan.loop.plan.warning.${code}`)}</p>)}
            </div>
          )}

          <LoopFold testId="loop-plan-rounds" className="is-inline" title={tr(t, 'loan.loop.plan.roundDetails')} badge={<span className="loop-chip is-soft"><bdi dir="ltr">{plan.rows.length}</bdi></span>}>
            <div className="loan-loop-table-scroll">
              <table className="loan-loop-table loop-plan-table">
                <thead>
                  <tr>
                    {['round', 'borrow', 'supplied', 'collateral', 'debt', 'healthFactorAtBorrow', 'healthFactor'].map((key) => (
                      <th key={key} scope="col">{tr(t, `loan.loop.columns.${key}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr key={row.round} data-testid={`loop-plan-round-${row.round}`}>
                      <td><bdi dir="ltr">{row.round}</bdi></td>
                      <td><bdi dir="ltr">{formatToken(row.borrowWei, market.borrowDecimals, borrow.symbol)}</bdi></td>
                      <td><bdi dir="ltr">{formatToken(row.suppliedWei, market.collateralDecimals, collateral.symbol)}</bdi></td>
                      <td><bdi dir="ltr">{formatUsd(row.collateralUsd)}</bdi></td>
                      <td><bdi dir="ltr">{formatUsd(row.debtUsd)}</bdi></td>
                      <td><bdi dir="ltr">{formatFactor(row.healthFactorAtBorrow)}</bdi></td>
                      <td><bdi dir="ltr">{formatFactor(row.healthFactor)}</bdi></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </LoopFold>
        </>
      )}
    </section>
  );
}
