/**
 * THE ATTACH BETWEEN A CHAT TURN AND THE FIRST-PARTY PLUGINS
 * -----------------------------------------------------------------------
 *
 * This is the provider behind `server/ci/pluginBridge.js`. It answers one
 * question: «does one of our eleven plugins fit this question, and if so what
 * did it read?»
 *
 * WHY A MATCHER AND NOT A MODEL
 *
 * The brain reaches this file only on a turn the 36-rule registry could not
 * route AND the verified corpus declined. The remaining choice used to be a
 * provider call — one of 50 free requests a day — or a refusal. A local match
 * against the plugins' own vocabulary costs microseconds and NO quota, and it
 * answers from the plugin's live source (DefiLlama, CoinGecko, GoPlus,
 * DexScreener) instead of a model's memory of it. Measured 2026-11-11: the
 * whole eleven-plugin catalog imports in 4 ms / 1.2 MB and a warm run of one
 * plugin is 0.4 ms, so the attach adds no measurable CPU to a turn.
 *
 * THE THREE RULES IT OBEYS
 *
 *   1. **No match, no run.** If no rule fires, nothing is imported, no data
 *      access is built and no network read starts: the answer is
 *      `NO_PLUGIN_MATCH` and the brain falls through to its next honest option.
 *   2. **A failure is named, never an empty answer.** A plugin whose source is
 *      down still returns text («منبع پاسخ نداد، هیچ APY‌ای حدس زده نمی‌شود»)
 *      with `dataStatus:'unavailable'`; a timeout or a crash returns a code.
 *   3. **The kill switches are the owners'.** `AGENT_HUB_NATIVE_AGENTS=false`
 *      disables the plugins everywhere (read via `nativeEnabled`, not
 *      re-implemented here) and `AI_PLUGIN_ATTACH=false` disables ONLY this
 *      chat attach, leaving the Agent Hub dock working.
 *
 * THE ORDER OF THE RULES IS THE DISAMBIGUATION
 *
 * Rules are tried in order and the winner is the highest score, with earlier
 * rules winning ties. Entity-bound rules (a contract address, a wallet
 * address, a chain pair) come first because an entity is stronger evidence
 * than a keyword; the broad analyst rule comes LAST because «تحلیل» and «روند»
 * appear in almost every market question and must not steal a plugin turn.
 */

import { slugFromAgentId } from './pluginRegistry.js';

const ZW = '[\\u200c\\s]*';
const ADDRESS_RE = /(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{40,44})/;
const PAIR_RE = /([A-Za-z0-9]{2,10})\s*\/\s*([A-Za-z0-9]{2,10})/;
/* Chain and protocol NAMES are matched with word boundaries, never with
   `includes`: 'eth' lives inside «method», 'base' inside «based», and 'sma'
   inside «smart» — a substring match turns an English sentence into a
   cross-chain swap. Persian has no \b, so the Persian forms are matched with
   an explicit boundary class instead. */
const CHAINS = ['ethereum', 'eth', 'arbitrum', 'arb', 'base', 'solana', 'sol', 'optimism', 'polygon', 'bsc', 'binance', 'avalanche', 'avax'];
const PROTOCOLS = ['aave', 'compound', 'curve', 'uniswap', 'sushi', 'pancake', 'lido', 'maker', 'morpho', 'venus', 'spark', 'balancer', 'convex', 'pendle', 'آوه', 'کامپاوند', 'یونی‌سواپ', 'لیدو'];
/* An English noun may be plural («yields», «holders») and a verb may be
   inflected («scanning»), so the boundary accepts a trailing s/es/ing. It
   still refuses the substring match that put 'sma' inside «smart». */
const wordIn = (hay, needle) => new RegExp(`(?:^|[^a-z0-9])${needle}(?:s|es|ing)?(?:[^a-z0-9]|$)`, 'i').test(hay);
export const PLUGIN_ATTACH_SCHEMA = 'fbt.agent-hub.plugin-attach.v1';
export const PLUGIN_ATTACH_ENV = 'AI_PLUGIN_ATTACH';

/**
 * One row per plugin. `fa`/`en` are the words its OWN catalog uses
 * (`capabilities`, `examplesFa`) plus the Persian forms a user actually types;
 * `needs` is the entity that must be present for the rule to fire at all, so a
 * keyword alone cannot pull a contract scan out of a general question.
 */
