/**
 * BUSINESS PAGE — LOCALE INTEGRITY PROBE
 *
 * Regression guard for the bug where `biz.tabs.*` / `biz.subtab.*` existed in
 * NO locale, so the Business tab labels rendered as raw i18n keys (English
 * strings on the Persian screen), demo request times were hardcoded Persian
 * in every language, and «۲۴/۷» was hardcoded in the tracking panel.
 *
 * Resolves every key src/pages/Business.jsx reads against fa + en fully and
 * the tab/sub-tab labels against all twelve locales, checks the Persian copy
 * actually contains Persian script, and checks English copy has no Persian.
 *
 * Run: node test/business-locales-probe.mjs
 */
import { readFileSync } from 'node:fs';

const LOCALES = ['en', 'fa', 'ar', 'zh', 'hi', 'es', 'fr', 'ru', 'tr', 'ur', 'id', 'pt'];
const PERSIAN_RE = /[؀-ۿ]/;
let failures = 0;
const fail = (m) => { failures += 1; console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);
const get = (o, d) => d.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const exists = (o, d) => typeof get(o, d) === 'string' && get(o, d).length > 0;

const load = (l) => JSON.parse(readFileSync(new URL(`../src/i18n/locales/${l}.json`, import.meta.url), 'utf8'));
const fa = load('fa');
const en = load('en');

const OFFERS = ['listing', 'liquidity', 'whitelabel', 'integration'];
const BRANDS = ['fbt', 'solana', 'ethereum', 'polygon', 'bnb', 'arbitrum'];
const FULL = [
  'biz.title', 'biz.intro', 'biz.badge', 'biz.heroKicker', 'biz.company', 'biz.website', 'biz.contact',
  'biz.requestPartnership', 'biz.atGlance', 'biz.selectTopic', 'biz.notice', 'biz.chooseArea',
  'biz.tabsTitle', 'biz.subtabsTitle', 'biz.servicesTitle', 'biz.whyUsTitle', 'biz.brandsTitle', 'biz.brandsSub',
  'biz.requestsTitle', 'biz.requestsSub', 'biz.newRequest', 'biz.requestsEmptyTitle', 'biz.requestsEmptyText',
  'biz.requests.kind', 'biz.trackingTitle', 'biz.trackingSub', 'biz.viewTracking', 'biz.progress.label', 'biz.progress.done',
  'biz.stats.networks.value', 'biz.stats.networks.label', 'biz.stats.networks.sub',
  'biz.stats.fee.value', 'biz.stats.fee.label', 'biz.stats.fee.sub',
  'biz.stats.alwaysOpen.value', 'biz.stats.alwaysOpen.label', 'biz.stats.alwaysOpen.sub',
  'biz.heroChip.nonCustodial', 'biz.heroChip.api', 'biz.heroChip.support',
  'biz.tabs.partnership', 'biz.tabs.followup', 'biz.tabsSub.partnership', 'biz.tabsSub.followup',
  'biz.subtab.services', 'biz.subtab.brands', 'biz.subtab.requests', 'biz.subtab.tracking',
  'biz.panelHint.services', 'biz.panelHint.brands', 'biz.panelHint.requests', 'biz.panelHint.tracking',
  'biz.status.pending', 'biz.status.review', 'biz.status.responded',
  'biz.demo.arta', 'biz.demo.noor', 'biz.demo.bitplus', 'biz.demo.hoursAgo', 'biz.demo.daysAgo',
  'biz.tracking.totalRequests', 'biz.tracking.totalSub', 'biz.tracking.responded', 'biz.tracking.respondedSub',
  'biz.tracking.support', 'biz.tracking.supportSub', 'biz.tracking.pathTitle',
  'biz.tracking.progressLabel', 'biz.tracking.progressSub', 'biz.tracking.cta',
  'biz.form.description', 'biz.form.topic', 'biz.form.company', 'biz.form.companyPlaceholder', 'biz.form.name',
  'biz.form.namePlaceholder', 'biz.form.workEmail', 'biz.form.phoneOptional', 'biz.form.phonePlaceholder',
  'biz.form.message', 'biz.form.messagePlaceholder', 'biz.form.preparing', 'biz.form.submit', 'biz.form.responseTime',
  'biz.form.requiredError', 'biz.form.emailError', 'biz.form.ready', 'biz.form.emailBody',
  'biz.form.cancel', 'biz.form.close',
  ...OFFERS.flatMap((id) => [`biz.offer.${id}.title`, `biz.offer.${id}.body`, `biz.offerMeta.${id}`]),
  ...BRANDS.flatMap((id) => [`biz.brand.${id}`, `biz.brandTag.${id}`]),
  ...['conversation', 'proposal', 'launch'].flatMap((id) => [`biz.steps.${id}.title`, `biz.steps.${id}.description`]),
  ...['nonCustodial', 'integration', 'revenue'].flatMap((id) => [`biz.benefits.${id}.title`, `biz.benefits.${id}.body`])
];

for (const [name, dict] of [['fa', fa], ['en', en]]) {
  const missing = FULL.filter((k) => !exists(dict, k));
  if (missing.length) fail(`${name}: missing ${missing.join(', ')}`);
  else ok(`${name}: all ${FULL.length} Business keys resolve`);
}

/* Tab + sub-tab labels must exist in every shipped locale (no raw keys). */
const TAB_KEYS = ['biz.tabs.partnership', 'biz.tabs.followup', 'biz.subtab.services', 'biz.subtab.brands', 'biz.subtab.requests', 'biz.subtab.tracking'];
for (const l of LOCALES) {
  const dict = load(l);
  const missing = TAB_KEYS.filter((k) => !exists(dict, k));
  if (missing.length) fail(`${l}: missing tab labels ${missing.join(', ')}`);
}
ok('all 12 locales: tab + sub-tab labels resolve');

/* Persian screen must be Persian; English screen must not leak Persian. */
const FA_MUST_BE_PERSIAN = ['biz.tabs.partnership', 'biz.tabs.followup', 'biz.subtab.services', 'biz.subtab.brands',
  'biz.subtab.requests', 'biz.subtab.tracking', 'biz.title', 'biz.intro', 'biz.requestsTitle', 'biz.trackingTitle'];
for (const k of FA_MUST_BE_PERSIAN) if (!PERSIAN_RE.test(get(fa, k) || '')) fail(`fa ${k} has no Persian script`);
ok('fa: tab labels and headings contain Persian script');
for (const k of FULL) if (PERSIAN_RE.test(get(en, k) || '')) fail(`en ${k} contains Persian script`);
ok('en: no Persian leakage in any Business string');

/* No hardcoded display strings may creep back into the page. */
const jsx = readFileSync(new URL('../src/pages/Business.jsx', import.meta.url), 'utf8');
if (PERSIAN_RE.test(jsx)) fail('Business.jsx contains hardcoded Persian/Arabic-script copy');
else ok('Business.jsx: zero hardcoded Persian copy');
if (/۲۴\/۷|biz\.tabs\.partnership'\)\s*\|\|/.test(jsx)) fail('Business.jsx re-hardcoded a localized value');
if (!jsx.includes("t(`biz.tabs.${tab.id}`)") || !jsx.includes("t(`biz.subtab.${st.id}`)")) fail('tab labels no longer read from i18n');
else ok('Business.jsx: tab/sub-tab labels read from i18n');

console.log(failures ? `\n${failures} failure(s)` : '\nBusiness locale probe: PASS');
process.exit(failures ? 1 : 0);
