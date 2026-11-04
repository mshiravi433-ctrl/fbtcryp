// @vitest-environment jsdom
/**
 * THE CHART GUIDE v3 — one chart, working buttons, a teacher that answers.
 * ═══════════════════════════════════════════════════════════════════════════
 * The screen was rebuilt after a user report that is worth quoting, because
 * every test below maps to one clause of it:
 *
 *   «خیلی زشته · دکمه‌ها کار نمیده · زیر تب‌ها خیلی زشته · چندتا نمودار داره ·
 *    یک نمودار باشه · هر دکمه را زدی هم داخل نمودار نشان بده هم بگه چیه ·
 *    معلم هوش مصنوعی هم باشد»
 *
 * The five things that can silently regress, and the guard for each:
 *
 *   1. MORE THAN ONE CHART. `document.querySelectorAll('[data-testid=
 *      "guide-chart"]')` must be 1 — a second canvas is the exact defect.
 *   2. A DEAD BUTTON. Every tool, range, type and view control is pressed and
 *      the rendered SVG must change. `outerHTML` is the fingerprint: it
 *      catches a colour, a line, a pane, anything the reader would see.
 *   3. A BUTTON THAT DRAWS BUT DOES NOT EXPLAIN. Pressing a tool must also put
 *      that tool's own lesson keys on screen. Drawing alone is a demo, not a
 *      lesson.
 *   4. A TEACHER THAT DOES NOT LISTEN. Each quick prompt and a typed question
 *      must produce a new teacher message; asking for a call must NOT produce
 *      one (it must redirect to risk); naming another tool must offer a jump
 *      that really moves the chart.
 *   5. A LOCALE GAP. i18next falls back to English silently, so a missing
 *      Persian key reads as an English paragraph mid-lesson. Every key the
 *      screen can ask for is derived from the tool registry, not hand-listed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* The stub resolves the committed locale JSON (fa, then en) instead of echoing
   keys, so the assertions below are about the sentence a reader sees — see
   `helpers/i18n-stub.js` for why that distinction is the whole point. */
vi.mock('react-i18next', () => import('./helpers/i18n-stub.js'));

vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: () => {} })
}));

import ChartGuide from '../src/components/Lab/ChartGuide';
import GuideChart, { guideSnapshot, makeWalk, aggregate } from '../src/components/Lab/GuideChart';
import {
  CHART_TYPES,
  DEFAULT_STATE,
  RANGES,
  TOOL_BY_ID,
  TOOLS,
  applyTool,
  stateFor
} from '../src/components/Lab/chartGuideData';
import { ask, classifyIntent, detectTool } from '../src/components/Lab/chartGuideTeacher';
import { buildLocaleTree, keyFromPath } from './helpers/locale-walk.js';
import { setLang, t } from './helpers/i18n-stub.js';
import { useSettingsStore } from '../src/store/useSettingsStore';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

