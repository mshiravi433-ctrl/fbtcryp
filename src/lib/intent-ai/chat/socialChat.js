/**
 * FBT INTENT OS — PHASE 213: SMALL TALK THAT WORKS WITH NO SERVER
 * ---------------------------------------------------------------------------
 * The server has answered greetings correctly since Upgrade 13. The chat had a
 * second problem the server cannot fix: when the turn never reaches the server
 * — offline, a timeout, a provider outage — «حالت چطوره» came back as
 * «اتصال برقرار نشد، دوباره تلاش کن». A pleasantry answered with a network
 * error is the machine-readable definition of "this AI is dumb".
 *
 * So the SAME classifier and the SAME voice tables the server uses are called
 * here, on the device:
 *
 *   GREETING / HOW_ARE_YOU / THANKS / FAREWELL / IDENTITY / CAPABILITY /
 *   APOLOGY / CONGRATS / SMALL_TALK   → answered locally, in the language the
 *                                       user typed (all twelve locales).
 *
 *   WHATS_UP / NEWS                   → NOT faked. A brief is live data, so
 *                                       the fallback says exactly that: this
 *                                       needs the connection. `serverNeeded`
 *                                       marks it; the caller still prefers the
 *                                       server answer when there is one.
 *
 * Laws (asserted by the probe, not just documented):
 *   1. an action sentence wearing a greeting is NOT social (existing guard);
 *   2. a social reply never contains a digit — no price, no balance, no %;
 *   3. a social reply carries no execution authority;
 *   4. no claim about mood, body or feelings — the voice tables are written
 *      that way and this module adds nothing to them.
 */

import { classifySocialAct, SOCIAL_ACTS } from '../os/conversation/socialIntent.js';
import { renderSocialReply } from '../os/conversation/socialVoice.js';

export const SOCIAL_CHAT_SCHEMA = 'fbt.chat-social.v1';

/** Acts that need live data; never invented here. */
const SERVER_ACTS = Object.freeze([SOCIAL_ACTS.WHATS_UP, SOCIAL_ACTS.NEWS]);

/** Acts a voice alone can answer. */
const OFFLINE_ACTS = Object.freeze([
  SOCIAL_ACTS.GREETING,
  SOCIAL_ACTS.HOW_ARE_YOU,
  SOCIAL_ACTS.THANKS,
  SOCIAL_ACTS.FAREWELL,
  SOCIAL_ACTS.IDENTITY,
  SOCIAL_ACTS.CAPABILITY,
  SOCIAL_ACTS.APOLOGY,
  SOCIAL_ACTS.CONGRATS,
  SOCIAL_ACTS.SMALL_TALK
]);

export const SOCIAL_CHAT_LAWS = Object.freeze({
  noNumbers: true,
  noAuthority: true,
  noMoodClaims: true,
  actionSentencesAreNotSocial: true,
  briefNeedsServer: true
});

export const SOCIAL_CHAT_INFO = Object.freeze({
  schema: SOCIAL_CHAT_SCHEMA,
  offlineActs: OFFLINE_ACTS,
  serverActs: SERVER_ACTS,
  laws: SOCIAL_CHAT_LAWS
});

const FA = (locale) => String(locale || 'fa').toLowerCase().startsWith('fa');

/**
 * A sentence that carries a subject OR an imperative is a request, whatever
 * pleasantry it is wearing. The shared classifier's own guard blocks money
 * actions; this one is stricter on purpose, because the LOCAL path answers a
 * social turn without ever consulting the server — and a real question
 * answered with "I'm fine, thanks" is the same defect as a greeting answered
 * with a completion notice.
 */
const REQUEST_HINTS = /(?:قیمت|بازار|تحلیل|چارت|نمودار|پرتفوی|کیف\s*پول|سود|ضرر|ریسک|سفارش|خرید|بخر|بفروش|فروش|انتقال|واریز|برداشت|سواپ|استیک|وام|جستجو|خبر|مبلغ|دلار|تومان|سرمایه|هدف|بیت\s*کوین|اتریوم|توکن|هولد|price|market|analy|chart|portfolio|wallet|profit|loss|risk|order|buy|sell|swap|stake|send|withdraw|search|news|invest|USD|BTC|ETH)/i;

