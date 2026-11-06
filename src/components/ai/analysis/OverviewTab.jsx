/**
 * AI INTELLIGENCE — MARKET OVERVIEW
 * ---------------------------------------------------------------------------
 * The answer to "what is the market doing, and how do you know?": six measured
 * tiles, the regime label with its four weighted inputs, breadth, the movers
 * rails and the feeds that are NOT connected.
 *
 * Every value comes from `buildMarketPulse`; this file formats, it does not
 * compute. That separation is what lets the numbers be asserted in tests.
 */
import { useMemo, useState } from 'react';
import { Change, ProvenanceDot, SectionCard, Spark, StatTile } from './ui.jsx';
import { fmtMoney, fmtNumber, fmtPct, t } from '../../../lib/intelligence/copy.js';
import { marketNarrative } from '../../../lib/intelligence/narrative.js';

function RegimeGauge({ score }) {
  /* The gauge is a -100..100 scale with a fixed centre rail: a "score" drawn on
     a 0..100 bar would make a neutral market look bearish. */
  const pos = score == null ? 50 : (score + 100) / 2;
  return (
    <div className="aix-gauge" aria-hidden="true">
      <div className="aix-gauge-track">
        <div className="aix-gauge-zero" />
        <div
          className="aix-gauge-needle"
          style={{ left: `${Math.max(1, Math.min(99, pos))}%` }}
        />
      </div>
      <div className="aix-gauge-scale">
        <span>-100</span>
        <span>0</span>
        <span>+100</span>
      </div>
    </div>
  );
}

function MoverRow({ coin, locale, onOpen }) {
  return (
    <button type="button" className="aix-mover" onClick={() => onOpen?.(coin.id)}>
      <span className="aix-mover-sym">{coin.symbol}</span>
      <Spark values={coin.sparkline} up={(coin.change24h ?? 0) >= 0} width={64} height={22} />
      <span className="aix-mover-price">
        {coin.price >= 1 ? `$${coin.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${coin.price.toPrecision(3)}`}
      </span>
      <Change value={coin.change24h} />
    </button>
  );
}

