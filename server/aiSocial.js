/**
 * FBT INTENT OS — UPGRADE 13: SOCIAL TURN COMPOSER (server half)
 * ---------------------------------------------------------------------------
 * The client-side layers (`conversation/*`) read the sentence and produce a
 * reading. This module turns that reading into the reply the user gets, and it
 * is the only server place allowed to answer a pleasantry.
 *
 * Why a separate module: `/chat` is 350 lines of orchestration, and the
 * alternative was to thread a five-branch social switch through its middle.
 * The chat now asks one question — *is this turn social?* — and either uses the
 * composed answer or ignores it completely.
 *
 * The three outcomes:
 *
 *   · «حالت چطوره» / «nasılsın» / «как дела»  → a warm line in the language the
 *     user wrote, zero model calls, zero data claims
 *   · «چخبر» / «what's up» / «que hay de nuevo» → that same warmth PLUS the
 *     economic brief built from the market/yield/portfolio/news the turn already
 *     carries — a report, not a deflection
 *   · anything with an action verb in it → `handled: false`, and the money path
 *     runs untouched
 *
 * Laws:
 *   - never overrides an action card, a pending intent or a wallet prompt —
 *     those carry execution meaning and a greeting must not swallow them
 *   - never invents a figure: numbers come only from `economicBrief`, which is
 *     built from injected payloads and names its own gaps
 *   - the reply language is what the user wrote, not what the app displays
 */

import { renderSocialReply } from '../src/lib/intent-ai/os/conversation/socialVoice.js';
import { buildEconomicBrief } from '../src/lib/intent-ai/os/conversation/economicBrief.js';
import { SOCIAL_ACTS } from '../src/lib/intent-ai/os/conversation/socialIntent.js';

export const SOCIAL_TURN_SCHEMA = 'fbt.ai-social-turn.v13';

/** Kinds that are answered from the phrase alone. WHATS_UP is not among them. */
const SMALL_TALK_KINDS = new Set(['GREETING', 'THANKS', 'CASUAL']);

/**
 * @param {object} input
 * @param {object} input.u5       the collaboration plan (carries `social`)
 * @param {object} input.human    the deterministic human reply (guard only)
 * @param {object} input.context  assembled AI context: market/yields/portfolio/wallet/news
 * @param {string} input.locale   the client's declared locale (fallback only)
 * @param {number} input.now
 * @param {boolean} [input.transparency] when true, the brief names its sources
 * @returns {{handled: boolean, text?: string, social?: object, brief?: object,
 *   skipCollaboration?: boolean, providerCalls: 0, schema: string}}
 */
export function composeSocialTurn({ u5 = null, human = null, context = {}, locale = 'fa', now = Date.now(), transparency = false } = {}) {
  const social = u5?.social || null;
  const notHandled = { handled: false, providerCalls: 0, schema: SOCIAL_TURN_SCHEMA };
  if (!social || !social.social || !social.pure) return notHandled;

  /* A turn that already produced a card, a plan or a wallet request is not a
     pleasantry, however it was phrased — the money path owns it. */
  const uiType = human?.ui?.type;
  if (human?.pendingIntent || human?.actionPlan || ['ACTION_CARD', 'CONNECT_WALLET', 'CHOICE'].includes(uiType)) {
    return { ...notHandled, reason: 'EXECUTION_TURN_OWNS_REPLY' };
  }

  const lang = social.lang || String(locale || 'fa').toLowerCase().split('-')[0] || 'en';
  const seed = `${social.act}:${context?.conversationSeed || ''}:${Math.floor(Number(now) / 3_600_000)}`;

  /* ── WHATS_UP → warmth + economic brief ─────────────────────────────────── */
  if (u5.conversationKind === 'WHATS_UP' || social.act === SOCIAL_ACTS.WHATS_UP) {
    const brief = buildEconomicBrief({
      market: context.market || null,
      yields: context.yields || null,
      portfolio: context.portfolio || null,
      wallet: context.wallet || null,
      news: Array.isArray(context.news?.items) ? context.news.items : (Array.isArray(context.news) ? context.news : null),
      lang,
      now: Number(now) || Date.now()
    });
    const opener = renderSocialReply({ act: SOCIAL_ACTS.WHATS_UP, lang, seed });
    const body = opener.ok ? `${opener.text}\n${brief.text}` : brief.text;
    /* When the payload is genuinely empty the brief has nothing to say, and an
       empty report is worse than none: the assistant then says what is missing
       and asks for the one thing that would let it answer. */
    const text = brief.dataStatus === 'unavailable'
      ? `${opener.ok ? `${opener.text}\n` : ''}${unavailableNote(lang, brief)}`
      : `${body}${transparency ? `\n\n${sourcesNote(lang, brief)}` : ''}`;
    return {
      handled: true,
      skipCollaboration: true,
      providerCalls: 0,
      schema: SOCIAL_TURN_SCHEMA,
      text,
      social: { act: social.act, lang, langSource: social.langSource, confidence: social.confidence, kind: 'WHATS_UP' },
      brief: {
        dataStatus: brief.dataStatus,
        mood: brief.mood,
        missing: brief.missing,
        lines: brief.lines,
        notAdvice: true,
        executionAuthorized: false
      }
    };
  }

  /* ── everything else → one warm line, in the user's language ───────────── */
  if (!SMALL_TALK_KINDS.has(u5.conversationKind) && !SOCIAL_ACTS[social.act]) return notHandled;
  const reply = renderSocialReply({ act: social.act, lang, seed });
  if (!reply.ok) return { ...notHandled, reason: reply.reason };

  return {
    handled: true,
    skipCollaboration: true,
    providerCalls: 0,
    schema: SOCIAL_TURN_SCHEMA,
    text: reply.text,
    social: {
      act: social.act,
      lang: reply.lang,
      langSource: social.langSource,
      /* `fellBack` is the honest marker: the app is showing English because the
         act has no voice in the reader's language, and the ops panel can count
         how often that happens instead of pretending parity. */
      fellBack: reply.fellBack,
      confidence: social.confidence,
      kind: u5.conversationKind
    },
    brief: null
  };
}

