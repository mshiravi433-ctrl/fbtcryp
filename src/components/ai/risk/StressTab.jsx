/**
 * AI RISK ENGINE — STRESS TEST CENTRE
 * ===========================================================================
 * «Stress Test Center: آزمون پرتفوی در شرایط بحرانی.»
 *
 * Every card answers the same three questions and nothing else:
 *
 *   HOW BAD      the dollar and percent change from today's book
 *   WHERE        which asset takes it, and (for leverage) what gets liquidated
 *   WHY HERE     the assumptions, printed IN THE CARD. A stress result whose
 *                assumptions are one click away is a number with a story
 *                attached after the fact.
 *
 * The Monte-Carlo card is drawn differently on purpose: its output is a
 * DISTRIBUTION (p05/p50/p95 + loss probability), not a single path, and
 * pretending otherwise would be the exact failure mode this engine exists to
 * avoid. Its seed is stated, so the numbers are reproducible.
 */
import { useState } from 'react';
import { SectionCard, Meter, Pill, EmptyState } from '../../ai/analysis/ui.jsx';
import { IconActivity, IconAlertTriangle, IconChevronRight } from '../../Icons.jsx';
import { rt } from '../../../lib/risk/copy.js';
import { fmtUsd } from '../../../lib/format.js';
import { Money, Pct, TONE_CLASS } from './parts.jsx';

const SEV_TONE = { critical: 'serious', high: 'raised', watch: 'watch' };

function Assumptions({ locale, items }) {
  return (
    <details className="rk-assume">
      <summary>
        <IconChevronRight width={13} height={13} />
        {rt(locale, 'stress.assumptions')}
      </summary>
      <ul>
        {items.map((a, i) => <li key={i}>{locale === 'fa' ? a.fa : a.en}</li>)}
      </ul>
    </details>
  );
}

