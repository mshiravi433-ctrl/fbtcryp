/**
 * ChartGuide — «راهنمای نمودار»: how to read the candlestick chart.
 *
 * ─── WHY THIS SCREEN EXISTS ────────────────────────────────────────────────
 * The Lab teaches the *ideas* — risk, allocation, what a drawdown feels like —
 * with smoothed charts of its own making. The chart a reader actually meets on
 * a token page is a different object: candles, wicks, a crosshair read-out,
 * moving averages, bands, panes and a dozen toolbar groups. Nothing explained
 * that object, so a reader who did not already know what a wick means was left
 * to infer it from the price moving.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SECOND VERSION — WHAT THE FIRST ONE GOT WRONG
 * ═══════════════════════════════════════════════════════════════════════════
 * The first version mounted `ProChart`, the real terminal engine, on the
 * theory that a tutorial should use the thing it teaches. That theory is right
 * and the execution was not, and the report was exactly what the reader saw:
 * «دکمه‌ها کار نمیده».
 *
 *   · `ProChart` loads `lightweight-charts` through a dynamic import and needs
 *     `matchMedia` + `ResizeObserver`. Until that settles — and permanently on
 *     an embedded WebView, a blocked chunk, or a printed page — there is no
 *     chart, only a recharts fallback that accepts no props. Every toolbar chip
 *     on this screen was therefore a button wired to nothing.
 *   · Most chapters teach a CONTROL, and the control lived inside the engine.
 *     Pressing MA7 in the guide toggled engine state the guide could not show,
 *     because the engine's own toolbar was not on the page.
 *   · A tutorial must be able to point at things. An opaque canvas has nothing
 *     to annotate.
 *
 * So the guide draws its own chart (`GuideChart`, SVG) and its own controls.
 * Nothing here is asynchronous: the tap and the pixels are in the same frame,
 * which is the property the report was really about. The indicator arithmetic
 * is NOT reimplemented — `proChartMath` computes the MA/EMA/BB/RSI/MACD/fib
 * series for both this screen and the live terminal, so the guide cannot teach
 * a different RSI from the one on the token page.
 *
 * ─── THE TEACHING MODEL ────────────────────────────────────────────────────
 * Every chapter has three parts, always in the same order:
 *
 *   1. THE STEP LIST  — what a thing is and why it matters.
 *   2. THE LIVE CHART — the chapter's own preset, with the concept drawn ON
 *                       the chart: the focused candle is ringed, the band is
 *                       shaded, the two averages are labelled where they cross.
 *   3. THE CONTROLS   — the same chips the real toolbar has, each one wired to
 *                       something visible. There is no control on this screen
 *                       that does nothing.
 *
 * ─── HONESTY NOTES THAT ARE PART OF THE UI, NOT THE FOOTER ─────────────────
 *   · The series is labelled «نمونهٔ آموزشی» / "practice data" BEFORE the chart.
 *   · The forecast chapter does not fake a projection; it explains the real
 *     button and where its provider name is printed.
 *   · The guide never suggests a trade, a target or a "good entry".
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LAB_EASE, LabBack, LabChips, Notice, useIsRtl } from './Shared';
import { LabIcon } from './LabIcons';
import { useStill } from '../AnimatedIcon';
import GuideChart, { aggregate, makeWalk } from './GuideChart';
import { CHAPTERS, CHAPTER_BY_ID, DEMO_DEFAULT, TAB_GROUPS, demoFor } from './chartGuideData';
import { fibLevels, simpleMovingAverage } from '../../lib/proChartMath';
import '../../styles/lab-chart-guide.css';

/* ── the practice series ────────────────────────────────────────────────────
 * Generated ONCE, from a fixed seed and a fixed epoch: two chapters must never
 * draw two different "histories" of the same practice asset, and the numbers in
 * a step's prose must match the pixels above it. */
const WALK = makeWalk();
const CANDLES = WALK.map((c) => c);

/* The candle duration of each window, kept next to the chips so the two cannot
   drift. `GuideChart` owns the same table; this copy exists so the facts strip
   below can aggregate exactly the series the chart is drawing. */
export const RANGE_HOURS = { '1D': 1, '7D': 4, '30D': 12, '90D': 24, '1Y': 24 };

