import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { historyFacts } from '../lib/history';
import { fmtPrice } from '../lib/format';

/**
 * "What the past says" — the readable half of lib/history.js.
 *
 * ─── WHY THE NUMBERS ARE FORMATTED HERE AND NOT IN THE ENGINE ───────────────
 * `historyFacts()` returns raw numbers and a translation key. It never builds
 * a sentence, because a module that formats its own strings cannot be
 * translated, and this app ships in twelve languages with two of them
 * right-to-left.
 *
 * So the engine measures and this component renders. It also means the maths
 * can be unit-tested without a DOM.
 *
 * ─── WHY IT RENDERS NOTHING RATHER THAN A PLACEHOLDER ───────────────────────
 * A new or thinly-traded coin genuinely has nothing to say. Showing an empty
 * panel with a spinner implies data is coming that never will; showing
 * invented filler would be worse. When there are no facts, there is no panel.
 */
export default function HistoryPanel({ series, days = 90, volume, volumeHistory, compact = false }) {
  const { t } = useTranslation();

  const facts = useMemo(
    () => historyFacts(series, { days, volume, volumeHistory }),
    [series, days, volume, volumeHistory]
  );

  if (!facts.length) return null;

  /*
   * Prices are formatted with the app's own price formatter, so a $68,000
   * coin and a $0.0000041 coin both read correctly. Passing a raw number
   * into the translation would render "0.0000041000000001" on the second.
   */
  const format = (id, values) => {
    const v = { ...values };
    for (const key of ['price', 'low', 'high']) {
      if (v[key] != null) v[key] = fmtPrice(v[key]);
    }
    return t(`history.${id}`, v);
  };

  return (
    <section className="hist-panel">
      <div className="hist-head">
        <p className="section-label" style={{ margin: 0 }}>{t('history.title')}</p>
      </div>

      {!compact && (
        <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.7, margin: '2px 0 10px' }}>
          {t('history.subtitle', { days })}
        </p>
      )}

      <ul className="hist-list">
        {facts.map((f) => (
          <li key={f.id} className={`hist-item hist-${f.kind}`}>
            <span className="hist-dot" aria-hidden="true" />
            <span>{format(f.id, f.values)}</span>
          </li>
        ))}
      </ul>

      {/*
        Non-negotiable, and deliberately the last thing read.

        Everything above is a measurement, but a list of measurements about
        price reads as advice unless it is told not to. "A level that held
        four times can break on the fifth" is the single most important
        sentence on this panel.
      */}
      <p className="notice" style={{ marginTop: 10 }}>{t('history.notAdvice')}</p>
    </section>
  );
}
