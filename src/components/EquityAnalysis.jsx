import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sparkline from './Sparkline';
import TokenIcon from '../lib/tokenIcon';
import { IconSwap, IconX } from './Icons';
import { fmtCompact, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { equitySeriesFacts, equityStats } from '../lib/equityAnalysis';
import { fetchEquityChartWindowed, isUsableSeries } from '../lib/equityChart';
import { usePoll } from '../hooks/useMarket';
import { lockBodyScroll } from '../lib/scrollLock';
import { useStill } from './AnimatedIcon';

/**
 * THE ANALYSIS PAGE FOR ONE TOKENISED EQUITY.
 * ---------------------------------------------------------------------------
 * First asked for as an expanding box under each row («باکس بازشونده برای هر
 * توکن»). Upgraded directly: «تحلیل را به صورت پاپ آپ کامل صفحه‌ای می‌خواهم —
 * تاریخ قیمتی در دسترس نیست + دامنه {{days}} روز — خراب است». Two separate
 * bugs hid inside that sentence:
 *
 * 1. THE WINDOW LABEL. `stocks.eq.range` is «دامنه {{days}} روز» and the panel
 *    called t('stocks.eq.range') with no `days` — the raw placeholder printed.
 *    Every `{{days}}` key below is now fed the window that actually produced
 *    the numbers, not the window we hoped for.
 *
 * 2. THE 90-DAY OR NOTHING FETCH. Young ticker xStocks routinely have fewer
 *    than 90 days of closes anywhere, and the market-cap history for them is
 *    thin: the fetch asked for 90 and gave up. The fetcher now walks
 *    90 → 30 → 14 → 7 and keeps the longest window that returned a usable
 *    series, so the analysis renders real 30-day (or 14-day) numbers labelled
 *    «۳۰ روز» instead of refusing to render anything before 90.
 *
 * ─── WHY A FULL-PAGE POPUP AND NOT THE INLINE BOX ──────────────────────────
 * The inline box kept the row on screen but squeezed the chart to 56px tall
 * and the grid to two columns; on the second request the analysis became the
 * whole viewport: «یک صفحه مدرن و بی‌نظیر». The list keeps its place behind
 * the scrim, exactly like RWA detail sheets do, so closing lands you on the
 * same row you opened from.
 *
 * The overlay is portalled to <body> for the reason in Sheet.jsx: the page
 * wrapper animates `transform`, which makes it the containing block of every
 * fixed-position descendant — an overlay rendered inside the row would box
 * itself against the scrolled page instead of the viewport.
 *
 * ─── WHY THE CHART FETCH STILL LIVES HERE AND NOT ON THE PAGE ──────────────
 * This component is mounted only while it is open, so the series is requested
 * by the tap and not by the page. Twenty-two closed panels would otherwise be
 * twenty-two CoinGecko calls every sixty seconds.
 *
 * ─── AND WHY IT CAN STILL BE EMPTY ─────────────────────────────────────────
 * Six of the twenty-two tickers have no listing anywhere we can read. For
 * those the panel shows the depth analysis — real, from the same feed as the
 * price — and says plainly that no history is available. It does not fill the
 * gap with a synthetic series: see lib/equityChart.js for why that was the one
 * option ruled out.
 */

const DAYS = 90;
const NO_CHART = { series: [], days: DAYS };

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

export default function EquityAnalysis({ asset, amountUsd = 1000, onBuy, onClose }) {
  const { t } = useTranslation();
  const still = useStill();

  /* The page scrolls behind the overlay without this, and a full-page popup
     that lets the list scroll under your finger reads as broken, not modal. */
  useEffect(() => {
    const unlock = lockBodyScroll();
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => {
      unlock();
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const hasId = Boolean(asset?.coingeckoId);
  const { data: chart, loading } = usePoll(
    () => (hasId ? fetchEquityChartWindowed(asset.coingeckoId, DAYS) : Promise.resolve(NO_CHART)),
    [asset?.coingeckoId, hasId],
    120_000
  );

  const series = useMemo(() => (chart?.series ?? []).map((d) => d.p), [chart]);
  const usable = useMemo(() => isUsableSeries(series), [series]);
  /* The window the numbers actually cover — 90 if the full series came back,
     otherwise the longest window that did. This is the ONLY value fed to the
     `{{days}}` keys, so the label can never promise a window the chart does
     not show. */
  const effectiveDays = chart?.days ?? DAYS;

  const facts = useMemo(
    () => (usable ? equitySeriesFacts(series, { days: effectiveDays }) : []),
    [series, usable, effectiveDays]
  );

  const stats = useMemo(() => equityStats(asset, amountUsd, series), [asset, amountUsd, series]);

  /* Colour on the chart follows the WINDOW, not the 24h delta: the line being
     drawn is the returned series, and a green line for a series that ended
     below where it started would be the chart arguing with itself. */
  const sparkUp = (stats.windowChange ?? 0) >= 0;
  const fellBack = usable && effectiveDays < DAYS;

  const formatFact = (id, values) => {
    const v = { ...values };
    for (const key of ['price', 'low', 'high']) {
      if (v[key] != null) v[key] = fmtPrice(v[key]);
    }
    return t(`history.equity.${id}`, v);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      className="eqsh-root"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: still ? 0 : 0.18 }}
    >
      {/* The scrim is a sibling of the panel for the reason in Sheet.jsx:
          clicks inside the panel must never be able to reach a dismiss
          handler. */}
      <button className="eqsh-scrim" aria-label={t('common.close')} onClick={onClose} tabIndex={-1} />
      <motion.div
        className="eqsh-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('eqsheet.title', { name: asset?.name ?? asset?.symbol ?? '' })}
        initial={still ? undefined : { opacity: 0, y: 26, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={still ? undefined : { opacity: 0, y: 14, scale: 0.99 }}
        transition={still ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
      >
        {/* ── the bar: back, identity, close ─────────────────────────────── */}
        <header className="eqsh-head">
          <div className="eqsh-id">
            <TokenIcon token={asset} size={40} />
            <div className="eqsh-id-text">
              <span className="eqsh-kicker">{t('eqsheet.kicker')}</span>
              <h2 className="eqsh-name">{asset?.name ?? asset?.symbol}</h2>
              <span className="eqsh-sym mono">{asset?.symbol}</span>
            </div>
          </div>
          <button className="eqsh-close" onClick={onClose} aria-label={t('common.close')} type="button">
            <IconX width={16} height={16} />
          </button>
        </header>

        <div className="eqsh-scroll">
          {/* ── hero: the price, its 24h move, and the window on screen ── */}
          <div className="eqsh-hero">
            <div className="eqsh-price-row">
              <b className="eqsh-price mono">
                {stats.price != null ? `$${fmtPrice(stats.price)}` : '—'}
              </b>
              {stats.change24h != null && (
                <span className={`eqsh-chip mono ${stats.change24h >= 0 ? 'up' : 'down'}`}>
                  {fmtPct(stats.change24h, 1)} · {t('eqsheet.day')}
                </span>
              )}
            </div>
            <span className="eqsh-window faint">
              {t('stocks.eq.window90', { days: effectiveDays })}
            </span>
          </div>

          {/* ── the series, full width ──────────────────────────────────── */}
          {hasId && (
            <section className="eqan-chart eqsh-card">
              <div className="eqan-chart-head">
                <span className="faint">{t('eqsheet.chartTitle', { days: effectiveDays })}</span>
                {usable && stats.windowChange != null && (
                  <span className={`mono ${sparkUp ? 'up' : 'down'}`}>
                    {fmtPct(stats.windowChange, 1)}
                  </span>
                )}
              </div>
              {loading && series.length === 0 ? (
                <div className="skel" style={{ aspectRatio: '360 / 140', borderRadius: 16 }} />
              ) : usable ? (
                <>
                  {/* 360×140 with the CSS width:100% scaling: the viewBox keeps
                      the ratio, so the phone renders ~124px tall and the desktop
                      card ~250px without a stretch that would fatten the stroke. */}
                  <Sparkline data={series} up={sparkUp} width={360} height={140} strokeWidth={1.8} />
                  {fellBack && (
                    <p className="eqan-nohist eqsh-fallback">
                      {t('eqsheet.windowFallback', { days: effectiveDays })}
                    </p>
                  )}
                </>
              ) : (
                <p className="eqan-nohist">{t('stocks.eq.noHistory')}</p>
              )}
            </section>
          )}

          {/* ── the numbers, as a grid ──────────────────────────────────── */}
          <section className="eqsh-card">
            <div className="eqan-grid">
              <Stat label={t('stocks.eq.price')} value={stats.price != null ? `$${fmtPrice(stats.price)}` : '—'} />
              <Stat
                label={t('stocks.eq.change24h')}
                value={stats.change24h != null ? fmtPct(stats.change24h, 1) : '—'}
                tone={stats.change24h != null ? (stats.change24h >= 0 ? 'up' : 'down') : undefined}
              />
              <Stat
                label={t('stocks.eq.windowChange', { days: effectiveDays })}
                value={stats.windowChange != null ? fmtPct(stats.windowChange, 1) : '—'}
                tone={stats.windowChange != null ? (stats.windowChange >= 0 ? 'up' : 'down') : undefined}
              />
              <Stat
                label={t('stocks.eq.range', { days: effectiveDays })}
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
          </section>

          {/* ── what the past says ──────────────────────────────────────── */}
          {facts.length > 0 && (
            <section className="eqan-facts eqsh-card">
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
            </section>
          )}

          {/*
            Two different reasons a panel can be empty, and they must not be
            blurred into one: a token no feed lists at all has no series to
            fetch, while one that IS listed can still come back short or fail.
            Saying "no history" for the first and "could not load" for the
            second is the difference between an honest screen and a vague one.
          */}
          {!hasId && <p className="eqan-nohist eqsh-card">{t('stocks.eq.noHistoryBody')}</p>}
          {hasId && !usable && !loading && (
            <p className="eqan-nohist eqsh-card">{t('stocks.eq.noHistoryShort')}</p>
          )}

          {/* ── depth: can you actually get out ─────────────────────────── */}
          <section className="eqan-depth eqsh-card">
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
          </section>
        </div>

        {/* ── the one action ────────────────────────────────────────────── */}
        <footer className="eqsh-foot">
          <button
            type="button"
            className="btn btn-primary eqan-buy"
            disabled={!stats.depth.ok}
            onClick={() => { onClose?.(); onBuy?.(asset); }}
          >
            <IconSwap width={16} height={16} />
            <span>{t('stocks.buyWith', { sym: asset?.symbol ?? '' })}</span>
          </button>
        </footer>
      </motion.div>
    </motion.div>,
    document.body
  );
}
