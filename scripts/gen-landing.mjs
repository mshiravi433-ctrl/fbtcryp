#!/usr/bin/env node
/**
 * CRAWLABLE LANDING PAGES
 * ---------------------------------------------------------------------------
 * ─── THE PROBLEM, MEASURED ──────────────────────────────────────────────────
 * The app has 33 routes. Google has indexed ONE page.
 *
 * That is not bad luck, it is arithmetic: every route is behind a hash
 * (`/#/swap`), and everything after the `#` is never sent to the server. A
 * crawler asking for `/#/swap` receives the identical HTML it got for `/`, so
 * there is exactly one indexable document no matter how many screens exist.
 *
 * Verified against the live site: `site:lawpoetics.ir` returns a single
 * result, and `sitemap.xml` honestly lists one URL because inventing hash
 * entries would just 404 on inspection.
 *
 * Meanwhile `/api/orders/watch/status` still reports `watches: 0`. Zero real
 * users. Everything else built recently — the history engine, the second
 * aggregator, the wallet redesign — is worth nothing until somebody arrives,
 * and search is the only arrival channel that costs no money and keeps
 * working while nobody is watching it.
 *
 * ─── WHY STATIC HTML AND NOT SSR ────────────────────────────────────────────
 * Server-side rendering would mean a rendering server, a second code path for
 * every screen, and a per-request cost. The owner's constraint is explicit:
 * «فعلا پول نمیشه خرج کرد» — no money to spend.
 *
 * These pages cost nothing. They are generated at build time, served as plain
 * files by the hosting we already pay nothing for, and each one immediately
 * hands the visitor into the real app. No server, no runtime, no maintenance
 * beyond the table below.
 *
 * ─── WHY THIS IS NOT CLOAKING ───────────────────────────────────────────────
 * Worth stating plainly, because generated pages for crawlers can be exactly
 * that and Google penalises it hard.
 *
 * A crawler and a person are served the SAME file. There is no user-agent
 * sniffing anywhere. The content is genuine, human-written prose describing a
 * real feature that really exists, and the link into the app is a normal
 * anchor a person is meant to click. That is a landing page, which is
 * ordinary and allowed. Cloaking is showing different content to the crawler
 * than to the user, and nothing here does that.
 *
 * ─── THE HONESTY RULE FOR THE COPY ──────────────────────────────────────────
 * Every claim below has to be true of the shipped app. The old <title>
 * advertised "9 Chains" and Tron support that does not exist — that text was
 * what Google had indexed, so the one thing search engines knew about us was
 * partly false. Anyone arriving to swap on Tron would find nothing and leave.
 * Do not add a page here for a feature until it works.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = process.env.VITE_PUBLIC_URL || 'https://www.lawpoetics.ir';
const OUT = 'dist';

/**
 * One entry per page.
 *
 * Kept deliberately short. A handful of pages about things people actually
 * search for beats thirty thin pages, which search engines treat as a quality
 * signal against the whole domain.
 *
 * `route` is the in-app hash destination the visitor is sent to.
 */
