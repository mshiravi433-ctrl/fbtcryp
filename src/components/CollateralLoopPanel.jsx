import { useMemo, useState } from 'react';
import {
  LOOP_DEFAULTS,
  liquidationDropPct,
  simulateLoop
} from '../lib/loopMath.js';
import { buildPositionPreview, compareLoopPosition } from '../lib/loopPreview.js';
import { loopExecutionGate, readLoopFeatureFlags } from '../lib/loopFeatureFlags.js';
import '../styles/loan-loop.css';

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

const formatUsd = (value) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const formatFactor = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2);
const formatPct = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(2)}%`;
const safeT = (t, key, options = {}) => typeof t === 'function' ? t(key, options) : key;

/**
 * The loop surface keeps Stage A entirely local, Stage B explicitly read-only,
 * and Stage C behind a dedicated feature flag, wallet/chain allowlist, and the
 * unverified stateful-simulation safety gate.
 */
export default function CollateralLoopPanel({
  t,
  lang = 'en',
  dir = 'ltr',
  account = null,
  dataStatus = 'unavailable',
  readAt = null,
  ageMs = null,
  source = null,
  chainId = null,
  wallet = null,
  isConnected = false,
  supportedChain = false,
  flags = null,
  calculatorEnabled = true,
  staleAfterMs
}) {
  const [input, setInput] = useState(() => ({ ...LOOP_DEFAULTS }));
  const projection = useMemo(() => simulateLoop(input), [input]);
  const preview = useMemo(() => buildPositionPreview({
    account,
    dataStatus,
    readAt,
    ageMs,
    source,
    staleAfterMs
  }), [account, dataStatus, readAt, ageMs, source, staleAfterMs]);
  const loopFlags = useMemo(() => flags ?? readLoopFeatureFlags(), [flags]);
  const executionGate = useMemo(() => loopExecutionGate({
    flags: loopFlags,
    chainId,
    wallet,
    supportedChain,
  }), [loopFlags, chainId, wallet, supportedChain]);
  const positionAccount = preview.account ? { ok: true, ...preview.account } : null;
  const positionComparison = useMemo(() => compareLoopPosition({
    account: positionAccount,
    intendedCollateralUsd: input.collateralUsd,
    ltvPct: input.ltvPct
  }), [positionAccount, input.collateralUsd, input.ltvPct]);
  const positionDrop = liquidationDropPct(preview.account?.healthFactor);

  const update = (key, value) => setInput((current) => ({ ...current, [key]: value }));
  const usePosition = () => {
    if (preview.account?.totalCollateralUsd != null) update('startingCollateralUsd', String(preview.account.totalCollateralUsd));
    if (preview.account?.totalDebtUsd != null) update('startingDebtUsd', String(preview.account.totalDebtUsd));
  };
  const formattedReadAt = preview.readAt
    ? new Date(preview.readAt).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  return (
    <section
      className="loan-loop-shell"
      data-testid="loan-collateral-loop"
      dir={dir}
      data-dir={dir}
    >
      <header className="loan-loop-header">
        <div className="loan-loop-heading-mark" aria-hidden="true">↻</div>
        <div className="loan-loop-heading-copy">
          <h2>{safeT(t, 'loan.loop.title')}</h2>
          <p>{safeT(t, 'loan.loop.subtitle')}</p>
        </div>
      </header>

      <p className="loan-loop-disclaimer" data-testid="loop-disclaimer">
        {safeT(t, 'loan.loop.disclaimer')}
      </p>

      {calculatorEnabled && <section className="loan-loop-stage" data-testid="loop-calculator">
        <div className="loan-loop-stage-title">
          <span className="loan-loop-stage-index">A</span>
          <h3>{safeT(t, 'loan.loop.stageA')}</h3>
          <span className="loan-loop-local-badge">{safeT(t, 'loan.loop.calculatorLocal')}</span>
        </div>
        <p className="loan-loop-hint">{safeT(t, 'loan.loop.inputs.assetHint')}</p>
        <div className="loan-loop-input-grid">
          {INPUT_FIELDS.map(([key, type, step]) => (
            <label className="loan-loop-field" key={key}>
              <span>{safeT(t, `loan.loop.inputs.${key}`)}</span>
              <input
                data-testid={`loop-input-${key}`}
                type={type}
                inputMode={type === 'number' ? 'decimal' : undefined}
                step={step || undefined}
                min={type === 'number' ? '0' : undefined}
                max={key === 'rounds' ? '5' : ['ltvPct', 'liquidationThresholdPct', 'headroomPct', 'swapCostPct'].includes(key) ? '100' : undefined}
                value={String(input[key] ?? '')}
                onChange={(event) => update(key, event.target.value)}
                autoComplete="off"
              />
            </label>
          ))}
        </div>

        {!projection.ok && (
          <div className="loan-loop-alert is-danger" role="alert" data-testid="loop-validation-errors">
            {projection.errors.map((error, index) => (
              <p key={`${error.field}-${error.code}-${index}`}>{safeT(t, `loan.loop.error.${error.code}`)}</p>
            ))}
          </div>
        )}

        {projection.ok && (
          <>
            <div className="loan-loop-summary-grid" data-testid="loop-summary">
              <div className="loan-loop-metric">
                <span>{safeT(t, 'loan.loop.summary.finalHealthFactor')}</span>
                <strong><bdi dir="ltr">{formatFactor(projection.finalHealthFactor)}</bdi></strong>
              </div>
              <div className="loan-loop-metric">
                <span>{safeT(t, 'loan.loop.summary.lowestHealthFactor')}</span>
                <strong><bdi dir="ltr">{formatFactor(projection.lowestHealthFactor)}</bdi></strong>
              </div>
              <div className="loan-loop-metric">
                <span>{safeT(t, 'loan.loop.summary.liquidationDrop')}</span>
                <strong><bdi dir="ltr">{formatPct(projection.liquidationDropPct)}</bdi></strong>
              </div>
              <div className="loan-loop-metric">
                <span>{safeT(t, 'loan.loop.summary.leverage')}</span>
                <strong><bdi dir="ltr">{projection.leverage == null ? '—' : `${projection.leverage.toFixed(2)}×`}</bdi></strong>
              </div>
              <div className="loan-loop-metric">
                <span>{safeT(t, 'loan.loop.summary.netCarryRate')}</span>
                <strong><bdi dir="ltr">{formatPct(projection.netCarryRatePct)}</bdi></strong>
              </div>
              <div className="loan-loop-metric">
                <span>{safeT(t, 'loan.loop.summary.firstYearNetRate')}</span>
                <strong><bdi dir="ltr">{formatPct(projection.firstYearNetRatePct)}</bdi></strong>
              </div>
            </div>
            <p className="loan-loop-hint loan-loop-cost-note">{safeT(t, 'loan.loop.summary.firstYearNetNote')}</p>

            {projection.warnings.length > 0 && (
              <div className="loan-loop-alert is-warning" role="status" data-testid="loop-warnings">
                {projection.warnings.map((warning) => (
                  <p key={warning}>{safeT(t, `loan.loop.warning.${warning}`)}</p>
                ))}
              </div>
            )}

            <div className="loan-loop-table-scroll" data-testid="loop-table-scroll">
              <table className="loan-loop-table" data-testid="loop-round-table">
                <thead>
                  <tr>
                    {['round', 'borrow', 'supplied', 'collateral', 'debt', 'healthFactorAtBorrow', 'healthFactor', 'liquidationDrop'].map((key) => (
                      <th key={key} scope="col">{safeT(t, `loan.loop.columns.${key}`)}</th>
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
      </section>}

      <section className="loan-loop-stage" data-testid="loop-position-preview">
        <div className="loan-loop-stage-title">
          <span className="loan-loop-stage-index">B</span>
          <h3>{safeT(t, 'loan.loop.stageB')}</h3>
          <span className={`loan-loop-status is-${preview.status}`} data-status={preview.status} data-testid="loop-position-status">
            {safeT(t, `loan.loop.position.${preview.status}`)}
          </span>
        </div>

        {preview.status === 'unavailable' ? (
          <p className="loan-loop-hint" data-testid="loop-position-unavailable">
            {safeT(t, isConnected ? 'loan.loop.position.noPosition' : 'loan.loop.position.connectWallet')}
          </p>
        ) : (
          <>
            <div className="loan-loop-position-grid">
              {[
                ['collateral', formatUsd(preview.account.totalCollateralUsd)],
                ['debt', formatUsd(preview.account.totalDebtUsd)],
                ['borrowPower', formatUsd(preview.account.availableBorrowsUsd)],
                ['healthFactor', formatFactor(preview.account.healthFactor)],
                ['liquidationDrop', formatPct(positionDrop)]
              ].map(([key, value]) => (
                <div className="loan-loop-position-metric" key={key} data-testid={`loop-position-${key}`}>
                  <span>{safeT(t, `loan.loop.position.${key}`)}</span>
                  <strong><bdi dir="ltr">{value}</bdi></strong>
                </div>
              ))}
            </div>
            <p className="loan-loop-read-time" data-testid="loop-position-read-at">
              {safeT(t, 'loan.loop.position.updated')}: <bdi>{formattedReadAt}</bdi>
              {preview.ageMs != null && <span> · {Math.round(preview.ageMs / 1000)}s</span>}
              {preview.source && <span> · {String(preview.source)}</span>}
            </p>
            {preview.status === 'stale' && (
              <p className="loan-loop-alert is-warning" role="alert" data-testid="loop-position-stale-note">
                {safeT(t, 'loan.loop.position.staleNote')}
              </p>
            )}
            {positionComparison.differs && (
              <p className="loan-loop-alert is-warning" data-testid="loop-position-differs">
                {safeT(t, 'loan.loop.position.positionDiffers')}
              </p>
            )}
            {positionComparison.alreadyOverLtv && (
              <p className="loan-loop-alert is-danger" data-testid="loop-position-over-ltv">
                {safeT(t, 'loan.loop.position.overLtv')}
              </p>
            )}
            <button
              type="button"
              className="loan-loop-secondary-button"
              data-testid="loop-use-live-position"
              onClick={usePosition}
              disabled={preview.account.totalCollateralUsd == null && preview.account.totalDebtUsd == null}
            >
              {safeT(t, 'loan.loop.inputs.useLivePosition')}
            </button>
          </>
        )}
      </section>

      <section className="loan-loop-stage is-execution" data-testid="loop-execution-gate" data-gate={executionGate.reason || 'ready'}>
        <div className="loan-loop-stage-title">
          <span className="loan-loop-stage-index">C</span>
          <h3>{safeT(t, 'loan.loop.stageC')}</h3>
        </div>
        <p className="loan-loop-hint">{safeT(t, 'loan.loop.execution.body')}</p>
        <div className="loan-loop-alert is-warning" role="status" data-testid="loop-execution-block-reason">
          {safeT(t, `loan.loop.execution.${executionGate.reason || 'STATEFUL_SIMULATION_UNVERIFIED'}`)}
        </div>
        <button
          type="button"
          className="loan-loop-primary-button"
          data-testid="loop-execution-button"
          disabled
          aria-disabled="true"
        >
          {safeT(t, 'loan.loop.execution.runButton')}
        </button>
        <p className="loan-loop-hint" data-testid="loop-no-automation">
          {safeT(t, 'loan.loop.execution.notAutomatic')}
        </p>
        {preview.status !== 'unavailable' && preview.account.totalDebtUsd > 0 && (
          <p className="loan-loop-alert is-warning" data-testid="loop-partial-unwind-note">
            {safeT(t, 'loan.loop.execution.partial')} {safeT(t, 'loan.loop.execution.unwind')}
          </p>
        )}
      </section>
    </section>
  );
}
