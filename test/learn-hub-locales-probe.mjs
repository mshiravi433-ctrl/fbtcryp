/**
 * LEARN HUB — LOCALE + STYLE INTEGRITY PROBE
 * ---------------------------------------------------------------------------
 * Regression guard for the bugs the 2026 Learn hub redesign existed to fix:
 *
 *   · a label rendered as a raw i18n key on a Persian screen — `help.terms`
 *     and `help.privacy` shipped that way because the resource list derived
 *     its key as `help.${id}` while those two labels live under `terms.title`
 *     and `privacy.title`;
 *   · tab and sub-tab labels existing in two locales out of twelve, so nine
 *     of them printed English keys inside a translated page;
 *   · a count typed into the markup (`14 guides`) instead of counted from the
 *     array it describes, which goes stale the day a guide is added;
 *   · accent-coloured text on glass with no light-theme partner — cyan on a
 *     white card is 1.4:1;
 *   · a stray <p> inside `role="tablist"`.
 *
 * Resolves every key the four screens read against fa + en, the tab and
 * sub-tab labels against all twelve locales, and inspects the stylesheet for
 * the three house rules (theme · RTL · motion).
 *
 * Run: node test/learn-hub-locales-probe.mjs
 */
import { readFileSync } from 'node:fs';

const LOCALES = ['en', 'fa', 'ar', 'zh', 'hi', 'es', 'fr', 'ru', 'tr', 'ur', 'id', 'pt'];
const PERSIAN_RE = /[؀-ۿ]/;
let failures = 0;
const fail = (m) => { failures += 1; console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);
const get = (o, d) => d.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const exists = (o, d) => typeof get(o, d) === 'string' && get(o, d).length > 0;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const load = (l) => JSON.parse(read(`../src/i18n/locales/${l}.json`));

const fa = load('fa');
const en = load('en');

/* Comments stripped: the rule is about RENDERED copy. A verbatim quote of a
   bug report inside a /* *\/ explanation is prose, not UI — and this file's
   own header is full of them. */
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TAB_IDS = ['help', 'docs', 'videos'];
const SUBTAB_IDS = ['faq', 'support', 'lessons', 'paths'];
const LEVEL_IDS = ['beginner', 'intermediate', 'pro'];

const FULL = [
  'learn.title', 'learn.kicker', 'learn.heroTitle', 'learn.intro', 'learn.tabsTitle', 'learn.subtabsTitle',
  ...TAB_IDS.flatMap((id) => [`learn.tabs.${id}`, `learn.tabsSub.${id}`]),
  ...SUBTAB_IDS.map((id) => `learn.subtab.${id}`),
  ...['faq', 'support', 'lessons', 'paths', 'beginner', 'intermediate', 'pro'].map((id) => `learn.hint.${id}`),
  'learn.stats.guides', 'learn.stats.faq', 'learn.stats.lessons',
  'learn.faq.searchLabel', 'learn.faq.searchPlaceholder', 'learn.faq.emptyTitle', 'learn.faq.emptyBody', 'learn.faq.clear',
  'learn.support.title', 'learn.support.open', 'learn.support.emailSub', 'learn.support.telegramSub', 'learn.support.scamTitle',
  'learn.videos.handle', 'learn.videos.pathsTitle', 'learn.videos.lessonsCount', 'learn.videos.pathsNote',
  /* the copy the three screens reuse from their own namespaces */
  'help.title', 'help.faqTitle', 'help.guideCta', 'help.guideCtaSub', 'help.contactUs', 'help.contactUsSub',
  'help.telegram', 'help.email', 'help.resources', 'help.docs', 'help.docsSub', 'help.audit', 'help.auditSub',
  'help.github', 'help.githubSub', 'help.scamWarning', 'terms.title', 'privacy.title',
  'docs.title', 'docs.pitfall', 'docs.watchEn', 'docs.videoNote', 'disclaimer.title', 'nav.aparat', 'common.back',
  ...LEVEL_IDS.map((id) => `docs.level.${id}`),
  ...['start', 'security', 'why', 'strategy', 'swap', 'portfolio', 'farm', 'signals', 'trade', 'smartwallet', 'p2p', 'orders', 'intentos', 'dydx']
    .flatMap((id) => [`docs.${id}.title`, `docs.${id}.sub`, `docs.${id}.pitfall`])
];

for (const [name, dict] of [['fa', fa], ['en', en]]) {
  const missing = FULL.filter((k) => !exists(dict, k));
  if (missing.length) fail(`${name}: missing ${missing.join(', ')}`);
  else ok(`${name}: all ${FULL.length} Learn-hub keys resolve`);
}

/* Tab + sub-tab labels must exist in every shipped locale (no raw keys). */
const TAB_KEYS = [
  ...TAB_IDS.flatMap((id) => [`learn.tabs.${id}`, `learn.tabsSub.${id}`]),
  ...SUBTAB_IDS.map((id) => `learn.subtab.${id}`),
  ...LEVEL_IDS.map((id) => `docs.level.${id}`)
];
for (const l of LOCALES) {
  const dict = load(l);
  const missing = TAB_KEYS.filter((k) => !exists(dict, k));
  if (missing.length) fail(`${l}: missing tab labels ${missing.join(', ')}`);
}
ok(`all 12 locales: ${TAB_KEYS.length} tab / sub-tab labels resolve`);