function looksLikeRequest(text) {
  const raw = String(text || '');
  if (REQUEST_HINTS.test(raw)) return true;
  /* Any digit is a number the user wants something done with. */
  return /\d/.test(raw.replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(d) : '٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
}

/** Honest texts for the two branches that must not be invented. */
function honestText(act, locale) {
  const fa = FA(locale);
  if (act === SOCIAL_ACTS.NEWS) {
    return fa
      ? 'برای اینکه بگویم چه خبر است باید داده زنده بخوانم — الان به سرور دسترسی ندارم و از خودم خبر نمی‌سازم.'
      : 'Telling you what is going on needs a live read — the server is unreachable, and I will not invent news.';
  }
  return fa
    ? 'برای گزارش زندهٔ بازار باید داده زنده بخوانم — الان به سرور دسترسی ندارم. می‌توانی همین سؤال را دوباره بپرسی تا وصل شوم.'
    : 'A live market brief needs live data — the server is unreachable right now. Ask again once I can read.';
}

/**
 * Understand one sentence as small talk.
 * @returns {null|{ok,act,lang,text,mentionsNumbers,serverNeeded,reason,executionAuthorized}}
 */
export function composeSocialReply(text, { locale = 'fa', seed = null } = {}) {
  let classified = null;
  try {
    classified = classifySocialAct(text, { locale });
  } catch {
    return null;
  }
  const act = classified?.act || null;
  if (!classified?.social) {
    return {
      ok: false,
      act,
      reason: classified?.guard?.blocks ? 'ACTION_SENTENCE' : 'NOT_SOCIAL',
      lang: classified?.lang || null,
      serverNeeded: false,
      executionAuthorized: false
    };
  }
  if (classified.guard?.blocks || SERVER_ACTS.includes(act) || classified.needsData === true) {
    /* «چخبر» is a request for a real report; a greeting carrying an order is an
       order. Both are recognised, neither is answered from a voice table. */
    return {
      ok: false,
      schema: SOCIAL_CHAT_SCHEMA,
      act,
      lang: classified.lang || (FA(locale) ? 'fa' : 'en'),
      reason: classified.guard?.blocks ? 'ACTION_SENTENCE' : 'NEEDS_SERVER',
      serverNeeded: true,
      offlineText: honestText(act, locale),
      executionAuthorized: false
    };
  }
  /* A greeting carrying a real request is that request. Answered locally it
     would swallow the question, so it is handed back to the pipeline. */
  if (looksLikeRequest(text)) {
    return { ok: false, act, reason: 'MIXED_REQUEST', lang: classified.lang || null, serverNeeded: false, executionAuthorized: false };
  }
  let voice = null;
  try {
    voice = renderSocialReply({ act, lang: classified.lang, seed: seed ?? text });
  } catch {
    voice = null;
  }
  if (!voice?.ok) {
    return { ok: false, schema: SOCIAL_CHAT_SCHEMA, act, lang: classified.lang || null, reason: 'NO_VOICE_FOR_ACT', serverNeeded: false, executionAuthorized: false };
  }
  return {
    ok: true,
    schema: SOCIAL_CHAT_SCHEMA,
    act,
    lang: voice.lang,
    fellBack: voice.fellBack === true,
    rtl: voice.rtl === true,
    text: voice.text,
    mentionsNumbers: voice.mentionsNumbers === true,
    serverNeeded: false,
    executionAuthorized: false
  };
}

/**
 * The message row the chat appends for a locally answered pleasantry — or for
 * the honest "this one needs live data" refusal. `null` for anything that is
 * not small talk at all, so a real request keeps its normal error path.
 */
export function offlineSocialFallback(text, { locale = 'fa' } = {}) {
  const turn = composeSocialReply(text, { locale });
  if (!turn) return null;
  if (turn.ok) {
    return {
      id: `social_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'ai',
      kind: 'assistant',
      content: turn.text,
      ui: { type: 'TEXT' },
      social: { act: turn.act, lang: turn.lang, offline: true },
      actions: []
    };
  }
  if (turn.serverNeeded && turn.offlineText) {
    return {
      id: `social_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'ai',
      kind: 'assistant',
      content: turn.offlineText,
      ui: { type: 'TEXT' },
      social: { act: turn.act, lang: turn.lang, offline: true, needsServer: true },
      actions: []
    };
  }
  return null;
}

/**
 * True when the sentence is small talk the local layer can answer with a voice
 * alone — used by the chat to route it before the pipeline.
 */
export function isPureSocialTurn(text, { locale = 'fa' } = {}) {
  return composeSocialReply(text, { locale })?.ok === true;
}
