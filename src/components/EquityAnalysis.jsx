import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sparkline from './Sparkline';
import { IconSwap } from './Icons';
import { fmtCompact, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { equitySeriesFacts, equityStats } from '../lib/equityAnalysis';
import { fetchEquityChart, isUsableSeries } from '../lib/equityChart';
import { usePoll } from '../hooks/useMarket';

/**
 * THE ANALYSIS PANEL UNDER ONE ROW.
 * ---------------------------------------------------------------------------
 * «صفحه هر سهم تحلیل مثل تحلیل RWA باشد» — every stock deserves the treatment
 * the RWA tokens already had: a specification you can read, the numbers that
 * decide whether the trade is safe, and a measured account of what the price
 * has already done.
 *
 * ─── WHY IT IS INLINE AND NOT A SHEET ──────────────────────────────────────
 * It was asked for as «باکس بازشونده برای هر توکن» — an expanding box on each
 * token. A bottom sheet would do the same job and lose the row: you would tap
 * "details", the list would vanish behind a scrim, and you would come back
 * having lost your place in a list of twenty-two names. The panel opens
 * directly under its own row instead, so the row you were reading stays on
 * screen and the numbers sit beside the price they describe.
 *
 * ─── WHY THE CHART FETCH LIVES HERE AND NOT ON THE PAGE ────────────────────
 * This component is mounted only while it is open, so the 90-day series is
 * requested by the tap and not by the page. Twenty-two closed panels would
 * otherwise be twenty-two CoinGecko calls every sixty seconds.
 *
 * ─── AND WHY IT CAN BE EMPTY ───────────────────────────────────────────────
 * Six of the twenty-two tickers have no CoinGecko listing (GMEx, MCDx, KOx,
 * PLTRx, XOMx, CVXx). For those the panel shows the depth analysis — which is
 * real and comes from the same feed as the price — and says plainly that no
 * history is available. It does not fill the gap with a synthetic series: see
 * lib/equityChart.js for why that was the one option ruled out.
 */

const DAYS = 90;

function Stat({ label, value, tone }) {
  return (
    <div className="eqan-stat">
      <div className="eqan-stat-k faint">{label}</div>
      <div className={`eqan-stat-v mono ${tone === 'up' ? 'up' : tone === 'down' ? 'down' : ''}`}>
        {value}
      </div>
    </div>
  );
}

export default function EquityAnalysis({ asset, amountUsd = 1000, onBuy }) {
  const { t } = useTranslation();

  const hasId = Boolean(asset?.coingeckoId);
  const { data: chart, loading } = usePoll(
    () => (hasId ? fetchEquityChart(asset.coingeckoId, DAYS) : Promise.resolve([])),
    [asset?.coingeckoId, hasId],
    120_000
  );

  const series = useMemo(() => (chart ?? []).map((d) => d.p), [chart]);
  const usable = useMemo(() => isUsableSeries(series), [series]);

  const facts = useMemo(
    () => (usable ? equitySeriesFacts(series, { days: DAYS }) : []),
    [series, usable]
  );

  const stats = useMemo(() => equityStats(asset, amountUsd, series), [asset, amountUsd, series]);

  /* Colour on the sparkline follows the WINDOW, not the 24h delta: the line
     being drawn is the 90-day series, and a green line for a series that ended
     below where it started would be the chart arguing with itself. */
  const sparkUp = (stats.windowChange ?? 0) >= 0;

  const formatFact = (id, values) => {
    const v = { ...values };
    for (const key of ['price', 'low', 'high']) {
      if (v[key] != null) v[key] = fmtPrice(v[key]);
    }
    return t(`history.equity.${id}`, v);
  };

  return (
    <motion.div
      className="eqan"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="eqan-inner">
        {/* ── the 90-day series, when one exists ───────────────────────── */}
        {hasId && (
          <div className="eqan-chart">
            <div className="eqan-chart-head">
              <span className="faint">{t('stocks.eq.window90', { days: DAYS })}</span>
              {stats.windowChange != null && (
                <span className={`mono ${sparkUp ? 'up' : 'down'}`}>
                  {fmtPct(stats.windowChange, 1)}
                </span>
              )}
            </div>
            {loading && series.length === 0 ? (
              <div className="skel" style={{ height: 56, borderRadius: 12 }} />
            ) : usable ? (
              <Sparkline data={series} up={sparkUp} width={320} height={56} strokeWidth={1.8} />
            ) : (
              <p className="eqan-nohist">{t('stocks.eq.noHistory')}</p>
            )}
          </div>
        )}

        {/* ── the numbers, as a grid ────────────────────────────────────── */}
        <div className="eqan-grid">
          <Stat label={t('stocks.eq.price')} value={stats.price != null ? `$${fmtPrice(stats.price)}` : '—'} />
          <Stat
            label={t('stocks.eq.change24h')}
            value={stats.change24h != null ? fmtPct(stats.change24h, 1) : '—'}
            tone={stats.change24h != null ? (stats.change24h >= 0 ? 'up' : 'down') : undefined}
          />
          <Stat
            label={t('stocks.eq.windowChange', { days: DAYS })}
            value={stats.windowChange != null ? fmtPct(stats.windowChange, 1) : '—'}
            tone={stats.windowChange != null ? (stats.windowChange >= 0 ? 'up' : 'down') : undefined}
          />
          <Stat
            label={t('stocks.eq.range')}
            value={stats.low != null ? `$${fmtPrice(stats.low)} – $${fmtPrice(stats.high)}` : '—'}
          />
          <Stat
            label={t('stocks.eq.drawdown')}
            value={stats.drawdown != null ? `${Math.round(stats.drawdown)}%` : '—'}
            tone={stats.drawdown != null && stats.drawdown >= 30 ? 'down' : undefined}
          />
          <Stat label={t('stocks.depth')} value={fmtCompact(stats.depth.pool)} />
          <Stat label={t('stocks.eq.holders')} value={stats.holders != null ? fmtCompact(stats.holders) : '—'} />
          <Stat
            label={t('stocks.eq.youGet', { amount: fmtUsd(amountUsd) })}
            value={stats.units != null ? `${stats.units < 0.01 ? stats.units.toFixed(4) : stats.units.toFixed(2)} ${asset?.symbol ?? ''}` : '—'}
          />
        </div>

        {/* ── what the past says ────────────────────────────────────────── */}
        {facts.length > 0 && (
          <div className="eqan-facts">
            <p className="eqan-facts-title">{t('history.title')}</p>
            <ul className="hist-list">
              {facts.map((f) => (
                <li key={f.id} className={`hist-item hist-${f.kind}`}>
                  <span className="hist-dot" aria-hidden="true" />
                  <span>{formatFact(f.id, f.values)}</span>
                </li>
              ))}
            </ul>
            <p className="notice eqan-advice">{t('history.notAdvice')}</p>
          </div>
        )}

        {/*
          Two different reasons a panel can be empty, and they must not be
          blurred into one: a token CoinGecko does not list at all (six of the
          twenty-two) has no series to fetch, while one that IS listed can still
          come back short or fail. Saying "no history" for the first and "could
          not load" for the second is the difference between an honest screen
          and a vague one.
        */}
        {!hasId && <p className="eqan-nohist">{t('stocks.eq.noHistoryBody')}</p>}
        {hasId && !usable && !loading && (
          <p className="eqan-nohist">{t('stocks.eq.noHistoryShort')}</p>
        )}

        {/* ── depth: can you actually get out ───────────────────────────── */}
        <div className="eqan-depth">
          <p className="eqan-depth-title">{t('stocks.eq.depthTitle')}</p>
          <div className="eqan-depth-row">
            <span className="faint">{t('stocks.eq.poolDepth')}</span>
            <span className="mono">{fmtCompact(stats.depth.pool)}</span>
          </div>
          <div className="eqan-depth-row">
            <span className="faint">{t('stocks.eq.yourShare')}</span>
            <span className="mono">
              {stats.depth.share != null ? `${(stats.depth.share * 100).toFixed(2)}%` : '—'}
            </span>
          </div>
          {!stats.depth.ok && stats.depth.maxUsd != null && (
            <p className="eqan-depth-warn">
              {t('stocks.eq.tooDeep', { max: fmtCompact(stats.depth.maxUsd) })}
            </p>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary eqan-buy"
          disabled={!stats.depth.ok}
          onClick={() => onBuy?.(asset)}
        >
          <IconSwap width={15} height={15} />
          <span>{t('stocks.buyWith', { sym: asset?.symbol ?? '' })}</span>
        </button>
      </div>
    </motion.div>
  );
}
