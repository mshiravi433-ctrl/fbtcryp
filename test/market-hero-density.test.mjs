import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * ─── THE FIRST SCREEN BELONGS TO THE LIST ──────────────────────────────────
 *
 * On a 430×932 phone the hero banner pushed the first coin row to roughly
 * 620–700px down the page, and on a 390×844 phone the list itself started
 * below the fold. The page's purpose is that list.
 *
 * The element responsible was not the title or the CTAs — it was the
 * description: three lines of 12.5px marketing prose, the only block in the
 * banner with no number in it.
 *
 * These tests read the stylesheet rather than a rendered box, because there is
 * no layout engine in this suite. That is a real limit, so they are written to
 * pin DECISIONS that survive it:
 *   • nothing was deleted — the copy, the chips and every locale key remain;
 *   • the description is clamped visually, never truncated in markup;
 *   • the ban on expensive effects in this sheet still holds, because the
 *     density pass touches the same file;
 *   • the banner still carries what a reader actually uses: title, CTAs and
 *     the three live pods.
 *
 * A pixel-perfect assertion would need a browser this sandbox cannot install;
 * claiming one here would be a lie. What is checked is what can be checked.
 */

const HERO_CSS = 'src/styles/market-hero-banner.css';
const HERO_JSX = 'src/components/market/MarketHeroBanner.jsx';

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = () => stripComments(readFileSync(HERO_CSS, 'utf8'));

/** The body of the last `@media (max-width: 679px)` block in the sheet. */
function phoneBlock() {
  const sheet = css();
  const start = sheet.lastIndexOf('@media (max-width: 679px)');
  assert.ok(start > -1, 'the phone breakpoint must exist');
  /* Walk braces so a nested rule cannot end the block early. */
  let depth = 0;
  let i = sheet.indexOf('{', start);
  const from = i;
  for (; i < sheet.length; i += 1) {
    if (sheet[i] === '{') depth += 1;
    else if (sheet[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return sheet.slice(from, i);
}

test('the description is clamped to two lines on a phone, not three', () => {
  const block = phoneBlock();
  const desc = block.slice(block.indexOf('.mhb-desc'));
  assert.match(desc.slice(0, 200), /-webkit-line-clamp:\s*2/,
    'the description must give back one line on a phone');
  /* And the base rule still clamps three, so nothing is unclamped by accident. */
  const base = css().slice(css().indexOf('.mhb-desc {'));
  assert.match(base.slice(0, 300), /-webkit-line-clamp:\s*3/,
    'the base clamp must stay — this change is a breakpoint, not a rewrite');
});

test('nothing was deleted: the copy and the chips are still rendered and translated', () => {
  const jsx = readFileSync(HERO_JSX, 'utf8');
  /* The elements are all still in the markup — the chips are hidden by CSS at
     one breakpoint, never removed from the component or from the DOM. */
  for (const cls of ['mhb-title', 'mhb-desc', 'mhb-chips', 'mhb-chip', 'mhb-actions', 'mhb-telemetry']) {
    assert.ok(jsx.includes(cls), `${cls} must still be rendered`);
  }
  /* Every key the banner reads still resolves in all twelve dictionaries. */
  const locales = ['fa', 'en', 'ar', 'ur', 'es', 'fr', 'tr', 'ru', 'zh', 'hi', 'pt', 'id'];
  for (const loc of locales) {
    const json = JSON.parse(readFileSync(`src/i18n/locales/${loc}.json`, 'utf8'));
    for (const scene of ['pulse', 'swap', 'wealth']) {
      for (const key of ['chip1', 'chip2', 'chip3', 'desc']) {
        assert.ok(json.marketHero?.scenes?.[scene]?.[key],
          `${loc}.marketHero.scenes.${scene}.${key} must survive the density pass`);
      }
    }
  }
});

test('the copy is clamped visually, never cut in markup', () => {
  const jsx = readFileSync(HERO_JSX, 'utf8');
  /* The description is the whole translated sentence, not a slice of it.
     `-webkit-line-clamp` is a paint-time effect; a `.slice()` here would be a
     truncated string a screen reader would read as the complete text. */
  const desc = jsx.slice(jsx.indexOf('className="mhb-desc"'));
  const node = desc.slice(0, desc.indexOf('</p>'));
  assert.match(node, /t\(`marketHero\.scenes\.\$\{activeScene\.id\}\.desc`\)/,
    'the description must render the full translated string');
  assert.equal(/\.(slice|substring|substr)\(/.test(node), false,
    'the description must not be truncated in markup');
});

test('the chips step aside only on a phone, and keep their space elsewhere', () => {
  const block = phoneBlock();
  assert.match(block, /\.mhb-chips\s*\{[^}]*display:\s*none/,
    'the chips must be the block that steps aside on a phone');
  /* Above the phone breakpoint no rule hides them. */
  const sheet = css();
  const hidingRules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel, body]) => sel.includes('.mhb-chips') && /display:\s*none/.test(body));
  assert.equal(hidingRules.length, 1, 'exactly one rule may hide the chips');
  assert.ok(phoneBlock().includes(hidingRules[0][0].trim()) ||
    phoneBlock().includes('.mhb-chips'), 'and it must be inside the phone block');
});

test('what the banner is FOR is still there at every width', () => {
  const sheet = css();
  /* The title, the two CTAs and the three pods are never hidden. */
  for (const cls of ['.mhb-title', '.mhb-actions', '.mhb-telemetry']) {
    const hideRules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel, body]) => sel.includes(cls) && /display:\s*none/.test(body));
    assert.deepEqual(hideRules.map(([, sel]) => sel.trim()), [],
      `${cls} must never be hidden — it is why the banner exists`);
  }
});