beforeEach(() => {
  localStorage.clear();
  setLang('fa');
  /* Reduced motion makes the teacher's line render in full immediately. Without
     it the last bubble is mid-typewriter and "did the answer change?" compares
     two identical prefixes — a flaky assertion that measures rAF, not the app. */
  useSettingsStore.setState({ reduceMotion: true });
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · THE TOOL REGISTRY
   ══════════════════════════════════════════════════════════════════════════ */

describe('chart guide · the tool registry', () => {
  it('gives every tool a unique id, an icon, an accent and a valid default range', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of TOOLS) {
      expect(tool.icon, `${tool.id} needs an icon`).toBeTruthy();
      expect(tool.accent, `${tool.id} needs an accent`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(RANGES).toContain(tool.range);
      expect(CHART_TYPES).toContain(tool.chartType);
    }
    for (const id of ids) expect(TOOL_BY_ID[id]).toBeTruthy();
  });

  it('opens on a tool that exists', () => {
    expect(TOOL_BY_ID[DEFAULT_STATE.tool]).toBeTruthy();
    expect(RANGES).toContain(DEFAULT_STATE.range);
  });

  it('skills the range chips: pressing a tool does NOT undo the reader’s range', () => {
    /* This is a real defect class, not pedantry: v2 reset the reader's window
       every time a chapter opened, which made the range chips feel broken. */
    const chosen = stateFor('candle', { range: '1Y', rangePinned: true });
    expect(chosen.range).toBe('1Y');
    const switched = stateFor('band', chosen);
    expect(switched.range).toBe('1Y');
    expect(switched.tool).toBe('band');

    /* …and an UNPINNED range is the previous tool's preset, so a tool can still
       open on the window where its lesson is clearest. */
    const unpinned = stateFor('future', { range: '1D' });
    expect(unpinned.range).toBe(TOOL_BY_ID.future.range);
  });

  it('applyTool is the explicit path and DOES apply the preset', () => {
    const applied = applyTool('future', { range: '1D', chartType: 'line', grid: false });
    expect(applied.tool).toBe('future');
    expect(applied.range).toBe(TOOL_BY_ID.future.range);
    expect(applied.chartType).toBe(TOOL_BY_ID.future.chartType);
    /* Grid is the reader's preference, not part of a tool preset. */
    expect(applied.grid).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · THE PRACTICE SERIES
   ══════════════════════════════════════════════════════════════════════════ */

describe('chart guide · the practice series', () => {
  it('is deterministic — two calls draw the same history', () => {
    const a = makeWalk({ bars: 120 });
    const b = makeWalk({ bars: 120 });
    expect(a).toEqual(b);
    expect(a.length).toBe(120);
  });

  it('aggregates OHLC and sums volume', () => {
    const bars = makeWalk({ bars: 8 });
    const out = aggregate(bars, 4);
    expect(out).toHaveLength(2);
    expect(out[0].open).toBeCloseTo(bars[0].open, 2);
    expect(out[0].close).toBeCloseTo(bars[3].close, 2);
    expect(out[0].high).toBe(Math.max(...bars.slice(0, 4).map((d) => d.high)));
    expect(out[0].low).toBe(Math.min(...bars.slice(0, 4).map((d) => d.low)));
    expect(out[0].volume).toBe(bars.slice(0, 4).reduce((n, d) => n + d.volume, 0));
  });

  it('produces a finite snapshot for every range the chips offer', () => {
    for (const range of RANGES) {
      const snap = guideSnapshot(range);
      for (const [key, value] of Object.entries(snap)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${range}.${key} = ${value}`).toBe(true);
        }
      }
      expect(snap.bars).toBeGreaterThan(10);
      expect(snap.rr).toBeGreaterThan(0);
      expect(snap.stop).toBeLessThan(snap.entry);
      expect(snap.target).toBeGreaterThan(snap.entry);
    }
  });

  it('gives every range a different window, so no two chips draw the same picture', () => {
    const seen = new Set();
    for (const range of RANGES) {
      const snap = guideSnapshot(range);
      seen.add(`${snap.bars}-${snap.price}-${snap.high}`);
    }
    expect(seen.size).toBe(RANGES.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · THE TEACHER'S REASONING (pure functions, no DOM)
   ══════════════════════════════════════════════════════════════════════════ */

describe('chart guide · the teacher engine', () => {
  /* `t` is the same resolver the components use: these assertions are about
     the Persian sentence a reader gets, not a placeholder the test supplied. */

  it('classifies money questions before definitions', () => {
    expect(classifyIntent('کِی سود میده؟')).toBe('profit');
    expect(classifyIntent('کجا ضرر میکنم')).toBe('loss');
    expect(classifyIntent('آینده رو نشون میده؟')).toBe('time');
    expect(classifyIntent('چطور استفاده کنم')).toBe('how');
    expect(classifyIntent('این چیه؟')).toBe('what');
    expect(classifyIntent('')).toBe('what');
  });

  it('hears a tool name inside a question, in Persian and in shorthand', () => {
    expect(detectTool('RSI چیه؟', t)).toBe('rsi');
    expect(detectTool('bollinger bands', t)).toBe('band');
    expect(detectTool('حجم رو توضیح بده', t)).toBe('volume');
    expect(detectTool('یه سوال کلی', t)).toBe(null);
  });

  it('refuses to give a buy/sell call and offers the risk tool instead', () => {
    const reply = ask('بخرم یا نه؟', { toolId: 'candle', live: guideSnapshot('30D') }, t);
    expect(reply.intent).toBe('signal');
    expect(reply.action?.tool).toBe('pnl');
    expect(reply.text).toContain('سیگنال');
    /* No imperative buy/sell instruction in the refusal. */
    expect(reply.text).not.toMatch(/(?<!نمی)‌?بخر|بفروش(?!م)/);
  });

  it('answers about a named tool and offers to draw it', () => {
    const reply = ask('RSI چیه؟', { toolId: 'candle', live: guideSnapshot('30D') }, t);
    expect(reply.toolId).toBe('rsi');
    expect(reply.action?.tool).toBe('rsi');
    /* The definition of RSI, not the definition of the open candle lesson. */
    expect(reply.text).toContain('RSI');
    expect(reply.text).toContain('۱۴');
    expect(reply.text).not.toContain('سایهٔ بالا');
  });

  it('does not offer a jump to the tool already on the chart', () => {
    const reply = ask('این چیه؟', { toolId: 'rsi', live: guideSnapshot('30D') }, t);
    expect(reply.action).toBe(null);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · LOCALE COMPLETENESS
   ══════════════════════════════════════════════════════════════════════════ */

const FULL = ['en', 'fa'];
const GENERATED = ['zh', 'hi', 'es', 'fr', 'ru', 'tr', 'ur', 'id', 'pt'];

/** Every key the screen can ask for, derived from the registry. */
function guideKeys() {
  const keys = [
    'lab2.screens.chartGuide.title',
    'lab2.screens.chartGuide.sub',
    'lab2.cgx.heroTitle',
    'lab2.cgx.rail.title',
    'lab2.cgx.rail.hint',
    'lab2.cgx.toolbar.range',
    'lab2.cgx.toolbar.grid',
    'lab2.cgx.toolbar.zoomIn',
    'lab2.cgx.toolbar.fit',
    'lab2.cgx.noteTitle',
    'lab2.cgx.note',
    'lab2.cgx.backToLab',
    'lab2.cgx.badge.practice',
    'lab2.cgx.badge.oneChart',
    'lab2.cgx.badge.teacher',
    'lab2.cgx.lesson.what',
    'lab2.cgx.lesson.profit',
    'lab2.cgx.lesson.loss',
    'lab2.cgx.lesson.time',
    'lab2.cgx.lesson.shown',
    'lab2.cgx.teacher.name',
    'lab2.cgx.teacher.role',
    'lab2.cgx.teacher.onDevice',
    'lab2.cgx.teacher.onDeviceHint',
    'lab2.cgx.teacher.placeholder',
    'lab2.cgx.teacher.send',
    'lab2.cgx.teacher.showOnChart',
    'lab2.cgx.teacher.disclaimer',
    'lab2.cgx.teacher.live.generic',
    'lab2.cgx.chart.label',
    'lab2.cgx.chart.hint',
    'lab2.cgx.chart.pinned',
    'lab2.cgx.chart.now',
    'lab2.cgx.chart.past',
    'lab2.cgx.chart.future',
    'lab2.cgx.chart.futureNote',
    'lab2.cgx.chart.body',
    'lab2.cgx.chart.wickTop',
    'lab2.cgx.chart.wickBottom',
    'lab2.cgx.chart.goldenCross',
    'lab2.cgx.chart.deathCross',
    'lab2.cgx.chart.emaCross',
    'lab2.cgx.chart.squeeze',
    'lab2.cgx.chart.volumeSpike',
    'lab2.cgx.chart.overbought',
    'lab2.cgx.chart.oversold',
    'lab2.cgx.chart.fibZone',
    'lab2.cgx.chart.entry',
    'lab2.cgx.chart.stop',
    'lab2.cgx.chart.target',
    'lab2.cgx.chart.logNote'
  ];
  for (const f of ['price', 'change', 'range', 'gap', 'bandLow', 'bandHigh', 'width',
    'volume', 'volumeMax', 'low', 'high', 'fib', 'entry', 'stop', 'rr', 'atr', 'window']) {
    keys.push(`lab2.cgx.facts.${f}`);
  }
  for (const r of RANGES) keys.push(`lab2.cgx.range.${r}`);
  for (const ty of CHART_TYPES) keys.push(`lab2.cgx.types.${ty}`);
  for (const q of ['what', 'profit', 'loss', 'time', 'how']) keys.push(`lab2.cgx.teacher.quick.${q}`);
  for (const r of ['what', 'profit', 'loss', 'time', 'how', 'signal']) keys.push(`lab2.cgx.teacher.reply.${r}`);
  for (const tool of TOOLS) {
    for (const f of ['label', 'what', 'profit', 'loss', 'time', 'where', 'how']) {
      keys.push(`lab2.cgx.tools.${tool.id}.${f}`);
    }
    keys.push(`lab2.cgx.teacher.live.${tool.id}`);
  }
  return keys;
}

const KEYS = guideKeys();

for (const lang of FULL) {
  describe(`chart guide · ${lang} locale carries every key`, () => {
    const tree = buildLocaleTree(read(`src/i18n/locales/${lang}.json`));

    it(`resolves all ${KEYS.length} keys the screen asks for`, () => {
      const missing = KEYS.filter((k) => {
        const v = keyFromPath(tree, k);
        return typeof v !== 'string' || v.trim() === '';
      });
      expect(missing, `missing in ${lang}.json: ${missing.join(', ')}`).toEqual([]);
    });

    it('explains profit AND loss for every single tool', () => {
      /* The user's requirement, asserted as data: a tool with a definition but
         no "where does it go wrong" is the thing that was wrong before. */
      const bare = TOOLS.filter((tool) => {
        for (const f of ['what', 'profit', 'loss', 'time']) {
          const v = keyFromPath(tree, `lab2.cgx.tools.${tool.id}.${f}`);
          if (typeof v !== 'string' || v.trim().length < 20) return true;
        }
        return false;
      }).map((tool) => tool.id);
      expect(bare).toEqual([]);
    });
  });
}

describe('chart guide · generated locales', () => {
  it('still come from the generator, not from a hand edit', () => {
    const gen = read('scripts/gen-locales.mjs');
    expect(gen.includes("from './locales/chart-guide.mjs'")).toBe(true);
    expect(gen.includes('...CHART_GUIDE')).toBe(true);
  });

  it('carry the v3 subtitle in every generated language', () => {
    for (const lang of GENERATED) {
      const tree = buildLocaleTree(read(`src/i18n/locales/${lang}.json`));
      const sub = keyFromPath(tree, 'lab2.screens.chartGuide.sub');
      expect(typeof sub, `${lang} subtitle`).toBe('string');
      expect(sub.length).toBeGreaterThan(20);
    }
  });

  it('fall back to English for v3 keys rather than showing a raw key', () => {
    /* The contract the i18n module documents: an untranslated string appears in
       English, never as `lab2.cgx.tool.candle.what`. English is the fallback
       bundle and is loaded synchronously, and it is asserted complete above. */
    const i18n = read('src/i18n/index.js');
    expect(i18n).toContain('fallbackLng');
    const en = buildLocaleTree(read('src/i18n/locales/en.json'));
    expect(keyFromPath(en, 'lab2.cgx.tools.candle.what')).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 · THE SCREEN
   ══════════════════════════════════════════════════════════════════════════ */

async function mount() {
  const view = render(
    <MemoryRouter initialEntries={['/lab/chart-guide']}>
      <ChartGuide />
    </MemoryRouter>
  );
  await new Promise((r) => setTimeout(r, 60));
  return view;
}

const chartSvg = (container) => container.querySelector('[data-testid="guide-chart"] svg');

describe('chart guide · the screen', () => {
  it('renders its own header with a way back', async () => {
    const { container, unmount } = await mount();
    const head = container.querySelector('.lab2-screen-head');
    expect(head, 'screen header missing').toBeTruthy();
    expect(head.querySelector('.lab2-screen-title').textContent).toBe(t('lab2.screens.chartGuide.title'));
    expect(head.querySelector('.lab2-back'), 'no way out of the screen').toBeTruthy();
    unmount();
  });

  it('labels the series as practice data before any chart pixels', async () => {
    const { container, unmount } = await mount();
    const banner = container.querySelector('[data-testid="chart-guide-sample"]');
    expect(banner, 'the honesty banner must exist').toBeTruthy();
    expect(banner.textContent).toContain(t('lab2.cgx.badge.practice'));
    unmount();
  });

  it('renders EXACTLY ONE chart — the «چندتا نمودار» regression', async () => {
    const { container, unmount } = await mount();
    expect(container.querySelectorAll('[data-testid="guide-chart"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="guide-chart"] svg')).toHaveLength(1);
    /* No other SVG in the page draws a price series. */
    expect(container.querySelectorAll('svg.cgc-svg')).toHaveLength(1);
    unmount();
  });

  it('draws real geometry synchronously, with no engine to wait for', async () => {
    const { container, unmount } = await mount();
    const chart = container.querySelector('[data-testid="guide-chart"]');
    expect(chart.querySelectorAll('.cgc-candle').length, 'candles').toBeGreaterThan(10);
    expect(chart.querySelectorAll('.cgc-axis').length, 'axis labels').toBeGreaterThan(1);
    unmount();
  });

  it('gives every TOOL a visible effect on the chart AND its own explanation', async () => {
    const { container, unmount } = await mount();
    for (const tool of TOOLS) {
      const button = container.querySelector(`[data-testid="cgx-tool-${tool.id}"]`);
      expect(button, `tool ${tool.id} missing from the rail`).toBeTruthy();

      /* The first tool is already open; pressing it again legitimately changes
         nothing, so move away before measuring the change it causes. */
      if (button.getAttribute('aria-selected') === 'true') {
        fireEvent.click(container.querySelector('[data-testid="cgx-tool-future"]'));
        await new Promise((r) => setTimeout(r, 20));
      }

      const before = chartSvg(container).outerHTML;
      fireEvent.click(button);
      await new Promise((r) => setTimeout(r, 20));

      const chart = container.querySelector('[data-testid="guide-chart"]');
      expect(chart.getAttribute('data-tool'), `${tool.id} did not reach the chart`).toBe(tool.id);
      expect(chartSvg(container).outerHTML, `${tool.id} drew nothing new`).not.toBe(before);

      /* …and the card under it is that tool's, not the previous one. */
      const lesson = container.querySelector('[data-testid="cgx-lesson"]');
      for (const field of ['what', 'profit', 'loss', 'time']) {
        const sentence = t(`lab2.cgx.tools.${tool.id}.${field}`);
        expect(lesson.textContent, `${tool.id}.${field} missing from its card`).toContain(sentence.slice(0, 28));
      }

      /* Selected state is real, and exactly one tool owns it. */
      const selected = [...container.querySelectorAll('[role="tab"]')]
        .filter((el) => el.getAttribute('aria-selected') === 'true');
      expect(selected).toHaveLength(1);
      expect(selected[0].getAttribute('data-testid')).toBe(`cgx-tool-${tool.id}`);
    }
    unmount();
  });

  it('gives every RANGE chip a different window — no two paint the same picture', async () => {
    const { container, unmount } = await mount();
    const seen = new Set();
    for (const range of RANGES) {
      const before = chartSvg(container).outerHTML;
      fireEvent.click(container.querySelector(`[data-testid="cgx-range-${range}"]`));
      await new Promise((r) => setTimeout(r, 10));
      const after = chartSvg(container).outerHTML;
      expect(after, `${range} changed nothing`).not.toBe(before);
      seen.add(after);
    }
    expect(seen.size).toBe(RANGES.length);
    unmount();
  });

  it('gives the type, grid and zoom controls a visible effect', async () => {
    const { container, unmount } = await mount();
    for (const type of CHART_TYPES) {
      const button = container.querySelector(`[data-testid="cgx-type-${type}"]`);
      if (button.getAttribute('aria-pressed') === 'true') continue;
      const before = chartSvg(container).outerHTML;
      fireEvent.click(button);
      await new Promise((r) => setTimeout(r, 10));
      expect(chartSvg(container).outerHTML, `type ${type} did nothing`).not.toBe(before);
    }
    for (const id of ['cgx-grid', 'cgx-zoom', 'cgx-fit']) {
      const before = chartSvg(container).outerHTML;
      fireEvent.click(container.querySelector(`[data-testid="${id}"]`));
      await new Promise((r) => setTimeout(r, 10));
      expect(chartSvg(container).outerHTML, `${id} did nothing`).not.toBe(before);
    }
    unmount();
  });

  it('never renders NaN, however it is navigated', async () => {
    const { container, unmount } = await mount();
    for (const tool of TOOLS) {
      fireEvent.click(container.querySelector(`[data-testid="cgx-tool-${tool.id}"]`));
      await new Promise((r) => setTimeout(r, 10));
      expect(container.innerHTML, `NaN in tool ${tool.id}`).not.toContain('NaN');
      expect(container.innerHTML, `Infinity in tool ${tool.id}`).not.toContain('Infinity');
    }
    for (const range of RANGES) {
      fireEvent.click(container.querySelector(`[data-testid="cgx-range-${range}"]`));
      await new Promise((r) => setTimeout(r, 10));
      expect(container.innerHTML, `NaN in range ${range}`).not.toContain('NaN');
    }
    unmount();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6 · THE AI TEACHER, THROUGH THE PANEL
   ══════════════════════════════════════════════════════════════════════════ */

describe('chart guide · the AI teacher', () => {
  const teacherMessages = (container) => container.querySelectorAll('[data-testid="cgx-teacher-log"] .cgx-msg');

  it('greets the reader with a live line when the screen opens', async () => {
    const { container, unmount } = await mount();
    expect(container.querySelector('[data-testid="cgx-teacher"]')).toBeTruthy();
    expect(teacherMessages(container).length).toBeGreaterThan(0);
    unmount();
  });

  it('re-briefs when the tool changes — it is watching what the reader opens', async () => {
    const { container, unmount } = await mount();
    const before = teacherMessages(container).length;
    fireEvent.click(container.querySelector('[data-testid="cgx-tool-rsi"]'));
    await new Promise((r) => setTimeout(r, 20));
    expect(teacherMessages(container).length).toBeGreaterThan(before);
    unmount();
  });

  it('answers every quick prompt', async () => {
    const { container, unmount } = await mount();
    /* The log is capped at eight bubbles on purpose, so "the count went up" is
       the wrong assertion once the cap is reached. What must hold is that the
       last two bubbles are the reader's question and a NEW teacher answer. */
    const teacherText = () => {
      const msgs = [...teacherMessages(container)];
      return msgs[msgs.length - 1]?.textContent ?? '';
    };
    for (const id of ['what', 'profit', 'loss', 'time', 'how']) {
      const button = container.querySelector(`[data-testid="cgx-quick-${id}"]`);
      expect(button, `quick prompt ${id} missing`).toBeTruthy();
      const before = teacherText();
      fireEvent.click(button);
      await new Promise((r) => setTimeout(r, 20));

      const msgs = [...teacherMessages(container)];
      expect(msgs[msgs.length - 2].classList.contains('is-reader'), `quick ${id}: no question bubble`).toBe(true);
      expect(msgs[msgs.length - 1].classList.contains('is-teacher'), `quick ${id}: no answer`).toBe(true);
      expect(teacherText(), `quick ${id} produced the same answer`).not.toBe(before);
    }
    unmount();
  });

  it('answers a typed question', async () => {
    const { container, unmount } = await mount();
    const before = teacherMessages(container).length;
    const input = container.querySelector('[data-testid="cgx-teacher-input"]');
    fireEvent.change(input, { target: { value: 'RSI چیه؟' } });
    fireEvent.submit(input.closest('form'));
    await new Promise((r) => setTimeout(r, 20));
    expect(teacherMessages(container).length).toBeGreaterThanOrEqual(before + 2);
    /* And the answer is about RSI, not about the open candle lesson. */
    const log = container.querySelector('[data-testid="cgx-teacher-log"]');
    expect(log.textContent.toLowerCase()).toContain('rsi');
    unmount();
  });

  it('does not send an empty question', async () => {
    const { container, unmount } = await mount();
    const before = teacherMessages(container).length;
    fireEvent.submit(container.querySelector('[data-testid="cgx-teacher-input"]').closest('form'));
    await new Promise((r) => setTimeout(r, 20));
    expect(teacherMessages(container).length).toBe(before);
    unmount();
  });

  it('puts its answer on the chart when the reader asks for a jump', async () => {
    const { container, unmount } = await mount();
    const input = container.querySelector('[data-testid="cgx-teacher-input"]');
    fireEvent.change(input, { target: { value: 'دربارهٔ RSI بگو' } });
    fireEvent.submit(input.closest('form'));
    await new Promise((r) => setTimeout(r, 20));

    const action = container.querySelector('[data-testid="cgx-teacher-action-rsi"]');
    expect(action, 'the teacher must offer to draw what it described').toBeTruthy();
    fireEvent.click(action);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-testid="guide-chart"]').getAttribute('data-tool')).toBe('rsi');
    unmount();
  });

  it('redirects a request for a trading call to the risk tool', async () => {
    const { container, unmount } = await mount();
    const input = container.querySelector('[data-testid="cgx-teacher-input"]');
    fireEvent.change(input, { target: { value: 'بخرم یا نه؟' } });
    fireEvent.submit(input.closest('form'));
    await new Promise((r) => setTimeout(r, 20));

    const action = container.querySelector('[data-testid="cgx-teacher-action-pnl"]');
    expect(action, 'a buy question must land on the P&L geometry').toBeTruthy();
    fireEvent.click(action);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-testid="guide-chart"]').getAttribute('data-tool')).toBe('pnl');
    unmount();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7 · THE DOORWAY INTO THE GUIDE
   ══════════════════════════════════════════════════════════════════════════ */

it('the Advanced tab links to the guide above the cards', async () => {
  const { default: AdvancedGroup } = await import('../src/components/Lab/AdvancedGroup');
  const { container, unmount } = render(
    <MemoryRouter initialEntries={['/lab?tab=advanced']}>
      <AdvancedGroup activeChild={null} onSelectChild={() => {}} />
    </MemoryRouter>
  );
  const door = container.querySelector('[data-testid="lab-advanced-guide-door"]');
  expect(door, 'the doorway box must be on the Advanced tab').toBeTruthy();
  const link = container.querySelector('[data-testid="lab-advanced-guide-door-cta"]');
  expect(link.getAttribute('href')).toBe('/lab/chart-guide');
  expect(link.tagName).toBe('A');

  const kids = [...container.querySelector('.lab2-group').children];
  expect(kids.indexOf(door)).toBeLessThan(kids.findIndex((el) => el.classList.contains('lab2-grid')));
  screen.getByText(t('lab2.advancedGuide.title'));
  unmount();
});