export const PLUGIN_MATCH_RULES = Object.freeze([
  { slug: 'token-risk-scanner', needs: 'address', fa: [`هانی${ZW}پات`, `اسکن`, `ریسک${ZW}توکن`, `امنیت${ZW}توکن`, `کلاهبردار`, `اسکم`, `مالیات`, `قرارداد`, `هک${ZW}شده`], en: ['honeypot', 'rug', 'contract', 'tax', 'scam', 'scan', 'scanner'] },
  /* `آدرس` was in this list and had to go: it is a MARKER, not a question
     type, and it made «همه پولمو بفرست به آدرس 0x…» (a transfer, not an
     audit) claim the wallet auditor. The address itself is already required by
     `needs`, so the keyword added nothing but the false positive. */
  { slug: 'wallet-exposure-auditor', needs: 'address', fa: [`کیف${ZW}پول`, `معرض`, `تمرکز`, `دارایی${ZW}ها`, `بررسی${ZW}کن`, `حسابرسی`], en: ['wallet', 'exposure', 'holdings', 'concentration'] },
  /* Two rows for one plugin, on purpose: «گزارش امنیتی Aave» carries its own
     noun, while «ریسک Curve چقدر است؟» carries only a PROTOCOL NAME plus a risk
     word. «ریسک» alone must never fire (every portfolio question says it), so the
     second row is gated on the name being present. */
  { slug: 'protocol-security-brief', needs: null, fa: [`گزارش${ZW}امنیتی`, `ریسک${ZW}پروتکل`, `امنیت${ZW}پروتکل`, `هک`, `حادثه`, `ممیزی`, `پروتکل`], en: ['audit', 'security brief', 'hack', 'incident', 'protocol'] },
  { slug: 'protocol-security-brief', needs: 'protocol', fa: [`ریسک`, `امنیت`, `گزارش`, `سلامت`], en: ['risk', 'risky', 'security', 'safe'] },
  { slug: 'lending-risk-agent', needs: null, fa: [`وام${ZW}دهی`, `وام${ZW}دادن`, `لندینگ`, `نرخ${ZW}تأمین`, `سپرده${ZW}گذاری`, `بهره`, `aave`, `compound`], en: ['lending', 'supply apy', 'borrow rate'] },
  { slug: 'liquidity-pool-analyzer', needs: null, fa: [`استخر`, `نقدینگی`, `عمق`, `زیان${ZW}ناپایدار`, `زوج`], en: ['pool', 'liquidity', 'impermanent loss', 'depth', 'turnover'] },
  { slug: 'yield-optimizer', needs: null, fa: [`بهترین${ZW}بازده`, `بازده`, `سود${ZW}سالانه`, `استیبل${ZW}کوین`, `apy`, `apr`], en: ['yield', 'apy', 'apr', 'best rate'] },
  { slug: 'cross-chain-swap-assistant', needs: 'chainPair', fa: [`پل`, `بریج`, `سواپ`, `مسیریابی`, `انتقال${ZW}بین`], en: ['bridge', 'swap', 'route', 'cross chain'] },
  { slug: 'strategy-backtesting-agent', needs: null, fa: [`بک${ZW}تست`, `میانگین${ZW}متحرک`, `استراتژی`, `dca`, `sma`], en: ['backtest', 'sma', 'dca', 'strategy'] },
  /* «جریان کیف‌پول‌های بزرگ» is how the catalog's own example phrases it, so the
     flow pattern has to accept a wallet between the two words. */
  { slug: 'smart-money-tracker', needs: null, fa: [`پول${ZW}هوشمند`, `نهنگ`, `جریان${ZW}(?:پول|کیف)`, `کیف${ZW}پول${ZW}های${ZW}بزرگ`, `بزرگ${ZW}ها`, `ورود${ZW}پول`, `خرید${ZW}سنگین`], en: ['whale', 'smart money', 'flow', 'holders'] },
  { slug: 'token-research-agent', needs: null, fa: [`تحقیق`, `بنیادی`, `درباره${ZW}ی`, `بررسی${ZW}کن`, `tvl`, `وایت${ZW}پیپر`], en: ['research', 'fundamentals', 'tvl', 'about'] },
  /* LAST on purpose: the broadest vocabulary in the catalog. */
  { slug: 'ai-trading-analyst', needs: null, fa: [`تکنیکال`, `روند`, `نوسان`, `تایم${ZW}فریم`, `حمایت`, `مقاومت`, `مومنتوم`, `تحلیل${ZW}کن`], en: ['trend', 'momentum', 'volatility', 'rsi', 'macd', 'price action', 'support', 'resistance', 'timeframe', 'analyse', 'analyze', 'technical', 'daily'] }
]);

