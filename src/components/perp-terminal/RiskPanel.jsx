/**
 * ACCOUNT RISK — the panel that makes a perp desk different from a ticket.
 * ---------------------------------------------------------------------------
 * Four blocks, each one a question a trader actually asks before adding size:
 *
 *   MARGIN    how much of the account is already held as maintenance, and how
 *             far it is from the liquidation band
 *   EXPOSURE  net direction vs gross deployment, per asset (a 1000 long and a
 *             900 short is 100 net, not 1900 gross)
 *   SHOCKS    −1 / −3 / −5 / +1 / +3 / +5%, the P&L of THIS book, and whether
 *             any of those moves takes it under maintenance
 *   FUNDING   what the position costs to carry over 8 / 24 / 72 hours
 *
 * EVERY number comes from `assessPortfolioRisk` (the engine), and every word
 * for a risk band comes from ONE vocabulary (see desk.js RISK_VOCABULARY):
 * the badge here, the opportunity feed's badge and the trading brain's verdict
 * must not tell a user three different things about the same account.
 *
 * When the account cannot be read, the panel says exactly which read failed and
 * shows nothing else. A risk panel that invents a "healthy" default is worse
 * than one that is empty, because it is read as an all-clear.
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

export default function RiskPanel({ positions = [], equityUsd = null, maintenanceMarginUsd = null, initialMarginUsd = null, availableBalanceUsd = null, fundingAprPct = null, loading = false, reason = null, testId = 'perp-risk-panel' }) {
  const { t } = useTranslation();
  const model = useMemo(() => portfolioFor({
    positions, equityUsd, maintenanceMarginUsd, initialMarginUsd, availableBalanceUsd, fundingAprPct
  }), [positions, equityUsd, maintenanceMarginUsd, initialMarginUsd, availableBalanceUsd, fundingAprPct]);

  if (loading && !model.available) {
    return (
      <div className="pt-risk" data-testid={testId}>
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="pt-skel pt-skel-block" />)}
      </div>
    );
  }

  if (!model.available) {
    return (
      <div className="pt-risk" data-testid={testId}>
        <div className="pt-panel-head">
          <span className="pt-panel-title">{t('perpTerminal.risk.title', { defaultValue: 'Account risk' })}</span>
        </div>
        <p className="pt-empty" data-testid="perp-risk-unavailable">
          {reason === 'NO_WALLET'
            ? t('perpTerminal.risk.noWallet', { defaultValue: 'Connect a wallet to see margin, exposure and shocks for this account.' })
            : reason === 'ACCOUNT_UNREADABLE'
              ? t('perpTerminal.risk.unreadable', { defaultValue: 'The venue did not return this account. Nothing is shown rather than a guess.' })
              : t('perpTerminal.risk.empty', { defaultValue: 'This account has no open positions.' })}
        </p>
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
        <span className="pt-panel-title">{t('perpTerminal.risk.title', { defaultValue: 'Account risk' })}</span>
        {level && (
          <span className={`pt-badge pt-badge-${String(level).toLowerCase()}`} data-testid="perp-risk-level"
            data-intent-word={intentWord || ''}>
            {t(`perpTerminal.risk.level.${String(level).toLowerCase()}`, { defaultValue: level })}
            {intentWord && intentWord !== String(level).toUpperCase() && (
              <span className="pt-badge-alt"> · {intentWord}</span>
            )}
          </span>
        )}
      </div>

      {/* ── margin ─────────────────────────────────────────────────────── */}
      <div className="pt-risk-block">
        <h4 className="pt-risk-h">{t('perpTerminal.risk.margin', { defaultValue: 'Margin' })}</h4>
        <dl className="pt-kv pt-mono">
          <div><dt>{t('perpTerminal.risk.marginRatio', { defaultValue: 'Margin ratio' })}</dt><dd data-testid="perp-risk-margin-ratio">{pct(marginRatio)}</dd></div>
          <div><dt>{t('perpTerminal.risk.buffer', { defaultValue: 'Buffer to maintenance' })}</dt><dd>{usd(model.margin?.bufferUsd)}</dd></div>
          <div><dt>{t('perpTerminal.risk.equity', { defaultValue: 'Equity' })}</dt><dd>{usd(equityUsd)}</dd></div>
        </dl>
        {marginRatio != null && (
          /* The band bar: 0 → 100% margin ratio, with the product's warning line
             at 70% drawn as a tick. Non-colour cue: the tick is labelled. */
          <div className="pt-band" aria-hidden="true">
            <div className="pt-band-fill" style={{ width: `${Math.min(100, marginRatio).toFixed(1)}%` }} />
            <span className="pt-band-tick" style={{ insetInlineStart: '70%' }} />
          </div>
        )}
      </div>

      {/* ── exposure ───────────────────────────────────────────────────── */}
      <div className="pt-risk-block">
        <h4 className="pt-risk-h">{t('perpTerminal.risk.exposure', { defaultValue: 'Exposure' })}</h4>
        <dl className="pt-kv pt-mono">
          <div><dt>{t('perpTerminal.risk.gross', { defaultValue: 'Gross' })}</dt><dd data-testid="perp-risk-gross">{usd(exposure.grossUsd)}</dd></div>
          <div><dt>{t('perpTerminal.risk.net', { defaultValue: 'Net' })}</dt>
            <dd className={Number(exposure.netUsd) > 0 ? 'pt-up' : Number(exposure.netUsd) < 0 ? 'pt-down' : ''}>
              {Number(exposure.netUsd) > 0 ? '▲ ' : Number(exposure.netUsd) < 0 ? '▼ ' : ''}{usd(exposure.netUsd)}
            </dd>
          </div>
          <div><dt>{t('perpTerminal.risk.leverage', { defaultValue: 'Account leverage' })}</dt>
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

      {/* ── shocks ─────────────────────────────────────────────────────── */}
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
                  <td>{r.liquidates
                    ? <span className="pt-warn">{t('perpTerminal.risk.liq', { defaultValue: 'liquidation' })}</span>
                    : pct(r.marginRatioAfterPct, 1)}</td>
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

      {/* ── funding cost ───────────────────────────────────────────────── */}
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
