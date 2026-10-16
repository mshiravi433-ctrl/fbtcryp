#!/usr/bin/env node
/**
 * ONE-OFF: the copy for the Signals hero cinema — the rotating sentence cycle
 * under «سیگنال هوشمند» (src/components/SignalsHeroCinema.jsx).
 *
 * Idempotent: re-running only fills what is missing, and it never overwrites a
 * string a translator has already changed. Same recipe as
 * scripts/add-locale-keys.mjs, including the serialisation (`JSON.stringify(_,
 * null, 2)` + trailing newline), which round-trips these files byte-for-byte.
 *
 * ─── WHY ONLY fa / en / ar ──────────────────────────────────────────────────
 * src/i18n/index.js documents the convention: «Twelve languages. fa/en/ar are
 * complete; the rest carry the core surface … and fall back to English
 * elsewhere.» The other nine locale files hold a 23-key `signals` subset and do
 * not even carry `signals.subtitle`. Adding nine words to each of them would
 * make those bundles look more complete than they are, for a decorative line
 * that already reads fine in English. So the three complete locales get the
 * copy, and everyone else gets the English fallback — the same as the subtitle
 * above it and the whole `signals.intel` namespace below it.
 *
 * Run: node scripts/add-signals-hero-copy.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src/i18n/locales');

/**
 * The word slots, in the order the component rotates them.
 * Keys must match HERO_WORD_KEYS in src/components/SignalsHeroCinema.jsx — the
 * test test/signals-hero-cinema.test.jsx asserts exactly that.
 *
 * These are names of measurements the page really makes (early signals,
 * momentum, smart-money flow, breadth, volume, levels, indicator agreement,
 * liquidity), not promises: no «buy now», no «guaranteed», no price target. The
 * disclaimer two boxes below says what indicators cannot do, and this line must
 * not contradict it.
 */
const HERO = {
  fa: {
    aria: 'عبارت‌های چرخشی سیگنال هوشمند',
    words: {
      early: 'سیگنال زودهنگام',
      momentum: 'رادار شتاب',
      history: 'تاریخچه سیگنال‌ها',
      conclusion: 'نتیجه‌گیری با هوش مالی مدرن و زیبا'
    }
  },
  en: {
    aria: 'Rotating smart-signal phrases',
    words: {
      early: 'Early signal',
      momentum: 'Momentum radar',
      history: 'Signal history',
      conclusion: 'Conclusion: modern, beautiful financial intelligence'
    }
  },
  ar: {
    aria: 'عبارات الإشارات الذكية الدوّارة',
    words: {
      early: 'إشارة مبكرة',
      momentum: 'رادار الزخم',
      history: 'سجل الإشارات',
      conclusion: 'الخلاصة: ذكاء مالي حديث وجميل'
    }
  }
};

/** Rebuild `signals` with `hero` sitting right after `subtitle`. */
function withHero(signals, hero) {
  const next = {};
  let inserted = false;
  for (const [key, value] of Object.entries(signals)) {
    next[key] = value;
    if (key === 'subtitle' && !inserted) {
      next.hero = hero;
      inserted = true;
    }
  }
  if (!inserted) next.hero = hero;
  return next;
}

let touchedFiles = 0;

for (const [locale, hero] of Object.entries(HERO)) {
  const file = join(dir, `${locale}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (!json.signals || typeof json.signals !== 'object') {
    console.log(`${locale}: no signals namespace — skipped`);
    continue;
  }

  const existing = json.signals.hero;
  const merged = {
    aria: typeof existing?.aria === 'string' && existing.aria ? existing.aria : hero.aria,
    words: { ...hero.words, ...(typeof existing?.words === 'object' && existing.words ? existing.words : {}) }
  };

  const same = JSON.stringify(existing) === JSON.stringify(merged);
  json.signals = withHero(json.signals, merged);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  if (!same) touchedFiles += 1;
  console.log(`${locale}: ${same ? 'already up to date' : `hero written (${Object.keys(merged.words).length} words)`}`);
}

console.log(`files changed: ${touchedFiles}`);