/* Persian screen must be Persian; English screen must not leak Persian. */
const FA_MUST_BE_PERSIAN = [
  'learn.title', 'learn.kicker', 'learn.heroTitle', 'learn.intro', 'learn.tabsTitle', 'learn.subtabsTitle',
  ...TAB_IDS.flatMap((id) => [`learn.tabs.${id}`, `learn.tabsSub.${id}`]),
  ...SUBTAB_IDS.map((id) => `learn.subtab.${id}`),
  ...['faq', 'support', 'lessons', 'paths', 'beginner', 'intermediate', 'pro'].map((id) => `learn.hint.${id}`),
  'learn.stats.guides', 'learn.stats.faq', 'learn.stats.lessons',
  'learn.faq.searchLabel', 'learn.faq.searchPlaceholder', 'learn.faq.emptyTitle', 'learn.faq.emptyBody', 'learn.faq.clear',
  'learn.support.title', 'learn.support.open', 'learn.support.emailSub', 'learn.support.telegramSub', 'learn.support.scamTitle',
  'learn.videos.handle', 'learn.videos.pathsTitle', 'learn.videos.lessonsCount', 'learn.videos.pathsNote'
];
for (const k of FA_MUST_BE_PERSIAN) if (!PERSIAN_RE.test(get(fa, k) || '')) fail(`fa ${k} has no Persian script`);
ok(`fa: ${FA_MUST_BE_PERSIAN.length} labels and messages contain Persian script`);

/* The count is an interpolation, never a digit baked into the sentence —
   «۶ درس در این سطح» would lie the day a seventh lesson appears. */
for (const [name, dict] of [['fa', fa], ['en', en]]) {
  const s = get(dict, 'learn.videos.lessonsCount') || '';
  if (!s.includes('{{n}}')) fail(`${name} learn.videos.lessonsCount hardcodes its count: ${s}`);
  if (/\d/.test(s)) fail(`${name} learn.videos.lessonsCount carries a literal digit: ${s}`);
}
ok('fa+en: the lessons-count sentence interpolates {{n}}');

for (const k of FULL) if (PERSIAN_RE.test(get(en, k) || '')) fail(`en ${k} contains Persian script`);
ok('en: no Persian leakage in any Learn-hub string');

/* ------------------------------ the screens ------------------------------ */
const FILES = {
  Learn: '../src/pages/Learn.jsx',
  Help: '../src/pages/Help.jsx',
  Docs: '../src/pages/Docs.jsx',
  AparatVideos: '../src/pages/AparatVideos.jsx',
  LearnHub: '../src/components/learn/LearnHub.jsx',
  SubTabRail: '../src/components/learn/SubTabRail.jsx'
};

for (const [name, path] of Object.entries(FILES)) {
  const code = stripComments(read(path));
  if (PERSIAN_RE.test(code)) fail(`${name}.jsx contains hardcoded Persian copy outside comments`);
}
ok('screens: zero hardcoded Persian copy outside comments');

/* Labels are built from a prefix, so one grep can see every one of them. */
const hub = read(FILES.LearnHub);
const rail = read(FILES.SubTabRail);
if (!/t\(`learn\.tabs\.\$\{tab\.id\}`\)/.test(hub)) fail('LearnHub no longer reads its tab labels from i18n');
else ok('LearnHub: main-tab labels read from i18n');
if (!/t\(`\$\{labelPrefix\}\.\$\{st\.id\}`\)/.test(rail)) fail('SubTabRail no longer reads its sub-tab labels from i18n');
else ok('SubTabRail: sub-tab labels read from i18n');

/* Every resource row names its key outright — `help.${id}` is how two rows
   shipped as raw keys. */
const help = read(FILES.Help);
if (/t\(`help\.\$\{id\}`\)/.test(help)) fail('Help.jsx derives a resource label as help.${id} again');
else ok('Help.jsx: every document row names its own translation key');

/* The counts come from the arrays the screens render from. */
const learn = read(FILES.Learn);
for (const needle of ['DOC_SECTIONS.length', 'APARAT_COURSES.length', 'faqList(']) {
  if (!learn.includes(needle)) fail(`Learn.jsx no longer derives its counts from ${needle}`);
}
if (/\d+\s*\)?\s*,\s*label:\s*t\('learn\.stats/.test(learn)) fail('Learn.jsx typed a hero count by hand');
ok('Learn.jsx: hero chips and tab badges are counted, not typed');

/* The hint is a SIBLING of the sub-tab tablist, never a child. */
if (!/\)}\s*[\s\S]{0,120}?\{hint \? <p className="lh-hint">/.test(rail)) {
  fail('the hint is not a sibling of the sub-tab tablist');
} else ok('SubTabRail: the hint sits outside the tablist');

/* ---------------------------- the stylesheet ---------------------------- */
const css = read('../src/styles/learn-hub.css');

