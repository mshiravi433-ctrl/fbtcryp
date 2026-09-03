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

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

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
/* Inline SVG icon set (stroke, 24×24, currentColor). Kept tiny.       */
/* ------------------------------------------------------------------ */

const I = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  swap: I('<path d="M4 7h12"/><path d="M13 4l3 3-3 3"/><path d="M20 17H8"/><path d="M11 20l-3-3 3-3"/>'),
  wallet: I('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12.5h3"/><path d="M3 9.5h18"/>'),
  signals: I('<path d="M4 19V10"/><path d="M10 19V5"/><path d="M16 19v-8"/><path d="M22 19V8"/>'),
  intent: I('<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.8-.3-4-.9L3 21l1.9-5.5A8.5 8.5 0 1 1 21 11.5z"/><path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01"/>'),
  smartMoney: I('<path d="M3 16c2-4 5-6 9-6s7 2 9 6"/><path d="M3 16c2 3 5 5 9 5s7-2 9-5"/><circle cx="12" cy="7" r="2.4"/>'),
  farm: I('<path d="M12 21V11"/><path d="M12 11c0-4 3-7 8-7 0 4-3 7-8 7z"/><path d="M12 14c0-3-2.4-5-6-5 0 3 2.4 5 6 5z"/>'),
  orders: I('<path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  lending: I('<circle cx="8" cy="8" r="4"/><circle cx="16" cy="16" r="4"/><path d="M14 6l-4 12"/>'),
  stocks: I('<path d="M7 4v5M7 13v5"/><rect x="5" y="7" width="4" height="6" rx="1"/><path d="M17 3v4M17 15v4"/><rect x="15" y="9" width="4" height="6" rx="1"/>'),
  rwa: I('<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/>'),
  ai: I('<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l1.6 1.6M19 5l-1.6 1.6M5 19l1.6-1.6M19 19l-1.6-1.6"/>'),
  explore: I('<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2l-2 5.6-3.6-5.6 5.6 3.6z"/><path d="M12 3v2M21 12h-2"/>'),
  shield: I('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9.5 12l2 2 3.5-4"/>'),
  key: I('<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3"/><path d="M16 7l3 3M18.5 4.5L21 7"/>'),
  globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 2.6 4 5.7 4 9s-1.2 6.4-4 9c-2.8-2.6-4-5.7-4-9s1.2-6.4 4-9z"/>'),
  zap: I('<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>'),
  brain: I('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 3 5 3 3 0 0 0 5 2 3 3 0 0 0 5-2 3 3 0 0 0 3-5 3 3 0 0 0-2-5 3 3 0 0 0-3-3 2.5 2.5 0 0 0-3 0A2.5 2.5 0 0 0 9 4z"/><path d="M12 5v14"/>'),
  doc: I('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  link: I('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>'),
  spark: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z"/>'),
  eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  radar: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><path d="M12 12l6-6"/>'),
  go: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M9 7h8v8"/></svg>',
  burger:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  flowArrow: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="arr"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
};

const icon = (name) => `<span class="card-icon">${ICONS[name] || ICONS.spark}</span>`;

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
function nav(site) {
  const links = COPY.nav.links
    .map((l) => `<a href="${l.href}">${T({ en: l.en, fa: l.fa })}</a>`)
    .join('');
  return `<header id="site-nav" class="nav">
    <div class="wrap nav-inner">
      <a class="brand" href="${site}/" aria-label="FBT Swap">
        <span class="brand-mark"><img src="/icon-192.png" alt="" width="24" height="24"></span>
        <span>FBT Swap</span>
      </a>
      <nav class="nav-links" aria-label="Sections">${links}</nav>
      <span class="nav-spacer"></span>
      <div class="lang-switch" role="group" aria-label="Language">
        <button class="lang-btn" type="button" data-setlang="en" aria-pressed="true">EN</button>
        <button class="lang-btn" type="button" data-setlang="fa" aria-pressed="false">فارسی</button>
      </div>
      <a class="btn btn-primary nav-cta" href="${site}/#/intent" style="padding:10px 16px;font-size:13.5px">${T(COPY.nav.cta)}</a>
      <button id="menu-toggle" class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-menu" aria-label="Menu">${ICONS.burger}</button>
    </div>
    <nav id="mobile-menu" class="mobile-menu" aria-label="Mobile">
      <div class="wrap">${links}</div>
    </nav>
  </header>`;
}

/* 2 ── Hero ------------------------------------------------------------- */
function hero(site) {
  const chips = COPY.hero.chips.map((c) => `<li class="chip chip-glow">${T(c)}</li>`).join('');
  const intentSteps = ['Intent', 'Strategy', 'Approve', 'Execute'];
  const intentStepsFa = ['نیت', 'استراتژی', 'تأیید', 'اجرا'];
  const flowMini = intentSteps
    .map((s, i) => `<span>${T({ en: s, fa: intentStepsFa[i] })}</span>`)
    .join('');
  const marketRow = (sym, name, id) =>
    `<div class="mrow"><span class="t">${sym}</span><span>${name}</span><span class="num" id="${id}-p" style="margin-inline-start:auto">—</span><span class="chg flat" id="${id}-c">—</span></div>`;
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
            <a class="btn btn-ghost" href="#ecosystem"><span>${T(COPY.hero.ctaSecondary)}</span></a>
          </div>
          <ul class="hero-chips reveal" style="--d:240ms">${chips}</ul>
        </div>

        <div class="dash reveal" style="--d:200ms" aria-hidden="true">
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
              <span class="mini-kpi flat" id="dp-chg" style="font-size:11px">—</span>
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

/* 4 ── AI Intent OS ----------------------------------------------------- */
function intentOS(site) {
  const steps = COPY.intentOS.steps
    .map(
      (s, i) =>
        `<li style="--i:${i}" class="${i === 6 ? 'approve' : ''}"><b>${T(s)}</b></li>`
    )
    .join('');
  const says = COPY.intentOS.personalize.chips
    .map(
      (c) => `<div class="say-card">
          <div class="s1">${T(c.say)}</div>
          <div class="s2">${T(c.act)}</div>
        </div>`
    )
    .join('');
  return `<section id="intent-os">
    <div class="wrap">
      ${secHead({ kicker: `${esc(COPY.intentOS.kicker)} <span class="tag tag-live">${T({ en: 'Core', fa: 'هسته' })}</span>`, h2: COPY.intentOS.h2, lede: COPY.intentOS.lede })}
      <div class="grid grid-2" style="align-items:start">
        <div class="reveal">
          <blockquote class="intent-quote">
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
        <ol class="flow reveal flow-host" aria-label="${esc(COPY.intentOS.kicker)}">${steps}</ol>
      </div>
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
      <div class="note-inline reveal" style="margin-block-start:14px">
        <span class="risk-mark" style="border-color:rgba(99,245,187,.4);color:var(--lime)">≡</span>
        <span>${T(COPY.signals.honesty)}</span>
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
      <div class="net-grid">${cards}</div>
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
  const cards = COPY.ecosystem.cards
    .map(
      (c) => `<a class="card reveal" href="${site}${c.route}">
        <span class="go">${ICONS.go}</span>
        <h3>${icon(c.icon)}${T(c.t)}</h3>
        <p>${T(c.d)}</p>
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
    intents: {
      en: COPY.hero.dash.sampleIntents.map((i) => i.en),
      fa: COPY.hero.dash.sampleIntents.map((i) => i.fa)
    }
  };

  const sections = [
    hero(SITE),
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
<div class="ambient" aria-hidden="true"><span class="ambient-grid"></span><span class="orb orb-a"></span><span class="orb orb-b"></span></div>
${nav(SITE)}
<main id="main" tabindex="-1">
  ${sections}
</main>
<script>window.__FBT_L10N__ = ${jsonForScript(L10N)};</script>
<script>${RUNTIME}</script>
</body>
</html>
`;
}
