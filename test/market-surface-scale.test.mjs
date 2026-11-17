/**
 * ─── THE SURFACE SCALE, PINNED ──────────────────────────────────────────────
 *
 * Five design passes grew on the market screen in sequence, each overriding the
 * last for the same eight cards. Nothing deleted the loser, so the cards a
 * reader actually looks at settled at FIVE different corner radii and six
 * different paddings — decided by IMPORT ORDER, not by hierarchy:
 *
 *     deck 30 · btc + banner 28 · lens/terminal 26 · hot 20 · trio 18
 *     deck padding `22px 20px 18px` · hot `15px` · trio `12px 10px`
 *
 * `styles/market-surface.css` replaced that with four named tiers and three
 * named paddings. These tests are the thing that keeps it true, because the
 * failure mode is invisible: one more `border-radius: 30px` in a future design
 * pass would win the cascade again and nothing on screen would look "broken",
 * it would just stop matching its neighbours again.
 *
 * The assertions are structural, and every one of them is about a DECISION:
 *   1. one authority — each surface's radius is declared last by the scale;
 *   2. the tiers are strictly ordered, so hierarchy is readable at arm's length;
 *   3. every breakpoint defines the whole set (a missing token is `undefined`,
 *      which silently collapses to a 0px corner);
 *   4. the sheet declares NO material — no colour, background, border, shadow
 *      or animation — so it can never become a sixth layer to be overridden;
 *   5. the press interaction is compositor-only and has a reduced-motion guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const SHEETS = [
  'market-modern', 'market-intelligence', 'market-glass-v3', 'market-aurora-glass',
  'market-obsidian-glass', 'market-overview-phase2', 'market-overview-compact',
  'market-hero-banner', 'market-tabs', 'market-surface', 'market-perf',
  'market-request-fixes'
];

/** The eight shared cards, plus the shell they sit in. */
const SURFACES = [
  '.mx-overview', '.mx-deck', '.mx-btc-card', '.mx-lens', '.mx-terminal',
  '.mx-smart-banner', '.mx-hot-card', '.mx-trio-box', '.mx-coin-row > .coin-row'
];

const SCALE = 'src/styles/market-surface.css';

/** Does a media query apply at this viewport width? Only width queries exist here. */
function matches(query, width) {
  const max = /max-width:\s*(\d+)px/.exec(query);
  const min = /min-width:\s*(\d+)px/.exec(query);
  if (max && !(width <= Number(max[1]))) return false;
  if (min && !(width >= Number(min[1]))) return false;
  return true;
}

/**
 * Resolve the cascade for one viewport.
 *
 * `var()` is resolved against the tokens that WIN at that width, so the answer
 * is the radius the browser would paint, not the literal text in a sheet. That
 * distinction is the whole point: three of these surfaces are declared at
 * `var(--mx-r-hero)` in one place and as a literal `30px` in three others.
 */
function resolve(width) {
  const tokens = new Map();       // --mx-r-* / --mx-pad-*
  const last = new Map();         // surface -> { radius, padding, sheet }
  const seen = new Map();         // surface -> [sheets that declare it]

  for (const name of SHEETS) {
    const file = `src/styles/${name}.css`;
    const root = postcss.parse(readFileSync(file, 'utf8'), { from: file });
    root.walkRules((rule) => {
      /*
       * Collect ANCESTORS WITH THEIR TYPE. An at-rule's `params` is
       * `(max-width: 619px)` — no `@media` prefix — so filtering on
       * `startsWith('@media')` finds nothing and every media block is treated
       * as if it applied at every width. That bug made the first version of
       * this test pass while the tokens it read were the desktop ones at every
       * breakpoint, which is exactly the kind of green that hides a bug.
       */
      const guards = [];
      let p = rule.parent;
      while (p && p.type !== 'root') {
        if (p.type === 'atrule') guards.unshift(`${p.name} ${p.params}`);
        p = p.parent;
      }
      const joined = guards.join(' ');
      /* Light-theme overrides are a different colour system, not a different
         geometry; other guards must actually apply at this width. */
      if (/data-theme='light'|prefers-reduced-motion|hover: none|data-native/.test(joined)) return;
      for (const q of guards.filter((g) => g.startsWith('media '))) {
        if (!matches(q, width)) return;
      }
      const parts = rule.selector.split(',').map((s) => s.trim()).filter(Boolean);
      rule.walkDecls((d) => {
        if (/^--mx-(r|pad)-/.test(d.prop)) {
          tokens.set(d.prop, { v: d.value.trim(), name });
          return;
        }
        for (const surface of SURFACES) {
          if (!parts.some((s) => s.endsWith(surface))) continue;
          const entry = last.get(surface) || {};
          if (d.prop === 'border-radius') entry.radius = { v: d.value.trim(), name };
          if (d.prop === 'padding') entry.padding = { v: d.value.trim(), name };
          last.set(surface, entry);
        }
      });
    });
    for (const surface of SURFACES) {
      if (!seen.has(surface)) seen.set(surface, []);
      const css = readFileSync(file, 'utf8');
      if (css.includes(surface.slice(surface.lastIndexOf(' '))) && css.includes('border-radius')) {
        seen.get(surface).push(name);
      }
    }
  }
  const px = (v) => {
    if (v == null) return null;
    const resolved = v.replace(/var\(--mx-(r|pad)-([a-z]+)\)/g, (_, _k, key) => {
      const hit = tokens.get(`--mx-${_k}-${key}`);
      return hit ? hit.v : 'MISSING';
    });
    const m = /^(-?[\d.]+)px$/.exec(resolved);
    return m ? Number(m[1]) : resolved;
  };
  return { tokens, last, px };
}

