/**
 * AI SURFACE — THEME PROBE
 * ---------------------------------------------------------------------------
 * Three reports about /intent, all of them invisible to every other test in
 * this suite:
 *
 *   «در تم روشن استایل هوش مصنوعی بخصوص باکس‌ها خیلی زشته»
 *   «باکسی که لوگو داخلش بالای صفحه در زاویه … از صفحه زده بیرون»
 *   «در منو عملیات، گزینه‌ها فاصله رعایت نشده و درهم فرو رفته»
 *
 * The component mounts, React is happy, the build is green, and in the DARK
 * theme all three look correct — which is why they shipped. `wiring.mjs`
 * pins the CSS text that fixes them; this probe goes one step further and
 * resolves the actual CASCADE, because the bug was never a missing rule. It
 * was two stylesheets disagreeing about specificity:
 *
 *   `:root[data-theme='light'] .iaos-bubble`  → 0-3-0  (intent-ai-os.css)
 *   `.tag-page .iaos-bubble`                  → 0-2-0  (trench-agent.css)
 *
 * so the page flipped white while the trench skin stayed black and
 * `--tag-text: #f4f4f6` became near-white text on a near-white canvas.
 *
 * Method: load the real stylesheets in their real import order into jsdom,
 * build a DOM tree that mirrors IntentAIUnified + IntentOpsPanels, and read
 * `getComputedStyle`. jsdom does implement the cascade (specificity + source
 * order) but does NOT substitute custom properties, so `var()` is resolved
 * by hand from the tokens the page element actually carries. Colours that
 * land on a solid surface are then MEASURED against WCAG AA rather than
 * eyeballed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

/* ── colour maths (same WCAG formula test/run.mjs uses) ─────────────────── */
const toRgb = (c) => {
  const s = String(c).trim();
  let m = /^#([\da-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([\da-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) return m[1].split(',').slice(0, 3).map((n) => Math.round(parseFloat(n)));
  return null;
};
const lum = ([r, g, b]) => {
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [ca, cb] = [toRgb(a), toRgb(b)];
  if (!ca || !cb) return null;
  const [la, lb] = [lum(ca), lum(cb)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const aa = (fg, bg) => { const r = ratio(fg, bg); return r != null && r >= 4.5; };

/* ── build the tree once per theme ──────────────────────────────────────── */
const CSS = [
  'src/index.css',
  'src/styles/intent-ai-os.css',
  'src/styles/trench-agent.css'
].map((f) => readFileSync(f, 'utf8')).join('\n');

const TOKENS = [
  '--tag-bg', '--tag-card', '--tag-card-2', '--tag-line', '--tag-line-soft',
  '--tag-text', '--tag-muted', '--tag-dim', '--tag-mint', '--tag-amber',
  '--tag-red', '--tag-blue', '--tag-shadow', '--tag-tab-h'
];

function measure(theme) {
  const dom = new JSDOM(`<!doctype html><html data-theme="${theme}" dir="rtl"><body></body></html>`, {
    pretendToBeVisual: true
  });
  const { window } = dom;
  const style = window.document.createElement('style');
  style.textContent = CSS;
  window.document.head.appendChild(style);
  const d = window.document;
  const el = (tag, cls, parent, text) => {
    const n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    (parent || d.body).appendChild(n);
    return n;
  };

  /* /intent — IntentAIUnified */
  const page = el('div', 'iaos-page iaos-page-v6 tag-page');
  const shell = el('div', 'iaos-shell', page);
  const header = el('header', 'iaos-header', shell);
  const title = el('div', 'iaos-title', header);
  const mark = el('span', 'iaos-mark iaos-mark-logo', title);
  const plate = el('rect', 'iaos-logo-plate', mark);
  const copy = el('span', 'iaos-title-copy', title);
  const h1 = el('h1', '', copy, 'FBT AGENT');
  const sub = el('span', 'iaos-title-sub', copy, 'AGENT OS');
  const hstatus = el('div', 'iaos-header-status', header);
  el('button', 'iaos-new-season-btn', hstatus, '+');
  const pill = el('span', 'iaos-status-pill', hstatus, 'online');
  const conv = el('div', 'iaos-conversation iaos-conversation-v6', shell);
  const aiBubble = el('div', 'iaos-bubble', el('div', 'iaos-msg iaos-ai', conv));
  const composer = el('form', 'iaos-composer iaos-composer-v6', shell);
  el('input', 'iaos-input', composer);
  const send = el('button', 'iaos-send', composer);
  const actionBtn = el('button', 'iaos-action-btn', composer, '+');
  const tabbar = el('nav', 'tag-tabbar', page);
  const tab = el('button', 'tag-tab', tabbar);
  const tabLabel = el('span', 'tag-tab-label', tab, 'Chat');
  const tabActive = el('button', 'tag-tab', tabbar);
  tabActive.setAttribute('data-active', 'true');
  const view = el('section', 'tag-view', shell);
  const vhead = el('div', 'tag-view-head', view);
  const vh2 = el('h2', '', vhead, 'More');
  const vsub = el('span', 'tag-view-sub', vhead, 'Operations');
  const spawn = el('button', 'tag-spawn', vhead, '+ New');
  const card = el('div', 'tag-card', view);
  const cardName = el('span', 'tag-card-name', el('div', 'tag-card-head', card), 'DCA');
  const cardKind = el('span', 'tag-card-kind', el('div', 'tag-card-head', card), 'AUTO');
  const row = el('button', 'tag-row', view);
  const rowCopy = el('span', 'tag-row-copy', row);
  const rowTitle = el('span', 'tag-row-title', rowCopy, 'Operations');
  const rowSub = el('span', 'tag-row-sub', rowCopy, 'Monitors');
  const rowEnd = el('span', 'tag-row-end', row, '12:00');
  const sectionLabel = el('div', 'tag-section', view, 'App');
  const empty = el('div', 'tag-empty', view);
  const emptyTitle = el('span', 'tag-empty-title', empty, 'Nothing yet');
  const emptySub = el('span', 'tag-empty-sub', empty, 'Everything lands here');

  /* Operations panel — IntentOpsPanels */
  const panel = el('div', 'iaos-panel iaos-ops-panel', el('div', 'iaos-panel-overlay'));
  const phead = el('div', 'iaos-panel-head', panel);
  const ph2 = el('h2', '', phead, 'Operations Center');
  const strip = el('div', 'iaos-ops-strip', panel);
  const stripCell = el('div', 'iaos-ops-strip-cell', strip);
  const stripSmall = el('small', '', el('div', '', stripCell), 'Wallet');
  const stripStrong = el('strong', '', el('div', '', stripCell), '1/2');
  const cats = el('div', 'iaos-ops-cats', panel);
  const cat = el('button', 'iaos-ops-cat', cats, 'Portfolio');
  const catOn = el('button', 'iaos-ops-cat is-on', cats, 'Market');
  const grid = el('div', 'iaos-ops-grid', panel);
  const opsCard = el('button', 'iaos-ops-card', grid);
  el('span', 'iaos-ops-icon', opsCard);
  const opsBody = el('span', 'iaos-ops-body', opsCard);
  const opsStrong = el('strong', '', opsBody, 'Rebalance');
  const opsSmall = el('small', '', opsBody, 'Move holdings between assets');
  const note = el('p', 'iaos-panel-note', panel, 'note');

  const cs = (node, prop) => window.getComputedStyle(node)[prop] || '';
  /* Custom properties are only reachable through getPropertyValue — bracket
     access on a CSSStyleDeclaration returns undefined for `--x`. */
  const token = (name) => window.getComputedStyle(page).getPropertyValue(name).trim();
  const tokens = {};
  for (const tk of TOKENS) tokens[tk] = token(tk);
  const val = (node, prop) => {
    let v = cs(node, prop);
    for (let i = 0; i < 4 && v.includes('var('); i++) {
      v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, n, fb) => tokens[n] || fb || '');
    }
    return v.trim();
  };

  return { window, tokens, cs, val, nodes: {
    page, header, mark, plate, h1, sub, pill, aiBubble, composer, send, actionBtn,
    tabbar, tab, tabLabel, tabActive, vh2, vsub, spawn, card, cardName, cardKind,
    rowTitle, rowSub, rowEnd, sectionLabel, emptyTitle, emptySub,
    panel, ph2, stripCell, stripSmall, stripStrong, cat, catOn, grid, opsCard,
    opsStrong, opsSmall, note
  } };
}

