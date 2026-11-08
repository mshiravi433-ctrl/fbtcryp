/**
 * AI RISK ENGINE — LIVE MONITOR
 * ===========================================================================
 * «Live Risk Monitor: تشخیص به‌موقع تغییرات خطرناک.»
 *
 * The hard part of a live panel is not the chart, it is not LYING:
 *
 *   · A delta only exists when there are two readings at least 15 minutes
 *     apart. Before that the panel says "no change recorded yet" instead of
 *     drawing a straight line and calling it stable.
 *   · A move under one point is not news and is printed as 0.
 *   · The series is the score, not a price. It is drawn against its own band
 *     edges, so a rising line crossing 55 is visibly a band change.
 *   · The per-family movers are recomputed from the two readings the monitor
 *     kept, so "what moved" is a measurement and not an inference.
 */
import { SectionCard, StatTile, MultiLine } from '../../ai/analysis/ui.jsx';
import { IconActivity, IconRefresh, IconAlertTriangle } from '../../Icons.jsx';
import { rt } from '../../../lib/risk/copy.js';
import { bandLabel, ScoreChip } from './parts.jsx';

export default function MonitorTab({ locale, monitor, report, onReset }) {
  const series = monitor?.series?.length ? monitor.series : [];
  const hasDelta = monitor && monitor.delta != null && monitor.minutes > 0;
  const worsened = hasDelta && monitor.delta > 0;
  const improved = hasDelta && monitor.delta < 0;

  return (
    <div className="rk-stack">
      <SectionCard
        mark={<IconActivity width={16} height={16} />}
        title={rt(locale, 'monitor.title')}
        hint={rt(locale, 'monitor.hint')}
        actions={(
          <button type="button" className="rk-ghost-btn" onClick={onReset}>
            <IconRefresh width={14} height={14} />
            <span>{rt(locale, 'monitor.reset')}</span>
          </button>
        )}
      >
        <div className="rk-tiles rk-tiles-3">
          <StatTile
            label={rt(locale, 'monitor.now')}
            value={report.score.value == null ? '—' : Math.round(report.score.value)}
            sub={bandLabel(locale, report.score.band)}
            tone={report.score.tone === 'safe' ? 'mint' : report.score.tone === 'serious' ? 'rose' : report.score.tone === 'raised' ? 'amber' : 'violet'}
            gauge={report.score.value}
          />
          <StatTile
            label={locale === 'fa' ? 'تغییر' : 'Change'}
            value={hasDelta ? `${monitor.delta > 0 ? '+' : ''}${monitor.delta}` : '—'}
            sub={hasDelta ? (locale === 'fa' ? `${monitor.minutes} دقیقه` : `${monitor.minutes} min`) : rt(locale, 'monitor.noDelta')}
            tone={worsened ? 'rose' : improved ? 'mint' : 'violet'}
          />
          <StatTile
            label={locale === 'fa' ? 'خوانش‌های این نشست' : 'Readings this session'}
            value={`${monitor?.points ?? series.length}`}
            sub={locale === 'fa' ? 'در این نشست' : 'this session'}
            tone="cyan"
          />
        </div>

        <div className={`rk-monitor-banner ${worsened ? 'is-bad' : improved ? 'is-good' : ''}`}>
          <IconAlertTriangle width={16} height={16} />
          <span>
            {!hasDelta
              ? rt(locale, 'monitor.noDelta')
              : worsened
                ? rt(locale, 'monitor.worsened', { delta: monitor.delta, minutes: monitor.minutes })
                : improved
                  ? rt(locale, 'monitor.improved', { delta: Math.abs(monitor.delta), minutes: monitor.minutes })
                  : rt(locale, 'monitor.stable')}
          </span>
        </div>

        {series.length >= 2 ? (
          <div className="rk-monitor-chart">
            <MultiLine
              series={[{ symbol: locale === 'fa' ? 'امتیاز ریسک' : 'Risk score', values: series.map((p) => p.value) }]}
              height={170}
            />
            <div className="rk-monitor-axis">
              <span>0</span>
              <span>{locale === 'fa' ? '۴۰ آرام' : '40 calm'}</span>
              <span>{locale === 'fa' ? '۷۰ جدی' : '70 serious'}</span>
              <span>100</span>
            </div>
          </div>
        ) : (
          <div className="rk-monitor-idle">
            <span className="rk-idle-dot" aria-hidden="true" />
            <p>{rt(locale, 'monitor.noDelta')}</p>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={locale === 'fa' ? 'کدام خانواده‌ها تکان خوردند' : 'Which families moved'}
        hint={locale === 'fa'
          ? 'مقایسهٔ همان دو خوانشی که پایش نگه داشته است.'
          : 'A comparison of the two readings the monitor actually kept.'}
      >
        {(monitor?.families || []).length ? (
          <ul className="rk-movers">
            {monitor.families.map((m) => (
              <li key={m.id}>
                <span className="rk-mover-name">{locale === 'fa' ? m.labelFa : m.labelEn}</span>
                <ScoreChip locale={locale} score={m.to} band={m.band} tone={m.tone} size="sm" />
                <span className={`rk-mover-delta ${m.delta > 0 ? 'is-bad' : m.delta < 0 ? 'is-good' : ''}`}>
                  {m.delta > 0 ? '+' : ''}{m.delta}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rk-empty">
            {locale === 'fa'
              ? 'برای مقایسهٔ خانواده‌ها به یک خوانش دوم نیاز است؛ عددی از خودمان نمی‌سازیم.'
              : 'Comparing families needs a second reading; nothing is invented to fill the gap.'}
          </p>
        )}
      </SectionCard>
    </div>
  );
}
