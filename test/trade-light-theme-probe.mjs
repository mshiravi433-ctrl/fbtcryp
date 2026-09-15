/**
 * VIRTUAL-CREDIT (PRACTICE TRADE) + WALLET TOKEN SHEET — LIGHT THEME PROBE
 * ---------------------------------------------------------------------------
 * Two reports, one cause family — surfaces authored for a dark canvas with no
 * light-theme counterpart:
 *
 *   «در صفحه اعتبار مجازی در تم روشن خیلی زشته و رنگ بندی تم روشنش خرابه»
 *   «در صفحه گس و شبکه انتخابی دکمه سواپ و ارسال در تم روشن معلوم نیست»
 *
 * The practice-trade screen (/trade) is built from `.lab-hero`, `.trade-ticket`
 * and `.trade-summary-row` in src/styles/lab-modern.css. `.swap-ticket` shares
 * the ticket's base rule and DOES have light overrides; `.trade-ticket` was
 * left out of every one of them, so on a #f4f5fa page it rendered a
 * white-6%-on-transparent card with a white-10% border and a 0.35-alpha black
 * drop shadow — i.e. an invisible card with a dirty shadow under it. `.lab-hero`
 * was worse: a hardcoded `linear-gradient(165deg,#12141f,#090a10)` under text
 * coloured `var(--text-1)`, which in light mode is #0d1020 — near-black on
 * near-black.
 *
 * The wallet token sheet's Send / Swap buttons (`.wallet-action-modern`) had the
 * mirror-image problem: the light override set the background to
 * `rgba(255,255,255,0.78)` with a 7%-alpha border on a white sheet, so the two
 * primary actions on that sheet had no visible edge at all.
 *
 * Method is the one test/ai-light-theme-probe.mjs established: load the real
 * stylesheets in their real import order into jsdom, build a DOM tree that
 * mirrors the real components, read the cascade, resolve `var()` by hand
 * (jsdom implements specificity but not custom-property substitution), then
 * MEASURE contrast against WCAG AA instead of eyeballing it.
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
/** Every colour literal inside a background-image (gradient) string. */
const gradientStops = (bgImage) =>
  String(bgImage || '')
    .match(/#[\da-f]{3,8}\b|rgba?\([^)]+\)/gi)
    ?? [];

/* ── the stylesheets, in the order the pages import them ────────────────── */
const CSS = [
  'src/index.css',
  'src/styles/lab-modern.css',
  'src/styles/wallet-modern.css',
  'src/styles/wallet.css'
].map((f) => readFileSync(f, 'utf8')).join('\n');

const TOKENS = [
  '--bg-void', '--bg-abyss', '--bg-panel', '--bg-panel-solid', '--bg-raised',
  '--line', '--line-strong', '--text-1', '--text-2', '--text-3',
  '--up', '--down', '--rgb-1', '--rgb-2', '--rgb-3', '--rgb-4'
];

function measure(theme) {
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

  /* ── /trade — the virtual-credit practice screen (Trade.jsx) ──────────── */
  const page = el('div', 'page');
  const hero = el('section', 'lab-hero', page);
  el('div', 'lab-aurora', hero);
  const heroRow = el('div', 'row-between', hero);
  const heroLeft = el('div', '', heroRow);
  const heroLabel = el('div', 'faint', heroLeft, 'موجودی');
  const heroValue = el('div', 'stat-mini', heroLeft, '10,000 NX');

  const ticket = el('section', 'trade-ticket', page);
  const seg = el('div', 'segmented', ticket);
  el('button', 'active', seg, 'خرید');
  el('button', '', seg, 'فروش');
  const summary = el('div', 'trade-summary-row', ticket);
  const sumLabel = el('span', 'faint', summary, 'کارمزد');
  const sumValue = el('span', 'mono', summary, '10.00 NX');
  const ctaBuy = el('button', 'trade-cta buy', ticket, 'خرید');
  const ctaSell = el('button', 'trade-cta sell', ticket, 'فروش');
  const posCard = el('div', 'coin-row lab-card', page);
  const posSym = el('div', 'coin-sym', posCard, 'BTC');

  /* ── the wallet token sheet: gas coin + per-network rows + actions ────── */
  const sheet = el('div', 'sheet');
  const chip = el('span', 'wal-chip-net', sheet, 'ZK');
  const gasPill = el('span', 'pill pill-rgb', sheet, 'گس');
  const actions = el('div', 'row', sheet);
  const sendBtn = el('button', 'wallet-action-modern send', actions);
  el('span', 'wallet-action-icon-modern', sendBtn);
  const sendLabel = el('span', 'wallet-action-label', sendBtn, 'ارسال');
  const swapBtn = el('button', 'wallet-action-modern recv', actions);
  el('span', 'wallet-action-icon-modern', swapBtn);
  const swapLabel = el('span', 'wallet-action-label', swapBtn, 'سواپ');
  const actionRow = el('div', 'wallet-action-strip', page);
  const tile = el('button', 'wallet-action-v2 wal-action-swap', actionRow);
  el('span', 'wallet-action-v2-icon', tile);
  const tileLabel = el('span', 'wallet-action-v2-label', tile, 'سواپ');
  const netPicker = el('div', 'wal-net-picker', page);
  const netChip = el('button', 'wal-net-chip active', netPicker, 'ZK');
  const netChipIdle = el('button', 'wal-net-chip', netPicker, 'SCR');

  const cs = (node, prop) => window.getComputedStyle(node)[prop] || '';
  const token = (name) => window.getComputedStyle(page).getPropertyValue(name).trim();
  const tokens = {};
  for (const tk of TOKENS) tokens[tk] = token(tk);
  const val = (node, prop) => {
    let v = cs(node, prop);
    for (let i = 0; i < 5 && v.includes('var('); i++) {
      v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, n, fb) => tokens[n] || fb || '');
    }
    return v.trim();
  };

  return { window, tokens, cs, val, nodes: {
    page, hero, heroLabel, heroValue, ticket, seg, sumLabel, sumValue,
    ctaBuy, ctaSell, posCard, posSym, sheet, chip, gasPill,
    sendBtn, sendLabel, swapBtn, swapLabel, tile, tileLabel,
    netPicker, netChip, netChipIdle
  } };
}

