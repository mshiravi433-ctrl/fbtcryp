#!/usr/bin/env node
/**
 * ONE-OFF: move the FBT AI Cinema Banner's stylesheet out of the market sheet.
 *
 * `src/components/FBTAICinemaBanner.jsx` imports no CSS of its own — its ~28 KB
 * of `.fbt-ai-*` / `.fox-*` rules (fifteen looping animations: blinking eyes,
 * twitching ears, orbiting rings) live in `market-modern.css`, which Market.jsx
 * imports. The component is not rendered by any screen, so the home route pays
 * for markup that never exists.
 *
 * This splits those rules into `src/styles/fbt-ai-cinema.css` and points the
 * component at it, which is how every other self-contained surface in this repo
 * ships (DecisionOrb → decision-orb.css, MoreSheet → more-menu.css).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseStatements, splitSelectors } from './css-diet.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SOURCE = 'src/styles/market-modern.css';
const TARGET = 'src/styles/fbt-ai-cinema.css';

const OWNED = /^(fbt|fox)-/;
/* State classes the banner wears that are not its own: `.fbt-ai-banner.is-entered`,
   `.is-touched`, `.fox-svg`. A selector is the banner's when it names one of the
   banner's classes and nothing that belongs to ANOTHER surface. */
const STATE = /^(?:is|has|was)-[\w-]+$/;

/** Every class a selector mentions, including inside :is()/:not(). */
const classesOf = (selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

function selectorIsOwned(selector) {
  const classes = classesOf(selector);
  return classes.some((c) => OWNED.test(c)) && classes.every((c) => OWNED.test(c) || STATE.test(c));
}

function keyframeIsOwned(prelude) {
  return OWNED.test(prelude.replace(/^@keyframes\s+/, '').trim());
}

const selectorsOf = (text) => {
  const open = text.indexOf('{');
  return splitSelectors((open === -1 ? text : text.slice(0, open)).trim());
};
const bodyOf = (text) => text.slice(text.indexOf('{'));

/**
 * Split a statement list into (owned, kept), recursing into @media/@supports
 * and splitting MIXED selector lists — a guard block that addresses the banner
 * and nine market surfaces at once keeps its nine, and the banner's own
 * selector travels.
 */
function splitList(statements) {
  const owned = [];
  const kept = [];
  for (const st of statements) {
    if (st.type === 'at' && st.name === 'keyframes') {
      (keyframeIsOwned(st.prelude) ? owned : kept).push(st);
      continue;
    }
    if (st.type === 'at' && st.body) {
      const inner = splitList(st.body);
      if (inner.owned.length) owned.push({ ...st, body: inner.owned, rebuilt: true });
      if (inner.kept.length) kept.push({ ...st, body: inner.kept, rebuilt: true });
      continue;
    }
    if (st.type === 'rule') {
      const selectors = selectorsOf(st.text);
      const mine = selectors.filter(selectorIsOwned);
      const rest = selectors.filter((s) => !selectorIsOwned(s));
      if (mine.length) owned.push({ ...st, text: `${mine.join(',\n')} ${bodyOf(st.text)}`, rebuilt: true });
      if (rest.length) kept.push({ ...st, text: `${rest.join(',\n')} ${bodyOf(st.text)}`, rebuilt: true });
      continue;
    }
    kept.push(st);
  }
  return { owned, kept };
}

function serialize(statements, indent = '') {
  return statements.map((st) => {
    const comment = st.comment ? st.comment.replace(/^\s+/, '') : '';
    if (st.type === 'at' && st.body) {
      return `${comment}${indent}${st.prelude} {\n${serialize(st.body, `${indent}  `)}\n${indent}}`;
    }
    return `${comment}${indent}${st.text.replace(/^\s+/, '')}`;
  }).join('\n');
}

const css = readFileSync(path.join(ROOT, SOURCE), 'utf8');
const { owned, kept } = splitList(parseStatements(css));

const header = `/**
 * FBT AI CINEMA BANNER — the component's own sheet.
 * ===========================================================================
 * These rules used to live in market-modern.css, which Market.jsx imports.
 * The banner is a self-contained surface (a hand-drawn fox mascot, a cinema
 * glow, a chart line) that NO screen currently renders, so every byte of it was
 * shipping on the app's home route: 28 KB of CSS whose selectors were matched
 * against every element the market screen creates, and fifteen looping
 * animations the compositor kept bookkeeping for.
 *
 * A component owns its stylesheet in this repo (DecisionOrb → decision-orb.css,
 * MoreSheet → more-menu.css). This file is imported by the component, so it
 * travels in whatever chunk eventually renders it — and in no chunk at all while
 * nothing does. Nothing here was rewritten: the rules are byte-identical, only
 * their address changed.
 */
`;

writeFileSync(path.join(ROOT, TARGET), `${header}\n${serialize(owned).replace(/\s+$/, '')}\n`, 'utf8');
writeFileSync(path.join(ROOT, SOURCE), `${serialize(kept).replace(/\s+$/, '')}\n`, 'utf8');

const bytes = (f) => Buffer.byteLength(readFileSync(path.join(ROOT, f), 'utf8'), 'utf8');
console.log(`moved ${owned.length} top-level statements`);
console.log(`${SOURCE}: ${bytes(SOURCE)} bytes`);
console.log(`${TARGET}: ${bytes(TARGET)} bytes`);
