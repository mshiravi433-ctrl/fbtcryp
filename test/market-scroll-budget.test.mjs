/**
 * MARKET — THE SCROLL BUDGET, PINNED
 * ---------------------------------------------------------------------------
 * Reported (2026-11-01, third time on this screen): «صفحه بازار خیلی کند هست،
 * گاهی چشمک میزنه، و گاهی ایکون بعضی باکس ها دیر بالا میاد» — with the ask to
 * work out WHY it is slow while scrolling.
 *
 * The earlier passes fixed the load-time weight (CSS diet, image sizes, blur
 * radii, a 30s page-level clock). What they left behind is the SCROLL-time
 * cost, and it was still there because it is not in any one file: it is the
 * sum of the loops that never stop, the fixed layers every frame re-samples,
 * the page-tall decorations behind the content, and sixty SVG sparklines
 * painted in one commit for the eight rows a phone can actually show.
 *
 * These pins are structural and cheap. They fail if a future pass quietly puts
 * any of that weight back — and each one names the mechanism, not a byte count,
 * so the reason survives the numbers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ── 1 · THE STOP POLICY EXISTS, IS SEPARATE, AND IS LOADED LAST ─────────── */

test('the scroll-budget sheet exists and the market route is its only owner', () => {
  const perf = read('src/styles/market-perf.css');
  assert.ok(perf.length > 2000, 'the policy must actually contain rules');

  const market = read('src/pages/Market.jsx');
  const own = market.lastIndexOf("import '../styles/market-perf.css'");
  assert.ok(own > -1, 'Market.jsx must import the scroll-budget sheet');

  /* It must arrive AFTER the five design sheets. Equal specificity is the whole
     point: a perf rule that loses to a design rule is not a rule. */
  for (const sheet of ['market-modern', 'market-intelligence', 'market-glass-v3', 'market-aurora-glass', 'market-obsidian-glass']) {
    const at = market.indexOf(`import '../styles/${sheet}.css'`);
    assert.ok(at > -1 && at < own, `${sheet}.css must be imported before market-perf.css`);
  }

  /* …and nowhere else, so no other route pays for it. */
  for (const file of ['src/main.jsx', 'src/App.jsx']) {
    assert.ok(!read(file).includes('market-perf.css'), `${file} must not pull it in`);
  }
});

/* ── 2 · THE AMBIENT LOOPS ON THIS SCREEN ARE STOPPED ────────────────────── */

test('every stop rule is guarded by the motion escape hatch', () => {
  const bare = stripComments(read('src/styles/market-perf.css'));
  /* A stop rule needs `animation: none`; every one of them needs the guard.
     Counting is what makes this a real check: a new unguarded stop rule cannot
     be verified on a device, and an unguarded RESTORE cannot be added at all. */
  const stops = bare.match(/animation:\s*none\s*!important/g) ?? [];
  const guarded = bare.match(/:root\[data-theme\]:not\(\[data-motion='full'\]\)/g) ?? [];
  assert.ok(stops.length >= 20, `expected the ambient loops to be stopped, found ${stops.length}`);
  assert.ok(guarded.length >= stops.length,
    `every stopped loop must be restorable (${stops.length} stops, ${guarded.length} guards)`);
  /* And no rule may restore with `revert`: in an important declaration that
     goes to the user agent, not to the sheet underneath. */
  assert.ok(!/animation:\s*revert/.test(bare), 'use the guard, not `revert`');
});

test('the loops that carried no reading are the ones that stopped', () => {
  const bare = stripComments(read('src/styles/market-perf.css'));
  for (const selector of [
    '.mx-deck-rim', '.mx-deck-orbit i', '.mx-deck-gloss', '.mx-deck-veil i',
    '.mx-deck::after', '.mx-trio-box::before', '.mx-trend-mid::after',
    '.mx-helix-scroll', '.mx-smart-sheen', '.mx-route-traveller',
    '.mx-dominance-shine', '.mx-trend-scan', '.mx-spark-live i', '.mx-aurora-echo',
    '.mx-trio-aura i', '.mx-skel-row', '.mx-market::after',
    /* the second sweep — the loops that survived the first list */
    '.mx-deck-sheen', '.mx-trend-halo', '.mx-btc-halo',
    '.market-fresh i', '.market-live-dot', '.st-pulse'
  ]) {
    assert.ok(bare.includes(selector), `${selector} must be in the stop policy`);
  }
  /* What is NOT stopped, on purpose: the refresh spinner only runs while a
     request is in flight, and the skeleton shimmer is the only thing saying
     "the feed has not arrived yet". A stop policy that also kills those buys
     nothing during a scroll and costs the reader a signal. */
  assert.ok(!/\.market-refresh/.test(bare), 'the in-flight spinner is not a scroll cost');
  assert.match(bare, /\.mx-skel-row \{ animation: none !important; \}/);
});

/* ── 3 · PAINT CONTAINMENT, AND NO LAYOUT SKIPPING ───────────────────────── */

