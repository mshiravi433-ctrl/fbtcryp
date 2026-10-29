/**
 * SMART MONEY — “AURORA SIGNAL DESK” REDESIGN PROBE
 * ---------------------------------------------------------------------------
 * The 2026-10-28 rebuild replaced every emoji heading, every ad-hoc box and
 * every hand-tuned colour on the Smart Money surface. A render test cannot
 * prove most of that, because the page still mounts: a class with no rule
 * renders as unstyled text, an emoji renders in whatever font the device
 * ships, and a card with no light-theme twin renders as white on white.
 *
 * So this probe reads the source the way the browser would:
 *
 *   1. every glyph the screens import actually exists in SmGlyphs.jsx;
 *   2. no emoji survives on any of the five screens (comments stripped);
 *   3. every `sm-*` / `smx-*` / `smi-*` class the JSX paints has a rule;
 *   4. the desk's token block and its light twin exist;
 *   5. the surfaces that carry a hard-coded colour have a light counterpart;
 *   6. no `backdrop-filter` (a WebView paints it every frame), no `--text`
 *      fallback, no `background:` shorthand on a <select>;
 *   7. ambient motion stops under prefers-reduced-motion and in the APK;
 *   8. every interactive surface has a focus ring and a real tap target;
 *   9. figures are tabular, alignment is logical (RTL-safe), and the flow
 *      tiles still refuse to print a fabricated zero.
 *
 * Runs with plain Node: no DOM, no network.
 * Run: node test/smart-money-redesign-probe.mjs
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const load = (l) => JSON.parse(read(`../src/i18n/locales/${l}.json`));

let failures = 0;
const fail = (m) => { failures += 1; console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);
const t = (name, cond) => (cond ? ok(name) : fail(name));

/** Comments quote the old emoji and the bugs they fixed, so every text check
 *  below reads code with comments removed. */
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

const SCREENS = [
  'src/pages/SmartMoney.jsx',
  'src/components/SmartMoneyIntelligence.jsx',
  'src/components/TokenSmartMoney.jsx',
  'src/pages/SmartMoneyWallet.jsx',
  'src/pages/SmartMoneyToken.jsx'
];

const page = read('../src/pages/SmartMoney.jsx');
const pageCode = strip(page);
const intel = read('../src/components/SmartMoneyIntelligence.jsx');
const intelCode = strip(intel);
const glyphSrc = read('../src/components/smart-money/SmGlyphs.jsx');
const css = strip(read('../src/styles/smart-money.css'));
const intelCssRaw = read('../src/styles/smart-money-intelligence.css');
const intelCss = strip(intelCssRaw);
const en = load('en');
const fa = load('fa');
const get = (o, d) => d.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const isStr = (v) => typeof v === 'string' && v.length > 0;

/* ── 1 · the glyph set ──────────────────────────────────────────────────── */
const glyphs = [...glyphSrc.matchAll(/^export const (Sm\w+Glyph)\s*=/gm)].map((m) => m[1]);
t(`the glyph set exists and is a real family (${glyphs.length} glyphs)`, glyphs.length >= 15);
/* The grid and the stroke live in one shared `base` object, so the assertion
   is that base plus every glyph spreading it — not N copies of the attributes. */
