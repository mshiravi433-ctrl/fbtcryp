/**
 * Real Chromium regression for the compact Overview intelligence boxes.
 * Start `npm run dev:web` first. PUPPETEER_EXECUTABLE_PATH may point at an
 * installed browser. All external artwork/feed requests are blocked; the
 * fixture is deterministic and the shared offline vector marks must carry it.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const base = process.env.UI_TEST_BASE_URL || 'http://localhost:5173';
const shots = process.env.MARKET_OVERVIEW_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process']
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* initial about:blank has no origin */ } });
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.origin !== new URL(base).origin && !/^(data|blob):/.test(request.url())) return request.abort();
  return request.continue();
});

async function open(width, theme, lang, mobile = false) {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await page.goto(`${base}/test/fixtures/market-overview-compact.html?theme=${theme}&lang=${lang}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.mx-net-item');
  await page.evaluate(() => document.fonts.ready);
}

try {
  for (const [width, theme, lang] of [
    [320, 'dark', 'fa'], [390, 'light', 'fa'], [430, 'dark', 'en'],
    [768, 'light', 'en'], [1280, 'dark', 'fa'], [1280, 'light', 'en']
  ]) {
    await open(width, theme, lang, width < 620);
    const reading = await page.evaluate(() => {
      const card = (id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().height;
      const title = getComputedStyle(document.querySelector('.mx-p2-title')).color;
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        cards: [...document.querySelectorAll('.mx-p2-card')].length,
        heatmap: card('market-heatmap'), pulse: card('market-capital-pulse'),
        defi: card('market-defi-intel'), networks: card('market-fbt-networks'),
        heatLogos: document.querySelectorAll('.mx-hm-tile .mx-hm-coin-logo').length,
        pulseRows: document.querySelectorAll('.mx-pulse-row').length,
        pulseLogos: document.querySelectorAll('.mx-pulse-row .coin-logo').length,
        chainLogos: document.querySelectorAll('.mx-defi-logo svg').length,
        netLogos: document.querySelectorAll('.mx-net-orb-core svg').length,
        netRows: document.querySelectorAll('.mx-net-item').length,
        oldHeaderBars: document.querySelectorAll('.mx-p2-head > .mx-p2-seg').length,
        title
      };
    });
    assert.equal(reading.overflow, false, `page overflow ${width}/${theme}/${lang}`);
    assert.equal(reading.cards, 4);
    assert.equal(reading.oldHeaderBars, 0, 'wrapping segmented bars must stay out of the headers');
    assert.ok(reading.heatLogos >= 20, 'heatmap tiles carry logos');
    assert.equal(reading.pulseRows, 3);
    assert.equal(reading.pulseLogos, 3);
    assert.equal(reading.chainLogos, 4);
    assert.equal(reading.netLogos, 4);
    assert.equal(reading.netRows, 4);
    assert.ok(reading.pulse < (width < 620 ? 540 : 400), `pulse too tall: ${reading.pulse}`);
    assert.ok(reading.networks < (width < 980 ? 1200 : 560), `networks too tall: ${reading.networks}`);
    if (theme === 'light') assert.equal(reading.title, 'rgb(15, 23, 42)', 'light-theme title contrast');
    if (shots) await page.screenshot({ path: `${shots}/${width}-${theme}-${lang}.png`, fullPage: true });
    console.log('Compact layout PASS', width, theme, lang);
  }

  await open(390, 'dark', 'fa', true);
  await page.click('[data-testid="market-heatmap-filters"]');
  await page.waitForSelector('.mx-control-panel');
  const popup = await page.evaluate(() => {
    const rect = document.querySelector('.mx-control-panel').getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, focus: document.activeElement.tagName, dir: document.querySelector('.mx-control-panel').dir };
  });
  assert.ok(popup.left >= 0 && popup.right <= 390 && popup.top >= 0 && popup.bottom <= 900, 'popover stays inside viewport');
  assert.equal(popup.dir, 'rtl');
  assert.notEqual(popup.focus, 'INPUT', 'opening filters must not raise the keyboard');
  await page.click('.mx-control-switch');
  assert.equal(await page.$eval('.mx-control-switch', (el) => el.getAttribute('aria-checked')), 'false');
  await page.keyboard.press('Escape');
  assert.equal(await page.$('.mx-control-panel'), null);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'market-heatmap-filters');
  assert.equal(await page.$$eval('.mx-hm-tile', (els) => els.length), 24);

  await page.focus('[data-testid="market-heatmap-window"]');
  await page.keyboard.press('ArrowDown');
  await page.waitForSelector('[role="menuitemradio"][aria-checked="true"]');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.match(await page.$eval('[data-testid="market-heatmap-window"]', (el) => el.textContent), /۷ر|7d/);
  assert.deepEqual(errors, []);
  console.log('Popover keyboard / RTL / focus PASS');
} finally {
  await browser.close();
}
