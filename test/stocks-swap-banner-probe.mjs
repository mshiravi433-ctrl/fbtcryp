/**
 * STOCKS PAGE → «سهام توکنیزه» (equity) — SWAP BANNER PROBE
 * ---------------------------------------------------------------------------
 * The RWA / Global-Horizon banner, third iteration (2026-09-25). Reported:
 * «دکمه چپ و راست را در بنر مخفی کن · تم مناسب و زبان مناسب · بنر باید ایکون
 * مدرن و انیمیشن بیشتر و باکس بسیار مدرن تر و خاص تر شود … اندازه هم میتونی
 * کمی بزرگتر شود».
 *
 * The «left and right buttons» were the two 5px indicator dots: they were
 * <button>s, and the app's global tap-target rule (`button { min-height:
 * 44px; min-width: 44px }` in src/index.css) inflated each into a 44px grey
 * disc in the middle of the banner, on top of the subtitle. This probe locks
 * the fix and the redesign around it:
 *
 *   1. NO 3D — no perspective / preserve-3d / backface-visibility / rotateY
 *      anywhere, so the iPhone face-over-face paint bug has no geometry left
 *      to happen in.
 *   2. HORIZONTAL SWAP — one track, two 50%-width slides, a single
 *      translateX transition; the RTL sign is the mirror of the LTR sign.
 *   3. NO BUTTONS BUT THE SLIDES — the indicator is hairline <span>
 *      segments with pointer-events none, so no global button rule can ever
 *      touch it; the circular «go» arrow is gone; the source renders exactly
 *      one kind of <button>, the slide.
 *   4. BIGGER, ROUNDER — 112px / 22px on phones, 128px / 24px from 640px.
 *   5. MINIMAL TEXT, RICH BOX — still one title + one short line per slide
 *      and no chips / eyebrow / badge rows; the richness is decoration: two
 *      cross-faded aurora fields, a border comet, a light sweep, a dot grid,
 *      a two-ring orb, a self-drawing sparkline.
 *   6. MOTION BUDGET — every @keyframes touches only transform, opacity or
 *      stroke-dashoffset (compositor work + two tiny SVG draws); the slide
 *      that is out of sight has its animations paused; reduced motion stops
 *      everything and leaves the sparkline fully drawn.
 *   7. THEME — surfaces, lines and text are app tokens, checked in dark and
 *      BOTH light variants (the explicit theme and the pre-paint fallback):
 *      title and subline must clear WCAG AA over the composited surface,
 *      including the aurora tint under the text; the light theme deepens the
 *      accents and halves the aurora.
 *   8. LANGUAGE — Persian if and only if the language is Persian (the rule
 *      the owner set after the «باید انگلیسی باشد» report).
 */
import { readFileSync } from 'node:fs';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const SRC = readFileSync('src/components/RwaHorizonSwapBanners.jsx', 'utf8');
const CSS = readFileSync('src/styles/rwa-banners.css', 'utf8');
const INDEX_CSS = readFileSync('src/index.css', 'utf8');

/* Comments may name the bug they are fixing; geometry may not. */
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SRC_CODE = noComments(SRC);
const CSS_CODE = noComments(CSS);
const GEOMETRY = /preserve-3d|backface-visibility|perspective|rotateY|rotateX/;
check('the swap banner carries no 3D geometry (the iPhone bug cannot exist)',
  !GEOMETRY.test(SRC_CODE) && !GEOMETRY.test(CSS_CODE));

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
check('the arrow keys move between slides, mirrored for RTL',
  /ArrowLeft/.test(SRC) && /ArrowRight/.test(SRC)
  && /forward = isRTL \? e\.key === 'ArrowLeft' : e\.key === 'ArrowRight'/.test(SRC));

/* ── 3. no buttons but the slides — the «left and right buttons» fix ───── */
/* The cause is still in the codebase, and must be: 44px is the accessibility
   minimum for a real control. The banner simply must not hand it a control. */
check('the global 44px tap-target rule that inflated the dots still exists (it is correct)',
  /button,\s*\[role="button"\][^{]*\{[^}]*min-height:\s*var\(--min-tap\)[^}]*min-width:\s*var\(--min-tap\)/.test(INDEX_CSS));