const PAGES = [
  {
    slug: 'non-custodial-crypto-swap',
    route: '/#/swap',
    title: 'Non-Custodial Crypto Swap — Keep Your Own Keys | FBT Swap',
    description:
      'Swap tokens across eight networks without giving up your private keys. No account, no email, no identity check. You sign every trade from your own wallet.',
    h1: 'Swap crypto without giving up your keys',
    body: [
      'FBT Swap is a non-custodial exchange interface. You connect a wallet you already own, you swap, and your assets never leave your control. There is no account to create, no email to hand over and no identity check to pass.',
      'It does not run an order book and holds no liquidity of its own. It asks public aggregators for the best route across the decentralised exchanges on the network you chose, shows you the quote, the price impact and the fee, then hands the transaction to your wallet. You are the one who signs it, and the swap settles on-chain directly between your wallet and the protocol.',
      'Because nobody here holds your keys, this also means what you would expect: we cannot reverse a transaction, freeze funds, or recover a lost recovery phrase. Nobody can.'
    ],
    facts: [
      ['Networks', 'BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Solana'],
      ['Platform fee', '0.70% of the input, shown on screen before you sign'],
      ['Custody', 'None. Your keys stay in your wallet'],
      ['Signup', 'Not required']
    ]
  },
  {
    slug: 'crypto-price-alerts-and-dca',
    route: '/#/orders',
    title: 'Crypto Price Alerts and Recurring Buys | FBT Swap',
    description:
      'Set a target price and get told when the market reaches it, or schedule recurring buys. Alerts reach your phone even when the app is closed.',
    h1: 'Price alerts and recurring buys',
    body: [
      'Set a target price on any supported pair and the app tells you when the market reaches it. The alert arrives on your phone even when the app is closed, and the swap is one tap away with the amounts already filled in.',
      'Recurring buys work the same way: choose an amount and an interval, and you are reminded when each one is due. Spreading entries over time is what most people mean by dollar-cost averaging, and it removes the guessing about when the bottom is.',
      'These are alerts, not automatic trades, and the difference is deliberate. Filling an order while you sleep requires somebody to hold your funds or an unlimited spending allowance over them. This app does neither, so nothing can move money without you signing for it. A limit order that silently does not fill would be worse than no feature at all, so the limitation is stated on the screen itself.'
    ],
    facts: [
      ['Order types', 'Limit price, trailing stop, recurring buy'],
      ['Alerts', 'Push notification, works with the app closed'],
      ['Execution', 'You sign every swap — nothing is automatic'],
      ['Custody', 'None. No spending allowance is requested']
    ]
  },
  {
    slug: 'crypto-market-history-analysis',
    route: '/#/signals',
    title: 'Crypto Chart History — What the Past Actually Says | FBT Swap',
    description:
      'See how often a price level has held, the worst drawdown in the window, and how today’s volume compares to normal. Measurements from real data, not predictions.',
    h1: 'What the past actually says',
    body: [
      'Most chart tools give you a snapshot: an RSI reading, a moving average, one support line. None of that answers the question people actually ask before setting a target price — has the market been here before, and what happened?',
      'This app measures repeated behaviour across the whole series. It finds the levels price keeps returning to and counts the touches, reports how often each one held versus broke, shows the worst peak-to-trough fall in the window, and compares today’s volume to this coin’s own median rather than to some absolute number.',
      'Nothing here forecasts anything, and that is the point. "This level was tested four times and held three" is a fact about data that already exists. "This level will hold" is a guess. A level that held four times can break on the fifth, and the app says so on the same screen.'
    ],
    facts: [
      ['Levels', 'Counted touches, with a held-versus-broke record'],
      ['Drawdown', 'Worst peak-to-trough fall in the window'],
      ['Volume', 'Compared to this coin’s own median, not an absolute figure'],
      ['Forecasts', 'None. Every figure describes data that already happened']
    ]
  }
];

/** Escape anything that goes into HTML text or an attribute. */
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function render(page) {
  const url = `${SITE}/${page.slug}`;
  const appUrl = `${SITE}${page.route}`;

  /*
   * The redirect is a <link rel="canonical"> plus a normal link, NOT a
   * meta-refresh or a JS redirect.
   *
   * An instant redirect on a landing page is treated as a doorway page and is
   * penalised. More practically, a bounced visitor who never saw the content
   * learns nothing about what the app does — the page has to be worth reading
   * on its own or it should not exist.
   */
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#06070c">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">

<meta property="og:type" content="website">
<meta property="og:site_name" content="FBT Swap">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(SITE)}/icon-512.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@CompanyFbt">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${esc(SITE)}/icon-512.png">

