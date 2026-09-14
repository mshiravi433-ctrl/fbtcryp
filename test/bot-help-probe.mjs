/**
 * BOT HELP PROBE — the in-chat help center must be sendable, safe and honest.
 * ---------------------------------------------------------------------------
 * `/help` used to print eight command names. It is now a topic-based help
 * center (server/botHelp.js) reachable from a slash command, a button or a
 * typed question. Three classes of failure are worth a permanent test, because
 * each one turns help into silence or into a lie:
 *
 *   A. TELEGRAM REJECTS THE MESSAGE. Over 4096 characters, or an unescaped
 *      `<`/`&` under parse_mode HTML, and sendMessage answers 400. The user
 *      sees nothing at all and concludes the bot is broken. Callback_data over
 *      64 bytes makes the BUTTON fail the same way.
 *
 *   B. THE HELP LIES ABOUT MONEY. The bot once told new users "everything runs
 *      on virtual NX credits" while handing them a button into a real
 *      exchange. Help text is read by exactly the people who do not yet know
 *      what is real, so it may never imply simulated funds, guaranteed
 *      returns, reversibility, or ask for a seed phrase — and it must say out
 *      loud that nobody legitimate ever asks for one.
 *
 *   C. THE MATCHER GUESSES. A typed question that is answered with the WRONG
 *      topic is worse than no answer: it is a confident answer about somebody's
 *      money. findTopic() must return null when the match is not real.
 *
 * Pure logic, no network, no Telegram. `node test/bot-help-probe.mjs` prints
 * the table; the shared runner imports the default export.
 */

import { readFileSync } from 'node:fs';
import {
  CALLBACK_DATA_LIMIT,
  HELP_TOPICS,
  TELEGRAM_MESSAGE_LIMIT,
  TOPIC_IDS,
  callbackDataFor,
  escapeHtml,
  findTopic,
  helpIndexMessage,
  helpResponse,
  helpTopicsKeyboard,
  topicById,
  topicIdFromCallback,
  topicMessage
} from '../server/botHelp.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const allMessages = [helpIndexMessage(), ...TOPIC_IDS.map((id) => topicMessage(id))];

/* ---------------------------- A. sendable at all -------------------------- */

t('there are help topics at all', HELP_TOPICS.length >= 8);
t('every topic id is unique', new Set(TOPIC_IDS).size === TOPIC_IDS.length);
t('every topic has a title, a summary, keywords and a body',
  HELP_TOPICS.every((topic) =>
    topic.title && topic.summary && Array.isArray(topic.keywords) && topic.keywords.length > 0 && topic.body.length > 200));

t('no message can exceed the Telegram 4096-character limit',
  allMessages.every((message) => message.length <= TELEGRAM_MESSAGE_LIMIT));

/*
 * Telegram's HTML parse mode accepts a small tag set. Anything else — or a
 * bare `<` from a stray "<symbol>" — is a 400 and a silent bot. Strip the tags
 * we do use, then assert no raw angle bracket survives.
 */
const ALLOWED_TAGS = /<\/?(?:b|i|u|s|code|pre)>/g;
const strippedMessages = allMessages.map((message) => message.replace(ALLOWED_TAGS, ''));
t('help text uses only tags Telegram HTML accepts',
  strippedMessages.every((message) => !/[<>]/.test(message)));

/*
 * A bare `&` is also invalid HTML for Telegram. Allowed: the named entities we
 * write deliberately (&lt; &gt; &amp; &quot;).
 */
t('every ampersand is an escaped entity',
  allMessages.every((message) => !/&(?!(?:amp|lt|gt|quot);)/.test(message)));

t('every topic message is non-empty and ends with a route back to the index',
  TOPIC_IDS.every((id) => topicMessage(id).includes('/help')));

/* ------------------------------ buttons ----------------------------------- */

const keyboard = helpTopicsKeyboard();
const buttons = keyboard.flat();

