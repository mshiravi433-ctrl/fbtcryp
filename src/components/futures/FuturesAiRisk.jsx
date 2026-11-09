/**
 * FUTURES AI RISK — the live risk brain of the order ticket.
 * ---------------------------------------------------------------------------
 * «داخل پاپ‌آپ ریسک هوش مصنوعی باشد» — the trade sheet and the terminal ticket
 * both mount this: ONE engine (lib/futures-engine/risk.js, the same one the
 * confirmation and the ledger use), TWO densities (full for the sheet,
 * compact for the desk's ticket).
 *
 * WHAT IT DOES
 *   · re-scores the EXACT order being built, on every keystroke: leverage,
 *     liquidation distance (the venue's own maintenance-margin model when the
 *     MMR is published), share of balance, missing stop-loss, funding drag;
 *   · proposes the highest rung on the leverage ladder whose liquidation
 *     distance is still ≥ 8% — a number the trader can act on, not a lecture;
 *   · prices the two exits when both TP and SL are set: reward:risk, and the
 *     dollar either way at THIS size — the question a trader actually has.
 *
 * WHAT IT REFUSES TO DO
 *   · print «safe» for an un-scored input set (unknown balance → say so);
 *   · disagree with the venue about the liquidation price — it calls the same
 *     `liquidationDistance()` the confirmation sheet does;
 *   · give advice it cannot show its workings for: every number carries the
 *     formula it came from (title attributes) and the engine version is in
 *     the DOM as data-schema for support/debugging.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  assessFuturesRisk,
  liquidationDistance,
  RISK_POLICY_DEFAULTS
} from '../../lib/futures-engine/risk.js';
import { IconSparkle, IconShield } from '../Icons';
import '../../styles/futures-ai-risk.css';

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const usd = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};

/* The ladder the suggestion walks, highest first. 8% minimum distance to
   liquidation is the engine's own «10% bracket» softened for fees; below it
   an ordinary wick takes the position. */
const LADDER = [20, 10, 5, 3, 2, 1];
const MIN_SUGGEST_DISTANCE_PCT = 8;

const levelOf = (assessment) => String(assessment?.riskLevel || 'LOW').toLowerCase();

