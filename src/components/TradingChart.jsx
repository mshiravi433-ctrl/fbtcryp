import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CandleChart from './CandleChart';
import { fmtPrice } from '../lib/format';
import { toHeikinAshi, volumeWeightedAveragePrice } from '../lib/proChartMath';
import '../styles/trading-chart.css';

/**
 * TRADINGCHART — a real TradingView-powered candlestick chart.
 *
 * ─── WHY lightweight-charts, AFTER ALL ──────────────────────────────────────
 * CandleChart.jsx deliberately drew candles with recharts to avoid a second
 * charting engine. That trade was right for a static picture — and wrong for
 * what was asked here: «چارت شمعی مثل پنکیک‌سواپ». PancakeSwap's chart is
 * TradingView's lightweight-charts, and what makes it feel professional is
 * not the candle shapes (recharts drew those fine) but the BEHAVIOUR around
 * them: pinch-to-zoom, drag-to-pan, a live price scale, a time scale, and a
 * crosshair that reads OHLC values. Re-implementing that on SVG would be
 * hundreds of lines of gesture code; the library is one dependency, already
 * split into this route's lazy chunk so nobody else downloads it.
 *
 * ─── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
 * No volume bars: CoinGecko's OHLC endpoint returns open/high/low/close only,
 * and a volume bar would have to invent its height — the exact fabrication
 * the old comment refused. No TradingView account, no hosted widget, no
 * external iframe: the library renders locally from OUR data, so it works for
 * every coin and leaks no browsing to a third party.
 *
 * Data: [{ t, o, h, l, c }] (ms timestamps, like getOhlc returns).
 * The parent remounts per range (key={`${id}-${days}`), so this mounts once
 * per dataset and never has to diff a series.
 */

function precisionFor(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 2;
  if (p < 0.01) return 6;
  if (p < 1) return 4;
  if (p < 100) return 3;
  return 2;
}

function ma(values, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i].close;
    if (i >= period) sum -= values[i - period].close;
    if (i >= period - 1) out.push({ time: values[i].time, value: sum / period });
  }
  return out;
}

/**
 * `barsWithVolume` says how many of the incoming bars carried a volume. It is
 * NOT inferred here: the parent already had to decide that per row, and two
 * places deciding whether a zero means "no volume" or "no volume READ" is how a
 * VWAP gets drawn from nothing.
 */
