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

/* Audit the landing DOM: no horizontal OR vertical overflow (the desk must
   fit the viewport and never scroll), no card overflow, no text spilling
   outside a card, and selection screens are tested separately. */
async function audit(label) {
  const result = await page.evaluate(() => {
    const roots = ['.buy-sell-landing', '.bsland-amount', '.bsland-keypad', '.bsland-actions', '.bsland-picker'];
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
    return {
      width: innerWidth,
      height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      overflow, outside,
      hasIranIcon: Boolean(document.querySelector('.bsland-iran')),
      hasReportIcon: Boolean(document.querySelector('.bsland-report')),
      hasBack: Boolean(document.querySelector('.bsland-back'))
    };
  });
  assert.ok(result.documentWidth <= result.width + 1, `${label}: horizontal page overflow ${JSON.stringify(result)}`);
  assert.ok(result.documentHeight <= result.height + 1, `${label}: vertical page overflow (page must not scroll) ${JSON.stringify(result)}`);
  assert.deepEqual(result.overflow, [], `${label}: card overflow`);
  assert.deepEqual(result.outside, [], `${label}: text outside card`);
  assert.equal(result.hasIranIcon, !label.endsWith('en step1') && !label.endsWith('en step2'));
  assert.ok(result.hasReportIcon, `${label}: missing on-chain report icon`);
  assert.ok(result.hasBack, `${label}: missing back button`);
  return result;
}

async function openSheet(testId) {
  await page.click(`[data-testid="${testId}"]`);
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 5000 });
  await settle();
  const screen = await page.$eval('dialog[open]', (el) => ({
    modal: el.matches(':modal'), width: el.offsetWidth, height: el.offsetHeight,
    viewportWidth: innerWidth, viewportHeight: innerHeight
  }));
  assert.ok(screen.modal);
  assert.equal(screen.width, screen.viewportWidth);
  assert.equal(screen.height, screen.viewportHeight);
}