const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());

/**
 * `AI_PLUGIN_ATTACH=false` removes the chat attach and nothing else.
 *
 * An UNSET flag under `NODE_ENV=test` also means off, following the convention
 * this repository already uses (`server/intentOperatorEvidence.js`,
 * `server/intentPlaneAttestations.js`, `server/intentSandboxEvidence.js`). The
 * reason is not style: a plugin run reads CoinGecko, DefiLlama, GoPlus or
 * DexScreener, so a test suite that reached the attach would make outbound
 * calls whose latency and failures are outside its control — 8 s of budget per
 * unrouted turn, and a different answer on a machine with egress than on one
 * without. The gates that test the attach say so explicitly and install a
 * catalog of their own, so they exercise the whole path with no network.
 */
export function attachEnabled(env = process.env) {
  const raw = env?.[PLUGIN_ATTACH_ENV];
  const flag = raw === undefined || raw === null ? '' : String(raw).trim();
  if (flag === '') return String(env?.NODE_ENV || '').trim().toLowerCase() !== 'test';
  return truthy(flag);
}

function entitiesOf(text) {
  const lower = text.toLowerCase();
  const chains = CHAINS.filter((c) => wordIn(lower, c));
  return {
    hasAddress: ADDRESS_RE.test(text),
    hasPair: PAIR_RE.test(text),
    chainCount: new Set(chains).size,
    hasProtocol: PROTOCOLS.some((p) => wordIn(lower, p) || text.includes(p))
  };
}

/**
 * Match a question to one plugin. PURE: no import, no network, no clock.
 *
 * @returns {{ slug: string, score: number, matched: string[] } | { slug: null, score: 0, matched: [] }}
 */
export function matchPlugin(message = '') {
  const text = String(message || '').trim();
  if (!text) return { slug: null, score: 0, matched: [] };
  const lower = text.toLowerCase();
  const ents = entitiesOf(text);
  let best = { slug: null, score: 0, matched: [] };
  for (const rule of PLUGIN_MATCH_RULES) {
    const needsOk = rule.needs === 'address' ? ents.hasAddress
      : rule.needs === 'chainPair' ? ents.chainCount >= 2
      : rule.needs === 'protocol' ? ents.hasProtocol
      : true;
    if (!needsOk) continue;
    const matched = [];
    for (const p of rule.fa) if (new RegExp(p, 'i').test(text)) matched.push(p);
    for (const p of rule.en) if (wordIn(lower, p.replace(/\s+/g, '[^a-z0-9]+'))) matched.push(p);
    if (!matched.length) continue;
    /* An entity requirement that is SATISFIED is evidence, not just a gate. */
    const score = matched.length * 2 + (rule.needs ? 3 : 0);
    /* `>` and not `>=`: the first rule in the table wins a tie, and the table
       is ordered most-specific-first. */
    if (score > best.score) best = { slug: rule.slug, score, matched };
  }
  return best;
}

/*
 * \u2500\u2500\u2500 A PLUGIN REPORT IS MARKDOWN, THE REPLY IS PLAIN TEXT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *
 * Every plugin writes its report for the Agent Hub dock: `# title`, `## section`,
 * `- bullet`. Neither the chat UI nor the dock renders markdown, and the reply
 * section that carries evidence is cut at 220 characters by
 * `src/lib/central/recommend.js`. Publishing the raw report therefore put
 * \u00ab# \u0627\u0633\u06a9\u0646 \u0631\u06cc\u0633\u06a9 \u00b7 0x1111 ## \u0642\u0631\u0627\u0631\u062f\u0627\u062f - \u0622\u062f\u0631\u0633: \u2026\u00bb in the headline and let the
 * publisher cut the rest mid-word.
 *
 * So the report is flattened HERE, and cut HERE at a segment boundary: a
 * sentence that is too long for the window is dropped whole, never sliced in
 * half. And the verdict gets its own line, because \u00ab\u0646\u062a\u06cc\u062c\u0647\u0654 \u062e\u0648\u0627\u0646\u062f\u0646 \u0648\u0636\u0639\u06cc\u062a:\u00bb
 * in front of a plugin\u2019s own answer reports the act of reading instead of the
 * answer.
 */