export default function FuturesAiRisk({
  providerId = null,
  side = 'long',
  collateralUsd = null,
  leverage = null,
  maxLeverage = null,
  entryPrice = null,
  takeProfit = null,
  stopLoss = null,
  availableBalanceUsd = null,
  fundingAprPct = null,
  spreadBps = null,
  maintenanceMarginFraction = null,
  takerFeeBps = null,
  compact = false,
  onApplyLeverage = null,
  testId = 'futures-ai-risk'
}) {
  const { t } = useTranslation();

  const lev = num(leverage);
  const maxLev = num(maxLeverage);
  const entry = num(entryPrice);
  const feeRate = num(takerFeeBps) != null ? num(takerFeeBps) / 10_000 : null;
  const mmr = num(maintenanceMarginFraction);

  const assessment = useMemo(() => assessFuturesRisk({
    providerId,
    side,
    collateralUsd: num(collateralUsd),
    leverage: lev,
    maxLeverage: maxLev,
    entryPrice: entry,
    takeProfit: num(takeProfit),
    stopLoss: num(stopLoss),
    availableBalanceUsd: num(availableBalanceUsd),
    fundingAprPct: num(fundingAprPct),
    spreadBps: num(spreadBps),
    maintenanceMarginFraction: mmr,
    takerFeeRate: feeRate
  }), [providerId, side, collateralUsd, lev, maxLev, entry, takeProfit, stopLoss, availableBalanceUsd, fundingAprPct, spreadBps, mmr, feeRate]);

  /* Highest rung whose distance to liquidation survives an ordinary adverse
     move. Walks down from the most aggressive rung the venue allows. */
  const suggested = useMemo(() => {
    if (entry == null || entry <= 0) return null;
    const cap = maxLev && maxLev > 0 ? maxLev : RISK_POLICY_DEFAULTS.hardMaxLeverage;
    for (const rung of LADDER) {
      if (rung > cap) continue;
      const d = liquidationDistance({
        providerId, side, entryPrice: entry, leverage: rung, maxLeverage: cap,
        maintenanceMarginFraction: mmr, takerFeeRate: feeRate
      });
      if (d.distancePct == null || d.distancePct >= MIN_SUGGEST_DISTANCE_PCT) return rung;
    }
    return 1;
  }, [providerId, side, entry, maxLev, mmr, feeRate]);

  /* Dollars either way, when the trader has actually placed both exits:
     reward:risk and the size-scaled PNL preview. Long profits above entry,
     short below — sign is carried explicitly; this is not |tp−entry|. */
  const rr = useMemo(() => {
    const tp = num(takeProfit);
    const sl = num(stopLoss);
    if (tp == null || sl == null || entry == null || entry <= 0) return null;
    const short = side === 'short';
    const rewardMove = short ? (entry - tp) / entry : (tp - entry) / entry;
    const riskMove = short ? (sl - entry) / entry : (entry - sl) / entry;
    if (rewardMove <= 0 || riskMove <= 0) return null; // TP/SL on the wrong side — the engine already blocks it
    const notional = num(collateralUsd) != null && lev != null ? num(collateralUsd) * lev : null;
    const rewardUsd = notional != null ? notional * rewardMove : null;
    const riskUsd = notional != null ? notional * riskMove : null;
    return { ratio: rewardMove / riskMove, rewardUsd, riskUsd };
  }, [takeProfit, stopLoss, entry, side, collateralUsd, lev]);

  const score = assessment.riskScore;
  const level = levelOf(assessment);
  const liqPct = assessment.liquidationDistancePct;
  const warnings = (assessment.warnings || []).slice(0, compact ? 2 : 3);
  const apply = typeof onApplyLeverage === 'function' && suggested != null && suggested !== lev
    ? () => onApplyLeverage(suggested)
    : null;

  return (
    <section
      className={`fairisk is-${level}${compact ? ' is-compact' : ''}`}
      data-testid={testId}
      data-schema={assessment.schema}
      data-level={level}
      aria-label={t('futures.risk.title', { defaultValue: 'AI risk' })}
    >
      <div className="fairisk-head">
        <span className="fairisk-badge">
          <IconSparkle width={14} height={14} aria-hidden="true" />
          {t('futures.risk.title', { defaultValue: 'AI risk' })}
        </span>
        <span className="fairisk-live">
          <i aria-hidden="true" />
          {t('futures.risk.live', { defaultValue: 'Live engine' })}
        </span>
      </div>

      <div className="fairisk-body">
        {/* ── the score, as a meter, with the level pill on the same row ── */}
        <div className="fairisk-score-row">
          <div className="fairisk-dial" aria-hidden="true">
            <svg viewBox="0 0 80 46" className="fairisk-dial-svg">
              <path className="fairisk-dial-track" d="M6 42a34 34 0 0 1 68 0" />
              <path
                className="fairisk-dial-value"
                d="M6 42a34 34 0 0 1 68 0"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={100 - Math.max(2, Math.min(100, score))}
              />
            </svg>
            <span className="fairisk-dial-num mono">{score}<small>/100</small></span>
          </div>
          <div className="fairisk-score-side">
            <span className={`fairisk-level is-${level}`} data-testid="futures-ai-risk-level">
              <IconShield width={12} height={12} aria-hidden="true" />
              {t(`futures.risk.level.${level}`, { defaultValue: level.toUpperCase() })}
            </span>
            <span className="fairisk-verdict" data-testid="futures-ai-risk-verdict">
              {t(`futures.risk.verdict.${assessment.blocked ? 'extreme' : level}`, { defaultValue: '' })}
            </span>
            {assessment.blocked && (
              <span className="fairisk-blocked" data-testid="futures-ai-risk-blocked">
                {(assessment.blockReasons || []).slice(0, 2).map((r) => t(`futures.risk.block.${r}`, { defaultValue: r })).join(' · ')}
              </span>
            )}
          </div>
        </div>

        {/* ── the three facts a trader acts on ─────────────────────────── */}
        <ul className="fairisk-facts">
          <li className="fairisk-fact" data-testid="futures-ai-risk-liq">
            <span className="fairisk-fact-k">{t('futures.risk.liqGap', { defaultValue: 'Distance to liquidation' })}</span>
            <span className="fairisk-fact-v mono">{liqPct != null ? `${liqPct.toFixed(2)}%` : '—'}</span>
          </li>
          <li className="fairisk-fact" data-testid="futures-ai-risk-suggested">
            <span className="fairisk-fact-k">{t('futures.risk.suggested', { defaultValue: 'Engine-suggested leverage' })}</span>
            {apply ? (
              <button type="button" className="fairisk-apply mono" onClick={apply} data-testid="futures-ai-risk-apply">
                {suggested}× · {t('futures.risk.apply', { defaultValue: 'Apply' })}
              </button>
            ) : (
              <span className="fairisk-fact-v mono">{suggested != null ? `${suggested}×` : '—'}</span>
            )}
          </li>
          {rr && (
            <li className="fairisk-fact" data-testid="futures-ai-risk-rr">
              <span className="fairisk-fact-k">{t('futures.risk.rr', { defaultValue: 'Reward : risk' })}</span>
              <span className="fairisk-fact-v mono">
                1 : {rr.ratio.toFixed(2)}
                <small className="fairisk-rr-sub">+{usd(rr.rewardUsd)} / −{usd(rr.riskUsd)}</small>
              </span>
            </li>
          )}
        </ul>

        {/* ── the engine's own flags, capped ─────────────────────────────── */}
        {warnings.length > 0 && (
          <ul className="fairisk-flags">
            {warnings.map((w) => (
              <li key={w} className="fairisk-flag" data-testid={`futures-ai-risk-warn-${w.toLowerCase()}`}>
                {t(`futures.risk.warn.${w}`, { defaultValue: w })}
              </li>
            ))}
          </ul>
        )}

        <p className="fairisk-note">{t('futures.risk.disclaimer', { defaultValue: 'An estimate from a live model — not financial advice. Liquidation math uses the venue’s own parameters when published.' })}</p>
      </div>
    </section>
  );
}
