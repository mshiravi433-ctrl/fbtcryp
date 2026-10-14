/**
 * The crawlable homepage reference content, rendered below #root.
 *
 * ─── WHO READS THIS ────────────────────────────────────────────────────────
 * It is injected into the delivered `dist/index.html`, so a reader without
 * JavaScript — and every crawler that does not execute it, the answer engines
 * in robots.txt included — gets a real document: the facts, the page map and
 * the internal link graph. It is NOT app UI. The running app retires the block
 * before its first render, on every route including the homepage (see
 * src/lib/homeHub.js), and hides it rather than deleting it so a renderer still
 * finds the content in the DOM. No user-agent or crawler branching is used: one
 * document is served to everyone.
 *
 * Links come from the emitted page list. This improves discoverability, but
 * cannot establish Google indexing, rankings, sitelinks or AI citations.
 */

import { CLUSTER_INDEX, CLUSTER_ORDER } from './index.mjs';
import { DISCOVERY_STYLES, renderDiscovery } from './discovery.mjs';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** How many spokes of each cluster are listed under the hub on the homepage.
 *  Capped so the page stays readable and so the internal-link count on one
 *  document stays well under the volume where each link stops meaning much. */
const SPOKE_CAP = 6;

/* The facts an answer engine must not garble, in both languages. These are the
 * same claims llms.txt and the trust pages make — one source of truth in
 * prose, repeated here so the root document can be quoted without a crawl. */
const FACTS = {
  fa: [
    ['حضانت', 'هیچ. دارایی و عبارت بازیابی نزد خودت می‌ماند؛ هیچ تراکنشی بدون امضای تو انجام نمی‌شود.'],
    ['کارمزد پلتفرم', '۰٫۷۰٪ از مبلغ ورودی که پیش از امضا روی صفحه نشان داده می‌شود. گس شبکه جداست و به شبکه پرداخت می‌شود.'],
    ['ثبت‌نام و احراز هویت', 'برای رابط سواپ روی زنجیره لازم نیست: نه حساب، نه ایمیل، نه مدرک شناسایی.'],
    ['شبکه‌ها', 'هفده شبکه: بی‌ان‌بی چین، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا، سونیک، براچین، یونی‌چین، موناد، منتل، اسکرول، زی‌کی‌سینک، زنجیرهٔ رابین‌هود و سولانا.'],
    ['پلتفرم‌ها', 'اپلیکیشن اندروید، وب قابل نصب و مینی‌اپ تلگرام. نسخهٔ آی‌او‌اس وجود ندارد.']
  ],
  en: [
    ['Custody', 'None. Your assets and recovery phrase stay in your wallet, and nothing is signed without your approval.'],
    ['Platform fee', '0.70% of the input amount, shown on screen before you sign. Network gas is separate and is paid to the chain.'],
    ['Signup and KYC', 'Not required for the on-chain swap interface: no account, no email, no identity document.'],
    ['Networks', 'Seventeen: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, Berachain, Unichain, Monad, Mantle, Scroll, zkSync Era, Robinhood Chain and Solana.'],
    ['Platforms', 'Android app, installable web app and a Telegram Mini App. There is no iOS build.']
  ]
};

const LEDE = {
  fa: 'اف‌بی‌تی سواپ یک رابط سواپ غیرامانی ارز دیجیتال است: کیف پول خودت را وصل می‌کنی، نرخ و کارمزد را پیش از امضا می‌بینی و تراکنش در همان کیف پول امضا می‌شود. دارایی، کلید و عبارت بازیابی هیچ‌وقت از کیف پول تو خارج نمی‌شوند، چون ما چیزی برای نگه‌داری نداریم.',
  en: 'FBT Swap is a non-custodial crypto swap interface. You connect a wallet you already own, you see the quote and the fee before you sign, and the transaction is signed in that wallet. Your assets, your keys and your recovery phrase never leave it, because there is nothing here to hold them.'
};

const H1 = {
  fa: 'اف‌بی‌تی سواپ؛ سواپ غیرامانی ارز دیجیتال روی ۱۷ شبکه',
  en: 'FBT Swap — a non-custodial crypto swap interface on 17 networks'
};

