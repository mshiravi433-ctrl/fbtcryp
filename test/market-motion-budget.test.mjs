import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/*
 * ─── THE MOTION BUDGET HAS TO BE COMPLETE, NOT JUST LONG ────────────────────
 *
 * `styles/market-perf.css` is the single answer to "what animation actually
 * runs on the market route". It neutralises loops behind
 * `:root[data-theme]:not([data-motion='full'])` — i.e. by default, for
 * everyone — and keeps the frame each loop stopped at.
 *
 * The failure mode this file guards is not a missing rule for a known loop. It
 * is that EVERY rule in that sheet is scoped `.mx-market …`, while
 * `MarketHeroBanner` mounts BESIDE the page rather than inside it. So seven
 * infinite animations (market-hero-banner.css:104,121,207,247,500,505,563) ran
 * on the market route with no entry in the budget at all, and nothing noticed,
 * because the sheet looked complete: it listed forty selectors.
 *
 * These tests count what each market sheet declares as `infinite`, and fail
 * with the names when one of them has no counterpart in market-perf.css. A new
 * loop cannot ship silently.
 */

const read = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const SHEETS = readdirSync('src/styles')
  .filter((f) => f.startsWith('market-') && f.endsWith('.css') && f !== 'market-perf.css')
  .map((f) => `src/styles/${f}`);

/**
 * Every selector a sheet declares an `infinite` animation on, as its list of
 * class tokens. A SELECTOR is the unit, not a class name: `.mx-smart-ring.is-2`
 * is a variant of an element the budget already stops via `.mx-smart-ring`, and
 * asking only "is the literal token `is-2` mentioned" produces false alarms.
 */
function loopsIn(file) {
  const css = read(file);
  const out = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css))) {
    const [, selector, body] = m;
    if (!/animation[^;]*infinite/.test(body)) continue;
    for (const one of selector.split(',')) {
      const classes = one.match(/\.[a-zA-Z0-9_-]+/g) ?? [];
      if (classes.length) out.push({ classes: classes.map((c) => c.slice(1)), selector: one.trim() });
    }
  }
  return out;
}

/**
 * Loops that are deliberately NOT stopped, each for a reason that is about
 * STATE rather than decoration — they only run while the reader is doing
 * something, and they stop when it stops. Every one of these is documented in
 * market-perf.css §2 and §8.
 */
const STATEFUL = new Set([
  'mx-icon-btn',            // [data-busy] spinner — only while a request runs
  'st-spin', 'st-spin-slow', // loading glyph
  'st-eq', 'market-story-radio-eq', // playback equaliser
  'is-live',                // story progress, only while a clip plays
]);

/** Dead CSS: declared, but no component renders the class any more. */
const DEAD = new Set([
  'market-glass-bloom',     // legacy glass field
  'market-hero-logo-halo',  // legacy hero card
  'market-hero-orbit', 'market-hero-orbit--rev',
  'market-signal-promo',    // the house ad this screen no longer mounts
  'ad-banner--premium',
]);

/**
 * Is this loop already stopped by its OWN sheet?
 *
 * Three sheets (`market-glass-v3`, `market-modern`, `market-request-fixes`)
 * carry their own `prefers-reduced-motion` / `[data-native]` guards that name
 * the loop. That is a legitimate home for the rule — it keeps the animation
 * and its off-switch together — and the budget does not need a second copy.
 * What it does need is to know the rule EXISTS, which is what this checks.
 */
function stoppedByOwnSheet(sheet, primary) {
  const css = read(sheet);
  /* Find rules that neutralise animations and mention this element. */
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/animation:\s*none/.test(body)) continue;
    if (!selector.includes(`.${primary}`)) continue;
    /* It only counts inside a guard — a preference, a platform, or the very
       same `:not([data-motion='full'])` opt-in the central budget uses (one
       sheet applies the budget's rule itself, which is why the guard is
       accepted wherever it is written). An unconditional `animation: none`
       next to the declaration would just be a dead loop. */
    if (/prefers-reduced-motion|data-native|data-lite|data-reduce-motion/.test(selector)) return true;
    if (/:root\[data-theme\]:not\(\[data-motion='full'\]\)/.test(selector)) return true;
  }
  return false;
}

test('every infinite animation is stopped by the budget OR by its own sheet', () => {
  const budget = read('src/styles/market-perf.css');
  const uncovered = [];
  for (const sheet of SHEETS) {
    for (const { classes, selector } of loopsIn(sheet)) {
      if (classes.some((c) => STATEFUL.has(c) || DEAD.has(c))) continue;
      /*
       * Covered if the budget names the ELEMENT — i.e. its first class token
       * after any `.mx-market` scope — or the exact selector. `.mx-smart-ring.
       * is-2` is covered by a rule for `.mx-smart-ring`; that is the same
       * element being stopped, and demanding the variant token would be
       * demanding a redundant rule.
       */
      const primary = classes.filter((c) => c !== 'mx-market' && c !== 'mhb')[0] ?? classes[0];
      const covered = budget.includes(`.${primary}`) || stoppedByOwnSheet(sheet, primary);
      if (!covered) uncovered.push(`${primary} — \`${selector}\` (${sheet})`);
    }
  }
  assert.deepEqual(uncovered, [],
    `loops with no entry in market-perf.css:\n  ${uncovered.join('\n  ')}`);
});

