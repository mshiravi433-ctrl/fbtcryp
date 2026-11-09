import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { getFuturesCandles } from '../lib/futuresClient';
import { getDydxCandles } from '../lib/dydx';
import { getOhlc } from '../lib/api';
import { fmtPrice } from '../lib/format';
import '../styles/futures-ai.css';

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

/* ─── THE AI FORECAST PIPELINE (on-device Kronos, same engine as the coin
   page) ───────────────────────────────────────────────────────────────────
   Loaded dynamically: the futures chunk must not pay for the model plumbing
   until a reader actually asks for a prediction. */
const loadKronos = () => import('../lib/kronosLocal/client.js');
const loadKronosInfer = () => import('../lib/kronosLocal/infer.js');
const HORIZONS = ['auto', '12', '24', '48'];
const AI_ERROR_KEY = {
  DEVICE_UNSUPPORTED: 'deviceUnsupported',
  SESSION_FAILED: 'backendFailed',
  CACHE_UNAVAILABLE: 'noStorage',
  MODEL_NOT_HOSTED: 'hostMissing',
  MANIFEST_UNREACHABLE: 'downloadFailed',
  MANIFEST_INVALID: 'downloadFailed',
  MODEL_FILE_UNREACHABLE: 'downloadFailed',
  MODEL_FILE_CORRUPT: 'corrupt',
  MODEL_FILE_TRUNCATED: 'corrupt',
  MODEL_NOT_DOWNLOADED: 'downloadFailed',
  OUT_OF_MEMORY: 'oom',
  WORKER_CRASHED: 'oom',
  WORKER_TIMEOUT: 'unavailable',
  MODEL_NOT_READY: 'unavailable',
  BUSY: 'busy',
  CANCELLED: 'cancelled',
  WORKER_CANCELLED: 'cancelled',
  INSUFFICIENT_CANDLES: 'shortHistory',
  CONTEXT_TOO_LARGE: 'shortHistory',
  INVALID_PROJECTION: 'invalidOutput',
  INVALID_TIME_AXIS: 'invalidOutput',
  FORECAST_FAILED: 'unavailable'
};

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
    /* `v` is the market feed's own bar volume. It is carried through rather
       than dropped: the chart's VWAP and its volume histogram both refuse to
       draw without it, and a chart that silently omits them looks like a
       venue that sends no volume instead of a mapper that threw it away. */
    return {
      rows: (Array.isArray(raw) ? raw : []).map((d) => ({ startedAt: d.t, open: d.o, high: d.h, low: d.l, close: d.c, volume: d.v })),
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

  /* ─── THE AI PROJECTION STATE ───────────────────────────────────────────
     `forecastKey` binds the answer to coin+resolution+last bar+horizon, so a
     late answer for another pair can never paint this chart. */
  const [aiOn, setAiOn] = useState(false);
  const [aiHorizon, setAiHorizon] = useState('auto');
  const [aiPhase, setAiPhase] = useState('idle'); // idle check… ready | error | …
  const [aiError, setAiError] = useState('');
  const [aiProgress, setAiProgress] = useState(null);
  const [aiEstimate, setAiEstimate] = useState(null);
  const [aiBars, setAiBars] = useState(null);
  const [aiNonce, setAiNonce] = useState(0);
  const aiAbortRef = useRef(null);

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

  /* TradingChart takes { t, o, h, l, c } in milliseconds (getOhlc's shape).
     `v` rides along only when the venue actually sent a bar volume — an
     undefined is passed as absent, never as zero, because zero volume is a
     fact about the market and undefined is a fact about the reader. */
  const data = useMemo(
    () => candles.map((c) => {
      const v = Number(c.volume);
      return {
        t: Number(c.startedAt),
        o: Number(c.open),
        h: Number(c.high),
        l: Number(c.low),
        c: Number(c.close),
        ...(Number.isFinite(v) && v > 0 ? { v } : {})
      };
    }),
    [candles]
  );
  /* How many of the bars carry volume. The chart uses it to label the volume
     features as "not in this feed" instead of leaving an empty panel. */
  const barsWithVolume = data.filter((d) => Number.isFinite(d.v)).length;

  const candlesRef = useRef(data);
  candlesRef.current = data;
  const lastAnchor = data.length ? data[data.length - 1].t : 0;
  const predLen = aiHorizon === 'auto'
    ? Math.max(12, Math.min(48, Math.round(data.length / 8)))
    : Number(aiHorizon);
  const forecastKey = `${provider}:${market}:${resolution}:${lastAnchor}:${predLen}`;

  const stopAiWork = useRef(null);
  stopAiWork.current = () => {
    try { aiAbortRef.current?.abort(); } catch { /* noop */ }
    aiAbortRef.current = null;
  };

  const failAi = (error) => {
    if (error?.name === 'AbortError' || error?.code === 'WORKER_CANCELLED' || error?.code === 'CANCELLED') {
      setAiPhase('cancelled');
      return;
    }
    const code = error?.code || String(error?.message || 'FORECAST_FAILED');
    setAiError(code);
    setAiPhase(code === 'INSUFFICIENT_CANDLES' ? 'needs-history' : 'error');
  };

  const computeAi = async (controller, { prepared = false } = {}) => {
    const { MIN_CANDLES } = await loadKronosInfer();
    const bars = candlesRef.current;
    if (bars.length < MIN_CANDLES) {
      setAiError('INSUFFICIENT_CANDLES');
      setAiPhase('needs-history');
      return;
    }
    const client = await loadKronos();
    setAiPhase('preparing');
    try {
      if (!prepared) {
        await client.prepareModel({
          signal: controller.signal,
          onPhase: (phase) => { if (!controller.signal.aborted) setAiPhase(phase === 'download' ? 'downloading' : 'preparing'); },
          onProgress: (progress) => { if (!controller.signal.aborted) setAiProgress(progress); }
        });
      }
      if (controller.signal.aborted) return;
      setAiProgress(null);
      setAiPhase('running');
      const payload = bars.slice(-520).map((c) => ({
        t: Number(c.t), o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c), v: Number.isFinite(Number(c.v)) ? Number(c.v) : 0
      }));
      const result = await client.runForecast(payload, { horizon: predLen, signal: controller.signal });
      if (controller.signal.aborted) return;
      /* The client already guarantees the flat shape; this second gate is the
         one that keeps a poisoned worker answer from reaching the chart. */
      const projected = Array.isArray(result?.candles) ? result : result?.result;
      if (!Array.isArray(projected?.candles) || !projected.candles.length) {
        failAi({ code: 'INVALID_PROJECTION' });
        return;
      }
      setAiBars(projected.candles.map((c) => ({ t: Number(c.t), o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c) })));
      setAiError('');
      setAiPhase('ready');
    } catch (error) {
      if (!controller.signal.aborted) failAi(error);
    }
  };

  useEffect(() => {
    if (!aiOn) {
      stopAiWork.current?.();
      setAiBars(null);
      setAiPhase('idle');
      setAiError('');
      setAiProgress(null);
      return undefined;
    }
    let alive = true;
    const controller = new AbortController();
    aiAbortRef.current = controller;
    (async () => {
      try {
        const client = await loadKronos();
        const support = client.deviceSupport();
        if (!alive) return;
        if (!support.ok) { setAiPhase('unsupported'); return; }
        setAiPhase('checking');
        const state = await client.modelState();
        if (!alive) return;
        if (state.state !== 'ready') {
          const estimate = await client.downloadEstimate();
          if (!alive) return;
          setAiEstimate(estimate);
          setAiPhase('needs-download');
          return;
        }
        await computeAi(controller);
      } catch (error) {
        if (alive) failAi(error);
      }
    })();
    return () => { alive = false; controller.abort(); };
    /* forecastKey covers market+resolution+last bar+horizon: any change
       re-checks rather than painting another view's projection. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOn, forecastKey, aiNonce]);

  const downloadAiModel = async () => {
    stopAiWork.current?.();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const total = aiEstimate?.modelBytes || 0;
    setAiProgress({ loaded: 0, total, percent: 0 });
    setAiPhase('downloading');
    try {
      const client = await loadKronos();
      await client.prepareModel({
        signal: controller.signal,
        onPhase: (phase) => { if (!controller.signal.aborted) setAiPhase(phase === 'engine' ? 'preparing' : 'downloading'); },
        onProgress: (progress) => { if (!controller.signal.aborted) setAiProgress(progress); }
      });
      if (controller.signal.aborted) return;
      setAiProgress(null);
      await computeAi(controller, { prepared: true });
    } catch (error) {
      if (!controller.signal.aborted) { setAiProgress(null); failAi(error); }
    }
  };

  const cancelAi = () => {
    stopAiWork.current?.();
    setAiProgress(null);
    setAiPhase((phase) => (['downloading', 'preparing', 'running'].includes(phase) ? 'cancelled' : phase));
  };

  const change = useMemo(() => {
    if (candles.length < 2) return 0;
    const first = Number(candles[0].close);
    const last = Number(candles[candles.length - 1].close);
    return first > 0 ? ((last - first) / first) * 100 : 0;
  }, [candles]);

  if (!market) return null;

  const has = data.length > 1;
  const label = String(symbol || source || '').replace('/', '-');
  /* The projection summary: direction and size from the last printed close to
     the last projected close. Magnitude is stated, never a target «price
     promise». */
  const aiSummary = (() => {
    if (!has || !Array.isArray(aiBars) || !aiBars.length) return null;
    const last = Number(data[data.length - 1]?.c);
    const proj = aiBars[aiBars.length - 1];
    const end = Number(proj?.c);
    if (!(last > 0) || !Number.isFinite(end)) return null;
    const pct = ((end - last) / last) * 100;
    return { pct, horizon: aiBars.length, up: pct >= 0 };
  })();
  const aiErrKey = aiError ? (AI_ERROR_KEY[aiError] || 'unavailable') : 'unavailable';
  const aiBusyPhase = ['checking', 'preparing', 'running'].includes(aiPhase);

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
          {/* ── THE AI PREDICTION TOGGLE ──────────────────────────────────
              Wires the on-device Kronos model to THIS candlestick chart. The
              button is the whole feature boundary: nothing downloads until it
              is pressed, and pressing it again withdraws the projection. */}
          <button
            type="button"
            className={`futures-ai-toggle ${aiOn ? 'is-on' : ''}`}
            onClick={() => setAiOn((v) => !v)}
            aria-pressed={aiOn}
            data-testid="futures-chart-ai"
            title={t('futures.ai.buttonHint', { defaultValue: 'Project the next candles with the on-device AI model' })}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
              <path d="M19 14l.8 1.9 1.9.8-1.9.8L19 19.4l-.8-1.9-1.9-.8 1.9-.8L19 14z" />
            </svg>
            {t('futures.ai.button', { defaultValue: 'AI forecast' })}
          </button>
        </div>
      </div>

      {/* ── THE AI HUD — one strip, honest about every state ─────────────── */}
      {aiOn && (
        <div className="futures-ai-hud" data-testid="futures-chart-ai-hud">
          {aiPhase === 'needs-download' && (
            <div className="futures-ai-row">
              <span className="futures-ai-copy">
                {t('futures.ai.downloadPrompt', {
                  defaultValue: 'Download the on-device AI model ({{ size }})?',
                  size: aiEstimate?.modelBytes ? `${(aiEstimate.modelBytes / 1e6).toFixed(1)} MB` : t('futures.ai.downloadSizeUnknown', { defaultValue: 'size unknown' })
                })}
              </span>
              <span className="futures-ai-actions">
                <button type="button" className="futures-ai-btn is-primary" data-testid="futures-chart-ai-download" onClick={downloadAiModel}>
                  {t('futures.ai.download', { defaultValue: 'Download & forecast' })}
                </button>
                <button type="button" className="futures-ai-btn" onClick={() => setAiOn(false)}>
                  {t('common.notNow', { defaultValue: 'Not now' })}
                </button>
              </span>
            </div>
          )}
          {aiPhase === 'downloading' && (
            <div className="futures-ai-row">
              <span className="futures-ai-copy">
                {t('futures.ai.downloading', { defaultValue: 'Downloading model… {{ pct }}%', pct: aiProgress?.percent ?? 0 })}
              </span>
              <span className="futures-ai-progress"><span style={{ width: `${aiProgress?.percent ?? 0}%` }} /></span>
              <button type="button" className="futures-ai-btn" data-testid="futures-chart-ai-cancel" onClick={cancelAi}>{t('common.cancel', { defaultValue: 'Cancel' })}</button>
            </div>
          )}
          {aiBusyPhase && (
            <div className="futures-ai-row">
              <span className="futures-ai-spinner" aria-hidden="true" />
              <span className="futures-ai-copy">
                {aiPhase === 'running'
                  ? t('futures.ai.running', { defaultValue: 'Projecting the next candles on this device…' })
                  : t('futures.ai.preparing', { defaultValue: 'Preparing the AI model on this device…' })}
              </span>
              <button type="button" className="futures-ai-btn" onClick={cancelAi}>{t('common.cancel', { defaultValue: 'Cancel' })}</button>
            </div>
          )}
          {aiPhase === 'ready' && aiSummary && (
            <div className="futures-ai-row">
              <span className={`futures-ai-dir ${aiSummary.up ? 'is-up' : 'is-down'}`} data-testid="futures-chart-ai-summary">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {aiSummary.up ? <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></> : <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>}
                </svg>
                {aiSummary.up ? '▲' : '▼'} {Math.abs(aiSummary.pct).toFixed(2)}%
              </span>
              <span className="futures-ai-copy">
                {t('futures.ai.ready', {
                  defaultValue: 'AI projection of the next {{ horizon }} candles. Violet bars are model output, not price action.',
                  horizon: aiSummary.horizon
                })}
              </span>
              <span className="futures-ai-horizon" role="group" aria-label={t('futures.ai.horizon', { defaultValue: 'Projection length' })}>
                {HORIZONS.map((h) => (
                  <button key={h} type="button" className={aiHorizon === h ? 'is-on' : ''} onClick={() => setAiHorizon(h)}>
                    {h === 'auto' ? t('futures.ai.horizonAuto', { defaultValue: 'Auto' }) : h}
                  </button>
                ))}
              </span>
              <button type="button" className="futures-ai-btn" data-testid="futures-chart-ai-refresh" onClick={() => setAiNonce((n) => n + 1)} aria-label={t('futures.ai.recompute', { defaultValue: 'Recompute projection' })}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3L21 8" /><path d="M21 3v5h-5" /></svg>
              </button>
            </div>
          )}
          {aiPhase === 'error' && (
            <div className="futures-ai-row is-error">
              <span className="futures-ai-copy">{t(`futures.ai.err.${aiErrKey}`, { defaultValue: 'The AI forecast could not run. Try again.' })}</span>
              <button type="button" className="futures-ai-btn is-primary" data-testid="futures-chart-ai-retry" onClick={() => setAiNonce((n) => n + 1)}>
                {t('common.retry', { defaultValue: 'Retry' })}
              </button>
            </div>
          )}
          {aiPhase === 'needs-history' && (
            <div className="futures-ai-row is-error">
              <span className="futures-ai-copy">{t('futures.ai.err.shortHistory', { defaultValue: 'Not enough candles yet for the AI model (at least 40).' })}</span>
            </div>
          )}
          {aiPhase === 'unsupported' && (
            <div className="futures-ai-row is-error">
              <span className="futures-ai-copy">{t('futures.ai.err.deviceUnsupported', { defaultValue: 'This device cannot run the on-device AI model.' })}</span>
            </div>
          )}
          {aiPhase === 'cancelled' && (
            <div className="futures-ai-row">
              <span className="futures-ai-copy">{t('futures.ai.err.cancelled', { defaultValue: 'Forecast cancelled.' })}</span>
              <button type="button" className="futures-ai-btn" data-testid="futures-chart-ai-retry" onClick={() => setAiNonce((n) => n + 1)}>{t('common.retry', { defaultValue: 'Retry' })}</button>
            </div>
          )}
        </div>
      )}

      {has ? (
        <Suspense fallback={<div className="skel" style={{ height }} />}>
          <TradingChart
            key={`${provider}:${market}:${resolution}:${candles.length}:${spot ? 's' : 'v'}`}
            data={data}
            symbol={label}
            height={height}
            barsWithVolume={barsWithVolume}
            forecastBars={aiOn && aiPhase === 'ready' ? aiBars : null}
          />
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
