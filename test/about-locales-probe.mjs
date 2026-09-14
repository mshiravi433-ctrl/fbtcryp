/**
 * ABOUT PAGE — LOCALE INTEGRITY PROBE
 *
 * Regression guard for three bugs that shipped together and made the
 * Persian About page read as an English brochure («با وجود زبان فارسی بعضی
 * جملاتش و سوالات و جواب انگلیسیه»):
 *
 *   1. fa.json's `about` object was closed 13 keys too early, so
 *      `about.headline`, `about.how.*` and the whole `about.faq.*` block sat
 *      at the file ROOT — unreachable, silently falling back to English, and
 *      `about.techStack` was duplicated (the second copy wins by JSON rules,
 *      which is exactly how real content got buried).
 *   2. The principles grid looked up `about.principles.dataTitle{Title,Body}`
 *      (double suffix) — a key no locale has, so every language saw the raw
 *      API name on the "Data-Driven Intelligence" card.
 *   3. `about.principles.*` existed only in en + fa, leaving the other ten
 *      locales on English for the entire section.
 *
 * The probe tokenizes every shipped locale with a string/structure-aware
 * scanner (JSON.parse keeps only the LAST duplicate key — how bug 1 stayed
 * invisible), resolves every key the About screen reads against all twelve
 * locales, and checks the Persian headline / how / FAQ copy actually
 * contains Persian script rather than an English fallback.
 *
 * Run: node test/about-locales-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOCALES = ['en', 'fa', 'ar', 'zh', 'hi', 'es', 'fr', 'ru', 'tr', 'ur', 'id', 'pt'];
const PERSIAN_RE = /[؀-ۿ]/;

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`✗ ${msg}`); };
const ok = (msg) => console.log(`✓ ${msg}`);

const get = (obj, dotted) =>
  dotted.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
const exists = (obj, dotted) => typeof get(obj, dotted) === 'string' && get(obj, dotted).length > 0;

/**
 * String-aware structural scan: walks the raw JSON text, tracks the key
 * stack per open object, and reports any key defined twice within the same
 * object body — the defect JSON.parse papers over.
 */
function findDuplicateKeys(src) {
  const dupes = new Set();
  const stack = []; // each entry: { keys: Set }
  let inStr = false;
  let esc = false;
  let pendingKey = null;
  let buf = '';
  let expectingKey = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }

    if (inStr) {
      if (ch === '"') { inStr = false; pendingKey = buf; buf = ''; }
      else buf += ch;
      continue;
    }

    if (ch === '"') { inStr = true; buf = ''; continue; }

    if (ch === '{') {
      stack.push({ keys: new Set() });
      expectingKey = true;
      pendingKey = null;
      continue;
    }
    if (ch === '}') { stack.pop(); continue; }

    if (ch === ':' && pendingKey !== null && stack.length) {
      const top = stack[stack.length - 1];
      if (top.keys.has(pendingKey)) dupes.add(pendingKey);
      top.keys.add(pendingKey);
      pendingKey = null;
    }
    /* arrays and scalars: keys only matter inside objects, and `:` only
       immediately after a key string, so `[`, `]`, literals need no care —
       a `:` inside a string was already consumed by the inStr branch. */
    void expectingKey;
  }
  return [...dupes];
}