const glyphBodies = [...glyphSrc.matchAll(/^export const Sm\w+Glyph = \(p\) => \(\s*<svg \{\.\.\.base\} \{\.\.\.p\}>/gm)];
t('every glyph is a 24×24 currentColor line drawing on one shared base',
  /viewBox:\s*'0 0 24 24'/.test(glyphSrc)
  && /stroke:\s*'currentColor'/.test(glyphSrc)
  && /strokeWidth:\s*1\.7/.test(glyphSrc)
  && glyphBodies.length === glyphs.length
  && !/fill="#[0-9a-f]{3,6}"/i.test(glyphSrc));

const usedGlyphs = new Set();
for (const f of SCREENS) {
  const src = strip(read(`../${f}`));
  for (const m of src.matchAll(/<(Sm\w+Glyph)\b/g)) usedGlyphs.add(m[1]);
  for (const m of src.matchAll(/icon:\s*(Sm\w+Glyph)/g)) usedGlyphs.add(m[1]);
}
const unknownGlyphs = [...usedGlyphs].filter((g) => !glyphs.includes(g));
t(`every glyph the screens paint is exported (${usedGlyphs.size} used)`,
  unknownGlyphs.length === 0 || (fail(`unknown glyphs: ${unknownGlyphs.join(', ')}`), false));

/* ── 2 · no emoji anywhere on the surface ───────────────────────────────── */
for (const f of SCREENS) {
  const src = strip(read(`../${f}`));
  const hits = [...src.matchAll(/\p{Extended_Pictographic}/gu)];
  t(`${f.split('/').pop()} paints no emoji or pictographic arrow`,
    hits.length === 0
      || (fail(`hits: ${hits.slice(0, 4).map((m) => JSON.stringify(src.slice(m.index - 18, m.index + 4))).join(' · ')}`), false));
}

/* ── 3 · the seven tabs and their labels ────────────────────────────────── */
const tabsBlock = /const TABS = \[([^\]]*)\]/.exec(page)?.[1] || '';
const tabs = [...tabsBlock.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
t(`the dock has all seven tabs (${tabs.join(' · ')})`, tabs.length === 7);
t('every tab has a glyph in the dock map',
  tabs.every((id) => new RegExp(`\\b${id}:\\s*Sm\\w+Glyph`).test(page)));
t('every tab label is translated in fa and en',
  tabs.every((id) => isStr(get(fa, `sm.tabs.${id}`)) && isStr(get(en, `sm.tabs.${id}`))));
t('the dock is a real tablist with a translated aria label',
  /className="smx-dock" role="tablist" aria-label=\{t\('sm\.title'\)\}/.test(page)
  && /aria-selected=\{active\}/.test(pageCode));

/* ── 4 · the three windows ──────────────────────────────────────────────── */
const windowsBlock = /const WINDOWS = \[([^\]]*)\]/.exec(page)?.[1] || '';
const windows = [...windowsBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
t(`the window rail keeps its three windows (${windows.join('/')})`, windows.length === 3);
t('each window has a Persian and an English label',
  windows.every((w) => isStr(get(fa, `sm.windows.${w}`)) && isStr(get(en, `sm.windows.${w}`))));
t('the rail is one tablist with translated labels and a live selection',
  /data-testid="sm-window-tabs"/.test(page)
  && /aria-selected=\{winKey === w\}/.test(page)
  && /t\(`sm\.windows\.\$\{w\}`\)/.test(page));
{
  const body = (name) => new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(page)?.[0] || '';
  const overviewRail = body('WindowRail');
  const flowsRail = body('FlowsWindowRail');
  t('the flows tab has its own rail (two rails never share a layout id)',
    overviewRail.includes('data-testid="sm-window-tabs"')
    && !overviewRail.includes('sm-flows')
    && flowsRail.includes('data-testid="sm-flows-window-tabs"')
    && flowsRail.includes('id="sm-flows-window-pill"')
    && overviewRail.includes('id="sm-window-pill"'));
}

/* ── 5 · the probe-visible hooks are still there ────────────────────────── */
const HOOKS = [
  'sm-window-tabs', 'sm-window-coverage', 'sm-coverage', 'sm-stale-notice',
  'sm-flows-window-tabs', 'sm-token-window-badge', 'sm-token-window-note',
  'sm-token-evidence', 'sm-token-identity', 'sm-token-wallets', 'sm-solana-promotion',
  'sm-momentum-detail'
];
const hookSources = [...SCREENS.map((f) => strip(read(`../${f}`))), strip(read('../src/components/SmartMoneyIntelligence.jsx'))].join('\n');
const missingHooks = HOOKS.filter((id) => !hookSources.includes(`data-testid="${id}"`) && !hookSources.includes(`data-testid={collapsible ? '${id}'`));
t(`all ${HOOKS.length} probe-visible test ids survive the redesign`,
  missingHooks.length === 0 || (fail(`missing: ${missingHooks.join(', ')}`), false));

/* ── 6 · every painted class has a rule ─────────────────────────────────── */
const used = new Set();
for (const f of SCREENS) {
  const src = strip(read(`../${f}`));
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{[^}]*?['"]([^'"]+)['"][^}]*?\})/g)) {
    for (const c of (m[1] || m[2] || m[3] || '').split(/\s+/)) {
      if (!/^(sm|smx|smi)-/.test(c) || c.includes('${')) continue;
      used.add(c);
    }
  }
}
const defined = new Set([...(`${css}\n${intelCss}`).matchAll(/\.((?:sm|smx|smi)-[a-zA-Z0-9_-]+)/g)].map((m) => m[1]));
const unstyled = [...used].filter((c) => !defined.has(c)).sort();
t(`every class the screens paint has a declared rule (${used.size} classes)`,
  unstyled.length === 0 || (fail(`unstyled: ${unstyled.join(', ')}`), false));

/* ── 7 · tokens + light twin ────────────────────────────────────────────── */
const TOKENS = ['--sm-mint', '--sm-cyan', '--sm-rose', '--sm-amber', '--sm-violet',
  '--sm-ink', '--sm-ink-dim', '--sm-surface', '--sm-surface-2', '--sm-surface-3',
  '--sm-line', '--sm-line-soft', '--sm-line-strong'];
const tokenBlock = /\.sm-page,\s*\.smx-deck\s*\{([\s\S]*?)\}/.exec(css)?.[1] || '';
const missingTokens = TOKENS.filter((tk) => !tokenBlock.includes(`${tk}:`));
t(`the desk defines its ${TOKENS.length} design tokens on one scope`,
  missingTokens.length === 0 || (fail(`missing: ${missingTokens.join(', ')}`), false));
const lightTok = /:root\[data-theme='light'\] \.sm-page,\s*:root\[data-theme='light'\] \.smx-deck\s*\{([\s\S]*?)\}/.exec(css)?.[1] || '';
t('the light theme re-declares ink and surfaces instead of inheriting dark ones',
  ['--sm-ink', '--sm-surface', '--sm-line'].every((tk) => lightTok.includes(`${tk}:`)));

