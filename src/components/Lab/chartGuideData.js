/**
 * CHART GUIDE — the curriculum for «راهنمای نمودار».
 *
 * ─── WHY THIS IS DATA AND NOT A COMPONENT FULL OF JSX ──────────────────────
 * `AppGuide` established the pattern: an array of chapters, each a list of
 * steps, and every word of prose living in i18n under a predictable key path.
 * That is what lets the same screen ship in twelve languages without a
 * translator touching React, and it is what stops a step from being silently
 * dropped from one language because somebody edited the JSX.
 *
 * ─── WHAT THIS GUIDE IS ALLOWED TO TEACH ───────────────────────────────────
 * Only controls that exist. The toolbar inventory was read off
 * `TokenChart.jsx`, not invented:
 *
 *   ranges     1D · 7D · 30D · 90D · 1Y           (`RANGES` in CoinDetail)
 *   types      candles · line · area
 *   averages   MA7 · MA25 · MA99 · EMA21 · EMA55
 *   envelopes  Bollinger bands
 *   panes      volume · RSI · MACD
 *   levels     Fibonacci · price line · measure
 *   scale      log · grid
 *   capture    PNG snapshot · reset · zoom ± / fit
 *   AI         forecast chip + horizon (a model's opinion, labelled as such)
 *
 * There is NO freehand drawing tool, no shape tool and no alert tool, so the
 * guide does not offer a chapter on them. A tutorial that teaches a button
 * nobody can press is worse than no tutorial: the reader concludes the app is
 * broken, not that the lesson is aspirational.
 *
 * ─── THE TWO ROOMS IN WHICH THE CHART APPEARS ──────────────────────────────
 * `room: 'token'` — the token page (compact card, terminal closed)
 * `room: 'terminal'` — the expanded/full-screen candlestick terminal
 * A step that behaves differently between them says so, because the toolbar
 * genuinely moves between them: `TokenChart` renders `pc-toolbar` inline in
 * the closed room and `pc-fs-*` inside the expanded one.
 *
 * ─── PRACTICE STEPS ARE MARKED, NOT FAKED ──────────────────────────────────
 * `practice: true` chapters are the ones the live demo under the step listens
 * for. They are the only steps where "try it" is honest — everything else is
 * reading.
 */

/**
 * Chapter ids double as the locale key segment: `lab2.chartGuide.chapters.<id>.*`
 * and they are also the ids the tab rail announces. Changing one is a locale
 * change, so keep them short and stable.
 */
export const CHAPTERS = [
  {
    id: 'read',
    icon: 'activity',
    accent: 'cyan',
    practice: true,
    /* Which controls the live demo highlights while this chapter is open. */
    demo: { overlays: {}, panes: { volume: true } },
    steps: ['open', 'bar', 'colors', 'legend']
  },
  {
    id: 'range',
    icon: 'clock',
    accent: 'amber',
    practice: true,
    demo: { range: '30D' },
    steps: ['ranges', 'whatChanges', 'reset']
  },
  {
    id: 'move',
    icon: 'next',
    accent: 'violet',
    practice: true,
    demo: { zoomed: false },
    steps: ['drag', 'pinch', 'doubleTap', 'fit']
  },
  {
    id: 'type',
    icon: 'layers',
    accent: 'mint',
    practice: true,
    demo: { chartType: 'line' },
    steps: ['candles', 'line', 'area', 'which']
  },
  {
    id: 'avg',
    icon: 'activity',
    accent: 'cyan',
    practice: true,
    demo: { overlays: { ma: { 7: true, 25: true } } },
    steps: ['why', 'sma', 'ema', 'cross', 'labels']
  },
  {
    id: 'bands',
    icon: 'gauge',
    accent: 'amber',
    practice: true,
    demo: { overlays: { bb: true } },
    steps: ['what', 'squeeze', 'caution']
  },
  {
    id: 'panes',
    icon: 'layers',
    accent: 'violet',
    practice: true,
    demo: { panes: { volume: true, rsi: true }, overlays: {} },
    steps: ['volume', 'rsi', 'macd']
  },
  {
    id: 'levels',
    icon: 'target',
    accent: 'rose',
    practice: true,
    demo: { overlays: { fib: true }, showPriceLine: true },
    steps: ['priceLine', 'measure', 'fib', 'fibRead']
  },
  {
    id: 'scale',
    icon: 'scale',
    accent: 'mint',
    practice: true,
    demo: { settings: { log: true, grid: true } },
    steps: ['log', 'when', 'grid']
  },
  {
    id: 'capture',
    icon: 'film',
    accent: 'amber',
    practice: false,
    demo: {},
    steps: ['png', 'fit']
  },
  {
    id: 'forecast',
    icon: 'robot',
    accent: 'violet',
    practice: false,
    /* No demo patch: the forecast chip is the one control this screen does NOT
       reproduce. Running a real projection costs a CPU model and a network
       round-trip, and a fake one would teach a reader that the dashed line is
       decoration. The chapter explains where the button is and what it does;
       the reader presses it on the token page, where the provider name is
       printed. */
    demo: {},
    steps: ['what', 'horizon', 'limits', 'notAdvice']
  }
];

/** Tab-rail segments. Two chapters per tab keeps the rail four taps wide. */
export const TAB_GROUPS = [
  { id: 'basics', chapters: ['read', 'range', 'move', 'type'] },
  { id: 'studies', chapters: ['avg', 'bands', 'panes'] },
  { id: 'levels', chapters: ['levels', 'scale'] },
  { id: 'extras', chapters: ['capture', 'forecast'] }
];

export const CHAPTER_BY_ID = Object.fromEntries(CHAPTERS.map((c) => [c.id, c]));

/** Default live-demo state, so every chapter starts from the same chart. */
export const DEMO_DEFAULT = {
  chartType: 'candles',
  range: '30D',
  overlays: {},
  panes: { volume: true },
  settings: { log: false, grid: true },
  showPriceLine: true,
  zoomed: false
};

/**
 * Merge a chapter's `demo` into the default, one level deep for the nested
 * objects that actually get merged (`overlays`, `panes`, `settings`).
 *
 * A deep merge is needed because a chapter that turns ON `ma.7` must not turn
 * OFF `bb` inherited from the default — but a chapter that explicitly passes
 * `overlays: {}` DOES mean "no overlays", so the default only fills keys the
 * chapter did not mention at all. That distinction is the whole function.
 */
export function demoFor(chapter) {
  const patch = chapter?.demo ?? {};
  const merged = { ...DEMO_DEFAULT, ...patch };
  for (const key of ['overlays', 'panes', 'settings']) {
    if (!(key in patch)) {
      merged[key] = { ...DEMO_DEFAULT[key] };
    } else {
      merged[key] = { ...DEMO_DEFAULT[key], ...patch[key] };
    }
  }
  return merged;
}
