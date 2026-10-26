/**
 * DISCOVER (Explore › کشف) — REDESIGN INTEGRITY PROBE
 * ---------------------------------------------------------------------------
 * Regression guard for the five things the 2026-10-26 redesign set out to fix:
 *
 *  1. The tab was English even with فارسی selected, because ~80 strings were
 *     hardcoded in JSX and never went through i18n.
 *  2. The primary button said «Open in FBT Browser» — the user asked for
 *     «باز کردن در مرورگر», with no branded browser name.
 *  3. Search did not suggest anything and only matched English substrings, so
 *     «وامدهی روی آربیتروم» returned nothing.
 *  4. Nine stacked sections made the page unreadable; the new layout has one
 *     quick-access card, one toolbar, one paginated grid and one bottom sheet.
 *  5. The card popup was a long wall of scattered warning boxes; it is now a
 *     compact sheet with one collapsible security block and a sticky CTA.
 *
 * Runs with plain Node: no DOM, no network, no jsdom.
 * Run: node test/discover-redesign-probe.mjs
 */
import { readFileSync } from 'node:fs';
/* Static, not `await import()`: test/run.mjs imports this probe alongside
   business-locales-probe.mjs, which calls process.exit(0) at import time. A
   top-level await here would yield the module, let that probe exit the process,
   and silently truncate this one halfway — exactly the trap documented in
   run.mjs. All five modules are pure and safe to import synchronously. */
import { normalizeText } from '../src/lib/discoveryText.js';
import { rankProtocols, buildSuggestions, smartSummary } from '../src/lib/discoverySearch.js';
import { DISCOVERY_PROTOCOLS, DISCOVERY_CATEGORIES, NETWORK_FILTERS } from '../src/lib/discoveryRegistry.js';
import { parseAiQuery, aiExamplesFor } from '../src/lib/discoveryAi.js';
import { PROTOCOL_FA, CHAIN_FA } from '../src/lib/discoveryLocalized.js';
import * as security from '../src/lib/discoverySecurity.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const load = (l) => JSON.parse(read(`../src/i18n/locales/${l}.json`));
let failures = 0;
const fail = (m) => { failures += 1; console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);
const t = (name, cond) => (cond ? ok(name) : fail(name));
const get = (o, d) => d.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const exists = (o, d) => typeof get(o, d) === 'string' && get(o, d).length > 0;
const PERSIAN = /[\u0600-\u06ff]/;

const en = load('en');
const fa = load('fa');
const jsx = read('../src/pages/Discover.jsx');
const css = read('../src/styles/discovery-center.css');
const jsxCode = jsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 1. Locale integrity ──────────────────────────────────────────────── */
function leaves(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') leaves(v, path, out);
    else out.push([path, String(v)]);
  }
  return out;
}
const enUi = leaves(en.discover?.ui || {});
const faUi = new Map(leaves(fa.discover?.ui || {}));

t('discover.ui exists in both en and fa with a real key set', enUi.length > 100 && faUi.size > 100);
const missingFa = enUi.filter(([k]) => !faUi.has(k)).map(([k]) => k);
t(`every discover.ui key is translated (${enUi.length} leaves)`, missingFa.length === 0 || (fail(`fa missing: ${missingFa.join(', ')}`), false));

/* Placeholders must survive translation, or a count silently disappears. */
const ph = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
const phErrors = enUi.filter(([k, v]) => ph(v) !== ph(faUi.get(k) || '')).map(([k]) => k);
t('translation keeps every {{placeholder}}', phErrors.length === 0 || (fail(`placeholder drift: ${phErrors.join(', ')}`), false));

/* The important strings really are Persian, not English copy pasted into fa. */
const mustBePersian = [
  'hero.kicker', 'hero.title', 'hero.titleAccent', 'hero.subtitle',
  'search.placeholder', 'search.label', 'search.suggestions', 'filters.category',
  'filters.network', 'filters.sort', 'filters.reset', 'filters.results',
  'cat.all', 'cat.lending', 'sort.trending', 'quick.title', 'card.details',
  'card.open', 'sheet.open', 'sheet.security', 'sheet.browserNotSafe',
  'sheet.hint', 'safety.title', 'safety.body', 'empty.title', 'empty.body'
];
const notPersian = mustBePersian.filter((k) => !PERSIAN.test(faUi.get(k) || ''));
t('core UI strings are Persian in fa.json', notPersian.length === 0 || (fail(`not Persian: ${notPersian.join(', ')}`), false));

/* The reported bug, exactly: no branded browser name anywhere in the tab. */
const branded = [...enUi, ...Array.from(faUi.entries())]
  .filter(([, v]) => /fbt\s*browser|مرورگر\s*fbt/i.test(v));