test('cards are their own paint units, and nothing skips layout again', () => {
  const bare = stripComments(read('src/styles/market-perf.css'));
  assert.match(bare, /\.mx-coin-row > \.coin-row,[\s\S]*?contain: paint/);
  assert.match(bare, /\.mx-coin-row \{ contain: layout paint; \}/);
  /* §14.7 of market-modern.css removed `content-visibility: auto` because it
     moved the scroll height. The cheap half must not bring the expensive half
     back with it. */
  assert.ok(!/content-visibility/.test(bare), 'content-visibility belongs to the reverted pass');
  assert.ok(!/contain-intrinsic-size/.test(bare), 'no reserved heights: the row is measured');
});

test('the page-tall room behind the content is bounded on a phone', () => {
  const bare = stripComments(read('src/styles/market-perf.css'));
  assert.match(bare, /@media \(hover: none\), \(max-width: 900px\)/);
  assert.match(bare, /\.mx-market::before \{[^}]*height: max\(560px, 78vh\)/);
});

/* ── 4 · THE FIXED LAYERS EVERY FRAME RE-SAMPLES ─────────────────────────── */

test('the permanent frosted surfaces and the light field stop paying per frame', () => {
  const css = stripComments(read('src/index.css'));

  /* Orbs: no drift, no `will-change` (a pinned GPU texture per orb) on touch. */
  const touch = css.slice(css.indexOf('.rgb-orb {', css.indexOf('@media (hover: none), (max-width: 900px)')));
  assert.match(touch, /\.rgb-orb \{[^}]*animation: none !important/);
  assert.match(touch, /\.rgb-orb \{[^}]*will-change: auto/);

  /* The nav's two paint-property loops: `filter` and `background-position` on
     a bar that is on screen for the whole session. */
  assert.match(css, /\.bottom-nav::before \{ animation: none; \}/);
  assert.match(css, /\.bottom-nav::after \{[^}]*animation: none/);

  /* …and the header/nav stop re-sampling the list scrolling under them. */
  assert.match(css, /\.top-bar \{\s*backdrop-filter: none;/);
  assert.match(css, /\.bottom-nav \{\s*backdrop-filter: none;/);
});

/* ── 5 · SIXTY SPARKLINES, ONE COMMIT ────────────────────────────────────── */

test('the row draws its shape on arrival, never its numbers', () => {
  const row = read('src/components/CoinRow.jsx');
  /* Default OFF: a single row (a search hit, a hero) must never be deferred. */
  assert.match(row, /deferSpark = false/);
  assert.match(row, /useNearViewport\(\{ eager: !deferSpark/);
  /* The decoration is inside the guard… */
  assert.match(row, /data-spark=\{near \? 'on' : 'off'\}[\s\S]{0,80}\{near && <Sparkline/);
  /* …and the price, the move and the tap target are outside it. */
  const guardAt = row.indexOf('{near && <Sparkline');
  assert.ok(guardAt > 0);
  assert.ok(row.indexOf('coin-price mono') > guardAt, 'the price is rendered regardless');
  assert.ok(row.indexOf('aria-label={`${coin.name} (${coin.symbol})`}') < guardAt, 'the row stays tappable');
  /* The memoised comparator has to see the new prop, or a change of it would
     never re-render the row it was meant to defer. */
  assert.match(row, /prev\.deferSpark === next\.deferSpark/);

  const market = read('src/pages/Market.jsx');
  assert.match(market, /deferSpark=\{i >= 8\}/, 'the first screenful draws at once; the rest waits');
});

test('the hook degrades to "draw everything" where observers do not exist', () => {
  const hook = read('src/hooks/useRowWindow.js');
  assert.match(hook, /typeof IntersectionObserver !== 'function'/);
  assert.match(hook, /setNear\(true\)/, 'a missing observer must never leave a row blank');
  /* One screen of overscan, so a row is already painted when it is reached. */
  assert.match(hook, /rootMargin = '400px'/);
  assert.match(hook, /{ rootMargin }/);

  const row = read('src/components/CoinRow.jsx');
  assert.match(row, /useNearViewport\(\{ eager: !deferSpark, rootMargin: '400px' \}\)/);
  /* `near` is one-way: scrolling back up must not re-render a drawn row. */
  assert.ok(!/setNear\(false\)/.test(hook), 'a drawn row stays drawn');
});

/* ── 6 · THE BATCH THAT USED TO RACE THE FEED ────────────────────────────── */

test('the swap-venue batch waits for the first paint instead of competing with it', () => {
  const hook = read('src/hooks/useCoinVenues.js');
  assert.match(hook, /requestIdleCallback/, 'the batch must be idle-scheduled');
  assert.match(hook, /typeof requestIdleCallback === 'function'/);
  assert.match(hook, /cancelIdle\(handle\)/, 'and cancelled on unmount, so no setState after it');
  /* It must still be able to resolve — a deferred call that never fires is a
     swap button that never appears. */
  assert.match(hook, /getCoinVenues\(ids\)/);
});
