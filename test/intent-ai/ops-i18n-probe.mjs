/**
 * FBT INTENT OS — OPERATIONS CENTER LANGUAGE / ICON / DEAD-BUTTON PROBE.
 * ---------------------------------------------------------------------------
 * Locks down the three defects the Operations Center actually shipped with,
 * each of which was invisible to every existing test because each was a
 * *content* bug inside code that ran perfectly:
 *
 *   A. ENGLISH UI IN A PERSIAN APP.
 *      The catalog's 15 categories and 80 cards are English data literals, and
 *      the panels wrote their chrome as `locale === 'en' ? 'X' : 'Y'`. That is
 *      a two-branch switch in a three-language app — `ar` silently fell to the
 *      Persian branch — and it compared against a bare `'en'` while the live
 *      locale is `'en-US'`, which is how an English user got Persian labels.
 *
 *   B. EMOJI ICONS.
 *      Font glyphs: different on every OS, cannot take `currentColor` (a
 *      disabled card kept a bright icon over grey text), and several used here
 *      have no glyph at all in the default Android emoji font.
 *
 *   C. DEAD BUTTONS.
 *      A chat card feeds a PROMPT back into `understandIntent`. Any prompt the
 *      parser classifies as GENERAL produces "could not map that to a module"
 *      — a button that looks live and answers nothing. The old code fell back
 *      to `card.title`, i.e. it fed bare English UI labels to a parser whose
 *      lexicon is mostly Persian. Five cards were dead this way.
 *
 * The rule this file enforces, and the reason C keeps coming back: translating
 * a LABEL is safe, translating a PROMPT is not. Anything fed back into the
 * parser must consist of words the lexicon actually contains.
 */

import { CATEGORIES, OPERATIONS } from '../../src/lib/intent-ai/os/opsCatalog.js';
import {
  localizeOpsCard,
  localizeOpsCategory,
  missingOpsTranslations,
  langOf
} from '../../src/lib/intent-ai/os/opsCatalogI18n.js';
import {
  OPS_PANEL_STRINGS,
  opsText,
  opsPhrase,
  intlLocale,
  missingOpsPanelStrings
} from '../../src/lib/intent-ai/os/opsPanelStrings.js';
import {
  opsCardPrompt,
  cardsMissingPrompts,
  promptsThatFailToClassify
} from '../../src/lib/intent-ai/os/opsCardPrompts.js';
import { understandIntent } from '../../src/lib/intent-ai/os/intentUnderstanding.js';
import { CHIPS } from '../../src/lib/intent-ai/os/suggestionEngine.js';
import { readFileSync } from 'node:fs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
};

const LANGS = ['fa', 'en', 'ar'];
/* Real i18next values, not the bare subtags. The `locale === 'en'` bug was
   invisible to any test that only ever passed 'en'. */
const TAGS = ['fa-IR', 'en-US', 'ar-SA'];

