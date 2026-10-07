import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const marketJsx = readFileSync(new URL('../src/pages/Market.jsx', import.meta.url), 'utf8');
const intentCss = readFileSync(new URL('../src/styles/trench-agent.css', import.meta.url), 'utf8');

console.log('── tablet and desktop responsive layout ───────────────────────────');

// The established phone dimensions are an explicit baseline, not a side
// effect of the new wider breakpoints.
assert.match(appCss, /\.app-shell\s*\{[^}]*max-width:\s*520px/s,
  'the mobile app shell remains capped at 520px');
assert.match(appCss, /\.page\s*\{\s*padding:\s*12px 16px 24px;/,
  'the mobile page gutters remain unchanged');

assert.match(appCss, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*899px\)[\s\S]*?\.app-shell,[\s\S]*?max-width:\s*820px;/,
  'tablet shells can use up to 820px');
assert.match(appCss, /@media\s*\(min-width:\s*900px\)[\s\S]*?\.app-shell\s*\{\s*max-width:\s*min\(1280px,\s*calc\(100%\s*-\s*48px\)\);/,
  'desktop shells scale up with a fluid outer gutter');
assert.match(appCss, /\.top-bar\s*\{\s*width:\s*100%;\s*max-width:\s*min\(1280px,\s*calc\(100%\s*-\s*48px\)\);/,
  'the centred desktop header still stretches to align with the app shell');
assert.match(appCss, /\.top-bar\s*\{\s*width:\s*100%;\s*\}/,
  'tablet header margins do not make the bar shrink-wrap its content');

assert.match(marketJsx, /className=\{`market-overview\$\{hero\s*\?/,
  'the Market overview groups global stats and the lead coin for responsive placement');
assert.match(appCss, /\.market-overview\.has-hero\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.28fr\)\s+minmax\(320px,\s*\.9fr\)/,
  'desktop Market overview uses a bounded two-column dashboard');
assert.match(appCss, /\.market-coin-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  'desktop Market coin rows use two shrink-safe columns');

assert.match(intentCss, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*899px\)[\s\S]*?\.iaos-page\.tag-page \.iaos-shell\s*\{\s*width:\s*min\(760px,/,
  'Intent OS has a tablet-width chat shell');
assert.match(intentCss, /@media\s*\(min-width:\s*900px\)[\s\S]*?\.iaos-page\.tag-page \.iaos-shell\s*\{\s*width:\s*min\(1160px,/,
  'Intent OS can use a wider desktop conversation column');

console.log('  ✓ mobile dimensions preserved; tablet and desktop layouts expand');
