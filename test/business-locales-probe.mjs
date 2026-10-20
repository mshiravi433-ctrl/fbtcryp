/**
 * BUSINESS PAGE — LOCALE INTEGRITY PROBE
 *
 * Regression guard for the bug where `biz.tabs.*` / `biz.subtab.*` existed in
 * NO locale, so the Business tab labels rendered as raw i18n keys (English
 * strings on the Persian screen), demo request times were hardcoded Persian
 * in every language, and «۲۴/۷» was hardcoded in the tracking panel.
 *
 * Since the B2B console redesign it also guards the failures that redesign
 * existed to fix:
 *
 *   · hardcoded English in the JSX — the email placeholder `name@company.com`
 *     and the mail subject `[Business] …` were literal, so a Persian form
 *     still spoke English in two places;
 *   · a progress sentence with the numbers baked into the translation
 *     («۲ از ۳ قدم تکمیل شده»), which silently lies the day a step changes;
 *   · the panel hint sitting INSIDE `role="tablist"`, so assistive tech counts
 *     a stray <span> as a tab;
 *   · accent-coloured text on glass (offer eyebrows, brand tags, filter
 *     counts) with no light-theme partner — cyan on white is 1.4:1.
 *
 * Resolves every key src/pages/Business.jsx reads against fa + en fully, the
 * tab/sub-tab labels against all twelve locales, and the keys test/wiring.mjs
 * also requires in every locale (biz.form.* among them) against all twelve.
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
const POINTS = ['listing', 'data', 'depth', 'slippage', 'brand', 'domain', 'docs', 'keys'];
const STATUSES = ['pending', 'review', 'responded'];

const FULL = [
  'biz.title', 'biz.intro', 'biz.badge', 'biz.heroKicker', 'biz.headerLive', 'biz.company', 'biz.website', 'biz.contact',
  'biz.requestPartnership', 'biz.atGlance', 'biz.selectTopic', 'biz.notice', 'biz.chooseArea',
  'biz.tabsTitle', 'biz.subtabsTitle', 'biz.servicesTitle', 'biz.whyUsTitle', 'biz.brandsTitle', 'biz.brandsSub',
  'biz.requestsTitle', 'biz.requestsSub', 'biz.newRequest', 'biz.requestsEmptyTitle', 'biz.requestsEmptyText',
  'biz.requests.kind', 'biz.trackingTitle', 'biz.trackingSub', 'biz.viewTracking', 'biz.progress.label', 'biz.progress.done',
  'biz.filterLabel', 'biz.emptyFilterTitle', 'biz.emptyFilterText',
  'biz.stats.networks.value', 'biz.stats.networks.label', 'biz.stats.networks.sub',
  'biz.stats.fee.value', 'biz.stats.fee.label', 'biz.stats.fee.sub',
  'biz.stats.alwaysOpen.value', 'biz.stats.alwaysOpen.label', 'biz.stats.alwaysOpen.sub',
  'biz.heroChip.nonCustodial', 'biz.heroChip.api', 'biz.heroChip.support',
  'biz.tabs.partnership', 'biz.tabs.followup', 'biz.tabsSub.partnership', 'biz.tabsSub.followup',
  'biz.subtab.services', 'biz.subtab.brands', 'biz.subtab.requests', 'biz.subtab.tracking',
  'biz.panelHint.services', 'biz.panelHint.brands', 'biz.panelHint.requests', 'biz.panelHint.tracking',
  'biz.status.pending', 'biz.status.review', 'biz.status.responded',
  'biz.filter.all', 'biz.filter.pending', 'biz.filter.review', 'biz.filter.responded',
  'biz.demo.arta', 'biz.demo.noor', 'biz.demo.bitplus', 'biz.demo.hoursAgo', 'biz.demo.daysAgo',
  'biz.tracking.totalRequests', 'biz.tracking.totalSub', 'biz.tracking.responded', 'biz.tracking.respondedSub',
  'biz.tracking.support', 'biz.tracking.supportSub', 'biz.tracking.pathTitle',
  'biz.tracking.progressLabel', 'biz.tracking.progressSub', 'biz.tracking.nextUp', 'biz.tracking.cta',
  'biz.form.description', 'biz.form.topic', 'biz.form.company', 'biz.form.companyPlaceholder', 'biz.form.name',
  'biz.form.namePlaceholder', 'biz.form.workEmail', 'biz.form.workEmailPlaceholder', 'biz.form.phoneOptional',
  'biz.form.phonePlaceholder', 'biz.form.message', 'biz.form.messagePlaceholder', 'biz.form.preparing',
  'biz.form.submit', 'biz.form.responseTime', 'biz.form.requiredError', 'biz.form.emailError', 'biz.form.ready',
  'biz.form.emailBody', 'biz.form.cancel', 'biz.form.close', 'biz.form.mailSubject', 'biz.form.notProvided',
  'biz.form.companyError', 'biz.form.nameError', 'biz.form.messageError', 'biz.form.chars', 'biz.form.privacy',
  ...OFFERS.flatMap((id) => [`biz.offer.${id}.title`, `biz.offer.${id}.body`, `biz.offerMeta.${id}`]),
  ...BRANDS.flatMap((id) => [`biz.brand.${id}`, `biz.brandTag.${id}`]),
  ...POINTS.map((id) => `biz.point.${id}`),
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

/*
 * The keys test/wiring.mjs also demands everywhere (`biz.form.*`, `biz.stats.*`,
 * `biz.benefits.*`, `biz.steps.*` plus five exact keys). They were missing
 * eleven-deep in nine of the twelve before the redesign — the delete-form
 * label and the close-form label among them.
 */
