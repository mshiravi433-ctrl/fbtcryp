/**
 * AI RISK ENGINE — RECOMMENDATIONS
 * ===========================================================================
 * «Risk Recommendations: اقدامات عملی برای کاهش ریسک.»
 *
 * The rule that makes this tab different from a tip feed: the number next to
 * each action is a MEASUREMENT. `impactPts` comes from re-running the engine's
 * own grader on patched inputs (trim this leg to a fifth, repay to a health
 * factor of 2, cut the riskiest contract), so it is not an estimate, and a
 * recommendation whose effect could not be measured says so instead of
 * borrowing a plausible number.
 *
 * That distinction is visible on every card:
 *   `−46 امتیاز`        measured by re-scoring (impactBasis: 'rescore')
 *   `بدون اثر سنجیده`    re-scored and unchanged
 *   `دانش را کامل میکند` no score effect by construction (impactBasis:
 *                        'knowledge-only' — e.g. recording a cost basis)
 *
 * Nothing here is executed. Every card carries the engine's no-execution law,
 * and the footer repeats it, because a list of imperative verbs next to real
 * money is the most dangerous thing a UI can produce by accident.
 */
import { SectionCard, Meter, Pill, EmptyState } from '../../ai/analysis/ui.jsx';
import { IconShield, IconArrowUpRight, IconCheck } from '../../Icons.jsx';
import { rt } from '../../../lib/risk/copy.js';
import { TONE_CLASS } from './parts.jsx';

const EFFORT_TONE = { low: 'mint', medium: 'amber', high: 'rose' };
const HORIZON_TONE = { immediate: 'rose', short: 'amber', medium: 'violet', long: 'cyan' };

function RecCard({ locale, rec, rank }) {
  const beyond = rec.impactPts == null;
  const improved = rec.impactPts != null && rec.impactPts < 0;
  return (
    <article className={`rk-rec${beyond ? ' is-knowledge' : improved ? ' is-real' : ''}`}>
      <header className="rk-rec-head">
        <span className="rk-rec-rank" aria-hidden="true">{rank}</span>
        {/*
          The TITLE takes the same params as the body: two of these titles name
          an asset («تمرکز {symbol} را کم کنید»), and a title rendered without
          its params printed the literal `{symbol}` next to a real number.
        */}
        <h3>{rt(locale, `rec.${rec.action}`, rec.params || {})}</h3>
        <span className={`rk-rec-impact ${improved ? 'is-good' : ''}`}>
          {improved
            ? rt(locale, 'actions.impact', { pts: Math.abs(rec.impactPts) })
            : rec.impactBasis === 'knowledge-only'
              ? rt(locale, 'actions.knowledge')
              : rt(locale, 'actions.noImpact')}
        </span>
      </header>

      <p className="rk-rec-body">{rt(locale, `rec.body.${rec.action}`, rec.params || {})}</p>

      {improved ? (
        <Meter
          value={Math.min(100, Math.abs(rec.impactPts) * 1.8)}
          max={100}
          tone="mint"
          label={locale === 'fa' ? 'اثر سنجیده‌شده' : 'measured effect'}
        />
      ) : null}

      <footer className="rk-rec-foot">
        <span className="rk-rec-meta">
          <em>{rt(locale, 'actions.confidence', { pct: rec.confidence ?? '—' })}</em>
          <Pill tone={EFFORT_TONE[rec.effort] || 'neutral'}>
            {rt(locale, `effort.${rec.effort}`)}
          </Pill>
          <Pill tone={HORIZON_TONE[rec.horizon] || 'neutral'}>
            {rt(locale, `horizon.${rec.horizon}`)}
          </Pill>
        </span>
        {rec.evidence?.length ? (
          <span className="rk-rec-ev" title={rt(locale, 'actions.evidence')}>
            <IconCheck width={12} height={12} />
            {rec.evidence.join(' · ')}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

export default function ActionsTab({ locale, report }) {
  const recs = report.recommendations || [];
  const projected = report.projected;
  const measurable = recs.filter((r) => r.impactPts != null && r.impactPts < 0).length;

  return (
    <div className="rk-stack">
      <SectionCard
        mark={<IconShield width={16} height={16} />}
        title={rt(locale, 'actions.title')}
        hint={rt(locale, 'actions.hint')}
        actions={projected?.value != null && projected.delta != null && projected.delta < 0 ? (
          <Pill tone="mint">
            {rt(locale, 'score.projected', { value: Math.round(projected.value) })}
          </Pill>
        ) : null}
      >
        {recs.length ? (
          <>
            <div className="rk-rec-summary">
              <span>
                {locale === 'fa'
                  ? `${measurable} اقدام با اثر سنجیده، از ${recs.length} پیشنهاد.`
                  : `${measurable} measured actions out of ${recs.length} recommendations.`}
              </span>
              {projected?.delta != null && projected.delta < 0 ? (
                <span className="rk-rec-total">
                  {locale === 'fa' ? 'اگر همه اجرا شود' : 'If all applied'}
                  <b>{`${Math.round(projected.value)}/100`}</b>
                </span>
              ) : null}
            </div>
            <div className="rk-recs">
              {recs.map((r, i) => <RecCard key={r.action} locale={locale} rec={r} rank={i + 1} />)}
            </div>
          </>
        ) : (
          <EmptyState title={rt(locale, 'actions.empty')} hint={report.score.unmeasured?.length
            ? rt(locale, 'score.unmeasured', { list: report.score.unmeasured.join('، ') })
            : undefined} />
        )}

        <p className="rk-foot rk-not-advice">
          <IconArrowUpRight width={13} height={13} />
          {rt(locale, 'actions.notAdvice')} · {rt(locale, 'page.notAdvice')}
        </p>
      </SectionCard>
    </div>
  );
}