const UI = {
  fa: {
    lang: 'fa',
    dir: 'rtl',
    glance: 'در یک نگاه',
    /* One <h1> per document. The Persian block owns it, so its subsections are
       h2; the English block's own title is h2 and its subsections are h3. A
       heading level is never skipped, which the build audit checks. */
    subTag: 'h2',
    topics: 'همهٔ راهنماها، بر پایهٔ موضوع',
    topicsLede: 'هر موضوع یک صفحهٔ مرجع دارد و راهنماهای دقیق‌تر زیر آن هستند. از هر کدام می‌توانی شروع کنی؛ صفحه‌ها به هم پیوند دارند.',
    library: 'کتابخانهٔ همهٔ صفحات',
    flagship: 'معرفی کامل محصول',
    guides: ({ n }) => `${n} راهنما`,
    trust: 'دربارهٔ ما و خط‌مشی‌ها',
    trustLinks: [
      ['/fa/trust/', 'چه کسی پشت این پروژه است'],
      ['/fa/trust/how-we-make-money', 'از کجا درآمد داریم'],
      ['/fa/trust/what-we-cannot-do', 'چه کارهایی نمی‌توانیم بکنیم'],
      ['/fa/trust/security-practices', 'روش‌های امنیتی'],
      ['/fa/trust/editorial-policy', 'خط‌مشی محتوا'],
      ['/fa/trust/contact-and-verification', 'راه‌های تماس']
    ],
    note: 'ارزهای دیجیتال پرنوسان‌اند و تراکنش‌های روی زنجیره برگشت‌ناپذیرند؛ این متن توصیهٔ مالی نیست و وعدهٔ سود یا دسترسی بدون محدودیت نمی‌دهد.'
  },
  en: {
    lang: 'en',
    dir: 'ltr',
    glance: 'At a glance',
    subTag: 'h3',
    topics: 'Every guide, grouped by topic',
    topicsLede: 'Each topic has one reference page with the detailed guides underneath it. Start anywhere — the pages link to each other.',
    library: 'Page library',
    flagship: 'Full product tour',
    guides: ({ n }) => `${n} guide${n === 1 ? '' : 's'}`,
    trust: 'About us and our policies',
    trustLinks: [
      ['/trust/', 'Who is behind this project'],
      ['/trust/how-we-make-money', 'How we make money'],
      ['/trust/what-we-cannot-do', 'What we cannot do'],
      ['/trust/security-practices', 'Security practices'],
      ['/trust/editorial-policy', 'Editorial policy'],
      ['/trust/contact-and-verification', 'Contact and verification']
    ],
    note: 'Crypto assets are volatile and on-chain transactions cannot be reversed. Nothing here is financial advice, a profit promise or a guarantee of unrestricted access.'
  }
};

/**
 * Build one language's cluster directory from the cluster index.
 * `pages` is the emitted page list; a slug is only ever linked if a document
 * was really generated for it.
 */
function clusterDirectory(lang, pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const blocks = [];

  for (const id of CLUSTER_ORDER) {
    const entry = CLUSTER_INDEX[id]?.[lang];
    if (!entry) continue;
    const hub = bySlug.get(entry.hub);
    if (!hub) continue;
    const spokes = entry.spokes
      .map((slug) => bySlug.get(slug))
      .filter(Boolean)
      .slice(0, SPOKE_CAP);
    if (!spokes.length) continue;

    blocks.push(
      `        <div class="hh-group">` +
        `\n          <h3><a href="/${esc(hub.slug)}">${esc(entry.label)}</a> <span class="hh-count">${esc(
          UI[lang].guides({ n: entry.spokes.length })
        )}</span></h3>` +
        `\n          <p>${esc(hub.description)}</p>` +
        `\n          <ul>` +
        spokes
          .map(
            (sp) =>
              `\n            <li><a href="/${esc(sp.slug)}">${esc(sp.h1 || sp.title)}</a></li>`
          )
          .join('') +
        `\n          </ul>` +
        `\n        </div>`
    );
  }
  return blocks.join('\n');
}

function factsBlock(lang) {
  return FACTS[lang]
    .map(
      ([term, value]) =>
        `          <div class="hh-fact"><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`
    )
    .join('\n');
}

/**
 * @param {object} args
 * @param {string} args.site          canonical origin, e.g. https://fbtswap.ir
 * @param {Array}  args.pages         the emitted page objects (PAGES)
 * @param {string} args.flagshipSlug  the bilingual landing's slug
 * @param {(slug:string)=>string} args.slugPath
 * @returns {string} HTML for the home hub
 */