test('the density pass did not smuggle in an expensive effect', () => {
  /* This sheet is pinned by market-hero-banner.test.jsx as having no
     backdrop-filter, no mask, no filter and no will-change — all of which cost
     a rasterisation on a banner that sits above a 250-row list. The new rules
     are the same file and the same contract. */
  const sheet = css();
  expectNo(sheet, /backdrop-filter/, 'backdrop-filter');
  expectNo(sheet, /\bmask(-image)?\s*:/, 'mask');
  expectNo(sheet, /(^|[^-])\bfilter\s*:/m, 'filter');
  expectNo(sheet, /will-change/, 'will-change');

  function expectNo(source, re, name) {
    assert.equal(re.test(source), false, `${name} is banned in this sheet`);
  }
});

test('every keyframe in the sheet still animates transform or opacity only', () => {
  const bodies = [...css().matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  assert.ok(bodies.length >= 6, `expected the sheet's keyframes, found ${bodies.length}`);
  for (const body of bodies) {
    for (const [, prop] of body.matchAll(/([a-z-]+)\s*:/g)) {
      if (prop === 'from' || prop === 'to') continue;
      assert.ok(['transform', 'opacity'].includes(prop),
        `keyframe animates ${prop} — only compositor properties are allowed here`);
    }
  }
});

/*
 * ─── THE CONTROLS BETWEEN THE BANNER AND THE LIST ──────────────────────────
 *
 * The banner is not the only thing above the first row: the tab strip, the
 * lens head, its buttons, the breadth card, the horizon rail, the view chips
 * and the sort button are all there too. On a phone that stack is taller than
 * the list it introduces.
 *
 * Two blocks in the breadth card were given back — 66px of decorative aurora
 * haze and a 9px derivation note — and these tests pin the boundary: the
 * READING (title, average, bar, three legend counts) must survive, the
 * atmosphere may not, and the controls may never be traded for the space.
 */

const INTEL_CSS = 'src/styles/market-intelligence.css';
const intel = () => stripComments(readFileSync(INTEL_CSS, 'utf8'));

test('the phone breakpoint hides the breadth haze and its footnote, nothing else', () => {
  /*
   * Scope by CLASS, not by "the last 619px block": this sheet grew a second
   * `@media (max-width: 619px)` when the column header shipped
   * (market-intelligence.css, the header's own phone geometry), and a test that
   * assumed there was only one would start reading the wrong block while still
   * passing. What the assertion is about is which breadth elements are hidden,
   * so that is what it looks for — inside any phone block.
   */
  const sheet = intel();
  const hidden = [...sheet.matchAll(/([^{}]+)\{([^{}]*display:\s*none[^{}]*)\}/g)]
    .map(([, sel]) => sel.trim())
    .filter((sel) => sel.includes('breadth'));
  assert.deepEqual(
    hidden.sort(),
    ['.mx-market .mx-breadth-aurora', '.mx-market .mx-breadth-note'],
    'only the decorative blocks may be hidden in the breadth card'
  );
});

test('the breadth READING survives the trim', () => {
  const sheet = intel();
  /* The bar, its legend, the title and the average are never display:none —
     they are the actual measurement the card exists for. */
  for (const cls of ['.mx-breadth-bar', '.mx-breadth-legend', '.mx-breadth-title', '.mx-breadth-avg']) {
    const hidden = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel, body]) => sel.includes(cls) && /display:\s*none/.test(body));
    assert.deepEqual(hidden.map(([, sel]) => sel.trim()), [],
      `${cls} is the reading and must never be hidden`);
  }
  /* The markup still renders every one of them. */
  const page = readFileSync('src/pages/Market.jsx', 'utf8');
  for (const cls of ['mx-breadth-bar', 'mx-breadth-legend', 'mx-breadth-aurora', 'mx-breadth-note']) {
    assert.ok(page.includes(cls), `${cls} must stay in the markup — this is a paint decision`);
  }
});

test('the feed controls are never traded for vertical space', () => {
  const sheet = intel();
  /* Refresh, compare and the freshness chip are controls with real tap
     targets. Winning 60px by hiding one would be the wrong trade.
     Note the existing, legitimate rule: on a phone `.mx-compare span` drops
     its LABEL and keeps the icon — the control survives, the word does not.
     So the assertion is on the control itself, not on its descendants. */
  for (const cls of ['.market-refresh', '.mx-compare']) {
    const hidden = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel, body]) => sel.includes(cls) && /display:\s*none/.test(body))
      /* A descendant being hidden is a label decision; the control staying
         addressable is what this test is about. */
      .filter(([, sel]) => sel.trim() === cls || sel.trim().endsWith(` ${cls}`))
      .map(([, sel]) => sel.trim());
    assert.deepEqual(hidden, [],
      `${cls} is a control and must stay reachable at every width`);
  }
  const page = readFileSync('src/pages/Market.jsx', 'utf8');
  assert.ok(page.includes('data-testid="market-refresh"'));
  assert.ok(page.includes('market-freshness') || page.includes('<MarketFreshness'));
});
