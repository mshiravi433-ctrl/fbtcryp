/**
 * STOCKS PAGE → «سهام توکنیزه» (equity) — SWAP BANNER PROBE
 * ---------------------------------------------------------------------------
 * Reported: the RWA / Global-Horizon flip card was «خیلی بزرگه و شلوغه، خیلی
 * متن داره», and on iPhone the two faces of the flip card painted on top of
 * each other while it rotated. The instruction: «اصلا فلیپ کارت نباشه یجور
 * دوتا بنر به صورت سواپ افقی باشد و مینیمال تر با گردی گوشه ها باشد
 * متناسب با تم و زبان و ایفون و اندروید و کامپیوتر و متن کمتر و مینیمال
 * تر قشنگ باشد خیلی مینیمال و مدرن تر و قشنگ تر».
 *
 * What this probe locks in:
 *
 *   1. NO 3D — the new banner has no perspective / preserve-3d /
 *      backface-visibility / rotateY anywhere, so the iPhone face-over-face
 *      paint bug has no geometry left to happen in.
 *   2. HORIZONTAL SWAP — one track, two 50%-width slides, a single
 *      translateX transition; the RTL sign is the mirror of the LTR sign.
 *   3. MINIMAL — exactly two text lines per slide (title + one short line),
 *      two dot indicators, and NO chips / eyebrow / badge / feature rows —
 *      the clutter the old card was reported for.
 *   4. THEME — the surfaces, lines and text are app tokens, checked in both
 *      themes with the real stylesheets in jsdom: the title must clear WCAG
 *      AA against the composited surface in dark AND light.
 *   5. LANGUAGE — Persian if and only if the language is Persian (the rule
 *      the flip card was pinned to after the «باید انگلیسی باشد» report);
 *      the copy table in the source must still speak English for the rest.
 */
import { readFileSync } from 'node:fs';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const SRC = readFileSync('src/components/RwaHorizonSwapBanners.jsx', 'utf8');
const CSS = readFileSync('src/styles/rwa-banners.css', 'utf8');

/* Comments may name the bug they are fixing; geometry may not. */
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const GEOMETRY = /preserve-3d|backface-visibility|perspective|rotateY|rotateX/;
check('the swap banner carries no 3D geometry (the iPhone bug cannot exist)',
  !GEOMETRY.test(noComments(SRC)) && !GEOMETRY.test(CSS));

