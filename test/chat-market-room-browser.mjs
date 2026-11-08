import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base = process.env.UI_TEST_BASE_URL || 'http://localhost:5173';
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  for (const width of [320, 390, 720, 1280]) {
    for (const theme of ['light', 'dark']) {
      for (const lang of ['fa', 'en']) {
        await page.setViewport({ width, height: 1000 });
        await page.goto(`${base}/test/fixtures/chat-market-room.html?theme=${theme}&lang=${lang}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.aix-mover .coin-logo');
        for (const tab of ['overview', 'opportunities', 'screener', 'report']) {
          await page.click(`.aix-tab-${tab}`);
          const state = await page.evaluate(() => {
            const body = document.querySelector('.aix-embed');
            const tabs = document.querySelector('.aix-tabs-chat');
            return {
              overflow: document.documentElement.scrollWidth > innerWidth,
              innerOverflow: body.scrollWidth > body.clientWidth,
              layout: getComputedStyle(document.querySelector('.aix-tab-body')).display,
              tabs: tabs.scrollWidth <= tabs.clientWidth,
              color: getComputedStyle(body).color,
              controlHeight: document.querySelector('.aix-tab').getBoundingClientRect().height
            };
          });
          assert.equal(state.overflow, false, `${width}/${theme}/${lang}/${tab}: page`);
          assert.equal(state.innerOverflow, false, `${width}/${theme}/${lang}/${tab}: body`);
          assert.equal(state.layout, 'flex', 'standalone chat loads base layout');
          assert.equal(state.tabs, true);
          assert.ok(state.controlHeight >= 44);
        }
        console.log(`PASS ${width}/${theme}/${lang}`);
      }
    }
  }
} finally { await browser.close(); }