t('every topic has exactly one button', buttons.length === HELP_TOPICS.length);
t('callback_data fits Telegram\'s 64-byte limit',
  buttons.every((button) => Buffer.byteLength(button.callback_data, 'utf8') <= CALLBACK_DATA_LIMIT));
t('every button resolves back to a real topic',
  buttons.every((button) => topicIdFromCallback(button.callback_data) !== null));
t('a button press resolves to the same text as the slash command',
  topicMessage(topicIdFromCallback('help:fees')) === topicMessage('fees'));

/*
 * callback_data arrives from the client. An unknown or forged payload must be
 * rejected by lookup, never interpolated into a reply.
 */
t('an unknown callback payload is refused', topicIdFromCallback('help:does-not-exist') === null);
t('a foreign callback payload is refused', topicIdFromCallback('order:cancel:1') === null);
t('an injected callback payload is refused', topicIdFromCallback('help:<b>x</b>') === null);
t('callbackDataFor refuses an unknown topic', callbackDataFor('nope') === null);

/* ------------------------- B. it must not lie ----------------------------- */

const corpus = allMessages.join('\n').toLowerCase();

t('help never claims funds are virtual or simulated',
  !/virtual (nx )?credits|play money|paper trad|demo funds|simulated funds/.test(corpus));
/*
 * "no guaranteed return" is the opposite of a promise, so the check has to read
 * the negation rather than the keyword — a naive match here would have failed
 * the one sentence that protects the user, and the fix would have been to
 * DELETE a warning. Only an unnegated promise counts.
 */