/* --- the exact keys About.jsx renders (keep in sync with the screen) ----- */
const KEYS = [
  'about.tagline', 'about.headline',
  'about.trust.nonCustodial', 'about.trust.multiChain', 'about.value.access.title',
  'about.who', 'about.summary',
  'about.stats.chains', 'about.stats.languages', 'about.stats.custody',
  'about.how.title',
  'about.how.step1Title', 'about.how.step1Body',
  'about.how.step2Title', 'about.how.step2Body',
  'about.how.step3Title', 'about.how.step3Body',
  'about.featuresTitle',
  'about.ecosystem.swapTitle', 'about.ecosystem.swapDesc',
  'about.ecosystem.walletTitle', 'about.ecosystem.walletDesc',
  'about.ecosystem.intentTitle', 'about.ecosystem.intentDesc',
  'about.ecosystem.signalsTitle', 'about.ecosystem.signalsDesc',
  'about.ecosystem.smartMoneyTitle', 'about.ecosystem.smartMoneyDesc',
  'about.ecosystem.farmsTitle', 'about.ecosystem.farmsDesc',
  'about.principles.title', 'about.principles.lead',
  'about.principles.userControlTitle', 'about.principles.userControlBody',
  'about.principles.automationTitle', 'about.principles.automationBody',
  'about.principles.transparencyTitle', 'about.principles.transparencyBody',
  'about.principles.openTitle', 'about.principles.openBody',
  'about.principles.dataTitle', 'about.principles.dataBody',
  'about.principles.improvementTitle', 'about.principles.improvementBody',
  'about.faq.title',
  ...Array.from({ length: 10 }, (_, i) => `about.faq.q${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `about.faq.a${i + 1}`),
  'about.ctaTitle', 'about.companyFull', 'about.footNote',
  'contact.title', 'nav.audit',
];

const localeDir = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url));
const data = {};

/* 1 · every locale parses, with NO duplicate keys anywhere ---------------- */
for (const code of LOCALES) {
  const src = readFileSync(`${localeDir}${code}.json`, 'utf8');
  try {
    data[code] = JSON.parse(src);
  } catch (e) {
    fail(`${code}.json does not parse: ${e.message}`);
    continue;
  }
  const dupes = findDuplicateKeys(src);
  if (dupes.length) fail(`${code}.json has duplicate keys (last wins, first silently lost): ${dupes.join(', ')}`);
}
if (!failures) ok('all 12 locales parse, no duplicate keys');

/* 2 · every key the screen reads resolves in every locale ----------------- */
for (const code of LOCALES) {
  if (!data[code]) continue;
  const missing = KEYS.filter((k) => !exists(data[code], k));
  if (missing.length) {
    fail(`${code}: ${missing.length} About-page keys missing → English/raw-key fallback: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`);
  } else {
    ok(`${code}: all ${KEYS.length} About-page keys resolve`);
  }
}

/* 3 · Persian actually reads Persian --------------------------------------- */
const fa = data.fa;
if (fa) {
  const persianTargets = [
    'about.headline', 'about.how.title',
    'about.how.step1Title', 'about.how.step2Title', 'about.how.step3Title',
    'about.faq.title',
    ...Array.from({ length: 10 }, (_, i) => `about.faq.q${i + 1}`),
    ...Array.from({ length: 10 }, (_, i) => `about.faq.a${i + 1}`),
  ];
  const anglo = persianTargets.filter((k) => exists(fa, k) && !PERSIAN_RE.test(get(fa, k)));
  if (anglo.length) fail(`fa: these render as English (no Persian script): ${anglo.join(', ')}`);
  else ok(`fa: headline, how-it-works and all ${persianTargets.length} FAQ strings contain Persian script`);

  /* 4 · bug 1's shape must never return: about-blocks orphaned at root ---- */
  const rootKeys = new Set(Object.getOwnPropertyNames(fa));
  const strays = ['headline', 'how', 'roadmap', 'personalOS', 'globalAccess', 'transparency',
    'seo', 'footer', 'finalCTA', 'microcopy', 'internalLinks', 'languageSwitcher']
    .filter((k) => rootKeys.has(k));
  if (strays.length) fail(`fa: orphaned about-blocks at the file root: ${strays.join(', ')} — they belong under "about"`);
  else ok('fa: no orphaned about-blocks at the file root (about object closes correctly)');
}

/* 5 · the double-suffix lookup: principles keys must match real locale keys */
const aboutSrc = readFileSync(fileURLToPath(new URL('../src/pages/About.jsx', import.meta.url)), 'utf8');
const gridIdx = aboutSrc.indexOf('about-principles-grid');
const mapIdx = aboutSrc.indexOf('.map(({ key, Icon, hue })', gridIdx > -1 ? gridIdx : 0);
const arrStart = aboutSrc.lastIndexOf('[', mapIdx);
const chunk = aboutSrc.slice(arrStart, mapIdx);
const principleKeys = [...chunk.matchAll(/\{ key: '([a-zA-Z.]+)',/g)].map((m) => m[1]);
const principleMisses = principleKeys.filter((k) =>
  !exists(data.en ?? {}, `about.principles.${k}Title`) || !exists(data.en ?? {}, `about.principles.${k}Body`));
if (principleMisses.length && principleKeys.includes('data')) {
  fail(`About.jsx principles keys with no en.json match: ${principleMisses.join(', ')}`);
} else if (aboutSrc.includes("key: 'dataTitle'")) {
  fail('About.jsx still looks up about.principles.dataTitle{Title,Body} — resolves to nothing in any locale');
} else {
  ok('About.jsx: every principles key maps onto real en.json keys (dataTitle double-suffix fixed)');
}

console.log('');
if (failures) {
  console.error(`ABOUT LOCALE PROBE FAILED — ${failures} problem(s)`);
  process.exit(1);
}
console.log('ABOUT LOCALE PROBE PASSED');
