/** Browser geometry regression: CHROME_PATH=/path/to/chromium node test/dydx-dock-browser.mjs */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chromium executable');
const sheets = await Promise.all(['src/index.css', 'src/styles/derivatives-glass.css', 'src/styles/dydx-token-desk.css'].map((p) => readFile(p, 'utf8')));
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  for (const width of [320, 375, 414, 600, 767]) {
    for (const direction of ['rtl', 'ltr']) {
      await page.setViewport({ width, height: 780, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html dir="${direction}"><head><style>${sheets.join('\n')}</style></head><body class="dydx-screen"><nav class="dydx-mobile-dock"><button class="dydx-dock-long" aria-pressed="true">↗ Long</button><button class="dydx-dock-desk"><span class="dydx-dock-orb">✦</span><span>Desk</span></button><button class="dydx-dock-short" aria-pressed="false">↘ Short</button></nav></body></html>`);
      const measure = () => page.evaluate(() => {
        const dock = document.querySelector('.dydx-mobile-dock').getBoundingClientRect();
        const desk = document.querySelector('.dydx-dock-desk').getBoundingClientRect();
        return { dockCenter: (dock.left + dock.right) / 2, deskCenter: (desk.left + desk.right) / 2, deskTop: desk.top, dockTop: dock.top, deskWidth: desk.width };
      });
      const a = await measure();
      assert.ok(Math.abs(a.deskCenter - a.dockCenter) < 0.6, `${direction} ${width}: ${JSON.stringify(a)}`);
      assert.ok(Math.abs((a.deskTop + 32) - a.dockTop) < 1.1, `${direction} ${width}: diamond is not half above bar ${JSON.stringify(a)}`);
      assert.equal(a.deskWidth, 64);
      await page.evaluate(() => { document.querySelector('.dydx-dock-long').setAttribute('aria-pressed', 'false'); document.querySelector('.dydx-dock-short').setAttribute('aria-pressed', 'true'); });
      const b = await measure();
      assert.equal(b.deskCenter, a.deskCenter, `desk moved on side selection: ${direction} ${width}`);
    }
  }
  console.log('dYdX dock: centered in RTL and LTR at 5 viewport widths; no shift on selection');
} finally { await browser.close(); }