/* ── the controls ───────────────────────────────────────────────────────────
 * ONE list, rendered once. `key` is where the value sits in the demo state;
 * `group` decides which row it lands in. Adding a control is one entry here
 * plus one label in the locale — and because the list is also what the test
 * walks, a chip can never ship without a handler. */
const CONTROLS = [
  { id: 'ma7', group: 'overlay', label: 'MA7', icon: 'activity', toggle: ['overlays', 'ma', 7], acc: '#00e5ff' },
  { id: 'ma25', group: 'overlay', label: 'MA25', icon: 'activity', toggle: ['overlays', 'ma', 25], acc: '#ff9800' },
  { id: 'ma99', group: 'overlay', label: 'MA99', icon: 'activity', toggle: ['overlays', 'ma', 99], acc: '#ab47bc' },
  { id: 'ema21', group: 'overlay', label: 'EMA21', icon: 'activity', toggle: ['overlays', 'ema', 21], acc: '#4fc3f7' },
  { id: 'ema55', group: 'overlay', label: 'EMA55', icon: 'activity', toggle: ['overlays', 'ema', 55], acc: '#ffd54f' },
  { id: 'bb', group: 'overlay', label: 'BB', icon: 'gauge', toggle: ['overlays', 'bb'], acc: '#7c4dff' },
  { id: 'fib', group: 'overlay', label: 'Fib', icon: 'target', toggle: ['overlays', 'fib'], acc: '#ffb300' },
  { id: 'volume', group: 'pane', label: 'Volume', icon: 'layers', toggle: ['panes', 'volume'], acc: '#00bcd4' },
  { id: 'rsi', group: 'pane', label: 'RSI', icon: 'gauge', toggle: ['panes', 'rsi'], acc: '#7c4dff' },
  { id: 'macd', group: 'pane', label: 'MACD', icon: 'gauge', toggle: ['panes', 'macd'], acc: '#00bcd4' },
  { id: 'log', group: 'scale', label: 'Log', icon: 'scale', toggle: ['settings', 'log'], acc: '#00e5ff' },
  { id: 'grid', group: 'scale', label: 'Grid', icon: 'grid', toggle: ['settings', 'grid'], acc: '#94a3b8' },
  { id: 'priceLine', group: 'scale', label: 'Level', icon: 'target', toggle: ['showPriceLine'], acc: '#00e5ff' }
];

const TYPE_OPTIONS = ['candles', 'line', 'area'];
const RANGE_OPTIONS = ['1D', '7D', '30D', '90D', '1Y'];