const LIGHT_SURFACES = [
  '.smx-hero', '.smx-hero-title', '.smx-search', '.smx-metric', '.smx-dock-btn.is-active',
  '.smx-toolbar', '.smx-fresh', '.smx-whale', '.smx-early', '.smx-net', '.smx-pagehead',
  '.sm-section', '.sm-row', '.sm-seg-window', '.sm-token-chip', '.smx-empty-ico'
];
const noTwin = LIGHT_SURFACES.filter((sel) => !css.includes(`:root[data-theme='light'] ${sel}`));
t(`every surface with a hand-picked colour has a light twin (${LIGHT_SURFACES.length} checked)`,
  noTwin.length === 0 || (fail(`no twin: ${noTwin.join(', ')}`), false));

/* ── 8 · WebView / theme hygiene ────────────────────────────────────────── */
t('no backdrop-filter anywhere on the surface (the APK repaints it per frame)',
  !/backdrop-filter/.test(css) && !/backdrop-filter/.test(intelCss));
t('no `var(--text, …)` fallback (the token is --text-1; --text never existed)',
  !/var\(--text,/.test(css) && !/var\(--text,/.test(intelCss));
t('no rule paints a <select> with the background shorthand',
  !/(?<![-\w])select(?![-w])[^{]*\{[^}]*[\s;{]background:\s*(?!none|transparent)/.test(css));

/* ── 9 · motion ─────────────────────────────────────────────────────────── */
t('ambient animations stop under prefers-reduced-motion and in the native shell',
  /@media \(prefers-reduced-motion: reduce\)/.test(css)
  && /\.smx-hero-radar b,[\s\S]{0,160}animation: none !important/.test(css)
  && /:root\[data-native='true'\] \.smx-hero-radar b/.test(css));
t('the intelligence workspace honours reduced motion too',
  /@media \(prefers-reduced-motion: reduce\) \{ \.smi-workspace \*/.test(intelCss));

/* ── 10 · touch targets + focus ─────────────────────────────────────────── */
const dockMin = Number(/\.smx-dock-btn \{[\s\S]*?min-height:\s*(\d+)px/.exec(css)?.[1] || 0);
t(`each dock button is a real tap target (min-height ${dockMin}px)`, dockMin >= 56);
const railMin = Number(/\.sm-seg-window-item \{[\s\S]*?min-height:\s*(\d+)px/.exec(css)?.[1] || 0);
t(`the window buttons clear 30px inside a 32px toolbar (${railMin}px)`, railMin >= 30);
const FOCUS = ['.smx-dock-btn', '.sm-seg-window-item', '.smx-row', '.smx-fresh',
  '.smx-whale', '.smx-alert', '.sm-token-head', '.smx-pagehead-back'];
const noFocus = FOCUS.filter((sel) => !css.includes(`${sel}:focus-visible`));
t(`every interactive surface has a focus ring (${FOCUS.length} checked)`,
  noFocus.length === 0 || (fail(`no ring: ${noFocus.join(', ')}`), false));

/* ── 11 · type + RTL ────────────────────────────────────────────────────── */
t('figures are tabular so they do not jitter while polling',
  (css.match(/font-variant-numeric:\s*tabular-nums/g) || []).length >= 12);
t('alignment is logical, not physical (the page is RTL first)',
  !/text-align:\s*(left|right)\b/.test(css)
  && !/\b(margin|padding)-(left|right):/.test(css));

/* ── 12 · honest numbers ────────────────────────────────────────────────── */
t('a dead stream or an empty window prints «—», never a fabricated zero',
  pageCode.includes("streamDown || !m?.flowEvents ? '—'")
  && pageCode.includes('sm.noLabelledFlow'));
t('the overview keeps its coverage and stale notices',
  /data-testid="sm-window-coverage"/.test(page) && /data-testid="sm-stale-notice"/.test(page));
t('the whale band summary counts all three bands',
  /const bands = \['LOW', 'MEDIUM', 'HIGH'\]/.test(pageCode)
  && pageCode.includes("['LOW', 'MEDIUM', 'HIGH'].includes(w.riskBand)"));

/* ── 13 · the intelligence workspace joined the same desk ───────────────── */
t('intelligence inherits the page tokens instead of its own teal palette',
  (intelCss.match(/var\(--sm-/g) || []).length >= 40);
t('intelligence sections carry glyph tiles, not emoji',
  (intelCode.match(/className="smi-head-ico"/g) || []).length >= 5
  && /icon: Sm\w+Glyph/.test(intelCode));
t('the intelligence workspace has a light twin for its cards',
  /:root\[data-theme='light'\] \.smi-section,/.test(intelCss)
  || /:root\[data-theme='light'\] \.smi-hero \{/.test(intelCss));

/* ── report ─────────────────────────────────────────────────────────────── */
if (failures) {
  console.error(`\nSmart Money redesign probe: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nSmart Money redesign probe: all checks passed');
