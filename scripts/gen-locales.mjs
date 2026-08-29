/**
 * Build the nine partial locale files, and compute real coverage numbers.
 *
 * WHY COVERAGE IS COMPUTED, NOT DECLARED
 * The language picker used to carry a hand-written `complete: true` flag. A
 * boolean somebody remembers to update is a boolean that goes stale the first
 * time anyone adds a key — and then the app is telling users a language is
 * fully translated when it isn't. So the flag is gone: this script counts the
 * keys each locale actually has against en.json and writes the result into
 * `src/i18n/coverage.json`, which the picker reads. If the number is wrong,
 * it is wrong because the translations are wrong, not because a flag drifted.
 *
 * Anything not translated falls back to English via i18next, never to a raw
 * key: a visible English string tells the user the translation is incomplete,
 * whereas `swap.err.NO_ROUTE` tells them the app is broken.
 *
 * Run: node scripts/gen-locales.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import common from './locales/common.mjs';
import product from './locales/product.mjs';
import wallet from './locales/wallet.mjs';
import settings from './locales/settings.mjs';

const LANGS = ['zh', 'hi', 'es', 'fr', 'ru', 'tr', 'ur', 'id', 'pt'];
// Hand-maintained. English is the source, so it is 100% by definition and is
// not measured against itself.
const FULL = ['fa', 'ar'];

const localePath = (code) => new URL(`../src/i18n/locales/${code}.json`, import.meta.url);
const coveragePath = new URL('../src/i18n/coverage.json', import.meta.url);

const SOURCES = { ...common, ...product, ...wallet, ...settings };

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur[parts[i]] ??= {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/** Every leaf key path in a nested object. */
function leaves(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, path, out);
    else out.push(path);
  }
  return out;
}

const en = JSON.parse(readFileSync(localePath('en'), 'utf8'));
const enLeaves = leaves(en);
const enTotal = enLeaves.length;

/* --------------------------- validate sources --------------------------- */
/*
 * A translation for a key English does not have is dead weight that will never
 * render — usually a typo in the key path. Surface it loudly rather than
 * shipping a file with strings nobody can reach.
 */
const enSet = new Set(enLeaves);
const orphans = Object.keys(SOURCES).filter((k) => !enSet.has(k));
if (orphans.length) {
  console.error('\n✗ These keys are translated but do not exist in en.json:');
  orphans.forEach((k) => console.error(`    ${k}`));
  console.error('  Fix the key path or add it to en.json first.\n');
  process.exit(1);
}

/*
 * Placeholders must survive translation. `{{n}}` dropped from a translated
 * string means a sentence that silently loses its number — "0 tokens" becomes
 * "tokens" — and that is the kind of bug nobody notices until a user does.
 */
const placeholderErrors = [];
for (const [key, byLang] of Object.entries(SOURCES)) {
  const source = key.split('.').reduce((o, k) => o?.[k], en);
  if (typeof source !== 'string') continue;
  const want = [...source.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  if (!want.length) continue;
  for (const [lang, text] of Object.entries(byLang)) {
    const got = [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    if (want.join() !== got.join()) {
      placeholderErrors.push(`${key} [${lang}] expected {{${want.join('}}, {{')}}} got ${got.length ? `{{${got.join('}}, {{')}}}` : 'none'}`);
    }
  }
}
if (placeholderErrors.length) {
  console.error('\n✗ Placeholder mismatch — the translated string would lose a value:');
  placeholderErrors.forEach((e) => console.error(`    ${e}`));
  console.error('');
  process.exit(1);
}

/* ------------------------------ write files ----------------------------- */

const coverage = {};

/*
 * MERGE — never start from `{}` and walk away.
 * ---------------------------------------------------------------------------
 * The four source modules define the shared core: navigation, welcome, guide
 * chrome, swap flow and every safety warning. They are NOT the whole story.
 * The nine files also carry ~300 keys each that were translated directly into
 * them and never mirrored back into a module. Rebuilding from SOURCES alone
 * deleted 303 of them per language — real, rendering strings (`nav.intentOS`,
 * `toast.walletSessionRestored`, the entire `wallet.stocksBanner` block) that
 * exist in en.json and are on screen today.
 *
 * So: start from what the file already has, layer the modules on top (the
 * module wins where both define a key — it is the reviewed source), then prune
 * anything en.json does not contain. That last step is the one deletion that
 * is always safe: a key English lacks can never render.
 */
function pruneToEnglish(obj, allowed, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const kept = pruneToEnglish(v, allowed, path);
      if (Object.keys(kept).length) out[k] = kept;
    } else if (allowed.has(path)) {
      out[k] = v;
    }
  }
  return out;
}

