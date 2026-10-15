import React from 'react';
import { formatFactor, formatPct, formatUsd, hfTone, tr } from './loopFormat.js';

/**
 * The account as the lending market reports it — read-only, labelled with its
 * freshness, and never shown as zeros when the read failed.
 */
export default function LoopPosition({
  t,
  lang = 'en',
  preview,
  positionComparison,
  positionDrop,
  isConnected = false,
  onUsePosition,
  onRefresh
}) {
  const formattedReadAt = preview.readAt
    ? new Date(preview.readAt).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  return (
    <div className="loop-position" data-testid="loop-position-preview">
      <div className="loop-position-head">
        <span className={`loan-loop-status is-${preview.status}`} data-status={preview.status} data-testid="loop-position-status">
          {tr(t, `loan.loop.position.${preview.status}`)}
        </span>
        {typeof onRefresh === 'function' && isConnected && (
          <button type="button" className="loop-btn is-soft is-small" data-testid="loop-position-refresh" onClick={onRefresh}>
            {tr(t, 'loan.loop.position.refresh')}
          </button>
        )}
      </div>

      {preview.status === 'unavailable' ? (
        <p className="loop-muted" data-testid="loop-position-unavailable">
          {tr(t, isConnected ? 'loan.loop.position.noPosition' : 'loan.loop.position.connectWallet')}
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
              <div
                className={`loan-loop-position-metric${key === 'healthFactor' ? ` is-${hfTone(preview.account.healthFactor)}` : ''}`}
                key={key}
                data-testid={`loop-position-${key}`}
              >
                <span>{tr(t, `loan.loop.position.${key}`)}</span>
                <strong><bdi dir="ltr">{value}</bdi></strong>
              </div>
            ))}
          </div>
          <p className="loan-loop-read-time" data-testid="loop-position-read-at">
            {tr(t, 'loan.loop.position.updated')}: <bdi>{formattedReadAt}</bdi>
            {preview.ageMs != null && <span> · {Math.round(preview.ageMs / 1000)}s</span>}
            {preview.source && <span> · {String(preview.source)}</span>}
          </p>
          {preview.status === 'stale' && (
            <p className="loan-loop-alert is-warning" role="alert" data-testid="loop-position-stale-note">
              {tr(t, 'loan.loop.position.staleNote')}
            </p>
          )}
          {positionComparison.differs && (
            <p className="loan-loop-alert is-warning" data-testid="loop-position-differs">
              {tr(t, 'loan.loop.position.positionDiffers')}
            </p>
          )}
          {positionComparison.alreadyOverLtv && (
            <p className="loan-loop-alert is-danger" data-testid="loop-position-over-ltv">
              {tr(t, 'loan.loop.position.overLtv')}
            </p>
          )}
          <button
            type="button"
            className="loan-loop-secondary-button"
            data-testid="loop-use-live-position"
            onClick={onUsePosition}
            disabled={preview.account.totalCollateralUsd == null && preview.account.totalDebtUsd == null}
          >
            {tr(t, 'loan.loop.inputs.useLivePosition')}
          </button>
        </>
      )}
    </div>
  );
}