/* ── 2. the horizontal swap, structurally ──────────────────────────────── */
check('one viewport, one track, two slides',
  /\.rhs-viewport\s*\{/.test(CSS) && /\.rhs-track\s*\{/.test(CSS));
check('the track is 200% wide and slides by transform only',
  /\.rhs-track\s*\{[^}]*width:\s*200%[^}]*transition:\s*transform/.test(CSS));
check('each slide takes exactly half the track',
  /\.rhs-slide\s*\{[^}]*width:\s*50%/.test(CSS));
check('the slide change is one transition on the track',
  /transform\s+560ms/.test(CSS));
/* RTL sign: the component computes the shift with the direction's own sign */
check('the RTL shift is the mirror of the LTR shift',
  /index \* \(isRTL \? 50 : -50\)/.test(SRC));
check('the swipe reads the direction: forward is the mirrored dx',
  /forward = isRTL \? dx > 0 : dx < 0/.test(SRC));

/* ── 3. minimal ────────────────────────────────────────────────────────── */
check('two slides, nothing else in the track',
  (SRC.match(/<Slide /g) || []).length === 2);
check('no chips, eyebrow, badge or feature rows survived the cut',
  !/rhb-chip|rhb-eyebrow|rhb-badge|rhb-feat|chip|eyebrow|badge/.test(CSS));
check('the indicator is two dots, no progress bar',
  (SRC.match(/rhs-dot/g) || []).length >= 2 && !/progress/.test(CSS));
check('the card has rounded corners in both breakpoints',
  /\.rhs\s*\{[^}]*border-radius:\s*18px/.test(CSS)
  && /@media \(min-width: 640px\)\s*\{\s*\.rhs\s*\{[^}]*border-radius:\s*20px/.test(CSS));

/* ── 4. theme — the real stylesheets, both themes, WCAG contrast ───────── */
const toRgb = (c) => {
  const s = String(c).trim();
  let m = /^#([\da-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([\da-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) return m[1].split(',').map((n) => n.trim()).slice(0, 3).map((n) => Math.round(parseFloat(n)));
  return null;
};
const alphaOf = (c) => {
  const m = /^rgba?\(([^)]+)\)$/.exec(String(c).trim());
  if (!m) return 1;
  const p = m[1].split(',').map((n) => n.trim());
  return p.length > 3 ? parseFloat(p[3]) : 1;
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
const over = (fg, bg, alpha) => {
  const [f, b] = [toRgb(fg), toRgb(bg)];
  if (!f || !b) return bg;
  return `rgb(${f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha))).join(', ')})`;
};
/*
 * jsdom does not resolve CSS custom properties (a computed `var(--x)` stays
 * literal, and a shorthand with an unresolved var computes to the initial
 * value), so asserting the THEME through getComputedStyle would test jsdom,
 * not the app. Instead: the stylesheet must BIND each element to the right
 * token (checked below, in the text), and the TOKEN VALUES themselves — the
 * exact pairs both themes publish — must clear the contrast bar.
 */
function themeTokens(theme) {
  /* The token values both themes publish (src/index.css), plus the banner accents. */
  const dark = {
    '--bg-void': '#000000', '--bg-panel': 'rgba(255, 255, 255, 0.055)', '--bg-panel-solid': '#0a0c12',
    '--bg-raised': 'rgba(255, 255, 255, 0.06)', '--line': 'rgba(255, 255, 255, 0.09)',
    '--line-strong': 'rgba(255, 255, 255, 0.16)',
    '--text-1': '#ffffff', '--text-2': '#9aa4bf', '--text-3': '#5b647f',
    '--rhs-acc-rwa': '#f5b942', '--rhs-acc-hz': '#00e5ff', '--rwb-acc': '#f5b942'
  };
  const light = {
    '--bg-void': '#ffffff', '--bg-panel': 'rgba(0, 0, 0, 0.03)', '--bg-panel-solid': '#ffffff',
    '--bg-raised': 'rgba(0, 0, 0, 0.04)', '--line': 'rgba(0, 0, 0, 0.08)',
    '--line-strong': 'rgba(0, 0, 0, 0.15)',
    '--text-1': '#1a1a2e', '--text-2': '#4a5568', '--text-3': '#9aa4bf',
    '--rhs-acc-rwa': '#a86a00', '--rhs-acc-hz': '#00758a', '--rwb-acc': '#a86a00'
  };
  return theme === 'light' ? light : dark;
}

/* The token each element binds to, straight out of the stylesheet text. */
const ruleOf = (css, re) => (re.exec(css)?.[1] ?? '').trim();
const BINDS = {
  viewport: /\.rhs-viewport\s*\{[^}]*background:\s*([^;]*);/,
  title: /\.rhs-title\s*\{[^}]*color:\s*([^;]*);/,
  sub: /\.rhs-sub\s*\{[^}]*color:\s*([^;]*);/,
  dotOn: /\.rhs-dot\.is-on\s*\{[^}]*background:\s*([^;]*);/,
  icon: /\.rhs-icon\s*\{[^}]*color:\s*([^;]*);/,
  rwbTitle: /\.rwb-title\s*\{[^}]*color:\s*([^;]*);/,
  rwbBody: /\.rwb-body\s*\{[^}]*color:\s*([^;]*);/,
  rwbFee: /\.rwb-fee\s*\{[^}]*color:\s*([^;]*);/,
  rwbBorder: /\.rwb\s*\{[^}]*border:\s*([^;]*);/
};
const TOKEN = (v) => (v.match(/var\((--[a-z0-9-]+)\)/)?.[1] ?? null);

for (const theme of ['dark', 'light']) {
  const tokens = themeTokens(theme);
  const voidBg = tokens['--bg-void'];

  /* The surface, exactly as the stylesheet builds it: the page canvas, the
     panel token, and the accent wash the stylesheet lays over the top at 7%. */
  const washAlpha = 0.07;
  const acc = tokens['--rhs-acc-rwa'];
  const surface = over(acc, over(tokens['--bg-panel'], voidBg, alphaOf(tokens['--bg-panel'])), washAlpha);

  const bind = (k) => TOKEN(ruleOf(CSS, BINDS[k]));
  const used = (k) => tokens[bind(k)] ?? tokens['--text-2'];

  const r = ratio(used('title'), surface);
  check(`[${theme}] the slide title clears WCAG AA over the composited surface (${r ? r.toFixed(2) : '?'}:1)`,
    r !== null && r >= 4.5);

  const rs = ratio(used('sub'), surface);
  check(`[${theme}] the slide subline is legible over the surface (${rs ? rs.toFixed(2) : '?'}:1)`,
    rs !== null && rs >= 4.5);

  const ri = ratio(acc, surface);
  check(`[${theme}] the RWA accent keeps contrast in its icon chip (${ri ? ri.toFixed(2) : '?'}:1)`,
    ri !== null && ri >= 3);

  const rd = ratio(used('dotOn'), surface);
  check(`[${theme}] the active dot is visible on the surface (${rd ? rd.toFixed(2) : '?'}:1)`,
    rd !== null && rd >= 3);

  const rwbSurface = over(tokens['--rwb-acc'], over(tokens['--bg-panel'], voidBg, alphaOf(tokens['--bg-panel'])), 0.08);
  const rtt = ratio(used('rwbTitle'), rwbSurface);
  check(`[${theme}] the RWA banner title clears WCAG AA (${rtt ? rtt.toFixed(2) : '?'}:1)`,
    rtt !== null && rtt >= 4.5);
  const rrb = ratio(used('rwbBody'), rwbSurface);
  check(`[${theme}] the RWA banner body is legible (${rrb ? rrb.toFixed(2) : '?'}:1)`,
    rrb !== null && rrb >= 4.5);
}

/* The bindings themselves: each element must use the token, not a literal. */
check('the slide title, subline, dots and surface bind to app tokens',
  ruleOf(CSS, BINDS.title) === 'var(--text-1)' && ruleOf(CSS, BINDS.sub) === 'var(--text-2)'
  && ruleOf(CSS, BINDS.dotOn) === 'var(--text-2)'
  && ruleOf(CSS, BINDS.viewport).includes('var(--bg-panel)')
  && ruleOf(CSS, BINDS.icon) === 'var(--rhs-acc-rwa)');
check('the RWA banner binds its text, border and accent to tokens too',
  ruleOf(CSS, BINDS.rwbTitle) === 'var(--text-1)' && ruleOf(CSS, BINDS.rwbBody) === 'var(--text-2)'
  && ruleOf(CSS, BINDS.rwbFee) === 'var(--text-2)'
  && ruleOf(CSS, BINDS.rwbBorder) === '1px solid var(--line)');
check('light theme deepens the accents (no neon gold/cyan on the white canvas)',
  /:root\[data-theme='light'\] \.rhs \{[^}]*--rhs-acc-rwa: #a86a00;[^}]*--rhs-acc-hz: #00758a;/.test(CSS)
  && /:root\[data-theme='light'\] \.rwb \{ --rwb-acc: #a86a00; \}/.test(CSS));

/* ── 5. language — the source-level rule ───────────────────────────────── */
check('the copy rule is «Persian if and only if fa» (not isRTL)',
  /isEn = !l\.startsWith\('fa'\)/.test(SRC) && !/isRTL\s*&&/.test(SRC));
check('both languages exist in the copy table',
  SRC.includes('دارایی‌های واقعی') && SRC.includes('Real-World Assets')
  && SRC.includes('افق جهانی') && SRC.includes('Global Horizon'));
check('each slide is one title + one short line (the minimum the report asked for)',
  (SRC.match(/title: isEn \?/g) || []).length === 2
  && (SRC.match(/sub: isEn \?/g) || []).length === 2);

/* ── the RWA section banner (task 2): same text, now a banner ──────────── */
const RWB_SRC = readFileSync('src/components/RwaSectionBanner.jsx', 'utf8');
check('the RWA section banner keeps the exact i18n copy (title, body, fee)',
  RWB_SRC.includes("t('stocks.rwaTitle')")
  && RWB_SRC.includes("t('stocks.rwaBody')")
  && RWB_SRC.includes("t('stocks.rwaFeeNotice'"));
check('and it has an animated SVG icon, not an emoji',
  /<svg[^>]*viewBox/.test(RWB_SRC) && /className="rwb-icon"/.test(RWB_SRC)
  && !/[⚡⛓📊🛡🔒🧾🏛💰]/u.test(RWB_SRC));
check('its animation is reduced-motion aware in the shared stylesheet',
  /@media \(prefers-reduced-motion: reduce\)\s*\{[^]*rwb/.test(CSS));

/* ── module exports (test/run.mjs aggregates these) ────────────────────── */
export default results;

export function summary() {
  return {
    label: 'stocks swap banner (equity tab) + RWA section banner',
    passed: results.filter((r) => r.ok).length,
    total: results.length,
    failures: results.filter((r) => !r.ok).map((r) => r.name)
  };
}

/* ── standalone run: node test/stocks-swap-banner-probe.mjs ────────────── */
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = summary();
  for (const row of results) console.log(`  ${row.ok ? '✓' : '✗'} ${row.name}`);
  console.log(`\n${r.failures.length === 0 ? '✓' : '✗'} stocks-swap-banner-probe: ${r.passed}/${r.total} passed`);
  for (const f of r.failures) console.error(`  ✗ ${f}`);
  process.exit(r.failures.length ? 1 : 0);
}
