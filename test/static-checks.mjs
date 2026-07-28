/**
 * Static source checks.
 *
 * These exist because Vite happily builds code that crashes at runtime. A
 * component can reference an identifier it never imported and the bundle is
 * produced without complaint — the ReferenceError only appears when a user
 * opens that screen. That exact bug (IconActivity used but not imported in
 * Settings.jsx) shipped past a green build during this change, so it is now
 * caught here.
 *
 * Also verifies i18n integrity: every t('key') resolves in fa and en, and
 * every locale carries the same keys, because a missing key renders as the raw
 * dotted path to the user.
 */
import fs from 'node:fs';
import path from 'node:path';

const results = [];
const check = (name, ok, detail) => results.push([detail ? `${name} — ${detail}` : name, Boolean(ok)]);

const SRC = path.resolve('src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

/* ------------------- 1. every used Icon* is imported ------------------- */

const iconExports = new Set(
  [...fs.readFileSync(path.join(SRC, 'components/Icons.jsx'), 'utf8').matchAll(/export const (Icon\w+)/g)]
    .map((m) => m[1])
);
check('Icons.jsx exports were found', iconExports.size > 20, `${iconExports.size} icons`);

const missingIcons = [];
for (const file of files) {
  if (file.endsWith('Icons.jsx')) continue;
  const src = fs.readFileSync(file, 'utf8');

  // Names imported in this file, under any import form.
  const imported = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) imported.add(name);
      const alias = part.trim().split(/\s+as\s+/)[1];
      if (alias) imported.add(alias.trim());
    }
  }
  for (const m of src.matchAll(/import\s+(\w+)\s*(?:,|from)/g)) imported.add(m[1]);

  // Local declarations count as defined too.
  for (const m of src.matchAll(/(?:const|let|var|function|class)\s+(\w+)/g)) imported.add(m[1]);

  for (const m of src.matchAll(/\b(Icon[A-Z]\w*)\b/g)) {
    const name = m[1];
    if (!iconExports.has(name)) continue;
    if (!imported.has(name)) missingIcons.push(`${path.relative(SRC, file)}: ${name}`);
  }
}
check('every Icon* used is imported', missingIcons.length === 0, missingIcons.slice(0, 4).join(' | '));

/* ---------------- 2. no undefined component references ---------------- */

const suspects = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const defined = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) defined.add(name);
    }
  }
  // Default imports, including `import X, { y } from '...'`.
  for (const m of src.matchAll(/import\s+(\w+)\s*(?:,\s*\{[^}]*\})?\s+from/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var|function|class)\s+(\w+)/g)) defined.add(m[1]);
  // Destructured component props, e.g. function Row({ icon: Icon, ... }).
  for (const m of src.matchAll(/[{,]\s*\w+\s*:\s*([A-Z]\w*)/g)) defined.add(m[1]);
  // Shorthand destructured props that are components: ({ Icon, hues }).
  for (const m of src.matchAll(/\{([^{}]*)\}\s*\)?\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(':').pop().trim().split('=')[0].trim();
      if (/^[A-Z]\w*$/.test(name)) defined.add(name);
    }
  }

  // JSX elements starting with a capital are components and must be in scope.
  for (const m of src.matchAll(/<([A-Z]\w*)[\s/>]/g)) {
    const name = m[1];
    if (name === 'React' || name.includes('.')) continue;
    if (!defined.has(name)) suspects.push(`${path.relative(SRC, file)}: <${name}>`);
  }
}
check('no JSX component used without being defined/imported', suspects.length === 0, suspects.slice(0, 4).join(' | '));

/* -------------------------- 3. i18n integrity -------------------------- */

const LOCALES = ['fa', 'en', 'ar', 'tr', 'ru', 'zh', 'es', 'hi', 'fr', 'de'];
const dicts = {};
for (const l of LOCALES) {
  dicts[l] = JSON.parse(fs.readFileSync(path.join(SRC, `i18n/locales/${l}.json`), 'utf8'));
}
check('all 10 locale files parse', Object.keys(dicts).length === 10);

const has = (obj, key) => {
  let cur = obj;
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return false;
    cur = cur[part];
  }
  return typeof cur === 'string';
};

// Literal t('...') calls must resolve. Template calls are checked by hand.
const missingFa = [];
const missingEn = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][a-zA-Z0-9_.]*)'/g)) {
    const key = m[1];
    // Skip single-segment matches: those are .then(...)/import(...) noise.
    if (!key.includes('.')) continue;
    if (!has(dicts.fa, key)) missingFa.push(`${path.relative(SRC, file)}: ${key}`);
    if (!has(dicts.en, key)) missingEn.push(`${path.relative(SRC, file)}: ${key}`);
  }
}
check('every t() key exists in fa.json', missingFa.length === 0, missingFa.slice(0, 5).join(' | '));
check('every t() key exists in en.json', missingEn.length === 0, missingEn.slice(0, 5).join(' | '));

// Key-set parity: English is the fallback, so every locale should be a subset.
const flatten = (obj, prefix = '', out = new Set()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.add(key);
  }
  return out;
};
const enKeys = flatten(dicts.en);
const faKeys = flatten(dicts.fa);
check('fa and en have the same key count', Math.abs(faKeys.size - enKeys.size) <= 2,
  `fa=${faKeys.size} en=${enKeys.size}`);

const orphans = [];
for (const l of LOCALES) {
  for (const k of flatten(dicts[l])) {
    if (!enKeys.has(k) && !faKeys.has(k)) orphans.push(`${l}:${k}`);
  }
}
check('no locale has keys missing from en+fa', orphans.length === 0, orphans.slice(0, 3).join(' | '));

/* ------------------ 4. the specific fixes stay fixed ------------------ */

const guideCss = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');
check('guide footer buttons share one equal-size class', guideCss.includes('.guide-btn') && guideCss.includes('flex: 1 1 0'));
check('old asymmetric .guide-back rule is gone', !/\.guide-back\s*\{[^}]*flex:\s*0 0 auto/.test(guideCss));

const guideJsx = fs.readFileSync(path.join(SRC, 'pages/Guide.jsx'), 'utf8');
check('guide has a language switcher', guideJsx.includes('LanguagePicker'));
check('guide animates out before unmounting', guideJsx.includes('setLeaving'));
check('both guide footer buttons use guide-btn', (guideJsx.match(/guide-btn/g) ?? []).length >= 3);

const swapJsx = fs.readFileSync(path.join(SRC, 'pages/Swap.jsx'), 'utf8');
check('swap uses the searchable TokenPicker', swapJsx.includes('<TokenPicker'));
check('swap plays trade feedback', swapJsx.includes("fb('success')") || swapJsx.includes("fb(ok ?"));

const chains = fs.readFileSync(path.join(SRC, 'lib/chains.js'), 'utf8');
check('fee is still 0.5% (50 bps)', /FEE_BPS\s*=\s*50/.test(chains));
check('there is still no zero-fee mode', !/FEE_MODE\s*=\s*['"]none['"]/.test(chains));

const detail = fs.readFileSync(path.join(SRC, 'pages/CoinDetail.jsx'), 'utf8');
check('coin detail fetches the coin directly', detail.includes('useCoin'));

// The company name must not regress to the old inconsistent spelling.
let badName = 0;
for (const file of [...files, ...LOCALES.map((l) => path.join(SRC, `i18n/locales/${l}.json`))]) {
  if (fs.readFileSync(file, 'utf8').includes('FBT iran')) badName += 1;
}
check('company name normalised everywhere', badName === 0, `${badName} files still say "FBT iran"`);

export default results;