const PROMISE_RE = /(?:^|[^a-z])((?:\w+\s+){0,3}?)(guaranteed (?:profit|return|yield)|risk[- ]free|always profitable|you will profit)/g;
const NEGATION_RE = /\b(no|not|never|nothing|without|isn't|is not|there are no)\b/;
const unnegatedPromise = [...corpus.matchAll(PROMISE_RE)].some(([, lead]) => !NEGATION_RE.test(lead));
t('help never promises a return (a negated mention is allowed)', !unnegatedPromise);
t('help does say returns are not guaranteed', /guaranteed (profit|return|yield)/.test(corpus));
t('help never claims a transaction can be reversed',
  !/(we (can|will) (reverse|refund|cancel) (your )?transaction)|transactions can be reversed/.test(corpus));
t('help never asks for a seed phrase or private key',
  !/(send|share|give|enter|provide)[^.\n]{0,40}(seed phrase|recovery phrase|private key)/.test(corpus));

/* The scam-defence sentences are the load-bearing part; assert they survive. */
t('help states the app is non-custodial', /non-custodial/.test(corpus));
t('help states nobody will ever ask for the recovery phrase',
  /never ask/.test(corpus) && /(recovery phrase|private key)/.test(corpus));
t('help states the bot takes no deposits', /(no deposit|never take[s]? deposits|takes no deposits)/.test(corpus));
t('help warns that funds are real and irreversible',
  /real funds/.test(corpus) && /(cannot be reversed|irreversible)/.test(corpus));
t('help says it is not financial advice', /not financial advice|nothing here is financial advice/.test(corpus));
t('help warns gas is paid separately from the platform fee', /gas/.test(corpus) && /separate/.test(corpus));

/*
 * One fee, one number. The moment two topics quote different percentages, the
 * bot is confidently wrong on one of the two screens.
 */
const feeQuotes = new Set(corpus.match(/\d+(?:\.\d+)?%/g) ?? []);
t('a single platform-fee figure is quoted everywhere', feeQuotes.has('0.70%'));
t('no second, conflicting swap-fee figure appears',
  ![...feeQuotes].some((quote) => quote !== '0.70%' && quote !== '0%'));

/* --------------------- C. the matcher must not guess ---------------------- */

t('an exact id resolves', findTopic('fees')?.id === 'fees');
t('a slash-prefixed id resolves', findTopic('/security')?.id === 'security');
t('case and punctuation do not matter', findTopic('  FEES? ')?.id === 'fees');
t('a keyword resolves', findTopic('gas')?.id === 'fees');
t('a prefix resolves', findTopic('network')?.id === 'networks');

t('a typed question about cost lands on fees', findTopic('what are the fees')?.id === 'fees');
t('a typed question about a missing balance lands on troubleshooting',
  findTopic('my balance is gone')?.id === 'troubleshooting');
t('a seed-phrase request lands on a topic that says never to share it',
  ['wallet', 'security'].includes(findTopic('someone asked for my recovery phrase')?.id));
t('an API question lands on developers', findTopic('where do i get an api key')?.id === 'developers');

/* The important half: refusing to answer. */
t('a greeting matches nothing', findTopic('hello') === null);
t('gratitude matches nothing', findTopic('thanks') === null);
t('an unrelated sentence matches nothing', findTopic('what is the weather in isfahan') === null);
t('an empty query matches nothing', findTopic('') === null && findTopic(null) === null);
t('a keyword inside a longer word does not match', findTopic('coffee') === null);

/* ---------------------------- the responses ------------------------------- */

const index = helpResponse('');
t('a bare /help returns the index', index.matched === true && index.topicId === null);
t('the index lists every topic', TOPIC_IDS.every((id) => index.text.includes(`/help ${id}`)));

const fees = helpResponse('fees');
t('/help fees returns the fee topic', fees.matched === true && fees.topicId === 'fees');

const unknown = helpResponse('sdfsdf');
t('an unknown topic is admitted, not faked', unknown.matched === false);
t('an unknown topic still shows the index', TOPIC_IDS.every((id) => unknown.text.includes(`/help ${id}`)));

/*
 * The unknown branch is the ONLY place user text is echoed. If it were not
 * escaped, a message could inject markup into the bot's own reply.
 */
const injected = helpResponse('<b>bold</b> & "quoted"');
t('echoed user text is HTML-escaped',
  injected.text.includes('&lt;b&gt;') && !/<b>bold<\/b>/.test(injected.text));
t('escapeHtml covers all four dangerous characters',
  escapeHtml('<&>"') === '&lt;&amp;&gt;&quot;');
t('an echoed query cannot blow the message limit',
  helpResponse('x'.repeat(5000)).text.length <= TELEGRAM_MESSAGE_LIMIT);

t('topicById refuses an unknown id', topicById('nope') === null && topicMessage('nope') === null);

/* ---------------------- the bot actually wires it up ---------------------- */

const botSource = readFileSync(new URL('../server/bot.js', import.meta.url), 'utf8');

t('the bot imports the help center instead of re-typing it', /from '\.\/botHelp\.js'/.test(botSource));
t('/help accepts an argument', /bot\.command\('help'/.test(botSource) && /helpResponse\(/.test(botSource));
t('help buttons are handled', /callback_query/.test(botSource) && /topicIdFromCallback/.test(botSource));
t('the command menu advertises help', /command: 'help'/.test(botSource));
t('shortcut commands exist for the most-asked topics',
  ["'fees'", "'networks'", "'security'", "'support'"].every((command) => botSource.includes(command)));
t('long messages are trimmed rather than dropped', /fitTelegramMessage/.test(botSource));
t('free-text answers are limited to private chats', /chat\?\.type !== 'private'/.test(botSource));

/*
 * The welcome message used to say "10 networks" while the app supported
 * seventeen. Both numbers now come from one constant.
 */
t('the welcome message takes its network count from the shared constant',
  /\$\{NETWORK_COUNT\} networks/.test(botSource) && !/across 10 networks/.test(botSource));

export default rows;

if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const [name, ok] of rows) {
    if (!ok) bad += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  console.log(bad ? `\n${bad} FAILED\n` : `\nAll ${rows.length} assertions passed.\n`);
  process.exit(bad ? 1 : 0);
}