function ScenarioCard({ locale, scenario }) {
  const isMc = scenario.id === 'monte-carlo';
  const loss = scenario.deltaUsd != null && scenario.deltaUsd < 0;
  return (
    <article className={`rk-stress ${TONE_CLASS(SEV_TONE[scenario.severity] || 'watch')}`}>
      <header className="rk-stress-head">
        <h3>{locale === 'fa' ? scenario.titleFa : scenario.titleEn}</h3>
        <Pill tone={scenario.severity === 'critical' ? 'rose' : scenario.severity === 'high' ? 'amber' : 'violet'}>
          {rt(locale, `alerts.sev.${scenario.severity === 'watch' ? 'watch' : scenario.severity}`)}
        </Pill>
      </header>
      <p className="rk-stress-desc">{locale === 'fa' ? scenario.descriptionFa : scenario.descriptionEn}</p>

      <div className="rk-stress-figure">
        <strong className={loss ? 'is-loss' : ''}>
          {scenario.deltaUsd == null ? '—' : <Money value={scenario.deltaUsd} />}
        </strong>
        {scenario.deltaPct != null ? <span><Pct value={scenario.deltaPct} digits={2} /></span> : null}
      </div>

      <dl className="rk-stress-rows">
        <div>
          <dt>{rt(locale, 'stress.before')}</dt>
          <dd>{scenario.beforeUsd == null ? '—' : fmtUsd(scenario.beforeUsd)}</dd>
        </div>
        <div>
          <dt>{rt(locale, 'stress.after')}</dt>
          <dd>{scenario.afterUsd == null ? '—' : fmtUsd(scenario.afterUsd)}</dd>
        </div>
      </dl>

      {isMc ? (
        <>
          <div className="rk-mc-bands">
            <span>{locale === 'fa' ? 'صدک ۵' : 'p05'} <b>{scenario.p05Usd == null ? '—' : fmtUsd(scenario.p05Usd)}</b></span>
            <span>{locale === 'fa' ? 'میانه' : 'p50'} <b>{scenario.p50Usd == null ? '—' : fmtUsd(scenario.p50Usd)}</b></span>
            <span>{locale === 'fa' ? 'صدک ۹۵' : 'p95'} <b>{scenario.p95Usd == null ? '—' : fmtUsd(scenario.p95Usd)}</b></span>
          </div>
          {scenario.lossProbPct != null ? (
            <p className="rk-mc-note">
              {rt(locale, 'stress.mcTail', {
                pct: Math.round(scenario.lossProbPct),
                p05: scenario.p05Usd == null ? '—' : fmtUsd(scenario.p05Usd)
              })}
            </p>
          ) : null}
        </>
      ) : (
        <>
          {scenario.worst?.symbol ? (
            <p className="rk-stress-worst">
              {rt(locale, 'stress.worst', { symbol: scenario.worst.symbol, pct: scenario.worst.lossPct })}
            </p>
          ) : null}
          {scenario.liquidations?.length ? (
            <div className={`rk-liq ${scenario.forcedLossUsd > 0 ? 'has-liq' : ''}`}>
              <span className="rk-liq-title">
                <IconAlertTriangle width={13} height={13} />
                {rt(locale, 'stress.liquidations')}
              </span>
              <ul>
                {scenario.liquidations.map((l) => (
                  <li key={l.symbol} className={l.liquidated ? 'is-liq' : ''}>
                    <b>{l.symbol}</b>
                    <span>{l.leverage == null ? '—' : `${l.leverage}×`}</span>
                    <span>{l.distancePct == null ? '—' : `${l.distancePct}%`}</span>
                    <span>{l.liquidated ? (l.lossUsd == null ? '—' : fmtUsd(l.lossUsd)) : (locale === 'fa' ? 'پایدار' : 'holds')}</span>
                  </li>
                ))}
              </ul>
              {scenario.forcedLossUsd > 0 ? (
                <p className="rk-liq-total">
                  {locale === 'fa' ? 'زیان لیکوییدیشن' : 'Liquidation loss'}
                  <b>{fmtUsd(scenario.forcedLossUsd)}</b>
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <Assumptions locale={locale} items={scenario.assumptions || []} />
    </article>
  );
}

export default function StressTab({ locale, stress, report }) {
  const [severity, setSeverity] = useState('all');
  if (!stress?.length) {
    return <EmptyState title={rt(locale, 'stress.noLegs')} hint={rt(locale, 'page.noWallet')} />;
  }
  const visible = severity === 'all' ? stress : stress.filter((s) => s.severity === severity);
  const worstScenario = stress.reduce((a, b) => ((b.deltaUsd ?? 0) < (a.deltaUsd ?? 0) ? b : a));

  return (
    <div className="rk-stack">
      <SectionCard
        mark={<IconActivity width={16} height={16} />}
        title={rt(locale, 'stress.title')}
        hint={rt(locale, 'stress.hint')}
        actions={(
          <div className="rk-seg">
            {[
              ['all', locale === 'fa' ? 'همه' : 'All'],
              ['critical', rt(locale, 'alerts.sev.critical')],
              ['high', rt(locale, 'alerts.sev.high')],
              ['watch', rt(locale, 'alerts.sev.watch')]
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`rk-seg-btn${severity === id ? ' is-active' : ''}`}
                onClick={() => setSeverity(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      >
        <div className="rk-worst-line">
          <span>{locale === 'fa' ? 'بدترین سناریو' : 'Worst scenario'}</span>
          <b>{locale === 'fa' ? worstScenario.titleFa : worstScenario.titleEn}</b>
          <span className="rk-worst-figure"><Money value={worstScenario.deltaUsd} /></span>
          <span><Pct value={worstScenario.deltaPct} digits={2} /></span>
        </div>
        <div className="rk-stress-grid">
          {visible.map((s) => <ScenarioCard key={s.id} locale={locale} scenario={s} />)}
        </div>
        <p className="rk-foot">
          {locale === 'fa'
            ? 'هیچ‌کدام از این‌ها پیش‌بینی نیست؛ هر کارت یک «اگر» است با فرض‌های خودش. توزیع مونت‌کارلو با بذر ثابت اجرا می‌شود، پس همان ورودی همان خروجی را می‌دهد.'
            : 'None of this is a forecast; each card is an "if" carrying its own assumptions. The Monte-Carlo runs on a fixed seed, so the same input yields the same output.'}
        </p>
      </SectionCard>
    </div>
  );
}