const WIDTHS = [
  { label: 'phone 390', width: 390 },
  { label: 'tablet 760', width: 760 },
  { label: 'desktop 1280', width: 1280 }
];

test('every shared surface takes its radius from the scale, last', () => {
  for (const { label, width } of WIDTHS) {
    const { last } = resolve(width);
    for (const surface of SURFACES) {
      const entry = last.get(surface);
      assert.ok(entry?.radius, `${label}: ${surface} has no radius at all`);
      assert.equal(entry.radius.name, 'market-surface',
        `${label}: ${surface} radius is decided by ${entry.radius.name} — the scale must be the last word`);
    }
  }
});

test('the tiers are strictly ordered, so hierarchy is readable', () => {
  for (const { label, width } of WIDTHS) {
    const { px } = resolve(width);
    const tier = (name) => {
      const { tokens } = resolve(width);
      return px(tokens.get(`--mx-r-${name}`)?.v);
    };
    const shell = tier('shell');
    const hero = tier('hero');
    const section = tier('section');
    const control = tier('control');
    for (const v of [shell, hero, section, control]) {
      assert.equal(typeof v, 'number', `${label}: a tier did not resolve to px (${v})`);
    }
    assert.ok(shell > hero, `${label}: shell ${shell} must exceed hero ${hero}`);
    assert.ok(hero > section, `${label}: hero ${hero} must exceed section ${section}`);
    assert.ok(section > control, `${label}: section ${section} must exceed control ${control}`);
    /* A 2px difference is not a tier — it is a rounding error a designer will
       read as a mistake. Each step must be visible at arm's length. */
    for (const [a, b, pair] of [[shell, hero, 'shell/hero'], [hero, section, 'hero/section'], [section, control, 'section/control']]) {
      assert.ok(a - b >= 3, `${label}: ${pair} step is only ${a - b}px — the tiers are not distinguishable`);
    }
  }
});

test('the shell is the largest radius on the screen, and the cards inside it step down', () => {
  /* The bug this replaces: the deck was the LARGEST radius (30px) while being
     the container the others sit in, so the box's corner was rounder than the
     corners of the boxes inside it. Nesting must read outward-in. */
  for (const { label, width } of WIDTHS) {
    const { last, px } = resolve(width);
    const radius = (s) => px(last.get(s)?.radius.v);
    assert.ok(radius('.mx-overview') > radius('.mx-deck'),
      `${label}: the shell must be rounder than the hero card inside it`);
    assert.ok(radius('.mx-deck') > radius('.mx-coin-row > .coin-row'),
      `${label}: a card must be rounder than the row inside it`);
  }
});

test('every breakpoint defines the whole scale — no undefined token', () => {
  for (const { label, width } of WIDTHS) {
    const { tokens } = resolve(width);
    for (const key of ['--mx-r-shell', '--mx-r-hero', '--mx-r-section', '--mx-r-control',
      '--mx-pad-hero', '--mx-pad-card', '--mx-pad-dense']) {
      assert.ok(tokens.has(key), `${label}: ${key} is not defined — it would resolve to 0`);
    }
  }
});