const WIREING_KEYS = [
  'biz.requestPartnership', 'biz.atGlance', 'biz.selectTopic', 'biz.whyUs', 'biz.path',
  ...['cancel', 'close', 'workEmailPlaceholder', 'mailSubject', 'notProvided', 'companyError',
      'nameError', 'messageError', 'chars', 'privacy'].map((k) => `biz.form.${k}`)
];
for (const l of LOCALES) {
  const dict = load(l);
  const missing = WIREING_KEYS.filter((k) => !exists(dict, k));
  if (missing.length) fail(`${l}: missing page-copy keys ${missing.join(', ')}`);
}
ok(`all 12 locales: ${WIREING_KEYS.length} page-copy keys resolve (wiring parity)`);

/* Persian screen must be Persian; English screen must not leak Persian. */
const FA_MUST_BE_PERSIAN = ['biz.tabs.partnership', 'biz.tabs.followup', 'biz.subtab.services', 'biz.subtab.brands',
  'biz.subtab.requests', 'biz.subtab.tracking', 'biz.title', 'biz.intro', 'biz.requestsTitle', 'biz.trackingTitle',
  'biz.headerLive', 'biz.filterLabel', 'biz.emptyFilterTitle', 'biz.filter.all', 'biz.filter.responded',
  ...POINTS.map((id) => `biz.point.${id}`),
  ...['companyError', 'nameError', 'messageError', 'privacy'].map((k) => `biz.form.${k}`)];
for (const k of FA_MUST_BE_PERSIAN) if (!PERSIAN_RE.test(get(fa, k) || '')) fail(`fa ${k} has no Persian script`);
ok(`fa: ${FA_MUST_BE_PERSIAN.length} labels and messages contain Persian script`);
for (const k of FULL) if (PERSIAN_RE.test(get(en, k) || '')) fail(`en ${k} contains Persian script`);
ok('en: no Persian leakage in any Business string');

/*
 * A progress sentence may not carry its own numbers. «۲ از ۳ قدم تکمیل شده»
 * reads fine until a fourth step appears, and then the ring and the sentence
 * disagree — which is the kind of lie a user notices on the screen they are
 * being asked to trust.
 */
for (const [name, dict] of [['fa', fa], ['en', en]]) {
  const sub = get(dict, 'biz.tracking.progressSub') || '';
  if (!sub.includes('{{done}}') || !sub.includes('{{total}}')) {
    fail(`${name} biz.tracking.progressSub hardcodes its counts: ${sub}`);
  }
}
ok('fa+en: the progress sentence interpolates {{done}}/{{total}}');

