/**
 * WHAT'S NEW — parser tests (scripts/gen-whats-new.mjs)
 * ============================================================================
 *
 * The page is only as truthful as this parser. Three failure modes are worth a
 * test each, because all three are silent:
 *
 *   1. PERSIAN DATES. The changelog is written with Persian digits
 *      (`# ۲۰۲۶-۱۱-۱۰`). A parser that only accepts ASCII parses nothing and
 *      the page renders its empty state — which looks like "no releases" rather
 *      than "the parser is broken".
 *   2. UNDATED SECTIONS. `# Changelog` and `# Unreleased — …` are headings but
 *      not releases. Turning them into cards would publish a date that does not
 *      exist.
 *   3. MARKDOWN LEAKING INTO THE UI. `**bold**` and `[label](url)` must arrive
 *      as text; a card that renders literal asterisks is a bug the owner sees
 *      before anybody reads the note.
 *
 *   node --test test/whats-new.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseChangelog } from '../scripts/gen-whats-new.mjs';

const sample = `# Changelog

Intro text that belongs to no release.

# ۲۰۲۶-۱۱-۱۰ — «تیتر تست»: توضیح کوتاه

جزئیات: [2026-11-10-thing-fa.md](2026-11-10-thing-fa.md).

- **اصلاح ۱:** یک تغییر واقعی با «گیومه» و \`code\`.
- **اصلاح ۲:** [لینک](https://example.com) با برچسب.
- خط سوم که باید حذف شود چون فقط سه بولت مجاز است.
- خط چهارم.

# ۲۰۲۶-۱۱-۰۹ — عنوان دوم

- یک بولت.

# Unreleased — Phase 4d: not a release

- این نباید کارت شود.

# 2026-11-08 — ASCII date still works

- bullet in latin script.
`;

test('Persian digits parse into ISO dates', () => {
  const entries = parseChangelog(sample);
  assert.deepEqual(
    entries.map((e) => e.date),
    ['2026-11-10', '2026-11-09', '2026-11-08']
  );
});

test('undated headings are never published as releases', () => {
  const entries = parseChangelog(sample);
  const titles = entries.map((e) => e.title).join(' | ');
  assert.equal(titles.includes('Unreleased'), false);
  assert.equal(titles.includes('Phase 4d'), false);
});

test('title drops the date and the dash, keeps the words', () => {
  const [first] = parseChangelog(sample);
  assert.equal(first.title, '«تیتر تست»: توضیح کوتاه');
});

test('bullets are capped at three and stripped of markdown', () => {
  const [first] = parseChangelog(sample);
  assert.equal(first.bullets.length, 3);
  assert.equal(first.bullets[0].includes('**'), false);
  assert.equal(first.bullets[0].includes('**'), false);
  assert.match(first.bullets[0], /اصلاح ۱/);
  /* A link becomes its label, not a URL. */
  assert.match(first.bullets[1], /لینک/);
  assert.equal(first.bullets[1].includes('https://example.com'), false);
});

test('the detail link points at the repository blob, not a relative path', () => {
  const [first] = parseChangelog(sample);
  assert.equal(
    first.detail,
    'https://github.com/mshiravi433-ctrl/fbtcryp/blob/main/2026-11-10-thing-fa.md'
  );
  /* No «جزئیات» line in the second entry → no link at all, rather than a
     guessed one. */
  assert.equal(parseChangelog(sample)[1].detail, null);
});

test('newest first, and equal dates keep their written order', () => {
  const entries = parseChangelog(sample);
  const dates = entries.map((e) => e.date);
  assert.deepEqual([...dates].sort().reverse(), dates);

  const sameDay = parseChangelog(`# ۲۰۲۶-۱۱-۱۰ — اول\n- a\n\n# ۲۰۲۶-۱۱-۱۰ — دوم\n- b\n`);
  assert.deepEqual(sameDay.map((e) => e.title), ['اول', 'دوم']);
});

test('garbage in, empty list out — never a throw', () => {
  assert.deepEqual(parseChangelog(''), []);
  assert.deepEqual(parseChangelog('no headings at all\n- a bullet\n'), []);
  assert.deepEqual(parseChangelog('# ۲۰۲۶-۱۱-۱۰'), [{ date: '2026-11-10', title: '2026-11-10', bullets: [], detail: null }]);
});

test('the real CHANGELOG parses, is ordered, and is not empty', () => {
  const markdown = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const entries = parseChangelog(markdown);
  assert.ok(entries.length > 50, `expected many entries, got ${entries.length}`);
  const dates = entries.map((e) => e.date);
  assert.deepEqual([...dates].sort().reverse(), dates, 'entries must be newest-first');
  for (const entry of entries) assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
  /* The first entry of the shipped changelog is dated, so the page can never
     open on an empty heading. */
  assert.ok(entries[0].bullets.length > 0, 'the newest entry should carry at least one bullet');
});

test('the generator writes public/whats-new.json and never fails a build', () => {
  const out = execFileSync(process.execPath, ['scripts/gen-whats-new.mjs'], { encoding: 'utf8' });
  assert.match(out, /wrote public\/whats-new\.json/);
  const json = JSON.parse(readFileSync(new URL('../public/whats-new.json', import.meta.url), 'utf8'));
  assert.equal(json.schema, 'fbt.whats-new.v1');
  assert.equal(json.source, 'CHANGELOG.md');
  assert.ok(Array.isArray(json.entries) && json.entries.length > 0);
  assert.ok(json.entries.length <= 80, 'payload stays bounded');
  assert.equal(json.shown, json.entries.length);
  assert.match(json.latest, /^\d{4}-\d{2}-\d{2}$/);
});