try {
  for (const width of [320, 390, 768, 1280]) {
    for (const theme of ['dark', 'light']) {
      await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
      await page.goto(`${base}/test/fixtures/buy-sell.html?lang=fa&theme=${theme}&wallet=1`, { waitUntil: 'networkidle0', timeout: 90000 });
      await page.waitForSelector('.bsland-amount');
      await settle();
      const label = `${width}/${theme}`;

      /* Step 1: amount field, glassy keypad + payment key, report/Iran icons. */
      const step1 = await audit(`${label} step1`);
      await shot(`${label}-step1`);

      /* Type an amount through the numeric keypad: 5 0 0 . 0 0 */
      const amountBefore = await page.$eval('.bsland-amount-value', (el) => el.textContent);
      await page.evaluate(() => {
        const keys = [...document.querySelectorAll('.bsland-key')];
        for (const k of ['5', '0', '0', '.', '0', '0']) { const b = keys.find((x) => x.textContent.trim() === k); if (b) b.click(); }
      });
      await settle();
      const amountAfter = await page.$eval('.bsland-amount-value', (el) => el.textContent);
      assert.notEqual(amountAfter, amountBefore);
      assert.equal(amountAfter, '500.00', `${label}: decimal keypad must preserve the decimal`);

      /* The payment-methods button is a KEY of the keyboard. */
      assert.ok(await page.$('[data-testid="bsland-payment-methods"]'), `${label}: payment key missing from keyboard`);
      await openSheet('bsland-payment-methods');
      assert.ok(await page.$('[data-testid="bsland-payment-sheet"]'), `${label}: payment popup did not open`);
      await page.click('[data-testid="bsland-payment-sheet-close"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="bsland-payment-sheet"]'), { timeout: 5000 });

      /* The buy/sell toggle lives on STEP ONE. */
      const segs = await page.$$('.bsland-side-seg');
      assert.equal(segs.length, 2, `${label}: buy/sell toggle must offer buy + sell on step 1`);
      await segs[1].click(); /* SELL */
      await settle();
      assert.equal(await page.$eval('.buy-sell-landing', (el) => el.classList.contains('is-sell')), true, `${label}: landing not in sell mode`);
      await segs[0].click(); /* back to BUY */
      await settle();
      assert.equal(await page.$eval('.buy-sell-landing', (el) => el.classList.contains('is-sell')), false, `${label}: toggle did not return to buy`);
      await shot(`${label}-side-toggle`);

      /* The on-chain report icon (next to Iran) opens the report card. */
      await openSheet('bsland-report');
      assert.ok(await page.$('[data-testid="bsland-report-sheet"] .bsland-transfer-pulse'));
      assert.equal(await page.$('[data-testid="bsland-report-sheet"] .lab-card'), null);
      assert.ok(await page.$eval('.buy-sell-watch--flat', (el) => {
        const body = el.parentElement;
        const css = getComputedStyle(body);
        return Math.abs(el.offsetWidth - (body.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight))) <= 1;
      }));
      await page.click('[data-testid="bsland-report-sheet-close"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="bsland-report-sheet"]'), { timeout: 5000 });

      /* Next step: step 2 shows openable network + token boxes. */
      await page.click('.bsland-next');
      await page.waitForSelector('.bsland-picker', { timeout: 5000 });
      await audit(`${label} step2`);
      await openSheet('bsland-tokens-picker');
      assert.ok(await page.$('.bsland-choice[aria-pressed="true"] .asset-icon'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'bsland-tokens-picker');
      await openSheet('bsland-networks-picker');
      await page.click('.bsland-choice[aria-pressed="false"]');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await shot(`${label}-step2`);

      /* Iran icon opens a FULL-SCREEN popup ONLY in Persian. */
      await page.click('[data-testid="bsland-iran"]');
      await page.waitForSelector('[data-testid="bsland-iran-sheet"]', { timeout: 5000 });
      await page.waitForFunction(() => document.querySelector('dialog[open] img.bsland-iran-flag')?.naturalWidth > 0);
      assert.equal(await page.$('[data-testid="bsland-iran-sheet"] .lab-card'), null);
      assert.ok(await page.$('[data-testid="iran-buy-referral"] h3'));
      assert.equal(await page.$eval('[data-testid="iran-buy-referral"]', (el) => getComputedStyle(el).borderTopWidth), '0px');
      assert.ok(await page.$('[data-testid="iran-buy-referral-disclosure"]'));
      const iranBox = await page.$eval('[data-testid="bsland-iran-sheet"]', (el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
      });
      assert.ok(iranBox.w >= iranBox.vw - 2 && iranBox.h >= iranBox.vh - 2, `${label}: Iran popup must be full-screen`);
      const iranDir = await page.$eval('[data-testid="bsland-iran-sheet"]', (el) => {
        const fd = el.querySelector('div[dir]');
        return fd ? fd.getAttribute('dir') : null;
      });
      assert.equal(iranDir, 'rtl', `${label}: Iran popup must be Persian RTL`);
      await page.click('[data-testid="bsland-iran-sheet-close"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="bsland-iran-sheet"]'), { timeout: 5000 });

      console.log(`✓ ${label}: step1/step2, keypad + payment key, buy/sell toggle, report icon, full-screen asset selection, full-screen Iran RTL; no scroll`);
    }
  }

  /* English matrix: the Iran popup stays shut (Persian-only, Iranians-only). */
  for (const theme of ['dark', 'light']) {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(`${base}/test/fixtures/buy-sell.html?lang=en&theme=${theme}`, { waitUntil: 'networkidle0', timeout: 90000 });
    await page.waitForSelector('.bsland-amount');
    await settle();
    await audit(`390/${theme}/en step1`);
    assert.equal(await page.$('[data-testid="bsland-iran"]'), null);
    await page.click('.bsland-key');
    await page.click('.bsland-next');
    await page.waitForSelector('.bsland-picker', { timeout: 5000 });
    await settle();
    await audit(`390/${theme}/en step2`);
    console.log(`✓ 390/${theme}/en: landing renders; Iran popup correctly stays closed`);
  }

  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('PASS: 8 responsive/theme matrices + 2 English layouts; keypad, payment key, buy/sell toggle, report icon, asset selection, full-screen Iran gating; zero runtime errors, zero scroll.');
} finally {
  await browser.close();
}
