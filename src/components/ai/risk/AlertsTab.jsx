/**
 * AI RISK ENGINE — ALERTS
 * ===========================================================================
 * «AI Risk Alerts: هشدار هوشمند با توضیح علت.»
 *
 * The requirement is not "show alerts", it is "explain the cause" — so an
 * alert here is four things and never fewer:
 *
 *   TITLE      what happened, in the user's language
 *   BECAUSE    the family reasons that produced it, with their real numbers
 *   BODY       the mechanism, in one sentence: what it means for capital
 *   MODEL      the model that produced any probability in it (or nothing)
 *
 * An empty list is printed as "nothing was found on this evidence" — never as
 * "all clear", because those are different statements and only one of them is
 * true when half the book was unmeasured.
 */
import { SectionCard, EmptyState, Pill } from '../../ai/analysis/ui.jsx';
import { IconAlertTriangle, IconShield } from '../../Icons.jsx';
import { rt, reasonText } from '../../../lib/risk/copy.js';
import { SeverityPill, TONE_CLASS } from './parts.jsx';

const SEV_ICON = {
  critical: IconAlertTriangle,
  high: IconAlertTriangle,
  watch: IconShield
};

function AlertCard({ locale, alert }) {
  const Icon = SEV_ICON[alert.severity] || IconShield;
  return (
    <article className={`rk-alert ${TONE_CLASS(alert.tone || (alert.severity === 'critical' ? 'serious' : alert.severity === 'high' ? 'raised' : 'watch'))}`}>
      <header className="rk-alert-head">
        <span className="rk-alert-icon" aria-hidden="true"><Icon width={16} height={16} /></span>
        {/*
          The TITLE takes the same params as the body: several of these
          headlines are sentences with a number in them («۳ زنجیره خوانده
          نشد»), and a title rendered without its params printed `{count}` on
          screen. One call, one params object, so the two can never disagree.
        */}
        <h3 className="rk-alert-title">{rt(locale, `alert.${alert.code}`, alert.body || {})}</h3>
        <SeverityPill locale={locale} severity={alert.severity} />
      </header>
      <p className="rk-alert-body">{rt(locale, `alert.body.${alert.code}`, alert.body || {})}</p>

      {alert.because?.length ? (
        <div className="rk-alert-because">
          <span className="rk-because-label">{rt(locale, 'alerts.because')}</span>
          <ul>
            {alert.because.map((r, i) => (
              <li key={`${r.key}-${i}`}>{reasonText(locale, r)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer className="rk-alert-foot">
        {alert.model ? <span title={rt(locale, 'alerts.model', { model: alert.model })}>{alert.model}</span> : <span />}
        {alert.family ? <Pill tone="neutral">{alert.family}</Pill> : null}
      </footer>
    </article>
  );
}

export default function AlertsTab({ locale, report }) {
  const alerts = report.alerts || [];
  const counts = alerts.reduce((acc, a) => {
    acc[a.severity] = (acc[a.severity] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="rk-stack">
      <SectionCard
        mark={<IconAlertTriangle width={16} height={16} />}
        title={rt(locale, 'alerts.title')}
        hint={rt(locale, 'alerts.hint')}
        actions={(
          <div className="rk-alert-counts">
            {counts.critical ? <Pill tone="rose">{rt(locale, 'alerts.count.critical', { n: counts.critical })}</Pill> : null}
            {counts.high ? <Pill tone="amber">{rt(locale, 'alerts.count.high', { n: counts.high })}</Pill> : null}
            {counts.watch ? <Pill tone="violet">{rt(locale, 'alerts.count.watch', { n: counts.watch })}</Pill> : null}
          </div>
        )}
      >
        {alerts.length ? (
          <div className="rk-alerts">
            {alerts.map((a) => <AlertCard key={`${a.code}-${a.family}-${a.params?.symbol ?? ''}`} locale={locale} alert={a} />)}
          </div>
        ) : (
          <EmptyState
            title={rt(locale, 'alerts.empty')}
            hint={locale === 'fa'
              ? 'نبودِ هشدار یعنی هیچ آستانه‌ای رد نشده؛ یعنی کتاب سالم نیست، فقط اندازه‌گیری‌شده است.'
              : 'No alert means no threshold was crossed — not that the book is healthy, only that it was measured.'}
          />
        )}
      </SectionCard>
    </div>
  );
}
