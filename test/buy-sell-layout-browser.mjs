/** Real Chromium regression for the Buy/Sell LANDING desk (2026-11-20).
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

/* Audit the new landing DOM: no horizontal overflow of the root, no card
   overflow, no text spilling outside a card, and the network/token chip rows
   keep a consistent gap between them (the owner's spacing requirement). */
async function audit(label) {
  const result = await page.evaluate(() => {
    const roots = ['.buy-sell-landing', '.bsland-amount', '.bsland-keypad', '.bsland-actions', '.bsland-chips'];
    const overflow = [];
    const outside = [];
    for (const sel of roots) {
      for (const root of document.querySelectorAll(sel)) {
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
    }
    /* Network chips and token chips: each row is its own flex container. The
       gap between the two rows (token top − network bottom) must be a sane
       positive spacer — i.e. the two chip groups do not collide or merge. */
    const net = document.querySelector('.bsland-networks');
    const tok = document.querySelector('.bsland-tokens');
    let chipGap = null;
    if (net && tok) {
      const nb = net.getBoundingClientRect();
      const tb = tok.getBoundingClientRect();
      chipGap = Math.round((tb.top - nb.bottom) * 100) / 100;
    }
    /* Chip spacing inside each row: neighbouring chips keep a real gap. */
    let chipInnerGap = null;
    const chips = [...document.querySelectorAll('.bsland-networks .bsland-chip')];
    if (chips.length >= 2) chipInnerGap = Math.round((chips[1].getBoundingClientRect().left - chips[0].getBoundingClientRect().right) * 100) / 100;
    const counter = document.querySelector('.bsland-counter');
    const counterText = counter ? counter.textContent.trim() : null;
    return {
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      overflow, outside, chipGap, chipInnerGap, counterText,
      hasIranIcon: Boolean(document.querySelector('.bsland-iran')),
      hasBack: Boolean(document.querySelector('.bsland-back'))
    };
  });
  assert.ok(result.documentWidth <= result.width + 1, `${label}: page overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.overflow, [], `${label}: card overflow`);
  assert.deepEqual(result.outside, [], `${label}: text outside card`);
  assert.ok(result.hasIranIcon, `${label}: missing Iran icon`);
  assert.ok(result.hasBack, `${label}: missing back button`);
  return result;
}

async function openSheet(testId) {
  await page.click(`[data-testid="${testId}"]`);
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 5000 });
  await settle();
}

try {
  for (const width of [320, 390, 768, 1280]) {
    for (const theme of ['dark', 'light']) {
      await page.setViewport({ width, height: 950, deviceScaleFactor: 1 });
      await page.goto(`${base}/test/fixtures/buy-sell.html?lang=fa&theme=${theme}&wallet=1`, { waitUntil: 'networkidle0', timeout: 90000 });
      await page.waitForSelector('.bsland-amount');
      await settle();
      const label = `${width}/${theme}`;

      /* Step 1: counter, amount field, keypad, two quick buttons. */
      const step1 = await audit(`${label} step1`);
      assert.equal(step1.counterText, '1 / 2', `${label}: counter should start at 1 / 2`);
      await shot(`${label}-step1`);

      /* Type an amount through the numeric keypad: 5 0 0 . 0 0 */
      const amountBefore = await page.$eval('.bsland-amount-value', (el) => el.textContent);
      await page.evaluate(() => {
        const keys = [...document.querySelectorAll('.bsland-key')];
        for (const k of ['5', '0', '0', '.', '0', '0']) { const b = keys.find((x) => x.textContent.trim() === k); if (b) b.click(); }
      });
      await settle();
      const amountAfter = await page.$eval('.bsland-amount-value', (el) => el.textContent);
      assert.notEqual(amountAfter, amountBefore, `${label}: keypad did not change amount`);

      /* The two small buttons above the keyboard open their popups. */
      await openSheet('bsland-payment-methods');
      assert.ok(await page.$('[data-testid="bsland-payment-sheet"]'), `${label}: payment popup did not open`);
      await page.click('[data-testid="bsland-payment-sheet-close"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="bsland-payment-sheet"]'), { timeout: 5000 });

      await openSheet('bsland-side');
      assert.ok(await page.$('[data-testid="bsland-side-sheet"]'), `${label}: side popup did not open`);
      /* Choose SELL from the popup → landing becomes sell-mode. */
      const sellBtn = await page.$$('.bsland-side-option');
      assert.equal(sellBtn.length, 2, `${label}: side popup must offer buy + sell`);
      await sellBtn[1].click();
      await settle();
      assert.equal(await page.$eval('.buy-sell-landing', (el) => el.classList.contains('is-sell')), true, `${label}: landing not in sell mode`);
      await shot(`${label}-side-sell`);

      /* Switch back to buy via the bottom swap button, then go to step 2. */
      await page.click('[data-testid="bsland-swap"]');
      await settle();
      assert.equal(await page.$eval('.buy-sell-landing', (el) => el.classList.contains('is-sell')), false, `${label}: swap did not return to buy`);

      /* Next step: step 2 shows network + token chip rows at the top. */
      await page.click('.bsland-next');
      await page.waitForSelector('.bsland-networks', { timeout: 5000 });
      await settle();
      const step2 = await audit(`${label} step2`);
      assert.ok(step2.chipGap > 0, `${label}: network/token chip rows collide (gap ${step2.chipGap})`);
      assert.ok(step2.chipInnerGap > 0, `${label}: chips inside a row have no gap`);
      await shot(`${label}-step2`);

      /* Iran icon opens a popup ONLY in Persian — this matrix is fa. */
      await page.click('[data-testid="bsland-iran"]');
      await page.waitForSelector('[data-testid="bsland-iran-sheet"]', { timeout: 5000 });
      const iranDir = await page.$eval('[data-testid="bsland-iran-sheet"]', (el) => {
        const fd = el.querySelector('div[dir]');
        return fd ? fd.getAttribute('dir') : null;
      });
      assert.equal(iranDir, 'rtl', `${label}: Iran popup must be Persian RTL`);
      await page.click('[data-testid="bsland-iran-sheet-close"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="bsland-iran-sheet"]'), { timeout: 5000 });

      console.log(`✓ ${label}: step1/step2, keypad, both quick popups, swap mode, network/token chip spacing, Iran RTL popup; no overflow`);
    }
  }

  /* English matrix: the Iran popup stays shut (Persian-only, Iranians-only). */
  for (const theme of ['dark', 'light']) {
    await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${base}/test/fixtures/buy-sell.html?lang=en&theme=${theme}`, { waitUntil: 'networkidle0', timeout: 90000 });
    await page.waitForSelector('.bsland-amount');
    await settle();
    await audit(`390/${theme}/en step1`);
    await page.click('[data-testid="bsland-iran"]');
    await new Promise((done) => setTimeout(done, 400));
    assert.equal(await page.$('[data-testid="bsland-iran-sheet"]'), null, `390/${theme}/en: Iran popup must NOT open outside Persian`);
    await page.click('.bsland-next');
    await page.waitForSelector('.bsland-networks', { timeout: 5000 });
    await settle();
    await audit(`390/${theme}/en step2`);
    console.log(`✓ 390/${theme}/en: landing renders; Iran popup correctly stays closed`);
  }

  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('PASS: 8 responsive/theme matrices + 2 English layouts; keypad, popups, swap, chip spacing, Iran RTL gating; zero runtime errors.');
} finally {
  await browser.close();
}
