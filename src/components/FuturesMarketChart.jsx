import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { getFuturesCandles } from '../lib/futuresClient';
import { getDydxCandles } from '../lib/dydx';
import { getOhlc } from '../lib/api';
import { fmtPrice } from '../lib/format';

/**
 * FUTURESMARKETCHART — the TradingView candlestick for a leveraged market.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The on-chain futures tab and the "global horizon" (Ostium) tab both sized a
 * leveraged order from a single mid price and nothing else: no history, no
 * shape, no sense of whether the market had just run 8% or been flat for a
 * week. The dYdX tab already had a chart; these two did not.
 *
 * The candles come from `/api/v1/futures/candles`, which every on-chain venue
 * adapter already serves (Velocity's public Data API for crypto, the keyless
 * Ostium builder API for forex/commodities/indices/stocks). Nothing here is
 * invented: an unreachable venue leaves the chart saying "unavailable", never
 * drawing a flat line — a flat line is a claim about the market.
 *
 * Rendering is TradingChart (lightweight-charts: pinch-zoom, pan, crosshair
 * OHLC), lazy-loaded so the charting engine only downloads when a market is
 * on screen. TradingChart is keyed per (market, resolution) and mounts once
 * per dataset, so the series is never diffed.
 */
const TradingChart = lazy(() => import('./TradingChart'));

const RESOLUTIONS = [
  ['15', '15m'],
  ['60', '1h'],
  ['240', '4h'],
  ['1D', '1d']
];

const LIMIT_FOR = { '15': 96, '60': 96, '240': 90, '1D': 60 };

/* dYdX's indexer speaks its own resolution vocabulary. */
const DYDX_RES = { '15': '15MINS', '60': '1HOUR', '240': '4HOURS', '1D': '1DAY' };
/* CoinGecko's OHLC granularity is chosen by `days` (1–2 → 30m, 3–30 → 4h,
   31+ → 4d), so each button asks for the window whose candle size is closest. */
const SPOT_DAYS = { '15': 1, '60': 2, '240': 14, '1D': 90 };

/**
 * One read, whichever venue the pair settles on. Returns candles in the
 * engine's `{ startedAt, open, high, low, close }` shape, oldest first.
 *
 *   velocity / ostium → the BFF (`/api/v1/futures/candles`)
 *   dydx              → the dYdX indexer proxy
 *   spot              → the market feed's own OHLC (the LAST resort, below)
 */
async function readCandles({ provider, market, resolution }) {
  if (provider === 'dydx') {
    const r = await getDydxCandles(market, DYDX_RES[resolution] || '1HOUR', LIMIT_FOR[resolution] || 96);
    return { rows: r?.candles || [], symbol: r?.ticker || null };
  }
  if (provider === 'spot') {
    const raw = await getOhlc(market, SPOT_DAYS[resolution] || 2);
    return {
      rows: (Array.isArray(raw) ? raw : []).map((d) => ({ startedAt: d.t, open: d.o, high: d.h, low: d.l, close: d.c })),
      symbol: null
    };
  }
  const r = await getFuturesCandles({ provider, market, resolution, limit: LIMIT_FOR[resolution] || 96 });
  return { rows: r?.ok ? (r.data?.candles || []) : [], symbol: r?.ok ? (r.data?.symbol || null) : null };
}

export default function FuturesMarketChart({ provider, market, symbol, height = 250, testId = 'futures-market-chart', spotId = null }) {
  const { t } = useTranslation();
  const [resolution, setResolution] = useState('60');
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState(null);

  /* `spot` is set when the venue's own candles never arrived and the market
     feed's OHLC is drawn instead — and the chart SAYS so (see the footer):
     an index chart under a venue label would be a claim about the wrong book. */
  const [spot, setSpot] = useState(false);

  useEffect(() => {
    setSpot(false);
    if (!provider || !market) { setCandles([]); return undefined; }
    let alive = true;
    let retryTimer = null;
    let attempt = 0;
    /* Two bounded retries, like the dYdX chart: a cold serverless instance or
       a transient upstream blip should heal itself before the chart falls
       back. The fallback (when the caller supplies a spot id) means the chart
       is never blank for a pair that has a price — «اصلا نمودار شمعی ندارند». */
    const run = async () => {
      setLoading(true);
      try {
        const r = await readCandles({ provider, market, resolution });
        if (!alive) return;
        if (r.rows.length > 1) {
          setCandles(r.rows);
          setSource(r.symbol);
          setLoading(false);
          return;
        }
      } catch { /* handled below like an empty read */ }
      if (!alive) return;
      if (attempt < 2) { attempt += 1; retryTimer = setTimeout(run, 3_500); return; }
      if (spotId && provider !== 'spot') {
        try {
          const r = await readCandles({ provider: 'spot', market: spotId, resolution });
          if (!alive) return;
          if (r.rows.length > 1) { setCandles(r.rows); setSource(null); setSpot(true); setLoading(false); return; }
        } catch { /* the honest empty state below */ }
        if (!alive) return;
      }
      setCandles([]);
      setLoading(false);
    };
    run();
    return () => { alive = false; if (retryTimer) clearTimeout(retryTimer); };
  }, [provider, market, resolution, spotId]);

  /* TradingChart takes { t, o, h, l, c } in milliseconds (getOhlc's shape). */
  const data = useMemo(
    () => candles.map((c) => ({ t: Number(c.startedAt), o: Number(c.open), h: Number(c.high), l: Number(c.low), c: Number(c.close) })),
    [candles]
  );
  const change = useMemo(() => {
    if (candles.length < 2) return 0;
    const first = Number(candles[0].close);
    const last = Number(candles[candles.length - 1].close);
    return first > 0 ? ((last - first) / first) * 100 : 0;
  }, [candles]);

  if (!market) return null;

  const has = data.length > 1;
  const label = String(symbol || source || '').replace('/', '-');

  return (
    <div className="dydx-chart futures-chart" data-testid={testId}>
      <div className="dydx-chart-head">
        <span className="faint">
          {loading || has
            ? t('futures.chartTitle', { defaultValue: 'Price chart' })
            : t('futures.chartUnavailableShort', { defaultValue: 'Chart unavailable' })}
        </span>
        <div className="dydx-chart-res">
          {RESOLUTIONS.map(([res, fallback]) => (
            <button
              key={res}
              type="button"
              className={resolution === res ? 'active' : ''}
              onClick={() => setResolution(res)}
            >
              {t(`futures.res.${res}`, { defaultValue: fallback })}
            </button>
          ))}
        </div>
      </div>

      {has ? (
        <Suspense fallback={<div className="skel" style={{ height }} />}>
          <TradingChart key={`${provider}:${market}:${resolution}:${candles.length}:${spot ? 's' : 'v'}`} data={data} symbol={label} height={height} />
        </Suspense>
      ) : loading ? (
        <div className="skel" style={{ height }} />
      ) : (
        <div className="empty" style={{ minHeight: height, display: 'grid', placeItems: 'center' }}>
          <p className="faint" style={{ margin: 0, textAlign: 'center', lineHeight: 1.7 }}>
            {t('futures.chartUnavailable', { defaultValue: 'The venue did not return candles for this market.' })}
          </p>
        </div>
      )}

      {has && (
        <div className="dydx-chart-foot">
          <span className={`mono ${change >= 0 ? 'up' : 'down'}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
          </span>
          {spot && <span className="faint" data-testid="futures-chart-spot">{t('futures.chartSpot', { defaultValue: 'Index price chart' })}</span>}
          <span className="faint mono">${fmtPrice(candles[candles.length - 1].close)}</span>
        </div>
      )}
    </div>
  );
}