/**
 * What to say when the brief has no data at all. Naming the missing feed and
 * asking which one to pull is an answer; «sorry, try again later» is not.
 */
function unavailableNote(lang) {
  const notes = {
    fa: 'الان داده‌ی زنده‌ای به دستم نرسید (بازار، بازده یا کیف پول) — نمی‌خوام بی‌داده عدد بگم. بگو کدوم رو نگاه کنم تا همون رو بکشم.',
    en: 'I could not reach live data for this (market, yields or wallet), so I am not going to quote a number without one. Tell me which one to pull and I will get it.',
    ar: 'لم تصلني بيانات حيّة الآن (السوق أو العوائد أو المحفظة)، ولن أذكر رقمًا دون مصدر. قل لي أيها أجلب.',
    tr: 'Şu an canlı veriye ulaşamadım (piyasa, getiri ya da cüzdan) — sıfır veriyle sayı söylemeyeceğim. Hangisini çekeyim?',
    ru: 'Живых данных сейчас нет (рынок, доходности или кошелёк) — цифру без источника не скажу. Скажи, что вытащить.',
    zh: '现在没拿到实时数据（行情、收益或钱包），我不会凭空报数字。要我先看哪个？',
    hi: 'अभी लाइव डेटा नहीं मिला (बाज़ार, यील्ड या वॉलेट) — बिना डेटा संख्या नहीं बताऊँगा। पहले क्या देखूँ?',
    ur: 'ابھی لائیو ڈیٹا نہیں ملا (بازار، ییلڈ یا والیٹ) — بغیر ڈیٹا عدد نہیں دوں گا۔ بتائیں پہلے کیا دیکھوں؟',
    id: 'Data live belum sampai (pasar, imbal hasil, atau dompet) — aku tidak akan menyebut angka tanpa sumber. Mau kuambil yang mana?',
    es: 'Ahora mismo no tengo datos en vivo (mercado, rendimientos o billetera), así que no voy a dar un número sin fuente. ¿Qué reviso primero?',
    pt: 'Não tenho dados ao vivo agora (mercado, rendimentos ou carteira), por isso não vou dar um número sem fonte. O que vejo primeiro?',
    fr: 'Je n’ai pas de données live là (marché, rendements ou portefeuille), je ne vais pas sortir un chiffre sans source. Lequel je regarde ?'
  };
  return notes[lang] || notes.en;
}

/** Transparency mode only: name the feeds the numbers came from. */
function sourcesNote(lang, brief) {
  const src = Object.entries(brief.sources || {})
    .filter(([, v]) => v && v !== 0 && v !== 'unavailable')
    .map(([k, v]) => `${k}:${v}`)
    .join(' · ');
  const head = {
    fa: 'منابع این خلاصه', en: 'Sources for this snapshot', ar: 'مصادر هذه اللقطة', tr: 'Bu özetin kaynakları',
    ru: 'Источники сводки', zh: '本摘要的数据来源', hi: 'इस सारांश के स्रोत', ur: 'اس خلاصے کے ذرائع',
    id: 'Sumber ringkasan ini', es: 'Fuentes de este resumen', pt: 'Fontes deste resumo', fr: 'Sources de cet aperçu'
  }[lang] || 'Sources';
  return `${head}: ${src || '—'}.`;
}

export default composeSocialTurn;
