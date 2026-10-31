#!/usr/bin/env node
/**
 * BUY / SELL — «اسپکتروم» SKIN — 2026-11-01
 * ---------------------------------------------------------------------------
 * The owner asked for a colour scheme that is «خیلی خاص و چشم‌نواز» rather than
 * merely tidier. A palette is easy to break without noticing: one hard-coded
 * navy value in an earlier layer, a direction pair that stops distinguishing
 * buy from sell, or a gradient title that becomes invisible on paper.
 *
 * This probe pins the four things that make the skin a SYSTEM instead of a
 * pile of gradients:
 *
 *   1. it is the LAST stylesheet the page loads (a later layer's navy would
 *      win the cascade and silently undo the palette);
 *   2. the four spectral inks exist as tokens and the direction pairs are
 *      assigned from them, so buy and sell can never converge on one colour;
 *   3. the light theme is a deliberate pair (dark ink, visible title), not an
 *      inversion;
 *   4. the skin adds no animation and no backdrop-filter — the page's motion
 *      budget is what keeps it usable on a mid-range Android.
 *
 * Runs with plain Node: no DOM, no network.
 * Run: node test/buy-sell-spectrum-probe.mjs
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);
const t = (name, cond) => (cond ? ok(name) : fail(name));

const buyPage = strip(read('../src/pages/Buy.jsx'));
const css = strip(read('../src/styles/buy-sell-spectrum.css'));
const modern = strip(read('../src/styles/buy-sell-modern.css'));

/* ── 1 · load order ─────────────────────────────────────────────────────── */
const imports = [...buyPage.matchAll(/import '\.\.\/styles\/([a-z-]+\.css)'/g)].map((m) => m[1]);
t('the spectrum skin is the last stylesheet the page imports',
  imports[imports.length - 1] === 'buy-sell-spectrum.css');
t('it still loads after the Prism Desk layer it re-skins',
  imports.indexOf('buy-sell-spectrum.css') > imports.indexOf('buy-sell-modern.css'));

/* ── 2 · the palette is a system, not a pile of values ──────────────────── */
t('the four spectral inks exist as tokens', 
  ['--bsx-mint', '--bsx-sky', '--bsx-rose', '--bsx-violet'].every((v) => new RegExp(`${v}:\\s*#[0-9a-f]{6}`, 'i').test(css)));

t('buy and sell are assigned DIFFERENT pairs from those inks',
  /\.buy-sell-panel \{[\s\S]{0,220}--bsw-accent: var\(--bsx-mint\);[\s\S]{0,120}--bsw-accent-2: var\(--bsx-sky\)/.test(css)
  && /\.buy-sell-panel\.is-sell \{[\s\S]{0,220}--bsw-accent: var\(--bsx-rose\);[\s\S]{0,120}--bsw-accent-2: var\(--bsx-violet\)/.test(css));

t('the surface tokens stop being navy (violet-black instead)',
  /--bsd-surface: #131229/.test(css) && /--bsd-surface-deep: #0b0a18/.test(css));

t('the hero carries a masked spectrum rim and a multi-ink sheen',
  /\.buy-sell-hero::after \{[\s\S]{0,900}mask-composite: exclude/.test(css)
  && /\.buy-sell-hero-sheen \{[\s\S]{0,320}var\(--bsx-mint\)/.test(css)
  && /\[dir='rtl'\] \.buy-sell-page \.buy-sell-hero::after/.test(css));

t('the title is made of light (gradient text) and stays readable',
  /\.buy-sell-hero-title \{[\s\S]{0,320}-webkit-text-fill-color: transparent/.test(css));

/* ── 3 · paper theme is a pair ──────────────────────────────────────────── */
const lightStart = css.indexOf(":root[data-theme='light'] .buy-sell-page {");
t('the paper theme redefines the surfaces', lightStart > 0 && /--bsd-surface: #fff/.test(css.slice(lightStart, lightStart + 400)));
t('the paper title is a DARK gradient, not the dark theme\'s mint one',
  /:root\[data-theme='light'\] \.buy-sell-page \.buy-sell-hero-title \{[\s\S]{0,320}#04795f/.test(css));
t('the paper theme keeps both direction pairs distinct',
  /data-theme='light'\] \.buy-sell-page \.buy-sell-panel \{ --bsw-accent: #059c7a/.test(css)
  && /data-theme='light'\] \.buy-sell-page \.buy-sell-panel\.is-sell \{ --bsw-accent: #d81b60/.test(css));

/* ── 4 · the budget ────────────────────────────────────────────────────── */
t('the skin adds no animation of its own',
  !/@keyframes/.test(css) && !/animation:/.test(css));
t('the skin adds no backdrop-filter (the page deliberately has none)',
  !/backdrop-filter/.test(css));
t('hover lifts stand down under reduced motion',
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transform: none/.test(css));
t('the masked rim is dimmed on the packaged Android shell',
  /data-native='true'\] \.buy-sell-page \.buy-sell-hero::after/.test(css));
t('the Prism Desk layer it re-skins is not edited into a second palette',
  !/#131229/.test(modern) && !/--bsx-/.test(modern));

if (failures) {
  console.error(`\nBuy/Sell spectrum probe: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nBuy/Sell spectrum probe: all checks passed');