test('the exceptions are real: stateful loops are conditional, dead ones unrendered', () => {
  /* An exception list is only honest if it can be checked. A stateful loop must
     be conditional on something — a data attribute, a state class, or a
     sibling media query — and a dead class must genuinely not be rendered. */
  const modern = read('src/styles/market-modern.css');
  const intel = read('src/styles/market-intelligence.css');
  assert.match(intel, /\.mx-icon-btn\[data-busy='true'\]/,
    'the spinner must be conditional on [data-busy]');
  /* The equaliser only animates under `.is-live`, on a clip actually playing. */
  assert.match(modern, /\.market-story-radio-eq\.is-live i\s*\{[^}]*animation:/,
    'the equaliser must be conditional on the playing state');
  /* The loading glyph is the story progress, which only mounts mid-fetch. */
  assert.match(modern, /\.st-spin[^{]*\{[^}]*animation:/,
    'st-spin must still be the loading glyph');

  const components = readdirSync('src/components', { recursive: true })
    .filter((f) => String(f).endsWith('.jsx'))
    .map((f) => readFileSync(`src/components/${f}`, 'utf8'))
    .join('\n');
  for (const dead of ['market-glass-bloom', 'market-hero-orbit']) {
    assert.equal(components.includes(dead), false,
      `${dead} is on the DEAD list but is still rendered — budget it instead`);
  }
});

test('the hero banner is covered, because it mounts outside .mx-market', () => {
  /* The specific regression: the banner's rules are scoped `.mhb`, not
     `.mx-market .…`, so the sheet's own scoping made them invisible. */
  const budget = read('src/styles/market-perf.css');
  for (const cls of ['mhb-rim', 'mhb-aurora', 'mhb-sheen', 'mhb-kicker-gem',
    'mhb-hud-ring--outer', 'mhb-hud-orbit', 'mhb-art']) {
    assert.ok(budget.includes(`.${cls}`), `market-perf.css must name .${cls}`);
  }
  /* And the neutralising rules must be scoped to the banner, not to .mx-market,
     which would leave them dead. */
  /* Scoped to `.mhb` in the SELECTOR, not merely mentioned in a comment: a
     rule written `.mx-market .mhb-rim` would be dead, because the banner is not
     a descendant of the page. */
  const heroRules = [...budget.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) => sel.includes('.mhb'))
    .filter(([, , body]) => /animation:\s*none/.test(body));
  assert.ok(heroRules.length >= 5, `expected the hero rules, found ${heroRules.length}`);
  for (const [, sel] of heroRules) {
    assert.match(sel, /:root\[data-theme\]:not\(\[data-motion='full'\]\)/,
      `hero rule must be guarded: ${sel.trim()}`);
    assert.equal(sel.includes('.mx-market'), false,
      `hero rule must not be scoped under .mx-market: ${sel.trim()}`);
  }
});

test('the budget leaves an escape hatch, and it is off by default', () => {
  const budget = read('src/styles/market-perf.css');
  /* Every rule is guarded by `:not([data-motion='full'])`: full motion is
     something a reader opts INTO. */
  const guards = budget.match(/:root\[data-theme\]:not\(\[data-motion='full'\]\)/g) ?? [];
  assert.ok(guards.length > 20, `expected the guard on every rule, found ${guards.length}`);
  /* No un-guarded BLOCK that sets `animation: none`: that would freeze the app
     for someone who asked for full motion. Declarations sit on their own
     lines, so this has to be asserted on the selector, not on a line of CSS. */
  const unguarded = [...budget.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /animation:\s*none/.test(body))
    .map(([, sel]) => sel.trim())
    .filter((sel) => !sel.includes(":not([data-motion='full'])"));
  assert.deepEqual(unguarded, [],
    `animation:none outside a data-motion guard: ${unguarded.join(' | ')}`);
});

test('the hero banner keeps its scene crossfade, which is the reading', () => {
  /* Stopping LOOPS is the budget. The opacity transition between scenes tells
     the reader which of three panels they are on — removing it would be a
     different change, and not a performance one. */
  const hero = read('src/styles/market-hero-banner.css');
  assert.match(hero, /\.mhb-art[^}]*transition/,
    'the scene crossfade must survive the motion budget');
  const budget = read('src/styles/market-perf.css');
  assert.equal(/\.mhb-art[^{]*\{[^}]*transition:\s*none/.test(budget), false,
    'the budget must not remove the hero scene crossfade');
});

test('the budget still neutralises the loops it already owned', () => {
  /* A regression guard on the sheet itself: these are the entries the earlier
     passes added, and deleting one should not be silent. */
  const budget = read('src/styles/market-perf.css');
  for (const cls of ['mx-deck-rim', 'mx-deck-orbit', 'mx-deck-gloss',
    'mx-smart-sheen', 'mx-route-traveller', 'mx-spark-live',
    'mx-aurora-echo', 'st-bloom', 'market-fresh']) {
    assert.ok(budget.includes(`.${cls}`), `the budget lost .${cls}`);
  }
});