t('no “FBT Browser” in any discover copy', branded.length === 0);
t('no “FBT Browser” hardcoded in Discover.jsx', !/FBT Browser|مرورگر FBT|fbt مرورگر/i.test(jsxCode));
t('the fa open button says only «باز کردن در مرورگر»', faUi.get('card.open') === 'باز کردن در مرورگر' && faUi.get('sheet.open') === 'باز کردن در مرورگر');

/* Static t() keys and ui() helper paths must all resolve. */
const staticKeys = [...jsxCode.matchAll(/\bt\(\s*'(discover\.ui\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
const uiKeys = [...jsxCode.matchAll(/\bui\(\s*'([a-zA-Z0-9_.]+)'/g)].map((m) => `discover.ui.${m[1]}`);
const dynamicPrefixes = [...jsxCode.matchAll(/t\(\s*`discover\.ui\.([a-zA-Z0-9_.${}]+)`/g)].map((m) => m[1]);
const unresolved = [...new Set([...staticKeys, ...uiKeys])].filter((k) => !exists(en, k) || !exists(fa, k));
t(`every static/ui() key resolves in en + fa (${new Set([...staticKeys, ...uiKeys]).size} keys)`, unresolved.length === 0 || (fail(`unresolved: ${unresolved.join(', ')}`), false));
t('dynamic i18n templates are confined to the ui() helper and enumerated vocabularies',
  dynamicPrefixes.length >= 4 && dynamicPrefixes.every((p) => p === '${path}' || /^(cat|sort|warn)\./.test(p)));

/* Sort + category enumerations are complete. */
const catIds = ['all', 'defi', 'dex', 'lending', 'yield', 'bridges', 'analytics', 'rwa', 'nft', 'dev'];
const sortIds = ['trending', 'tvl', 'volume', 'name', 'favorites', 'new'];
t('every category id has an fa + en label', catIds.every((id) => exists(en, `discover.ui.cat.${id}`) && exists(fa, `discover.ui.cat.${id}`)));
t('every sort id has an fa + en label', sortIds.every((id) => exists(en, `discover.ui.sort.${id}`) && exists(fa, `discover.ui.sort.${id}`)));
t('wiring.mjs static key discover.verified now exists', exists(en, 'discover.verified') && exists(fa, 'discover.verified'));

/* ── 2. No hardcoded English UI left in the JSX ───────────────────────── */
const banned = [
  'Open in FBT Browser', 'Trending dApps', 'Featured protocols', 'AI Discovery',
  'Copy link', 'Clear filters', 'Recommended for you', 'Recently visited',
  'Favorites', 'Trending tokens', 'No protocols match', 'Audit reports',
  'View all', 'Open in browser'
];
const found = banned.filter((s) => jsxCode.includes(`>${s}`) || jsxCode.includes(`'${s}'`) || jsxCode.includes(`"${s}"`));
t('no hardcoded English UI labels in the render tree', found.length === 0 || (fail(`still hardcoded: ${found.join(', ')}`), false));

/* ── 3. Layout: calm, paginated, one popup ────────────────────────────── */
t('one quick-access card replaces the four separate strips',
  /dcx-quick/.test(jsxCode) && !/dcx-ai-examples/.test(jsxCode) && !/dcx-featured-carousel/.test(jsxCode));
t('grid is paginated (PAGE_SIZE)', /const PAGE_SIZE = 12/.test(jsxCode) && /filtered\.slice\(0, visible\)/.test(jsxCode));
t('one Sheet with a sticky action bar', (jsx.match(/<Sheet\b/g) || []).length === 1 && /dcx-sheet-actions/.test(jsxCode));
t('security warnings are grouped in a collapsible block', /<details className="dcx-security">/.test(jsxCode) && /warnText\(/.test(jsxCode));
t('search has keyboard navigation + click-outside + ARIA combobox',
  /ArrowDown/.test(jsxCode) && /ArrowUp/.test(jsxCode) && /pointerdown/.test(jsxCode) && /aria-activedescendant/.test(jsxCode));
t('recent queries are persisted', /QUERY_KEY/.test(jsxCode) && /rememberQuery/.test(jsxCode));
t('stylesheet supports light theme, RTL and reduced motion',
  /data-theme='light'/.test(css) && /\[dir='rtl'\]/.test(css) && /prefers-reduced-motion/.test(css));
t('stylesheet uses logical direction properties', !/(?:^|[;{\s])(margin|padding)-(left|right)\s*:/.test(css));

/* ── 4. Search engine + Persian AI parser ─────────────────────────────── */
const catLabels = Object.fromEntries(DISCOVERY_CATEGORIES.map((c) => [c.id, c.labelFa || c.label]));

t('normalizer folds Persian/Arabic spelling variants', normalizeText('یونیسواپ') === normalizeText('يونى سواپ'));
t('normalizer folds Persian digits', normalizeText('۱inch').includes('1inch'));

const uniswap = rankProtocols(DISCOVERY_PROTOCOLS, 'یونیسواپ', { lang: 'fa', categoryLabels: catLabels });
t('Persian brand alias finds the right protocol first', uniswap.items[0]?.id === 'uniswap');
const latin = rankProtocols(DISCOVERY_PROTOCOLS, 'Uniswap', { lang: 'en', categoryLabels: catLabels });
t('Latin brand name still finds the same protocol', latin.items[0]?.id === 'uniswap');
const lending = rankProtocols(DISCOVERY_PROTOCOLS, 'وام', { lang: 'fa', categoryLabels: catLabels });
t('Persian category word «وام» returns lending protocols',
  lending.items.length > 3 && lending.items.every((p) => p.category === 'lending'));
const arb = rankProtocols(DISCOVERY_PROTOCOLS, 'آربیتروم', { lang: 'fa', categoryLabels: catLabels });
t('Persian network name «آربیتروم» returns protocols on that chain',
  arb.items.length > 2 && arb.items.every((p) => p.chains.some((c) => /arb/i.test(c))));
t('gibberish returns no results', rankProtocols(DISCOVERY_PROTOCOLS, 'zzzzqqqq', { lang: 'fa', categoryLabels: catLabels }).items.length === 0);

const sugEmpty = buildSuggestions({ list: DISCOVERY_PROTOCOLS, query: '', lang: 'fa', categories: DISCOVERY_CATEGORIES, networks: NETWORK_FILTERS, recentQueries: ['aave', 'uniswap'], categoryLabels: catLabels });
t('empty omnibox suggests recent searches', sugEmpty.empty && sugEmpty.recents.length === 2);
const sugArb = buildSuggestions({ list: DISCOVERY_PROTOCOLS, query: 'arb', lang: 'fa', categories: DISCOVERY_CATEGORIES, networks: NETWORK_FILTERS, categoryLabels: catLabels });
t('network query suggests the Arbitrum filter', sugArb.networks.some((n) => n.id === 'arbitrum'));
const sugSmart = buildSuggestions({ list: DISCOVERY_PROTOCOLS, query: 'وامدهی روی آربیتروم', lang: 'fa', categories: DISCOVERY_CATEGORIES, networks: NETWORK_FILTERS, categoryLabels: catLabels });
t('natural-language Persian query becomes a smart suggestion',
  Boolean(sugSmart.smart) && sugSmart.smart.category === 'lending' && sugSmart.smart.chain === 'arbitrum');
t('smart summary is localized and non-empty', smartSummary(sugSmart.smart, { categoryLabel: (id) => catLabels[id], networkLabel: (id) => id, sortLabel: (id) => id }).length > 4);
const parsed = parseAiQuery('صرافیهای روی بیس');
t('AI parser understands a Persian DEX + Base query', parsed.category === 'dex' && parsed.chain === 'base');
t('Persian example prompts are Persian', aiExamplesFor('fa').length === 4 && aiExamplesFor('fa').every((s) => PERSIAN.test(s)));

/* Registry copy coverage — no untranslated descriptions on a Persian screen. */
const noFaDesc = DISCOVERY_PROTOCOLS.filter((p) => !PROTOCOL_FA[p.id]?.desc || !PERSIAN.test(PROTOCOL_FA[p.id].desc));
t(`every one of ${DISCOVERY_PROTOCOLS.length} protocols has a Persian description`, noFaDesc.length === 0 || (fail(`missing fa desc: ${noFaDesc.map((p) => p.id).join(', ')}`), false));
const chainNames = [...new Set(DISCOVERY_PROTOCOLS.flatMap((p) => p.chains || []))];
const noFaChain = chainNames.filter((c) => !CHAIN_FA[c]);
t('every chain name in the registry has a Persian label', noFaChain.length === 0 || (fail(`missing fa chain: ${noFaChain.join(', ')}`), false));

/* Security warnings carry stable codes, so the UI can translate them. */
const codes = security.validateDiscoveryUrl('https://app.uniswap.org').warnings.map((w) => w.code);
t('security warnings expose a stable code for i18n', security.validateDiscoveryUrl('http://evil.tk').warnings.every((w) => typeof w.code === 'string' && w.code.length > 2));
t('chain warning carries its chain names for interpolation',
  security.chainSupportWarnings(DISCOVERY_PROTOCOLS[0], 56).every((w) => typeof w.chains === 'string'));
t('audit notice carries a code', security.auditNotice({ audits: null })?.code === 'no-audit-info');
void codes;

console.log(failures ? `\n${failures} failure(s)` : '\nDiscover redesign probe: PASS');
if (failures) process.exit(1);
