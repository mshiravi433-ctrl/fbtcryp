/**
 * MARKET · THE STUDIO PASS — regression pins (2026-11-26)
 * ---------------------------------------------------------------------------
 * Requested: «بهترین و مدرن ترین ui,ux را برای صفحه بازار هر دو تب مرور و
 * توKEN بازطراحی کن». This pass is CSS-only, so the pins are structural:
 * the last sheet must fold the competing accents onto the route palette, must
 * lay out the overview on a wide screen without touching the DOM order, and
 * must not put the measured scroll budget back on the page.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const PAGE = 'src/pages/Market.jsx';
const SHEET = 'src/styles/market-studio.css';
const css = readFileSync(SHEET, 'utf8');
const page = readFileSync(PAGE, 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const root = postcss.parse(bare);

test('the sheet is imported once, as the last design layer in this route', () => {
  const hits = [...page.matchAll(/^import '\.\.\/styles\/market-studio\.css';$/gm)];
  assert.equal(hits.length, 1, 'one import, one design authority');
  const imports = [...page.matchAll(/^import '\.\.\/styles\/([\w-]+\.css)';$/gm)].map((m) => m[1]);
  assert.equal(imports.at(-1), 'market-studio.css', 'the studio pass must win the cascade');
  for (const sheet of ['market-tabs.css', 'market-refine.css', 'market-token-2026.css']) {
    assert.ok(imports.indexOf(sheet) < imports.indexOf('market-studio.css'),
      `${sheet} must be below the studio pass`);
  }
  for (const file of ['src/main.jsx', 'src/App.jsx']) {
    assert.ok(!readFileSync(file, 'utf8').includes('market-studio.css'),
      'no other route pays for this sheet');
  }
});

test('the four token-tab accents are folded onto the route palette in BOTH themes', () => {
  const blocks = [];
  root.walkRules((rule) => {
    if (!rule.selector.includes('.mx-tab-panel')) return;
    const props = new Map();
    rule.walkDecls((d) => props.set(d.prop, d.value.trim()));
    if (props.has('--m26-a')) blocks.push({ selector: rule.selector, props });
  });
  assert.equal(blocks.length, 2, 'a plain block and a light-theme block with the same specificity');
  assert.ok(blocks.some((b) => b.selector.startsWith(':root[data-theme=\'light\']')),
    'the light theme must be re-graded with the same selector the light token sheet uses');
  for (const { props } of blocks) {
    assert.equal(props.get('--m26-a'), 'var(--mx-cyan)');
    assert.equal(props.get('--m26-b'), 'var(--mx-violet)');
    assert.equal(props.get('--m26-c'), 'var(--mx-cyan)');
    assert.equal(props.get('--m26-d'), 'var(--mx-gold)');
    assert.equal(props.get('--m26-ink'), 'var(--mx-text)');
    assert.equal(props.get('--m26-muted'), 'var(--mx-muted)');
  }
});

test('the overview bento is desktop-only and scoped to the OPEN panel', () => {
  const blocks = [];
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent?.type !== 'atrule' || parent.name !== 'media') return;
    if (!/#market-panel-overview:not\(\[hidden\]\)/.test(rule.selector)) return;
    blocks.push({ media: parent.params, selector: rule.selector });
  });
  assert.ok(blocks.length >= 2, 'the grid and its cell placement must both be present');
  for (const { media, selector } of blocks) {
    assert.match(media, /min-width:\s*1080px/);
    assert.match(selector, /#market-panel-overview:not\(\[hidden\]\)/,
      'a hidden panel must keep the display:none rule that keeps it out of the a11y tree');
  }
  assert.ok(!bare.includes('#market-panel-tokens'),
    'the tokens tab keeps its own single-column reading order');
});

test('the shared surfaces come from the surface scale, not a new palette', () => {
  for (const token of ['--mx-r-section', '--mx-r-hero', '--mx-pad-hero',
    '--mx-glass', '--mx-panel', '--mx-line', '--mx-hi']) {
    assert.ok(bare.includes(`var(${token})`), `${token} must drive the studio surfaces`);
  }
  assert.match(bare, /backdrop-filter:\s*none\s*!important/);
  assert.match(bare, /-webkit-backdrop-filter:\s*none\s*!important/);
});

test('the sheet adds no motion, blur, mask or filter to a measured route', () => {
  assert.ok(!/@keyframes/.test(bare), 'no new animation loop');
  assert.ok(!/animation\s*:/.test(bare), 'no new animation');
  assert.ok(!/will-change/.test(bare), 'no pinned GPU layer');
  assert.ok(!/mask(-image)?\s*:/.test(bare), 'no offscreen buffer');
  const filters = [...bare.matchAll(/(?:^|[^-;{])\s*filter\s*:\s*([^;]+);/gm)];
  assert.deepEqual(filters, [], 'no filter — the heatmap already owns the only brightness() ring');
});

test('phone, reduced motion, higher contrast and less transparency are all handled', () => {
  for (const query of [
    '@media (max-width: 1079px)',
    '@media (max-width: 620px)',
    '@media (prefers-reduced-motion: reduce)',
    '@media (prefers-contrast: more)',
    '@media (prefers-reduced-transparency: reduce)'
  ]) {
    assert.ok(bare.includes(query), `${query} must be present`);
  }
  assert.match(bare, /\.mx-market \.mx26-dock \{ grid-template-columns: 1fr; \}/,
    'a phone gives every filter field its own full-width row');
  assert.match(bare, /background: var\(--mx-panel\) !important/,
    'less transparency means a solid panel, not a translucent one');
});

test('the sticky column header and the motion stop policy are untouched', () => {
  /* Two earlier tests resolve these exact selectors across the import order.
     A new declaration on either one would silently change what they measure. */
  assert.ok(!bare.includes('.mx-colhead'), 'the sticky header stays with the benchmark pass');
  assert.ok(!/\.mx-market\s*\{[^}]*isolation\s*:/.test(bare),
    'the strip stacking context stays with the refine pass');
  assert.ok(!/--mx-(blue|gold|panel|cyan|violet|up|down|text|muted|faint)\s*:/.test(bare),
    'the route palette stays with the refine pass');
});
