/**
 * AI INTELLIGENCE — DAILY REPORT
 * ---------------------------------------------------------------------------
 * Renders the composed report (lib/intelligence/report.js) and lets the user
 * copy or download the exact text that is on screen. Nothing is regenerated at
 * copy time, so what leaves the app is what was reviewed in it.
 */
import { useMemo, useState } from 'react';
import { ProvenanceDot, SectionCard } from './ui.jsx';
import { t } from '../../../lib/intelligence/copy.js';
import { buildDailyReport, reportFileName } from '../../../lib/intelligence/report.js';

export default function ReportTab({ pulse, scan, locale, markets, sourceLabel }) {
  const [copied, setCopied] = useState(false);
  const [builtAt, setBuiltAt] = useState(() => Date.now());
  const report = useMemo(
    () => buildDailyReport({ pulse, scan, locale, now: builtAt, sourceLabel }),
    [pulse, scan, locale, builtAt, sourceLabel]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([report.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFileName(report.generatedAt);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="aix-tab-body">
      <SectionCard
        className="aix-report-card"
        title={report.title}
        hint={report.sourceLine}
        actions={(
          <>
            <ProvenanceDot provenance={report.provenance} />
            <button type="button" className="aix-cta aix-cta-ghost" onClick={() => setBuiltAt(Date.now())}>
              {t(locale, 'page.refresh')}
            </button>
            <button type="button" className="aix-cta aix-cta-ghost" onClick={copy}>{copied ? t(locale, 'report.copied') : t(locale, 'report.copy')}</button>
            <button type="button" className="aix-cta aix-cta-ghost" onClick={download}>{t(locale, 'report.download')}</button>
          </>
        )}
      >
        <div className="aix-report">
          {report.sections.map((s) => (
            <section key={s.id} className="aix-report-section">
              <h3>{s.title}</h3>
              <ul>
                {s.lines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
              {s.footnote ? <p className="aix-card-hint">{s.footnote}</p> : null}
            </section>
          ))}
        </div>
        <p className="aix-foot-note">
          {t(locale, 'report.generatedAt', { time: new Date(report.generatedAt).toISOString().slice(0, 16).replace('T', ' ') })}
          {' · '}
          {markets?.length ?? 0} {locale === 'fa' ? 'ردیف بازار خوانده شد' : 'market rows read'}
          {' · '}
          {t(locale, 'page.notAdvice')}
        </p>
      </SectionCard>
    </div>
  );
}
