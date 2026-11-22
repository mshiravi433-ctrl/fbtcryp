/** Narrow, non-transactional conversation routing. Financial or product words
 * always win over social words, so mixed requests stay in the normal intent and
 * confirmation pipeline. Shared by browser and server; hints are never trusted. */
const BLOCKED = /(?:بازار|کریپتو|رمز\s*ارز|ارز\s*دیجیتال|بیت\s*کوین|اتریوم|سولانا|دوج|تتر|توکن|کیف\s*پول|پرتفوی|موجودی|دارایی|سواپ|ترید|معامله|سفارش|سرمایه|قیمت|سود|ضرر|کارمزد|اپلیکیشن|برنامه|اپ\b|صرافی|سایت|\bfbt\b|فروش|بفروش|خرید|بخر|انتقال|برداشت|واریز|استیک|وام|اجرا|تایید|تأیید|توقف|لغو|\b(?:bitcoin|btc|eth|sol|usdt|wallet|portfolio|crypto|market|price|trade|buy|sell|swap|send|transfer|withdraw|deposit|order|token|app|website|fee|execute|confirm|stop|cancel)\b)/iu;
const RELATIONSHIP = /(?:دوست(?:م|مونو|ش|ات)?|رفیق|همسر|شوهر|زنم|پارتنر|نامزد|خانواده|مادر|پدر|خواهر|برادر|رابطه|ازدواج|عشق|آشتی|دعوا|جر\s*و\s*بحث|تنهایی|تنها\s*هستم|دوستی|دلم\s*شکسته|\b(?:friend|partner|relationship|family|husband|wife|marriage|lonely|breakup|apologize)\b)/iu;
const INSULT = /(?:احمق|نادان|بی\s*شعور|بی\s*عرضه|لعنتی|گند\s*زدی|مزخرف|چرت|کس\s*خل|گوه|fuck|shit|stupid|idiot|useless)/iu;
export function isConversationalOnly(text) {
  const message = String(text || '').trim();
  return Boolean(message && message.length <= 1500 && !BLOCKED.test(message) && (RELATIONSHIP.test(message) || INSULT.test(message)));
}

/** Bare colloquial "what's up" is ambiguous, not a request for market news. */
export function isBareWhatsUp(text) {
  return /^(?:چخبرا?|چه\s*خبر(?:ا)?|خبری\s*نیست)[؟?!.,،\s]*$/u.test(String(text || '').trim());
}
export const BARE_WHATS_UP_REPLY = 'سلام! خبر خاصی ندارم، ولی برای گپ یا کمک اینجام. تو چه خبر؟ اگر منظورت خبرهای بازار است، بگو تا با دادهٔ زنده بررسی کنم.';
