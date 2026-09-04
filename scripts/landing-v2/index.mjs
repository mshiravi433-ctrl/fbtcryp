/**
 * LANDING PAGE 2.0 — THE BILINGUAL FBT FINANCIAL OS LANDING.
 * ---------------------------------------------------------------------------
 * Renders `/صرافی-غیرمتمرکز` as a single, self-contained HTML document:
 *
 *   • BILINGUAL. English is the default document language; every visible
 *     string exists in the DOM exactly twice (`span.lg-en` / `span.lg-fa`)
 *     and one `data-lang` attribute (plus CSS) decides which renders. A
 *     crawler sees real English AND real Persian copy; a no-JS visitor gets
 *     the English default; a Persian visitor who stored their choice never
 *     sees an English frame, thanks to the pre-paint script in <head>.
 *
 *   • SEO-FIRST是看. Static headings, prose, FAQ and JSON-LD (WebSite,
 *     Organization, SoftwareApplication, FAQPage, BreadcrumbList) ship in the
 *     HTML. Dynamic numbers arrive later and never block first paint.
 *
 *   • HONEST DATA ONLY. Live numbers come from the app's own public API at
 *     runtime: /api/global, /api/markets, /api/trending, /api/yields,
 *     /api/solana/assets. Anything that fails renders "Data unavailable" —
 *     never a placeholder number. No TVL, APY, rank, user-count or profit
 *     claim is ever written into static copy.
 *
 *   • MOBILE-FIRST, ZERO-DEP. One document, one inline stylesheet, one
 *     inline script, two local fonts. No framework, no network JS/CSS.
 */

import { COPY } from './copy.mjs';
import { CSS } from './styles.mjs';
import { RUNTIME } from './runtime.mjs';
import { lottieScript, lottieSlot } from './lottie.mjs';

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * THE STORE BUILD CANNOT CARRY THIS VOCABULARY.
 *
 * APKPure rejected this app for «illegal sensitive words», and the fix in
 * vite.config.js was to strip margin/prediction copy from the LOCALE files at
 * build time — because a content filter reads strings, not call graphs, and a
 * build whose screens are gone but whose words survive fails review for exactly
 * the same reason.
 *
 * The landing page is a generated HTML file that ships inside `dist/`, so the
 * APK carries it too, and a slideshow that advertises «Futures · leverage ·
 * liquidation» would put the rejected words back into the store artefact. So
 * the same flag that removes the /perp route from the app also removes the
 * slide and the dock tile that point at it. Route and copy, one switch — the
 * rule the rest of the build already follows.
 */
const SPECULATION = process.env.VITE_ENABLE_SPECULATION !== 'false';
export function gateSpeculation(list, enabled = SPECULATION) {
  return enabled ? list : list.filter((it) => it.speculative !== true);
}

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Escape a JSON-LD payload so content can never close its <script> tag. */
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * The bilingual inline unit. Every human-visible string on the page goes
 * through this: the English copy and the Persian copy sit side by side in
 * the DOM, and the root data-lang + CSS decides which one is visible.
 */
const T = (pair) =>
  `<span class="lg lg-en">${esc(pair.en)}</span><span class="lg lg-fa" lang="fa" dir="rtl">${esc(pair.fa)}</span>`;

const FA_DIGITS = { 0: '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴', '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹' };
const toFaDigits = (s) => String(s).replace(/[0-9]/g, (d) => FA_DIGITS[d]).replace(/\./g, '٫');

/**
 * The platform fee, resolved exactly like src/lib/feeBps.js does for the
 * app: VITE_FEE_BPS if it is a sane integer, else the 70 bps default, hard
 * capped at 100 bps. A landing page that says one number while the engine
 * charges another is the worst kind of bug; both read the same variable.
 */
const FEE_BPS_DEFAULT = 70;
const FEE_BPS_MAX = 100;
function resolveFeeBps(envVal) {
  if (envVal == null || envVal === '') return FEE_BPS_DEFAULT;
  const n = Number(envVal);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > FEE_BPS_MAX) return FEE_BPS_DEFAULT;
  return n;
}
/** bps → "0.7" style human percentage string (trailing zeros trimmed). */
const feePct = (bps) => String(bps / 100).replace(/\.0+$|(\.\d*?)0+$/, '$1');

/** Replace {{fee}} in copy with the localized fee figure. */
function fillFee(str, feeStr, lang) {
  return str.replace(/\{\{fee\}\}/g, lang === 'fa' ? toFaDigits(feeStr) : feeStr);
}

/* ------------------------------------------------------------------ */
/* The icon set — one inline SVG sprite, drawn with a pen             */
/* ------------------------------------------------------------------ */

/**
 * Every icon on the page is a <symbol> in one sprite, referenced with <use>.
 *
 * Why a sprite and not inline copies: the same 12 glyphs appear in the header
 * menu, the slideshow, the ecosystem grid and the bottom dock, and a browser
 * that parses a path four times pays for it four times. With a sprite the
 * geometry exists once, and 60 references to it are ~40 bytes each.
 *
 * Why hand-drawn paths and not an icon font or a package: an icon font costs
 * a font download and mis-renders to a crawler as private-use boxes; a package
 * would be another network request in a document whose rule is zero of them.
 *
 * pathLength="100" is stamped onto every path by `sym()` for one reason: it
 * makes the draw-in animation (`stroke-dashoffset` 100 → 0) identical for a
 * 6-unit tick and a 20-unit arc, so no per-icon tuning is needed.
 */
const STROKE_ATTRS = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

const sym = (id, inner, box) =>
  `<symbol id="ic-${id}" viewBox="${box || '0 0 24 24'}" ${STROKE_ATTRS}>${inner.replace(/<(path|circle|rect|line)\b/g, '<$1 pathLength="100"')}</symbol>`;

