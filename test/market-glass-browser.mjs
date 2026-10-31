/** Real Chromium regression. Start npm run dev:web first.
 * PUPPETEER_EXECUTABLE_PATH selects an installed browser; UI_TEST_BASE_URL can
 * target a different dev server. API fixtures are confined to interception.
 * No wallet connects and no financial transaction is submitted.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { marketGlassCoins as coins, marketGlassGlobal as global } from './fixtures/market-glass-data.mjs';

const base = process.env.UI_TEST_BASE_URL || 'http://localhost:5173';
const shots = process.env.MARKET_GLASS_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process']
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.setRequestInterception(true);
page.on('request', async (request) => {
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/')) {
    let data = {};
    if (url.pathname === '/api/health') data = { ok: true };
    else if (url.pathname === '/api/markets') data = coins;
    else if (url.pathname === '/api/global') data = global;
    else if (url.pathname === '/api/trending') data = coins.slice(0, 8);
    else if (url.pathname.startsWith('/api/category/')) data = coins.slice(8, 12);
    else if (url.pathname === '/api/search') data = coins.filter((c) => `${c.name} ${c.symbol}`.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase()));
    else if (url.pathname === '/api/coin-venues') data = { venues: {} };
    return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  }
  // Only satisfy the optional public-key prewarm. No wallet, attestation or
  // signing flow is exercised by this layout/gesture test.
  if (url.hostname === 'verify.walletconnect.org' && url.pathname === '/v3/public-key') {
    return request.respond({ status: 200, contentType: 'application/json', body: '{}' });
  }
  if (!request.url().startsWith(base) && !/^(data|blob):/.test(request.url())) return request.abort();
  return request.continue();
});

const open = async (width = 390, theme = 'dark', lang = 'fa', extra = '', mobile = false) => {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await page.goto(`${base}/test/fixtures/market-glass.html?theme=${theme}&lang=${lang}${extra}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#market-list-rows .coin-row');
  await page.evaluate(() => document.fonts.ready);
};

try {
  for (const [width, theme, lang] of [
    [320, 'dark', 'fa'], [360, 'light', 'fa'], [390, 'dark', 'fa'],
    [430, 'light', 'en'], [768, 'dark', 'en'], [1280, 'dark', 'fa'], [1280, 'light', 'en']
  ]) {
    await open(width, theme, lang);
    const reading = await page.evaluate(() => {
      const bounds = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width, height: r.height }; };
      const row = document.querySelector('.mx-coin-row');
      const card = row.querySelector('.coin-row');
      const swap = row.querySelector('.mx-swap-btn');
      const rail = document.querySelector('.mx-sectors-rail');
      const railBox = document.querySelector('.mx-sector-rail');
      const trio = [...document.querySelectorAll('.mx-trio-box')].map(bounds);
      const cardStyle = getComputedStyle(card);
      const children = [...row.querySelector('.coin-row-open').children].filter((el) => getComputedStyle(el).display !== 'none').map(bounds);
      const rows = [...document.querySelectorAll('#market-list-rows .coin-row-open')];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        card: bounds(card), swap: bounds(swap), rail: bounds(rail),
        railBorder: getComputedStyle(railBox).borderTopWidth,
        railBackground: getComputedStyle(railBox).backgroundImage,
        railScroll: getComputedStyle(rail).overflowX,
        railDirection: getComputedStyle(rail).flexDirection,
        railChildren: [...rail.children].map(bounds),
        railOverflow: rail.scrollWidth > rail.clientWidth,
        cardMaterial: cardStyle.backgroundImage,
        wrapperMaterial: getComputedStyle(row).backgroundImage,
        foldInFooter: !!document.querySelector('.mx-more [data-testid="market-list-fold"]'),
        foldInHeader: !!document.querySelector('.mx-list-hero [data-testid="market-list-fold"]'),
        trio, children,
        misalignedPrices: rows.some((el) => el.querySelector('.coin-right').getBoundingClientRect().right > el.getBoundingClientRect().right + 1 || el.querySelector('.coin-right').getBoundingClientRect().left < el.getBoundingClientRect().left - 1),
        count: rows.length,
        rangePosition: (() => {
          const track = document.querySelector('.mx-btc-range-track').getBoundingClientRect();
          const marker = document.querySelector('.mx-btc-range-track span').getBoundingClientRect();
          return ((marker.x + marker.width / 2) - track.x) / track.width;
        })(),
        routeLabelsAligned: (() => {
          const center = (el) => { const r = el.getBoundingClientRect(); return r.x + r.width / 2; };
          const nodes = document.querySelectorAll('.mx-route-node');
          const labels = document.querySelectorAll('.mx-route-labels > span');
          return (center(nodes[0]) - center(nodes[2])) * (center(labels[0]) - center(labels[2])) > 0;
        })()
      };
    });
    assert.equal(reading.overflow, false, `page overflow: ${width}/${theme}/${lang}`);
    assert.equal(reading.foldInFooter, true);
    assert.equal(reading.foldInHeader, false);
    assert.equal(reading.railBorder, '0px');
    assert.equal(reading.railBackground, 'none');
    assert.equal(reading.railScroll, 'auto');
    assert.equal(reading.railDirection, 'row');
    assert(reading.railChildren.every((box) => Math.abs(box.y - reading.railChildren[0].y) < 1), `categories are not horizontal: ${width}`);
    if (width < 620) assert(reading.railOverflow, `categories do not scroll: ${width}`);
    assert.equal(reading.wrapperMaterial, 'none');
    assert.match(reading.cardMaterial, /gradient/);
    assert.equal(reading.misalignedPrices, false, `price outside card: ${width}`);
    assert(reading.swap.width >= 44 && reading.swap.height >= 44);
    assert(reading.swap.right <= reading.card.x - 1 || reading.swap.x >= reading.card.right + 1, `swap is inside the card: ${width}`);
    assert(reading.trio.every((box) => Math.abs(box.y - reading.trio[0].y) < 1), `trio wrapped: ${width}`);
    const physical = reading.children.sort((a, b) => a.x - b.x);
    for (let i = 1; i < physical.length; i += 1) assert(physical[i - 1].right <= physical[i].x + 1, `overlapping coin columns: ${width}`);
    assert.equal(reading.count, 60);
    assert(Math.abs(reading.rangePosition - .035 / .06) < .025, `BTC range direction is wrong: ${lang}`);
    assert.equal(reading.routeLabelsAligned, true, `flow labels run backwards: ${lang}`);
    if (shots && [320, 390, 1280].includes(width)) {
      await page.screenshot({ path: `${shots}/${width}-${theme}-${lang}-overview.png`, fullPage: false });
      await page.$eval('.mx-smart-banner', (el) => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `${shots}/${width}-${theme}-${lang}-list.png`, fullPage: false });
      await page.$eval('.mx-terminal', (el) => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `${shots}/${width}-${theme}-${lang}-coins.png`, fullPage: false });
    }
    console.log('Layout PASS', width, theme, lang);
  }
  // Real mouse events (not synthetic scrollLeft assignments) in both directions.
  for (const lang of ['fa', 'en']) {
    await open(390, 'dark', lang);
    await page.$eval('.mx-sectors-rail', (el) => el.scrollIntoView({ block: 'center' }));
    const box = await page.$eval('.mx-sectors-rail', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(middle.x, middle.y);
    await page.mouse.wheel({ deltaY: 100 });
    await page.waitForFunction(() => Math.abs(document.querySelector('.mx-sectors-rail').scrollLeft) > 40);
    const before = await page.$eval('.mx-sectors-rail', (el) => el.scrollLeft);
    await page.mouse.down();
    await page.mouse.move(middle.x + (lang === 'fa' ? 110 : -110), middle.y, { steps: 10 });
    await page.mouse.up();
    const after = await page.$eval('.mx-sectors-rail', (el) => el.scrollLeft);
    assert(Math.abs(after) > Math.abs(before) + 40, `mouse drag failed in ${lang}`);
    assert.equal(await page.$eval('.mx-sector[data-active="true"]', (el) => el.dataset.sector), 'all', 'drag selected a category');
    await page.focus('.mx-sector[data-sector="all"]');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.sector), 'solana');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.sector), 'all');
    await page.keyboard.press(lang === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.sector), 'gold');
    await page.click('.mx-sector[data-sector="meme"]');
    await page.waitForFunction(() => document.querySelectorAll('#market-list-rows .coin-row').length === 4);
    assert.equal(await page.$eval('.mx-sector[data-active="true"]', (el) => el.dataset.sector), 'meme');
    await page.click('.mx-sector[data-sector="all"]');
    await page.waitForFunction(() => document.querySelectorAll('#market-list-rows .coin-row').length === 60);
    console.log('Mouse wheel, drag, keyboard and real category fetch PASS', lang);
  }

  // The native touch path must pan the rail AND still allow vertical page scroll.
  await open(390, 'dark', 'fa', '', true);
  await page.$eval('.mx-sectors-rail', (el) => el.scrollIntoView({ block: 'center' }));
  const touchBox = await page.$eval('.mx-sectors-rail', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  let client = await page.createCDPSession();
  const swipe = async (from, to) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 8; i += 1) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const y = touchBox.y + touchBox.height / 2;
  await swipe({ x: touchBox.x + 70, y }, { x: touchBox.x + touchBox.width - 30, y });
  await page.waitForFunction(() => Math.abs(document.querySelector('.mx-sectors-rail').scrollLeft) > 50);
  const scrollY = await page.evaluate(() => window.scrollY);
  await swipe({ x: 190, y }, { x: 190, y: y - 150 });
  await page.waitForFunction((before) => window.scrollY > before + 40, {}, scrollY);
  await client.detach();
  console.log('Native horizontal touch + vertical page scroll PASS');

  // The relocated fold keeps the true total and the user's pagination budget.
  await open();
  const rows = () => page.$$eval('#market-list-rows .coin-row', (els) => els.length);
  const total = await page.$eval('[data-testid="market-count"]', (el) => el.textContent);
  await page.click('[data-testid="market-list-fold"]');
  assert.equal(await rows(), 12);
  assert.equal(await page.$eval('[data-testid="market-list-fold"]', (el) => el.getAttribute('aria-expanded')), 'false');
  assert.equal(await page.$eval('[data-testid="market-count"]', (el) => el.textContent), total);
  await page.click('[data-testid="market-list-fold"]');
  assert.equal(await rows(), 60);
  await page.click('.market-show-more');
  assert.equal(await rows(), 75);
  await page.click('[data-testid="market-list-fold"]');
  assert.equal(await rows(), 12);
  await page.click('[data-testid="market-list-fold"]');
  assert.equal(await rows(), 75);
  assert.equal(await page.$eval('[data-testid="market-count"]', (el) => el.textContent), total);
  console.log('Relocated footer fold, true total and retained pagination PASS');

  // Search selection and detached swap preserve their original destinations.
  await open();
  await page.focus('#market-coin-search');
  await page.type('#market-coin-search', 'bit');
  await page.waitForSelector('.mx-search-option');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('[data-testid="route-probe"]', (el) => el.textContent), '/coin/bitcoin');
  await page.click('[data-testid="market-swap-bitcoin"]');
  assert.match(await page.$eval('[data-testid="route-probe"]', (el) => el.textContent), /^\/swap\?/);
  await page.click('.mx-smart-cta');
  assert.equal(await page.$eval('[data-testid="route-probe"]', (el) => el.textContent), '/smart-money');
  console.log('Autocomplete, detached swap and Smart Money navigation PASS');

  // Every animation stop must work without remounting the component.
  await open();
  assert.notEqual(await page.$eval('.mx-route-traveller', (el) => getComputedStyle(el).animationName), 'none');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  for (const selector of ['.mx-route-traveller', '.mx-smart-ring', '.mx-smart-sheen', '.mx-deck-veil i']) {
    assert.equal(await page.$eval(selector, (el) => getComputedStyle(el).animationName), 'none');
  }
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  for (const attribute of ['lite', 'native', 'reduce-motion']) {
    await page.evaluate((name) => document.documentElement.setAttribute(`data-${name}`, 'true'), attribute);
    for (const selector of ['.mx-route-traveller', '.mx-smart-ring', '.mx-smart-sheen', '.mx-deck-veil i']) {
      assert.equal(await page.$eval(selector, (el) => getComputedStyle(el).animationName), 'none');
    }
    await page.evaluate((name) => document.documentElement.removeAttribute(`data-${name}`), attribute);
  }
  assert.equal(await page.$('.mx-smart-route animateTransform'), null);
  console.log('OS, app preference, native and lite motion stops PASS');
  // Also exercise the real app shell's swipe-to-change-tab and pull-to-refresh
  // ancestors, not only the isolated fixture. No wallet identity is seeded.
  await page.evaluateOnNewDocument((origin) => {
    if (location.origin !== origin) return;
    localStorage.setItem('fbt-settings-v1', JSON.stringify({ version: 3, state: { onboarded: true, guideReadAt: Date.now(), theme: 'dark', currency: 'USD' } }));
    localStorage.setItem('fbt-lang', 'fa');
  }, new URL(base).origin);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(`${base}/?lang=fa#/`, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForSelector('.app-tab-swipe-zone .mx-sectors-rail', { timeout: 60000 });
  await page.$eval('.mx-sectors-rail', (el) => el.scrollIntoView({ block: 'center' }));
  const appRail = await page.$eval('.mx-sectors-rail', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; });
  client = await page.createCDPSession();
  await swipe({ x: appRail.x + 50, y: appRail.y + 2 }, { x: appRail.x + appRail.width - 20, y: appRail.y + 2 });
  await page.waitForFunction(() => Math.abs(document.querySelector('.mx-sectors-rail')?.scrollLeft || 0) > 40);
  assert.equal(await page.evaluate(() => location.hash), '#/', 'category swipe changed the app tab');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (shots) {
    await page.$eval('.mx-terminal', (el) => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${shots}/390-full-app-coins.png`, fullPage: false });
  }
  await client.detach();
  console.log('Real App shell: category swipe scrolls, never changes route PASS');
  assert.deepEqual(errors, [], 'uncaught page errors');
} finally {
  await browser.close();
}
