import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import ProChart from './ProChart';
import CoinLogo from '../CoinLogo';
import { useVolumeSeries } from '../../hooks/useMarket';
import {
  alignVolumeToCandles,
  candleSignature,
  candleSpacingMs,
  fibLevels as makeFibLevels,
  intervalLabel,
  pricePrecision,
  rangePosition,
  toCandles,
  windowStats
} from '../../lib/proChartMath';
import { fmtCompact, fmtPrice } from '../../lib/format';
import '../../styles/pro-chart.css';

/**
 * TOKENCHART — the professional candlestick terminal on the coin page.
 * ---------------------------------------------------------------------------
 * ─── THE ASK ────────────────────────────────────────────────────────────────
 * «در صفحه هر توکن نمودار شمعی خیلی حرفه‌ای کن و دکمه بذار کوچک که وقتی
 * می‌زنیم به صورت تمام‌صفحه افقی نمودار بیاد و همه ابزارهای تحلیلی را داشته
 * باشد».
 *
 * Two surfaces, one engine:
 *
 *   • INLINE — the card on the coin page. Candles, MA(7)/MA(25), a live
 *     crosshair legend, and a SMALL expand button. No volume pane, because a
 *     volume pane needs a second request and most visits never expand.
 *   • FULL SCREEN — the same chart at full height, in landscape where the
 *     browser allows it, with the analysis toolbox: MA 7/25/99, EMA 21/55,
 *     Bollinger bands, 24h volume, RSI, MACD, Fibonacci, saveable price
 *     levels, a two-tap measure tool, log scale, grid, zoom presets, a PNG
 *     snapshot and a reset.
 *
 * ─── WHY THE TOOLBOX IS NOT ONE BIG COMPONENT ───────────────────────────────
 * All of it is state this component owns and options the chart applies; the
 * engine (ProChart) knows nothing about which button toggled what. That split
 * means the inline and full-screen views cannot drift: same state, same
 * persisted preferences, same rendering.
 *
 * ─── WHAT THE READER'S CHOICES SURVIVE ──────────────────────────────────────
 * Overlay/pane choices persist in localStorage, so the terminal opens the way
 * it was left. Price levels persist PER COIN — a support line you drew on ETH
 * has no meaning on DOGE, and showing it there would be worse than showing
 * nothing. Everything else (range, zoom) resets on navigation, which is what
 * you want: a zoom from last week is not a view of today.
 *
 * ─── FULL SCREEN, AND THE PART BROWSERS REFUSE ──────────────────────────────
 * Tapping expand asks for real fullscreen + landscape orientation INSIDE the
 * click handler (both APIs require a user gesture and both refuse without
 * one). iOS Safari has no element fullscreen and no orientation lock, and an
 * embedded preview frame blocks both — so neither failure is allowed to be
 * fatal: the overlay is a fixed, full-viewport layer either way, and the
 * "rotate" control re-requests while explaining what happened if it cannot.
 */

const PREFS_KEY = 'fbt-prochart-prefs:v1';
const LEVELS_PREFIX = 'fbt-prochart-levels:v1:';

const DEFAULT_PREFS = {
  overlays: { ma: { 7: true, 25: true, 99: false }, ema: { 21: false, 55: false }, bb: false, fib: false },
  panes: { volume: true, rsi: false, macd: false },
  settings: { log: false, grid: true }
};

const storage = {
  get(key, fallback) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return fallback;
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode, quota — a preference that cannot be saved is not fatal */
    }
  }
};

function loadPrefs() {
  const stored = storage.get(PREFS_KEY, null);
  if (!stored || typeof stored !== 'object') return DEFAULT_PREFS;
  return {
    overlays: {
      ma: { ...DEFAULT_PREFS.overlays.ma, ...(stored.overlays?.ma ?? {}) },
      ema: { ...DEFAULT_PREFS.overlays.ema, ...(stored.overlays?.ema ?? {}) },
      bb: Boolean(stored.overlays?.bb),
      fib: Boolean(stored.overlays?.fib)
    },
    panes: { ...DEFAULT_PREFS.panes, ...(stored.panes ?? {}) },
    settings: { ...DEFAULT_PREFS.settings, ...(stored.settings ?? {}) }
  };
}

/** Height for the SVG fallback inside the terminal: most of the viewport,
 *  because that is the room the real engine would have filled. Browser-only,
 *  and only used when the engine could not mount. */