try {
  /* === A. catalog translations ========================================== */

  for (const lang of ['fa', 'ar']) {
    const missing = missingOpsTranslations({ cards: OPERATIONS, categories: CATEGORIES, lang });
    check(`every ops category and card has a ${lang} translation`,
      missing.cards.length === 0 && missing.categories.length === 0,
      [...missing.categories, ...missing.cards].slice(0, 8).join(', '));
  }

  check('langOf normalizes a full BCP-47 tag, not just a bare subtag',
    langOf('fa-IR') === 'fa' && langOf('en-US') === 'en' && langOf('ar-SA') === 'ar');

  /*
   * An unknown LANGUAGE reads as English. An ABSENT locale is different: it
   * means "nobody told us", and this app's default is Persian, so it must not
   * silently become an English screen for the majority of users.
   */
  check('an unknown language falls back to English rather than to a raw key',
    langOf('de-DE') === 'en' && langOf('zz') === 'en');
  check('an absent locale falls back to the app default, not to English',
    langOf(undefined) === 'fa' && langOf(null) === 'fa' && langOf('') === 'fa');

  /*
   * The whole point: with the app in Persian, no card may still read English.
   * Compared against the untranslated literal, so a translation that was
   * copy-pasted from the English column fails here.
   */
  {
    const untranslated = OPERATIONS.filter((card) => {
      const fa = localizeOpsCard(card, 'fa-IR');
      return fa.title === card.title && /[a-z]/i.test(card.title);
    });
    check('no ops card still shows its English title when the app is Persian',
      untranslated.length === 0,
      untranslated.slice(0, 6).map((c) => c.id).join(', '));

    /*
     * Brand names stay in their own spelling. "dYdX" is the name of a venue,
     * not an English word, and transliterating it to «دیدکس» would make the
     * category unrecognisable and unsearchable. The exemption is an explicit
     * list so that a genuinely untranslated label cannot hide behind it.
     */
    const PROPER_NOUNS = new Set(['dydx']);
    const cats = CATEGORIES.filter((c) => !PROPER_NOUNS.has(c.id)
      && localizeOpsCategory(c, 'fa-IR') === c.title
      && /[a-z]/i.test(c.title));
    check('no ops category still shows its English label when the app is Persian',
      cats.length === 0, cats.map((c) => c.id).join(', '));

    check('a brand-name category is still declared in every language',
      [...PROPER_NOUNS].every((id) => {
        const cat = CATEGORIES.find((c) => c.id === id);
        return cat && LANGS.every((l) => typeof localizeOpsCategory(cat, l) === 'string');
      }));
  }

  /*
   * Arabic is a real third language, not "whatever Persian does". This is the
   * assertion the old two-branch ternaries could never have passed.
   */
  {
    const arSameAsFa = OPERATIONS.filter((card) => {
      const ar = localizeOpsCard(card, 'ar-SA');
      const fa = localizeOpsCard(card, 'fa-IR');
      return ar.title === fa.title;
    });
    check('Arabic ops titles are Arabic, not a copy of the Persian ones',
      arSameAsFa.length === 0,
      arSameAsFa.slice(0, 6).map((c) => c.id).join(', '));
  }

  /*
   * Localizing must never touch the fields the panel dispatches on. If a
   * translation could change `action` or `route`, switching language would
   * change what a button DOES — the worst possible i18n bug.
   */
  {
    const drifted = OPERATIONS.filter((card) => {
      const fa = localizeOpsCard(card, 'fa');
      return fa.action !== card.action
        || fa.capabilityId !== card.capabilityId
        || fa.route !== card.route
        || fa.category !== card.category
        || Boolean(fa.requiresWallet) !== Boolean(card.requiresWallet);
    });
    check('localizing a card changes only its text, never its behaviour',
      drifted.length === 0, drifted.map((c) => c.id).join(', '));
  }

  /* === A2. panel chrome strings ========================================= */

  for (const lang of LANGS) {
    const missing = missingOpsPanelStrings(lang);
    check(`every panel string is translated into ${lang}`,
      missing.length === 0, missing.slice(0, 8).join(', '));
  }

  /*
   * The exact shape of the original bug: a full locale tag must resolve. If
   * `opsText` ever regresses to `locale === 'en'`, 'en-US' returns Persian and
   * this fails.
   */
  check("panel strings resolve for 'en-US', not only for bare 'en'",
    opsText('ops.title', 'en-US') === 'Operations Center'
    && opsText('ops.title', 'en') === 'Operations Center');

  check("panel strings resolve for 'fa-IR' and 'ar-SA'",
    opsText('ops.title', 'fa-IR') === 'مرکز عملیات'
    && opsText('ops.title', 'ar-SA') === 'مركز العمليات');

  check('Arabic panel chrome is distinct from the Persian chrome',
    Object.keys(OPS_PANEL_STRINGS).every((k) => {
      const row = OPS_PANEL_STRINGS[k];
      /* A handful of words are legitimately identical across the two
         languages (e.g. متوقف); only require that most differ. */
      return typeof row.ar === 'string';
    })
    && Object.values(OPS_PANEL_STRINGS).filter((r) => r.ar === r.fa).length < 6);

  check('an interpolated phrase puts the number in each language\'s own word order',
    opsPhrase('everyMinutes', 'en-US', 15) === 'every 15m'
    && opsPhrase('everyMinutes', 'fa-IR', 15).includes('۱۵') === false
    && opsPhrase('everyMinutes', 'fa-IR', 15) === 'هر 15 دقیقه'
    && opsPhrase('everyMinutes', 'ar-SA', 15) === 'كل 15 دقيقة');

  check('number/date formatting uses a locale matching the UI language',
    intlLocale('en-US') === 'en-US' && intlLocale('fa-IR') === 'fa-IR' && intlLocale('ar-SA') === 'ar');

  check('an unknown panel key returns the key, never undefined on screen',
    opsText('no.such.key', 'fa') === 'no.such.key');

  /* === B. icons ========================================================= */

  {
    /*
     * `OpsIcons.jsx` is JSX, so it cannot be imported by this Node probe. Its
     * source is read instead — enough to prove every category and card id has
     * an icon mapping and that no emoji survived into the components.
     */
    const iconsSrc = readFileSync(new URL('../../src/components/OpsIcons.jsx', import.meta.url), 'utf8');
    const setSrc = readFileSync(new URL('../../src/components/OpsIconSet.jsx', import.meta.url), 'utf8');
    const panelsSrc = readFileSync(new URL('../../src/components/IntentOpsPanels.jsx', import.meta.url), 'utf8');

    check('every ops category id has an icon mapping',
      CATEGORIES.every((c) => iconsSrc.includes(`${c.id}:`) || iconsSrc.includes(`'${c.id}'`)),
      CATEGORIES.filter((c) => !iconsSrc.includes(c.id)).map((c) => c.id).join(', '));

    /* Cards fall back to their category icon, so the requirement is that the
       resolution path exists, not that all 80 are enumerated. */
    check('cards resolve an icon through an explicit map with a category fallback',
      /CARD_ICONS/.test(iconsSrc) && /CATEGORY_ICONS/.test(iconsSrc)
      && /OpsCardIcon/.test(iconsSrc) && /OpsCategoryIcon/.test(iconsSrc));

    check('the panels render icon components, not the catalog emoji field',
      /<OpsCardIcon/.test(panelsSrc) && /<OpsCategoryIcon/.test(panelsSrc)
      && !/\{card\.icon\}/.test(panelsSrc) && !/\{c\.icon\}/.test(panelsSrc));

    /*
     * Emoji are outside the BMP; a line-art SVG set contains none.
     *
     * Comments are stripped first: the header of each of these files QUOTES
     * the offending emoji as the reason they were removed, and a check that
     * cannot tell a rationale from a regression is a check people delete.
     */
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    const stripComments = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    check('the icon components render no emoji',
      !emoji.test(stripComments(iconsSrc)) && !emoji.test(stripComments(setSrc)));

    check('ops icons inherit colour so a disabled card dims as one piece',
      /currentColor/.test(setSrc));

    /*
     * The ops-only icons must NOT sit in Icons.jsx: that module is imported by
     * the nav, lands in the first-paint chunk and is under a size ratchet in
     * test/wiring.mjs, while these are reachable only from the lazy /intent
     * route.
     */
    const mainIcons = readFileSync(new URL('../../src/components/Icons.jsx', import.meta.url), 'utf8');
    const opsOnly = [...setSrc.matchAll(/^export const (Icon\w+)/gm)].map((m) => m[1]);
    check('ops-only icons stay out of the first-paint icon module',
      opsOnly.length > 0 && opsOnly.every((n) => !new RegExp(`^export const ${n}\\b`, 'm').test(mainIcons)),
      opsOnly.filter((n) => new RegExp(`^export const ${n}\\b`, 'm').test(mainIcons)).join(', '));
  }

  /* === C. dead buttons ================================================== */

  {
    const missing = cardsMissingPrompts(OPERATIONS);
    check('every chat-answering card has a written prompt',
      missing.length === 0, missing.slice(0, 8).join(', '));
  }

  /*
   * THE central assertion. Every prompt, in every language it is offered in,
   * must classify to a real intent type. A GENERAL result here is a button
   * that renders, clicks, and answers "could not map that to a module".
   */
  {
    const dead = promptsThatFailToClassify(understandIntent, ['fa', 'en']);
    check('no ops card prompt is dead (classifies as GENERAL)',
      dead.length === 0,
      dead.slice(0, 10).map((d) => `${d.id}/${d.locale}: "${d.prompt}"`).join(' | '));
  }

  /*
   * A card with no prompt must NAVIGATE. The old fallback sent `card.title`,
   * so an English label went into a Persian-lexicon parser and came back
   * GENERAL. Asserting the helper returns null (rather than the title) is what
   * stops that fallback from being reintroduced.
   */
  {
    const nonChat = OPERATIONS.filter((c) => !['read', 'quote'].includes(c.action)
      && !['goals_create', 'auto_recurring', 'auto_scheduled'].includes(c.id));
    const leaked = nonChat.filter((c) => {
      const p = opsCardPrompt(c, 'fa');
      return p != null && p === c.title;
    });
    check('a non-chat card never falls back to sending its own title as a prompt',
      leaked.length === 0, leaked.slice(0, 6).map((c) => c.id).join(', '));

    check('every non-chat card has somewhere to go instead of a prompt',
      nonChat.every((c) => opsCardPrompt(c, 'fa') != null || typeof c.route === 'string'),
      nonChat.filter((c) => opsCardPrompt(c, 'fa') == null && typeof c.route !== 'string')
        .map((c) => c.id).join(', '));
  }

  /*
   * Suggestion chips are the same contract by a different route: their
   * `prompt` is also fed straight back into the parser.
   */
  {
    const dead = [];
    let total = 0;
    for (const [id, langs] of Object.entries(CHIPS)) {
      for (const lang of LANGS) {
        const prompt = langs?.[lang]?.prompt;
        if (!prompt) continue;
        total += 1;
        const parsed = understandIntent(prompt);
        if (!parsed || parsed.type === 'GENERAL') dead.push(`${id}/${lang}: "${prompt}"`);
      }
    }
    check('every suggestion chip is defined in all three languages', total >= Object.keys(CHIPS).length * 3);
    check('no suggestion chip is dead (classifies as GENERAL)',
      dead.length === 0, dead.slice(0, 8).join(' | '));

    /* Labels are translated; prompts stay in a language the parser has a
       lexicon for. Asserting the Arabic LABEL is Arabic keeps someone from
       "fixing" the deliberate English prompt by translating the whole row. */
    const untranslatedLabels = Object.entries(CHIPS)
      .filter(([, langs]) => langs?.ar?.label && langs.ar.label === langs.en?.label)
      .map(([id]) => id);
    check('chip labels are translated into Arabic even though the prompts are not',
      untranslatedLabels.length === 0, untranslatedLabels.slice(0, 6).join(', '));
  }

  /* === D. the panels no longer hard-code a two-language switch ========== */

  {
    const panelsSrc = readFileSync(new URL('../../src/components/IntentOpsPanels.jsx', import.meta.url), 'utf8');
    /* Ignore the explanatory comment; count only real code. */
    const code = panelsSrc.split('\n').filter((l) => !/^\s*[*/]/.test(l)).join('\n');
    const ternaries = (code.match(/locale === 'en'\s*\?/g) || []).length;
    check('the ops panels no longer branch on a bare two-language locale check',
      ternaries === 0, `${ternaries} remaining`);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nops-i18n probe: ${passed}/${results.length} passed`);
  if (passed !== results.length) {
    console.error(results.filter((r) => !r.ok)
      .map((r) => `  ✗ ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`).join('\n'));
    process.exit(1);
  }
  console.log('OK: intent-ai/ops-i18n-probe');
} catch (err) {
  console.error('\nops-i18n probe crashed:', err);
  process.exit(1);
}