const SYMBOLS = {
  swap:
    '<path d="M4 8h13"/><path d="M14 5l3.4 3-3.4 3"/><path d="M20 16H7"/><path d="M10 13l-3.4 3 3.4 3"/><circle cx="4" cy="8" r="1.1"/><circle cx="20" cy="16" r="1.1"/>',
  wallet:
    '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><path d="M16.5 14.6h2.6"/><path d="M6 6V4.6A1.6 1.6 0 0 1 7.6 3h8.8"/>',
  signals:
    '<path d="M3 20h18"/><path d="M6 20v-6"/><path d="M11 20V8"/><path d="M16 20v-9"/><path d="M21 20V4"/><path d="M4.5 12.5l5-4 5 3 5-6"/>',
  intent:
    '<path d="M20.5 11.6a8.4 8.4 0 0 1-8.4 8.4c-1.4 0-2.7-.3-3.9-.9L3.4 20.6l1.6-4.6a8.4 8.4 0 1 1 15.5-4.4z"/><path d="M8.6 11.7h.01M12.1 11.7h.01M15.6 11.7h.01"/>',
  smartMoney:
    '<path d="M3 15.5c2.2-4 5.2-6 9-6s6.8 2 9 6"/><path d="M3 15.5c2.2 3.4 5.2 5.1 9 5.1s6.8-1.7 9-5.1"/><circle cx="12" cy="6" r="2.4"/><path d="M12 3.2v-1M12 9.8v-1"/>',
  farm:
    '<path d="M12 21V10"/><path d="M12 10c0-4 2.9-6.8 7.6-6.8 0 4-2.9 6.8-7.6 6.8z"/><path d="M12 14.4c0-3-2.2-5-5.7-5 0 3 2.2 5 5.7 5z"/><path d="M8 21h8"/>',
  orders:
    '<path d="M18 9.4A6 6 0 1 0 6 9.4c0 5.8-2 6.9-2 6.9h16s-2-1.1-2-6.9"/><path d="M10 19.6a2.2 2.2 0 0 0 4 0"/><path d="M12 3.4V2"/>',
  lending:
    '<circle cx="8.4" cy="8.4" r="3.9"/><circle cx="15.6" cy="15.6" r="3.9"/><path d="M13.3 6.2l-2.6 11.6"/><path d="M8.4 6.4v4M6.5 8.4h3.8"/>',
  stocks:
    '<rect x="3.6" y="10.4" width="4.4" height="8" rx="1.4"/><path d="M5.8 6.4v4M5.8 18.4v2.2"/><rect x="15.8" y="5.6" width="4.4" height="9" rx="1.4"/><path d="M18 2.6v3M18 14.6v6"/><path d="M11 21.4h-6M19.4 21.4h-3"/>',
  rwa:
    '<path d="M3 20.6h18"/><path d="M5.2 20.6V8.6L12 4l6.8 4.6v12"/><path d="M9.4 20.6v-6.2h5.2v6.2"/><path d="M12 10.4v2"/>',
  ai:
    '<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="3"/><path d="M10.4 10.4h3.2v3.2h-3.2z"/><path d="M12 2.6v4M12 17.4v4M2.6 12h4M17.4 12h4M5 5l2.4 2.4M19 5l-2.4 2.4M5 19l2.4-2.4M19 19l-2.4-2.4"/>',
  gold:
    '<path d="M12 3.4l2.1 4.5 4.9.7-3.6 3.4.9 4.9L12 14.6l-4.3 2.3.9-4.9L5 8.6l4.9-.7z"/><path d="M4.4 20.4h15.2"/><path d="M7.4 17.6h9.2"/>',
  futures:
    '<path d="M3 20.6h18"/><path d="M6.6 20.6v-4.2M6.6 9.4v-3.2"/><rect x="4.8" y="11.6" width="3.6" height="4.8" rx="1.2"/><path d="M13.4 20.6v-6M13.4 10V5.4"/><rect x="11.6" y="7.6" width="3.6" height="7" rx="1.2"/><path d="M20 20.6v-2.4M20 12.4V9"/><rect x="18.2" y="10.6" width="3.6" height="5.4" rx="1.2"/>',
  tokens:
    '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2v9.6M9.4 9.6h3.7a1.9 1.9 0 0 1 0 3.8h-3.4M9.4 13.2h4"/>',
  network:
    '<circle cx="12" cy="4.6" r="2.1"/><circle cx="4.8" cy="18.4" r="2.1"/><circle cx="19.2" cy="18.4" r="2.1"/><path d="M12 6.7l-6 9.6M12 6.7l6 9.6M6.9 18.4h10.2"/>',
  explore:
    '<circle cx="12" cy="12" r="9"/><path d="M15.1 8.9l-2.1 5.8-3.8-5.8 5.9 5.9z"/><path d="M12 2.4v1.8M21.6 12h-1.8"/>',
  shield:
    '<path d="M12 2.8l7.4 3v5.9c0 4.6-3.1 7.7-7.4 9.1-4.3-1.4-7.4-4.5-7.4-9.1V5.8z"/><path d="M9 11.9l2.1 2.2 3.8-4.3"/>',
  key:
    '<circle cx="8" cy="15.4" r="4"/><path d="M10.7 12.4L20.4 2.7"/><path d="M16.4 6.7l2.9 2.9M18.9 4.2l2.5 2.5"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6M12 3c2.8 2.6 4.1 5.7 4.1 9s-1.3 6.4-4.1 9c-2.8-2.6-4.1-5.7-4.1-9S9.2 5.6 12 3z"/>',
  zap: '<path d="M13.4 2.4L4.6 14.2h5.6l-1 7.4 9-12h-5.6z"/>',
  brain:
    '<path d="M9.4 4.2a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 3 5 3 3 0 0 0 4.6 1.6 3 3 0 0 0 4.6-1.6 3 3 0 0 0 3-5 3 3 0 0 0-2-5 3 3 0 0 0-3-3 2.6 2.6 0 0 0-2.6 1.4 2.6 2.6 0 0 0-2.6-1.4z"/><path d="M12 5.6v13.2"/><path d="M9 9.4h1.6M13.4 13h1.6"/>',
  doc:
    '<path d="M14.2 3H7.4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V7.8z"/><path d="M14.2 3v4.8H19M9 13h6M9 17h4"/>',
  link:
    '<path d="M10.2 13.8a4.6 4.6 0 0 0 6.6 0l2.6-2.6a4.6 4.6 0 1 0-6.5-6.5l-1.3 1.3"/><path d="M13.8 10.2a4.6 4.6 0 0 0-6.6 0l-2.6 2.6a4.6 4.6 0 1 0 6.5 6.5l1.3-1.3"/>',
  spark:
    '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.4 15.4l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8z"/>',
  eye: '<path d="M2.4 12s3.6-6.8 9.6-6.8 9.6 6.8 9.6 6.8-3.6 6.8-9.6 6.8S2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.9"/>',
  lock: '<rect x="4.8" y="10.6" width="14.4" height="9.6" rx="2.6"/><path d="M8.2 10.6V7.8a3.8 3.8 0 0 1 7.6 0v2.8"/><path d="M12 14.4v2.4"/>',
  radar:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2"/><circle cx="12" cy="12" r="1.2"/><path d="M12 12l6.6-6.6"/>',
  go: '<path d="M7.4 16.6L16.6 7.4"/><path d="M9.2 7.4h7.4v7.4"/>',
  close: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>',
  flowArrow: '<path d="M4.6 12h14"/><path d="M13 6.4l5.6 5.6-5.6 5.6"/>',
  chevron: '<path d="M9.4 5.6l6.4 6.4-6.4 6.4"/>',
  play: '<path d="M8 5.4l10.4 6.6L8 18.6z"/>',
  pause: '<path d="M9 5.6v12.8M15 5.6v12.8"/>',
  grid: '<rect x="3.6" y="3.6" width="7" height="7" rx="2"/><rect x="13.4" y="3.6" width="7" height="7" rx="2"/><rect x="3.6" y="13.4" width="7" height="7" rx="2"/><rect x="13.4" y="13.4" width="7" height="7" rx="2"/>',
  bolt: '<path d="M13.2 2.6L5.4 13.4h4.9l-1.2 8 8.4-11.4h-5z"/>'
};

const iconSprite = () =>
  `<svg class="ic-defs" aria-hidden="true" focusable="false" width="0" height="0"><defs><linearGradient id="fbt-ink" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#b79cff"/><stop offset="0.55" stop-color="#4eeaff"/><stop offset="1" stop-color="#63f5bb"/></linearGradient></defs>${Object.keys(SYMBOLS)
    .map((k) => sym(k, SYMBOLS[k]))
    .join('')}</svg>`;

const ICONS = {
  flowArrow:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="arr"><path d="M4.6 12h14"/><path d="M13 6.4l5.6 5.6-5.6 5.6"/></svg>'
};

/**
 * The public icon call: `<svg class="ic"><use href="#ic-name"/></svg>`.
 * `aria-hidden` because every one of these sits next to its own text label.
 */