<style>
  /* Inlined, because a landing page that waits on a stylesheet is a landing
     page people leave. It is small enough that a second request would cost
     more than the bytes. */
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #06070c;
    color: #e8ecf6;
    font: 16px/1.75 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 32px 20px 64px;
  }
  main { max-width: 680px; margin: 0 auto; }
  a { color: #00e5ff; }
  h1 { font-size: clamp(26px, 6vw, 38px); line-height: 1.2; margin: 0 0 18px; letter-spacing: -0.02em; }
  h2 { font-size: 17px; margin: 34px 0 10px; }
  p { color: #b9c2d8; margin: 0 0 16px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 30px; font-weight: 700; }
  .brand img { width: 30px; height: 30px; border-radius: 9px; }
  .cta {
    display: inline-block;
    margin: 10px 0 8px;
    padding: 14px 26px;
    border-radius: 14px;
    background: linear-gradient(135deg, #00e5ff, #7c4dff);
    color: #05060b;
    font-weight: 700;
    text-decoration: none;
  }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 18px; }
  th, td { text-align: start; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.09); font-size: 14.5px; vertical-align: top; }
  th { color: #8e98b3; font-weight: 600; width: 38%; }
  footer { margin-top: 40px; font-size: 13px; color: #7a839c; }
  footer a { color: #8e98b3; }
  .risk { font-size: 13px; color: #8e98b3; border-inline-start: 2px solid #ffb300; padding-inline-start: 12px; margin-top: 26px; }
</style>
</head>
<body>
<main>
  <div class="brand">
    <img src="/icon-192.png" alt="" width="30" height="30">
    <span>FBT Swap</span>
  </div>

  <h1>${esc(page.h1)}</h1>

  ${page.body.map((p) => `<p>${esc(p)}</p>`).join('\n  ')}

  <a class="cta" href="${esc(appUrl)}">Open the app</a>

  <h2>At a glance</h2>
  <table>
    <tbody>
      ${page.facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('\n      ')}
    </tbody>
  </table>

  <p class="risk">
    Crypto assets are volatile and on-chain transactions cannot be reversed. You can lose money,
    including all of it. Nothing here is financial advice.
  </p>

  <footer>
    <p>
      ${PAGES.filter((p) => p.slug !== page.slug)
        .map((p) => `<a href="/${esc(p.slug)}">${esc(p.h1)}</a>`)
        .join(' &middot; ')}
    </p>
    <p>
      <a href="${esc(SITE)}/">FBT Swap</a> &middot;
      <a href="${esc(SITE)}/#/legal/privacy">Privacy</a> &middot;
      <a href="${esc(SITE)}/#/legal/terms">Terms</a><br>
      Fanous Bazaar Pishgam Co., Isfahan, Iran
    </p>
  </footer>
</main>
</body>
</html>
`;
}

/* -------------------------------------------------------------------------- */

function main() {
  for (const page of PAGES) {
    /*
     * A DIRECTORY with index.html, not `slug.html`. Static hosts serve
     * `/slug/` from `/slug/index.html`, giving a clean URL with no extension
     * — and a URL that ends in `.html` looks abandoned in 2026.
     */
    const dir = join(OUT, page.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), render(page), 'utf8');
  }

  /*
   * Rewrite the sitemap so the new pages are actually discoverable. Submitting
   * a sitemap that omits them would leave the whole exercise depending on
   * Google finding the links on its own.
   */
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    ...PAGES.map(
      (p) =>
        `  <url>\n    <loc>${SITE}/${p.slug}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`
    )
  ];

  writeFileSync(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by scripts/gen-landing.mjs — do not edit by hand.

  Only real, server-rendered URLs are listed. In-app routes are hash-based
  (/#/swap) and a crawler never sees anything after the '#', so listing them
  would add entries that resolve to the same single document.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`,
    'utf8'
  );

  // Sanity check: the app's own index must still be there. A generator that
  // overwrote it would take the whole site down.
  readFileSync(join(OUT, 'index.html'), 'utf8');

  console.log(`▸ generated ${PAGES.length} landing pages + sitemap`);
  for (const p of PAGES) console.log(`  /${p.slug}`);
}

main();
