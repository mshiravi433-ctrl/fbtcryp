/** CHROME_PATH=/path/to/chromium node test/onchain-dock-browser.mjs */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH');
const sheets = await Promise.all(['src/index.css', 'src/styles/derivatives-glass.css', 'src/styles/futures-hero-banner.css', 'src/styles/perp-modern.css', 'src/styles/onchain-desk.css'].map((p) => readFile(p, 'utf8')));
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  for (const theme of ['light', 'dark']) for (const width of [320,375,414,600,767]) for (const dir of ['rtl','ltr']) {
    await page.setViewport({ width, height: 780 });
    await page.setContent(`<!doctype html><html dir="${dir}" data-theme="${theme}"><head><style>${sheets.join('\n')}</style></head><body class="onchain-screen"><main class="page"><div class="derivatives-hall onchain-app" style="height:1400px"><div class="derivatives-aurora"></div><section class="derivatives-hero"><div class="onchain-hero-copy"><span class="derivatives-title-glow">On-chain futures</span><p class="derivatives-subtitle">Solana USDT</p></div></section></div></main><div class="bottom-nav">Nav</div><div class="nav-centre">Centre</div><nav class="onchain-mobile-dock"><button class="oc-long" aria-pressed="true">↗ Long</button><button class="oc-desk"><span class="oc-diamond"></span>✦<span>Desk</span></button><button class="oc-short" aria-pressed="false">↘ Short</button></nav></body></html>`);
    const measure = () => page.evaluate(() => {
      const rect = (s) => document.querySelector(s).getBoundingClientRect();
      const dock = rect('.onchain-mobile-dock'), desk = rect('.oc-desk'), hall = rect('.onchain-app'), aurora = rect('.derivatives-aurora');
      return { dockCenter: (dock.left+dock.right)/2, deskCenter: (desk.left+desk.right)/2, dockTop: dock.top, deskTop: desk.top, deskWidth: desk.width, deskHeight: desk.height, bg: getComputedStyle(document.querySelector('.page')).backgroundImage, diamond: getComputedStyle(document.querySelector('.oc-diamond')).backgroundImage, nav: getComputedStyle(document.querySelector('.bottom-nav')).display, auroraHeight: aurora.height, hallHeight: hall.height };
    });
    const a = await measure();
    assert.ok(Math.abs(a.dockCenter-a.deskCenter)<0.6, `${theme} ${dir} ${width}: centre`);
    assert.ok(Math.abs(a.deskTop+32-a.dockTop)<1.1, `${theme} ${dir} ${width}: vertical position ${JSON.stringify(a)}`);
    assert.equal(a.deskWidth, 64); assert.equal(a.deskHeight, 64);
    assert.equal(a.nav, 'none'); assert.match(a.bg,/gradient/); assert.match(a.diamond,/73, 211, 181/);
    assert.ok(a.auroraHeight >= a.hallHeight);
    await page.evaluate(() => { document.querySelector('.oc-long').setAttribute('aria-pressed','false'); document.querySelector('.oc-short').setAttribute('aria-pressed','true'); });
    assert.equal((await measure()).deskCenter,a.deskCenter);
    await page.evaluate(() => document.body.classList.remove('onchain-screen'));
    assert.equal(await page.$eval('.page', e=>getComputedStyle(e).backgroundImage),'none');
  }
  await page.setViewport({ width: 1024, height: 780 });
  assert.equal(await page.$eval('.onchain-mobile-dock', e=>getComputedStyle(e).display),'none');
  console.log('On-chain dock geometry, theme, background and scoping passed at 320–767px in RTL/LTR; desktop dock hidden.');
} finally { await browser.close(); }
