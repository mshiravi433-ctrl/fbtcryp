/**
 * MARKET SPEED + THE FOUR BOXES — regression pins
 * ---------------------------------------------------------------------------
 * Reported, twice: «هنوز در سرعت سایت و سرعت لود پایینه» together with
 * «وقتی اسکرول می‌کنی پایین یا بالا صفحه سیاهه». The second report is the one
 * that matters, because it means the first fix (smaller blur radii) addressed
 * the wrong thing: the cost was not the radius, it was the number of blurred
 * compositing layers and the size of the payload.
 *
 * These pins are deliberately cheap and structural — they fail if a future
 * pass puts the weight back:
 *
 *   1. the market route THINS sparklines (and says how coarsely it did so);
 *   2. the global trend reads that step instead of assuming one point = 1h;
 *   3. the page asks for no more rows than one upstream call can answer;
 *   4. no market surface goes back to `backdrop-filter`, and the rail goes back
 *      to neither a mask nor a blur;
 *   5. the background field is frozen below 900px;
 *   6. the rail still has no blinking dot, and its segments are not boxes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { compactMarketRows } from '../server/providers.js';
import { marketCapSeries } from '../src/lib/globalTrend.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
/** Comments explain the rule; only declarations can break it. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ── 1 · THE PAYLOAD ─────────────────────────────────────────────────────── */

test('compactMarketRows thins a 7-day series and keeps the newest point', () => {
  const hourly = Array.from({ length: 168 }, (_, i) => 61000 + i);
  const [row] = compactMarketRows([{ id: 'bitcoin', sparkline: hourly }]);

  assert.ok(row.sparkline.length <= 48, `expected <= 48 points, got ${row.sparkline.length}`);
  assert.equal(row.sparkline[row.sparkline.length - 1], hourly[hourly.length - 1],
    'the last point must be the price on screen — it is the newest observation');
  assert.equal(row.sparklineStepHours, 4);
  /* Strictly descending price → strictly ascending samples, nothing reordered. */
  for (let i = 1; i < row.sparkline.length; i += 1) {
    assert.ok(row.sparkline[i] > row.sparkline[i - 1], 'points must stay in time order');
  }
});

test('compactMarketRows is a no-op on short or missing series', () => {
  const short = { id: 'x', sparkline: [1, 2, 3] };
  assert.equal(compactMarketRows([short])[0], short);
  const none = { id: 'y', sparkline: [] };
  assert.equal(compactMarketRows([none])[0], none);
  assert.deepEqual(compactMarketRows(null), null);
});

