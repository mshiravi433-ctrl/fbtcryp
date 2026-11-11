#!/usr/bin/env node
/**
 * WHAT'S NEW — CHANGELOG.md → public/whats-new.json
 * ============================================================================
 *
 * ─── WHY A GENERATED JSON AND NOT A PAGE THAT READS THE CHANGELOG ───────────
 * `CHANGELOG.md` is ~1 MB of Persian prose. It is the project's real record of
 * what shipped, and until now the only place to read it was the repository —
 * which means «چه چیزی جدید است؟» had no answer inside the product at all.
 *
 * Three ways to put it on screen, and why this is the cheapest one:
 *
 *   · SERVER ROUTE (GET /api/whats-new) — a function invocation per view, a
 *     cold start, and the route that spends Fluid Active CPU. This project was
 *     just soft-blocked for exactly that (2026-11-10, `fluidCpuDuration`,
 *     103% of 4 h). A read-only page must not be able to cost anything.
 *   · BUNDLE THE MARKDOWN INTO THE JS — 1 MB into a first-paint-adjacent
 *     chunk for a screen most visitors never open.
 *   · GENERATE A SMALL JSON AT BUILD TIME (this file) — a static asset on the
 *     CDN, fetched only when the page opens, costing zero CPU and zero
 *     invocations, and impossible to make stale relative to the shipped code
 *     because it is produced from the same commit.
 *
 * The page is `src/pages/WhatsNew.jsx` (hash route `/#/whats-new`).
 *
 * ─── WHAT THIS SCRIPT WILL NOT DO ───────────────────────────────────────────
 *   · It never fails a build. A changelog that stops parsing is a broken PAGE,
 *     not a broken DEPLOYMENT — the same principle the landing generator
 *     follows. Parse trouble becomes a warning and an empty (but valid) JSON,
 *     so `npm run build` keeps working and the site keeps serving.
 *   · It does not invent entries. Only `# <date> — <title>` headings become
 *     rows; `# Unreleased` and the `# Changelog` header are skipped, because a
 *     date is what makes a row's claim checkable.
 *   · It does not rewrite anyone's words: bullets are the changelog's own, with
 *     markdown syntax stripped and long ones trimmed (the full text stays in
 *     the repository, linked from each card).
 *
 *   node scripts/gen-whats-new.mjs            # write public/whats-new.json
 *   node scripts/gen-whats-new.mjs --check    # parse only, print a summary
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'CHANGELOG.md');
const OUT = join(ROOT, 'public', 'whats-new.json');

/** The repository, for the «جزئیات کامل» link on every card. */
const REPO_BLOB = 'https://github.com/mshiravi433-ctrl/fbtcryp/blob/main';

/**
 * How many entries the page carries. The changelog has 150+ headings and the
 * oldest describe work from two years of releases; a visitor scrolling that far
 * is not the audience for a "what's new" screen. The rest stay one click away
 * in the repository, and the payload stays small enough to open on a phone.
 */
const MAX_ENTRIES = 80;
/** Bullets per entry, and the character budget per bullet. */
const MAX_BULLETS = 3;
const MAX_BULLET_CHARS = 190;

/**
 * Persian (۰-۹) and Arabic-Indic (٠-٩) digits → ASCII.
 *
 * The changelog is written in Persian and its headings use Persian digits
 * (`# ۲۰۲۶-۱۱-۱۰`). Without this, every date would fail to parse and the page
 * would be empty — which is exactly the kind of silent emptiness that looks
 * like "the feature is broken" instead of "the parser is wrong".
 */
