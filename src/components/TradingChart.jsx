import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CandleChart from './CandleChart';
import { fmtPrice } from '../lib/format';
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

export default function TradingChart({ data, symbol = '', height = 280 }) {
  const { t, i18n } = useTranslation();
  const hostRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [showMa7, setShowMa7] = useState(true);
  const [showMa25, setShowMa25] = useState(true);
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

  const last = candles[candles.length - 1] ?? null;
  const precision = precisionFor(last?.close);

  useEffect(() => {
    let chart = null;
    let ro = null;
    let dead = false;
    setReady(false);
    setLegend(null);

    (async () => {
      try {
        const lib = await import('lightweight-charts');
        if (dead || !hostRef.current || candles.length < 2) return;
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
        candle.setData(candles);
        candle.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.18 } });

        const ma7 = chart.addSeries(LineSeries, {
          color: '#00e5ff',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        ma7.setData(ma(candles, 7));
        ma7.applyOptions({ visible: true });

        const ma25 = chart.addSeries(LineSeries, {
          color: '#ff9800',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        ma25.setData(ma(candles, 25));

        apiRef.current = { chart, candle, ma7, ma25 };
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
    // Mount-once per dataset by design (parent remounts per range).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* MA toggles ride on the live series — no rebuild, no refetch. */
  useEffect(() => {
    try { apiRef.current?.ma7?.applyOptions({ visible: showMa7 }); } catch { /* noop */ }
  }, [showMa7]);
  useEffect(() => {
    try { apiRef.current?.ma25?.applyOptions({ visible: showMa25 }); } catch { /* noop */ }
  }, [showMa25]);

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
        <span className="faint tv-hint">{t('coin.tvHint')}</span>
      </div>
    </div>
  );
}