const ic = (name, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-${SYMBOLS[name] ? name : 'spark'}"></use></svg>`;
const icon = (name, cls) => `<span class="card-icon ${cls || ''}">${ic(name)}</span>`;

/* ------------------------------------------------------------------ */
/* Section builders                                                     */
/* ------------------------------------------------------------------ */

function skeletonRow(cols) {
  return `<div class="skel-row">${`<span class="skel skel-dot"></span><span class="skel skel-line"></span><span class="skel skel-line sh"></span>`}</div>`;
}

function skeletonTableBody(rows = 6) {
  const one =
    `<tr><td><div class="coin-cell"><span class="skel skel-dot"></span><span class="col"><span class="skel skel-line" style="width:54px;display:block"></span></span></div></td>` +
    `<td><span class="skel skel-line" style="width:70px;display:block"></span></td>` +
    `<td><span class="skel skel-line" style="width:52px;display:block"></span></td>` +
    `<td><span class="skel skel-line" style="width:82px;display:block"></span></td>` +
    `<td><span class="skel skel-line" style="width:82px;display:block"></span></td>` +
    `<td><span class="skel skel-line" style="width:96px;display:block"></span></td></tr>`;
  return one.repeat(rows);
}

function secHead({ kicker, h2, lede, center }) {
  return `<div class="sec-head ${center ? 'center' : ''} reveal">
      <p class="kicker">${kicker}</p>
      <h2>${typeof h2 === 'string' ? h2 : T(h2)}</h2>
      ${lede ? `<p class="sec-lede">${T(lede)}</p>` : ''}
    </div>`;
}

/* 1 ── Navigation ------------------------------------------------------ */
/**
 * The header holds the logo and the language switch. Nothing else that used to
 * sit here stayed:
 *
 *   • The wordmark is gone — «Fbt swap را در هیدر حذف کن و فقط لوگو بماند».
 *     A landing page is not a business card; the brand appears in the tab
 *     title, the JSON-LD, the footer and the logo's own aria-label, and the
 *     repeated 17px text next to the mark was competing with the CTA for the
 *     same 32 pixels of attention.
 *   • The burger is gone, replaced by the circle at the bottom of the viewport
 *     (see `dock`) — the same request in its second half: a menu that opens on
 *     tap, lists the pages, and is there whether you are at the top or the
 *     bottom of the document.
 *   • The Launch-App button grew up. It used to be 13.5px with 10px padding
 *     and `display:none` below 900px, i.e. the single most important action on
 *     the page was the smallest thing on it and invisible on the device most
 *     of our visitors use.
 */
function nav(site) {
  const links = COPY.nav.links
    .map((l) => `<a href="${l.href}" data-section-link="${l.href.slice(1)}">${ic(sectionIcon(l.href))}<span>${T({ en: l.en, fa: l.fa })}</span></a>`)
    .join('');
  return `<header id="site-nav" class="nav">
    <div class="wrap nav-inner">
      <a class="brand" href="${site}/" aria-label="${esc(COPY.nav.brandLabel.en)}" title="${esc(COPY.meta.en.title)}">
        <span class="brand-mark"><img src="/icon-192.png" alt="" width="34" height="34"><span class="brand-ring"></span></span>
      </a>
      <nav class="nav-links" aria-label="Sections">${links}</nav>
      <span class="nav-spacer"></span>
      <div class="lang-switch" role="group" aria-label="${esc(COPY.nav.langLabel.en)}" data-lang-group>
        <button class="lang-btn" type="button" data-setlang="en" aria-pressed="true">EN</button>
        <button class="lang-btn" type="button" data-setlang="fa" aria-pressed="false">فارسی</button>
      </div>
      <a class="btn btn-primary nav-cta" href="${site}/#/intent">${ic('zap', 'ic-in-btn')}<span>${T(COPY.nav.cta)}</span>${ICONS.flowArrow}</a>
    </div>
  </header>`;
}

const sectionIcon = (href) =>
  ({
    '#showcase': 'explore',
    '#intent-os': 'intent',
    '#tokens': 'tokens',
    '#signals': 'signals',
    '#networks': 'network',
    '#ecosystem': 'grid',
    '#faq': 'doc'
  }[href] || 'spark');

/* 1b ── The bottom dock: the page menu inside a circle ----------------- */
/**
 * The circle at the bottom of the screen.
 *
 * It is a checkbox plus a label, so opening the menu needs no JavaScript at
 * all — the script only adds the closing behaviours and the scroll-progress
 * ring. Every tile is a real link (app routes get an ↗ mark, page anchors do
 * not), so with the runtime blocked the menu is still the menu.
 */
function dock(site) {
  const tiles = gateSpeculation(COPY.dock.pages)
    .map(
      (p, i) => `<a class="dock-tile" href="${p.href.startsWith('/#') ? site + p.href : p.href}"${p.href.startsWith('#') ? ` data-section-link="${p.href.slice(1)}"` : ''} style="--i:${i}">
        ${ic(p.icon)}<span>${T({ en: p.en, fa: p.fa })}</span>${p.app ? '<i class="dock-out" aria-hidden="true">↗</i>' : ''}
      </a>`
    )
    .join('');
  return `<div class="dock" id="page-dock">
    <input class="dock-state" type="checkbox" id="dock-state" aria-describedby="dock-hint">
    <div class="dock-scrim" data-dock-scrim></div>
    <nav class="dock-menu" id="dock-menu" aria-label="${esc(COPY.dock.label.en)}">
      <div class="dock-head">
        <span class="dock-title">${ic('grid')}<b>${T(COPY.dock.heading)}</b></span>
        <span class="dock-prog"><i data-dock-bar></i></span>
      </div>
      <p class="dock-hint" id="dock-hint">${T(COPY.dock.hint)}</p>
      <div class="dock-grid">${tiles}</div>
      <div class="dock-foot">
        <div class="lang-switch" role="group" aria-label="${esc(COPY.nav.langLabel.en)}" data-lang-group>
          <button class="lang-btn" type="button" data-setlang="en" aria-pressed="true">EN</button>
          <button class="lang-btn" type="button" data-setlang="fa" aria-pressed="false">فارسی</button>
        </div>
        <a class="btn btn-primary dock-launch" href="${site}/#/intent">${ic('zap', 'ic-in-btn')}<span>${T(COPY.nav.cta)}</span>${ICONS.flowArrow}</a>
      </div>
    </nav>
    <label class="dock-orb" id="dock-orb" for="dock-state" role="button" tabindex="0" aria-controls="dock-menu" aria-expanded="false" aria-label="${esc(COPY.dock.open.en)}">
      <svg class="dock-ring" viewBox="0 0 44 44" aria-hidden="true">
        <circle class="dock-ring-track" cx="22" cy="22" r="20"></circle>
        <circle class="dock-ring-fill" id="dock-ring-fill" cx="22" cy="22" r="20" pathLength="100"></circle>
      </svg>
      <span class="dock-orb-face">
        <span class="dock-ic-open">${ic('grid')}</span>
        <span class="dock-ic-close">${ic('close')}</span>
      </span>
      <span class="dock-orb-glow" aria-hidden="true"></span>
    </label>
  </div>`;
}

/* 1c ── The animated space backdrop -------------------------------------- */
/**
 * Background of animated lines, as asked for («پس‌زمینه از خطوط انیمیشنی
 * استفاده کند»), now with a star field so the environment reads as space:
 * stars twinkle and a bright meteor streaks across every now and then
 * («در پشت زمینه ستاره ها بدرخشند و گاهی یک شهاب سنگ نورانی رد شود»).
 * Deliberately cheap:
 *
 *   • three tiled layers of tiny stars — background-image radial gradients,
 *     each twinkling (opacity) and drifting (background-position) on its own
 *     clock, which is what sells the depth;
 *   • two meteors: a 2px gradient streak that sits at opacity 0 for most of
 *     a long cycle and then crosses the viewport in a second or two;
 *   • one inline SVG of six long curves whose stroke-dashoffset travels, so
 *     the lines read as flowing rather than as a static wireframe;
 *   • a drifting grid, already in .ambient-grid;
 *   • two soft orbs;
 *   • a single "beam" that scans down the viewport once per slow cycle.
 *
 * No canvas, no filter, no per-frame JavaScript: transform/dashoffset on
 * ~12 elements is compositor work, and the whole layer is display:none under
 * prefers-reduced-motion.
 */
function ambient() {
  const rows = [
    { y: 60, amp: 34, dur: 26, delay: 0, color: 'rgba(139,92,246,0.55)', w: 1.2 },
    { y: 150, amp: 22, dur: 34, delay: -6, color: 'rgba(78,234,255,0.45)', w: 1 },
    { y: 240, amp: 40, dur: 30, delay: -12, color: 'rgba(99,245,187,0.32)', w: 1.1 },
    { y: 330, amp: 26, dur: 38, delay: -3, color: 'rgba(255,104,202,0.3)', w: 1 },
    { y: 420, amp: 46, dur: 44, delay: -18, color: 'rgba(139,92,246,0.35)', w: 1.3 },
    { y: 510, amp: 30, dur: 28, delay: -9, color: 'rgba(78,234,255,0.26)', w: 1 }
  ];
  const paths = rows
    .map((r) => {
      const d = `M-40 ${r.y}C 180 ${r.y - r.amp}, 380 ${r.y + r.amp}, 580 ${r.y}S 980 ${r.y - r.amp}, 1180 ${r.y}S 1580 ${r.y + r.amp}, 1780 ${r.y}`;
      return `<path d="${d}" style="animation-duration:${r.dur}s;animation-delay:${r.delay}s" stroke="${r.color}" stroke-width="${r.w}"></path>`;
    })
    .join('');
  return `<div class="ambient" aria-hidden="true">
    <span class="stars stars-a"></span>
    <span class="stars stars-b"></span>
    <span class="stars stars-c"></span>
    <span class="ambient-grid"></span>
    <svg id="bg-lines" class="bg-lines" viewBox="0 0 1440 560" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>
    <span class="beam"></span>
    <span class="orb orb-a"></span>
    <span class="orb orb-b"></span>
    <span class="orb orb-c"></span>
    <span class="meteor meteor-a"></span>
    <span class="meteor meteor-b"></span>
  </div>`;
}


/* 2 ── Hero ------------------------------------------------------------- */
function hero(site) {
  const chips = COPY.hero.chips.map((c) => `<li class="chip chip-glow">${T(c)}</li>`).join('');
  const intentSteps = ['Intent', 'Strategy', 'Approve', 'Execute'];
  const intentStepsFa = ['نیت', 'استراتژی', 'تأیید', 'اجرا'];
  const flowMini = intentSteps
    .map((s, i) => `<span>${T({ en: s, fa: intentStepsFa[i] })}</span>`)
    .join('');
  /*
   * A coin row inside the hero mockup. The price and the direction marker are
   * separate grid tracks now, and the name is the track that is allowed to
   * truncate: the old flex row with `margin-inline-start:auto` on the price is
   * exactly what was pushing content out of the card at 360px.
   *
   * The direction is an ARROW, not «+2.31%» — the request was explicit, and an
   * arrow is 18px instead of 46, which is what the card did not have.
   */
  const marketRow = (sym, name, id) =>
    `<div class="mrow mrow-coin"><span class="t">${sym}</span><span class="nm">${name}</span><span class="num" id="${id}-p">—</span><span class="chg-arrow flat" id="${id}-c" aria-hidden="true">▬</span></div>`;
  const smRows = COPY.hero.dash.smartMoneyRows.map((r) => `<div class="mrow"><span class="t">◈</span><span>${T(r)}</span></div>`).join('');
  const sig = COPY.signals.tiers
    .map((t) => `<span class="sig-pill sig-${t.key}">${T({ en: t.en, fa: t.fa })}</span>`)
    .join('');
  const firstIntent = COPY.hero.dash.sampleIntents[0];

  return `<section id="hero" class="hero">
    <div class="wrap">
      <div class="hero-grid">
        <div>
          <p class="eyebrow reveal">${T(COPY.hero.eyebrow)}</p>
          <h1 class="reveal" style="--d:60ms">
            <span class="lg lg-en">${esc(COPY.hero.h1Parts.en[0])} <span class="grad">${esc(COPY.hero.h1Parts.en[1])}</span> ${esc(COPY.hero.h1Parts.en[2])}</span>
            <span class="lg lg-fa" lang="fa" dir="rtl">${esc(COPY.hero.h1Parts.fa[0])} <span class="grad">${esc(COPY.hero.h1Parts.fa[1])}</span> ${esc(COPY.hero.h1Parts.fa[2])}</span>
          </h1>
          <p class="hero-sub reveal" style="--d:120ms">${T(COPY.hero.sub)}</p>
          <div class="hero-actions reveal" style="--d:180ms">
            <a class="btn btn-primary" href="${site}/#/swap"><span>${T(COPY.hero.ctaPrimary)}</span>${ICONS.flowArrow}</a>
            <a class="btn btn-ghost" href="#ecosystem"><span>${T(COPY.hero.ctaSecondary)}</span>${ic('chevron', 'ic-flip')}</a>
          </div>
          <ul class="hero-chips reveal" style="--d:240ms">${chips}</ul>
        </div>

        <div class="dash reveal-zoom reveal" style="--d:200ms" data-parallax="9" aria-hidden="true">
          <div class="dash-top">
            <span class="traffic"><i></i><i></i><i></i></span>
            <span class="dash-title">${esc(COPY.hero.dash.title)}</span>
            <span class="dash-live"><span class="live-dot"></span>${T(COPY.hero.pulse.live)}</span>
          </div>
          <div class="dash-grid">
            <div class="mini wide">
              <h4>${T(COPY.hero.dash.intent)}</h4>
              <div class="intent-line">
                <svg class="spark" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/></svg>
                <span id="tw-intent" class="tw">${esc(firstIntent.en)}</span>
              </div>
              <div class="flow-mini">${flowMini}</div>
            </div>
            <div class="mini">
              <h4>${T(COPY.hero.dash.portfolio)}<em>BTC / USD · 7D</em></h4>
              <span class="mini-kpi" id="dp-price">—</span>
              <span class="chg-arrow flat" id="dp-chg" aria-hidden="true">▬</span>
              <span id="dp-spark"></span>
            </div>
            <div class="mini">
              <h4>${T(COPY.hero.dash.market)}<em>LIVE</em></h4>
              ${marketRow('BTC', 'Bitcoin', 'hm-bitcoin')}
              ${marketRow('ETH', 'Ethereum', 'hm-ethereum')}
              ${marketRow('SOL', 'Solana', 'hm-solana')}
              ${marketRow('BNB', 'BNB Chain', 'hm-binance')}
            </div>
            <div class="mini">
              <h4>${T(COPY.hero.dash.signals)}</h4>
              <div>${sig}</div>
            </div>
            <div class="mini">
              <h4>${T(COPY.hero.dash.smartMoney)}</h4>
              ${smRows}
            </div>
            <div class="mini wide">
              <h4>${T(COPY.hero.dash.yield)}<em>LIVE · DEFILAMA</em></h4>
              <div id="dy-rows">
                <div class="mrow"><span class="skel skel-line" style="max-width:190px"></span><span class="skel skel-line sh" style="max-width:56px"></span></div>
                <div class="mrow"><span class="skel skel-line" style="max-width:150px"></span><span class="skel skel-line sh" style="max-width:48px"></span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Live Market Pulse — part of the hero, fed by /api/global -->
      <div class="pulse" id="pulse-strip" role="status" aria-live="polite">
        <div class="pulse-card">
          <span class="pulse-label"><span class="live-dot"></span>${T(COPY.hero.pulse.mcap)}</span>
          <span class="pulse-value" id="pv-mcap" data-dyn-global>—</span>
        </div>
        <div class="pulse-card">
          <span class="pulse-label">${T(COPY.hero.pulse.volume)}</span>
          <span class="pulse-value" id="pv-vol" data-dyn-global>—</span>
        </div>
        <div class="pulse-card">
          <span class="pulse-label">${T(COPY.hero.pulse.btcDom)}</span>
          <span class="pulse-value" id="pv-btcd" data-dyn-global>—</span>
        </div>
        <div class="pulse-card">
          <span class="pulse-label">${T(COPY.hero.pulse.change)}</span>
          <span class="pulse-value flat" id="pv-chg" data-dyn-global>—</span>
          <span class="pulse-sub"><span id="pv-chg-dir">·</span> <span id="pulse-note" data-updated>${T(COPY.hero.pulse.updated)}</span></span>
        </div>
      </div>
    </div>
  </section>`;
}

/* 3b ── Product tour: the bilingual slideshow --------------------------- */
/**
 * Five slides, one per page the owner asked to feature — swap, stocks,
 * futures, gold and precious metals, AI — and each one is bilingual the same
 * way everything else on this document is: both texts are in the HTML, CSS
 * picks one. Nothing is fetched or swapped in by the runtime, so a crawler
 * reads all ten language variants and a JS-less reader still sees every slide
 * (`.show-slide` are stacked, and without `html[data-js]` all of them are
 * simply visible as sections — see the `.no-js` rules in the stylesheet).
 *
 * Each slide carries three layers of movement: a photographic plate that
 * breathes (Ken Burns), a Lottie animation drawn by the inline player, and a
 * CSS entrance for the text. The live chip on a slide is one number from a
 * feed this page already fetches; when that feed fails the chip is hidden
 * rather than showing a placeholder.
 */
function showcase(site) {
  const list = gateSpeculation(COPY.showcase.slides);
  const slides = list
    .map((s, i) => {
      const bullets = s.bullets.map((b) => `<li>${ic('spark', 'ic-bullet')}<span>${T(b)}</span></li>`).join('');
      const total = list.length;
      const live = `<span class="slide-live" data-live-kind="${s.live.kind}"${s.live.id ? ` data-live-id="${s.live.id}"` : ''}><span class="live-dot"></span><span class="lg lg-en">${esc(s.live.label.en)}</span><span class="lg lg-fa" lang="fa" dir="rtl">${esc(s.live.label.fa)}</span></span>`;
      return `<article class="show-slide ${i === 0 ? 'is-on' : ''}" id="slide-${s.key}" data-slide="${s.key}" data-accent="${s.accent}" role="group" aria-roledescription="slide" aria-label="${i + 1} / ${total}">
        <div class="slide-plate" data-parallax="6">
          <img class="slide-art" src="${s.art}" alt="" width="1280" height="720" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async">
          <span class="slide-veil"></span>
          <span class="slide-lines" aria-hidden="true"></span>
        </div>
        <div class="slide-body">
          <p class="slide-tag">${ic(s.icon, 'ic-inline')}<span>${T(s.tag)}</span></p>
          <h3>${T(s.t)}</h3>
          <p class="slide-d">${T(s.d)}</p>
          <ul class="slide-bullets">${bullets}</ul>
          <div class="slide-actions">
            <a class="btn btn-primary" href="${site}${s.route}"><span>${T(s.cta)}</span>${ICONS.flowArrow}</a>
            ${live}
          </div>
        </div>
        <div class="slide-lottie">${lottieSlot(s.key)}</div>
        <span class="slide-index" aria-hidden="true">${String(i + 1).padStart(2, '0')}<i>/</i>${String(total).padStart(2, '0')}</span>
      </article>`;
    })
    .join('');

  const dots = list
    .map(
      (s, i) =>
        `<button class="show-dot" type="button" role="tab" data-dot="${i}" aria-selected="${i === 0}" aria-controls="slide-${s.key}" aria-label="${i + 1}: ${esc(s.t.en)}"><span>${ic(s.icon)}</span></button>`
    )
    .join('');

  return `<section id="showcase" class="showcase">
    <div class="wrap">
      ${secHead({ kicker: `${T(COPY.showcase.kicker)} <span class="tag tag-info">${T({ en: `${list.length} slides`, fa: toFaDigits(String(list.length)) + ' اسلاید' })}</span>`, h2: COPY.showcase.h2, lede: COPY.showcase.lede })}
      <div class="show panel" id="show" data-accent="${COPY.showcase.slides[0].accent}" aria-roledescription="carousel" aria-label="${esc(COPY.showcase.h2.en)}">
        <div class="show-stage" id="show-stage">
          ${slides}
          <noscript><style>.show-slide{position:relative;opacity:1;transform:none;pointer-events:auto;visibility:visible}</style></noscript>
        </div>
        <div class="show-foot">
          <div class="show-dots" role="tablist" aria-label="${esc(COPY.showcase.h2.en)}">${dots}</div>
          <button class="show-play" type="button" data-show-play aria-pressed="true" title="Auto / manual"><span class="show-play-ic" aria-hidden="true"></span><span>${T(COPY.showcase.autoplay)}</span></button>
        </div>
        <div class="show-progress" aria-hidden="true"><i id="show-bar"></i></div>
      </div>
    </div>
  </section>`;
}

/* 4 ── AI Intent OS ----------------------------------------------------- */
function intentOS(site) {
  const steps = COPY.intentOS.steps
    .map(
      (s, i) =>
        `<li style="--i:${i}" class="flow-step${i === 6 ? ' approve' : ''}"><b>${T(s)}</b>${i === 6 ? '<i class="flow-tick" aria-hidden="true">✓</i>' : ''}</li>`
    )
    .join('');
  const says = COPY.intentOS.personalize.chips
    .map(
      (c, i) => `<div class="say-card reveal" style="--d:${i * 70}ms">
          <div class="s1">${T(c.say)}</div>
          <div class="s2">${T(c.act)}</div>
        </div>`
    )
    .join('');
  /*
   * The token tape. This is the block the owner was pointing at: the token
   * list beside the AI panel had a price AND a signed percentage in a card
   * that is roughly 150px wide, so the pair hung off the edge of the screen.
   * Here the same facts live in a full-width strip that scrolls, each chip
   * being logo + symbol + price + an arrow.
   */
  const tape = `<div class="ai-tape" id="ai-tape">
      <div class="ai-tape-head">
        <span class="ai-tape-label">${lottieSlot('tape', 'lottie-inline')}<b>${T(COPY.intentOS.tapeTitle)}</b></span>
        <span class="spacer"></span>
        <span class="ai-tape-note"><span class="live-dot"></span><span data-updated>${T(COPY.hero.pulse.updated)}</span></span>
      </div>
      <div class="ai-tape-view">
        <div class="ai-tape-track" id="ai-tape-track">
          ${Array.from({ length: 7 })
            .map(() => `<span class="tape-item is-skel"><span class="skel skel-dot"></span><span class="skel skel-line" style="width:44px"></span></span>`)
            .join('')}
        </div>
      </div>
    </div>`;
  return `<section id="intent-os">
    <div class="wrap">
      ${secHead({ kicker: `${esc(COPY.intentOS.kicker)} <span class="tag tag-live">${T({ en: 'Core', fa: 'هسته' })}</span>`, h2: COPY.intentOS.h2, lede: COPY.intentOS.lede })}
      <div class="grid grid-2" style="align-items:start">
        <div class="reveal">
          <blockquote class="intent-quote">
            ${lottieSlot('ai', 'lottie-quote')}
            <span class="q-label">${T(COPY.intentOS.exampleLabel)}</span>
            ${T(COPY.intentOS.example)}
          </blockquote>
          <div class="note-inline">
            <span class="risk-mark" style="border-color:rgba(99,245,187,.45);color:var(--lime)">✓</span>
            <span>${T(COPY.intentOS.approvalNote)}</span>
          </div>
          <h3 style="margin:26px 0 4px;font-size:16px">${T(COPY.intentOS.personalize.h3)}</h3>
          <div class="say-grid">${says}</div>
          <div class="hero-actions" style="margin-block-start:24px">
            <a class="btn btn-primary" href="${site}/#/intent"><span>${T(COPY.intentOS.cta)}</span>${ICONS.flowArrow}</a>
          </div>
        </div>
        <span class="flow-meter" aria-hidden="true"><i></i></span>
        <ol class="flow reveal-r reveal flow-host" aria-label="${esc(COPY.intentOS.kicker)}">${steps}</ol>
      </div>
      ${tape}
    </div>
  </section>`;
}

/* 5 ── AI Financial Brain ---------------------------------------------- */
function brain() {
  const cards = COPY.brain.cards
    .map(
      (c) => `<div class="card reveal">
        <h3>${icon('brain')}${T(c.t)}</h3>
        <p>${T(c.d)}</p>
      </div>`
    )
    .join('');
  return `<section id="brain">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.brain.kicker), h2: COPY.brain.h2, lede: COPY.brain.lede })}
      <div class="grid grid-3">${cards}</div>
      <div class="note-inline warn reveal" style="margin-block-start:22px">
        <span class="risk-mark">i</span>
        <span>${T(COPY.brain.honesty)}</span>
      </div>
    </div>
  </section>`;
}

/* 6 ── Top Tokens (dynamic) -------------------------------------------- */
function tokens(site) {
  const c = COPY.tokens.cols;
  return `<section id="tokens">
    <div class="wrap">
      ${secHead({
        kicker: `${T(COPY.tokens.kicker)} <span class="tag tag-live"><span class="live-dot"></span> ${T(COPY.hero.pulse.live)}</span>`,
        h2: `🔥 ${T(COPY.tokens.h2)}`,
        lede: COPY.tokens.lede
      })}
      <div class="data-shell reveal" id="tokens-body">
        <div class="data-head">
          <span>${T(COPY.tokens.source)}</span>
          <span class="spacer"></span>
          <span data-updated>${T(COPY.hero.pulse.updated)}</span>
        </div>
        <div class="table-scroll">
          <table class="market">
            <thead>
              <tr>
                <th>${T(c.asset)}</th><th>${T(c.price)}</th><th>${T(c.change)}</th>
                <th>${T(c.volume)}</th><th>${T(c.mcap)}</th><th>${T(c.trend)}</th>
              </tr>
            </thead>
            <tbody id="tokens-tbody">${skeletonTableBody(6)}</tbody>
          </table>
        </div>
      </div>
      <div class="hero-actions reveal" style="margin-block-start:20px">
        <a class="btn btn-ghost" href="${site}/#/"><span>${T(COPY.tokens.cta)}</span>${ICONS.flowArrow}</a>
      </div>
    </div>
  </section>`;
}

/* 7 ── Top Stocks (dynamic, tokenized equities) ------------------------- */
function stocks(site) {
  return `<section id="stocks">
    <div class="wrap">
      ${secHead({
        kicker: `${T(COPY.stocks.kicker)} <span class="tag tag-soon">${T(COPY.stocks.tag)}</span>`,
        h2: `📈 ${T(COPY.stocks.h2)}`,
        lede: COPY.stocks.lede
      })}
      <div class="data-shell reveal">
        <div class="data-head">
          <span class="tag tag-info">${T(COPY.stocks.comingSoon)}</span>
          <span class="spacer"></span>
          <span data-updated>${T(COPY.hero.pulse.updated)}</span>
        </div>
        <div id="stocks-rows">
          ${skeletonRow()}${skeletonRow()}${skeletonRow()}${skeletonRow()}
        </div>
      </div>
      <div class="hero-actions reveal" style="margin-block-start:18px;align-items:center">
        <a class="btn btn-ghost" href="${site}/#/stocks"><span>${T(COPY.stocks.cta)}</span>${ICONS.flowArrow}</a>
        <span style="font-size:12px;color:var(--quiet)">${T(COPY.stocks.tokenizedNote)}</span>
      </div>
    </div>
  </section>`;
}

/* 8 ── Farms & Yield (dynamic) ------------------------------------------ */
function farms(site) {
  const f = COPY.farms.filters;
  const chip = (key, pair) =>
    `<button class="filter-chip" type="button" data-farm-filter="${key}" aria-pressed="${key === 'all' ? 'true' : 'false'}">${T(pair)}</button>`;
  return `<section id="farms">
    <div class="wrap">
      ${secHead({
        kicker: `${T(COPY.farms.kicker)} <span class="tag tag-live"><span class="live-dot"></span> ${T(COPY.hero.pulse.live)}</span>`,
        h2: `🌾 ${T(COPY.farms.h2)}`,
        lede: COPY.farms.lede
      })}
      <div class="filter-row reveal">
        ${chip('all', f.all)}${chip('low', f.low)}${chip('medium', f.medium)}${chip('high', f.high)}
      </div>
      <div class="data-shell reveal">
        <div class="data-head">
          <span>DefiLlama · <span class="mono" id="farms-considered">— / —</span></span>
          <span class="spacer"></span>
          <span data-updated>${T(COPY.hero.pulse.updated)}</span>
        </div>
        <div id="farms-rows">
          ${skeletonRow()}${skeletonRow()}${skeletonRow()}${skeletonRow()}${skeletonRow()}
        </div>
      </div>
      <div class="note-inline warn reveal" style="margin-block-start:16px">
        <span class="risk-mark">!</span>
        <span>${T(COPY.farms.note)}</span>
      </div>
      <div class="hero-actions reveal" style="margin-block-start:18px">
        <a class="btn btn-ghost" href="${site}/#/farm"><span>${T(COPY.farms.cta)}</span>${ICONS.flowArrow}</a>
      </div>
    </div>
  </section>`;
}

/* 9 ── AI Signals -------------------------------------------------------- */
function signals(site) {
  const tiers = COPY.signals.tiers
    .map(
      (t) => `<div class="card reveal">
        <h3><span class="sig-pill sig-${t.key}" style="margin:0">${T({ en: t.en, fa: t.fa })}</span></h3>
        <p>${T(t.d)}</p>
      </div>`
    )
    .join('');
  const fields = COPY.signals.fields.map((f) => `<span class="chip">${T(f)}</span>`).join('');
  return `<section id="signals">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.signals.kicker), h2: `🧠 ${T(COPY.signals.h2)}`, lede: COPY.signals.lede })}
      <div class="grid grid-3" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">${tiers}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-block-start:18px" class="reveal">${fields}</div>
      <div class="sig-split">
        <figure class="art-panel reveal-zoom reveal" data-parallax="6">
          <img class="slide-art" src="/landing/art-signals.jpg" alt="" width="1000" height="750" loading="lazy" decoding="async">
          <figcaption>${T(COPY.signals.artNote)}</figcaption>
          <span class="art-sheen" aria-hidden="true"></span>
        </figure>
        <div class="note-inline reveal" style="margin-block-start:0">
          <span class="risk-mark" style="border-color:rgba(99,245,187,.4);color:var(--lime)">≡</span>
          <span>${T(COPY.signals.honesty)}</span>
        </div>
      </div>
      <div class="hero-actions reveal" style="margin-block-start:18px">
        <a class="btn btn-primary" href="${site}/#/signals"><span>${T(COPY.signals.cta)}</span>${ICONS.flowArrow}</a>
      </div>
    </div>
  </section>`;
}

/* 10 ── Solana Intelligence --------------------------------------------- */
function solana(site) {
  const chips = COPY.solana.chips.map((c) => `<li class="chip">${T(c)}</li>`).join('');
  return `<section id="solana">
    <div class="wrap">
      ${secHead({
        kicker: `${T(COPY.solana.kicker)} <span class="tag tag-live"><span class="live-dot"></span> ${T(COPY.hero.pulse.live)}</span>`,
        h2: `⚡ ${T(COPY.solana.h2)}`,
        lede: COPY.solana.lede
      })}
      <ul class="hero-chips reveal" style="margin-block-start:0;margin-block-end:22px">${chips}</ul>
      <div class="data-shell reveal">
        <div class="data-head">
          <span style="font-weight:700">${T(COPY.solana.liveListTitle)}</span>
          <span class="spacer"></span>
          <span data-updated>${T(COPY.hero.pulse.updated)}</span>
        </div>
        <div id="solana-rows">
          ${skeletonRow()}${skeletonRow()}${skeletonRow()}
        </div>
      </div>
      <div class="hero-actions reveal" style="margin-block-start:18px">
        <a class="btn btn-primary" href="${site}/#/solana"><span>${T(COPY.solana.cta)}</span>${ICONS.flowArrow}</a>
      </div>
    </div>
  </section>`;
}

/* 11 ── Smart Money ------------------------------------------------------ */
function smartMoney(site) {
  const cards = COPY.smartMoney.cards
    .map(
      (c) => `<div class="card reveal">
        <h3>${icon('smartMoney')}${T(c.t)}</h3>
        <p>${T(c.d)}</p>
      </div>`
    )
    .join('');
  return `<section id="smart-money">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.smartMoney.kicker), h2: `🐋 ${T(COPY.smartMoney.h2)}`, lede: COPY.smartMoney.lede })}
      <div class="grid grid-3">${cards}</div>
      <div class="note-inline warn reveal" style="margin-block-start:20px">
        <span class="risk-mark">i</span>
        <span>${T(COPY.smartMoney.honesty)}</span>
      </div>
      <div class="hero-actions reveal" style="margin-block-start:18px">
        <a class="btn btn-ghost" href="${site}/#/smart-money"><span>${T(COPY.smartMoney.cta)}</span>${ICONS.flowArrow}</a>
      </div>
    </div>
  </section>`;
}

/* 12 ── Cross-chain ------------------------------------------------------ */
function networks() {
  const subs = { 'BNB Chain': 'EVM', Ethereum: 'EVM L1', Polygon: 'EVM L2', Arbitrum: 'EVM L2', Base: 'EVM L2', Optimism: 'EVM L2', Avalanche: 'EVM L1', Linea: 'EVM L2', Sonic: 'EVM L1', Solana: 'SVM' };
  const cards = COPY.networks.list
    .map(
      (n) => `<div class="net-card reveal" style="--nc:${n.color}">
        <span class="net-orb"></span>
        <span><b>${esc(n.name)}</b><small>${subs[n.name] || ''}</small></span>
      </div>`
    )
    .join('');
  return `<section id="networks">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.networks.kicker), h2: COPY.networks.h2, lede: COPY.networks.lede })}
      <div class="net-wrap">
        <div class="net-grid">${cards}</div>
        <figure class="art-panel reveal-l reveal" data-parallax="7">
          <img src="/landing/art-networks.jpg" alt="" width="900" height="675" loading="lazy" decoding="async">
          <figcaption>${T({ en: 'One interface, ten settlement networks — the chain is a detail, not a decision you have to make first.', fa: 'یک رابط، ده شبکهٔ تسویه — شبکه یک جزئیات است، نه تصمیمی که اول باید بگیری.' })}</figcaption>
          <span class="art-sheen" aria-hidden="true"></span>
        </figure>
      </div>
    </div>
  </section>`;
}

/* 13 ── Intent-based trading -------------------------------------------- */
function intentTrading() {
  const oldSteps = ['Choose Chain', 'Choose DEX', 'Choose Route', 'Set Gas', 'Swap'];
  const flow = COPY.intentTrading.flow
    .map((s, i) => {
      const isUser = i === 4;
      const isIntent = i === 0;
      return `${i ? '<i>→</i>' : ''}<span class="${isUser || isIntent ? 'user' : ''}">${T(s)}</span>`;
    })
    .join('');
  return `<section id="intent-trading">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.intentTrading.kicker), h2: COPY.intentTrading.h2 })}
      <div class="vs-grid">
        <div class="vs-old reveal">
          <span class="vs-lbl lbl">${T(COPY.intentTrading.oldWayLabel)}</span>
          <div class="vs-chain">${oldSteps.map((s) => `<span>${esc(s)}</span>`).join('<i>→</i>')}</div>
        </div>
        <div class="vs-new reveal" style="--d:120ms">
          <span class="vs-lbl">${T(COPY.intentTrading.newWayLabel)}</span>
          <blockquote class="intent-quote" style="margin-block-start:12px;margin-block-end:0">
            ${T(COPY.intentTrading.example)}
          </blockquote>
          <div class="vs-flow">${flow}</div>
          <p style="margin:14px 0 0;font-size:13px;color:var(--muted)">${T(COPY.intentTrading.note)}</p>
        </div>
      </div>
    </div>
  </section>`;
}

/* 14 ── Product ecosystem ------------------------------------------------ */
function ecosystem(site) {
  /*
   * The icon grid, rebuilt around the request «آیکون‌ها بهتر بشه». Each tile
   * now has: its own accent hue (so ten tiles do not read as one grey block),
   * a badge with a lit edge that reacts to the cursor, the glyph drawing
   * itself once when the tile scrolls in, and the arrow waiting in the corner
   * instead of appearing only on hover — on a touch screen there is no hover,
   * so a hover-only affordance is an affordance nobody sees.
   */
  const cards = COPY.ecosystem.cards
    .map(
      (c, i) => `<a class="card reveal eco-card acc-${c.icon}" href="${site}${c.route}" style="--d:${(i % 4) * 60}ms">
        <span class="go">${ic('go')}</span>
        <h3>${icon(c.icon)}${T(c.t)}</h3>
        <p>${T(c.d)}</p>
        <span class="card-sheen" aria-hidden="true"></span>
      </a>`
    )
    .join('');
  return `<section id="ecosystem">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.ecosystem.kicker), h2: COPY.ecosystem.h2, lede: COPY.ecosystem.lede })}
      <div class="grid grid-4">${cards}</div>
    </div>
  </section>`;
}

/* 15 ── Non-custodial ----------------------------------------------------- */
function nonCustodial(feeStr) {
  const cards = COPY.nonCustodial.cards
    .map(
      (c) => `<div class="card reveal">
        <h3>${icon('key')}${T(c.t)}</h3>
        <p>${T(c.d)}</p>
      </div>`
    )
    .join('');
  const feeBodyEn = fillFee(COPY.nonCustodial.feeBody.en, feeStr, 'en');
  const feeBodyFa = fillFee(COPY.nonCustodial.feeBody.fa, feeStr, 'fa');
  return `<section id="non-custodial">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.nonCustodial.kicker), h2: COPY.nonCustodial.h2 })}
      <div class="grid grid-3" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${cards}</div>
      <figure class="art-panel art-wide reveal-l reveal" data-parallax="5">
        <img src="/landing/art-custody.jpg" alt="" width="900" height="675" loading="lazy" decoding="async">
        <figcaption>${T(COPY.nonCustodial.artNote)}</figcaption>
        <span class="art-sheen" aria-hidden="true"></span>
      </figure>
      <div class="fee-panel panel reveal">
        <div class="fee-figure">
          <span class="lg lg-en">${esc(feeStr)}%</span>
          <span class="lg lg-fa" lang="fa" dir="rtl">${esc(toFaDigits(feeStr))}٪</span>
        </div>
        <div class="fee-copy">
          <h3 style="margin:0 0 8px;font-size:17px">${T(COPY.nonCustodial.feeTitle)}</h3>
          <p><span class="lg lg-en">${esc(feeBodyEn)}</span><span class="lg lg-fa" lang="fa" dir="rtl">${esc(feeBodyFa)}</span></p>
        </div>
      </div>
    </div>
  </section>`;
}

/* 16 ── Security ---------------------------------------------------------- */
function security(site) {
  const icons = ['lock', 'key', 'eye', 'radar', 'link', 'shield', 'doc'];
  const cards = COPY.security.cards
    .map(
      (c, i) => `<div class="card reveal">
        <h3>${icon(icons[i % icons.length])}${T(c.t)}</h3>
        <p>${T(c.d)}</p>
      </div>`
    )
    .join('');
  return `<section id="security">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.security.kicker), h2: COPY.security.h2 })}
      <div class="grid grid-3">${cards}</div>
      <div class="hero-actions reveal" style="margin-block-start:20px">
        <a class="btn btn-ghost" href="${site}/#/security"><span>${T(COPY.security.cta)}</span>${ICONS.flowArrow}</a>
      </div>
    </div>
  </section>`;
}

/* 17 ── Market intelligence dashboard (dynamic) ---------------------------- */
function marketIntel() {
  const c = COPY.marketIntel.cards;
  return `<section id="market-intel">
    <div class="wrap">
      ${secHead({
        kicker: `${T(COPY.marketIntel.kicker)} <span class="tag tag-live"><span class="live-dot"></span> ${T(COPY.hero.pulse.live)}</span>`,
        h2: COPY.marketIntel.h2,
        lede: COPY.marketIntel.lede
      })}
      <div class="stat-grid reveal">
        <div class="stat-card"><span class="t">${T(c.mcap.t)}</span><span class="v" id="md-mcap" data-dyn-global>—</span><span class="u">${T(c.mcap.unit)} · <span class="num flat" id="md-mcap-c">—</span></span></div>
        <div class="stat-card"><span class="t">${T(c.volume.t)}</span><span class="v" id="md-vol" data-dyn-global>—</span><span class="u">${T(c.volume.unit)}</span></div>
        <div class="stat-card"><span class="t">${T(c.btcDom.t)}</span><span class="v" id="md-btcd" data-dyn-global>—</span><span class="u">${T(c.btcDom.unit)}</span></div>
        <div class="stat-card"><span class="t">${T(c.gainer.t)}</span><span class="v" id="md-gainer-s">—</span><span class="u"><span class="num flat" id="md-gainer-c">—</span> · ${T(c.gainer.unit)}</span></div>
        <div class="stat-card"><span class="t">${T(c.loser.t)}</span><span class="v" id="md-loser-s">—</span><span class="u"><span class="num flat" id="md-loser-c">—</span> · ${T(c.loser.unit)}</span></div>
        <div class="stat-card"><span class="t">${T(c.trending.t)}</span><span class="v" id="md-trend-s">—</span><span class="u" id="md-trend-c">${T(c.trending.unit)}</span></div>
      </div>
    </div>
  </section>`;
}

/* 18 ── Opportunities ----------------------------------------------------- */
function opportunities(site) {
  return `<section id="opportunities">
    <div class="wrap">
      ${secHead({
        kicker: `${T(COPY.opportunities.kicker)} <span class="tag tag-live"><span class="live-dot"></span> ${T(COPY.hero.pulse.live)}</span>`,
        h2: `🔥 ${T(COPY.opportunities.h2)}`,
        lede: COPY.opportunities.lede
      })}
      <div class="grid grid-3">
        <div class="card opp-card reveal">
          <h3>${icon('signals')}${T(COPY.opportunities.trending.t)}</h3>
          <p>${T(COPY.opportunities.trending.d)}</p>
          <div class="opp-list" id="opp-trending">${skeletonRow()}${skeletonRow()}${skeletonRow()}</div>
        </div>
        <div class="card opp-card reveal" style="--d:80ms">
          <h3>${icon('radar')}${T(COPY.opportunities.early.t)}</h3>
          <p>${T(COPY.opportunities.early.d)}</p>
          <div class="hero-actions" style="margin-block-start:16px">
            <a class="btn btn-ghost" style="padding:10px 16px;font-size:13px" href="${site}/#/smart-money"><span>${T(COPY.opportunities.early.cta)}</span>${ICONS.flowArrow}</a>
          </div>
        </div>
        <div class="card opp-card reveal" style="--d:160ms">
          <h3>${icon('farm')}${T(COPY.opportunities.yield.t)}</h3>
          <p>${T(COPY.opportunities.yield.d)}</p>
          <div class="opp-list" id="opp-yield">${skeletonRow()}${skeletonRow()}</div>
        </div>
      </div>
    </div>
  </section>`;
}

/* 19 ── Why FBT ------------------------------------------------------------ */
function why() {
  const cards = COPY.why.cards
    .map(
      (c) => `<div class="card reveal">
        <h3>${icon('shield')}${T(c.t)}</h3>
        <p>${T(c.d)}</p>
      </div>`
    )
    .join('');
  return `<section id="why">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.why.kicker), h2: COPY.why.h2, center: true })}
      <div class="grid grid-3">${cards}</div>
    </div>
  </section>`;
}

/* 20 ── FAQ ---------------------------------------------------------------- */
function faq() {
  const items = COPY.faq.items
    .map(
      ({ q, a }) => `<details class="reveal">
        <summary><span>${T(q)}</span><span class="faq-plus" aria-hidden="true">+</span></summary>
        <p class="a"><span class="lg lg-en">${esc(a.en)}</span><span class="lg lg-fa" lang="fa" dir="rtl">${esc(a.fa)}</span></p>
      </details>`
    )
    .join('');
  return `<section id="faq">
    <div class="wrap">
      ${secHead({ kicker: T(COPY.faq.kicker), h2: COPY.faq.h2 })}
      <div class="faq-list">${items}</div>
    </div>
  </section>`;
}

/* 21 ── Final CTA ------------------------------------------------------------ */
function finalCta(site) {
  return `<section id="cta">
    <div class="wrap">
      <div class="cta-band reveal">
        <img class="cta-art" src="/landing/art-horizon.jpg" alt="" width="1600" height="680" loading="lazy" decoding="async">
        <h2>${T(COPY.finalCta.h2)}</h2>
        <p>${T(COPY.finalCta.sub)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="${site}/#/swap"><span>${T(COPY.finalCta.primary)}</span>${ICONS.flowArrow}</a>
          <a class="btn btn-ghost" href="${site}/#/intent"><span>${T(COPY.finalCta.secondary)}</span></a>
        </div>
      </div>
    </div>
  </section>`;
}

/* ── Risk + Footer ------------------------------------------------------------ */
function riskAndFooter(site) {
  const cols = COPY.footer.columns
    .map(
      (col) => `<div class="foot-col">
        <h4>${T(col.t)}</h4>
        <ul>${col.links
          .map((l) => `<li><a href="${l.href.startsWith('/') ? site + encodeURI(l.href) : l.href}">${T({ en: l.en, fa: l.fa })}</a></li>`)
          .join('')}</ul>
      </div>`
    )
    .join('');
  const year = new Date().getFullYear();
  return `<section id="risk" style="padding-block-end:0">
      <div class="wrap">
        <div class="risk-panel reveal">
          <span class="risk-mark">!</span>
          <div>
            <h3>${T(COPY.risk.t)}</h3>
            <p>${T(COPY.risk.body)}</p>
          </div>
        </div>
      </div>
    </section>
    <footer class="site">
      <div class="wrap">
        <div class="foot-grid">
          <div class="foot-brand">
            <a class="brand" href="${site}/">
              <span class="brand-mark"><img src="/icon-192.png" alt="" width="24" height="24"></span>
              <span>FBT Swap</span>
            </a>
            <p>${T(COPY.footer.tagline)}</p>
            <p style="color:var(--quiet);font-size:12px">
              <span>${T(COPY.footer.contact)}:</span> <a href="mailto:fbtswap@gmail.com" style="color:var(--muted)">fbtswap@gmail.com</a>
            </p>
          </div>
          <div class="foot-links">${cols}</div>
        </div>
        <div class="foot-note">
          <span>© ${year} ${T(COPY.footer.copyright)}</span>
          <span>${T(COPY.footer.company)}</span>
        </div>
      </div>
    </footer>`;
}

/* ------------------------------------------------------------------ */
/* Structured data                                                      */
/* ------------------------------------------------------------------ */

function structuredData(url, site) {
  const orgId = `${site}/#organization`;
  const websiteId = `${site}/#website`;
  const appId = `${site}/#app`;
  const faqId = `${url}#faq`;

  /* The FAQ schema mirrors the visible <details> blocks below. Both language
     variants are included because both exist in the document and both are
     revealed by an on-page control — this is a language toggle, not hidden
     keyword stuffing. */
  const faqEntities = COPY.faq.items.flatMap(({ q, a }) => [
    { '@type': 'Question', name: q.en, acceptedAnswer: { '@type': 'Answer', text: a.en } },
    { '@type': 'Question', name: q.fa, acceptedAnswer: { '@type': 'Answer', text: a.fa } }
  ]);

  return jsonForScript({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': orgId,
        name: 'FBT Swap',
        legalName: 'Fanous Bazaar Pishgam Co.',
        url: `${site}/`,
        email: 'fbtswap@gmail.com',
        logo: { '@type': 'ImageObject', url: `${site}/icon-512.png`, width: 512, height: 512 },
        sameAs: ['https://x.com/CompanyFbt']
      },
      {
        '@type': 'WebSite',
        '@id': websiteId,
        url: `${site}/`,
        name: 'FBT Swap',
        inLanguage: ['en', 'fa'],
        publisher: { '@id': orgId }
      },
      {
        '@type': 'SoftwareApplication',
        '@id': appId,
        name: 'FBT Swap',
        url: `${site}/`,
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Android, Web',
        inLanguage: ['en', 'fa'],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': orgId },
        featureList:
          'Non-custodial crypto swap, AI Intent OS, market signals, Solana intelligence, smart money tracking, DeFi farms, portfolio, price alerts'
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: COPY.meta.en.title,
        description: COPY.meta.en.description,
        inLanguage: 'en',
        isPartOf: { '@id': websiteId },
        publisher: { '@id': orgId },
        about: { '@id': appId },
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: `${site}/social-card.png`,
          width: 1024,
          height: 500,
          caption: 'FBT Swap — AI-powered decentralized exchange and financial OS'
        }
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${site}/` },
          { '@type': 'ListItem', position: 2, name: 'FBT Swap — AI Financial OS', item: url }
        ]
      },
      {
        '@type': 'FAQPage',
        '@id': faqId,
        mainEntity: faqEntities
      }
    ]
  });
}

/* ------------------------------------------------------------------ */
/* The document                                                         */
/* ------------------------------------------------------------------ */

export const V2_PAGE = {
  slug: 'صرافی-غیرمتمرکز',
  changefreq: 'weekly',
  priority: '0.9'
};

export function renderLandingV2({ site }) {
  const SITE = site.replace(/\/+$/, '');
  const url = `${SITE}/${encodeURIComponent(V2_PAGE.slug)}`;
  const feeStr = feePct(resolveFeeBps(process.env.VITE_FEE_BPS));

  /* Strings the runtime needs to swap on language change or on failure. */
  const L10N = {
    meta: {
      en: { title: COPY.meta.en.title, description: COPY.meta.en.description },
      fa: { title: COPY.meta.fa.title, description: COPY.meta.fa.description }
    },
    states: {
      en: { unavailable: 'Data unavailable', retry: 'Retry', tryAgain: 'please try again', updated: 'Updated', live: 'Live' },
      fa: { unavailable: 'داده در دسترس نیست', retry: 'تلاش دوباره', tryAgain: 'دوباره تلاش کنید', updated: 'به‌روزرسانی', live: 'زنده' }
    },
    risks: {
      en: { low: 'Low', medium: 'Medium', high: 'High' },
      fa: { low: 'کم', medium: 'متوسط', high: 'زیاد' }
    },
    opp: {
      en: { rank: 'Market rank', apy: 'APY', tvl: 'TVL' },
      fa: { rank: 'رتبهٔ بازار', apy: 'APY', tvl: 'TVL' }
    },
    solana: {
      en: { lst: 'Liquid staking' },
      fa: { lst: 'استیکینگ مایع' }
    },
    dock: {
      en: { open: COPY.dock.open.en, close: COPY.dock.close.en, label: COPY.dock.label.en },
      fa: { open: COPY.dock.open.fa, close: COPY.dock.close.fa, label: COPY.dock.label.fa }
    },
    intents: {
      en: COPY.hero.dash.sampleIntents.map((i) => i.en),
      fa: COPY.hero.dash.sampleIntents.map((i) => i.fa)
    }
  };

  const sections = [
    hero(SITE),
    showcase(SITE),
    intentOS(SITE),
    brain(),
    tokens(SITE),
    stocks(SITE),
    farms(SITE),
    signals(SITE),
    solana(SITE),
    smartMoney(SITE),
    networks(),
    intentTrading(),
    ecosystem(SITE),
    nonCustodial(feeStr),
    security(SITE),
    marketIntel(),
    opportunities(SITE),
    why(),
    faq(),
    finalCta(SITE),
    riskAndFooter(SITE)
  ].join('\n  ');

  return `<!doctype html>
<html lang="en" dir="ltr" data-lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(COPY.meta.en.title)}</title>
<meta name="description" content="${esc(COPY.meta.en.description)}">
<meta name="keywords" content="${esc(COPY.meta.keywords)}">
<link rel="canonical" href="${esc(url)}">
<!--
  hreflang on a bilingual single-document page: one URL genuinely serves both
  languages (the variant is a rendering choice on the same DOM, not separate
  content). Self-referencing en + fa + x-default tells each search audience
  that this very page answers in their language — the honest claim here.
-->
<link rel="alternate" hreflang="en" href="${esc(url)}">
<link rel="alternate" hreflang="fa" href="${esc(url)}">
<link rel="alternate" hreflang="x-default" href="${esc(url)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="theme-color" content="#05030e">
<meta name="color-scheme" content="dark">
<meta name="format-detection" content="telephone=no">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">

<meta property="og:type" content="website">
<meta property="og:site_name" content="FBT Swap">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="fa_IR">
<meta property="og:title" content="${esc(COPY.meta.en.title)}">
<meta property="og:description" content="${esc(COPY.meta.en.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}/social-card.png">
<meta property="og:image:secure_url" content="${SITE}/social-card.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="500">
<meta property="og:image:alt" content="FBT Swap — AI-powered decentralized exchange and financial OS">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@CompanyFbt">
<meta name="twitter:title" content="${esc(COPY.meta.en.title)}">
<meta name="twitter:description" content="${esc(COPY.meta.en.description)}">
<meta name="twitter:image" content="${SITE}/social-card.png">

<!-- Coin artwork arrives from CoinGecko's CDN once /api/markets answers;
     opening the connection at parse time hides that latency entirely. -->
<link rel="preconnect" href="https://assets.coingecko.com" crossorigin>
<link rel="preconnect" href="https://coin-images.coingecko.com" crossorigin>
<link rel="dns-prefetch" href="https://assets.coingecko.com">
<link rel="dns-prefetch" href="https://coin-images.coingecko.com">

<link rel="preload" href="/fonts/JetBrainsMono-var.woff2" as="font" type="font/woff2" crossorigin>

<script>
/* PRE-PAINT LANGUAGE RESOLUTION.
 *
 * Default is English. A visitor who previously chose فارسی must never see
 * an English frame first — so the saved choice is applied synchronously,
 * BEFORE the stylesheet below is parsed: one data-lang attribute decides
 * which language of every bilingual pair is visible, and there is no
 * flash of the wrong language and no layout shift.
 *
 * It also swaps title/description immediately (Google renders this too)
 * and queues the Vazirmatn preload only when Persian is actually used —
 * an English visitor pays zero bytes for a font they will never see.
 */
(function () {
  try {
    var l = localStorage.getItem('fbt-landing-lang');
    if (l !== 'fa') return;
    var d = document.documentElement;
    d.setAttribute('data-lang', 'fa');
    d.setAttribute('lang', 'fa');
    d.setAttribute('dir', 'rtl');
    document.title = ${JSON.stringify(COPY.meta.fa.title)};
    var m = document.querySelector('meta[name="description"]');
    if (m) m.setAttribute('content', ${JSON.stringify(COPY.meta.fa.description)});
    var l1 = document.createElement('link');
    l1.rel = 'preload';
    l1.as = 'font';
    l1.type = 'font/woff2';
    l1.href = '/fonts/Vazirmatn-var.woff2';
    l1.crossOrigin = 'anonymous';
    document.head.appendChild(l1);
  } catch (e) {}
})();
</script>

<style>
@font-face{font-family:'Vazirmatn';src:url('/fonts/Vazirmatn-var.woff2') format('woff2-variations');font-weight:100 900;font-display:swap}
@font-face{font-family:'JetBrains Mono';src:url('/fonts/JetBrainsMono-var.woff2') format('woff2-variations');font-weight:100 800;font-display:swap}
${CSS}
</style>

<script type="application/ld+json">${structuredData(url, SITE)}</script>
</head>
<body>
<a class="skip-link" href="#main">${T({ en: 'Skip to content', fa: 'پرش به محتوا' })}</a>
${ambient()}
${iconSprite()}
${nav(SITE)}
<main id="main" tabindex="-1">
  ${sections}
</main>
${dock(SITE)}
${lottieScript()}
<script>window.__FBT_L10N__ = ${jsonForScript(L10N)};</script>
<script>${RUNTIME}</script>
</body>
</html>
`;
}