/*
 * ─── THE BLUR BUDGET ───────────────────────────────────────────────────────
 *
 * §15.6 of market-modern.css removed seven `backdrop-filter`s from this route
 * with a stated reason: every one of those surfaces paints a 93–95% opaque
 * gradient, so an opaque plate looks the same and costs nothing, while a
 * blurred layer over a permanently animating fixed background is re-sampled
 * on every scroll frame.
 *
 * A written policy with no test is a policy that the next edit silently
 * reverses — so this counts the surfaces that STILL have a live blur, and
 * fails if one appears that the budget has not named.
 */

/**
 * Surfaces that live inside the STORY MODAL. The modal is not mounted until a
 * story is tapped (`market-perf.css` §2 says the same for its ten loops), so a
 * blur in there costs nothing while the reader is scrolling the list — and the
 * backdrop blur is what separates a full-screen reader from the page under it.
 * Exempt, named, and checked below so the list cannot quietly grow.
 */
const MODAL_SURFACES = new Set([
  'market-story-backdrop',
  'market-story-promo-flag',
  'market-story-dialog',
  'market-story-chip',
  'market-story-ring',
]);

test('no live backdrop-filter survives on the market route without a decision', () => {
  const budget = read('src/styles/market-perf.css');

  /*
   * A class is OFF if any sheet declares `backdrop-filter: none !important` for
   * it. `!important` beats source order, so a later `blur()` in the cascade can
   * never win against it — which is exactly how §15.6 removed the seven cards
   * while leaving their earlier `blur(26px)` declarations in place.
   */
  const killed = new Set();
  for (const file of [...SHEETS, 'src/styles/market-perf.css']) {
    for (const [, selector, body] of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/-?webkit-?backdrop-filter:\s*none\s*!important/.test(body)) continue;
      for (const cls of (selector.match(/\.[a-zA-Z0-9_-]+/g) ?? [])) killed.add(cls.slice(1));
    }
  }

  const survivors = [];
  for (const sheet of SHEETS) {
    const css = read(sheet);
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      /* The LAST declaration in the block is the one the browser applies, so
         a rule that sets a blur and then `none` (the removal passes do exactly
         that) is a removal, not a live blur. */
      const declarations = [...body.matchAll(/-?webkit-?backdrop-filter:\s*([^;]+);/g)]
        .map((m) => m[1].trim());
      const last = declarations[declarations.length - 1];
      if (!last || !/^blur/.test(last)) continue;
      const classes = (selector.match(/\.[a-zA-Z0-9_-]+/g) ?? []).map((c) => c.slice(1));
      if (!classes.length) continue;
      if (classes.some((c) => MODAL_SURFACES.has(c))) continue;
      survivors.push({ selector: selector.trim(), classes, sheet });
    }
  }
  /* Every surviving declaration must be answered by a rule in the budget — by
     the exact selector it applies to, not by a neighbouring class. */
  const unaddressed = survivors.filter(({ classes }) =>
    !classes.some((c) => killed.has(c) || budget.includes(`.${c}`)));
  assert.deepEqual(unaddressed.map((s) => `${s.selector} (${s.sheet})`), [],
    'a live backdrop-filter on the market route must be either removed or named in market-perf.css');
});

test('the story modal is the only exemption, and its blurs are all in there', () => {
  /* An exemption is only honest if it is bounded: every exempt class must be
     rendered by the stories component (i.e. genuinely inside the modal), and
     none of them may appear on the list itself. */
  const stories = readFileSync('src/components/MarketStories.jsx', 'utf8');
  const page = readFileSync('src/pages/Market.jsx', 'utf8');
  for (const cls of MODAL_SURFACES) {
    assert.ok(stories.includes(cls), `${cls} is exempt as a modal surface but is not in MarketStories`);
    assert.equal(page.includes(cls), false, `${cls} must not be rendered on the list surface`);
  }
});

test('the search field is the surface that was missed, and it is now covered', () => {
  const budget = read('src/styles/market-perf.css');
  /* The field sits inside the list card, above the rows, and scrolls with
     them — the worst place for a per-frame blur and the reason §15.6's
     argument applies with more force here than to the cards it listed. */
  assert.ok(budget.includes('.market-search'),
    'the search field carries a live 12px blur and must be in the budget');
  assert.match(
    budget,
    /:root\[data-theme\]:not\(\[data-motion='full'\]\) \.mx-market \.market-search\s*\{[^}]*backdrop-filter:\s*none/,
    'and the rule must actually turn it off, guarded like the rest'
  );
  /* The visual identity survives: the field keeps its own gradient plate. */
  const modern = read('src/styles/market-modern.css');
  assert.match(modern, /\.market-search\s*\{[^}]*linear-gradient/,
    'the field must still paint its own opaque plate, or removing the blur is a visual change');
});
