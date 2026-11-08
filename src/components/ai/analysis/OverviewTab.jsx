import CoinAvatar from './CoinAvatar.jsx';
/**
 * AI INTELLIGENCE — MARKET OVERVIEW
 * ---------------------------------------------------------------------------
 * The answer to "what is the market doing, and how do you know?" — but built
 * to be READ rather than parsed:
 *
 *   · a hero decision block: the regime, its gauge, its confidence, and the
 *     three sentences that explain it;
 *   · six readings with gauges and micro-trends where the number really is a
 *     share of something;
 *   · a momentum/breadth instrument rather than a legend;
 *   · the movers rails and the volume-surge shelf;
 *   · and the feeds that are NOT connected, named, with the line that says no
 *     number was invented for them.
 *
 * Every value comes from `buildMarketPulse`; this file formats, it does not
 * compute. That separation is what lets the numbers be asserted in tests.
 */
import { useMemo, useState } from 'react';
import {
  Change, Pill, ProvenanceDot, SectionCard, ShareBar, Spark, StatTile
} from './ui.jsx';
import {
  fmtMoney, fmtNumber, fmtPct, fmtPrice, t
} from '../../../lib/intelligence/copy.js';
import { marketNarrative } from '../../../lib/intelligence/narrative.js';

/* The regime gauge: a -100..100 rail with a fixed centre. A "score" drawn on a
   0..100 bar would make a neutral market look bearish, which is the single
   most common way a sentiment meter lies. */
function RegimeGauge({ score }) {
  const pos = score == null ? 50 : (score + 100) / 2;
  const clamped = Math.max(1, Math.min(99, pos));
  return (
    <div className="aix-gauge" aria-hidden="true">
      <div className="aix-gauge-track">
        <div className="aix-gauge-zero" />
        <div className="aix-gauge-needle" style={{ left: `${clamped}%` }} />
      </div>
      <div className="aix-gauge-scale">
        <span>-100</span>
        <span>0</span>
        <span>+100</span>
      </div>
    </div>
  );
}

const REGIME_TONE = {
  bullish: 'up',
  'mildly-bullish': 'up',
  neutral: 'neutral',
  'mildly-bearish': 'warn',
  bearish: 'down',
  unknown: 'neutral'
};

function MoverRow({ coin, locale, onOpen, rank }) {
  return (
    <button type="button" className="aix-mover" onClick={() => onOpen?.(coin.id)}>
      <span className="aix-mover-sym">
        {rank ? <em className="aix-mover-rank">{rank}</em> : null}
        <CoinAvatar coin={coin} px={28} />
        <bdi>{coin.symbol}</bdi>
      </span>
      <Spark values={coin.sparkline} up={(coin.change24h ?? 0) >= 0} width={62} height={20} />
      <span className="aix-mover-price">{fmtPrice(coin.price)}</span>
      <Change value={coin.change24h} arrow />
    </button>
  );
}

