import { useMemo } from 'react';
import { Bar, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';
import { fmtPrice } from '../lib/format';

/**
 * CANDLESTICK + VOLUME, built on the recharts already in the bundle.
 *
 * ─── WHY NOT TradingView's LIBRARY ──────────────────────────────────────────
 * Lightweight Charts is Apache-2.0 and genuinely free for commercial use, so
 * licensing was not the obstacle. Size was: it is another ~45 KB dependency
 * and a second charting engine to keep alive, on an app whose users are on
 * Iranian mobile connections. recharts is already here for the line chart and
 * can draw this correctly, so the candle costs a component instead of a
 * dependency. If we ever need real-time streaming or drawing tools, that
 * trade flips — and this comment is here so the next person knows why it was
 * made and when to revisit it.
 *
 * ─── HOW A CANDLE IS DRAWN FROM A BAR CHART ─────────────────────────────────
 * recharts has no candlestick type. Each candle is TWO stacked bars sharing
 * one x slot:
 *
 *   • the WICK — a hairline bar spanning low→high
 *   • the BODY — a thicker bar spanning open→close
 *
 * Both are drawn as ranges (`[from, to]`), which recharts supports natively,
 * so no custom SVG shape and no manual scaling is needed. The y-axis is
 * shared, so the two always line up.
 *
 * ─── WHY THE DOMAIN IS PADDED AND NOT AUTO ──────────────────────────────────
 * With `domain={['auto','auto']}` the highest wick touches the top pixel and
 * the lowest touches the bottom, which reads as clipped rather than as the
 * extreme of the range. A 4% pad on each side is enough to show that the
 * high really is the high.
 */

function CandleTip({ active, payload, t }) {
  if (!active || !payload?.length) return null;
  const d = payload.find((entry) => entry?.payload?.projected)?.payload ?? payload[0]?.payload;
  if (!d) return null;
  const up = d.c >= d.o;
  return (
    <div className="chart-tip">
      <div className="faint" style={{ fontSize: 10.5, marginBottom: 4 }}>{d.projected ? t('coin.pro.forecast') : null} {d.label}</div>
      <div className="mono" style={{ fontSize: 11.5, display: 'grid', gap: 2 }}>
        <span>{t('coin.open')} ${fmtPrice(d.o)}</span>
        <span>{t('coin.high24h')} ${fmtPrice(d.h)}</span>
        <span>{t('coin.low24h')} ${fmtPrice(d.l)}</span>
        <span style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
          {t('coin.close')} ${fmtPrice(d.c)}
        </span>
      </div>
    </div>
  );
}

export default function CandleChart({ data, height = 190, forecast = null }) {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    const src = Array.isArray(data) ? data : [];
    const valid = (d) => d && [d.t, d.o, d.h, d.l, d.c].every(Number.isFinite)
      && Math.min(d.o, d.h, d.l, d.c) > 0 && d.h >= Math.max(d.o, d.c) && d.l <= Math.min(d.o, d.c);
    const real = src.filter(valid).sort((a, b) => a.t - b.t);
    const last = real[real.length - 1]?.t ?? -Infinity;
    const future = (Array.isArray(forecast?.candles) ? forecast.candles : [])
      .filter((d) => valid(d) && d.t > last).sort((a, b) => a.t - b.t);
    return [...real, ...future.map((d) => ({ ...d, projected: true }))].map((d) => ({
      ...d,
      wick: [d.l, d.h],
      body: d.c === d.o ? [d.o, d.o * 1.0005] : [Math.min(d.o, d.c), Math.max(d.o, d.c)],
      up: d.c >= d.o,
      label: new Date(d.t).toLocaleDateString()
    }));
  }, [data, forecast]);

  const domain = useMemo(() => {
    if (!rows.length) return ['auto', 'auto'];
    const lo = Math.min(...rows.map((r) => r.l));
    const hi = Math.max(...rows.map((r) => r.h));
    const pad = (hi - lo) * 0.04 || hi * 0.01;
    return [lo - pad, hi + pad];
  }, [rows]);

  if (!rows.length) return null;

  return (
    <div className="chart-wrap" style={{ height }} data-forecast-bars={rows.filter((row) => row.projected).length}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="t" hide />
          <YAxis domain={domain} hide />
          <Tooltip content={<CandleTip t={t} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          {/*
            The wick is drawn FIRST so the body paints over its middle. Drawn
            after, the hairline would sit on top of every body and every
            candle would look like it had a line through it.
          */}
          <Bar dataKey="wick" barSize={1.5} isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell key={`w${i}`} fill={r.projected ? '#8d7bff' : r.up ? 'var(--up)' : 'var(--down)'} />
            ))}
          </Bar>
          <Bar dataKey="body" barSize={6} radius={1} isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell key={`b${i}`} fill={r.projected ? '#8d7bff' : r.up ? 'var(--up)' : 'var(--down)'} fillOpacity={r.projected ? 0.5 : 1} stroke={r.projected ? '#8d7bff' : undefined} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
