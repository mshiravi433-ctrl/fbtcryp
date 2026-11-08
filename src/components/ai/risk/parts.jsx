/**
 * AI RISK ENGINE — PANEL PIECES
 * ===========================================================================
 * The small, shared renderers every tab of the risk page uses. Kept apart from
 * the tabs so the same reading is drawn the SAME way wherever it appears: the
 * score ring on the overview and the score chip in an alert cannot drift apart.
 *
 * ─── THE TWO RULES THIS FILE EXISTS TO ENFORCE ──────────────────────────────
 *   1. A null is an em dash, never a 0 and never a green cell. `RiskCell`
 *      draws a dot for "not measured", so an empty heat-map cell is visibly
 *      different from a 0-risk cell.
 *   2. Colour is reserved. Green (`--up`) appears only on a band the engine
 *      called safe/calm AND with enough coverage to earn it; red (`--down`)
 *      only on a band it called serious. Everything in between uses the FBT
 *      purple/navy ramp, which is what most of a real portfolio is.
 */
import { rt, fmtUsdShort, fmtPctShort, reasonText } from '../../../lib/risk/copy.js';
import { ScoreRing, Meter, Spark } from '../../ai/analysis/ui.jsx';

/** tone token (`safe|calm|watch|raised|serious|unverified`) → the CSS class */
export const TONE_CLASS = (tone) => `rk-t-${tone || 'watch'}`;

export function bandLabel(locale, band) {
  if (!band) return '—';
  return locale === 'fa' ? (band.fa || band.id) : (band.en || band.id);
}

/** A score chip: the number, its band, and nothing else inferred. */
export function ScoreChip({ locale, score, band, tone, size = 'md' }) {
  return (
    <span className={`rk-score-chip ${TONE_CLASS(tone)} rk-chip-${size}`}>
      <b>{score == null ? '—' : Math.round(score)}</b>
      <span>{bandLabel(locale, band)}</span>
    </span>
  );
}

/**
 * One heat-map cell. `value == null` renders the "not measured" dot — the whole
 * point of the component.
 */
export function RiskCell({ value, locale, title, small = false }) {
  const nullish = value == null || !Number.isFinite(Number(value));
  /* Buckets, not a gradient: a reader can tell 40 from 70 at a glance. */
  const step = nullish ? null : value >= 70 ? 'serious' : value >= 55 ? 'raised' : value >= 40 ? 'watch' : value >= 25 ? 'calm' : 'safe';
  return (
    <span
      className={`rk-cell${nullish ? ' is-null' : ''}${step ? ` rk-t-${step}` : ''}${small ? ' is-small' : ''}`}
      title={title || (nullish ? rt(locale, 'family.notMeasured') : String(Math.round(value)))}
    >
      {nullish ? <i aria-hidden="true">·</i> : Math.round(value)}
    </span>
  );
}

/** The band legend, so "what counts as serious" is on screen, not in a doc. */
export function BandLegend({ locale, bands = [] }) {
  return (
    <div className="rk-legend" aria-hidden="true">
      {bands.map((b) => (
        <span key={b.id} className={`rk-legend-item ${TONE_CLASS(b.tone)}`}>
          <i />
          {bandLabel(locale, b)}
        </span>
      ))}
      <span className="rk-legend-item rk-t-null">
        <i>·</i>
        {rt(locale, 'family.notMeasured')}
      </span>
    </div>
  );
}

/** The reasons list under a family. This IS the "explain the cause" rule. */
export function ReasonList({ locale, reasons = [], limit = 4 }) {
  if (!reasons.length) return null;
  return (
    <ul className="rk-reasons">
      {reasons.slice(0, limit).map((r, i) => (
        <li key={`${r.key}-${i}`}>{reasonText(locale, r)}</li>
      ))}
    </ul>
  );
}

/**
 * One family row on the overview: the reading, the meter, the weight, and the
 * measurement's own coverage. A family that was not measured says so instead of
 * drawing an empty bar, because an empty bar reads as zero.
 */
