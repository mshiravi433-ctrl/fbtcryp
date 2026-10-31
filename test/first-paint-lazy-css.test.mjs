/**
 * FIRST PAINT IS A BUDGET, AND STYLESHEETS ARE THE EASIEST WAY TO BLOW IT
 * ---------------------------------------------------------------------------
 * `scripts/check-first-paint.mjs` measures the total byte weight of everything
 * `<link>`ed from index.html and fails the build above 1750 KB. That check is
 * necessary but blunt: it only notices AFTER a rule set has already been
 * dragged into the entry chunk.
 *
 * The 2026-10-30 round added three stylesheets, and two of them are for screens
 * nobody opens on the first paint (the More sheet, and page-level tab rails).
 * They are only cheap because they arrive in their own chunks. This test pins
 * that arrangement at the source, so the next person who needs one of these
 * selectors cannot silently pay for it on every route:
 *
 *   · a sheet that belongs to a lazy screen is imported FROM that screen;
 *   · the entry stylesheet never `@import`s it and never pulls it in.
 *
 * It reads files rather than a build, so it runs in a second and fails on the
 * commit that causes the regression instead of the next release.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const ENTRY_CSS = read('src/index.css');
/* Prose about a sheet is fine and often the point of the note; it is the
   IMPORT that costs bytes. Strip comments before asserting on references, or
   an explanatory line ("its rules live in more-menu.css") reads as a load. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Sheets that must never travel in the entry bundle, and who may import them. */
const LAZY_SHEETS = [
  {
    sheet: 'src/styles/tab-rail.css',
    reason: 'page-level tab rails: two lazy screens only',
    owners: ['src/components/TabbedPage.jsx', 'src/pages/P2P.jsx']
  },
  {
    sheet: 'src/styles/more-menu.css',
    reason: 'the More sheet, loaded on open',
    owners: ['src/components/MoreSheet.jsx']
  },
  {
    /* The machine box that used to own this slot was removed on 2026-10-31
       («باکس موتور fbt را پاکش کن»); the sheet's one looping animation — the
       RGB comet that travels the pane's rim — lives here instead, and it is
       lazy for exactly the same reason. */
    sheet: 'src/styles/more-edge.css',
    reason: 'the looping RGB rim light, loaded with the More sheet',
    owners: ['src/components/MoreSheet.jsx']
  }
];

describe('lazy stylesheets stay lazy', () => {
  for (const { sheet, reason, owners } of LAZY_SHEETS) {
    const base = path.basename(sheet);

    it(`${base} is not imported by the first-paint stylesheet (${reason})`, () => {
      expect(ENTRY_CSS).not.toMatch(new RegExp(`@import[^;]*${base.replace('.', '\\.')}`));
      expect(stripComments(ENTRY_CSS)).not.toContain(base);
      /* …and not by the two files that always ship. */
      for (const eager of ['src/main.jsx', 'src/App.jsx']) {
        expect(read(eager), `${eager} must not pull in ${base}`).not.toContain(base);
      }
    });

    it(`${base} is imported by the screen that needs it`, () => {
      for (const owner of owners) {
        expect(read(owner), `${owner} should import ${base}`).toContain(base);
      }
    });
  }

  it('the More sheet pulls its two sheets in together, once', () => {
    const more = read('src/components/MoreSheet.jsx');
    /* Dynamic, not static: a static import would hoist both sheets into the
       chunk graph of whoever touches MoreSheet — including the entry graph if
       anything eager ever imports it. */
    expect(more).toMatch(/import\('\.\.\/styles\/more-menu\.css'\)/);
    expect(more).toMatch(/import\('\.\.\/styles\/more-edge\.css'\)/);
    expect(more).toMatch(/Promise\.all\(\[/);
    /* One cached promise, so reopening the sheet does not re-request anything. */
    expect(more).toMatch(/let menuStylesPromise|menuStylesPromise \?\?=/);
  });

  it('the entry stylesheet keeps the one rule the shell genuinely needs', () => {
    /* The swipe zone is on the shell, so it does belong in first paint — but it
       is two declarations and no layer. If this ever becomes a block, the
       gesture has grown a visual and should move to a component sheet. */
    const zone = /\.app-tab-swipe-zone \{([^}]*)\}/.exec(ENTRY_CSS);
    expect(zone).toBeTruthy();
    const body = zone[1];
    expect(body).toContain('touch-action: pan-y');
    expect(body).toContain('overscroll-behavior-x: contain');
    expect(body).not.toMatch(/animation|filter|transform|will-change|backdrop/);
  });
});
