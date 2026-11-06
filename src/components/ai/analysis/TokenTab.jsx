/**
 * AI INTELLIGENCE — TOKEN INTELLIGENCE
 * ---------------------------------------------------------------------------
 * One token's file: candles with overlays, every indicator the score used,
 * support/resistance and Fibonacci from the same bars, and the composite score
 * broken into its five weighted parts — each with the evidence that produced
 * it. A component with no evidence is shown as "not available", never as 50.
 */
import { useMemo, useState } from 'react';
import {
  Change, Chip, ProvenanceDot, ScoreRing, SectionCard, Spark, StatTile
} from './ui.jsx';
import IndicatorChart from './IndicatorChart.jsx';
import { fmtMoney, fmtNumber, fmtPrice, t } from '../../../lib/intelligence/copy.js';
import { tokenNarrative } from '../../../lib/intelligence/narrative.js';
import { SCORE_LABELS, missingForScore } from '../../../lib/intelligence/tokenScore.js';

const RANGES = [
  { days: 30, key: 'token.days.30' },
  { days: 90, key: 'token.days.90' },
  { days: 180, key: 'token.days.180' }
];

const COMPONENT_TONE = {
  technical: 'cyan',
  momentum: 'mint',
  liquidity: 'violet',
  structure: 'amber',
  risk: 'rose'
};

function fmtIndicator(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 1) return v.toFixed(digits);
  return v.toPrecision(3);
}