const MD_LINK_RE = /\[([^\]]+)\]\([^)]*\)/g;
const VERDICT_RE = /(\u0648\u0636\u0639\u06cc\u062a|\u0646\u062a\u06cc\u062c\u0647|\u062e\u0644\u0627\u0635\u0647|\u0647\u0634\u062f\u0627\u0631|\u067e\u0631\u0686\u0645|\u062e\u0637\u0631|status|verdict|summary|conclusion|risk level)/i;
const DIGIT_RE = /[0-9\u06f0-\u06f9\u0660-\u0669]|\u066a|%/;
/** A value that is only a zero is a DEFAULT, not a reading: the UNI report had
 *  read no candles at all and still printed \u00ab\u0628\u06cc\u0634\u062a\u0631\u06cc\u0646 \u0627\u0641\u062a \u0627\u0632 \u0633\u0642\u0641: +0.0%\u00bb. */
const ZERO_VALUE_RE = /^[+\u2212\u0627-]?0(?:[.,]0+)?\s*(%|\u066a)?$/;
const DASH_ONLY = /^[\u2014\u2013\-\u00b7\s/\u060c,]+$/;
/** The evidence window in `recommend.js` is 220; stay inside it. */
export const PLUGIN_TEXT_WINDOW = 215;
export const PLUGIN_LEAD_WINDOW = 190;

