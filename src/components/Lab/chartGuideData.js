/**
 * CHART GUIDE v3 — THE TOOL REGISTRY FOR «راهنمای نمودار».
 *
 * ─── WHY THIS FILE WAS REWRITTEN ────────────────────────────────────────────
 * v2 organised the screen as four tabs × two-to-four chapters, which meant the
 * reader had to choose a tab, then a chapter, before a chart did anything. The
 * report on that screen was blunt: «تب‌ها و زیر تب‌ها خیلی شسته‌رفته نیست،
 * دکمه‌ها کار نمیده، چندتا نمودار داره». Three separate faults, one cause —
 * the page taught *categories* (basics / studies / levels / extras) while the
 * question in a reader's head is always about a *button*: "this MA7 chip, what
 * does it do?"
 *
 * So a tool is now the unit. One chart, one rail of tools, and pressing a tool
 * does exactly three things, always in the same order:
 *
 *   1. it draws that tool ON the single chart (no second canvas anywhere),
 *   2. it opens the explanation card for that tool, and
 *   3. it tells the AI teacher what the reader is looking at.
 *
 * ─── WHAT A TOOL DESCRIBES ─────────────────────────────────────────────────
 * Every tool carries the SAME five answers, because those are the five things
 * a beginner actually asks and the five the v2 steps never lined up in one
 * place:
 *
 *   what   · what the thing is
 *   profit · the specific moment it argues FOR a move (the profit side)
 *   loss   · the specific moment it is wrong / argues AGAINST (the loss side)
 *   time   · whether it speaks about the PAST (facts) or the FUTURE (a guess)
 *   where  · which button on the real token page it corresponds to
 *
 * The prose lives in i18n under `lab2.cgx.tools.<id>.*`. This file only holds
 * the things i18n cannot: the icon, the accent, the range the tool is easiest
 * to see on, and the chart preset.
 *
 * ─── WHAT IS *NOT* HERE ANY MORE ───────────────────────────────────────────
 * No chapters, no tabs, no step lists. A tool with five answers IS the lesson;
 * adding a second navigational axis on top of it is what made the old screen
 * feel like a manual stapled to a chart.
 */

/**
 * The tools, in the order they appear on the rail. The order is a teaching
 * order, not an alphabetical one: a candle first (you cannot read a chart you
 * cannot decode), then the two "big picture" tools, then oscillators, then the
 * two tools that make money and risk VISIBLE (Fibonacci, P&L), then the two
 * abstract ones (log scale, the future).
 *
 * `range` is the window on which the tool's lesson is clearest. It is a
 * DEFAULT, not a constraint: the reader's own range chip still wins, and
 * pressing a tool never yanks the timeframe back if they already chose one.
 * (`stateFor` below is careful about exactly that.)
 */
export const TOOLS = [
  { id: 'candle', icon: 'candles', accent: '#22d3ee', range: '30D', chartType: 'candles' },
  { id: 'trend', icon: 'trend', accent: '#34d399', range: '90D', chartType: 'candles' },
  { id: 'ema', icon: 'wave', accent: '#60a5fa', range: '90D', chartType: 'candles' },
  { id: 'band', icon: 'bands', accent: '#a78bfa', range: '30D', chartType: 'candles' },
  { id: 'rsi', icon: 'gauge', accent: '#f472b6', range: '30D', chartType: 'candles' },
  { id: 'volume', icon: 'bars', accent: '#fbbf24', range: '30D', chartType: 'candles' },
  { id: 'fib', icon: 'target', accent: '#fb923c', range: '90D', chartType: 'candles' },
  { id: 'pnl', icon: 'shield', accent: '#4ade80', range: '30D', chartType: 'candles' },
  { id: 'log', icon: 'ruler', accent: '#94a3b8', range: '90D', chartType: 'line' },
  { id: 'future', icon: 'sparkles', accent: '#c084fc', range: '90D', chartType: 'candles' }
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

/** The tool the screen opens on. */
export const DEFAULT_TOOL = 'candle';

/** Timeframes, in the order the real terminal shows them. */
export const RANGES = ['1D', '7D', '30D', '90D', '1Y'];

/** Chart renderings, in the order the real terminal shows them. */
export const CHART_TYPES = ['candles', 'line', 'area'];

/**
 * How long one candle lasts on each range. Shared with `GuideChart` so the
 * facts the teacher quotes and the candles the reader sees are the same series.
 * The COUNT of bars a range shows lives in the chart (`RANGE_BARS`), because it
 * is a drawing decision, not a curriculum one.
 */
export const RANGE_SPEC = {
  '1D': { hours: 1, bars: 24 },
  '7D': { hours: 4, bars: 42 },
  '30D': { hours: 12, bars: 60 },
  '90D': { hours: 24, bars: 90 },
  '1Y': { hours: 24 * 7, bars: 52 }
};

/** The state the screen starts in. */
export const DEFAULT_STATE = {
  tool: DEFAULT_TOOL,
  range: TOOL_BY_ID[DEFAULT_TOOL].range,
  chartType: TOOL_BY_ID[DEFAULT_TOOL].chartType,
  grid: true,
  zoom: 0,
  /* Two "the reader has spoken" flags. Without them there is no way to tell a
     range the reader chose from a range the previous tool imposed, and the
     tool presets either never apply or always override the reader. */
  rangePinned: false,
  chartTypePinned: false
};

/**
 * Apply a tool to the current state.
 *
 * ─── THE ONE RULE THAT MATTERS ─────────────────────────────────────────────
 * A tool's `range` and `chartType` are DEFAULTS FOR THE FIRST TIME IT IS
 * OPENED, not orders. If the reader has already picked a range, pressing
 * «RSI» must not silently move them from 1Y back to 30D — that would make the
 * range chips feel like they do not stick, which is the same class of defect
 * as a dead button. So `stateFor` only fills in a range/type the state has not
 * got yet, and `applyTool` (the explicit "show me this tool" path, used by the
 * teacher's actions) is the one that resets.
 */
export function stateFor(toolId, prev = {}) {
  const tool = TOOL_BY_ID[toolId] ?? TOOL_BY_ID[DEFAULT_TOOL];
  const keepRange = prev.rangePinned === true && RANGES.includes(prev.range);
  const keepType = prev.chartTypePinned === true && CHART_TYPES.includes(prev.chartType);
  return {
    ...DEFAULT_STATE,
    ...prev,
    tool: tool.id,
    range: keepRange ? prev.range : tool.range,
    chartType: keepType ? prev.chartType : tool.chartType,
    zoom: 0
  };
}

/** "Show me this tool" — the teacher's action, which DOES apply its preset. */
export function applyTool(toolId, prev = {}) {
  const tool = TOOL_BY_ID[toolId] ?? TOOL_BY_ID[DEFAULT_TOOL];
  return {
    ...DEFAULT_STATE,
    ...prev,
    tool: tool.id,
    range: tool.range,
    chartType: tool.chartType,
    zoom: 0
  };
}

/** Every tool id — exported so a test can walk the rail instead of listing it. */
export const TOOL_IDS = TOOLS.map((t) => t.id);