export default function TradingChart({ data, symbol = '', height = 280, barsWithVolume = 0 }) {
  const { t, i18n } = useTranslation();
  const hostRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [showMa7, setShowMa7] = useState(true);
  const [showMa25, setShowMa25] = useState(true);
  /* Two view options, both OFF by default: a chart that changes the candles
     the user asked for without being told is a chart that lies about the
     market's shape. Both are also disabled (not merely hidden) when the data
     they need is missing. */
  const [heikin, setHeikin] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [legend, setLegend] = useState(null);
  const apiRef = useRef(null);

  /* Dedupe + sort: the library throws on duplicate or unordered timestamps,
     and an upstream hiccup must not take the chart down. */
  const candles = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(data) ? data : [])
      .filter((d) => [d?.t, d?.o, d?.h, d?.l, d?.c].every(Number.isFinite) && d.h >= d.l)
      .map((d) => ({
        time: Math.floor(d.t / 1000),
        open: d.o,
        high: d.h,
        low: d.l,
        close: d.c
      }))
      .filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)))
      .sort((a, b) => a.time - b.time);
  }, [data]);

  /* The series actually drawn. Heikin Ashi is a SOURCE change (§2 of the
     plan), so it rebuilds the candle array rather than tinting the bars; the
     MA overlays are then computed from the source that is on screen, which is
     the only way the two things mean the same thing. */
  const drawn = useMemo(() => (heikin ? toHeikinAshi(candles) : candles), [candles, heikin]);

  /* VWAP needs a bar volume per bar. `alignVolumeToCandles` skips a bar whose
     nearest reading is outside one candle's spacing, so a partially covered
     series yields FEWER points rather than a line invented across the gap. */
  const vwap = useMemo(() => {
    const vols = (Array.isArray(data) ? data : [])
      .map((d, i) => ({ t: Number(d?.t), v: Number(d?.v), i }))
      .filter((d) => Number.isFinite(d.t) && Number.isFinite(d.v) && d.v > 0);
    if (!vols.length || candles.length < 2) return [];
    /* `volumeWeightedAveragePrice` is positional, so the volume array must be
       the same length as the candles and in the same order. Candles that were
       deduped or filtered out above would shift every later bar, so the
       alignment is rebuilt from the candle's own timestamp. */
    const byTime = new Map(vols.map((v) => [Math.floor(v.t / 1000), v.v]));
    const aligned = candles.map((c) => byTime.get(c.time));
    if (aligned.some((v) => !Number.isFinite(v))) return [];
    return volumeWeightedAveragePrice(candles, aligned);
  }, [candles, data]);

  const last = drawn[drawn.length - 1] ?? null;
  const precision = precisionFor(last?.close);

  useEffect(() => {
    let chart = null;
    let ro = null;
    let dead = false;
    setReady(false);
    setLegend(null);

    (async () => {
      try {
        /* lightweight-charts reads window.matchMedia / ResizeObserver at
           construction (device-pixel-ratio tracking). A stripped WebView or a
           headless DOM without them must fall through to the recharts candle
           instead of throwing from inside a canvas binding. */
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || typeof ResizeObserver === 'undefined') {
          throw new Error('CHART_ENV_UNSUPPORTED');
        }
        const lib = await import('lightweight-charts');
        if (dead || !hostRef.current || drawn.length < 2) return;
        const { createChart, CandlestickSeries, LineSeries, CrosshairMode } = lib;
        const ColorType = lib.ColorType ?? { Solid: 'solid' };

        const light = document.documentElement.getAttribute('data-theme') === 'light';
        const up = '#26a69a';
        const down = '#ef5350';

        chart = createChart(hostRef.current, {
          width: hostRef.current.clientWidth,
          height,
          layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: light ? '#5b6478' : '#8b8fa3',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 10
          },
          grid: {
            vertLines: { color: light ? 'rgba(20,30,60,0.06)' : 'rgba(255,255,255,0.05)' },
            horzLines: { color: light ? 'rgba(20,30,60,0.06)' : 'rgba(255,255,255,0.05)' }
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: light ? 'rgba(20,30,60,0.35)' : 'rgba(255,255,255,0.35)', labelBackgroundColor: '#5b6478' },
            horzLine: { color: light ? 'rgba(20,30,60,0.35)' : 'rgba(255,255,255,0.35)', labelBackgroundColor: '#5b6478' }
          },
          rightPriceScale: { borderVisible: false },
          timeScale: {
            borderVisible: false,
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 3
          },
          localization: { locale: i18n.language === 'fa' ? 'fa-IR' : 'en-US' }
        });

        const candle = chart.addSeries(CandlestickSeries, {
          upColor: up,
          downColor: down,
          wickUpColor: up,
          wickDownColor: down,
          borderVisible: false,
          priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision }
        });
        candle.setData(drawn);
        candle.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.18 } });

        const ma7 = chart.addSeries(LineSeries, {
          color: '#00e5ff',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        ma7.setData(ma(drawn, 7));
        ma7.applyOptions({ visible: true });

        const ma25 = chart.addSeries(LineSeries, {
          color: '#ff9800',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        ma25.setData(ma(drawn, 25));

        /* VWAP is drawn only when there is a real series for it: an empty
           series would put a legend entry on the chart for a line that does
           not exist, which reads as "the venue sends no volume" when the truth
           is "this venue's candles carry none". */
        const vwapSeries = vwap.length > 1
          ? chart.addSeries(LineSeries, {
            color: '#b388ff',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: true
          })
          : null;
        if (vwapSeries) vwapSeries.setData(vwap);

        apiRef.current = { chart, candle, ma7, ma25, vwap: vwapSeries };
        setLegend({ ...last });
        setReady(true);

        chart.subscribeCrosshairMove((param) => {
          if (dead) return;
          const v = param?.seriesData?.get(candle);
          /* A hover over empty space restores the latest candle — the legend
             always shows SOMETHING real, never a stale hover from elsewhere. */
          setLegend(v ? { open: v.open, high: v.high, low: v.low, close: v.close } : last ? { ...last } : null);
        });

        chart.timeScale().fitContent();
        ro = new ResizeObserver(() => {
          if (!dead && hostRef.current && chart) {
            chart.applyOptions({ width: hostRef.current.clientWidth });
          }
        });
        ro.observe(hostRef.current);
      } catch {
        if (!dead) setFailed(true);
      }
    })();

    return () => {
      dead = true;
      try { ro?.disconnect(); } catch { /* noop */ }
      try { chart?.remove(); } catch { /* noop */ }
      apiRef.current = null;
    };
    /* Mount-once per dataset by design (the parent remounts per range and per
       symbol), EXCEPT when the SOURCE changes: Heikin Ashi is a different set
       of candles, not a tint, so the chart is rebuilt from `drawn`. `drawn`
       and `vwap` are fresh arrays every render, so they cannot be dependencies
       without looping — `heikin` is the only input that flips them without a
       remount, so it is the one listed. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heikin]);

  /* MA toggles ride on the live series — no rebuild, no refetch. */
  useEffect(() => {
    try { apiRef.current?.ma7?.applyOptions({ visible: showMa7 }); } catch { /* noop */ }
  }, [showMa7]);
  useEffect(() => {
    try { apiRef.current?.ma25?.applyOptions({ visible: showMa25 }); } catch { /* noop */ }
  }, [showMa25]);
  useEffect(() => {
    try { apiRef.current?.vwap?.applyOptions({ visible: showVwap }); } catch { /* noop */ }
  }, [showVwap]);

  /* The recharts candle is the safety net: if the library ever fails to load
     (blocked CDN is impossible — it is bundled — but a broken WebGL-less
     webview is not), the user still gets candles instead of an error. */
  if (failed) return <CandleChart data={data} height={height} />;
  if (candles.length < 2) return null;

  const chg = legend && legend.open ? ((legend.close - legend.open) / legend.open) * 100 : 0;
  const legUp = chg >= 0;

  return (
    <div className="tv-wrap" dir="ltr">
      <div className="tv-legend" aria-live="polite">
        <span className="tv-sym">{symbol}</span>
        {heikin ? (
          /* The numbers in this legend are then the TRANSFORMED values. Saying
             so on screen is the difference between a style and a claim. */
          <span className="faint" title={t('perpTerminal.chart.heikinHint', { defaultValue: 'Open/high/low/close below are Heikin Ashi values: the average of the bar, not its traded price.' })}>HA</span>
        ) : null}
        {legend ? (
          <span className="tv-ohlc mono">
            <span><em>{t('coin.open')}</em> {fmtPrice(legend.open)}</span>
            <span><em>{t('coin.high24h')}</em> {fmtPrice(legend.high)}</span>
            <span><em>{t('coin.low24h')}</em> {fmtPrice(legend.low)}</span>
            <span><em>{t('coin.close')}</em> {fmtPrice(legend.close)}</span>
            <span className={legUp ? 'up' : 'down'}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
          </span>
        ) : null}
      </div>
      <div className="tv-host" style={{ height }}>
        {symbol ? (
          <div className="tv-watermark" aria-hidden="true">{symbol}</div>
        ) : null}
        <div ref={hostRef} className="tv-chart" />
        {!ready ? <div className="skel tv-loading" style={{ height }} /> : null}
      </div>
      <div className="tv-tools">
        <button
          type="button"
          className={`tag ${showMa7 ? 'active' : ''}`}
          onClick={() => setShowMa7((v) => !v)}
          aria-pressed={showMa7}
        >
          <span className="tv-dot" style={{ background: '#00e5ff' }} /> MA 7
        </button>
        <button
          type="button"
          className={`tag ${showMa25 ? 'active' : ''}`}
          onClick={() => setShowMa25((v) => !v)}
          aria-pressed={showMa25}
        >
          <span className="tv-dot" style={{ background: '#ff9800' }} /> MA 25
        </button>
        <button
          type="button"
          className={`tag ${heikin ? 'active' : ''}`}
          onClick={() => setHeikin((v) => !v)}
          aria-pressed={heikin}
        >
          <span className="tv-dot" style={{ background: '#26a69a' }} />
          {t('perpTerminal.chart.heikin', { defaultValue: 'Heikin Ashi' })}
        </button>
        <button
          type="button"
          className={`tag ${showVwap ? 'active' : ''}`}
          onClick={() => setShowVwap((v) => !v)}
          aria-pressed={showVwap}
          disabled={vwap.length < 2}
          title={vwap.length < 2
            ? t('perpTerminal.chart.noVolume', { defaultValue: 'This feed sends no bar volume, so there is no VWAP to draw.' })
            : undefined}
        >
          <span className="tv-dot" style={{ background: '#b388ff' }} />
          VWAP
        </button>
        <span className="faint tv-hint">{t('coin.tvHint')}</span>
      </div>
    </div>
  );
}