function expandedFallbackHeight() {
  const viewport = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 640;
  return Math.max(240, Math.round(viewport * 0.55));
}

function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 9.5A9 9 0 0 1 20 12M20.5 14.5A9 9 0 0 1 4 12" />
      <path d="M3.5 4.5v5h5M20.5 19.5v-5h-5" />
    </svg>
  );
}

/** One toggle chip. Buttons, not checkboxes: this is a toolbar. */
function Chip({ active, onClick, children, title, tone }) {
  return (
    <button
      type="button"
      className={`pc-chip${active ? ' is-on' : ''}${tone ? ` pc-chip--${tone}` : ''}`}
      onClick={onClick}
      aria-pressed={Boolean(active)}
      title={title || undefined}
    >
      {children}
    </button>
  );
}

function OHLC({ bar, t, volumeLabel }) {
  if (!bar) return <span className="pc-legend-empty">—</span>;
  const up = bar.close >= bar.open;
  const chg = bar.open > 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;
  const digits = pricePrecision(bar.close);
  const show = (v) => (Number.isFinite(v) ? v.toFixed(digits) : '—');
  return (
    <span className="pc-ohlc mono">
      <span><em>{t('coin.pro.o')}</em>{show(bar.open)}</span>
      <span><em>{t('coin.pro.h')}</em>{show(bar.high)}</span>
      <span><em>{t('coin.pro.l')}</em>{show(bar.low)}</span>
      <span><em>{t('coin.pro.c')}</em>{fmtPrice(bar.close)}</span>
      <span className={up ? 'up' : 'down'}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
      {Number.isFinite(bar.volume) ? (
        <span className="pc-vol"><em>{volumeLabel}</em>{fmtCompact(bar.volume)}</span>
      ) : null}
    </span>
  );
}