const buttonTags = SRC_CODE.match(/<button\b/g) || [];
check('the source renders exactly one kind of <button>: the slide',
  buttonTags.length === 1 && /<button[^>]*className=\{`rhs-slide/.test(SRC_CODE));
check('the indicator is spans, never buttons, and takes no pointer',
  /className="rhs-timeline"/.test(SRC) && /<span key=\{i\} className=\{`rhs-seg/.test(SRC)
  && !/rhs-dot/.test(SRC) && !/rhs-dot/.test(CSS)
  && /\.rhs-timeline\s*\{[^}]*pointer-events:\s*none/.test(CSS));
check('the circular «go» arrow at the end of each slide is gone',
  !/rhs-go/.test(SRC) && !/rhs-go/.test(CSS) && !/<Arrow\b/.test(SRC) && !/function Arrow\(/.test(SRC));
check('no role="button" or role="tab" is minted anywhere in the banner',
  !/role="button"|role="tab"/.test(SRC));
check('the active segment fills over the same dwell the timer uses',
  /animationDuration: `\$\{AUTO_MS\}ms`/.test(SRC) && /const AUTO_MS = 10000/.test(SRC)
  && /\.rhs-seg-fill\s*\{[^}]*animation-name:\s*rhsFill/.test(CSS));
check('the fill is re-keyed on slide AND on pause/resume, so it can never drift from the timer',
  /key=\{`\$\{index\}-\$\{autoplay \? 'run' : 'hold'\}`\}/.test(SRC)
  && /\.rhs\.is-paused \.rhs-seg-fill\s*\{[^}]*animation-play-state:\s*paused/.test(CSS));

/* ── 4. bigger, rounder ────────────────────────────────────────────────── */
check('the box grew: 112px tall on phones, 128px from 640px',
  /\.rhs\s*\{[^}]*height:\s*112px/.test(CSS)
  && /@media \(min-width: 640px\)\s*\{\s*\.rhs\s*\{[^}]*height:\s*128px/.test(CSS));
check('the card has rounded corners in both breakpoints (22px / 24px)',
  /\.rhs\s*\{[^}]*border-radius:\s*22px/.test(CSS)
  && /@media \(min-width: 640px\)\s*\{\s*\.rhs\s*\{[^}]*border-radius:\s*24px/.test(CSS));
check('the orb icon is 60px on phones and 66px wider',
  /\.rhs-orb\s*\{[^}]*width:\s*60px/.test(CSS) && /\.rhs-orb\s*\{[^}]*width:\s*66px/.test(CSS));

/* ── 5. minimal text, rich box ─────────────────────────────────────────── */
check('two slides, nothing else in the track',
  (SRC.match(/<Slide /g) || []).length === 2);
check('no chips, eyebrow, badge or feature rows survived the cut',
  !/rhb-chip|rhb-eyebrow|rhb-badge|rhb-feat|chip|eyebrow|badge/.test(CSS));
check('each slide is one title + one short line (the minimum the earlier report asked for)',
  (SRC.match(/title: isEn \?/g) || []).length === 2
  && (SRC.match(/sub: isEn \?/g) || []).length === 2);
check('the decoration is all there: two aurora fields, a comet, a sweep, a grid, an orb, a sparkline',
  /className="rhs-glow rhs-glow--rwa"/.test(SRC) && /className="rhs-glow rhs-glow--hz"/.test(SRC)
  && /className="rhs-frame"/.test(SRC) && /className="rhs-sweep"/.test(SRC) && /className="rhs-grid"/.test(SRC)
  && /className="rhs-orb"/.test(SRC) && /className="rhs-art"/.test(SRC)
  && /\.rhs-frame::before\s*\{[^}]*conic-gradient/.test(CSS)
  && /\.rhs-ring-dash\s*\{/.test(CSS) && /\.rhs-ring-arc\s*\{/.test(CSS));
check('the aurora cross-fades with the slide (each field lit only for its own slide)',
  /\.rhs\[data-slide='hz'\] \.rhs-glow--rwa,\s*\.rhs\[data-slide='rwa'\] \.rhs-glow--hz \{ opacity: 0; \}/.test(CSS)
  && /\.rhs-glow\s*\{[^}]*transition:\s*opacity/.test(CSS));
check('the sparkline path is stroke-only (an unfilled open path would paint a black wedge)',
  /className="rhs-spark-line" d=\{d\} fill="none"/.test(SRC));
check('the glyphs are drawn SVG, not emoji',
  /function RwaGlyph\(\)/.test(SRC) && /function HorizonGlyph\(\)/.test(SRC)
  && !/[⚡⛓📊🛡🔒🧾🏛💰🌍🌐🥇]/u.test(SRC));

/* ── 6. motion budget ──────────────────────────────────────────────────── */
const keyframeBlocks = [...CSS_CODE.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\}\s*\}/g)];
const ALLOWED = new Set(['transform', 'opacity', 'stroke-dashoffset']);
const offenders = [];
for (const [, name, body] of keyframeBlocks) {
  for (const prop of [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])) {
    if (!ALLOWED.has(prop)) offenders.push(`${name}:${prop}`);
  }
}
check(`every keyframe animates only transform / opacity / stroke-dashoffset (${keyframeBlocks.length} keyframes${offenders.length ? `; offenders: ${offenders.join(', ')}` : ''})`,
  keyframeBlocks.length >= 12 && offenders.length === 0);
check('no animated filter, blur or custom-property paint animation anywhere in the banner',
  !/animation:[^;]*rotate-angle/.test(CSS) && !/filter:\s*blur/.test(CSS_CODE));
check('the slide that is out of sight has its decoration paused',
  /\.rhs-slide:not\(\.is-active\) \*,[\s\S]*?animation-play-state:\s*paused/.test(CSS));
check('reduced motion stops everything and leaves the still frame complete',
  /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.rhs \*,[\s\S]*animation: none !important/.test(CSS)
  && /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.rhs-spark-line \{ stroke-dashoffset: 0; \}/.test(CSS)
  && /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.rhs-sweep, \.rhs-frame \{ display: none; \}/.test(CSS));
check('autoplay never pauses on a touch tap (hover-to-pause is gated on a real hover)',
  /matchMedia\?\.\('\(hover: hover\)'\)/.test(SRC) && /if \(canHover\) setPaused\(true\)/.test(SRC));

/* ── 7. theme — the real stylesheets, both themes, WCAG contrast ───────── */
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
 * exact pairs the themes publish — must clear the contrast bar.
 */
function themeTokens(theme) {
  /* The token values the themes publish (src/index.css), plus the banner accents. */
  const dark = {
    '--bg-void': '#000000', '--bg-panel': 'rgba(255, 255, 255, 0.055)', '--bg-panel-solid': '#0a0c12',
    '--bg-raised': 'rgba(255, 255, 255, 0.06)', '--line': 'rgba(255, 255, 255, 0.09)',
    '--line-strong': 'rgba(255, 255, 255, 0.16)',
    '--text-1': '#ffffff', '--text-2': '#9aa4bf', '--text-3': '#5b647f',
    '--rhs-acc-rwa': '#f5b942', '--rhs-acc-rwa-2': '#7c4dff', '--rhs-acc-hz': '#00e5ff', '--rhs-acc-hz-2': '#00ff9d',
    '--rhs-glow-a': 0.26, '--rhs-glow-b': 0.20, '--rwb-acc': '#f5b942'
  };
  /* `:root[data-theme='light']` — what the app sets once it has resolved the theme */
  const light = {
    '--bg-void': '#f4f5fa', '--bg-panel': 'rgba(255, 255, 255, 0.9)', '--bg-panel-solid': '#ffffff',
    '--bg-raised': 'rgba(255, 255, 255, 0.95)', '--line': 'rgba(16, 20, 40, 0.1)',
    '--line-strong': 'rgba(16, 20, 40, 0.2)',
    '--text-1': '#0d1020', '--text-2': '#4d5570', '--text-3': '#838aa5',
    '--rhs-acc-rwa': '#a86a00', '--rhs-acc-rwa-2': '#5b46c9', '--rhs-acc-hz': '#00758a', '--rhs-acc-hz-2': '#00795c',
    '--rhs-glow-a': 0.14, '--rhs-glow-b': 0.10, '--rwb-acc': '#a86a00'
  };
  /* the pre-paint `prefers-color-scheme: light` fallback, before data-theme exists */
  const lightBoot = {
    ...light,
    '--bg-void': '#ffffff', '--bg-panel': 'rgba(0, 0, 0, 0.03)', '--bg-raised': 'rgba(0, 0, 0, 0.04)',
    '--line': 'rgba(0, 0, 0, 0.08)', '--line-strong': 'rgba(0, 0, 0, 0.15)',
    '--text-1': '#1a1a2e', '--text-2': '#4a5568'
  };
  return theme === 'light' ? light : theme === 'light-boot' ? lightBoot : dark;
}

/* The token each element binds to, straight out of the stylesheet text. */
const ruleOf = (css, re) => (re.exec(css)?.[1] ?? '').trim();
const BINDS = {
  viewport: /\.rhs-viewport\s*\{[^}]*background:\s*([^;]*);/,
  title: /\.rhs-title\s*\{[^}]*color:\s*([^;]*);/,
  sub: /\.rhs-sub\s*\{[^}]*color:\s*([^;]*);/,
  segFill: /\.rhs-seg-fill\s*\{[^}]*background:\s*([^;]*);/,
  orb: /\.rhs-orb\s*\{[^}]*color:\s*([^;]*);/,
  sep: /\.rhs-sep\s*\{[^}]*background:\s*([^;]*);/,
  rwbTitle: /\.rwb-title\s*\{[^}]*color:\s*([^;]*);/,
  rwbBody: /\.rwb-body\s*\{[^}]*color:\s*([^;]*);/,
  rwbFee: /\.rwb-fee\s*\{[^}]*color:\s*([^;]*);/,
  rwbBorder: /\.rwb\s*\{[^}]*border:\s*([^;]*);/
};
const TOKEN = (v) => (v.match(/var\((--[a-z0-9-]+)\)/)?.[1] ?? null);

/* The aurora alphas, read from the stylesheet so a stronger glow fails here. */
const glowA = (block) => parseFloat(ruleOf(CSS, new RegExp(`${block}[^}]*--rhs-glow-a:\\s*([\\d.]+)%`))) / 100;
const glowB = (block) => parseFloat(ruleOf(CSS, new RegExp(`${block}[^}]*--rhs-glow-b:\\s*([\\d.]+)%`))) / 100;
check('the aurora alphas in the stylesheet are the ones this probe composites with',
  glowA('\\.rhs\\s*\\{') === 0.26 && glowB('\\.rhs\\s*\\{') === 0.20
  && glowA(":root\\[data-theme='light'\\] \\.rhs\\s*\\{") === 0.14
  && glowB(":root\\[data-theme='light'\\] \\.rhs\\s*\\{") === 0.10);

/*
 * The glow's centre sits behind the orb (14% in from the start edge); the
 * field is an ellipse whose colour is gone at 72% of a 42%-wide radius. At
 * the title's first letter (~100px in on a 358px banner) that leaves roughly
 * a third of the peak alpha; the drift adds a little. 45% of the peak is a
 * conservative ceiling for what can ever sit under text.
 */
const UNDER_TEXT = 0.45;

for (const theme of ['dark', 'light', 'light-boot']) {
  const tokens = themeTokens(theme);
  const voidBg = tokens['--bg-void'];
  const panel = over(tokens['--bg-panel'], voidBg, alphaOf(tokens['--bg-panel']));

  /* worst case under the text: the strongest tint either palette can lay
     over the panel where the title starts */
  const surfaces = [];
  for (const [acc, acc2] of [[tokens['--rhs-acc-rwa'], tokens['--rhs-acc-rwa-2']], [tokens['--rhs-acc-hz'], tokens['--rhs-acc-hz-2']]]) {
    surfaces.push(over(acc, panel, tokens['--rhs-glow-a'] * UNDER_TEXT));
    surfaces.push(over(acc2, panel, tokens['--rhs-glow-b'] * UNDER_TEXT));
  }
  const bind = (k) => TOKEN(ruleOf(CSS, BINDS[k]));
  const used = (k) => tokens[bind(k)] ?? tokens['--text-2'];
  const worst = (fg) => Math.min(...surfaces.map((s) => ratio(fg, s) ?? 0));

  const r = worst(used('title'));
  check(`[${theme}] the slide title clears WCAG AA over the tinted glass, both palettes (${r.toFixed(2)}:1)`, r >= 4.5);
  const rs = worst(used('sub'));
  check(`[${theme}] the slide subline is legible over the tinted glass, both palettes (${rs.toFixed(2)}:1)`, rs >= 4.5);
  /* the orb glyph and the separators are painted in the slide accent */
  const ra = Math.min(ratio(tokens['--rhs-acc-rwa'], panel), ratio(tokens['--rhs-acc-hz'], panel));
  check(`[${theme}] both accents keep contrast on the glass for the orb and the separators (${ra.toFixed(2)}:1)`, ra >= 3);
  /* the fill segment is the accent too, on the panel */
  check(`[${theme}] the active segment's fill is visible (${ra.toFixed(2)}:1)`, bind('segFill') === '--acc' && ra >= 3);

  const rwbSurface = over(tokens['--rwb-acc'], panel, 0.08);
  const rtt = ratio(used('rwbTitle'), rwbSurface);
  check(`[${theme}] the RWA banner title clears WCAG AA (${rtt ? rtt.toFixed(2) : '?'}:1)`, rtt !== null && rtt >= 4.5);
  const rrb = ratio(used('rwbBody'), rwbSurface);
  check(`[${theme}] the RWA banner body is legible (${rrb ? rrb.toFixed(2) : '?'}:1)`, rrb !== null && rrb >= 4.5);
}

/* The bindings themselves: each element must use the token, not a literal. */
check('the slide title, subline, surface, orb and separators bind to app tokens / the palette',
  ruleOf(CSS, BINDS.title) === 'var(--text-1)' && ruleOf(CSS, BINDS.sub) === 'var(--text-2)'
  && ruleOf(CSS, BINDS.viewport) === 'var(--bg-panel)'
  && ruleOf(CSS, BINDS.orb) === 'var(--acc)' && ruleOf(CSS, BINDS.sep) === 'var(--acc)');
check('the palette is switched by the slide, on the root (glow, comet, orb and separators follow)',
  /\.rhs\[data-slide='rwa'\] \{ --acc: var\(--rhs-acc-rwa\); --acc2: var\(--rhs-acc-rwa-2\); \}/.test(CSS)
  && /\.rhs\[data-slide='hz'\] \{ --acc: var\(--rhs-acc-hz\); --acc2: var\(--rhs-acc-hz-2\); \}/.test(CSS));
check('the RWA banner binds its text, border and accent to tokens too',
  ruleOf(CSS, BINDS.rwbTitle) === 'var(--text-1)' && ruleOf(CSS, BINDS.rwbBody) === 'var(--text-2)'
  && ruleOf(CSS, BINDS.rwbFee) === 'var(--text-2)'
  && ruleOf(CSS, BINDS.rwbBorder) === '1px solid var(--line)');
check('light theme deepens the accents (no neon gold/cyan on the white canvas) and quiets the aurora',
  /:root\[data-theme='light'\] \.rhs \{[^}]*--rhs-acc-rwa: #a86a00;[^}]*--rhs-acc-hz: #00758a;/.test(CSS)
  && /:root\[data-theme='light'\] \.rhs \{[^}]*--rhs-glow-a: 14%;/.test(CSS)
  && /:root\[data-theme='light'\] \.rwb \{ --rwb-acc: #a86a00; \}/.test(CSS));
check('the pre-paint light fallback carries the same deep accents and quiet aurora',
  /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme='dark'\]\):not\(\[data-theme='light'\]\) \.rhs \{[^}]*--rhs-acc-rwa: #a86a00;[^}]*--rhs-glow-a: 14%;/.test(CSS));
check('the light sweep is white light in both themes (a dark sweep on white glass reads as a shadow)',
  /\.rhs\s*\{[^}]*--rhs-sweep: rgba\(255, 255, 255, 0\.075\)/.test(CSS)
  && /:root\[data-theme='light'\] \.rhs \{[^}]*--rhs-sweep: rgba\(255, 255, 255, 0\.85\)/.test(CSS));

/* ── 8. language — the source-level rule ───────────────────────────────── */
check('the copy rule is «Persian if and only if fa» (not isRTL)',
  /isEn = !l\.startsWith\('fa'\)/.test(SRC) && !/isRTL\s*&&/.test(SRC));
check('both languages exist in the copy table',
  SRC.includes('دارایی‌های واقعی') && SRC.includes('Real-World Assets')
  && SRC.includes('افق جهانی') && SRC.includes('Global Horizon'));
check('direction follows the page: dir on the root, logical placement for the art, mirrored fill origin',
  /dir=\{isRTL \? 'rtl' : 'ltr'\}/.test(SRC)
  && /\.rhs-art\s*\{[^}]*inset-inline-end:\s*0/.test(CSS)
  && /\.rhs\[dir='rtl'\] \.rhs-seg-fill \{ transform-origin: 100% 50%; \}/.test(CSS)
  && /\.rhs\[dir='rtl'\] \{ --dir: -1;/.test(CSS));

/* ── the RWA section banner: same text, still a banner ─────────────────── */
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