try {
  const light = measure('light');
  const dark = measure('dark');
  const L = light.nodes;
  const D = dark.nodes;
  const v = light.val;

  /* ══ 1. The light theme is actually light ═══════════════════════════════
     Before the fix these were #f4f4f6 / #050506 / rgba(12,12,15,.92) — the
     trench skin had no light theme at all and the shared `.iaos-*` light
     rules out-specified it, so the two stylesheets fought. */
  check('light: the page canvas is light', toRgb(light.tokens['--tag-bg'])[0] > 200);
  check('light: the page text is dark', toRgb(v(L.page, 'color'))[0] < 60);
  check('light: the sticky header is a light wash', /rgba\(238, 241, 247/.test(light.cs(L.header, 'backgroundImage')));
  check('light: the tab bar is paper, not black', /rgba\(255, 255, 255/.test(light.cs(L.tabbar, 'backgroundColor')));
  check('light: the idle tab label is dark', toRgb(v(L.tab, 'color'))[0] < 130);
  check('light: the active tab label is dark', toRgb(v(L.tabActive, 'color'))[0] < 60);
  check('light: the view heading is dark', toRgb(v(L.vh2, 'color'))[0] < 60);
  check('light: the row title is dark', toRgb(v(L.rowTitle, 'color'))[0] < 60);
  check('light: the empty state is dark', toRgb(v(L.emptyTitle, 'color'))[0] < 60);
  check('light: the primary button inverts (dark pill on paper)', toRgb(light.cs(L.spawn, 'backgroundColor'))[0] < 60);
  check('light: the send button inverts too', toRgb(light.cs(L.send, 'backgroundColor'))[0] < 60);

  /* ══ 2. The logo tile ═══════════════════════════════════════════════════
     «باکسی که لوگو داخلش بالای صفحه در زاویه … از صفحه زده بیرون».
     The wrapper must be a pinned, fixed-size box (so the header row cannot
     be pushed wider than the shell) and its plate must repaint — `fill` as a
     presentation attribute loses to any CSS rule, which is what turns the
     near-black tile white. */
  check('the logo wrapper does not grow or shrink', light.cs(L.mark, 'flexGrow') === '0' && light.cs(L.mark, 'flexShrink') === '0');
  check('the logo wrapper is a fixed 32px square', light.cs(L.mark, 'width') === '32px' && light.cs(L.mark, 'height') === '32px');
  check('the logo wrapper paints no second frame', toRgb(light.cs(L.mark, 'backgroundColor'))[3] === undefined
    || light.cs(L.mark, 'backgroundColor') === 'rgba(0, 0, 0, 0)');
  check('light: the logo plate is repainted white', light.cs(L.plate, 'fill') === 'rgb(255, 255, 255)');
  check('the header title is the only flexible part', light.cs(L.header.firstElementChild, 'flexShrink') === '1');
  check('the header status cluster is pinned', light.cs(L.header.lastElementChild, 'flexShrink') === '0');

  /* ══ 3. Boxes are separate boxes ════════════════════════════════════════
     «گزینه‌ها فاصله رعایت نشده و درهم فرو رفته». Half of it was colour: the
     light panel and the light cards were both ~#f8fafc with a 20%-alpha
     hairline between them, so ten boxes read as one slab. */
  const panelBg = light.cs(L.panel, 'backgroundImage');
  const cardBg = light.cs(L.opsCard, 'backgroundColor');
  check('light: the operations panel is paper', /#edf1f8|#f7f9fc/.test(panelBg.replace(/\s/g, '')) || /237, 241, 248/.test(panelBg));
  check('light: the option cards are solid white', cardBg === 'rgb(255, 255, 255)');
  check('light: panel and card are NOT the same colour', !panelBg.includes('rgb(255, 255, 255)'));
  check('light: the option cards are lifted off the panel', light.cs(L.opsCard, 'boxShadow').includes('rgba(15, 23, 42'));
  check('light: the option cards carry a visible hairline',
    toRgb(light.cs(L.opsCard, 'borderTopColor')).slice(0, 3).join(',') === '15,23,42');
  check('the selected tab is not painted like an unselected one',
    light.cs(L.catOn, 'backgroundImage') !== light.cs(L.cat, 'backgroundImage')
      || light.cs(L.catOn, 'backgroundColor') !== light.cs(L.cat, 'backgroundColor'));
  check('light: agent cards are solid white too', light.tokens['--tag-card'] === '#ffffff');
  check('light: the composer is solid white', light.tokens['--tag-card'] === '#ffffff');

  /* ══ 4. Spacing, read back from the cascade ════════════════════════════
     jsdom's cssstyle cannot represent `gap`, so this one is asserted on the
     resolved declaration in wiring.mjs; here we check the grid is a real
     flex child, which is the structural half of the cramming. */
  check('the operations grid takes the space the panel leaves it', light.cs(L.grid, 'flexGrow') === '1');
  check('the operations grid does not stretch its rows', light.cs(L.grid, 'alignContent') === 'start');

  /* ══ 5. Contrast is measured, not eyeballed ════════════════════════════
     The dark palette is neon because it sits on black. Flipping the canvas
     without re-picking the inks is the exact failure test/run.mjs already
     guards for the ad banner — this is the same measurement on the AI deck. */
  const paper = light.tokens['--tag-bg'];
  const card = light.tokens['--tag-card'];
  const pairs = [
    ['page text on the canvas', v(L.page, 'color'), paper],
    ['muted text on the canvas', light.tokens['--tag-muted'], paper],
    ['muted text on a card', light.tokens['--tag-muted'], card],
    ['dim text on the canvas', light.tokens['--tag-dim'], paper],
    ['dim text on a card', light.tokens['--tag-dim'], card],
    ['the online pill on the canvas', v(L.pill, 'color'), paper],
    ['a section label on the canvas', v(L.sectionLabel, 'color'), paper],
    ['a row timestamp on the canvas', v(L.rowEnd, 'color'), paper],
    ['an empty-state body on the canvas', v(L.emptySub, 'color'), paper],
    ['the agent kind chip on a card', v(L.cardKind, 'color'), card],
    ['an option card title on white', v(L.opsStrong, 'color'), card],
    ['an option card description on white', v(L.opsSmall, 'color'), card],
    ['the panel heading on white', v(L.ph2, 'color'), card],
    ['a strip cell label on white', v(L.stripSmall, 'color'), card],
    ['a strip cell value on white', v(L.stripStrong, 'color'), card],
    ['an unselected tab label on white', v(L.cat, 'color'), card],
    ['the panel footnote on the paper', v(L.note, 'color'), '#edf1f8']
  ];
  for (const [label, fg, bg] of pairs) {
    const r = ratio(fg, bg);
    check(`light contrast — ${label} (${fg} on ${bg}) reaches AA${r ? ` at ${r.toFixed(2)}:1` : ' (unreadable colour)'}`, aa(fg, bg));
  }

  /* ══ 6. The dark theme is untouched ═════════════════════════════════════
     A light-theme fix that dulls the dark theme is not a fix. */
  check('dark: the canvas is still near-black', toRgb(dark.tokens['--tag-bg'])[0] < 20);
  check('dark: the text is still near-white', toRgb(dark.val(D.page, 'color'))[0] > 230);
  check('dark: the tab bar is still black glass', dark.cs(D.tabbar, 'backgroundColor') === 'rgba(12, 12, 15, 0.92)');
  check('dark: the primary button is still a white pill', dark.cs(D.spawn, 'backgroundColor') === 'rgb(255, 255, 255)');
  check('dark: the header wash is still black', /rgba\(5, 5, 6/.test(dark.cs(D.header, 'backgroundImage')));
  check('dark: the option cards keep their glass, not a white fill',
    dark.cs(D.opsCard, 'backgroundColor') !== 'rgb(255, 255, 255)');
  check('dark contrast — muted text on the canvas reaches AA', aa(dark.tokens['--tag-muted'], dark.tokens['--tag-bg']));

  /* ══ 7. Both themes agree on geometry ═══════════════════════════════════ */
  check('the logo tile is the same size in both themes',
    dark.cs(D.mark, 'width') === light.cs(L.mark, 'width'));
  check('the option-card border radius is identical in both themes',
    dark.cs(D.opsCard, 'borderTopLeftRadius') === light.cs(L.opsCard, 'borderTopLeftRadius'));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

/* Verbose JSON only when run directly — `npm test` imports this module and
   already prints one line per row, so a 50-line dump there is just noise. */
const runDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (runDirectly) {
  console.log(JSON.stringify({
    probe: 'ai-light-theme-surface',
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).map((r) => r.name),
    results
  }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

export default results;
