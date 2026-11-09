/**
 * ACCOUNT RISK — Redesigned 4-card bento risk telemetry grid.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { portfolioFor, toIntentRiskWord, riskLevelFromScore } from './desk.js';

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

export default function RiskPanel({
  positions = [],
  equityUsd = null,
  maintenanceMarginUsd = null,
  initialMarginUsd = null,
  availableBalanceUsd = null,
  fundingAprPct = null,
  loading = false,
  reason = null,
  testId = 'perp-risk-panel'
}) {
  const { t } = useTranslation();
  const model = useMemo(() => portfolioFor({
    positions, equityUsd, maintenanceMarginUsd, initialMarginUsd, availableBalanceUsd, fundingAprPct
  }), [positions, equityUsd, maintenanceMarginUsd, initialMarginUsd, availableBalanceUsd, fundingAprPct]);

  if (loading && !model.available) {
    return (
      <div className="pt-risk" data-testid={testId}>
        <div className="pt-risk-grid">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="pt-skel pt-skel-block" />)}
        </div>
      </div>
    );
  }

  if (!model.available) {
    return (
      <div className="pt-risk" data-testid={testId}>
        <div className="pt-panel-head">
          <div className="pt-panel-title-wrap">
            <span className="pt-panel-dot is-violet" aria-hidden="true" />
            <span className="pt-panel-title">{t('perpTerminal.risk.title', { defaultValue: 'Account risk' })}</span>
          </div>
        </div>
        <div className="pt-empty-box">
          <span className="pt-empty-ico" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L3 7v6c0 5.25 3.75 9.75 9 11 5.25-1.25 9-5.75 9-11V7l-9-5z" />
            </svg>
          </span>
          <p className="pt-empty" data-testid="perp-risk-unavailable">
            {reason === 'NO_WALLET'
              ? t('perpTerminal.risk.noWallet', { defaultValue: 'Connect a wallet to see margin, exposure and shocks for this account.' })
              : reason === 'ACCOUNT_UNREADABLE'
                ? t('perpTerminal.risk.unreadable', { defaultValue: 'The venue did not return this account. Nothing is shown rather than a guess.' })
                : t('perpTerminal.risk.empty', { defaultValue: 'This account has no open positions.' })}
          </p>
        </div>
      </div>
    );
  }

  const level = model.riskLevel || riskLevelFromScore(model.riskScore);
  const intentWord = toIntentRiskWord(level);
  const marginRatio = model.margin?.marginRatioPct;
  const exposure = model.exposure || {};
  const shockRows = model.shocks?.rows || [];
  const worst = model.shocks?.liquidationScenario;

  return (
    <div className="pt-risk" data-testid={testId}>
      <div className="pt-panel-head">
        <div className="pt-panel-title-wrap">
          <span className="pt-panel-dot is-violet" aria-hidden="true" />
          <span className="pt-panel-title">{t('perpTerminal.risk.title', { defaultValue: 'Account risk' })}</span>
        </div>
        {level && (
          <span
            className={`pt-badge pt-badge-${String(level).toLowerCase()}`}
            data-testid="perp-risk-level"
            data-intent-word={intentWord || ''}
          >
            {t(`perpTerminal.risk.level.${String(level).toLowerCase()}`, { defaultValue: level })}
            {intentWord && intentWord !== String(level).toUpperCase() && (
              <span className="pt-badge-alt"> · {intentWord}</span>
            )}
          </span>
        )}
      </div>

      {/* ── AI RISK — the engine's account-level verdict, one line ───────
          The ticket scores the order about to be sent (perp-terminal/
          Ticket.jsx); this line scores the book you ALREADY have, from the
          same engine family. Both name the model, neither invents a number. */}
      <div className="pt-ai-verdict" data-testid="perp-risk-ai-verdict" data-level={String(level || 'unknown').toLowerCase()}>
        <span className="pt-ai-verdict-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
          </svg>
          {t('futures.risk.title', { defaultValue: 'AI risk' })}
        </span>
        <span className="pt-ai-verdict-text">
          {t(`futures.risk.account.${String(level || 'unknown').toLowerCase()}`, { defaultValue: 'Live engine score for this account.' })}
        </span>
        {Number.isFinite(Number(model.riskScore)) && (
          <span className="pt-ai-verdict-score mono" data-testid="perp-risk-ai-score">
            {Math.round(Number(model.riskScore))}<small>/100</small>
          </span>
        )}
      </div>

      <div className="pt-risk-grid">
        {/* ── 1. Margin ──────────────────────────────────────────────── */}
        <div className="pt-risk-block">
          <h4 className="pt-risk-h">{t('perpTerminal.risk.margin', { defaultValue: 'Margin' })}</h4>
          <dl className="pt-kv pt-mono">
            <div><dt>{t('perpTerminal.risk.marginRatio', { defaultValue: 'Margin ratio' })}</dt><dd data-testid="perp-risk-margin-ratio">{pct(marginRatio)}</dd></div>
            <div><dt>{t('perpTerminal.risk.buffer', { defaultValue: 'Buffer to maintenance' })}</dt><dd>{usd(model.margin?.bufferUsd)}</dd></div>
            <div><dt>{t('perpTerminal.risk.equity', { defaultValue: 'Equity' })}</dt><dd>{usd(equityUsd)}</dd></div>
          </dl>
          {marginRatio != null && (
            <div className="pt-band" aria-hidden="true">
              <div className="pt-band-fill" style={{ width: `${Math.min(100, marginRatio).toFixed(1)}%` }} />
              <span className="pt-band-tick" style={{ insetInlineStart: '70%' }} />
            </div>
          )}
        </div>

        {/* ── 2. Exposure ────────────────────────────────────────────── */}
        <div className="pt-risk-block">
          <h4 className="pt-risk-h">{t('perpTerminal.risk.exposure', { defaultValue: 'Exposure' })}</h4>
          <dl className="pt-kv pt-mono">
            <div><dt>{t('perpTerminal.risk.gross', { defaultValue: 'Gross' })}</dt><dd data-testid="perp-risk-gross">{usd(exposure.grossUsd)}</dd></div>
            <div>
              <dt>{t('perpTerminal.risk.net', { defaultValue: 'Net' })}</dt>
              <dd className={Number(exposure.netUsd) > 0 ? 'pt-up' : Number(exposure.netUsd) < 0 ? 'pt-down' : ''}>
                {Number(exposure.netUsd) > 0 ? '▲ ' : Number(exposure.netUsd) < 0 ? '▼ ' : ''}{usd(exposure.netUsd)}
              </dd>
            </div>
            <div>
              <dt>{t('perpTerminal.risk.leverage', { defaultValue: 'Account leverage' })}</dt>
              <dd data-testid="perp-risk-leverage">{Number.isFinite(Number(exposure.leverageRatio)) ? `${Number(exposure.leverageRatio).toFixed(2)}×` : '—'}</dd>
            </div>
          </dl>
          {Array.isArray(exposure.assets) && exposure.assets.length > 0 && (
            <ul className="pt-risk-assets pt-mono">
              {exposure.assets.slice(0, 6).map((a) => (
                <li key={a.base}>
                  <span>{a.base}</span>
                  <span className="pt-muted">{a.shareOfGrossPct != null ? pct(a.shareOfGrossPct, 0) : '—'}</span>
                  {exposure.hedgedAssets?.includes(a.base) && (
                    <span className="pt-tag">{t('perpTerminal.risk.hedged', { defaultValue: 'hedged' })}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── 3. Scenario Shocks ─────────────────────────────────────── */}
        <div className="pt-risk-block">
          <h4 className="pt-risk-h">{t('perpTerminal.risk.shocks', { defaultValue: 'Scenario shocks' })}</h4>
          {shockRows.length === 0 ? (
            <p className="pt-empty">{t('perpTerminal.risk.noPositions', { defaultValue: 'No open positions to shock.' })}</p>
          ) : (
            <table className="pt-shock pt-mono" data-testid="perp-risk-shocks">
              <thead>
                <tr>
                  <th scope="col">{t('perpTerminal.risk.move', { defaultValue: 'Move' })}</th>
                  <th scope="col">{t('perpTerminal.risk.pnl', { defaultValue: 'P&L' })}</th>
                  <th scope="col">{t('perpTerminal.risk.marginAfter', { defaultValue: 'Margin after' })}</th>
                </tr>
              </thead>
              <tbody>
                {shockRows.map((r) => (
                  <tr key={r.movePct} data-liquidates={r.liquidates ? 'true' : 'false'}>
                    <td>{r.movePct > 0 ? '+' : ''}{r.movePct}%</td>
                    <td className={r.pnlUsd > 0 ? 'pt-up' : r.pnlUsd < 0 ? 'pt-down' : ''}>
                      {r.pnlUsd > 0 ? '▲ ' : r.pnlUsd < 0 ? '▼ ' : ''}{usd(r.pnlUsd)}
                    </td>
                    <td>
                      {r.liquidates
                        ? <span className="pt-warn">{t('perpTerminal.risk.liq', { defaultValue: 'liquidation' })}</span>
                        : pct(r.marginRatioAfterPct, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {worst && (
            <p className="pt-warn pt-small" data-testid="perp-risk-liq-scenario">
              {t('perpTerminal.risk.liqWarning', {
                defaultValue: 'A {{pct}}% move would take this account under maintenance.',
                pct: Math.abs(worst.movePct)
              })}
            </p>
          )}
        </div>

        {/* ── 4. Funding Cost ────────────────────────────────────────── */}
        <div className="pt-risk-block">
          <h4 className="pt-risk-h">{t('perpTerminal.risk.funding', { defaultValue: 'Funding cost' })}</h4>
          {Array.isArray(model.funding) && model.funding.length > 0 ? (
            <dl className="pt-kv pt-mono">
              {model.funding.map((f) => (
                <div key={f.hours}>
                  <dt>{f.hours}h</dt>
                  <dd className={f.usd > 0 ? 'pt-down' : f.usd < 0 ? 'pt-up' : ''}>
                    {f.usd != null ? `${f.usd > 0 ? '−' : f.usd < 0 ? '+' : ''}${usd(Math.abs(f.usd))}` : '—'}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="pt-empty">{t('perpTerminal.risk.noFunding', { defaultValue: 'The venue did not publish a funding rate for this market.' })}</p>
          )}
        </div>
      </div>

      {Array.isArray(model.warnings) && model.warnings.length > 0 && (
        <ul className="pt-warnings" data-testid="perp-risk-warnings">
          {model.warnings.map((w) => (
            <li key={w} className="pt-warn pt-small">{t(`perpTerminal.risk.warn.${w}`, { defaultValue: w })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