export default function OverviewTab({ pulse, locale, onOpenToken }) {
  const [showDrivers, setShowDrivers] = useState(false);
  const nav = useMemo(() => marketNarrative(pulse, locale), [pulse, locale]);

  if (!pulse) return null;
  const { totals, breadth, performance, regime, volatility, liquidity, movers, volumeSurges } = pulse;

  const breadthTotal = Math.max(1, breadth.counted);
  const advPct = (breadth.advancers / breadthTotal) * 100;
  const decPct = (breadth.decliners / breadthTotal) * 100;
  const flatPct = Math.max(0, 100 - advPct - decPct);

  return (
    <div className="aix-tab-body">
      <div className="aix-tiles">
        <StatTile
          label={t(locale, 'kpi.marketCap')}
          value={totals.mcap ? fmtMoney(totals.mcap, locale) : '—'}
          sub={totals.mcapChange24h != null ? <Change value={totals.mcapChange24h} /> : null}
          tone={(totals.mcapChange24h ?? 0) >= 0 ? 'up' : 'down'}
        />
        <StatTile
          label={t(locale, 'kpi.volume')}
          value={totals.volume ? fmtMoney(totals.volume, locale) : '—'}
          sub={totals.volumeChange24h != null ? <Change value={totals.volumeChange24h} /> : null}
        />
        <StatTile
          label={t(locale, 'kpi.btcDominance')}
          value={totals.btcDominance != null ? `${totals.btcDominance.toFixed(1)}%` : '—'}
          sub={totals.ethDominance != null ? `ETH ${totals.ethDominance.toFixed(1)}%` : null}
        />
        <StatTile
          label={t(locale, 'kpi.breadth')}
          value={`${breadth.advancers}/${breadth.counted}`}
          sub={t(locale, 'page.rowsCounted', { counted: breadth.counted, total: breadth.total })}
          tone={advPct >= 55 ? 'up' : advPct <= 45 ? 'down' : 'neutral'}
          hint={`${breadth.advancers} ↑ · ${breadth.decliners} ↓ · ${breadth.flat} →`}
        />
        <StatTile
          label={t(locale, 'kpi.medianChange')}
          value={<Change value={performance.medianChange24h} />}
          sub={performance.avgChangeSource === 'global-feed'
            ? (locale === 'fa' ? 'از فید جهانی' : 'from the global feed')
            : (locale === 'fa' ? 'محاسبه‌شده از میانه' : 'derived from the median')}
        />
        <StatTile
          label={t(locale, 'kpi.turnover')}
          value={totals.turnoverPct != null ? `${totals.turnoverPct.toFixed(2)}%` : '—'}
          sub={`${t(locale, 'kpi.liquidity')}: ${t(locale, `liq.${liquidity.label}`)}`}
        />
      </div>

      <SectionCard
        title={t(locale, 'kpi.regime')}
        hint={t(locale, 'page.confidence') + `: ${regime.confidence}/100`}
        actions={<ProvenanceDot provenance={pulse.provenance} label={t(locale, `page.${pulse.provenance === 'live' ? 'live' : pulse.provenance === 'stale' ? 'stale' : 'offline'}`)} />}
      >
        <div className="aix-regime">
          <div className={`aix-regime-badge aix-regime-${regime.label}`}>
            <span>{t(locale, `regime.${regime.label}`)}</span>
            <strong>{regime.score > 0 ? '+' : ''}{regime.score}</strong>
          </div>
          <div className="aix-regime-body">
            <RegimeGauge score={regime.score} />
            <div className="aix-regime-stats">
              <span>{t(locale, 'kpi.trendStrength')}: <b>{regime.trendStrength ?? '—'}/100</b></span>
              <span>{t(locale, 'kpi.volatility')}: <b>{t(locale, `vol.${volatility.label}`)}</b>
                {volatility.medianSwingPct != null ? ` · ${volatility.medianSwingPct.toFixed(2)}%` : ''}</span>
              <span>{t(locale, 'kpi.coverage')}: <b>{breadth.counted}/{breadth.total}</b></span>
            </div>
          </div>
        </div>

        <ul className="aix-sentences">
          {nav.lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>

        <button type="button" className="aix-link" onClick={() => setShowDrivers((v) => !v)}>
          {showDrivers ? '−' : '+'} {t(locale, 'market.drivers')}
        </button>

        {showDrivers ? (
          <div className="aix-drivers">
            <p className="aix-card-hint">{t(locale, 'market.why')}</p>
            {nav.drivers.map((d) => (
              <div key={d.key} className={`aix-driver${d.available ? '' : ' is-missing'}`}>
                <span className="aix-driver-name">{d.label}</span>
                <span className="aix-driver-weight">×{d.weight.toFixed(2)}</span>
                <span className="aix-driver-value">{d.valueText}</span>
              </div>
            ))}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t(locale, 'kpi.breadth')}
        hint={`${breadth.advancers} ↑ · ${breadth.decliners} ↓ · ${breadth.flat} → · ${breadth.counted}/${breadth.total}`}
      >
        <div className="aix-breadth" role="img" aria-label={`${breadth.advancers} up, ${breadth.decliners} down`}>
          <div className="aix-breadth-up" style={{ width: `${advPct}%` }} />
          <div className="aix-breadth-flat" style={{ width: `${flatPct}%` }} />
          <div className="aix-breadth-down" style={{ width: `${decPct}%` }} />
        </div>
        <div className="aix-breadth-legend">
          <span className="aix-up">{fmtNumber(breadth.advancers)} {fmtPct(advPct, { signed: false, digits: 0 })}</span>
          <span className="aix-flat">{fmtNumber(breadth.flat)}</span>
          <span className="aix-down">{fmtNumber(breadth.decliners)} {fmtPct(decPct, { signed: false, digits: 0 })}</span>
        </div>
        <p className="aix-card-hint">
          {t(locale, 'kpi.rangePosition')}: {pulse.intraday.medianRangePosition != null
            ? `${(pulse.intraday.medianRangePosition * 100).toFixed(0)}%`
            : '—'}
          {' · '}
          {locale === 'fa' ? 'پراکندگی تغییرات' : 'Change dispersion'}: {performance.dispersionPct != null ? `${performance.dispersionPct.toFixed(2)}%` : '—'}
        </p>
      </SectionCard>

      <div className="aix-two-up">
        <SectionCard title={t(locale, 'movers.gainers')}>
          {movers.gainers.length
            ? movers.gainers.map((c) => <MoverRow key={c.id} coin={c} locale={locale} onOpen={onOpenToken} />)
            : <p className="aix-card-hint">{t(locale, 'movers.empty')}</p>}
        </SectionCard>
        <SectionCard title={t(locale, 'movers.losers')}>
          {movers.losers.length
            ? movers.losers.map((c) => <MoverRow key={c.id} coin={c} locale={locale} onOpen={onOpenToken} />)
            : <p className="aix-card-hint">{t(locale, 'movers.empty')}</p>}
        </SectionCard>
      </div>

      <SectionCard
        title={t(locale, 'movers.surges')}
        hint={volumeSurges.baseline != null
          ? t(locale, 'movers.surgeBasis', { value: volumeSurges.baseline.toFixed(2) })
          : undefined}
      >
        {volumeSurges.rows.length ? (
          <div className="aix-surge-list">
            {volumeSurges.rows.map((c) => (
              <button type="button" key={c.id} className="aix-surge" onClick={() => onOpenToken?.(c.id)}>
                <span className="aix-surge-sym">{c.symbol}</span>
                <span className="aix-surge-ratio">×{c.surgeRatio.toFixed(1)}</span>
                <span className="aix-surge-turn">{c.turnoverPct.toFixed(2)}%</span>
                <Change value={c.change24h} />
              </button>
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'movers.empty')}</p>}
      </SectionCard>

      <SectionCard title={t(locale, 'unavailable.title')} hint={t(locale, 'unavailable.note')}>
        <div className="aix-unavailable">
          {pulse.unavailable.map((key) => (
            <span key={key} className="aix-unavailable-item">
              <i aria-hidden="true" />
              {t(locale, `unavailable.${key}`)}
            </span>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
