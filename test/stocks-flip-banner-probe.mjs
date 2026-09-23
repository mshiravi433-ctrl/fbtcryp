/**
 * STOCKS PAGE → «سهام توکنیزه» (equity) — FLIP BANNER PROBE
 * ---------------------------------------------------------------------------
 * Reported: «در صفحه سهام تب توکینزه یک باکس فلیپ هست که اندازه نادرست است و
 * متن ها بالای رفته از باکس و داخل باکس نیستند» + «این باکس در تم روشن هم
 * نمی‌شود دیده شود متنش» — the RwaHorizonFlipBanner on the equity tab.
 *
 * Two root causes, two families of checks:
 *
 *   1. SIZE — the card was a fixed `min-height` box with both faces
 *      `position: absolute; inset: 0`, so the container never grew with its
 *      content. When the Persian title wrapped or the chips wrapped to two
 *      lines on a narrow phone, the flex-centred column overflowed the fixed
 *      height and the top of the text was clipped outside the glass. The fix
 *      stacks both faces in one grid cell (`grid-area: 1 / 1`) so the card
 *      height is driven by its tallest face. The structural checks below
 *      lock that in.
 *
 *   2. LIGHT THEME — the light-mode rules targeted a `.light` class the app
 *      never applies; the theme is `data-theme="light"` on <html>. White
 *      text therefore stayed white over the near-white light canvas. Same
 *      discipline as trade-light-theme-probe: real stylesheets in import
 *      order into jsdom, a DOM tree that mirrors the component, the glass
 *      surface composited the way it is seen, and WCAG contrast measured —
 *      not eyeballed.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

/* ── colour maths (same WCAG formula the other probes use) ──────────────── */
const toRgb = (c) => {
  const s = String(c).trim();
  let m = /^#([\da-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([\da-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(',').map((n) => n.trim());
    return p.slice(0, 3).map((n) => Math.round(parseFloat(n)));
  }
  return null;
};
const alphaOf = (c) => {
  const m = /^rgba?\(([^)]+)\)$/i.exec(String(c).trim());
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
/** Composite `fg` at `alpha` over `bg` — what the eye actually sees. */
const over = (fg, bg, alpha) => {
  const [f, b] = [toRgb(fg), toRgb(bg)];
  if (!f || !b) return bg;
  return `rgb(${f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha))).join(', ')})`;
};
/** Every colour literal inside a gradient layer string. */
const gradientStops = (bgImage) =>
  String(bgImage || '').match(/#[\da-f]{3,8}\b|rgba?\([^)]+\)/gi) ?? [];
/**
 * The effective colour of a glass surface: the page canvas, then the
 * background-colour layer, then each background-image layer bottom→top.
 * Multi-stop gradients are represented by their strongest stop — an
 * approximation of "the way it is seen", as in trade-light-theme-probe.
 */
const effectiveSurface = (cs, node, pageBg) => {
  let bg = pageBg;
  const bcol = cs(node, 'backgroundColor');
  if (bcol && bcol !== 'transparent' && toRgb(bcol)) bg = over(bcol, bg, alphaOf(bcol));
  const img = String(cs(node, 'backgroundImage') || '');
  const layers = [];
  let depth = 0, start = 0;
  for (let i = 0; i < img.length; i++) {
    if (img[i] === '(') depth++;
    else if (img[i] === ')') depth--;
    else if (img[i] === ',' && depth === 0) { layers.push(img.slice(start, i)); start = i + 1; }
  }
  if (img.trim()) layers.push(img.slice(start));
  for (let li = layers.length - 1; li >= 0; li--) {
    let strongest = null, best = -1;
    for (const s of gradientStops(layers[li])) {
      const a = alphaOf(s);
      if (a > best) { best = a; strongest = s; }
    }
    if (strongest && best > 0) bg = over(strongest, bg, best);
  }
  return bg;
};

/* ── the stylesheets, in the order the stocks page gets them ────────────── */
const CSS = [
  'src/index.css',
  'src/styles/rwa-flip-banner.css'
].map((f) => readFileSync(f, 'utf8')).join('\n');

const TOKENS = ['--bg-void', '--text-1', '--text-2', '--text-3', '--line'];

function build(theme) {
  const dom = new JSDOM(
    `<!doctype html><html data-theme="${theme}" dir="rtl"><body></body></html>`,
    { pretendToBeVisual: true }
  );
  const { window } = dom;
  const style = window.document.createElement('style');
  style.textContent = CSS;
  window.document.head.appendChild(style);
  const d = window.document;
  const el = (tag, cls, parent, text) => {
    const n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    (parent || d.body).appendChild(n);
    return n;
  };

  /* mirrors RwaHorizonFlipBanner.jsx — both faces, every text node */
  const wrap = el('div', 'flip-banner-wrap');
  const inner = el('div', 'flip-banner-inner', wrap);
  const face = (isHz) => {
    const f = el('div', isHz ? 'flip-face flip-face-hz' : 'flip-face flip-face-rwa', inner);
    el('div', 'flip-face-aurora' + (isHz ? ' hz' : ''), f);
    el('div', 'flip-face-sheen', f);
    el('div', 'flip-icon-tile ' + (isHz ? 'hz' : 'rwa'), f);
    const content = el('div', 'flip-content', f);
    const eyebrow = el('div', 'flip-eyebrow', content);
    el('span', 'flip-dot ' + (isHz ? 'hz' : 'rwa'), eyebrow);
    eyebrow.appendChild(d.createTextNode(isHz ? 'افق جهانی • بازارهای واقعی' : 'دارایی واقعی • RWA'));
    el('span', 'flip-ind', eyebrow);
    const title = el('div', 'flip-title', content,
      isHz ? 'افق جهانی · فارکس، طلا، سهام، شاخص‌ها' : 'مشاهده و خرید RWA · طلا، خزانه، رابین‌هود');
    const sub = el('div', 'flip-sub', content,
      isHz ? 'معامله اهرمی با USDC · تسویه آنچین آربیتروم' : 'تسویه مستقیم با کیف پول شخصی · کارمزد 0.30٪');
    const chips = el('div', 'flip-chips', content);
    el('span', 'flip-chip', chips, 'طلا');
    el('span', 'flip-chip', chips, 'خزانه');
    el('span', 'flip-chip', chips, 'رابین‌هود');
    const ctaCol = el('div', 'flip-cta-col', f);
    const cta = el('span', 'flip-cta ' + (isHz ? 'hz-cta' : 'rwa-cta'), ctaCol,
      isHz ? 'ورود به افق جهانی' : 'ورود به RWA');
    const switchBtn = el('button', 'flip-switch-btn', ctaCol, isHz ? 'RWA ↻' : 'افق جهانی ↻');
    return { face: f, eyebrow, title, sub, chip: chips.firstChild, cta, switchBtn };
  };
  const rwa = face(false);
  const hz = face(true);

  const cs = (node, prop) => window.getComputedStyle(node)[prop] || '';
  const tokens = {};
  for (const tk of TOKENS) tokens[tk] = window.getComputedStyle(d.body).getPropertyValue(tk).trim();
  const val = (node, prop) => {
    let v = cs(node, prop);
    for (let i = 0; i < 5 && v.includes('var('); i++) {
      v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, n, fb) => tokens[n] || fb || '');
    }
    return v.trim();
  };
  const surface = (node) => effectiveSurface(cs, node, theme === 'light' ? '#f4f5fa' : '#000000');
  return { window, val, surface, rwa, hz };
}

