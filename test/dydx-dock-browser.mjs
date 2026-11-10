/** Browser geometry regression: CHROME_PATH=/path/to/chromium node test/dydx-dock-browser.mjs */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chromium executable');
const sheets = await Promise.all(['src/index.css', 'src/styles/derivatives-glass.css', 'src/styles/futures-hero-banner.css', 'src/styles/perp-modern.css', 'src/styles/dydx-token-desk.css'].map((p) => readFile(p, 'utf8')));
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
  for (const theme of ['dark', 'light']) {
    await page.setContent(`<!doctype html><html data-theme="${theme}"><head><style>${sheets.join('\n')}</style></head><body class="dydx-screen"><main class="page"><section class="fhb" data-mode="dydx"><span class="fhb-word-fa">Futures</span><span class="fhb-chip is-gold">Custody</span><svg class="fhb-curve"><defs><linearGradient id="fhbCurveLine"><stop/><stop/><stop/></linearGradient></defs></svg></section><div class="perp-rail"><button class="perp-rail-tab is-active"><span class="seg-indicator"></span><span class="perp-rail-ico">X</span><span class="perp-rail-label">dYdX</span></button></div><div class="dydx-app derivatives-hall" style="height:1400px"><div class="derivatives-aurora"></div><div class="notice">Info</div><div class="notice notice-danger">Danger</div></div></main><nav class="dydx-mobile-dock"><button class="dydx-dock-long">Long</button><button class="dydx-dock-desk"><span class="dydx-dock-orb">✦</span><span>Desk</span></button><button class="dydx-dock-short">Short</button></nav></body></html>`);
    const styles = await page.evaluate(() => {
      const css = (selector, pseudo) => getComputedStyle(document.querySelector(selector), pseudo);
      const aurora = document.querySelector('.derivatives-aurora').getBoundingClientRect();
      const hall = document.querySelector('.dydx-app').getBoundingClientRect();
      return { pageBg: css('.page').backgroundImage, auroraHeight: aurora.height, hallHeight: hall.height,
        rail: css('.perp-rail-label').color, notice: css('.notice').backgroundColor,
        risk: css('.notice-danger').backgroundColor, desk: css('.dydx-dock-desk', '::before').backgroundImage,
        banner: css('.fhb-word-fa').backgroundImage, curve: css('#fhbCurveLine stop').stopColor };
    });
    assert.ok(styles.pageBg.includes('gradient'), `${theme}: page background missing`);
    assert.ok(styles.auroraHeight >= styles.hallHeight, `${theme}: background stops before end of workspace`);
    assert.notEqual(styles.notice, styles.risk, `${theme}: risk warning lost its distinction`);
    assert.match(styles.desk, /238, 229, 255/);
    assert.doesNotMatch(styles.banner, /245, 158, 11/);
    assert.equal(styles.curve, 'rgb(188, 178, 245)');
    await page.evaluate(() => { document.body.classList.remove('dydx-screen'); document.querySelector('.fhb').dataset.mode = 'overview'; });
    const other = await page.evaluate(() => ({ page: getComputedStyle(document.querySelector('.page')).backgroundImage, rail: getComputedStyle(document.querySelector('.perp-rail-label')).color, curve: getComputedStyle(document.querySelector('#fhbCurveLine stop')).stopColor }));
    assert.equal(other.page, 'none', `${theme}: dYdX background leaked to other page`);
    assert.notEqual(other.rail, styles.rail, `${theme}: dYdX rail styling leaked`);
    assert.notEqual(other.curve, styles.curve, `${theme}: dYdX artwork styling leaked`);
  }
  console.log('dYdX dock, full-page background and scoped palette verified in RTL/LTR and both themes');
} finally { await browser.close(); }
