/** Real Chromium regression for the Buy/Sell Prism desk.
 * Start `npm run dev:web`, then `node test/buy-sell-layout-browser.mjs`.
 * Optional: PUPPETEER_EXECUTABLE_PATH, UI_TEST_BASE_URL, BUY_SELL_SHOTS_DIR.
 * The fixture stubs API responses and the injected wallet. No payment,
 * signature, transaction or external provider navigation is performed.
 */
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.UI_TEST_BASE_URL || 'http://localhost:5173';
const shots = process.env.BUY_SELL_SHOTS_DIR;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  headless: true
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const settle = () => page.evaluate(() => document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))));
const shot = (name) => shots ? page.screenshot({ path: resolve(shots, `${name.replaceAll('/', '-')}.png`), fullPage: true }) : Promise.resolve();

async function audit(label) {
  const result = await page.evaluate(() => {
    const overflow = [];
    const outside = [];
    for (const root of document.querySelectorAll('.buy-sell-hero, .buy-sell-ticket, .iran-buy-ticket')) {
      if (root.scrollWidth > root.clientWidth + 2) overflow.push({ class: root.className, client: root.clientWidth, scroll: root.scrollWidth });
      const box = root.getBoundingClientRect();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || node.parentElement.closest('[aria-hidden="true"]')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width && (rect.left < box.left - 2 || rect.right > box.right + 2)) {
            outside.push({ class: root.className, text: node.textContent.trim().slice(0, 70), left: rect.left, right: rect.right, box: { left: box.left, right: box.right } });
          }
        }
      }
    }
    const tabs = [...document.querySelectorAll('.buy-sell-page .segmented button.active')].map((button) => {
      const style = getComputedStyle(button);
      const indicator = button.querySelector('.seg-indicator');
      return { text: button.textContent.trim(), background: style.backgroundColor, image: style.backgroundImage, indicator: indicator ? getComputedStyle(indicator).backgroundImage : null };
    });
    const intro = document.querySelector('.buy-sell-page-intro').getBoundingClientRect();
    const art = document.querySelector('.buy-sell-constellation').getBoundingClientRect();
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow, outside, tabs, artOverlapsIntro: art.bottom > intro.top + 1 && art.top < intro.bottom - 1 && art.right > intro.left && art.left < intro.right };
  });
  assert.ok(result.documentWidth <= result.width + 1, `${label}: page overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.overflow, [], `${label}: card overflow`);
  assert.deepEqual(result.outside, [], `${label}: text outside card`);
  assert.equal(result.artOverlapsIntro, false, `${label}: hero artwork covers introduction`);
  for (const tab of result.tabs) {
    assert.equal(tab.background, 'rgba(0, 0, 0, 0)', `${label}: gray active plate ${tab.text}`);
    assert.equal(tab.image, 'none', `${label}: active plate image ${tab.text}`);
    assert.match(tab.indicator || '', /gradient/, `${label}: missing colored indicator ${tab.text}`);
  }
  return result;
}

try {
  for (const width of [320, 390, 768, 1280]) {
    for (const theme of ['dark', 'light']) {
      await page.setViewport({ width, height: 950, deviceScaleFactor: 1 });
      await page.goto(`${base}/test/fixtures/buy-sell.html?lang=fa&theme=${theme}&wallet=1`, { waitUntil: 'networkidle0', timeout: 90000 });
      await page.waitForSelector('.buy-sell-surface-switch');
      await settle();
      const label = `${width}/${theme}`;
      await audit(`${label} buy`);
      await shot(`${label}-buy`);

      // RTL: left arrow advances from the first (rightmost) tab to the next.
      await page.focus('.buy-sell-surface-switch [aria-selected="true"]');
      await page.keyboard.press('ArrowLeft');
      await page.waitForSelector('.iran-buy-ticket');
      await settle();
      assert.equal(await page.$eval('[data-testid="iran-buy-top-tab"]', (el) => el.getAttribute('aria-selected')), 'true');
      await audit(`${label} Iran`);
      await page.click('.iran-buy-referral-guide summary');
      await settle();
      await audit(`${label} Iran guide`);

      // A full receiving address and all seven network choices must fit. The
      // injected lease survives a reload, so a later pass may already be live.
      if (await page.$('[data-testid="iran-buy-address-connect"]')) {
        await page.click('[data-testid="iran-buy-address-connect"]');
        await page.waitForSelector('.wc-card');
        const cards = await page.$$('.wc-card');
        let connected = false;
        for (const card of cards) {
          const text = await card.evaluate((el) => el.textContent);
          if (text.includes('MetaMask')) { await card.click(); connected = true; break; }
        }
        assert.equal(connected, true, `${label}: injected fixture available`);
        /* The sheet animates shut over the card; wait it out so the network
           click cannot land on a dismiss overlay still on top. */
        await page.waitForFunction(() => !document.querySelector('.wc-card'), { timeout: 15000 });
        await settle();
      }
      await page.waitForSelector('[data-testid="iran-buy-address-value"]');
      assert.equal(await page.$eval('[data-testid="iran-buy-address-value"]', (el) => el.textContent), '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B');
      await page.click('[data-testid="iran-buy-network-TRC20"]');
      await page.waitForSelector('[data-testid="iran-buy-address-tron-note"]');
      await settle();
      await audit(`${label} TRC20 address`);
      await shot(`${label}-iran-guide`);

      // Blocked partner popup: the long URL must wrap rather than widen the card.
      await page.evaluate(() => { window.open = () => null; });
      await page.click('[data-testid="iran-buy-referral-cta"]');
      await page.waitForSelector('[data-testid="iran-buy-referral-manual"]');
      await audit(`${label} manual link`);

      await page.click('.buy-sell-surface-switch > button:first-child');
      await page.waitForSelector('.buy-sell-switch');
      await page.click('.buy-sell-switch > button:nth-child(2)');
      await settle();
      assert.equal(await page.$eval('.buy-sell-panel', (el) => el.classList.contains('is-sell')), true);
      await audit(`${label} sell`);
      await shot(`${label}-sell`);
      console.log(`✓ ${label}: buy, sell, Iran, guide, full TRC20 address, manual link; no gray active plate or overflow`);
    }
  }
  for (const theme of ['dark', 'light']) {
    await page.setViewport({ width: 320, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${base}/test/fixtures/buy-sell.html?lang=en&theme=${theme}`, { waitUntil: 'networkidle0', timeout: 90000 });
    await page.waitForSelector('.buy-sell-switch');
    await settle();
    assert.equal(await page.$('[data-testid="iran-buy-top-tab"]'), null);
    await audit(`320/${theme}/en`);
    await page.focus('.buy-sell-switch [aria-selected="true"]');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('.buy-sell-switch > button:nth-child(2)', (el) => el.getAttribute('aria-selected')), 'true');
    await audit(`320/${theme}/en sell`);
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('PASS: 8 responsive/theme matrices + 2 English layouts; keyboard RTL/LTR; reduced motion; zero runtime errors.');
} finally {
  await browser.close();
}