export default function TokenTab({
  markets = [],
  locale,
  selectedId,
  onSelect,
  pack,
  score,
  coin,
  loading,
  days,
  onDays,
  onOpenFull
}) {
  const [showWeights, setShowWeights] = useState(false);
  const options = useMemo(
    () => [...markets].sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9)).slice(0, 300),
    [markets]
  );
  const nav = useMemo(() => tokenNarrative({ coin, pack, score, locale }), [coin, pack, score, locale]);
  const v = pack?.values || {};
  const levels = pack?.levels || [];
  const fib = pack?.fibonacci;

  return (
    <div className="aix-tab-body">
      <SectionCard
        title={t(locale, 'tab.token')}
        hint={locale === 'fa' ? 'پرونده کامل هر توکن با شواهد عددی' : 'One token, every number with its evidence'}
        actions={coin ? <ProvenanceDot provenance={coin.provenance || coin.dataProvenance || 'unknown'} /> : null}
      >
        <div className="aix-toolbar aix-toolbar-split">
          <label className="aix-select">
            <span>{t(locale, 'token.pick')}</span>
            <select value={selectedId} onChange={(e) => onSelect(e.target.value)}>
              {options.map((r) => (
                <option key={r.id} value={r.id}>{r.symbol} — {r.name}</option>
              ))}
            </select>
          </label>
          <div className="aix-chips">
            {RANGES.map((r) => (
              <Chip key={r.days} active={days === r.days} onClick={() => onDays(r.days)}>{t(locale, r.key)}</Chip>
            ))}
          </div>
        </div>

        {coin ? (
          <div className="aix-token-head">
            <div>
              <h3 className="aix-token-title">{coin.symbol}<span>{coin.name}</span></h3>
              <div className="aix-token-meta">
                <strong>{fmtPrice(coin.price)}</strong>
                <Change value={coin.change24h} />
                {coin.rank ? <span className="aix-chip-static">#{coin.rank}</span> : null}
                {coin.mcap ? <span className="aix-muted">{fmtMoney(coin.mcap, locale)}</span> : null}
              </div>
            </div>
            <div className="aix-token-head-right">
              <Spark values={coin.sparkline} up={(coin.change24h ?? 0) >= 0} width={92} height={30} />
              {onOpenFull ? (
                <button type="button" className="aix-link" onClick={() => onOpenFull(coin.id)}>
                  {t(locale, 'token.openFull')} ↗
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </SectionCard>

      <div className="aix-score-wrap">
        <SectionCard title={t(locale, 'token.score')} hint={t(locale, `band.${score?.band || 'neutral'}`)}>
          <div className="aix-score">
            <ScoreRing value={score?.composite ?? null} band={score?.band} caption={t(locale, 'token.score')} />
            <div className="aix-score-body">
              {score?.composite != null ? (
                <p className="aix-score-line">
                  {t(locale, 'token.scoreCoverage', { value: score.coverage })}
                </p>
              ) : (
                <p className="aix-score-line aix-warn">{t(locale, 'token.scoreMissing')}</p>
              )}
              {score?.components?.map((c) => (
                <div key={c.key} className={`aix-comp${c.available ? '' : ' is-missing'}`}>
                  <span className="aix-comp-name">
                    {locale === 'fa' ? SCORE_LABELS[c.key].fa : SCORE_LABELS[c.key].en}
                    <em>×{c.weight.toFixed(2)}</em>
                  </span>
                  <span className="aix-comp-bar">
                    <i className={`aix-bar-${COMPONENT_TONE[c.key] || 'cyan'}`} style={{ width: `${c.available ? c.score : 0}%` }} />
                  </span>
                  <span className="aix-comp-value">{c.available ? c.score : '—'}</span>
                </div>
              ))}
              {score?.composite == null ? (
                <p className="aix-card-hint">
                  {missingForScore(score).map((m) => `${locale === 'fa' ? SCORE_LABELS[m.key].fa : SCORE_LABELS[m.key].en}: ${m.reason}`).join(' · ')}
                </p>
              ) : null}
              <button type="button" className="aix-link" onClick={() => setShowWeights((x) => !x)}>
                {showWeights ? '−' : '+'} {t(locale, 'token.about')}
              </button>
              {showWeights ? (
                <p className="aix-card-hint">
                  {t(locale, 'token.weights')}: {Object.entries(score?.weights || {}).map(([k, w]) => `${locale === 'fa' ? SCORE_LABELS[k].fa : SCORE_LABELS[k].en} ${(w * 100).toFixed(0)}%`).join(' · ')}
                  {' — '}
                  {t(locale, 'page.notAdvice')}
                </p>
              ) : null}
            </div>
          </div>

          <div className="aix-caveats">
            {(score?.caveats || []).map((c) => (
              <span key={c} className="aix-caveat">{t(locale, `caveat.${c}`)}</span>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title={t(locale, 'token.technical')} hint={t(locale, 'page.usdNote')}>
        {loading ? <p className="aix-card-hint">{t(locale, 'page.loading')}</p> : null}
        <IndicatorChart pack={pack} locale={locale} />
        <ul className="aix-sentences">
          {nav.lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      </SectionCard>

      <SectionCard title={t(locale, 'token.indicators')}>
        <div className="aix-tiles aix-tiles-compact">
          <StatTile label={t(locale, 'token.rsi')} value={fmtIndicator(v.rsi14, 1)} tone={v.rsi14 > 70 ? 'down' : v.rsi14 < 30 ? 'warn' : 'neutral'} />
          <StatTile label={t(locale, 'token.macd')} value={fmtIndicator(v.macdHist, 4)} tone={(v.macdHist ?? 0) >= 0 ? 'up' : 'down'} />
          <StatTile label={t(locale, 'token.bollinger')} value={fmtIndicator(v.bbPercentB, 2)} />
          <StatTile label={t(locale, 'token.atr')} value={v.atrPct != null ? `${v.atrPct.toFixed(2)}%` : '—'} />
          <StatTile label={t(locale, 'token.trend')} value={t(locale, `token.trend.${v.trend?.label || 'unknown'}`)} sub={`${v.trend?.strength ?? '—'}/100`} />
          <StatTile label={t(locale, 'token.sma20')} value={fmtIndicator(v.sma20, 2)} sub={pack?.position?.aboveSma20 == null ? '—' : pack.position.aboveSma20 ? '▲' : '▼'} />
          <StatTile label={t(locale, 'token.sma50')} value={fmtIndicator(v.sma50, 2)} sub={pack?.position?.aboveSma50 == null ? '—' : pack.position.aboveSma50 ? '▲' : '▼'} />
          <StatTile label={t(locale, 'token.sma200')} value={fmtIndicator(v.sma200, 2)} sub={pack?.position?.aboveSma200 == null ? '—' : pack.position.aboveSma200 ? '▲' : '▼'} />
        </div>
      </SectionCard>

      <SectionCard title={t(locale, 'token.levels')} hint={t(locale, 'page.insufficient') + ' →'}>
        <div className="aix-levels">
          <div className="aix-level aix-level-res">
            <span>{t(locale, 'token.resistance')}</span>
            <strong>{pack?.nearest?.resistance ? fmtPrice(pack.nearest.resistance.price) : '—'}</strong>
            <em>{pack?.nearest?.resistance?.distancePct != null ? `${pack.nearest.resistance.distancePct.toFixed(2)}%` : ''}</em>
          </div>
          <div className="aix-level aix-level-sup">
            <span>{t(locale, 'token.support')}</span>
            <strong>{pack?.nearest?.support ? fmtPrice(pack.nearest.support.price) : '—'}</strong>
            <em>{pack?.nearest?.support?.distancePct != null ? `${pack.nearest.support.distancePct.toFixed(2)}%` : ''}</em>
          </div>
        </div>
        {levels.length ? (
          <div className="aix-level-list">
            {levels.slice(0, 6).map((l) => (
              <div key={`${l.price}-${l.kind}`} className={`aix-level-row aix-level-${l.kind}`}>
                <span>{fmtPrice(l.price)}</span>
                <span>{l.kind === 'both' ? '⇅' : l.kind === 'high' ? 'R' : 'S'}</span>
                <span>{l.touches}×</span>
                <span>{l.distancePct != null ? `${l.distancePct.toFixed(2)}%` : '—'}</span>
              </div>
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'page.insufficient')}</p>}

        {fib ? (
          <div className="aix-fib">
            <span className="aix-card-hint">{t(locale, 'token.fib')} · 0.236 → 0.786</span>
            <div className="aix-fib-rows">
              {Object.entries(fib.levels).map(([ratio, price]) => (
                <div key={ratio} className="aix-fib-row">
                  <span>{ratio}</span>
                  <span className="aix-mono">{fmtPrice(price)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </SectionCard>

      <p className="aix-foot-note">
        {t(locale, 'page.notAdvice')}
        {' · '}
        {fmtNumber(pack?.bars ?? 0)} {locale === 'fa' ? 'کندل خوانده شد' : 'bars read'}
      </p>
    </div>
  );
}
