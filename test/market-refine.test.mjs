import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

/*
 * ─── THE REFINE PASS ───────────────────────────────────────────────────────
 *
 * Three reports and one redesign, and the reports are BUGS with causes, so the
 * tests name the cause rather than a colour:
 *
 *   1 · «دور هر بخش یک نوار سفید میاد» — a 1.5px frame that the LIGHT theme
 *       turned 92% white, plus a white outline on hover;
 *   2 · «زیر تب ها با اسکرول با صفحه حرکت می کند» — the strip is sticky in the
 *       cascade, so the fix has to be in what made its offset unstable: it is
 *       a stretched flex item and had no local stacking context;
 *   3 · «رنگ بندی حرفه ای تر» — six competing accents folded to two.
 *
 * The colour tests are CONTRAST tests, not hex comparisons: "professional" is
 * not a colour, but "the accent is readable as text on the panel" is a fact
 * that can be checked and a fact that a future re-grade can break.
 *
 * One limit, stated once: this suite resolves the cascade, it does not render.
 * Chromium cannot be installed in this sandbox, so nothing here claims a pixel.
 */

const SHEET = 'src/styles/market-refine.css';
const sheet = () => readFileSync(SHEET, 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const IMPORT_ORDER = (() => {
  const jsx = readFileSync('src/pages/Market.jsx', 'utf8');
  return [...jsx.matchAll(/^import '\.\.\/styles\/([\w-]+\.css)';$/gm)].map((m) => m[1]);
})();

/*
 * The theme lives in the SELECTOR in this codebase — the light rule is written
 * as :root[data-theme='light'] .mx-market — not in an ancestor at-rule. A collector that looks only at
 * at-rules reports the dark cascade for both themes, and a test built on it
 * passes while checking the wrong theme. That mistake was made twice while
 * writing this pass; the helper below reads the theme from the matched
 * selector, which is where it actually is.
 */
function resolve(selector, prop, { light = false, width = 1280 } = {}) {
  let found;
  for (const name of IMPORT_ORDER) {
    postcss.parse(strip(readFileSync(`src/styles/${name}`, 'utf8'))).walkRules((rule) => {
      const guards = [];
      let parent = rule.parent;
      while (parent && parent.type !== 'root') {
        if (parent.type === 'atrule') guards.unshift(`${parent.name} ${parent.params}`);
        parent = parent.parent;
      }
      const ctx = guards.join(' ');
      if (/prefers-reduced-motion|prefers-contrast|data-native|data-lite|hover: none/.test(ctx)) return;
      const max = /max-width:\s*(\d+)px/.exec(ctx);
      const min = /min-width:\s*(\d+)px/.exec(ctx);
      if (max && !(width <= Number(max[1]))) return;
      if (min && !(width >= Number(min[1]))) return;

      const matched = rule.selector.split(',').map((s) => s.trim())
        .filter((s) => s === selector || s.endsWith(` ${selector}`));
      if (!matched.length) return;

      const themed = matched.some((s) => /data-theme='light'/.test(s));
      const plain = matched.some((s) => !/data-theme=/.test(s));
      /* In the light theme a themed rule wins over a plain one in the same
         layer; in the dark theme only the plain one applies. */
      const applies = light ? themed || plain : plain || !themed;
      if (!applies) return;

      rule.walkDecls((decl) => {
        if (decl.prop === prop) found = { sheet: name, value: decl.value.trim() };
      });
    });
  }
  return found;
}

/* ── WCAG relative luminance, so "readable" is measured, not asserted ───── */
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/* ══ 1 · THE WHITE BARS ═══════════════════════════════════════════════════ */

test('§1 · no frame and no white outline survives on a heatmap tile, in either theme', () => {
  for (const light of [false, true]) {
    const where = light ? 'light' : 'dark';

    /* The border is gone as a SHORTHAND — not merely zero-width — and its
       colour is reset too. market-overview-phase2.css still declares
       border-color: rgba(255,255,255,.92) for the light theme; leaving that
       in place would mean the white bar returns the moment anyone sets a
       width again. A hole that reopens on an unrelated edit is not fixed. */
    const border = resolve('.mx-hm-tile', 'border', { light });
    assert.equal(border?.value, '0', `${where}: the tile must have no frame`);
    assert.equal(border.sheet, 'market-refine.css', `${where}: and this sheet must be the one saying so`);

    const color = resolve('.mx-hm-tile', 'border-color', { light });
    assert.equal(color?.value, 'transparent',
      `${where}: the old ${color?.sheet} border-colour must be overridden, not merely hidden by a zero width`);

    /* The white ring on hover was the second half of the same complaint: it
       drew INSIDE the tile at 88% white, so mousing across the grid flashed. */
    const css = strip(sheet());
    const hover = css.slice(css.indexOf('.mx-hm-tile:hover'));
    assert.equal(/outline:\s*2px solid rgba\(255, 255, 255/.test(hover), false,
      'no white outline on hover');
    assert.match(hover.slice(0, 260), /outline:\s*0/, 'the old outline must be explicitly cleared');
  }
});

test('§1 · the tiles are separated by a gap derived from their own geometry', () => {
  /* The replacement must not touch the layout maths: the treemap still owns
     left/top/width/height, and the inset is derived from the SAME numbers. */
  for (const prop of ['inset-inline-start', 'inset-block-start']) {
    const found = resolve('.mx-hm-tile', prop);
    assert.match(found.value, /calc\(var\(--hm-(left|top)/,
      `${prop} must derive from the published cell origin`);
    assert.match(found.value, /0\.7%/, 'and be a 0.7% inset of the stage');
  }
  const width = resolve('.mx-hm-tile', 'width');
  assert.match(width.value, /calc\(var\(--hm-w[^)]*\) - 1\.4%\)/,
    'the tile must be 1.4% narrower than its cell, so two neighbours sit 1.4% apart');
  const height = resolve('.mx-hm-tile', 'height');
  assert.match(height.value, /calc\(var\(--hm-h[^)]*\) - 1\.4%\)/);

  /* And the component publishes those variables from the same values it lays
     out with, in one object literal, so they cannot drift. */
  const jsx = readFileSync('src/components/market/MarketHeatmap.jsx', 'utf8');
  for (const name of ['--hm-left', '--hm-top', '--hm-w', '--hm-h']) {
    assert.ok(jsx.includes(`'${name}':`), `${name} must be published by the component`);
  }
  /*
   * Slice from the OPENING BRACE of the style object that contains --hm-left,
   * not from "the last style={{ before it": the documentation comment above
   * the object mentions style and --hm-left, so a backwards search lands
   * inside the comment and reads prose instead of code. Find the brace by
   * walking back to the nearest style={{ that is followed by left: before
   * the variable — i.e. by taking the nearest one AFTER the last comment end.
   */
  const styleAt = jsx.indexOf("'--hm-left'");
  const afterComment = jsx.lastIndexOf('*/', styleAt);
  const open = jsx.indexOf('style={{', afterComment);
  assert.ok(open > -1 && open < styleAt, 'the style object must follow its own comment');
  const block = jsx.slice(open, styleAt);
  /*
   * Compare two backtick-free substrings instead of the whole expression. The
   * JSX uses a template literal, and reproducing its punctuation inside a
   * regex (or inside a quoted string) is how this assertion turned into three
   * consecutive syntax errors while being written. Both fragments below are
   * unambiguous and neither can be confused with a JS template.
   */
  assert.ok(block.includes('left:'), 'the tile still lays out from left');
  assert.ok(block.includes('xPct.toFixed(3)'), 'and from the treemap\'s own x origin');
});

test('§1 · the stage becomes a well inside the card, not a hole cut in the page', () => {
  const stage = resolve('.mx-hm-stage', 'background');
  assert.match(stage.value, /var\(--mx-well\)/,
    'the stage must paint the card system\'s own well token');
  assert.equal(stage.sheet, 'market-refine.css');
});

/* ══ 2 · THE STRIP ════════════════════════════════════════════════════════ */

test('§2 · the sticky strip is given a stable offset: not re-declared, but disambiguated', () => {
  /* It is already sticky. Re-declaring the position property here would make
     the next reading of market-tabs.css a lie; the fix is in what made the
     offset unstable. */
  const position = resolve('.mx-tabs-wrap', 'position');
  assert.equal(position.sheet, 'market-tabs.css',
    'the strip\'s stickiness must stay where it is documented');

  /* A sticky FLEX ITEM with the default align-self: stretch is as tall as its
     row, so it has no distance left to travel — the plate inside it moves, the
     box does not. That is what "it scrolls with the page" looks like. */
  const align = resolve('.mx-tabs-wrap', 'align-self');
  assert.equal(align?.value, 'start', 'a sticky flex item must not be stretched');
  assert.equal(align.sheet, 'market-refine.css');

  /* And a local stacking context on the route, so the strip's z-index resolves
     against its own page instead of the root. */
  const isolation = resolve('.mx-market', 'isolation');
  assert.equal(isolation?.value, 'isolate');
});

test('§2 · the offset is still the measured one, so the diagnostics stay true', () => {
  const top = resolve('.mx-tabs-wrap', 'top');
  assert.match(top.value, /--market-tabs-top/,
    'the offset must remain the value measured from the real app bar');
});

/* ══ 3 · THE COLOUR PASS ══════════════════════════════════════════════════ */

test('§3 · the accent set is folded to two voices plus the two directions', () => {
  /*
   * The screen grew SIX competing accents over five passes — cyan, violet,
   * gold, blue, up, down — and that is why it read busy rather than
   * professional. Gold and blue are remapped at the TOKEN level rather than
   * hunted down across five sheets: every existing use keeps working, and the
   * screen stops arguing with itself.
   */
  for (const light of [false, true]) {
    const where = light ? 'light' : 'dark';
    const blue = resolve('.mx-market', '--mx-blue', { light });
    assert.equal(blue?.value, 'var(--mx-cyan)',
      `${where}: blue must stop being an independent accent`);
    assert.equal(blue.sheet, 'market-refine.css');

    /* Gold is the warm end of the primary — a value, not a sixth voice, and
       it must be a real colour rather than a fallback. */
    const gold = resolve('.mx-market', '--mx-gold', { light });
    assert.match(gold.value, /^#[0-9a-f]{6}$/i, `${where}: gold must be a concrete colour`);
  }

  /* The two directions stay genuinely distinct hues from the two voices, or a
     price is coloured with the same ink as a link. */
  const up = resolve('.mx-market', '--mx-up').value;
  const down = resolve('.mx-market', '--mx-down').value;
  assert.notEqual(up, down);
});

test('§3 · every accent is readable as TEXT on the panel it sits on', () => {
  /*
   * This is the check that makes the colour pass a design decision instead of
   * a preference: the accents are used as label and figure colours all over
   * this screen, so each one has to clear 4.5:1 against the panel it is drawn
   * on. A re-grade that makes the palette prettier and the numbers unreadable
   * fails here.
   */
  for (const light of [false, true]) {
    const where = light ? 'light' : 'dark';
    const panel = resolve('.mx-market', '--mx-panel', { light }).value;
    for (const token of ['--mx-text', '--mx-muted', '--mx-cyan', '--mx-violet', '--mx-up', '--mx-down']) {
      const value = resolve('.mx-market', token, { light }).value;
      const ratio = contrast(value, panel);
      assert.ok(ratio >= 4.5,
        `${where}: ${token} (${value}) on ${panel} is ${ratio.toFixed(2)}:1 — below 4.5:1`);
    }
  }
});

test('§3 · the ink scale is three greys that are actually three steps apart', () => {
  /* A hierarchy whose middle value is one hex digit from its neighbour is not a
     hierarchy. Each step must be visibly lighter than the one above it. */
  for (const light of [false, true]) {
    const where = light ? 'light' : 'dark';
    const text = contrast(resolve('.mx-market', '--mx-text', { light }).value, resolve('.mx-market', '--mx-panel', { light }).value);
    const muted = contrast(resolve('.mx-market', '--mx-muted', { light }).value, resolve('.mx-market', '--mx-panel', { light }).value);
    const faint = contrast(resolve('.mx-market', '--mx-faint', { light }).value, resolve('.mx-market', '--mx-panel', { light }).value);
    assert.ok(text > muted && muted > faint,
      `${where}: text ${text.toFixed(1)} > muted ${muted.toFixed(1)} > faint ${faint.toFixed(1)} must hold`);
    /* Faint is still text (row ranks, captions), so it may not fall below 3:1. */
    assert.ok(faint >= 3, `${where}: faint is ${faint.toFixed(2)}:1 — below the 3:1 floor for incidental text`);
  }
});

test('§3 · the light theme stops being white-on-grey', () => {
  /*
   * Pure white panels on a cool #e2e8f0 stage is the highest-contrast pairing
   * available, which is why every hairline and every tile frame in the light
   * theme read as a bright edge — the white bars were the loudest symptom, the
   * theme itself was the cause. The panels are now warm paper.
   */
  const panel = resolve('.mx-market', '--mx-panel', { light: true }).value;
  assert.notEqual(panel.toLowerCase(), '#ffffff', 'no pure-white panels in the light theme');
  /* Warm: red channel is at least as high as blue. */
  const [r, , b] = [1, 3, 5].map((i) => parseInt(panel.slice(i, i + 2), 16));
  assert.ok(r >= b, `${panel} must be warm paper, not a cool white`);
});

/* ══ BUDGET ═══════════════════════════════════════════════════════════════ */

test('the refine pass spends nothing at runtime', () => {
  const css = strip(sheet());
  for (const [re, name] of [
    [/@keyframes/, 'keyframes'],
    [/\banimation\s*:/, 'animation'],
    [/backdrop-filter/, 'backdrop-filter'],
    [/\bmask(-image)?\s*:/, 'mask'],
    /*
     * NOT filter: itself — filter: brightness() is the hover ring, and it is
     * the one form this sheet allows. A blanket ban here would be the test
     * lying about the design; the allowance is asserted in the next block,
     * where every filter in the file must be exactly brightness(n).
     */
    [/will-change/, 'will-change'],
    [/content-visibility/, 'content-visibility'],
    [/url\(/, 'url()']
  ]) {
    assert.equal(re.test(css), false, `${name} is banned in this sheet`);
  }

  /* Defensively: narrow rather than blanket. filter: is allowed ONLY in the
     brightness(n) form, and every occurrence must be exactly that — so a
     blurred or dropped-shadow filter cannot slip in behind the allowance. */
  const filters = [...css.matchAll(/(^|[^-;{])\s*filter\s*:\s*([^;]+);/gm)].map((m) => m[2].trim());
  assert.ok(filters.length > 0, 'the hover ring is expected to use brightness()');
  for (const value of filters) {
    assert.match(value, /^brightness\([\d.]+\)$/, `unexpected filter: ${value}`);
  }
});

test('the refine pass is imported once, after every design layer and before the budget', () => {
  const occurrences = [...readFileSync('src/pages/Market.jsx', 'utf8')
    .matchAll(/^import '\.\.\/styles\/market-refine\.css';$/gm)].length;
  assert.equal(occurrences, 1);

  const i = IMPORT_ORDER.indexOf('market-refine.css');
  assert.ok(i > IMPORT_ORDER.indexOf('market-surface.css'), 'a token re-grade must win the scale');
  assert.ok(i > IMPORT_ORDER.indexOf('market-benchmark.css'), 'and the benchmark pass');
  assert.ok(i < IMPORT_ORDER.indexOf('market-perf.css'), 'and still lose to the stop policy');
});