/* Accent-on-glass text needs a light-theme partner or it is unreadable in the
   light theme: #00e5ff on a white card is ~1.4:1. */
const ACCENT_TEXT = ['.lh-kicker', '.lh-contact-cta', '.lh-doc-video', '.lh-mini--accent',
  '.lh-play-toggle', '.lh-alert-icon', '.lh-pitfall-icon', '.lh-note-icon', '.lh-copy.is-copied',
  '.lh-contact-icon', '.lh-doc-icon', '.lh-cta-icon', '.lh-link-icon', '.lh-doc-order',
  '.lh-contact-badge', '.lh-search-ico', '.lh-path-mark'];
const escaped = (sel) => sel.replace(/[.[\]]/g, '\\$&');
const unthemed = ACCENT_TEXT.filter(
  (sel) => !new RegExp(`:root\\[data-theme='light'\\][^{]*${escaped(sel)}`, 's').test(css)
);
if (unthemed.length) fail(`no light-theme override for ${unthemed.join(', ')}`);
else ok(`css: ${ACCENT_TEXT.length} accent-on-glass rules have a light-theme partner`);

/* Everything that sits ON a gradient tile takes its colour from `--lh-ink`:
   near-black on the dark theme, white on the light one. The variable must flip
   or every lit tile loses its glyph in the light theme at once. */
if (!/:root\[data-theme='light'\][^{]*\{[^}]*--lh-ink:\s*#fff/.test(css)) fail('--lh-ink is not flipped to white for the light theme');
else ok('css: --lh-ink flips for the light theme');

/* The channel icons (Telegram, email, contact) sit on a GRADIENT tile. The
   first pass shipped the tile with no background at all: a near-black glyph on
   transparent glass, invisible on the dark theme — «ایکون‌های تلگرام و ایمیل و
   تماس را درست کن». An icon tile that paints no background is that bug again. */
for (const sel of ['.lh-contact-icon', '.lh-cta-icon', '.lh-doc-icon', '.lh-link-icon', '.lh-path-mark']) {
  const rule = (css.match(new RegExp(`${escaped(sel)} \\{[^}]*\\}`)) || [''])[0];
  if (!/background(?:-image)?:\s*(?:linear|radial|conic)-gradient|background:\s*(?:var|color-mix)/.test(rule)) {
    fail(`${sel} paints no background — its glyph would be invisible on the dark theme`);
  }
}
ok('css: every icon tile paints its own background');

/* The email tile is an <a>: without this it inherits the browser underline. */
if (!/\.lh-contact[^{]*\{[^}]*text-decoration:\s*none/.test(css)) fail('.lh-contact lacks text-decoration: none (the email tile is a link)');
else ok('css: the contact link tile is not underlined');

/* Buttons do not inherit the page font: any text inside a button without
   `font: inherit` renders in the UA default and falls back to the system
   Arabic face instead of the app face. */
const buttonRules = [...css.matchAll(/([^{}]+)\{([^{}]*cursor:\s*pointer[^{}]*)\}/g)];
const uaFont = buttonRules.filter(([, , body]) => !/font:\s*inherit|font-family/.test(body)).map(([sel]) => sel.trim().split('\n').pop());
if (uaFont.length) fail(`clickable rules without font: inherit — ${uaFont.join(', ')}`);
else ok(`css: all ${buttonRules.length} clickable rules inherit the page font`);

/* No keyframe may fade to zero — a loop that disappears reads as a loading
   placeholder, and at 60fps for minutes it reads as a hardware fault. */
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
for (const sel of ['.lh-orb', '.lh-orb-halo', '.lh-orb-spin--a', '.lh-sheen']) {
  if (!motion.includes(sel)) fail(`prefers-reduced-motion does not stop ${sel}`);
}
if (motion.trim()) ok('css: reduced-motion stops the orbs, the emblem and the card sweep');

/* The hero must stay compact — see the Business hero that grew to 460px. */
const heroRule = (css.match(/\.lh-hero \{[^}]*\}/) || [''])[0];
if (!/padding:\s*1[0-9]px/.test(heroRule)) fail('hero padding is not on the compact scale (10–19px)');
else ok('css: hero padding stays compact');
if (/min-height|min-block-size/.test(heroRule)) fail('hero has a min-height — that is what let it stretch');
else ok('css: hero has no min-height');
if (!/\.lh-hero-title \{[^}]*font-size:\s*clamp\(2[0-6]px/.test(css)) fail('hero title clamp starts above 26px');
else ok('css: hero title clamp starts at 26px or less');

/* RTL: no physical direction properties anywhere in the file. */
const physical = [...css.matchAll(/(?:^|[;{\s])(margin|padding)-(left|right)\s*:/g)];
if (physical.length) fail(`css uses ${physical.length} physical direction property/properties`);
else ok('css: logical properties only (RTL-safe)');

console.log(failures ? `\n${failures} failure(s)` : '\nLearn hub locale probe: PASS');
/*
 * Exit ONLY on failure — the convention test/about-locales-probe.mjs follows.
 * A bare `process.exit(0)` here would end the whole `test/run.mjs` process at
 * import time and silently skip every suite imported after this one.
 */
if (failures) process.exit(1);