test('the /api/markets route serves the thinned rows', () => {
  const app = read('server/app.js');
  const route = app.slice(app.indexOf("app.get('/api/markets'"), app.indexOf("app.get('/api/trending'"));
  assert.match(route, /compactMarketRows\(await fetchMarkets/, 'route must thin inside the cached producer');
});

/* ── 2 · THE TREND MUST NOT BORROW A WEEK IT DOES NOT HAVE ───────────────── */

function seriesOf(stepHours, length) {
  return Array.from({ length: 12 }, (_, k) => ({
    id: `c${k}`,
    price: 100 + k,
    mcap: (100 + k) * 1e6,
    supply: 1e6,
    sparkline: Array.from({ length }, (_, i) => 100 + k + i * 0.05),
    ...(stepHours === 1 ? {} : { sparklineStepHours: stepHours })
  }));
}

test('a thinned 7-day series still reports 7 days', () => {
  const trend = marketCapSeries(seriesOf(4, 42));
  assert.ok(trend, 'a full, aligned series must produce a trend');
  assert.equal(trend.days, 7);
  const spanHours = (trend.points[trend.points.length - 1].x - trend.points[0].x) / 3.6e6;
  assert.ok(spanHours > 150, `x-axis must span the week, got ${spanHours}h`);
});

test('a raw hourly series is unchanged', () => {
  const trend = marketCapSeries(seriesOf(1, 168));
  assert.equal(trend.days, 7);
});

test('a short hourly series reports the window it actually has', () => {
  const trend = marketCapSeries(seriesOf(1, 42));
  assert.equal(trend.days, 2, '42 hourly points is two days, not a week');
});

/* ── 3 · THE PAGE ASKS FOR WHAT THE SERVER WILL ANSWER ───────────────────── */

test('MARKET_PAGE_SIZE never exceeds the server clamp', () => {
  const market = read('src/pages/Market.jsx');
  const app = read('server/app.js');
  const pageSize = Number(market.match(/const MARKET_PAGE_SIZE = (\d+);/)?.[1]);
  const clamp = Number(app.match(/const perPage = Math\.min\((\d+), Math\.max\(1, Number\(req\.query\.per_page\)/)?.[1]);
  assert.ok(Number.isFinite(pageSize) && Number.isFinite(clamp), 'both constants must be literal');
  assert.ok(pageSize <= clamp, `page asks for ${pageSize} rows but the server answers ${clamp}`);
});

/* ── 4 · NO BLURRED FULL-WIDTH LAYERS ON THE MARKET ROUTE ────────────────── */

test('every market surface turns backdrop-filter off', () => {
  const css = read('src/styles/market-modern.css');
  const block = css.slice(css.indexOf('15 · MARKET — FOURTH PASS'));
  assert.ok(block.length > 0, 'the speed pass must exist');
  for (const selector of ['.market-glass-surface', '.market-cmd', '.market-stories-section', '.market-trending', '.market-breadth', '.ticker']) {
    assert.ok(block.includes(selector), `${selector} must be in the speed pass`);
  }
  assert.match(block, /backdrop-filter: none !important/);
  assert.match(block, /-webkit-backdrop-filter: none !important/);
});

test('the rail is a tape, not a stack of boxes, and has no mask', () => {
  const css = read('src/index.css');
  const railStart = css.lastIndexOf('/*', css.indexOf('Market rail — ONE surface'));
  const rail = stripComments(css.slice(railStart, css.indexOf('Coin rows / lists')));

  assert.ok(!/mask-image/.test(rail), 'a mask-image promotes the whole strip while it animates');
  assert.ok(!/backdrop-filter/.test(rail), 'the rail must not blur the page behind it');
  assert.ok(!/will-change/.test(rail), 'the marquee animation already promotes its own layer');
  /* Segments: full-height, no radius, no border, no shadow — the box-in-a-box
     look was the whole complaint. */
  const item = rail.slice(rail.indexOf('.ticker-item {'), rail.indexOf('.ticker-item:hover'));
  assert.match(item, /height: 100%/);
  assert.match(item, /border-radius: 0/);
  assert.match(item, /border: 0/);
  assert.ok(!/box-shadow/.test(item));
});

test('nothing on the market screen blinks green any more', () => {
  const css = read('src/styles/market-modern.css');
  const block = css.slice(css.indexOf('15.8 · «بدون چراغ چشمک زن سبز»'));
  assert.match(block, /\.market-live-dot/);
  assert.match(block, /\.market-fresh i/);
  assert.match(block, /animation: none !important/);
});

/* ── 5 · THE BACKGROUND FIELD ────────────────────────────────────────────── */

test('the drifting RGB field is frozen on phone-width viewports', () => {
  const src = read('src/components/RgbBackground.jsx');
  assert.match(src, /max-width: 900px/);
  assert.match(src, /isSmallViewport\(\)/);
});

/* ── 6 · THE BANNER'S LOOPS RUN ON THE COMPOSITOR ────────────────────────── */

test('the banner glow and float are CSS, not a rAF loop', () => {
  const banner = read('src/components/AdBanner.jsx');
  assert.ok(!/<motion\.span\s+className="ad-art-glow"/.test(banner), 'the glow must not be a framer-motion loop');
  assert.ok(!/<motion\.svg/.test(banner), 'the floating artwork must not be a framer-motion loop');
  assert.match(banner, /className="ad-art-glow"/);
  assert.match(banner, /className="ad-art-svg"/);
  assert.match(banner, /data-still=/);

  const css = read('src/index.css');
  assert.match(css, /@keyframes ad-glow-pulse/);
  assert.match(css, /@keyframes ad-art-float/);
  assert.match(css, /\.ad-banner\[data-still='true'\] \.ad-art-glow/);
});
