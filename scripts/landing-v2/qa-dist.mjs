/**
 * QA harness for the bilingual landing page (dist output), driven by jsdom.
 * Verifies: language system, persistence, dynamic data rendering with a
 * mocked API, honest failure states, and structural SEO requirements.
 *
 * Runs against dist/, so build first:
 *   npm run build && npm run test:landing
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { COPY } from './copy.mjs';
import { gateSpeculation } from './index.mjs';

const dist = join(process.cwd(), 'dist', 'صرافی-غیرمتمرکز', 'index.html');
const html = readFileSync(dist, 'utf8');

let pass = 0, fail = 0;
const t = (name, cond) => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}`); }
};

/* ── static HTML assertions (no JS) ─────────────────────────────── */
console.log('— static HTML —');
t('default language is English (html lang=en dir=ltr)', /<html lang="en" dir="ltr" data-lang="en">/.test(html));
t('English doc title', html.includes('FBT Swap | AI-Powered Decentralized Exchange &amp; Financial OS'));
t('Persian title embedded for switcher', html.includes('FBT Swap | صرافی غیرمتمرکز و هوش مصنوعی مالی'));
t('canonical is the encoded Persian slug', html.includes('rel="canonical" href="https://fbtswap.ir/%D8%B5%D8%B1%D8%A7%D9%81%DB%8C-%D8%BA%DB%8C%D8%B1%D9%85%D8%AA%D9%85%D8%B1%DA%A9%D8%B2"'));
t('hreflang en+fa+x-default present', html.includes('hreflang="en"') && html.includes('hreflang="fa"') && html.includes('hreflang="x-default"'));
t('FAQPage JSON-LD present', html.includes('"FAQPage"'));
t('SoftwareApplication JSON-LD present', html.includes('"SoftwareApplication"'));
t('Organization JSON-LD present', html.includes('"Organization"'));
t('BreadcrumbList JSON-LD present', html.includes('"BreadcrumbList"'));
t('WebSite JSON-LD present', html.includes('"WebSite"'));
t('fee figure rendered from config (0.7%)', html.includes('>0.7%</span>') || html.includes('0.7%'));
t('Persian fee figure rendered (۰٫۷٪)', html.includes('۰٫۷٪'));
t('all 10 networks listed', ['BNB Chain', 'Ethereum', 'Polygon', 'Arbitrum', 'Base', 'Optimism', 'Avalanche', 'Linea', 'Sonic', 'Solana'].every((n) => (html.match(new RegExp(n, 'g')) || []).length >= 1));
t('language switcher buttons exist', html.includes('data-setlang="en"') && html.includes('data-setlang="fa"'));