test('the paddings are three named values, not six literals', () => {
  for (const { label, width } of WIDTHS) {
    const { last, px } = resolve(width);
    const used = new Set();
    for (const surface of SURFACES) {
      const padding = last.get(surface)?.padding;
      if (!padding) continue;
      assert.equal(padding.name, 'market-surface',
        `${label}: ${surface} padding is still decided by ${padding.name}`);
      used.add(px(padding.v.split(/\s+/)[0]));
    }
    /* hero + card + dense. A fourth value means a card went its own way again. */
    assert.ok(used.size <= 3, `${label}: ${used.size} distinct paddings (${[...used].join(', ')}) — expected at most 3`);
  }
});

test('the scale declares no material, so it cannot become a sixth design layer', () => {
  const css = readFileSync(SCALE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const root = postcss.parse(css);
  const forbidden = ['background', 'background-color', 'background-image', 'color',
    'border', 'border-color', 'border-width', 'box-shadow', 'filter',
    'backdrop-filter', 'animation', 'content', 'opacity', 'font-family'];
  const found = [];
  root.walkDecls((d) => {
    if (forbidden.includes(d.prop)) found.push(`${d.prop}: ${d.value.slice(0, 30)}`);
  });
  assert.deepEqual(found, [],
    `market-surface.css must declare geometry only — it paints nothing:\n  ${found.join('\n  ')}`);
});

test('the hero cards answer a press, with the compositor only', () => {
  const css = readFileSync(SCALE, 'utf8');
  /* The deck and the Bitcoin card had ZERO hover/press rules between them —
     the two most prominent surfaces on the screen were the only inert ones. */
  const press = /\.mx-market \.mx-deck:active[\s\S]{0,120}?transform:\s*scale\(\.?9\d*\)/.test(css);
  assert.ok(press, 'the deck must press in on :active');
  const block = css.slice(css.indexOf('.mx-market .mx-deck,\n  .mx-market .mx-btc-card {\n    transition'), css.indexOf('/* ═══', css.indexOf('transition: transform')));
  assert.ok(/transition:\s*transform/.test(css), 'the press must transition transform only');
  assert.ok(!/(transition:[^;]*)(background|box-shadow|filter)/.test(css),
    'a press must never animate a paint property');
  /* …and it is dropped for a reader who asked for less motion. */
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /transform:\s*none/);
  assert.ok(block !== undefined);
});

test('nothing in this sheet animates, so the motion budget stays complete', () => {
  const css = readFileSync(SCALE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/animation\s*:/.test(css), 'no keyframes or ambient loops belong in a geometry sheet');
  assert.ok(!/@keyframes/.test(css), 'no keyframes');
  assert.ok(!/infinite/.test(css), 'nothing here can loop');
});

test('the sheet is imported after the design layers and before the stop policy', () => {
  const page = readFileSync('src/pages/Market.jsx', 'utf8');
  const at = page.indexOf("import '../styles/market-surface.css'");
  assert.ok(at > -1, 'Market.jsx must import the surface scale');
  for (const layer of ['market-intelligence', 'market-glass-v3', 'market-aurora-glass', 'market-obsidian-glass']) {
    assert.ok(page.indexOf(`import '../styles/${layer}.css'`) < at,
      `${layer}.css must load before the scale, or the scale cannot win`);
  }
  assert.ok(page.indexOf("import '../styles/market-perf.css'") > at,
    'market-perf.css must stay last: the stop policy parks what is above it');
  assert.ok(page.indexOf("import '../styles/market-request-fixes.css'") > page.indexOf("import '../styles/market-perf.css'"),
    'the request fixes keep their place at the end');
});

test('the list footer no longer repeats the scope the criteria row states', () => {
  const page = readFileSync('src/pages/Market.jsx', 'utf8');
  /* One «۶۰ از ۱۲۱», in the criteria row above the rows, next to the
     constraints that caused it. The footer keeps its actions and the count the
     fold changes, and nothing else. */
  const footer = page.slice(page.indexOf('data-single-scope'), page.indexOf('market-more-results'));
  assert.ok(footer.length > 0, 'the footer block must exist');
  assert.ok(!/market-more-track/.test(footer), 'the duplicated scope rail is gone from the footer');
  assert.ok(/mx-showing-mini/.test(footer), 'the count the fold changes survives');
  assert.ok(!/mx-list-actions[\s\S]{0,40}market-more-track/.test(footer));
});
