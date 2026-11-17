import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

/*
 * ─── THE BENCHMARK PASS ────────────────────────────────────────────────────
 *
 * Requested: «صفحه بازار باید از بهترین های این ام باشد از صفحات مهم مثل باینس
 * الهام بگیر».
 *
 * What could be copied from a market leader is BEHAVIOUR — the row that is one
 * target, the labels that follow the scroll, the phone hero that gives its
 * width to the copy. What could NOT be copied is its brand, and what must not
 * be copied is its paint budget: this route runs above a 250-row list.
 *
 * These tests pin the three decisions AND the budget, and they resolve the
 * cascade rather than grepping for numbers, because a literal in the right file
 * proves nothing about what wins.
 *
 * A pixel assertion would need a browser this sandbox cannot install (the
 * Chromium download is blocked). So nothing here claims a rendering; every
 * statement is about a resolved declaration or a component's DOM contract.
 */

const SHEET = 'src/styles/market-benchmark.css';
const surface = () => readFileSync(SHEET, 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ── a real cascade reader ──────────────────────────────────────────────────
 * Walks the sheets in the order `Market.jsx` imports them and keeps the last
 * winner for one selector+property at one viewport width. Ancestor at-rules are
 * collected WITH THEIR NAME (`media`), because `params` alone is
 * `(max-width: 619px)` — no prefix — and a collector that filters on
 * `startsWith('@media')` finds nothing and silently reports the desktop value
 * at every width. That exact bug was written, shipped green, and caught here
 * first; it is the reason this helper is explicit about at-rule names.
 */
const IMPORT_ORDER = (() => {
  const jsx = readFileSync('src/pages/Market.jsx', 'utf8');
  return [...jsx.matchAll(/^import '\.\.\/styles\/([\w-]+\.css)';$/gm)].map((m) => m[1]);
})();

function winner(sheetName, selector, prop, width) {
  const sheet = strip(readFileSync(`src/styles/${sheetName}`, 'utf8'));
  const root = postcss.parse(sheet);
  let value;

  root.walkRules((rule) => {
    const guards = [];
    let parent = rule.parent;
    while (parent && parent.type !== 'root') {
      if (parent.type === 'atrule') guards.unshift(`${parent.name} ${parent.params}`);
      parent = parent.parent;
    }
    const joined = guards.join(' ');

    /* The light theme re-grades colour, not geometry; motion preferences must
       not decide a static rule; hover rules are the pointer's, not a layout. */
    if (/data-theme='light'|prefers-reduced-motion|prefers-contrast|data-native|data-lite/.test(joined)) return;

    for (const guard of guards.filter((g) => g.startsWith('media '))) {
      if (!mediaApplies(guard, width)) return;
    }

    const selectors = rule.selector.split(',').map((s) => s.trim());
    /* The exact selector, or a selector that ends with it (so a themed or
       ancestor-qualified variant still counts). */
    if (!selectors.some((s) => s === selector || s.endsWith(` ${selector}`))) return;

    rule.walkDecls((decl) => {
      if (decl.prop === prop) value = decl.value.trim();
    });
  });

  return value;
}

function mediaApplies(guard, width) {
  const max = /max-width:\s*(\d+)px/.exec(guard);
  const min = /min-width:\s*(\d+)px/.exec(guard);
  if (max && !(width <= Number(max[1]))) return false;
  if (min && !(width >= Number(min[1]))) return false;
  /* A hover query is not a width: assume a pointer, which is the case the rule
     is written for, so the geometry it carries is still readable. */
  return true;
}

/** The last sheet in IMPORT_ORDER that sets this property, evaluated at width. */
function resolve(selector, prop, width) {
  let found;
  for (const sheet of IMPORT_ORDER) {
    const value = winner(sheet, selector, prop, width);
    if (value != null) found = { sheet, value };
  }
  return found;
}

test('the sheet is imported exactly once, after the surface scale and before the budget', () => {
  const jsx = readFileSync('src/pages/Market.jsx', 'utf8');
  /* Count IMPORT STATEMENTS, not mentions: the comment above the import names
     the file too, and a test that counts substrings passes on a comment. */
  const occurrences = [...jsx.matchAll(/^import '\.\.\/styles\/market-benchmark\.css';$/gm)].length;
  assert.equal(occurrences, 1, 'one import, one reason — see the comment above it');

  const iBench = IMPORT_ORDER.indexOf('market-benchmark.css');
  const iSurface = IMPORT_ORDER.indexOf('market-surface.css');
  const iPerf = IMPORT_ORDER.indexOf('market-perf.css');
  assert.ok(iBench > iSurface, 'the scale must lose to the benchmark pass');
  assert.ok(iPerf > iBench, 'the scroll budget must stay the last word');
});

test('§1 · a row is one pointer target, and the rule is border-colour only', () => {
  const css = strip(surface());

  /* The rule exists and is hover-guarded, so a touch device does not pay for a
     state it cannot reach. */
  const block = css.slice(css.indexOf('@media (hover: hover)'));
  assert.match(
    block.slice(0, 400),
    /\.mx-market \.mx-coin-row:hover > \.coin-row:not\(:hover\)\s*\{[^}]*border-color:/,
    'hovering anywhere in the row must light the card'
  );

  /* And the keyboard gets the same row: focus in the action cell marks it. */
  assert.match(
    css,
    /\.mx-market \.mx-coin-row:focus-within > \.coin-row\s*\{[^}]*border-color:/,
    'focus anywhere in the row must mark the row'
  );

  /* The budget: the only property either rule may transition or set is a
     border colour. A background or shadow here re-rasterises the row's
     four-layer inset paint on every row the pointer crosses — the exact cost
     market-perf.css §5 removed from this same element. */
  for (const selector of ['.mx-coin-row:hover > .coin-row:not(:hover)', '.mx-coin-row:focus-within > .coin-row']) {
    const at = css.indexOf(selector);
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    assert.deepEqual(props, ['border-color'],
      `${selector} may declare border-color and nothing else, found: ${props.join(', ')}`);
  }
});

test('§2 · the column header sticks below the tab strip, and only above a phone', () => {
  /* The component opts in explicitly. */
  const jsx = readFileSync('src/components/market/MarketColumnHeader.jsx', 'utf8');
  assert.match(jsx, /sticky = true/, 'the header defaults to sticky');
  assert.match(jsx, /data-sticky=\{sticky \? 'true' : undefined\}/,
    'the behaviour must be an explicit attribute, not a bare class');

  /* At a phone width nothing makes it sticky — the original decision stands
     where it was made. */
  const phone = resolve('.mx-market .mx-colhead[data-sticky=\'true\']', 'position', 390);
  assert.equal(phone, undefined, 'a phone must keep the non-sticky header it was designed with');

  /* At tablet and desktop it does, and it tucks under the strip. */
  for (const width of [760, 1280]) {
    const at = resolve('.mx-market .mx-colhead[data-sticky=\'true\']', 'position', width);
    assert.equal(at?.value, 'sticky', `${width}px: the header must follow the scroll`);
    assert.equal(at.sheet, 'market-benchmark.css', `${width}px: and the benchmark sheet must be the one saying so`);

    const top = resolve('.mx-market .mx-colhead[data-sticky=\'true\']', 'top', width);
    assert.match(top.value, /--market-tabs-top/, 'the offset must come from the measured app bar');
    assert.match(top.value, /--market-tabs-h/, 'and from the measured strip below it');
  }

  /* The strip publishes that second measurement: a sticky header offset by a
     guessed 52px slides under a 44px phone pill and over a 38px compact one. */
  const stripJsx = readFileSync('src/components/market/MarketTabStrip.jsx', 'utf8');
  assert.match(stripJsx, /--market-tabs-h/, 'the strip must publish its own height');
  assert.match(stripJsx, /querySelector\('\.mx-tabs'\)/, 'and it must measure the pill, not the wrapper');
});

test('§2 · the sticky plate is opaque, not a blur over the rows sliding under it', () => {
  const css = strip(surface());
  const at = css.indexOf('.mx-colhead[data-sticky=\'true\']');
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));

  assert.match(body, /background:\s*var\(--mx-panel\)/,
    'the band must paint the same opaque token as the cards it labels');
  assert.equal(/backdrop-filter/.test(body), false,
    'a blur here samples 60 rows per frame — the cost this route spent three passes removing');
  assert.equal(/gradient/.test(body), false, 'and a gradient plate would be a sixth material');
  /* It needs a lower edge, or rows appear to slide out of the labels. */
  assert.match(body, /border-block-end:\s*1px solid/);
});