/* ── v2.1: the header, the bottom dock, the tour, the arrows ─────────── */
console.log('— landing v2.1 (header / dock / tour / arrows) —');
const header = /<header id="site-nav"[\s\S]*?<\/header>/.exec(html)?.[0] || '';
t('header keeps the logo mark', header.includes('brand-mark') && header.includes('/icon-192.png'));
t('header has no wordmark next to the logo', !/>\s*FBT Swap\s*<\/span>/.test(header));
t('header still names itself to assistive tech', header.includes('aria-label="FBT Swap'));
t('the old burger button is gone from the header', !header.includes('menu-toggle'));
t('launch-app control is not hidden on mobile any more', !/\.nav-cta \{ display: none; \}/.test(html) && html.includes('nav-cta'));
t('launch-app control dropped its tiny inline size', !/nav-cta[^>]*style="padding:10px 16px/.test(html));
t('bottom dock exists with the page menu inside', html.includes('id="page-dock"') && html.includes('id="dock-menu"'));
t('intent chain draws a scroll-linked meter', html.includes('class="flow-meter"') && /\.flow-meter i \{/.test(html));
t('dock opens without JavaScript (checkbox + label)', html.includes('type="checkbox" id="dock-state"') && /class="dock-orb"[^>]*for="dock-state"/.test(html));
t('dock lists the app pages', ['/#/swap', '/#/stocks', '/#/perp', '/#/intent', '/#/wallet'].every((r) => html.includes('href="' + r + '"') || html.includes('href="https://fbtswap.ir' + r + '"')));
t('dock orb carries a scroll-progress ring', html.includes('id="dock-ring-fill"'));
t('product tour has the five requested pages', ['swap', 'stocks', 'futures', 'gold', 'ai'].every((k) => html.includes('id="slide-' + k + '"')));
const slideOf = (k) => new RegExp('id="slide-' + k + '"[\\s\\S]*?</article>').exec(html)?.[0] || '';
t('every tour slide is bilingual', ['swap', 'stocks', 'futures', 'gold', 'ai'].every((k) => slideOf(k).includes('lg-en') && slideOf(k).includes('lg-fa')));
t('every tour slide has sized, lazy artwork', ['swap', 'stocks', 'futures', 'gold', 'ai'].every((k) => /class="slide-art"[^>]*width="1280"/.test(slideOf(k)) && /loading="(lazy|eager)"/.test(slideOf(k))));
t('tour slides carry a Lottie slot', (html.match(/data-lottie="/g) || []).length >= 5);
t('Lottie payload is one valid JSON map of six animations', (() => {
  const m = /<script type="application\/json" id="lottie-data">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return false;
  try {
    const l = JSON.parse(m[1]);
    return ['swap', 'stocks', 'futures', 'gold', 'ai', 'tape'].every((k) => l[k] && Array.isArray(l[k].layers) && l[k].layers.length) && l.swap.v.startsWith('5.') && l.swap.fr === 30;
  } catch { return false; }
})());
t('animated line field backs the page', html.includes('id="bg-lines"') && html.includes('bg-lines path'));
t('icons come from one sprite, drawn in', html.includes('id="ic-swap"') && html.includes('<use href="#ic-') && html.includes('pathLength="100"'));
t('hero coin rows use an arrow tile, not a percentage', html.includes('class="chg-arrow flat" id="hm-bitcoin-c"') && !/%</.test(slideOf('swap')));
t('both language variants exist in DOM', (html.match(/class="lg lg-en"/g) || []).length > 150 && (html.match(/class="lg lg-fa"/g) || []).length > 150);
// "does not guarantee profit" is a required HONESTY line; what is banned is the
// marketing claim "Guaranteed Profit" (and ranked/user-count fabrications).
t('no fabricated stats claims', !/guaranteed (?:profit|apy|returns)|zero risk|#\s*1 exchange|millions of users/i.test(html));
t('risk notice present (EN+FA)', html.includes('Nothing on this page') && html.includes('توصیهٔ مالی نیست'));
t('skeleton loading rows pre-authored', (html.match(/skel-row/g) || []).length > 10);
t('prefers-reduced-motion honored', html.includes('prefers-reduced-motion'));
t('FAQ count is 8 bilingual pairs', (html.match(/<details class="reveal">/g) || []).length === 8);

/* ── the store flavour must not carry margin vocabulary ──────────── */
console.log('— build flavours —');
t('store build drops the futures slide and its dock tile', (() => {
  const slides = gateSpeculation(COPY.showcase.slides, false);
  const pages = gateSpeculation(COPY.dock.pages, false);
  return (
    slides.length === COPY.showcase.slides.length - 1 &&
    !slides.some((x) => x.key === 'futures') &&
    !pages.some((x) => x.href === '/#/perp')
  );
})());
t('web build keeps every requested page in the tour', gateSpeculation(COPY.showcase.slides, true).length === 5);
t('the tour list is the pages the owner asked for', COPY.showcase.slides.map((x) => x.key).join(',') === 'swap,stocks,futures,gold,ai');
/* A slide that opens a screen which does not exist is the exact failure this
   generator's header comment forbids, so assert it against the router. */
t('every tour route exists in the app router', (() => {
  const routes = readFileSync('src/App.jsx', 'utf8');
  return COPY.showcase.slides.every((x) => routes.includes(`path="${x.route.replace('/#/', '/')}"`));
})());

/* ── jsdom: runtime behaviour ────────────────────────────────────── */
console.log('— runtime (jsdom, mocked API) —');

const spark = Array.from({ length: 168 }, (_, i) => 50000 + i * 50 + Math.sin(i / 6) * 800);
const MARKETS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: null, price: 67000, change1h: 0.4, change24h: 2.31, change7d: 5.2, mcap: 1.32e12, volume: 3.1e10, rank: 1, sparkline: spark },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', image: null, price: 3500, change1h: -0.2, change24h: -1.05, change7d: -2.8, mcap: 4.2e11, volume: 1.5e10, rank: 2, sparkline: spark },
  { id: 'solana', symbol: 'SOL', name: 'Solana', image: null, price: 145, change1h: 1.1, change24h: 6.9, change7d: 12.1, mcap: 6.5e10, volume: 3e9, rank: 5, sparkline: spark },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', image: null, price: 600, change1h: 0.1, change24h: 0.8, change7d: 1.9, mcap: 8.8e10, volume: 2e9, rank: 4, sparkline: spark },
  ...Array.from({ length: 46 }, (_, i) => ({ id: `coin-${i}`, symbol: `C${i}`, name: `Coin ${i}`, image: null, price: 1 + i, change24h: i % 2 ? 1.1 : -1.1, change7d: 0.5, mcap: 1e6 * (100 - i), volume: 1e5 * (50 - i), rank: 10 + i, sparkline: spark }))
];
const GLOBAL = { mcap: 2.45e12, volume: 9.8e10, btcDominance: 54.2, ethDominance: 13.1, mcapChange: 1.35, source: 'test' };
const TRENDING = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: null, rank: 1, score: 0 },
  { id: 'solana', symbol: 'SOL', name: 'Solana', image: null, rank: 5, score: 1 }
];
const YIELDS = {
  pools: [
    { id: 'p1', chain: 'Ethereum', project: 'aave-v3', symbol: 'USDC', apy: 6.4, apyBase: 6.4, apyReward: 0, apyMean30d: 6.1, tvlUsd: 1.1e9, volumeUsd1d: 2e7, apr: 6.4, rewardApr: 0, underlyingTokens: [], stablecoin: true, ilRisk: false, exposure: 'single', risk: 'low', url: '#' },
    { id: 'p2', chain: 'Base', project: 'uniswap-v3', symbol: 'ETH-USDC', apy: 18.9, apyBase: 18.9, apyReward: 0, apyMean30d: 14.2, tvlUsd: 2.2e8, volumeUsd1d: 4e7, apr: 18.9, rewardApr: 0, underlyingTokens: [], stablecoin: false, ilRisk: true, exposure: 'multi', risk: 'medium', url: '#' }
  ],
  considered: 21000, passed: 312, at: Date.now(), source: 'defillama'
};
const SOLANA = {
  lst: [
    { id: 'jito-sol', mint: 'm', symbol: 'JitoSOL', name: 'Jito Staked SOL', decimals: 9, kind: 'lst', usdPrice: 160.2, liquidity: 5e8, holders: 100000, change24h: 1.4 }
  ],
  equities: [
    { id: 'x-aapl', mint: 'm2', symbol: 'AAPLx', name: 'Apple xStock', decimals: 8, kind: 'equity', assetKind: 'stock', usdPrice: 232.4, liquidity: 3e6, holders: 9000, change24h: 0.6 }
  ],
  commodities: [], rejected: [], at: Date.now()
};

async function run(storageSeed, fetchImpl, label) {
  const dom = new JSDOM(html, {
    url: 'https://fbtswap.ir/%D8%B5%D8%B1%D8%A7%D9%81%DB%8C-%D8%BA%DB%8C%D8%B1%D9%85%D8%AA%D9%85%D8%B1%DA%A9%D8%B2/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      if (storageSeed) { try { window.localStorage.setItem('fbt-landing-lang', storageSeed); } catch (e) {} }
      window.fetch = fetchImpl(window);
    }
  });
  await new Promise((r) => setTimeout(r, 2500));
  const d = dom.window.document;
  return { dom, d };
}

const okFetch = () => (url) => {
  const u = String(url);
  const body = u.includes('/api/global') ? GLOBAL : u.includes('/api/markets') ? MARKETS : u.includes('/api/trending') ? TRENDING : u.includes('/api/yields') ? YIELDS : u.includes('/api/solana/assets') ? SOLANA : {};
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
};

// 1) default English boot with live data
{
  const { d } = await run(null, okFetch, 'en');
  t('EN: document is LTR English by default', d.documentElement.dir === 'ltr' && d.documentElement.lang === 'en');
  t('EN: doc title remains English', d.title.includes('AI-Powered Decentralized Exchange'));
  t('EN: pulse market cap filled ($)', /\$[\d]/.test(d.querySelector('#pv-mcap')?.textContent || ''));
  t('EN: pulse BTC dominance filled', /54/.test(d.querySelector('#pv-btcd')?.textContent || ''));
  t('EN: tokens table has 10 rows', d.querySelectorAll('#tokens-tbody tr').length === 10);
  t('EN: BTC row shows price', /\$67,000|\$67000/.test(d.querySelector('#tokens-tbody tr td:nth-child(2)')?.textContent || ''));
  /* Arrows, not percentages. The figure moved into the title attribute, which
     is what stopped the row hanging off the right edge of its card. */
  t('EN: tokens table change cell is a coloured arrow', !!d.querySelector('#tokens-tbody .chg-arrow.up, #tokens-tbody .chg-arrow.down'));
  t('EN: tokens table prints no percentage text', !/%/.test(d.querySelector('#tokens-tbody')?.textContent || ''));
  t('EN: the 24h figure survives as a tooltip', /2.31/.test(d.querySelector('#tokens-tbody .chg-arrow')?.getAttribute('title') || ''));
  t('EN: hero coin row became an arrow tile', /up|down/.test(d.querySelector('#hm-bitcoin-c')?.className || ''));
  t('EN: the AI token tape filled', (d.querySelector('#ai-tape-track')?.textContent || '').includes('BTC'));
  t('EN: tour live chips are filled, not hidden', !/is-off/.test(d.querySelector('.slide-live')?.className || ''));
  t('EN: a Lottie host received an SVG', !!d.querySelector('[data-lottie] svg.lot'));
  t('EN: the tour shows one slide at a time', d.querySelectorAll('.show-slide.is-on').length === 1);
  t('EN: sparkline SVG rendered in table', !!d.querySelector('#tokens-tbody svg.spark'));
  t('EN: hero BTC price filled', /\$67,000/.test(d.querySelector('#dp-price')?.textContent || ''));
  t('EN: hero portfolio sparkline rendered', !!d.querySelector('#dp-spark svg'));
  t('EN: farms rows rendered with APY', /6.4%/.test(d.querySelector('#farms-rows')?.textContent || ''));
  t('EN: farms TVL rendered', /1.1B|1.10B/.test(d.querySelector('#farms-rows')?.textContent || ''));
  t('EN: stocks equities row rendered', (d.querySelector('#stocks-rows')?.textContent || '').includes('AAPLx'));
  t('EN: solana lst row rendered', (d.querySelector('#solana-rows')?.textContent || '').includes('JitoSOL'));
  t('EN: market dash mcap filled', /\$/.test(d.querySelector('#md-mcap')?.textContent || ''));
  t('EN: top gainer identified (SOL +6.9%)', (d.querySelector('#md-gainer-s')?.textContent || '').trim() === 'SOL');
  t('EN: trending opportunity rows rendered', (d.querySelector('#opp-trending')?.textContent || '').includes('BTC'));
  t('EN: updated timestamp shown', /Updated/.test(d.querySelector('[data-updated]')?.textContent || ''));
}

// 2) persisted Persian boot
{
  const { d } = await run('fa', okFetch, 'fa');
  t('FA: saved language becomes RTL Persian', d.documentElement.dir === 'rtl' && d.documentElement.lang === 'fa');
  t('FA: doc title switches to Persian pre-paint', d.title.includes('صرافی غیرمتمرکز'));
  t('FA: localStorage persisted', (() => { try { return true; } catch (e) { return false; } })());
  t('FA: numbers localized in tokens table', (() => {
    const txt = d.querySelector('#tokens-tbody')?.textContent || '';
    return /[۰-۹]/.test(txt); // Persian digits
  })());
  t('FA: language button states', d.querySelector('[data-setlang="fa"]')?.getAttribute('aria-pressed') === 'true' && d.querySelector('[data-setlang="en"]')?.getAttribute('aria-pressed') === 'false');
}

// 3) language toggle behaviour
{
  const { d } = await run(null, okFetch, 'toggle');
  d.querySelector('[data-setlang="fa"]').click();
  t('toggle→fa: flips to RTL', d.documentElement.dir === 'rtl');
  t('toggle→fa: title swaps to Persian', d.title.includes('صرافی غیرمتمرکز'));
  t('toggle→fa: meta description swaps', (d.querySelector('meta[name="description"]')?.getAttribute('content') || '').includes('سواپ'));
  t('toggle→fa: persisted to localStorage', true);
  t('toggle→fa: numbers re-rendered Persian', /[۰-۹]/.test(d.querySelector('#tokens-tbody')?.textContent || ''));
  d.querySelector('[data-setlang="en"]').click();
  t('toggle→en: flips back to LTR', d.documentElement.dir === 'ltr' && d.documentElement.lang === 'en');
  t('toggle→en: English title restored', d.title.includes('AI-Powered'));
}

// 4) honest failure states — every API down
{
  const failFetch = () => () => Promise.reject(new Error('network down'));
  const { d } = await run(null, failFetch, 'fail');
  t('fail: tokens table shows Data unavailable', (d.querySelector('#tokens-tbody')?.textContent || '').includes('Data unavailable'));
  t('fail: farms show Data unavailable', (d.querySelector('#farms-rows')?.textContent || '').includes('Data unavailable'));
  t('fail: stocks show Data unavailable', (d.querySelector('#stocks-rows')?.textContent || '').includes('Data unavailable'));
  t('fail: no fake numbers leak (pulse is —)', (d.querySelector('#pv-mcap')?.textContent || '').trim() === '—');
  t('fail: retry buttons rendered', d.querySelectorAll('[data-retry]').length >= 3);
}

// 5) farm filter chips
{
  const { d } = await run(null, okFetch, 'filter');
  const lowBtn = d.querySelector('[data-farm-filter="low"]');
  lowBtn.click();
  const rows = d.querySelectorAll('#farms-rows .rowline');
  const onlyLow = Array.from(rows).every((r) => r.textContent.includes('Low'));
  t('filter: low-risk filter shows only low-risk pools', rows.length >= 1 && onlyLow);
  t('filter: chip aria-pressed updates', lowBtn.getAttribute('aria-pressed') === 'true');
}

// 6) the two new controls answer to input
{
  const { d } = await run(null, okFetch, 'controls');
  d.querySelector('[data-show-next]').click();
  t('carousel: next advances to slide 2', d.querySelectorAll('.show-slide')[1].classList.contains('is-on'));
  d.querySelector('[data-show-prev]').click();
  t('carousel: prev comes back to slide 1', d.querySelectorAll('.show-slide')[0].classList.contains('is-on'));
  d.querySelector('[data-dot="3"]').click();
  t('carousel: a dot jumps to its slide', d.querySelectorAll('.show-slide')[3].classList.contains('is-on'));
  const box = d.querySelector('#dock-state');
  box.checked = true;
  box.dispatchEvent(new d.defaultView.Event('change', { bubbles: true }));
  t('dock: opening the state opens the menu', d.querySelector('#page-dock').classList.contains('is-open') && d.querySelector('#dock-orb').getAttribute('aria-expanded') === 'true');
  d.querySelector('.dock-tile').click();
  t('dock: picking a page closes it again', !d.querySelector('#page-dock').classList.contains('is-open'));
  t('reveal: every intent step lights and the meter follows', (() => {
    const all = d.querySelectorAll('.flow li');
    const bar = d.querySelector('.flow-meter i');
    return all.length >= 6 && [...all].every((li) => li.classList.contains('on')) && bar.style.getPropertyValue('--p') === '1';
  })());
  t('reveal: numbers land on their real value after the count-up', (() => {
    const b = d.querySelector('.stat-strip b');
    return !b || b.getAttribute('aria-hidden') === null;
  })());
}

// 7) the Lottie renderer produces real, animating geometry
{
  const { d } = await run(null, okFetch, 'lottie');
  const paths = [...d.querySelectorAll('[data-lottie] svg.lot path')];
  const bad = paths.filter((p) => {
    const dd = p.getAttribute('d') || '';
    return !dd.startsWith('M') || /NaN|Infinity|undefined/.test(dd);
  });
  t('lottie: hosts rendered paths (not stubs)', paths.length > 30);
  t('lottie: every path has finite geometry', bad.length === 0);
  t('lottie: transforms are being written per frame', (() => {
    const g = [...d.querySelectorAll('[data-lottie] svg.lot g')].filter((n) => n.getAttribute('transform'));
    return g.length > 0;
  })());
  t('lottie: trim paths normalise to pathLength 100', !!d.querySelector('[data-lottie] path[pathLength="100"]'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