export default function OverviewTab({ pulse, analysis, locale, onOpenToken }) {
  const [showDrivers, setShowDrivers] = useState(false);
  const nav = useMemo(() => marketNarrative(pulse, locale), [pulse, locale]);

  if (!pulse) return null;
  const {
    totals, breadth, performance, regime, volatility, liquidity, movers, volumeSurges
  } = pulse;

  const breadthTotal = Math.max(1, breadth.counted);
  const advPct = (breadth.advancers / breadthTotal) * 100;
  const decPct = (breadth.decliners / breadthTotal) * 100;
  const flatPct = Math.max(0, 100 - advPct - decPct);
  const regimeTone = REGIME_TONE[regime.label] || 'neutral';
  const isFa = String(locale || '').startsWith('fa');

  return (
    <div className="aix-tab-body">
      {/* ── the decision block ─────────────────────────────────────────── */}
      <SectionCard
        className="aix-card-hero"
        mark="◎"
        title={t(locale, 'kpi.regime')}
        hint={`${t(locale, 'page.confidence')}: ${regime.confidence}/100 · ${t(locale, 'kpi.trendStrength')}: ${regime.trendStrength ?? '—'}/100`}
        actions={(
          <>
            <Pill tone={regimeTone === 'up' ? 'up' : regimeTone === 'down' ? 'down' : regimeTone === 'warn' ? 'warn' : 'calm'} dot>
              {t(locale, `regime.${regime.label}`)}
            </Pill>
            <ProvenanceDot
              provenance={pulse.provenance}
              label={t(locale, `page.${pulse.provenance === 'live' ? 'live' : pulse.provenance === 'stale' ? 'stale' : 'offline'}`)}
            />
          </>
        )}
      >
        <div className="aix-regime-layout">
          <div className="aix-regime">
            <div className={`aix-regime-badge aix-regime-${regime.label}`}>
              <span>{t(locale, `regime.${regime.label}`)}</span>
              <strong>{regime.score > 0 ? '+' : ''}{regime.score ?? '—'}</strong>
              <small>{isFa ? 'امتیاز رژیم' : 'Regime score'}</small>
            </div>
            <div className="aix-regime-body">
              <RegimeGauge score={regime.score} />
              <div className="aix-regime-stats">
                <span>{t(locale, 'kpi.volatility')}<b>{t(locale, `vol.${volatility.label}`)}</b>
                  {volatility.medianSwingPct != null ? <small>{volatility.medianSwingPct.toFixed(2)}%</small> : null}</span>
                <span>{t(locale, 'kpi.liquidity')}<b>{t(locale, `liq.${liquidity.label}`)}</b></span>
                <span>{t(locale, 'kpi.coverage')}<b>{breadth.counted}/{breadth.total}</b></span>
              </div>
            </div>
          </div>

          <div className="aix-regime-narrative">
            <span className="aix-section-kicker">{isFa ? 'خلاصه هوشمند بازار' : 'Market intelligence brief'}</span>
            <ul className="aix-sentences">
              {nav.lines.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </div>
        </div>

        <button
          type="button"
          className="aix-link"
          onClick={() => setShowDrivers((v) => !v)}
          aria-expanded={showDrivers}
        >
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

      {/* ── readings ───────────────────────────────────────────────────── */}
      <div className="aix-tiles">
        <StatTile
          label={t(locale, 'kpi.marketCap')}
          value={totals.mcap ? fmtMoney(totals.mcap, locale) : '—'}
          sub={totals.mcapChange24h != null ? <Change value={totals.mcapChange24h} arrow /> : null}
          tone={(totals.mcapChange24h ?? 0) >= 0 ? 'up' : 'down'}
          icon="◈"
        />
        <StatTile
          label={t(locale, 'kpi.volume')}
          value={totals.volume ? fmtMoney(totals.volume, locale) : '—'}
          sub={totals.volumeChange24h != null ? <Change value={totals.volumeChange24h} arrow /> : null}
          icon="▤"
        />
        <StatTile
          label={t(locale, 'kpi.btcDominance')}
          value={totals.btcDominance != null ? `${totals.btcDominance.toFixed(1)}%` : '—'}
          sub={totals.ethDominance != null ? `ETH ${totals.ethDominance.toFixed(1)}%` : null}
          gauge={totals.btcDominance ?? null}
          icon="₿"
        />
        <StatTile
          label={t(locale, 'kpi.breadth')}
          value={`${breadth.advancers}/${breadth.counted}`}
          sub={t(locale, 'page.rowsCounted', { counted: breadth.counted, total: breadth.total })}
          tone={advPct >= 55 ? 'up' : advPct <= 45 ? 'down' : 'neutral'}
          gauge={breadth.counted ? advPct : null}
          hint={`${breadth.advancers} ↑ · ${breadth.decliners} ↓ · ${breadth.flat} →`}
          icon="≋"
        />
        <StatTile
          label={t(locale, 'kpi.medianChange')}
          value={<Change value={performance.medianChange24h} arrow />}
          sub={performance.avgChangeSource === 'global-feed'
            ? (isFa ? 'از فید جهانی' : 'from the global feed')
            : (isFa ? 'محاسبه‌شده از میانه' : 'derived from the median')}
          tone={(performance.medianChange24h ?? 0) > 0 ? 'up' : (performance.medianChange24h ?? 0) < 0 ? 'down' : 'neutral'}
          icon="↕"
        />
        <StatTile
          label={t(locale, 'kpi.turnover')}
          value={totals.turnoverPct != null ? `${totals.turnoverPct.toFixed(2)}%` : '—'}
          sub={`${t(locale, 'kpi.liquidity')}: ${t(locale, `liq.${liquidity.label}`)}`}
          icon="⇄"
        />
      </div>

      {/* ── breadth as an instrument ───────────────────────────────────── */}
      <SectionCard
        mark="≋"
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
        <div className="aix-review-stats aix-breadth-stats">
          <div className="aix-review-stat">
            <small>{t(locale, 'kpi.rangePosition')}</small>
            <strong>
              {pulse.intraday.medianRangePosition != null
                ? `${(pulse.intraday.medianRangePosition * 100).toFixed(0)}%`
                : '—'}
            </strong>
          </div>
          <div className="aix-review-stat">
            <small>{isFa ? 'پراکندگی تغییرات' : 'Change dispersion'}</small>
            <strong>{performance.dispersionPct != null ? `${performance.dispersionPct.toFixed(2)}%` : '—'}</strong>
          </div>
          <div className="aix-review-stat">
            <small>{isFa ? 'بیشترین رشد / افت ۲۴س' : 'Best / worst 24h'}</small>
            <strong>
              <span className="aix-up">{fmtPct(performance.best24h, { digits: 1 })}</span>
              {' / '}
              <span className="aix-down">{fmtPct(performance.worst24h, { digits: 1 })}</span>
            </strong>
          </div>
        </div>
      </SectionCard>

      {/* ── movers ─────────────────────────────────────────────────────── */}
      <div className="aix-two-up">
        <SectionCard
          mark="▲"
          title={t(locale, 'movers.gainers')}
          hint={`${movers.gainers.length} ${isFa ? 'توکن برتر' : 'top tokens'}`}
        >
          {movers.gainers.length ? (
            <div className="aix-mover-list">
              {movers.gainers.map((c, i) => (
                <MoverRow key={c.id} coin={c} locale={locale} onOpen={onOpenToken} rank={i + 1} />
              ))}
            </div>
          ) : <p className="aix-card-hint">{t(locale, 'movers.empty')}</p>}
        </SectionCard>
        <SectionCard
          mark="▼"
          title={t(locale, 'movers.losers')}
          hint={`${movers.losers.length} ${isFa ? 'توکن ضعیف' : 'weak tokens'}`}
        >
          {movers.losers.length ? (
            <div className="aix-mover-list">
              {movers.losers.map((c, i) => (
                <MoverRow key={c.id} coin={c} locale={locale} onOpen={onOpenToken} rank={i + 1} />
              ))}
            </div>
          ) : <p className="aix-card-hint">{t(locale, 'movers.empty')}</p>}
        </SectionCard>
      </div>

      {/* ── volume surges ──────────────────────────────────────────────── */}
      <SectionCard
        mark="⇈"
        title={t(locale, 'movers.surges')}
        hint={volumeSurges.baseline != null
          ? t(locale, 'movers.surgeBasis', { value: volumeSurges.baseline.toFixed(2) })
          : undefined}
      >
        {volumeSurges.rows.length ? (
          <div className="aix-share-list">
            {volumeSurges.rows.map((c) => (
              <ShareBar
                key={c.id}
                badge={`×${c.surgeRatio.toFixed(1)}`}
                label={<span className="aix-coin-label"><CoinAvatar coin={c} px={28} /><bdi>{c.symbol}</bdi></span>}
                value={fmtPrice(c.price)}
                weight={Math.min(100, c.surgeRatio * 20)}
                tone="amber"
                detail={<><Change value={c.change24h} /> · {c.turnoverPct.toFixed(2)}%</>}
                onClick={() => onOpenToken?.(c.id)}
              />
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'movers.empty')}</p>}
      </SectionCard>

      {/* ── the ranked shortlist + what diverges ─────────────────────────
          This is the part a reader cannot get from the tiles above: the same
          feed, ranked against itself, with the universe median as the zero
          line. Every row shows the inputs that produced its rank, so the
          ordering can be argued with instead of trusted. */}
      {analysis && (analysis.shortlist.length || analysis.unavailable.includes('ranking')) ? (
        <SectionCard
          mark="◎"
          title={t(locale, 'depth.ranking.title')}
          hint={analysis.ranked >= 8
            ? t(locale, 'depth.ranking.hint', { n: analysis.ranked, total: analysis.scanned })
            : t(locale, 'depth.ranking.thin', { n: analysis.ranked })}
        >
          {analysis.shortlist.length ? (
            <div className="aix-share-list">
              {analysis.shortlist.map((row, i) => (
                <ShareBar
                  key={row.id ?? row.symbol}
                  badge={`#${i + 1}`}
                  label={<span className="aix-coin-label"><CoinAvatar coin={row} px={28} /><bdi>{row.symbol}</bdi></span>}
                  value={row.rs.toFixed(1)}
                  weight={row.rs}
                  tone={row.vsTape != null && row.vsTape < 0 ? 'rose' : 'indigo'}
                  detail={<>
                    <Change value={row.change24h} />
                    {row.vsTape != null ? <> · {t(locale, 'depth.vsTape')} <b className={row.vsTape >= 0 ? 'is-up' : 'is-down'} dir="ltr">{row.vsTape >= 0 ? '+' : ''}{row.vsTape.toFixed(2)}%</b></> : null}
                  </>}
                  onClick={() => onOpenToken?.(row.id)}
                />
              ))}
            </div>
          ) : (
            <p className="aix-card-hint">{t(locale, 'depth.ranking.empty')}</p>
          )}
          <p className="aix-card-hint aix-caveat">{t(locale, 'depth.ranking.caveat')}</p>
        </SectionCard>
      ) : null}

      {/* ── dispersion + what would change the read ─────────────────────── */}
      {analysis ? (
        <SectionCard mark="⇄" title={t(locale, 'depth.dispersion.title')} hint={t(locale, 'depth.dispersion.hint')}>
          <div className="aix-facts">
            <div className="aix-fact">
              <span>{t(locale, 'depth.dispersion.value')}</span>
              <strong dir="ltr">{analysis.dispersion == null ? '—' : `${analysis.dispersion.toFixed(2)}%`}</strong>
              <small>{t(locale, 'depth.dispersion.note')}</small>
            </div>
            <div className="aix-fact">
              <span>{t(locale, 'depth.capTop10')}</span>
              <strong dir="ltr">{analysis.top10Share == null ? '—' : `${analysis.top10Share.toFixed(1)}%`}</strong>
              <small>{t(locale, 'depth.capTop10Note')}</small>
            </div>
            <div className="aix-fact">
              <span>{t(locale, 'depth.turnover')}</span>
              <strong dir="ltr">{analysis.medianTurnover == null ? '—' : `${analysis.medianTurnover.toFixed(2)}%`}</strong>
              <small>{t(locale, 'depth.turnoverNote')}</small>
            </div>
          </div>
          {analysis.triggers.length ? (
            <ul className="aix-reasons">
              {analysis.triggers.map((tr) => (
                <li key={tr.key}>
                  {tr.key === 'breadth-up' || tr.key === 'breadth-down'
                    ? t(locale, `depth.trigger.${tr.key}`, { n: tr.tokens, total: tr.counted })
                    : t(locale, `depth.trigger.${tr.key}`, { value: tr.current == null ? '—' : tr.current.toFixed(2) })}
                </li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
      ) : null}

      {/* ── divergence: two different anomalies, kept apart ─────────────── */}
      {analysis && (analysis.divergence.againstTape.length || analysis.divergence.quietVolume.length) ? (
        <SectionCard mark="⟳" title={t(locale, 'depth.divergence.title')} hint={t(locale, 'depth.divergence.hint')}>
          {analysis.divergence.againstTape.length ? (
            <>
              <p className="aix-card-hint">{t(locale, 'depth.divergence.againstTape')}</p>
              <div className="aix-chips">
                {analysis.divergence.againstTape.map((r) => (
                  <button key={r.id ?? r.symbol} type="button" className="aix-chip-btn" onClick={() => onOpenToken?.(r.id)}>
                    <CoinAvatar coin={r} px={24} /><bdi>{r.symbol}</bdi>
                    <Change value={r.change24h} />
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {analysis.divergence.quietVolume.length ? (
            <>
              <p className="aix-card-hint">{t(locale, 'depth.divergence.quietVolume')}</p>
              <div className="aix-chips">
                {analysis.divergence.quietVolume.map((r) => (
                  <button key={r.id ?? r.symbol} type="button" className="aix-chip-btn" onClick={() => onOpenToken?.(r.id)}>
                    <CoinAvatar coin={r} px={24} /><bdi>{r.symbol}</bdi>
                    <span dir="ltr">{(r.turnoverPct == null ? '—' : `${r.turnoverPct.toFixed(2)}%`)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </SectionCard>
      ) : null}

      {/* ── what is NOT connected ──────────────────────────────────────── */}
      <SectionCard mark="⊘" title={t(locale, 'unavailable.title')} hint={t(locale, 'unavailable.note')}>
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