for (const lang of LANGS) {
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(localePath(lang), 'utf8'));
  } catch {
    existing = {}; // a missing or corrupt file simply starts from the modules
  }
  const merged = existing;
  const inherited = new Set(leaves(merged));

  /*
   * Where both define a key, the module wins — it is the reviewed source for
   * the shared core. But a module can also be STALE, and a stale module
   * silently overwriting a deliberate fix in a shipped file is worse than
   * either: wallet.localRisk / noProvider / backupWarning were deleted from
   * the nine files on purpose (they claimed the key lives "inside the
   * Telegram WebView", which is false) and the module still carried them, so
   * a rebuild quietly put the false claim back.
   *
   * So every value the module replaces is reported, not absorbed. A diff here
   * is a decision someone has to look at, never a detail of the run.
   */
  const overwritten = [];
  let fromModules = 0;
  for (const [key, byLang] of Object.entries(SOURCES)) {
    if (!byLang[lang]) continue;
    const before = readValue(merged, key);
    setPath(merged, key, byLang[lang]);
    fromModules += 1;
    if (typeof before === 'string' && before !== byLang[lang]) overwritten.push(key);
  }

  const json = pruneToEnglish(merged, enSet);
  const present = leaves(json).length;
  const pruned = leaves(merged).length - present;
  const onlyInFile = [...inherited].filter((k) => !SOURCES[k]).length;

  writeFileSync(localePath(lang), `${JSON.stringify(json, null, 2)}\n`);
  coverage[lang] = Math.round((present / enTotal) * 100);
  console.log(
    `${lang}.json — ${present}/${enTotal} keys (${coverage[lang]}%) — ${fromModules} from the shared modules, ${onlyInFile} kept from the file${pruned ? `, ${pruned} pruned (absent from en.json)` : ''}`
  );
  if (overwritten.length) {
    console.log(`    ⚠ module overwrote ${overwritten.length} existing value(s): ${overwritten.slice(0, 6).join(', ')}${overwritten.length > 6 ? ', …' : ''}`);
    overwritten.forEach((k) => console.log(`        ${k}\n          file:   ${String(readValue(existing, k)).slice(0, 90)}\n          module: ${String(readValue(SOURCES[k], lang)).slice(0, 90)}`));
  }
}

/**
 * For the hand-maintained locales, key presence is not coverage.
 *
 * ar.json had every key — because it was seeded from en.json — while 686 of
 * them were still the English sentence verbatim. Counting keys said "100%
 * translated"; a user opening the app in Arabic saw English on most screens.
 * So a leaf only counts as translated when its value actually DIFFERS from
 * English. Short shared tokens (tickers, "P2P", "DeFi", numerals) are
 * legitimately identical, so anything under 4 characters is exempt.
 */
function readValue(obj, dotted) {
  return dotted.split('.').reduce((o, k) => o?.[k], obj);
}

for (const lang of FULL) {
  const json = JSON.parse(readFileSync(localePath(lang), 'utf8'));
  let translated = 0;
  const untranslated = [];
  for (const key of enLeaves) {
    const mine = readValue(json, key);
    const theirs = readValue(en, key);
    if (mine === undefined) continue;
    if (typeof mine === 'string' && typeof theirs === 'string' && mine === theirs && theirs.length > 3) {
      untranslated.push(key);
      continue;
    }
    translated += 1;
  }
  coverage[lang] = Math.round((translated / enTotal) * 100);
  const note = untranslated.length ? ` — ${untranslated.length} still English` : '';
  console.log(`${lang}.json — ${translated}/${enTotal} translated (${coverage[lang]}%)${note}`);
  // Written for whoever picks up the Arabic pass next; gitignored, since it
  // is regenerated on every run and would otherwise churn in every diff.
  if (lang === 'ar' && untranslated.length) {
    writeFileSync(
      new URL('./locales/ar-todo.txt', import.meta.url),
      `${untranslated.join('\n')}\n`
    );
  }
}

coverage.en = 100;

writeFileSync(
  coveragePath,
  `${JSON.stringify(
    {
      _comment:
        'GENERATED by scripts/gen-locales.mjs — do not edit. Percentage of en.json keys each locale defines. The language picker reads this so it can never claim a coverage level the files do not actually have.',
      total: enTotal,
      coverage
    },
    null,
    2
  )}\n`
);

console.log(`\nWrote coverage.json (${enTotal} keys in en.json)`);