function cleanLine(line) {
  return String(line || '')
    .replace(MD_LINK_RE, '$1')
    .replace(/```/g, ' ')
    .replace(/`/g, '')
    .replace(/(\*\*|__)/g, ' ')
    .replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/\|/g, ' \u00b7 ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Accumulate whole segments until the window is full. Never cut one in half. */
function fitToWindow(segments, max) {
  const kept = [];
  let len = 0;
  for (const seg of segments) {
    const next = len ? len + 3 + seg.length : seg.length;
    if (next > max && kept.length) break;
    kept.push(seg);
    len = next;
  }
  return kept.join(' \u00b7 ');
}

/* A segment is a LABEL plus a VALUE (\u00ab\u0642\u06cc\u0645\u062a: \u2014\u00bb) or prose. The dash-only case
   must never be published, and neither must a zero that a plugin defaulted:
   both are number-shaped holes where an answer should be. Note that in
   \u00ab\u062d\u062c\u0645 \u06f2\u06f4 \u0633\u0627\u0639\u062a: \u2014\u00bb the digit sits in the LABEL, so counting digits anywhere
   in the segment is exactly the wrong test \u2014 the VALUE has to hold one. */
function valueOf(seg) {
  const idx = String(seg).search(/[:\u061d]/);
  return idx >= 0 ? String(seg).slice(idx + 1).trim() : null;
}

function hasSubstance(seg) {
  const t = String(seg || '').trim();
  if (!t) return false;
  const val = valueOf(t);
  if (val !== null) return Boolean(val) && !DASH_ONLY.test(val);
  if (DASH_ONLY.test(t)) return false;
  /* Prose counts: \u00ab\u0627\u06cc\u0646 \u062a\u0648\u06a9\u0646 \u0647\u0627\u0646\u06cc\u200c\u067e\u0627\u062a \u0646\u06cc\u0633\u062a\u00bb has no colon and no digit and is still
     the whole answer. A two-word heading is not. */
  return t.split(/\s+/).length >= 3 || DIGIT_RE.test(t);
}

/* Report FOOTERS are metadata, not answers: every plugin signs its report with
   the read time, and \u00ab\u0632\u0645\u0627\u0646 \u062e\u0648\u0627\u0646\u0634: 2026-11-14 04:37 UTC\u00bb has a colon and digits,
   so a naive \u00abprefer a number\u00bb rule headlines the timestamp instead of the
   finding. Same for a bare source line. */
const METADATA_RE = /(\d{4}-\d{2}-\d{2}|\d{2}:\d{2}(?::\d{2})?\s*UTC|\bUTC\b|\u0632\u0645\u0627\u0646\u0650?\s*\u062e\u0648\u0627\u0646\u0634|timestamp|read at|\u0645\u0646\u0628\u0639:|source:)/i;

/**
 * Rank one segment as a headline. Higher is better; ties go to the earlier
 * line, because a plugin writes its verdict before its caveats.
 *
 * The bands are ordered by what a user needs, and they are NOT additive: a
 * caveat that happens to contain the word \u00ab\u067e\u0631\u0686\u0645\u00bb used to out-score the
 * verdict line itself (\u00abverdict\u00bb + \u00abis a long sentence\u00bb), which turned the
 * headline into a warning about an answer the reply never gave.
 */
function scoreSegment(seg, index) {
  if (METADATA_RE.test(seg)) return -5 - index * 0.001;
  const val = valueOf(seg);
  const verdict = VERDICT_RE.test(seg);
  const prose = val === null && seg.split(/\s+/).length >= 5;
  let score;
  if (verdict && val !== null) score = 8;              /* «وضعیت: پرچم پرخطر دیده نشد» */
  else if (verdict) score = 3.5;                       /* a caveat that names the risk */
  else if (val !== null && DIGIT_RE.test(val)) score = ZERO_VALUE_RE.test(val) ? 0 : 4;
  else if (prose) score = 3;
  else if (val !== null && !DASH_ONLY.test(val)) score = 1;
  else score = 0;
  return score - index * 0.001;
}

/**
 * Flatten a plugin report into `{ title, lead, text }`. PURE and total: any
 * string in, three strings out, no throw.
 *
 * `lead` is the ONE sentence that answers; `text` is the report behind it, cut
 * at a segment boundary so the publisher's window cannot slice a sentence in
 * half. `text` starts with the lead, so the caveat that did not fit is dropped
 * before the verdict ever is.
 */
export function flattenPluginText(raw = '', { textWindow = PLUGIN_TEXT_WINDOW } = {}) {
  const title = [];
  const body = [];
  for (const rl of String(raw || '').split(/\r?\n/)) {
    const line = cleanLine(rl);
    if (!line) continue;
    const isHeading = /^\s*#{1,6}\s/.test(rl);
    if (isHeading && !title.length) { title.push(line); continue; }
    /* One bullet can hold two facts (\u00ab\u0646\u0642\u062f\u06cc\u0646\u06af\u06cc: \u2014 \u00b7 \u062d\u062c\u0645: \u2014\u00bb). Split them so the
       substance test judges a single label and value, not a pair where one
       half hides the other's emptiness. */
    for (const part of (isHeading ? [line] : line.split(' \u00b7 '))) {
      const seg = part.trim();
      if (seg) body.push({ text: seg, heading: isHeading });
    }
  }
  /* A plugin heading can repeat its own subject (\u00ab# UNI \u00b7 UNI\u00bb); collapse it
     rather than prefixing the verdict with a stutter. */
  const heading = title[0]
    ? Array.from(new Set(title[0].split(' \u00b7 ').map((x) => x.trim()).filter(Boolean))).join(' \u00b7 ')
    : null;
  /* A SECTION HEADING is structure, not content: \u00ab\u0639\u0645\u0644\u06a9\u0631\u062f \u06f9\u06f0 \u0631\u0648\u0632 (\u06a9\u0646\u062f\u0644\u200c\u0647\u0627)\u00bb has
     three words and says nothing. It may only be the verdict if it carries a
     value of its own (\u00ab## \u0648\u0636\u0639\u06cc\u062a: \u062e\u0637\u0631\u0646\u0627\u06a9\u00bb). */
  const solid = body
    .filter((e) => hasSubstance(e.text) && (!e.heading || /[:\u061d]/.test(e.text)))
    .map((e) => e.text);
  let lead = null;
  let winIdx = -1;
  if (solid.length) {
    /* The bar is ZERO, not -Infinity. A report whose only surviving line is a
       defaulted zero («بیشترین افت از سقف: +0.0%» out of 0 candles) scores 0, and 0
       still beat -Infinity, so the hole became the headline whenever nothing
       else in the report had a value. A candidate has to EARN the headline. */
    let best = 0;
    for (let i = 0; i < solid.length; i++) {
      const sc = scoreSegment(solid[i], i);
      if (sc > best) { best = sc; winIdx = i; }
    }
    lead = winIdx >= 0 ? solid[winIdx] : null;
  }
  if (lead && heading && !lead.startsWith(heading)) lead = `${heading} \u2014 ${lead}`;
  if (lead && lead.length > PLUGIN_LEAD_WINDOW) {
    const cut = lead.slice(0, PLUGIN_LEAD_WINDOW);
    const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\u060c'));
    lead = (at > 60 ? cut.slice(0, at) : cut).replace(/[\u00b7,\u060c\-\s]+$/, '');
  }
  /* The verdict first, then the rest of the report in its own order. By INDEX,
     not by string: selecting the winner's text and then filtering the list for
     that text repeated the verdict inside its own report whenever the heading
     prefix or a split segment made the two strings differ. */
  const ordered = winIdx >= 0
    ? [solid[winIdx], ...solid.filter((_, i) => i !== winIdx)]
    : solid;
  const deduped = Array.from(new Set(ordered));
  return { title: heading, lead, text: fitToWindow(deduped, Math.max(60, Number(textWindow) || PLUGIN_TEXT_WINDOW)) };
}

/* A plugin that could not read, or that is asking for an input, has not
   answered. Publishing its report would put \u00ab\u0627\u0631\u0632\u0634 \u0642\u0627\u0628\u0644\u200c\u0645\u0634\u0627\u0647\u062f\u0647: $0.000000
   (unavailable)\u00bb in a headline \u2014 a number that is an ABSENCE dressed as a
   fact \u2014 so these statuses are named refusals instead. */
const NOT_AN_ANSWER = Object.freeze({
  unavailable: 'PLUGIN_SOURCE_UNAVAILABLE',
  awaiting_input: 'PLUGIN_AWAITING_INPUT',
  error: 'PLUGIN_SOURCE_ERROR'
});

let cached = null;

/** Load the plugin catalog, its runner and its (lazy) data access ONCE. */
async function load() {
  if (cached) return cached;
  const [native, agents, dataMod] = await Promise.all([
    import('./native/index.js'),
    import('./native/agents.js'),
    import('./native/data.js')
  ]);
  cached = {
    nativeEnabled: native.nativeEnabled,
    runNativeAgent: agents.runNativeAgent,
    catalog: agents.NATIVE_AGENTS,
    data: dataMod.createDataAccess()
  };
  return cached;
}

/**
 * The plugin catalog, loaded lazily and cached. The composition root uses it to
 * register the plugins as agent rows and to check that an attach names a plugin
 * that exists — neither of which may import the catalog at boot.
 */
export async function pluginCatalog() {
  const mod = await load();
  return mod.catalog || [];
}

/** Test seam: drop the cached module/data so a harness can install a fake. */
export function resetPluginAttachCache() { cached = null; }
export function setPluginAttachCache(value) { cached = value || null; }

/**
 * The provider the bridge calls.
 *
 * @returns {Promise<{ ok: true, text: string, slug: string, title: string, dataStatus: string, citations: any[], matched: string[] }
 *   | { ok: false, code: string, detail: string|null }>}
 */
export async function attachPluginAnswer({ message = '', locale = 'fa', owner = null, timeoutMs = 8_000, agentId = null } = {}) {
  if (!attachEnabled()) {
    return { ok: false, code: 'PLUGIN_ATTACH_DISABLED', detail: `${PLUGIN_ATTACH_ENV} is off` };
  }
  /*
   * WHOSE CHOICE IS THIS?
   *
   * A user can attach a plugin to themselves — in the hub for this browser, or
   * durably per owner — and that choice outranks the matcher, because the
   * matcher is guessing from vocabulary and the user is stating a fact. It does
   * NOT outrank the registry: the brain only asks here on a turn it could not
   * route, so a routed turn still belongs to its own engine.
   *
   * A chosen plugin that is not in the catalog is a named failure, not a
   * silent fallthrough to the matcher: the user asked for a specific agent and
   * must be told that agent does not exist rather than be answered by another.
   */
  const chosen = slugFromAgentId(agentId);
  let match = null;
  let mod = null;
  if (chosen) {
    try {
      mod = await load();
    } catch (err) {
      return { ok: false, code: 'PLUGIN_CATALOG_UNAVAILABLE', detail: String(err?.message || err).slice(0, 160) };
    }
    if (!(mod.catalog || []).some((a) => a.slug === chosen)) {
      return { ok: false, code: 'PLUGIN_NOT_IN_CATALOG', detail: `${chosen} is not a first-party plugin` };
    }
    match = { slug: chosen, score: 0, matched: ['user-choice'] };
  } else {
    match = matchPlugin(message);
    if (!match.slug) {
      return { ok: false, code: 'NO_PLUGIN_MATCH', detail: 'no first-party plugin claims this question' };
    }
    try {
      mod = await load();
    } catch (err) {
      return { ok: false, code: 'PLUGIN_CATALOG_UNAVAILABLE', detail: String(err?.message || err).slice(0, 160) };
    }
  }
  if (mod.nativeEnabled && mod.nativeEnabled() !== true) {
    return { ok: false, code: 'NATIVE_AGENTS_DISABLED', detail: 'AGENT_HUB_NATIVE_AGENTS is off' };
  }
  if (!mod.catalog?.some((a) => a.slug === match.slug)) {
    return { ok: false, code: 'PLUGIN_NOT_IN_CATALOG', detail: `${match.slug} matched a rule but is not in the catalog` };
  }

  const budgetMs = Math.max(500, Math.min(12_000, Number(timeoutMs) || 8_000));
  let timer = null;
  try {
    const out = await Promise.race([
      mod.runNativeAgent(match.slug, { text: String(message), context: { owner, locale } }, mod.data, { now: () => Date.now() }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, code: 'PLUGIN_TIMEOUT' }), budgetMs);
        if (typeof timer?.unref === 'function') timer.unref();
      })
    ]);
    if (!out || out.ok !== true || !String(out.text || '').trim()) {
      return { ok: false, code: out?.code || 'PLUGIN_EMPTY', detail: out?.detail || null };
    }
    const dataStatus = String(out.dataStatus || 'live');
    if (NOT_AN_ANSWER[dataStatus]) {
      return { ok: false, code: NOT_AN_ANSWER[dataStatus], detail: `the plugin reported dataStatus '${dataStatus}'` };
    }
    /* The publisher's 220-character window covers the evidence row AS PUBLISHED,
       and `recommend.js` appends the attribution `(plugin:<slug>, همین حالا)` to
       it. Fitting the report to 215 and letting the attribution push the row to
       239 still cut a sentence — just later, and in someone else's layer. So the
       report is fitted to the window MINUS the attribution it will carry. */
    const attribution = `plugin:${match.slug}`.length + 24;
    const flat = flattenPluginText(out.text, { textWindow: PLUGIN_TEXT_WINDOW - attribution });
    if (!flat.lead) {
      return { ok: false, code: 'PLUGIN_NO_LEAD', detail: 'the plugin report held no publishable line' };
    }
    /* The NAME of the plugin, not the report's own heading (which carries the
       subject): \u00ab\u067e\u0644\u0627\u06af\u06cc\u0646\u0650 0x1111\u2026 \u00b7 \u0645\u0645\u06cc\u0632\u06cc \u0645\u0648\u0627\u062c\u0647\u0647\u00bb read as an address that had a
       name. The catalog already localises it. */
    const row = mod.catalog.find((a) => a.slug === match.slug);
    const fa = String(locale || 'fa') === 'fa';
    const title = String((fa && row?.nameFa) || row?.name || out.title || match.slug);
    return {
      ok: true,
      lead: flat.lead,
      text: flat.text || flat.lead,
      slug: match.slug,
      title,
      dataStatus,
      citations: Array.isArray(out.citations) ? out.citations : [],
      matched: match.matched
    };
  } catch (err) {
    return { ok: false, code: 'PLUGIN_RUN_FAILED', detail: String(err?.message || err).slice(0, 160) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default attachPluginAnswer;
