/** Real hit-testing of the market sort popover. Start the Vite dev server first. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { marketGlassCoins as coins, marketGlassGlobal as global } from './fixtures/market-glass-data.mjs';

const base = process.env.UI_TEST_BASE_URL || 'http://localhost:5173';
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process']
});
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/')) {
    let data = {};
    if (url.pathname === '/api/markets') data = coins;
    else if (url.pathname === '/api/global') data = global;
    else if (url.pathname === '/api/trending') data = coins.slice(0, 8);
    else if (url.pathname === '/api/coin-venues') data = { venues: {} };
    return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  }
  if (!request.url().startsWith(base) && !/^(data|blob):/.test(request.url())) return request.abort();
  return request.continue();
});
try {
  for (const [width, lang] of [[320, 'fa'], [390, 'fa'], [1280, 'en']]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${base}/test/fixtures/market-glass.html?theme=dark&lang=${lang}&tab=tokens`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#market-list-rows .coin-row');
    await page.$eval('[data-testid="market-sort"]', (el) => el.scrollIntoView({ block: 'center' }));
    await page.click('[data-testid="market-sort"]');
    const hits = await page.$$eval('.market-sort-option', (options) => options.map((option) => {
      const r = option.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return option === hit || option.contains(hit);
    }));
    assert.equal(hits.length, 5);
    assert(hits.every(Boolean), `sort menu clipped or obscured: ${width} ${lang}: ${hits}`);
    await page.click('.market-sort-option:last-child');
    assert.equal(await page.$eval('[data-testid="market-sort"]', (el) => el.getAttribute('aria-expanded')), 'false');
    console.log('Sort popover hit-test PASS', width, lang);
  }
} finally {
  await browser.close();
}