/** Read a nested path. */
function readPath(obj, path) {
  return path.reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

/** Immutable set-in at a nested path. */
function setPath(obj, path, value) {
  const [head, ...rest] = path;
  if (!rest.length) return { ...obj, [head]: value };
  return { ...obj, [head]: setPath(obj?.[head] ?? {}, rest, value) };
}

/** Immutable toggle at a nested path. */
function togglePath(obj, path) {
  const [head, ...rest] = path;
  if (!rest.length) return { ...obj, [head]: !obj?.[head] };
  return { ...obj, [head]: togglePath(obj?.[head] ?? {}, rest) };
}

/* ── per-chapter teaching annotations ───────────────────────────────────────
 * `focus` names a bar ON THIS SERIES to ring and describe, chosen so the thing
 * the chapter talks about is actually happening there. Computed once, from the
 * real walk, rather than typed by hand — a hard-coded index would drift the
 * moment the generator changes. */
function buildHighlights() {
  /* THE SEARCH IS BOUNDED ON PURPOSE. The walk is 60 days of hourly bars but a
     window is only the last 60 candles of it, so a bar found anywhere in the
     history would fall outside the chart and the ring would never render —
     which is precisely how the previous attempt shipped a chapter that pointed
     at nothing. Searching the last 50 hours keeps the annotated candle inside
     every window, including the coarsest (1Y draws 24h buckets, where those
     hours collapse into the final three candles). */
  const TAIL = 50;
  const from = Math.max(6, CANDLES.length - TAIL);
  const find = (fn) => {
    for (let i = from; i < CANDLES.length; i++) if (fn(CANDLES[i], i)) return i;
    return CANDLES.length - 1;
  };

  /* The candle with the widest high-to-low reach: the clearest example of a
     wick for the "body and wick" chapter to point at. The threshold is relative
     to this walk's own volatility — an absolute one would quietly stop matching
     the day the generator changed, and the chapter would lose its ring with no
     test failing. */
  const reach = CANDLES.map((d) => d.high - d.low);
  const reachCut = reach.reduce((a, b) => a + b, 0) / reach.length;
  const tallBody = find((d) => d.high - d.low > reachCut * 1.15);

  const ma7 = simpleMovingAverage(CANDLES, 7);
  const ma25 = simpleMovingAverage(CANDLES, 25);
  const byTime = new Map(ma25.map((p) => [p.time, p.value]));
  /* The bar where the two averages are CLOSEST — the crossing this walk
     actually produces. (A "golden cross" test is not reliable on a random
     walk: this seed may never cross, and a chapter that rings nothing is worse
     than one that rings the near-touch.) Restricted to the same tail, so the
     annotated bar is on screen. */
  let cross = null;
  let gap = Infinity;
  for (const p of ma7) {
    const slow = byTime.get(p.time);
    if (slow == null) continue;
    const i = CANDLES.findIndex((c) => c.time === p.time);
    if (i < from) continue;
    const d = Math.abs(p.value - slow);
    if (d < gap) {
      gap = d;
      cross = i;
    }
  }
  return { tallBody, cross };
}

const HIGHLIGHTS = buildHighlights();

/** Bars per window — the same aggregation `GuideChart` draws. */
const RANGE_BARS = { '1D': 60, '7D': 60, '30D': 60, '90D': 60, '1Y': 60 };

export default function ChartGuide({ onBack }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const still = useStill();
  const rtl = useIsRtl();

  /* `/lab/chart-guide` is its own route, so "back" is a NAVIGATION, not a state
     reset: `Lab` lives at `/lab` and this page is never mounted inside it. A
     caller that passes `onBack` (a test, or a future embedded host) wins. */
  const goBack = onBack ?? (() => navigate('/lab?tab=advanced'));

  const [tabId, setTabId] = useState(TAB_GROUPS[0].id);
  const [chapterId, setChapterId] = useState(TAB_GROUPS[0].chapters[0]);
  const chapter = CHAPTER_BY_ID[chapterId] ?? CHAPTERS[0];

  /* The demo mirrors the open chapter; the reader's own presses are applied on
     top. Switching chapters re-applies that chapter's preset, which is what
     makes each chapter a demonstration rather than a blank chart — but a press
     afterwards still wins, so nothing feels stuck. */
  const [demo, setDemo] = useState(() => demoFor(CHAPTERS[0]));
  const [touched, setTouched] = useState(false);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    setDemo(demoFor(chapter));
    setTouched(false);
    setHover(null);
  }, [chapter]);

  const tabs = useMemo(
    () => TAB_GROUPS.map((g) => ({ id: g.id, label: t(`lab2.chartGuide.tabs.${g.id}`) })),
    [t]
  );
  const chaptersInTab = TAB_GROUPS.find((g) => g.id === tabId)?.chapters ?? [];

  const pickTab = (id) => {
    if (id === tabId) return;
    const first = TAB_GROUPS.find((g) => g.id === id)?.chapters[0];
    setTabId(id);
    if (first) setChapterId(first);
  };

  const apply = (next) => {
    setTouched(true);
    setDemo((d) => (typeof next === 'function' ? next(d) : next));
  };

  /* ── annotation for the open chapter ─────────────────────────────────── */
  const highlight = useMemo(() => {
    if (chapterId !== 'read' && chapterId !== 'avg') return null;
    const idx = chapterId === 'avg' && HIGHLIGHTS.cross != null ? HIGHLIGHTS.cross : HIGHLIGHTS.tallBody;
    if (idx == null || !CANDLES[idx]) return null;
    /* Anchored by timestamp so it survives a range or zoom change — see the
       note in `GuideChart`. No `dimOthers`: the chart marks the bar with a
       spotlight band and a ring, and leaves every other candle at full
       strength so the plot never looks broken while a chapter is open. */
    return { focusTime: CANDLES[idx].time, focusIndex: idx };
  }, [chapterId]);

  /* The bar the call-out sentence describes. Read off the FULL series rather
     than the visible slice, because on a 1D window the annotated bar is not on
     screen at all — and a sentence that vanishes when the reader picks 1D reads
     as a broken control, not as an honest one. */
  const focusCandle = highlight?.focusIndex == null ? null : CANDLES[highlight.focusIndex];

  /* ── the facts shown beside the steps ────────────────────────────────────
   * Live values from the SAME series, so a step that says "the average sits
   * below the price" can be checked against the numbers on screen instead of
   * being taken on faith. */
  const facts = useMemo(() => {
    /* Read off the SAME aggregation the chart is drawing, so "the close is
       104.20" above and "MA7 sits at 103.90" below are statements about one
       series. A facts strip computed from a different slice is worse than no
       strip: it turns a checkable claim into a coincidence. */
    const series = aggregate(CANDLES, RANGE_HOURS[demo.range] ?? 1);
    const bars = RANGE_BARS[demo.range] ?? 60;
    const win = series.slice(-bars);
    const last = win[win.length - 1];
    const first = win[0];
    const high = Math.max(...win.map((d) => d.high));
    const low = Math.min(...win.map((d) => d.low));
    const ma7 = simpleMovingAverage(series, 7);
    const ma25 = simpleMovingAverage(series, 25);
    const fib = fibLevels(high, low);
    return {
      bars: win.length,
      change: first ? ((last.close - first.close) / first.close) * 100 : 0,
      price: last.close,
      high,
      low,
      ma7: ma7[ma7.length - 1]?.value ?? null,
      ma25: ma25[ma25.length - 1]?.value ?? null,
      fib
    };
  }, [demo.range]);

  const reversed = useMemo(() => (rtl ? [...chapter.steps].reverse() : chapter.steps), [chapter, rtl]);

  return (
    <div className={`lab2-screen lab2-cg acc-${chapter.accent}`}>
      <LabBack
        onBack={goBack}
        icon="activity"
        accent="cyan"
        title={t('lab2.screens.chartGuide.title')}
        sub={t('lab2.screens.chartGuide.sub')}
      />

      {/* ─── THE HONESTY BANNER, BEFORE ANY PIXELS OF CHART ──────────────── */}
      <div className="lab2-cg-sample" data-testid="chart-guide-sample">
        <LabIcon name="flask" width={14} height={14} />
        <span>{t('lab2.chartGuide.sampleData')}</span>
      </div>

      {/* ─── TAB RAIL ────────────────────────────────────────────────────── */}
      <LabChips
        items={tabs}
        value={tabId}
        onChange={pickTab}
        layoutId="cg-tab"
        accent={chapter.accent}
        testId="chart-guide-tab"
      />

      {/* ─── CHAPTER RAIL ────────────────────────────────────────────────── */}
      <div className="lab2-cg-chapters" role="group" aria-label={t('lab2.chartGuide.chaptersLabel')}>
        {chaptersInTab.map((id) => {
          const c = CHAPTER_BY_ID[id];
          const on = id === chapterId;
          return (
            <button
              key={id}
              type="button"
              className={`lab2-cg-chapter acc-${c.accent} ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => setChapterId(id)}
              data-testid={`chart-guide-chapter-${id}`}
            >
              <span className="lab2-cg-chapter-icon" aria-hidden="true">
                <LabIcon name={c.icon} width={15} height={15} />
              </span>
              <span className="lab2-cg-chapter-title">{t(`lab2.chartGuide.chapters.${id}.title`)}</span>
              {on && !still && (
                <motion.span
                  layoutId="cg-chapter-pill"
                  className="lab2-cg-chapter-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ═══ THE CHART COMES FIRST ══════════════════════════════════════════
          The reader asked for the lesson to happen ON the chart. So the chart
          is the top of the screen, it is large, and the steps sit under it —
          you read a line, look up, and the thing it described is already
          drawn and annotated. */}
      <section className="lab2-cg-stage" key={chapter.id} aria-label={t('lab2.chartGuide.demo.title')}>
        <div className="lab2-cg-stage-head">
          <div className="lab2-cg-stage-title">
            <LabIcon name={chapter.icon} width={15} height={15} />
            <span>{t(`lab2.chartGuide.chapters.${chapter.id}.title`)}</span>
          </div>
          <span className="lab2-cg-stage-badge" aria-hidden="true">
            {t('lab2.chartGuide.demo.title')}
          </span>
        </div>

        <GuideChart
          range={demo.range}
          chartType={demo.chartType}
          overlays={demo.overlays}
          panes={demo.panes}
          settings={demo.settings}
          showPriceLine={demo.showPriceLine}
          showFib={Boolean(demo.overlays.fib)}
          zoomStart={demo.zoom ?? 0}
          height={340}
          highlight={highlight}
          onHover={setHover}
        />

        {/* The live read-out of the annotated bar — the number the step is
            talking about, sitting right under the chart. */}
        {focusCandle && (
          <div className="lab2-cg-callout" dir={rtl ? 'rtl' : 'ltr'}>
            <LabIcon name="target" width={12} height={12} />
            <span>
              {t('lab2.chartGuide.callout.candle', {
                n: highlight.focusIndex + 1,
                o: focusCandle.open.toFixed(2),
                c: focusCandle.close.toFixed(2),
                h: focusCandle.high.toFixed(2),
                l: focusCandle.low.toFixed(2),
                defaultValue: 'The ringed candle: open {{o}} → close {{c}}'
              })}
            </span>
          </div>
        )}

        {/* ─── CHART TYPE ─────────────────────────────────────────────────── */}
        <div className="lab2-cg-control-row">
          <span className="lab2-cg-control-label">{t('lab2.chartGuide.demo.type')}</span>
          <div className="lab2-cg-chips">
            {TYPE_OPTIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={`lab2-cg-chip ${demo.chartType === id ? 'on' : ''}`}
                aria-pressed={demo.chartType === id}
                onClick={() => apply((d) => ({ ...d, chartType: id }))}
                data-testid={`chart-guide-type-${id}`}
              >
                {t(`lab2.chartGuide.demo.types.${id}`)}
              </button>
            ))}
          </div>
        </div>

        {/* ─── RANGE (now real: it changes how many bars are drawn) ───────── */}
        <div className="lab2-cg-control-row">
          <span className="lab2-cg-control-label">{t('lab2.chartGuide.demo.range')}</span>
          <div className="lab2-cg-chips">
            {RANGE_OPTIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={`lab2-cg-chip lab2-cg-chip--num ${demo.range === id ? 'on' : ''}`}
                aria-pressed={demo.range === id}
                onClick={() => apply((d) => ({ ...d, range: id, zoom: 0 }))}
                data-testid={`chart-guide-range-${id}`}
              >
                {id}
              </button>
            ))}
          </div>
        </div>

        {/* ─── OVERLAYS + PANES + SCALE, one row each ────────────────────── */}
        {['overlay', 'pane', 'scale'].map((group) => {
          const items = CONTROLS.filter((c) => c.group === group);
          return (
            <div className="lab2-cg-control-row" key={group}>
              <span className="lab2-cg-control-label">{t(`lab2.chartGuide.demo.groups.${group}`)}</span>
              <div className="lab2-cg-chips">
                {items.map((item) => {
                  const on = Boolean(readPath(demo, item.toggle));
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`lab2-cg-chip ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      onClick={() => apply((d) => setPath(d, item.toggle, !readPath(d, item.toggle)))}
                      data-testid={`chart-guide-toggle-${item.id}`}
                      style={on ? { '--chip-acc': item.acc } : undefined}
                    >
                      <LabIcon name={item.icon} width={12} height={12} />
                      {t(`lab2.chartGuide.demo.togglesMap.${item.id}`, { defaultValue: item.label })}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* ─── ZOOM / FIT ────────────────────────────────────────────────── */}
        <div className="lab2-cg-control-row">
          <span className="lab2-cg-control-label">{t('lab2.chartGuide.demo.view')}</span>
          <div className="lab2-cg-chips">
            <button
              type="button"
              className="lab2-cg-chip"
              onClick={() => apply((d) => ({
                ...d,
                /* Stop zooming in when about 12 candles are left; past that a
                   candle is wider than the slot it is drawn in. */
                zoom: Math.min((d.zoom ?? 0) + 12, Math.max(0, (RANGE_BARS[d.range] ?? 60) - 12))
              }))}
              data-testid="chart-guide-zoom"
            >
              <LabIcon name="plus" width={12} height={12} />
              {t('lab2.chartGuide.demo.zoomIn')}
            </button>
            <button
              type="button"
              className="lab2-cg-chip"
              onClick={() => apply((d) => ({ ...d, zoom: 0 }))}
              data-testid="chart-guide-fit"
            >
              <LabIcon name="refresh" width={12} height={12} />
              {t('lab2.chartGuide.demo.fit')}
            </button>
            <button
              type="button"
              className="lab2-cg-chip"
              onClick={() => apply(() => demoFor(CHAPTERS[0]))}
              data-testid="chart-guide-reset"
            >
              <LabIcon name="back" width={12} height={12} />
              {t('lab2.chartGuide.demo.reset')}
            </button>
          </div>
        </div>

        {touched && (
          <button
            type="button"
            className="lab2-cg-reapply"
            onClick={() => {
              setDemo(demoFor(chapter));
              setTouched(false);
            }}
          >
            <LabIcon name="refresh" width={12} height={12} />
            {t('lab2.chartGuide.demo.reapply', { defaultValue: 'Restore this chapter’s demo' })}
          </button>
        )}
      </section>

      {/* ═══ THE NUMBERS ════════════════════════════════════════════════════
          Live values from the same series, so a step's claim can be checked
          against a figure instead of taken on faith. */}
      <div className="lab2-cg-facts" dir={rtl ? 'rtl' : 'ltr'}>
        <div className="lab2-cg-fact">
          <span className="lab2-cg-fact-k">{t('lab2.chartGuide.facts.price')}</span>
          <span className="lab2-cg-fact-v lab2-num">{facts.price.toFixed(2)}</span>
        </div>
        <div className="lab2-cg-fact">
          <span className="lab2-cg-fact-k">{t('lab2.chartGuide.facts.change')}</span>
          <span className={`lab2-cg-fact-v lab2-num ${facts.change >= 0 ? 'up' : 'down'}`}>
            {facts.change >= 0 ? '+' : ''}{facts.change.toFixed(2)}%
          </span>
        </div>
        <div className="lab2-cg-fact">
          <span className="lab2-cg-fact-k">{t('lab2.chartGuide.facts.range')}</span>
          <span className="lab2-cg-fact-v lab2-num">{facts.low.toFixed(1)}–{facts.high.toFixed(1)}</span>
        </div>
        <div className="lab2-cg-fact">
          <span className="lab2-cg-fact-k">{t('lab2.chartGuide.facts.bars')}</span>
          <span className="lab2-cg-fact-v lab2-num">{facts.bars}</span>
        </div>
        <div className="lab2-cg-fact">
          <span className="lab2-cg-fact-k">MA7</span>
          <span className="lab2-cg-fact-v lab2-num">{facts.ma7 == null ? '—' : facts.ma7.toFixed(2)}</span>
        </div>
        <div className="lab2-cg-fact">
          <span className="lab2-cg-fact-k">MA25</span>
          <span className="lab2-cg-fact-v lab2-num">{facts.ma25 == null ? '—' : facts.ma25.toFixed(2)}</span>
        </div>
      </div>

      {/* ═══ THE STEPS ══════════════════════════════════════════════════════ */}
      <motion.ol
        className="lab2-cg-steps"
        key={chapter.id}
        initial={still ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: LAB_EASE }}
      >
        {reversed.map((stepId, i) => (
          <motion.li
            key={stepId}
            className="lab2-cg-step"
            initial={still ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: LAB_EASE, delay: still ? 0 : Math.min(i * 0.05, 0.3) }}
          >
            <span className="lab2-cg-step-num lab2-num" aria-hidden="true">{i + 1}</span>
            <div className="lab2-cg-step-body">
              <div className="lab2-cg-step-title">
                {t(`lab2.chartGuide.chapters.${chapter.id}.steps.${stepId}.title`)}
              </div>
              <p className="lab2-cg-step-text">
                {t(`lab2.chartGuide.chapters.${chapter.id}.steps.${stepId}.body`)}
              </p>
              <div className="lab2-cg-step-where">
                <LabIcon name="target" width={12} height={12} />
                <span>{t(`lab2.chartGuide.chapters.${chapter.id}.steps.${stepId}.where`)}</span>
              </div>
            </div>
          </motion.li>
        ))}
      </motion.ol>

      <Notice variant="tip" icon="bulb" title={t('lab2.chartGuide.noteTitle')}>
        {t('lab2.chartGuide.note')}
      </Notice>

      <div className="lab2-cg-exit">
        <Link className="lab2-btn primary full" to="/lab?tab=practice">
          <LabIcon name="next" width={15} height={15} />
          <span>{t('lab2.chartGuide.backToLab')}</span>
        </Link>
      </div>
    </div>
  );
}