const PAGE_BG = '#f4f5fa'; /* --bg-void in the light theme */

try {
  const light = measure('light');
  const dark = measure('dark');
  const L = light.nodes;
  const D = dark.nodes;
  const v = light.val;

  /* ══ 1. The hero card is a LIGHT surface, and its text is readable ══════
     Before: `linear-gradient(165deg,#12141f,#090a10 62%)` — a near-black card
     in a light app, carrying #0d1020 text. Contrast 1.06:1.

     The card is layered (two translucent radial washes over an opaque
     gradient), so "is it light" is measured the way it is seen: every
     translucent stop composited over the opaque base, then checked. */
  const heroStops = gradientStops(light.cs(L.hero, 'backgroundImage'));
  const opaqueBase = heroStops.find((s) => alphaOf(s) >= 0.99) ?? '#ffffff';
  const heroIsLight = heroStops.length > 0 && heroStops.every((s) => {
    const composite = over(s, opaqueBase, alphaOf(s));
    const rgb = toRgb(composite);
    return rgb && rgb[0] > 190 && rgb[1] > 190 && rgb[2] > 190;
  });
  check(`light: .lab-hero is no longer a near-black card (${heroStops.length} stops)`, heroIsLight);
  const heroTextRatio = ratio(v(L.heroValue, 'color'), opaqueBase);
  check(`light: the hero balance clears WCAG AA on the card (${heroTextRatio?.toFixed(2)})`, heroTextRatio >= 4.5);
  const heroLabelRatio = ratio(v(L.heroLabel, 'color'), opaqueBase);
  check(`light: the hero label is legible (${heroLabelRatio?.toFixed(2)})`, heroLabelRatio >= 3);

  /* ══ 2. The ticket is a visible card, not an invisible one ══════════════
     Before: white 6%→1.5% on #f4f5fa with a white 10% border — no edge at all.
     The border has to be a DARK ink at a real alpha, like the rest of the
     light theme's surfaces. */
  const ticketBorder = light.cs(L.ticket, 'borderTopColor');
  const ticketAlpha = alphaOf(ticketBorder);
  const ticketBorderRgb = toRgb(ticketBorder);
  check(
    `light: .trade-ticket has a visible border (${ticketBorder}, α=${ticketAlpha})`,
    ticketBorderRgb != null && ticketBorderRgb[0] < 120 && ticketAlpha >= 0.1
  );
  const ticketBg = light.cs(L.ticket, 'backgroundColor');
  const ticketImage = light.cs(L.ticket, 'backgroundImage');
  check('light: .trade-ticket sits on an opaque light surface',
    /#fff|255, 255, 255/.test(`${ticketBg} ${ticketImage}`));
  /* The old rule also dragged a 0.35-alpha black shadow onto a white page. */
  const ticketShadow = light.cs(L.ticket, 'boxShadow');
  const shadowTooHeavy = /rgba?\(0, 0, 0, 0\.3/.test(ticketShadow);
  check(`light: .trade-ticket drops a soft shadow, not a black one (${ticketShadow.slice(0, 40)}…)`, !shadowTooHeavy);

  /* ══ 3. The summary rows separate ══════════════════════════════════════
     Before: `border-bottom: 1px dashed rgba(255,255,255,0.07)` — invisible. */
  const rowBorder = light.cs(L.sumLabel.parentNode, 'borderBottomColor');
  const rowRgb = toRgb(rowBorder);
  check(`light: the fee row has a visible divider (${rowBorder})`,
    rowRgb != null && rowRgb[0] < 150 && alphaOf(rowBorder) >= 0.12);

  /* ══ 4. The buy/sell CTAs ══════════════════════════════════════════════
     `color:#fff` on `#00c98a→#00e5ff` is 1.9:1 — below even the 3:1 floor for
     large text, in BOTH themes. The app's own convention for that gradient is
     dark ink (.btn-success, .xfer-submit), so the buy CTA follows it. */
  const buyText = light.cs(L.ctaBuy, 'color');
  const buyBg = gradientStops(light.cs(L.ctaBuy, 'backgroundImage'));
  const buyWorst = Math.min(...buyBg.map((s) => ratio(buyText, s) ?? 99));
  check(`light: the Buy CTA label clears 3:1 on its own gradient (${buyWorst.toFixed(2)})`, buyWorst >= 3);
  const sellText = light.cs(L.ctaSell, 'color');
  const sellBg = gradientStops(light.cs(L.ctaSell, 'backgroundImage'));
  const sellWorst = Math.min(...sellBg.map((s) => ratio(sellText, s) ?? 99));
  check(`light: the Sell CTA label clears 3:1 on its own gradient (${sellWorst.toFixed(2)})`, sellWorst >= 3);
  /* The dark theme must not regress — same rule, measured there too. */
  const darkBuyText = dark.cs(D.ctaBuy, 'color');
  const darkBuyBg = gradientStops(dark.cs(D.ctaBuy, 'backgroundImage'));
  const darkBuyWorst = Math.min(...darkBuyBg.map((s) => ratio(darkBuyText, s) ?? 99));
  check(`dark: the Buy CTA still clears 3:1 (${darkBuyWorst.toFixed(2)})`, darkBuyWorst >= 3);

  /* ══ 5. The position cards keep a visible edge ═════════════════════════ */
  const posShadow = light.cs(L.posCard, 'boxShadow');
  check(`light: .lab-card drops a soft shadow (${posShadow.slice(0, 40)}…)`,
    !/rgba?\(0, 0, 0, 0\.3/.test(posShadow));
  const posBorder = light.cs(L.posCard, 'borderTopColor');
  check(`light: .lab-card has a dark border (${posBorder})`,
    (toRgb(posBorder)?.[0] ?? 255) < 150);

  /* ══ 6. The token sheet's Send / Swap buttons are VISIBLE ══════════════
     «دکمه سواپ و ارسال در تم روشن معلوم نیست». Before: a white 78% card with a
     7%-alpha border on a white sheet — the two primary actions on that sheet
     had no edge, no fill and no shadow a finger could find. */
  for (const [label, node, textNode] of [
    ['Send', L.sendBtn, L.sendLabel],
    ['Swap', L.swapBtn, L.swapLabel]
  ]) {
    const bgImage = light.cs(node, 'backgroundImage');
    const bgColor = light.cs(node, 'backgroundColor');
    const stops = gradientStops(`${bgImage} ${bgColor}`);
    /* A tinted fill (not plain white) is what makes the button read as a
       button on a white sheet. */
    const hasTint = stops.some((s) => {
      const rgb = toRgb(s);
      if (!rgb) return false;
      const spread = Math.max(...rgb) - Math.min(...rgb);
      return spread > 12 || alphaOf(s) < 0.95;
    });
    check(`light: the ${label} button has a tinted fill`, hasTint);

    const border = light.cs(node, 'borderTopColor');
    /* "Visible" is measured, not guessed: composite the border over the white
       sheet it sits on and require real separation from it. A magenta border
       fails a naive `red < 160` test while being perfectly visible, which is
       why this compares luminance against the surface instead. */
    const borderSeen = over(border, '#ffffff', alphaOf(border));
    const borderContrast = ratio(borderSeen, '#ffffff');
    check(`light: the ${label} button has a visible border (${border} → ${borderContrast?.toFixed(2)}:1 vs the sheet)`,
      borderContrast != null && borderContrast >= 1.25);

    const textColor = light.val(textNode, 'color');
    /* Measure against the darkest stop the label can land on. */
    const worst = Math.min(...(stops.length ? stops : ['#ffffff']).map((s) => {
      const composite = over(s, PAGE_BG, alphaOf(s));
      return ratio(textColor, composite) ?? 99;
    }));
    check(`light: the ${label} label clears WCAG AA (${worst.toFixed(2)})`, worst >= 4.5);
  }

  /* The wallet's own action strip must keep working — it is the same family. */
  const tileText = light.val(L.tileLabel, 'color');
  check(`light: the wallet action tile label is dark (${tileText})`,
    (toRgb(tileText)?.[0] ?? 999) < 80);

  /* ══ 7. The network chips on that sheet ════════════════════════════════ */
  const activeChip = light.cs(L.netChip, 'backgroundColor');
  check(`light: the active network chip is a real surface (${activeChip})`,
    alphaOf(activeChip) >= 0.9);
  const idleChip = light.val(L.netChipIdle, 'color');
  check(`light: an idle network chip is legible (${idleChip})`,
    ratio(idleChip, PAGE_BG) >= 3);

  /* ══ 8. Nothing about the dark theme moved ═════════════════════════════
     Asserted against the stylesheet text rather than getComputedStyle: the
     dark `.lab-hero` background uses `color-mix()`, which jsdom's CSS parser
     drops (it reports `backgroundImage: none`), so a computed-style read here
     would be measuring a parser gap instead of the theme. Every light rule
     added for this fix is `:root[data-theme='light']`-scoped, so the base
     dark declarations surviving intact in the source IS the guarantee. */
  const labCss = readFileSync('src/styles/lab-modern.css', 'utf8');
  const darkHeroRule = labCss.slice(
    labCss.indexOf('.lab-hero {'),
    labCss.indexOf('.lab-hero {') + 600
  );
  check('dark: .lab-hero still declares its dark gradient',
    /linear-gradient\(165deg, #12141f, #090a10/.test(darkHeroRule));
  /* The real non-regression question: did the light-theme rules leak into the
     unscoped base declarations? Strip every `:root[data-theme='light']`-scoped
     rule and assert what is left still describes the dark surface. */
  const baseCss = labCss.replace(/:root\[data-theme='light'\][^{]*\{[^}]*\}/g, '');
  check('dark: stripping the light rules leaves the ticket\'s translucent dark fill intact',
    /\.trade-ticket[^{]*\{[^}]*rgba\(255, ?255, ?255, ?0?\.06\)/s.test(baseCss));
  check('dark: no light-theme literal leaked into the unscoped base rules',
    !/#f2f4fb|rgba\(106, ?58, ?224, ?0?\.14\)/.test(baseCss));
  /* Count the light-scoped rules this fix added, so a later cleanup that
     deletes them is visible. */
  const lightTradeRules = (labCss.match(/:root\[data-theme='light'\]\s+\.(?:lab-hero|lab-aurora|trade-ticket|trade-summary-row|lab-card|lab-round|lab-stat|lab-count|trade-cta)/g) ?? []).length;
  check(`light: the Trade surfaces have ${lightTradeRules} themed rules (expected ≥ 9)`, lightTradeRules >= 9);
  const darkTicketBorder = dark.cs(D.ticket, 'borderTopColor');
  check(`dark: .trade-ticket keeps its light-on-dark border (${darkTicketBorder})`,
    (toRgb(darkTicketBorder)?.[0] ?? 0) > 200);
} catch (err) {
  results.push({ name: `probe threw: ${err && err.message}`, ok: false });
}

export default results;

export function summary() {
  return {
    label: 'practice-trade + token-sheet light theme',
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