test('§3 · on a phone the sculpture steps aside so the copy gets the width', () => {
  const css = strip(surface());

  /*
   * Find the phone block that owns the sculpture rule — NOT "the last
   * `@media (max-width: 679px)` in the file". This sheet has two of them (§3 is
   * the sculpture, §4 restates the banner's corner on a phone), and a
   * lastIndexOf-based test would have read §4's block while still passing.
   */
  const phoneBlocks = [...css.matchAll(/@media \(max-width: 679px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const stageBlock = phoneBlocks.find((b) => b.includes('.mhb-stage'));
  assert.ok(stageBlock, 'a phone block must own the sculpture rule');
  assert.match(stageBlock, /\.mhb-body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    'the body must become one column');
  assert.match(stageBlock, /\.mhb-stage\s*\{[^}]*display:\s*none/,
    'the drawn sculpture — decoration, aria-hidden, no reading — is what goes');

  /* Nothing else may be hidden: this is a width decision about ONE element. */
  const hidden = [...css.matchAll(/([^{}]+)\{([^{}]*display:\s*none[^{}]*)\}/g)]
    .map(([, sel]) => sel.trim());
  assert.deepEqual(hidden, ['.mx-market .mhb-stage'],
    'exactly one element may step aside, and it must be the sculpture');

  /* And it is a CSS decision, not a deletion: the element and its state stay. */
  const jsx = readFileSync('src/components/market/MarketHeroBanner.jsx', 'utf8');
  assert.ok(jsx.includes('mhb-stage'), 'the sculpture must still be in the markup');
  assert.ok(jsx.includes('mhb-art'), 'and its per-scene artwork swap must survive');
});

test('§4 · the banner answers to the same surface scale as every other card', () => {
  for (const [width, tier, expected] of [[1280, 'shell', 32], [1280, 'hero', 26], [760, 'hero', 25], [390, 'hero', 22]]) {
    const scale = resolve('.mx-market', `--mx-r-${tier}`, width);
    assert.equal(scale?.value, `${expected}px`, `${width}px: the ${tier} tier must resolve to ${expected}px`);
  }

  /* The banner reads the hero tier — it is the crown of the page, one step
     under the shell. */
  const banner = resolve('.mx-market .mhb', 'border-radius', 1280);
  assert.equal(banner?.value, 'var(--mx-r-hero)');
  assert.equal(banner.sheet, 'market-benchmark.css');

  /* The CTAs and the three pods take the control tier: an 18px corner on a
     42px tile is a soft tile, not a stadium. */
  for (const selector of ['.mx-market .mhb-cta', '.mx-market .mhb-pod']) {
    const found = resolve(selector, 'border-radius', 1280);
    assert.equal(found?.value, 'var(--mx-r-control)', `${selector} must read the control tier`);
  }
});

test('the sheet spends nothing at runtime: no keyframes, no blur, no mask, no will-change', () => {
  const css = strip(surface());

  assert.equal(/@keyframes/.test(css), false, 'a static sheet — this pass adds no motion');
  assert.equal(/animation\s*:/.test(css), false, 'and no animation shorthand');
  assert.equal(/backdrop-filter/.test(css), false, 'backdrop-filter');
  assert.equal(/\bmask(-image)?\s*:/.test(css), false, 'mask');
  assert.equal(/(^|[^-])\bfilter\s*:/m.test(css), false, 'filter');
  assert.equal(/will-change/.test(css), false, 'will-change');
  assert.equal(/content-visibility/.test(css), false, 'content-visibility');

  /* Every transition it does declare is a compositor property. */
  const transitions = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]);
  for (const value of transitions) {
    for (const prop of value.match(/([a-z-]+)\s+[\d.]+m?s/g) ?? []) {
      const name = prop.split(/\s+/)[0];
      assert.ok(['border-color', 'transform', 'opacity'].includes(name),
        `transition on ${name} — only compositor properties are allowed above a 250-row list`);
    }
  }
});

test('the new sheet declares no colour of its own beyond the tokens it must borrow', () => {
  const css = strip(surface());
  /* Two literal colours are allowed and both are the row's EXISTING hover
     border, not a new value: rgba(102, 229, 225, .35) is
     market-intelligence.css §8's `.mx-coin-row > .coin-row:hover` border. A
     third literal would mean this sheet had started inventing a palette. */
  const literals = [...css.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map((m) => m[0]);
  const unique = [...new Set(literals)];
  assert.deepEqual(unique, ['rgba(102, 229, 225, .35)'],
    `unexpected colour literals: ${unique.join(', ')}`);
});
