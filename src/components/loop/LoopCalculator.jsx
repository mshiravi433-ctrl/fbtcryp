import React from 'react';
import { formatFactor, formatPct, formatUsd, tr } from './loopFormat.js';

const INPUT_FIELDS = [
  ['collateralUsd', 'number', '0.01'],
  ['collateralAsset', 'text', null],
  ['borrowAsset', 'text', null],
  ['ltvPct', 'number', '0.1'],
  ['liquidationThresholdPct', 'number', '0.1'],
  ['supplyApyPct', 'number', '0.1'],
  ['borrowApyPct', 'number', '0.1'],
  ['swapCostPct', 'number', '0.01'],
  ['gasUsdPerRound', 'number', '0.01'],
  ['rounds', 'number', '1'],
  ['headroomPct', 'number', '0.1'],
  ['startingCollateralUsd', 'number', '0.01'],
  ['startingDebtUsd', 'number', '0.01']
];

/**
 * The original what-if calculator: every number is typed by the user, prices
 * are assumed pegged, nothing is read from the chain. Kept for exploring
 * scenarios the live market does not offer today.
 */
export default function LoopCalculator({ t, input, projection, onUpdate, onFillLive, canFillLive = false }) {
  return (
    <div className="loop-calc">
      <div className="loop-calc-head">
        <span className="loan-loop-local-badge">{tr(t, 'loan.loop.calculatorLocal')}</span>
        <button
          type="button"
          className="loop-btn is-soft is-small"
          data-testid="loop-calculator-fill-live"
          onClick={onFillLive}
          disabled={!canFillLive}
        >
          {tr(t, 'loan.loop.calc.fillLive')}
        </button>
      </div>
      <p className="loop-muted">{tr(t, 'loan.loop.inputs.assetHint')}</p>
      <div className="loan-loop-input-grid">
        {INPUT_FIELDS.map(([key, type, step]) => (
          <label className="loan-loop-field" key={key}>
            <span>{tr(t, `loan.loop.inputs.${key}`)}</span>
            <input
              data-testid={`loop-input-${key}`}
              type={type}
              inputMode={type === 'number' ? 'decimal' : undefined}
              step={step || undefined}
              min={type === 'number' ? '0' : undefined}
              max={key === 'rounds' ? '5' : ['ltvPct', 'liquidationThresholdPct', 'headroomPct', 'swapCostPct'].includes(key) ? '100' : undefined}
              value={String(input[key] ?? '')}
              onChange={(event) => onUpdate(key, event.target.value)}
              autoComplete="off"
            />
          </label>
        ))}
      </div>

      {!projection.ok && (
        <div className="loan-loop-alert is-danger" role="alert" data-testid="loop-validation-errors">
          {projection.errors.map((error, index) => (
            <p key={`${error.field}-${error.code}-${index}`}>{tr(t, `loan.loop.error.${error.code}`)}</p>
          ))}
        </div>
      )}

      {projection.ok && (
        <>
          <div className="loan-loop-summary-grid" data-testid="loop-summary">
            {[
              ['finalHealthFactor', formatFactor(projection.finalHealthFactor)],
              ['lowestHealthFactor', formatFactor(projection.lowestHealthFactor)],
              ['liquidationDrop', formatPct(projection.liquidationDropPct)],
              ['leverage', projection.leverage == null ? '—' : `${projection.leverage.toFixed(2)}×`],
              ['netCarryRate', formatPct(projection.netCarryRatePct)],
              ['firstYearNetRate', formatPct(projection.firstYearNetRatePct)]
            ].map(([key, value]) => (
              <div className="loan-loop-metric" key={key}>
                <span>{tr(t, `loan.loop.summary.${key}`)}</span>
                <strong><bdi dir="ltr">{value}</bdi></strong>
              </div>
            ))}
          </div>
          <p className="loan-loop-hint loan-loop-cost-note">{tr(t, 'loan.loop.summary.firstYearNetNote')}</p>

          {projection.warnings.length > 0 && (
            <div className="loan-loop-alert is-warning" role="status" data-testid="loop-warnings">
              {projection.warnings.map((warning) => (
                <p key={warning}>{tr(t, `loan.loop.warning.${warning}`)}</p>
              ))}
            </div>
          )}

          <div className="loan-loop-table-scroll" data-testid="loop-table-scroll">
            <table className="loan-loop-table" data-testid="loop-round-table">
              <thead>
                <tr>
                  {['round', 'borrow', 'supplied', 'collateral', 'debt', 'healthFactorAtBorrow', 'healthFactor', 'liquidationDrop'].map((key) => (
                    <th key={key} scope="col">{tr(t, `loan.loop.columns.${key}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projection.rows.map((row) => (
                  <tr key={row.round} data-testid={`loop-round-${row.round}`}>
                    <td><bdi dir="ltr">{row.round}</bdi></td>
                    <td><bdi dir="ltr">{formatUsd(row.borrowUsd)}</bdi></td>
                    <td><bdi dir="ltr">{formatUsd(row.suppliedUsd)}</bdi></td>
                    <td><bdi dir="ltr">{formatUsd(row.collateralUsd)}</bdi></td>
                    <td><bdi dir="ltr">{formatUsd(row.debtUsd)}</bdi></td>
                    <td><bdi dir="ltr">{formatFactor(row.healthFactorAtBorrow)}</bdi></td>
                    <td><bdi dir="ltr">{formatFactor(row.healthFactor)}</bdi></td>
                    <td><bdi dir="ltr">{formatPct(row.liquidationDropAtBorrowPct)}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