export default function TokenChart({
  data,
  symbol = '',
  coin = null,
  coinId = '',
  height = 300,
  range,
  ranges = [],
  onRangeChange,
  loading = false
}) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  /*
   * Two refs, not one. The inline chart and the full-screen chart both use
   * the engine, and a single ref would be overwritten by whichever mounted
   * last — so closing the terminal would leave the inline chart unreachable
   * for zoom/fit and the "reset" chip would act on nothing.
   */
  const inlineChartRef = useRef(null);
  const fsChartRef = useRef(null);
  const expandBtnRef = useRef(null);
  const closeBtnRef = useRef(null);
  const dialogRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  /* Whichever chart is on screen owns the imperative handle. */
  const chartRef = expanded ? fsChartRef : inlineChartRef;
  const [prefs, setPrefs] = useState(loadPrefs);
  const [levels, setLevels] = useState(() => storage.get(`${LEVELS_PREFIX}${coinId}`, []));
  const [tool, setTool] = useState('none');
  const [measure, setMeasure] = useState({ a: null, b: null });
  const [hover, setHover] = useState(null);
  const [stats, setStats] = useState(null);
  const [snapshotNote, setSnapshotNote] = useState('');
  const [orientationNote, setOrientationNote] = useState('');

  const { overlays, panes, settings } = prefs;

  /*
   * Candles are memoised by SIGNATURE, not by array identity: the OHLC poll
   * hands back a fresh array every minute with the same bars, and rebuilding
   * the chart on that would throw away the reader's zoom once a minute.
   */
  const signature = candleSignature(data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const candles = useMemo(() => toCandles(data), [signature]);
  const spacing = useMemo(() => candleSpacingMs(candles), [candles]);
  const interval = intervalLabel(spacing);

  const needVolume = expanded && panes.volume;
  const { data: volumeRaw, loading: volumeLoading } = useVolumeSeries(needVolume && coinId ? coinId : null, range?.days ?? 30);
  const volume = useMemo(
    () => (needVolume ? alignVolumeToCandles(volumeRaw, candles) : []),
    [needVolume, volumeRaw, candles]
  );
  const volumeReady = volume.length > 0;

  /* Levels are per coin: reload when the page navigates to another token. */
  useEffect(() => {
    setLevels(storage.get(`${LEVELS_PREFIX}${coinId}`, []));
  }, [coinId]);

  useEffect(() => {
    storage.set(PREFS_KEY, prefs);
  }, [prefs]);

  useEffect(() => {
    storage.set(`${LEVELS_PREFIX}${coinId}`, levels);
  }, [levels, coinId]);

  const lastBar = candles.length ? candles[candles.length - 1] : null;
  const shownBar = hover ?? lastBar;
  const activeStats = stats ?? windowStats(candles);

  const fib = useMemo(() => {
    if (!overlays.fib || !activeStats) return [];
    return makeFibLevels(activeStats.high, activeStats.low);
  }, [overlays.fib, activeStats]);

  const toggleOverlay = useCallback((group, key) => {
    setPrefs((prev) => ({
      ...prev,
      overlays: {
        ...prev.overlays,
        [group]: typeof key === 'boolean'
          ? !prev.overlays[group]
          : { ...prev.overlays[group], [key]: !prev.overlays[group][key] }
      }
    }));
  }, []);

  const togglePane = useCallback((pane) => {
    setPrefs((prev) => ({ ...prev, panes: { ...prev.panes, [pane]: !prev.panes[pane] } }));
  }, []);

  const toggleSetting = useCallback((key) => {
    setPrefs((prev) => ({ ...prev, settings: { ...prev.settings, [key]: !prev.settings[key] } }));
  }, []);

  /*
   * Plain function, not a useCallback: `chartRef` is resolved from
   * `expanded` on every render, and a memoised closure would keep pointing at
   * the INLINE chart after the terminal opened — reset would then fit a chart
   * that is not on screen and leave the visible one zoomed in.
   */
  function resetAll() {
    setPrefs(DEFAULT_PREFS);
    setTool('none');
    setMeasure({ a: null, b: null });
    chartRef.current?.fit();
  }

  /* ---------------- full screen lifecycle ---------------- */

  const unlockScreen = useCallback(() => {
    try {
      if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen()?.catch?.(() => {});
      }
    } catch { /* noop */ }
    try {
      if (typeof screen !== 'undefined' && screen.orientation?.unlock) screen.orientation.unlock();
    } catch { /* noop */ }
  }, []);

  const closeExpanded = useCallback(() => {
    setExpanded(false);
    setTool('none');
    setMeasure({ a: null, b: null });
    setOrientationNote('');
    unlockScreen();
    /* Focus goes back to the button that opened the dialog, not to <body>. */
    setTimeout(() => expandBtnRef.current?.focus?.({ preventScroll: true }), 0);
  }, [unlockScreen]);

  async function openExpanded() {
    setExpanded(true);
    setHover(null);
    /*
     * Both calls are inside the gesture on purpose — requestFullscreen and
     * orientation.lock reject when they are not, and the rejection is
     * expected on iOS and in embedded frames. The overlay is the real
     * experience; these two only make it feel native where they exist.
     */
    try {
      const root = document.documentElement;
      if (root?.requestFullscreen && !document.fullscreenElement) {
        await root.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch { /* unsupported / not allowed */ }
    let locked = false;
    try {
      if (typeof screen !== 'undefined' && screen.orientation?.lock) {
        await screen.orientation.lock('landscape');
        locked = true;
      }
    } catch { /* unsupported / not allowed */ }
    /*
     * Say what the browser would not do. On a phone held upright with no
     * orientation lock (iOS, and every embedded frame), the terminal still
     * opens full screen — it just stays portrait, and "turn the phone" is the
     * one instruction that makes the next tap better than this one.
     */
    if (!locked && typeof window !== 'undefined' && window.innerWidth < window.innerHeight) {
      setOrientationNote(t('coin.pro.rotateHint'));
    }
  }

  async function requestLandscape() {
    try {
      const root = document.documentElement;
      if (root?.requestFullscreen && !document.fullscreenElement) {
        await root.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch { /* noop */ }
    try {
      if (typeof screen !== 'undefined' && screen.orientation?.lock) {
        await screen.orientation.lock('landscape');
        setOrientationNote('');
        return;
      }
    } catch { /* noop */ }
    /* Honest fallback: say rotation is manual instead of pretending. */
    setOrientationNote(t('coin.pro.rotateHint'));
  }

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.classList.add('pc-no-scroll');
    const focusTimer = setTimeout(() => closeBtnRef.current?.focus?.({ preventScroll: true }), 30);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeExpanded();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFullscreenChange = () => {
      /* Leaving native fullscreen by the system gesture (Android back) must
         also leave the overlay — otherwise the chart sits full screen with
         no visible way out on some devices. */
      if (!document.fullscreenElement) setOrientationNote(t('coin.pro.tapRotate'));
    };

    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.documentElement.classList.remove('pc-no-scroll');
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [expanded, closeExpanded, t]);

  /* ---------------- tools ---------------- */

  const addLevel = useCallback((price) => {
    if (!Number.isFinite(price) || price <= 0) return;
    setLevels((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, price }]);
  }, []);

  const onChartClick = useCallback((point) => {
    if (!point || !Number.isFinite(point.price)) return;
    if (tool === 'level') {
      addLevel(point.price);
      setTool('none');
      return;
    }
    if (tool === 'measure') {
      setMeasure((prev) => {
        if (!prev.a) return { a: point, b: null };
        return { a: prev.a, b: point };
      });
    }
  }, [tool, addLevel]);

  const measureInfo = useMemo(() => {
    if (!measure.a || !measure.b) return null;
    const p0 = measure.a.price;
    const p1 = measure.b.price;
    const deltaPct = p0 > 0 ? ((p1 - p0) / p0) * 100 : 0;
    const bars = spacing > 0 && measure.a.time && measure.b.time
      ? Math.round(Math.abs(measure.b.time - measure.a.time) / (spacing / 1000))
      : null;
    return { p0, p1, deltaPct, bars, up: p1 >= p0 };
  }, [measure, spacing]);

  function downloadSnapshot() {
    const canvas = chartRef.current?.screenshot?.();
    if (!canvas) {
      setSnapshotNote(t('coin.pro.snapshotFailed'));
      setTimeout(() => setSnapshotNote(''), 2600);
      return;
    }
    try {
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `${(symbol || 'chart').toUpperCase()}-${range?.key ?? ''}-${stamp}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setSnapshotNote(t('coin.pro.snapshotSaved'));
      setTimeout(() => setSnapshotNote(''), 2600);
    } catch {
      setSnapshotNote(t('coin.pro.snapshotFailed'));
      setTimeout(() => setSnapshotNote(''), 2600);
    }
  }

  /* ---------------- rendering ---------------- */

  const hasCandles = candles.length >= 2;
  const price = shownBar?.close ?? lastBar?.close ?? 0;
  const sessionChange = activeStats?.changePct ?? 0;
  const up = sessionChange >= 0;
  const legendId = `pc-legend-${uid}`;

  const legend = (
    <div className="pc-legend" dir="ltr" id={legendId} aria-live="polite">
      <span className="pc-sym">{symbol}</span>
      <span className="pc-interval" title={t('coin.pro.intervalHint')}>{interval}</span>
      <OHLC bar={shownBar} t={t} volumeLabel={t('coin.pro.vol24')} />
      <span className={`pc-range-pos${up ? ' up' : ' down'}`}>
        {Number.isFinite(sessionChange) ? `${sessionChange >= 0 ? '+' : ''}${sessionChange.toFixed(2)}%` : '—'}
      </span>
    </div>
  );

  const statsStrip = activeStats ? (
    <div className="pc-stats mono" dir="ltr">
      <span><em>{t('coin.pro.high')}</em>{fmtPrice(activeStats.high)}</span>
      <span><em>{t('coin.pro.low')}</em>{fmtPrice(activeStats.low)}</span>
      <span><em>{t('coin.pro.change')}</em><b className={up ? 'up' : 'down'}>{sessionChange >= 0 ? '+' : ''}{sessionChange.toFixed(2)}%</b></span>
      <span><em>{t('coin.pro.range')}</em>{activeStats.rangePct.toFixed(1)}%</span>
      <span><em>{t('coin.pro.atr')}</em>{activeStats.atrPct.toFixed(2)}%</span>
      <span><em>{t('coin.pro.pos')}</em>{rangePosition(price, activeStats.high, activeStats.low).toFixed(0)}%</span>
      <span className="pc-stats-bars"><em>{t('coin.pro.bars')}</em>{activeStats.bars}</span>
    </div>
  ) : null;

  const toolbar = (
    <div className="pc-toolbar" role="toolbar" aria-label={t('coin.pro.tools')}>
      <div className="pc-toolgroup">
        {[7, 25, 99].map((period) => (
          <Chip key={`ma${period}`} active={overlays.ma[period]} onClick={() => toggleOverlay('ma', period)} title={`MA ${period}`}>
            MA{period}
          </Chip>
        ))}
      </div>
      <div className="pc-toolgroup">
        {[21, 55].map((period) => (
          <Chip key={`ema${period}`} active={overlays.ema[period]} onClick={() => toggleOverlay('ema', period)} title={`EMA ${period}`}>
            EMA{period}
          </Chip>
        ))}
        <Chip active={overlays.bb} onClick={() => toggleOverlay('bb', true)}>{t('coin.pro.bb')}</Chip>
      </div>
      <div className="pc-toolgroup">
        <Chip active={panes.volume} onClick={() => togglePane('volume')}>{t('coin.pro.volume')}</Chip>
        <Chip active={panes.rsi} onClick={() => togglePane('rsi')}>{t('coin.pro.rsi')}</Chip>
        <Chip active={panes.macd} onClick={() => togglePane('macd')}>{t('coin.pro.macd')}</Chip>
      </div>
      <div className="pc-toolgroup">
        <Chip active={overlays.fib} onClick={() => toggleOverlay('fib', true)}>{t('coin.pro.fib')}</Chip>
        <Chip active={tool === 'level'} onClick={() => setTool((v) => (v === 'level' ? 'none' : 'level'))} title={t('coin.pro.levelHint')}>
          {t('coin.pro.level')}
        </Chip>
        <Chip active={tool === 'measure'} onClick={() => { setMeasure({ a: null, b: null }); setTool((v) => (v === 'measure' ? 'none' : 'measure')); }} title={t('coin.pro.measureHint')}>
          {t('coin.pro.measure')}
        </Chip>
      </div>
      <div className="pc-toolgroup">
        <Chip active={settings.log} onClick={() => toggleSetting('log')} title={t('coin.pro.logHint')}>{settings.log ? t('coin.pro.log') : t('coin.pro.linear')}</Chip>
        <Chip active={settings.grid} onClick={() => toggleSetting('grid')}>{t('coin.pro.grid')}</Chip>
      </div>
      <div className="pc-toolgroup pc-toolgroup--actions">
        <Chip onClick={() => chartRef.current?.zoom(0.62)} title={t('coin.pro.zoomIn')}><span aria-hidden="true">＋</span></Chip>
        <Chip onClick={() => chartRef.current?.zoom(1.6)} title={t('coin.pro.zoomOut')}><span aria-hidden="true">－</span></Chip>
        <Chip onClick={() => chartRef.current?.fit()} title={t('coin.pro.fit')}>{t('coin.pro.fit')}</Chip>
        <Chip onClick={downloadSnapshot} title={t('coin.pro.snapshot')}>{t('coin.pro.png')}</Chip>
        <Chip onClick={resetAll} title={t('coin.pro.reset')}>{t('coin.pro.reset')}</Chip>
      </div>
    </div>
  );

  const hint = tool === 'level'
    ? t('coin.pro.levelHint')
    : tool === 'measure'
      ? t('coin.pro.measureHint')
      : '';

  const overlay = expanded && typeof document !== 'undefined' ? createPortal(
    <div
      className="pc-fs"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('coin.pro.dialog', { symbol: symbol || coin?.name || '' })}
      data-testid="pro-chart-fullscreen"
    >
      <div className="pc-fs-aurora" aria-hidden="true" />

      <header className="pc-fs-head">
        <div className="pc-fs-ident">
          <CoinLogo coin={coin} px={26} />
          <div className="pc-fs-names">
            <span className="pc-fs-sym">{symbol || coin?.symbol}</span>
            <span className="pc-fs-name">{coin?.name || ''}</span>
          </div>
          <span className="pc-fs-price mono" dir="ltr">{fmtPrice(price)}</span>
          <span className={`pill ${up ? 'pill-up' : 'pill-down'}`} dir="ltr">
            {sessionChange >= 0 ? '+' : ''}{sessionChange.toFixed(2)}%
          </span>
        </div>
        <div className="pc-fs-head-actions">
          <button type="button" className="pc-fs-icon" onClick={requestLandscape} title={t('coin.pro.rotate')} aria-label={t('coin.pro.rotate')}>
            <RotateIcon />
          </button>
          <button
            type="button"
            ref={closeBtnRef}
            className="pc-fs-icon pc-fs-close"
            onClick={closeExpanded}
            title={t('coin.pro.close')}
            aria-label={t('coin.pro.close')}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="pc-fs-ranges" role="group" aria-label={t('coin.pro.timeframe')}>
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`pc-range${range?.key === r.key ? ' is-on' : ''}`}
            aria-pressed={range?.key === r.key}
            onClick={() => onRangeChange?.(r)}
          >
            {r.key}
          </button>
        ))}
        <span className="pc-fs-interval">{interval} · {t('coin.pro.interval')}</span>
      </div>

      <div className="pc-fs-main">
        {!loading && !hasCandles ? (
          <div className="pc-fs-empty">{t('coin.noCandles')}</div>
        ) : (
          <>
            <div className={`pc-stage${tool !== 'none' ? ' is-tool' : ''}`}>
              <div className="pc-watermark" aria-hidden="true">{symbol}</div>
              <ProChart
                ref={fsChartRef}
                dataKey={`${range?.key ?? ''}:${signature}`}
                candles={candles}
                volume={volume}
                rsiOn={panes.rsi}
                macdOn={panes.macd}
                overlays={overlays}
                settings={settings}
                levels={levels}
                fib={fib}
                locale={i18n.language === 'fa' ? 'fa-IR' : 'en-US'}
                fallbackHeight={expandedFallbackHeight()}
                onCrosshair={setHover}
                onChartClick={onChartClick}
                onWindowStats={setStats}
              />
              <div className="pc-fs-legend">{legend}</div>
              {measureInfo && measure.a && measure.b ? (
                <div
                  className={`pc-measure${measureInfo.up ? ' up' : ' down'}`}
                  dir="ltr"
                  style={{
                    left: `${Math.min(Math.max(measure.b.x ?? 20, 8), 9999)}px`,
                    top: `${Math.max((measure.b.y ?? 20) - 10, 8)}px`
                  }}
                >
                  <b>{measureInfo.deltaPct >= 0 ? '+' : ''}{measureInfo.deltaPct.toFixed(2)}%</b>
                  <span>{fmtPrice(Math.abs(measureInfo.p1 - measureInfo.p0))}</span>
                  {measureInfo.bars != null ? <span>{measureInfo.bars} {t('coin.pro.barsShort')}</span> : null}
                </div>
              ) : null}
            </div>
            {statsStrip}
          </>
        )}
      </div>

      {hint ? <div className="pc-fs-hint">{hint}</div> : null}
      {orientationNote ? <div className="pc-fs-hint pc-fs-hint--soft">{orientationNote}</div> : null}
      {snapshotNote ? <div className="pc-fs-toast" role="status">{snapshotNote}</div> : null}

      {toolbar}

      {needVolume && !volumeReady && !volumeLoading ? (
        <div className="pc-fs-note">{t('coin.pro.volumeUnavailable')}</div>
      ) : null}
    </div>,
    document.body
  ) : null;

  return (
    <div className="pc" data-testid="token-chart">
      <div className="pc-inline-head">
        {legend}
        <div className="pc-inline-actions">
          <span className="pc-inline-updated" aria-hidden="true">{interval}</span>
          <button
            type="button"
            ref={expandBtnRef}
            className="pc-expand"
            onClick={openExpanded}
            aria-label={t('coin.pro.open')}
            title={t('coin.pro.open')}
            aria-haspopup="dialog"
            aria-expanded={expanded}
          >
            <ExpandIcon />
          </button>
        </div>
      </div>

      <div className="pc-stage pc-stage--inline" style={{ height }}>
        {loading && !hasCandles ? (
          <div className="skel pc-skel" style={{ height: '100%' }} />
        ) : hasCandles && !expanded ? (
          <>
            <div className="pc-watermark" aria-hidden="true">{symbol}</div>
            <ProChart
              ref={inlineChartRef}
              dataKey={`${range?.key ?? ''}:${signature}`}
              candles={candles}
              volume={[]}
              rsiOn={false}
              macdOn={false}
              overlays={overlays}
              settings={settings}
              levels={levels}
              fib={fib}
              locale={i18n.language === 'fa' ? 'fa-IR' : 'en-US'}
              fallbackHeight={height}
              onCrosshair={setHover}
              onWindowStats={setStats}
            />
          </>
        ) : expanded ? (
          /* The terminal covers the card; keeping a second live chart behind
             it would double the canvas work for pixels nobody can see. */
          <div className="skel pc-skel" style={{ height: '100%' }} />
        ) : (
          <div className="pc-empty">{t('coin.noCandles')}</div>
        )}
      </div>

      {overlay}
    </div>
  );
}