/* No hardcoded display strings may creep back into the page. */
const jsx = readFileSync(new URL('../src/pages/Business.jsx', import.meta.url), 'utf8');
if (PERSIAN_RE.test(jsx)) fail('Business.jsx contains hardcoded Persian/Arabic-script copy');
else ok('Business.jsx: zero hardcoded Persian copy');
if (/۲۴\/۷|biz\.tabs\.partnership'\)\s*\|\|/.test(jsx)) fail('Business.jsx re-hardcoded a localized value');
if (!jsx.includes("t(`biz.tabs.${tab.id}`)") || !jsx.includes("t(`biz.subtab.${st.id}`)")) fail('tab labels no longer read from i18n');
else ok('Business.jsx: tab/sub-tab labels read from i18n');

/* The two English literals the redesign pulled out of the JSX. */
for (const literal of ['name@company.com', '[Business]']) {
  if (jsx.includes(literal)) fail(`Business.jsx still hardcodes the English literal ${literal}`);
}
ok('Business.jsx: no hardcoded English literals (email placeholder, mail subject)');

/*
 * The panel hint is a SIBLING of the sub-tab tablist, never a child: a
 * tablist may only contain tabs, and a stray span inside it makes a screen
 * reader announce "3 of 4" on a two-tab rail.
 */
if (!/<\/div>[\s\S]{0,400}?<p className="biz-panel-hint">/.test(jsx)) {
  fail('the panel hint is not a sibling of the sub-tab tablist');
} else ok('Business.jsx: the panel hint sits outside the tablist');

/* The form is a real <form> with an accessible name, so role=form resolves. */
if (!/aria-labelledby=\{`\$\{uid\}-formtitle`\}/.test(jsx) || !/id=\{`\$\{uid\}-formtitle`\}/.test(jsx)) {
  fail('the request form has no accessible name');
} else ok('Business.jsx: the request form is labelled by its heading');

/* ---------------------------- the stylesheet ---------------------------- */
const css = readFileSync(new URL('../src/styles/business-modern.css', import.meta.url), 'utf8');

/*
 * Accent-on-glass text needs a light-theme partner or it is unreadable in
 * the light theme: #00e5ff on a white card is ~1.4:1.
 */
const ACCENT_TEXT = ['.biz-offer-eyebrow', '.biz-brand-tag', '.biz-form-kicker', '.biz-offer-point svg',
  '.biz-chip-status', '.biz-request-topic-icon', '.biz-brand-icon'];
const unthemed = ACCENT_TEXT.filter((sel) => !new RegExp(`:root\\[data-theme='light'\\][^{]*${sel.replace(/[.[\]]/g, '\\$&')}`, 's').test(css));
if (unthemed.length) fail(`no light-theme override for ${unthemed.join(', ')}`);
else ok(`css: ${ACCENT_TEXT.length} accent-on-glass rules have a light-theme partner`);

/*
 * No KEYFRAME may fade to zero — a loop that disappears reads as a loading
 * placeholder, and at 60fps for minutes it reads as a hardware fault.
 * (`opacity: 0` on an idle element like the hover sweep or the selected-tab
 * tick is fine: that is a state, not a cycle.)
 */
/* Brace-matched, because single-line keyframes (`@keyframes x { to { … } }`)
   defeat a "read to the next newline" scan and would be silently skipped. */
const keyframes = [];
for (let i = css.indexOf('@keyframes'); i !== -1; i = css.indexOf('@keyframes', i + 1)) {
  const open = css.indexOf('{', i);
  let depth = 0;
  let end = open;
  for (; end < css.length; end += 1) {
    if (css[end] === '{') depth += 1;
    else if (css[end] === '}') { depth -= 1; if (!depth) break; }
  }
  keyframes.push(css.slice(open, end + 1));
}
const blink = keyframes.filter((body) => /opacity:\s*0(\.\d+)?\s*;/.test(body));
if (blink.length) fail(`${blink.length} keyframe(s) fade to opacity 0`);
else ok(`css: none of the ${keyframes.length} keyframes fades to opacity 0`);

const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
for (const sel of ['.biz-offer-sheen', '.biz-orb', '.biz-live-dot']) {
  if (!motion.includes(sel)) fail(`prefers-reduced-motion does not stop ${sel}`);
}
if (motion.trim()) ok('css: reduced-motion stops the orbs, the live dot and the card sweep');

/* RTL: no physical direction properties anywhere in the file. */
const physical = [...css.matchAll(/(?:^|[;{\s])(margin|padding)-(left|right)\s*:/g)];
if (physical.length) fail(`css uses physical ${physical.length} physical direction property/properties`);
else ok('css: logical properties only (RTL-safe)');

console.log(failures ? `\n${failures} failure(s)` : '\nBusiness locale probe: PASS');
process.exit(failures ? 1 : 0);