try {
  /* ══ 1. SIZE — the card must fit its content ═══════════════════════════ */
  const flipCss = readFileSync('src/styles/rwa-flip-banner.css', 'utf8');
  const rule = (selector) => {
    const i = flipCss.indexOf(selector + ' {');
    if (i < 0) return '';
    const open = flipCss.indexOf('{', i);
    const close = flipCss.indexOf('}', open);
    return flipCss.slice(open, close + 1);
  };
  check('size: .flip-banner-inner is a grid (height driven by its faces, not a fixed min-height)',
    /display:\s*grid/.test(rule('.flip-banner-inner')));
  const faceRule = rule('.flip-face');
  check('size: .flip-face stacks in one cell (grid-area: 1 / 1)', /grid-area:\s*1\s*\/\s*1/.test(faceRule));
  check('size: .flip-face is in normal flow (position: relative, no absolute inset)',
    /position:\s*relative/.test(faceRule) && !/position:\s*absolute/.test(faceRule));
  check('size: the 3D flip is preserved (backface-visibility: hidden on the faces)',
    /backface-visibility:\s*hidden/.test(faceRule));

  /* ══ 2. LIGHT THEME — selectors must target what the app actually sets ══ */
  const cssNoComments = flipCss.replace(/\/\*[\s\S]*?\*\//g, '');
  check('light: no rule targets the .light class the app never applies',
    !/\.light[\s,{]/.test(cssNoComments));
  check('light: rules target :root[data-theme=\'light\'] (the real theme hook)',
    /:root\[data-theme='light'\]\s+\.flip-face/.test(cssNoComments));
  check('light: the OS boot fallback (no attribute yet, OS prefers light) is covered too',
    /@media \(prefers-color-scheme: light\)/.test(cssNoComments) &&
    /:root:not\(\[data-theme='dark'\]\):not\(\[data-theme='light'\]\)\s+\.flip-face/.test(cssNoComments));

  /* ══ 3. LIGHT THEME — the glass is a light surface with dark text ═══════ */
  const light = build('light');
  for (const [label, side] of [['RWA', light.rwa], ['Horizon', light.hz]]) {
    const surf = light.surface(side.face);
    const surfRgb = toRgb(surf);
    const isLight = surfRgb && surfRgb[0] > 190 && surfRgb[1] > 190 && surfRgb[2] > 190;
    check(`light: ${label} face is a light glass surface (${surf})`, isLight);
    const t = light.val(side.title, 'color');
    const s = light.val(side.sub, 'color');
    const e = light.val(side.eyebrow, 'color');
    const c = light.val(side.chip, 'color');
    const b = light.val(side.switchBtn, 'color');
    check(`light: ${label} title clears WCAG AA on the glass (${ratio(t, surf)?.toFixed(2)})`, ratio(t, surf) >= 4.5);
    check(`light: ${label} sub-line is legible (${ratio(s, surf)?.toFixed(2)})`, ratio(s, surf) >= 4.5);
    check(`light: ${label} eyebrow is legible (${ratio(e, surf)?.toFixed(2)})`, ratio(e, surf) >= 3);
    check(`light: ${label} chips are legible (${ratio(c, surf)?.toFixed(2)})`, ratio(c, surf) >= 3);
    check(`light: ${label} switch button is legible (${ratio(b, surf)?.toFixed(2)})`, ratio(b, surf) >= 3);
  }

  /* ══ 4. DARK THEME — the original glass must still read ═════════════════ */
  const dark = build('dark');
  for (const [label, side] of [['RWA', dark.rwa], ['Horizon', dark.hz]]) {
    const surf = dark.surface(side.face);
    const surfLum = lum(toRgb(surf)) ?? 1;
    check(`dark: ${label} face is a dark glass surface (${surf}, L=${surfLum.toFixed(3)})`, surfLum < 0.08);
    const t = dark.val(side.title, 'color');
    const s = dark.val(side.sub, 'color');
    const e = dark.val(side.eyebrow, 'color');
    const c = dark.val(side.chip, 'color');
    const b = dark.val(side.switchBtn, 'color');
    check(`dark: ${label} title clears WCAG AA on the glass (${ratio(t, surf)?.toFixed(2)})`, ratio(t, surf) >= 4.5);
    check(`dark: ${label} sub-line is legible (${ratio(s, surf)?.toFixed(2)})`, ratio(s, surf) >= 4.5);
    check(`dark: ${label} eyebrow is legible (${ratio(e, surf)?.toFixed(2)})`, ratio(e, surf) >= 3);
    check(`dark: ${label} chips are legible (${ratio(c, surf)?.toFixed(2)})`, ratio(c, surf) >= 3);
    check(`dark: ${label} switch button is legible (${ratio(b, surf)?.toFixed(2)})`, ratio(b, surf) >= 3);
  }
} catch (err) {
  results.push({ name: `probe threw: ${err && err.message}`, ok: false });
}

export default results;

export function summary() {
  return {
    label: 'stocks flip banner (equity tab)',
    passed: results.filter((r) => r.ok).length,
    total: results.length,
    failures: results.filter((r) => !r.ok).map((r) => r.name)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = summary();
  console.log(`${r.passed}/${r.total} checks passed`);
  for (const f of r.failures) console.log('  ✗', f);
  process.exit(r.failures.length ? 1 : 0);
}