export function renderHomeHub({ site, pages, flagshipSlug, slugPath }) {
  const flagshipPath = `/${slugPath(flagshipSlug)}`;

  const section = (lang) => {
    const u = UI[lang];
    const isFa = lang === 'fa';
    const heading = isFa
      ? `<h1>${esc(H1.fa)}</h1>`
      : `<h2>${esc(H1.en)}</h2>`;
    const sub = u.subTag;
    const librarySlug = isFa ? 'fa/' : 'library';

    return `      <section class="hh-lang" lang="${u.lang}" dir="${u.dir}">
${heading}
        <p class="hh-lede">${esc(LEDE[lang])}</p>

        <${sub} class="hh-sub">${esc(u.glance)}</${sub}>
        <dl class="hh-facts">
${factsBlock(lang)}
        </dl>

        ${renderDiscovery({ lang, headingTag: sub })}

        <nav class="hh-top" aria-label="${esc(u.topics)}">
          <a class="hh-lib" href="/${slugPath(librarySlug)}">${esc(u.library)}</a>
          <a class="hh-lib hh-lib-flagship" href="${esc(flagshipPath)}">${esc(u.flagship)}</a>
        </nav>

        <${sub} class="hh-sub">${esc(u.topics)}</${sub}>
        <p class="hh-hint">${esc(u.topicsLede)}</p>
        <div class="hh-grid">
${clusterDirectory(lang, pages)}
        </div>

        <${sub} class="hh-sub">${esc(u.trust)}</${sub}>
        <ul class="hh-trust">
${u.trustLinks
  .map(([href, text]) => `          <li><a href="${esc(href)}">${esc(text)}</a></li>`)
  .join('\n')}
        </ul>

        <p class="hh-note">${esc(u.note)}</p>
      </section>`;
  };

  /*
   * The stylesheet travels with the markup on purpose. This block is injected
   * into dist/index.html at build time, and a rule that lived in index.html
   * while the classes lived here would drift the first time one of them
   * changed. One file, one change.
   *
   * The colours follow --boot-bg/--boot-fg so the block matches whichever
   * theme the inline script in index.html resolved before first paint.
   */
  return `<style>
  #home-hub {
    background: var(--bg-void, var(--boot-bg, #000));
    color: var(--text-1, var(--boot-fg, #fff));
    font-family: 'Vazirmatn', system-ui, -apple-system, 'Segoe UI', sans-serif;
    line-height: 1.95;
    position: relative;
    z-index: 1;
    border-top: 1px solid var(--border, rgba(168,186,236,.22));
    padding: 40px 18px calc(90px + env(safe-area-inset-bottom));
    box-sizing: border-box;
  }
  #home-hub * { box-sizing: border-box; }
  /* The app retires this block before its first render (src/lib/homeHub.js).
     The hidden attribute is the only thing standing between the reference
     document and the top of the app, so it cannot be left to the user-agent
     stylesheet's [hidden] { display: none }: any future author display rule on
     #home-hub would silently beat it. */
  #home-hub[hidden] { display: none !important; }
  #home-hub .hh-wrap { max-width: 860px; margin: 0 auto; }
  #home-hub .hh-head { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; }
  #home-hub .hh-head img { border-radius: 12px; display: block; }
  #home-hub .hh-brand { font-weight: 800; letter-spacing: .02em; margin: 0; }
  #home-hub .hh-lang + .hh-lang { margin-top: 52px; padding-top: 40px; border-top: 1px solid rgba(255,255,255,.12); }
  #home-hub h1 { font-size: clamp(24px, 6.4vw, 38px); line-height: 1.35; margin: 0 0 14px; }
  #home-hub h2 { font-size: clamp(21px, 5.2vw, 30px); line-height: 1.4; margin: 0 0 14px; }
  #home-hub h3 { font-size: 16px; margin: 30px 0 8px; }
  #home-hub .hh-lede { margin: 0 0 6px; opacity: .9; }
  #home-hub .hh-sub { letter-spacing: .06em; text-transform: uppercase; font-size: 12.5px; opacity: .62; margin-top: 34px; }
  #home-hub h2.hh-sub { font-size: 15px; }
  #home-hub h3.hh-sub { font-size: 13.5px; }
  #home-hub [dir="rtl"] .hh-sub { letter-spacing: 0; text-transform: none; }
  #home-hub .hh-hint { font-size: 14px; opacity: .72; margin: -2px 0 12px; }
  #home-hub .hh-facts { margin: 0; display: grid; gap: 10px; }
  #home-hub .hh-fact { display: grid; grid-template-columns: minmax(120px, 30%) 1fr; gap: 14px; padding: 12px 14px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; }
  #home-hub .hh-fact dt { font-weight: 700; font-size: 13.5px; opacity: .82; }
  #home-hub .hh-fact dd { margin: 0; font-size: 14px; opacity: .9; }
  #home-hub .hh-top { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0 0; }
  #home-hub .hh-lib { display: inline-block; padding: 10px 15px; border-radius: 11px; border: 1px solid rgba(255,255,255,.2); text-decoration: none; color: inherit; font-weight: 700; font-size: 14px; }
  #home-hub .hh-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 18px; }
  #home-hub .hh-group { border: 1px solid rgba(255,255,255,.12); border-radius: 14px; padding: 14px 16px; }
  #home-hub .hh-group h3 { margin: 0 0 6px; font-size: 15px; }
  #home-hub .hh-group h3 a { color: #54e8ff; text-decoration: none; }
  #home-hub .hh-count { font-size: 11.5px; opacity: .6; font-weight: 400; }
  #home-hub .hh-group p { font-size: 13px; opacity: .78; margin: 0 0 8px; }
  #home-hub .hh-group ul { margin: 0; padding-inline-start: 18px; }
  #home-hub .hh-group li { font-size: 13.5px; margin: 4px 0; }
  #home-hub a { color: var(--ink-cyan, #7dd3fc); }
  #home-hub .hh-group h3 a { color: var(--ink-cyan, #54e8ff); }
  #home-hub .hh-trust { margin: 0; padding-inline-start: 18px; columns: 2; column-gap: 24px; }
  #home-hub .hh-trust li { font-size: 13.5px; margin: 3px 0; }
  #home-hub .hh-note { margin-top: 30px; font-size: 12.5px; opacity: .6; border-inline-start: 2px solid #ffb300; padding-inline-start: 12px; }
  @media (max-width: 620px) {
    #home-hub .hh-fact { grid-template-columns: 1fr; gap: 2px; }
    #home-hub .hh-trust { columns: 1; }
  }
${DISCOVERY_STYLES}
</style>
<div id="home-hub" role="complementary" aria-label="FBT Swap — guides and product information">
  <div class="hh-wrap">
    <header class="hh-head">
      <img src="/icon-192.png" alt="" width="40" height="40" />
      <p class="hh-brand">FBT Swap &middot; اف‌بی‌تی سواپ</p>
    </header>
${section('fa')}
${section('en')}
  </div>
</div>
<noscript>
  <!-- Without JavaScript the boot spinner can never be replaced, so hide it
       and let this document stand on its own. -->
  <style>#boot, #root:empty { display: none !important; }</style>
  <p style="text-align:center;padding:20px" lang="fa" dir="rtl">برای اجرای رابط سواپ، JavaScript مرورگر را فعال کن. <span lang="en" dir="ltr">Enable JavaScript to use the swap interface.</span></p>
</noscript>
`;
}

const START = '<!-- HOME-HUB:START -->';
const END = '<!-- HOME-HUB:END -->';

/**
 * Replace whatever sits between the markers in the built index.html with the
 * generated hub.
 *
 * The markers are required, and a missing pair is a BUILD ERROR rather than a
 * shrug. A silent no-op here ships a homepage with no crawlable content and no
 * warning in the log — which is the precise failure this module exists to
 * prevent, and which nobody would notice for a month.
 */
export function injectHomeHub({ file, html, hub }) {
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `[home-hub] ${file} is missing the ${START} / ${END} markers — ` +
        'the homepage would ship with no crawlable content.'
    );
  }
  const root = html.indexOf('id="root"');
  if (root === -1 || root > start) {
    throw new Error(`[home-hub] ${file}: #root must precede the home hub so content cannot appear above the app logo.`);
  }
  return `${html.slice(0, start)}${START}\n${hub}\n${END}${html.slice(end + END.length)}`;
}

/** True when the source document still carries the markers. Used by tests. */
export function homeHubMarkers(html) {
  return { start: html.indexOf(START), end: html.indexOf(END) };
}