function normalizeDigits(value) {
  return String(value)
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Strip the markdown that would otherwise render as literal asterisks. */
function plainText(value) {
  return String(value)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') // links → their label
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2') // italics
    .replace(/^\s*[-*+]\s+/, '') // the bullet marker itself
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trim to a character budget without cutting mid-word. */
function clip(value, max) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,،;:]+$/, '')}…`;
}

/**
 * The first link to a repository `.md` file inside a block — that is the
 * project's convention for «جزئیات: [file](file)» and it is the only link the
 * card offers, because a card is a summary and the summary has a source.
 */
function detailLink(lines) {
  for (const line of lines.slice(0, 4)) {
    const match = line.match(/\[[^\]]+\]\(\s*([\w./-]+\.md)\s*\)/);
    if (match) return `${REPO_BLOB}/${match[1].replace(/^\.\//, '')}`;
  }
  return null;
}

function bulletsOf(lines) {
  const out = [];
  for (const line of lines) {
    if (!/^\s*[-*+]\s+/.test(line)) continue;
    const text = plainText(line);
    if (text.length < 12) continue; // a stray marker, not a claim
    out.push(clip(text, MAX_BULLET_CHARS));
    if (out.length >= MAX_BULLETS) break;
  }
  return out;
}

export function parseChangelog(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const entries = [];

  let current = null;
  const flush = () => {
    if (!current) return;
    /* A dated entry whose heading carries no title is still a real release;
       the date alone is the truthful label. */
    entries.push({
      date: current.date,
      title: current.title || current.date,
      bullets: bulletsOf(current.body),
      detail: detailLink(current.body)
    });
    current = null;
  };

  for (const line of lines) {
    if (/^#\s+/.test(line)) {
      flush();
      const heading = line.replace(/^#\s+/, '').trim();
      const ascii = normalizeDigits(heading);
      const dated = ascii.match(/^(\d{4})-(\d{2})-(\d{2})\s*(?:—|-|–|:)?\s*([\s\S]*)$/);
      /* `# Changelog` and `# Unreleased — …` have no date: skipped on purpose,
         see the header. */
      if (!dated) continue;
      const [, y, m, d, rest] = dated;
      current = {
        date: `${y}-${m}-${d}`,
        title: plainText(rest || ''),
        body: []
      };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();

  /* Newest first. `sort` is stable, so entries sharing a date keep the order
     they were written in — which is the order the work actually landed. */
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return entries;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  let entries = [];
  try {
    const markdown = readFileSync(SOURCE, 'utf8');
    entries = parseChangelog(markdown);
  } catch (err) {
    /* Never fatal: the deploy must not depend on a markdown file. */
    console.warn(`[whats-new] could not read ${SOURCE}: ${err.message}`);
  }

  const total = entries.length;
  const kept = entries.slice(0, MAX_ENTRIES);
  const payload = {
    schema: 'fbt.whats-new.v1',
    source: 'CHANGELOG.md',
    sourceUrl: `${REPO_BLOB}/CHANGELOG.md`,
    generatedAt: new Date().toISOString(),
    total,
    shown: kept.length,
    olderCount: Math.max(0, total - kept.length),
    /* The newest release date, so a client can show «آخرین به‌روزرسانی» without
       walking the array. */
    latest: kept[0]?.date ?? null,
    entries: kept
  };

  if (checkOnly) {
    console.log(`[whats-new] parsed ${total} dated entries; newest ${payload.latest}; oldest shown ${kept.at(-1)?.date}`);
    console.log(`[whats-new] first entry: ${kept[0]?.title?.slice(0, 80) ?? '(none)'}`);
    console.log(`[whats-new] bullets on first entry: ${kept[0]?.bullets?.length ?? 0}`);
    return;
  }

  try {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    const kb = Math.round(Buffer.byteLength(JSON.stringify(payload)) / 1024);
    console.log(`[whats-new] wrote public/whats-new.json — ${kept.length}/${total} entries, ${kb} KB`);
  } catch (err) {
    /* Also non-fatal: the page shows its own empty state and says so. */
    console.warn(`[whats-new] could not write ${OUT}: ${err.message}`);
  }
}

/* Only run as a script, so the parser can be imported by a test. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
