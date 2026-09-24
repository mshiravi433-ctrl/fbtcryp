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

  /* mirrors RwaHorizonFlipBanner.jsx (v3 «Aurora Flip») — both faces, every text node */
  const root = el('section', 'rhb');
  root.setAttribute('dir', 'rtl');
  const tabs = el('div', 'rhb-tabs', root);
  el('span', 'rhb-tabs-pill', tabs);
  el('button', 'rhb-tab on', tabs, 'RWA');
  const idleTab = el('button', 'rhb-tab', tabs, 'افق جهانی');
  const stage = el('div', 'rhb-stage', root);
  const tilt = el('div', 'rhb-tilt', stage);
  const inner = el('div', 'rhb-card', tilt);
  const face = (isHz) => {
    const f = el('div', isHz ? 'rhb-face rhb-face--hz' : 'rhb-face rhb-face--rwa', inner);
    el('div', 'rhb-rim', f);
    el('div', 'rhb-bg', f);
    el('span', 'rhb-sheen', f);
    const body = el('div', 'rhb-body', f);
    const head = el('div', 'rhb-head', body);
    el('div', 'rhb-icon', head);
    const ht = el('div', 'rhb-head-txt', head);
    const eyebrow = el('span', 'rhb-eyebrow', ht, isHz ? 'افق جهانی' : 'دارایی‌های واقعی');
    el('span', 'rhb-badge', ht, isHz ? 'بازار زنده' : 'RWA');
    const title = el('h3', 'rhb-title', body, isHz ? 'بازارهای جهان،' : 'دارایی واقعی،');
    const sub = el('p', 'rhb-sub', body,
      isHz ? 'فارکس، طلا، سهام و شاخص‌ها — اهرمی، تسویه آنچین روی آربیتروم' : 'طلا، اوراق خزانه آمریکا و سهام رابین‌هود به‌صورت توکن');
    const chips = el('div', 'rhb-chips', body);
    const chip = el('span', 'rhb-chip', chips, 'طلا');
    chip.style.setProperty('--c', '#FFC84A');
    const foot = el('div', 'rhb-foot', body);
    const feat = el('span', 'rhb-feat', el('div', 'rhb-feats', foot), 'Arbitrum');
    const cta = el('span', 'rhb-cta', foot, isHz ? 'ورود به افق جهانی' : 'ورود به RWA');
    return { face: f, eyebrow, title, sub, chip, cta, feat };
  };
  const rwa = face(false);
  const hz = face(true);

  const cs = (node, prop) => window.getComputedStyle(node)[prop] || '';
  const tokens = {};
  for (const tk of TOKENS) tokens[tk] = window.getComputedStyle(d.body).getPropertyValue(tk).trim();
  const val = (node, prop) => {
    let v = cs(node, prop);
    for (let i = 0; i < 5 && v.includes('var('); i++) {
      v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, n, fb) => tokens[n] || window.getComputedStyle(node).getPropertyValue(n).trim() || fb || '');
    }
    return v.trim();
  };
  const surface = (node) => effectiveSurface(cs, node, theme === 'light' ? '#f4f5fa' : '#000000');
  return { window, val, surface, rwa, hz, idleTab, tabs };
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
  check('size: .rhb-card is a grid (height driven by its faces, not a fixed min-height)',
    /display:\s*grid/.test(rule('.rhb-card')));
  const faceRule = rule('.rhb-face');
  check('size: .rhb-face stacks in one cell (grid-area: 1 / 1)', /grid-area:\s*1\s*\/\s*1/.test(faceRule));
  check('size: .rhb-face is in normal flow (position: relative, no absolute inset)',
    /position:\s*relative/.test(faceRule) && !/position:\s*absolute/.test(faceRule));
  check('size: the 3D flip is preserved (backface-visibility: hidden on the faces)',
    /backface-visibility:\s*hidden/.test(faceRule));

  /* ══ 2. LIGHT THEME — selectors must target what the app actually sets ══ */
  const cssNoComments = flipCss.replace(/\/\*[\s\S]*?\*\//g, '');
  check('light: no rule targets the .light class the app never applies',
    !/\.light[\s,{]/.test(cssNoComments));
  check('light: rules target :root[data-theme=\'light\'] (the real theme hook)',
    /:root\[data-theme='light'\]\s+\.rhb-face/.test(cssNoComments));
  check('3D: no backdrop-filter inside the flip card (Chrome flattens preserve-3d)',
    !/backdrop-filter/.test(cssNoComments));
  check('light: the OS boot fallback (no attribute yet, OS prefers light) is covered too',
    /@media \(prefers-color-scheme: light\)/.test(cssNoComments) &&
    /:root:not\(\[data-theme='dark'\]\):not\(\[data-theme='light'\]\)\s+\.rhb-/.test(cssNoComments));

  /*
   * ══ 3+4. BOTH THEMES — v3 «Aurora Flip» is a deliberately dark, vivid promo
   * card in light AND dark mode (same as the wallet hero), so the original
   * white-on-white failure is impossible by construction. What must hold in
   * both themes: the face really IS dark, and every text node on it clears
   * contrast on that surface. The tab strip sits on the page canvas and must
   * read on it.
   */
  for (const theme of ['light', 'dark']) {
    const B = build(theme);
    for (const [label, side] of [['RWA', B.rwa], ['Horizon', B.hz]]) {
      const surf = B.surface(side.face);
      const surfLum = lum(toRgb(surf)) ?? 1;
      check(`${theme}: ${label} face is a dark promo surface (${surf}, L=${surfLum.toFixed(3)})`, surfLum < 0.08);
      const t = B.val(side.title, 'color');
      const s2 = B.val(side.sub, 'color');
      const e = B.val(side.eyebrow, 'color');
      const c = B.val(side.chip, 'color');
      const f = B.val(side.feat, 'color');
      const sOn = over(s2, surf, alphaOf(s2));
      const fOn = over(f, surf, alphaOf(f));
      check(`${theme}: ${label} title clears WCAG AA (${ratio(t, surf)?.toFixed(2)})`, ratio(t, surf) >= 4.5);
      check(`${theme}: ${label} sub-line clears WCAG AA (${ratio(sOn, surf)?.toFixed(2)})`, ratio(sOn, surf) >= 4.5);
      check(`${theme}: ${label} eyebrow is legible (${ratio(e, surf)?.toFixed(2)})`, ratio(e, surf) >= 3);
      check(`${theme}: ${label} chips are legible (${ratio(c, surf)?.toFixed(2)})`, ratio(c, surf) >= 3);
      check(`${theme}: ${label} feature line is legible (${ratio(fOn, surf)?.toFixed(2)})`, ratio(fOn, surf) >= 3);
    }
    const page = theme === 'light' ? '#f4f5fa' : '#000000';
    const tabBg = B.surface(B.tabs) || page;
    const tabTxt = B.val(B.idleTab, 'color');
    check(`${theme}: idle tab label reads on the page (${ratio(tabTxt, tabBg)?.toFixed(2)})`, ratio(tabTxt, tabBg) >= 3);
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