export function FamilyRow({ locale, family }) {
  const nullish = family.score == null;
  return (
    <div className={`rk-family ${nullish ? 'is-null' : ''}`}>
      <div className="rk-family-head">
        <span className="rk-family-name">
          <i className="rk-family-hue" style={{ background: family.hue }} aria-hidden="true" />
          {locale === 'fa' ? family.labelFa : family.labelEn}
        </span>
        <span className="rk-family-meta">
          <em title={rt(locale, 'family.weight')}>×{family.weight}</em>
          <ScoreChip locale={locale} score={family.score} band={family.band} tone={family.tone} size="sm" />
        </span>
      </div>
      <p className="rk-family-q">{locale === 'fa' ? family.questionFa : family.questionEn}</p>
      {nullish ? (
        <p className="rk-family-none">
          {rt(locale, 'family.unavailable', { list: family.unavailable.length ? family.unavailable.length : '—' })}
          {' · '}
          {rt(locale, 'family.noGreen')}
        </p>
      ) : (
        <>
          <Meter value={family.score} max={100} tone={toneToBar(family.tone)} label={locale === 'fa' ? family.shortFa : family.shortEn} />
          <ReasonList locale={locale} reasons={family.reasons} />
        </>
      )}
      {nullish && family.unavailable?.length ? (
        <div className="rk-family-missing">
          {family.unavailable.map((u) => <span key={u}>{u}</span>)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * `Meter`'s tones are the intelligence page's palette names (cyan/mint/violet/
 * amber/rose), NOT the risk band names. This maps one to the other, and it is
 * the only place that translation happens.
 */
export function toneToBar(tone) {
  switch (tone) {
    case 'safe': return 'mint';
    case 'calm': return 'cyan';
    case 'watch': return 'violet';
    case 'raised': return 'amber';
    case 'serious': return 'rose';
    default: return 'violet';
  }
}

/** The big score: ring, band, coverage, projection. */
export function RiskScoreBlock({ locale, report, compact = false }) {
  const { score, projected } = report;
  const bandTone = score.tone;
  return (
    <div className={`rk-score ${TONE_CLASS(bandTone)}${compact ? ' is-compact' : ''}`}>
      <div className="rk-score-ring">
        <ScoreRing
          value={score.value}
          band={score.value == null ? 'neutral' : bandTone === 'safe' || bandTone === 'calm' ? 'strong' : bandTone === 'watch' ? 'neutral' : bandTone === 'raised' ? 'cautious' : 'weak'}
          size={compact ? 96 : 132}
          caption={`${rt(locale, 'score.title')}: ${score.value == null ? '—' : Math.round(score.value)}`}
        />
        <span className={`rk-score-band ${TONE_CLASS(bandTone)}`}>{bandLabel(locale, score.band)}</span>
      </div>
      <div className="rk-score-body">
        <h3 className="rk-score-title">{rt(locale, 'score.title')}</h3>
        <p className="rk-score-sub">{rt(locale, 'score.subtitle')}</p>
        <dl className="rk-score-facts">
          <div>
            <dt>{rt(locale, 'score.fact.coverage')}</dt>
            <dd>{score.value == null ? '—' : `${Math.round((score.coverage || 0) * 100)}%`}</dd>
          </div>
          <div>
            <dt>{rt(locale, 'score.fact.measured')}</dt>
            <dd>{`${score.measured ?? 0}/10`}</dd>
          </div>
          {projected?.value != null && projected.delta != null && projected.delta < 0 ? (
            <div>
              <dt>{rt(locale, 'score.fact.projected')}</dt>
              <dd className="rk-projected">
                {rt(locale, 'score.projected', { value: Math.round(projected.value) })}
                <em>{rt(locale, 'score.delta', { delta: Math.round(projected.delta) })}</em>
              </dd>
            </div>
          ) : null}
        </dl>
        {score.unmeasured?.length ? (
          <p className="rk-score-missing">
            {rt(locale, 'score.unmeasured', { list: score.unmeasured.join('، ') })}
          </p>
        ) : null}
        {score.coverage != null && score.coverage < 0.5 ? (
          <p className="rk-score-gate">{rt(locale, 'score.greenGate')}</p>
        ) : null}
        <p className="rk-score-dir">{rt(locale, 'page.direction')}</p>
      </div>
    </div>
  );
}

/** Alert severity → tone. Only `critical` is allowed to be red. */
export const SEVERITY = {
  critical: { key: 'alerts.sev.critical', tone: 'serious' },
  high: { key: 'alerts.sev.high', tone: 'raised' },
  watch: { key: 'alerts.sev.watch', tone: 'watch' }
};

export function SeverityPill({ locale, severity }) {
  const meta = SEVERITY[severity] || SEVERITY.watch;
  return <span className={`rk-pill ${TONE_CLASS(meta.tone)}`}>{rt(locale, meta.key)}</span>;
}

/** A money figure that never prints `+$-10` or a masked zero. */
export function Money({ value, sign = false, locale }) {
  if (value == null) return <>—</>;
  const n = Number(value);
  const text = fmtUsdShort(Math.abs(n));
  return <>{n < 0 ? '−' : sign && n > 0 ? '+' : ''}{text}</>;
}

export function Pct({ value, digits = 1 }) {
  return <>{fmtPctShort(value, digits)}</>;
}

/** The tiny distribution spark used by the monitor and the MC card. */
export function MiniSpark({ values = [], up = true }) {
  if (!values.length) return null;
  return <Spark values={values} width={120} height={30} up={up} />;
}
