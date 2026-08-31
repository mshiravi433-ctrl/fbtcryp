/**
 * PHASE 208 — CHAT NAVIGATION PROBE ("intent os" opens the page)
 * ---------------------------------------------------------------------------
 * Reported as: typing "intent os" into the assistant does nothing — no page
 * opens. The parser is for money-shaped sentences; a page request never
 * reached anything that could open a screen, so the reply was a generic
 * "what do you want to do?".
 *
 * This probe pins the fix at two levels:
 *
 *   · the command layer (chatNavigation.js) recognises the page request in
 *     the phrasings real users type — Latin, Persian and open-style — and
 *     REFUSES the two cases that must never navigate: a question about the
 *     page ("intent os چیست") and a trade that happens to mention it
 *     ("swap 50 USDT to BNB on intent os")
 *   · the panel wiring (IntentAIPanel.jsx) intercepts the command before
 *     the parser, emits a `navigation` reply the chat renders, and performs
 *     the real hash write to #/intent — the app's HashRouter route.
 */
import { readFileSync } from 'node:fs';

const results = [];
const check = (name, ok) => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? '✓' : '✗'} ${name}`); };

const { parseNavigationCommand, navigationTargets } = await import('../../src/lib/intent-ai/chatNavigation.js');

try {
  /* ---------------- the page request opens ---------------- */
  const plain = parseNavigationCommand('intent os');
  check('"intent os" is a navigation to /intent',
    plain.ok === true && plain.target === 'intent-os' && plain.route === '/intent' && plain.labelKey);

  check('"INTENT OS" (uppercase) navigates', parseNavigationCommand('INTENT OS').ok === true);
  check('"intent-os" navigates', parseNavigationCommand('intent-os').ok === true);
  check('"intentos" navigates', parseNavigationCommand('intentos').ok === true);
  check('"intent. os" (punctuation) navigates', parseNavigationCommand('intent. os').ok === true);

  check('"باز کردن intent os" navigates',
    parseNavigationCommand('باز کردن intent os').ok === true);
  check('"برو به صفحهٔ intent os" navigates',
    parseNavigationCommand('برو به صفحهٔ intent os').ok === true);
  check('"open the intent os page" navigates',
    parseNavigationCommand('open the intent os page').ok === true);
  check('"اینتنت او اس" (Persian spelling) navigates',
    parseNavigationCommand('اینتنت او اس').ok === true);
  check('"اینتنت os" navigates', parseNavigationCommand('اینتنت os').ok === true);

  /* ---------------- the two cases that must NOT navigate ---------------- */
  const question = parseNavigationCommand('intent os چیست');
  check('a question about Intent OS is never navigated',
    question.ok === false && question.reason === 'question');
  check('"what is intent os" is never navigated',
    parseNavigationCommand('what is intent os').ok === false);
  check('"intent os چیه" is never navigated',
    parseNavigationCommand('intent os چیه').ok === false);

  const financial = parseNavigationCommand('swap 50 USDT to BNB on intent os');
  check('a trade that mentions Intent OS is never navigated',
    financial.ok === false && financial.reason === 'financial');
  check('"swap usdt to bnb intent os" (no digits) is still a trade, not a navigation',
    parseNavigationCommand('swap usdt to bnb intent os').ok === false);

  /* ---------------- ordinary chat is untouched ---------------- */
  check('a greeting is not a navigation', parseNavigationCommand('سلام').ok === false);
  check('an analysis request is not a navigation', parseNavigationCommand('تحلیل BTC').ok === false);
  check('empty input is not a navigation', parseNavigationCommand('').ok === false);
  check('a swap request is not a navigation', parseNavigationCommand('سواپ 100 USDC به ETH').ok === false);

  /* ---------------- the route table ---------------- */
  const targets = navigationTargets();
  check('the navigation table exposes the Intent OS route',
    targets.length >= 1 && targets.some((t) => t.id === 'intent-os' && t.route === '/intent'));

  /* ---------------- panel wiring (source-level, as the other phase
     probes verify wiring) ---------------- */
  const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');
  check('the panel intercepts the command before the parser',
    /parseNavigationCommand\(value\)/.test(panel));
  check('the panel emits a navigation reply message',
    /type:\s*'navigation'/.test(panel));
  check('the panel performs the real hash navigation to the route',
    /window\.location\.hash\s*=\s*`#\$\{nav\.route\}`/.test(panel));
  check('the chat renders the navigation reply with a reachable fallback link',
    /data-testid="chat-navigation-link"/.test(panel));
  check('the quick-action rail carries an Intent OS chip',
    /'intentOS'/.test(panel));

  const fa = readFileSync('src/i18n/locales/fa.json', 'utf8');
  const en = readFileSync('src/i18n/locales/en.json', 'utf8');
  check('the navigation reply is localized (fa)',
    fa.includes('"navigation"') && fa.includes('"intentOS": "intent os"'));
  check('the navigation reply is localized (en)',
    en.includes('"navigation"') && en.includes('"intentOS": "intent os"'));

  console.log(JSON.stringify({ probe: 'phase208-chat-navigation', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
