/**
 * FBT INTENT OS — SOCIAL READ (the person behind the question)
 * ---------------------------------------------------------------------------
 * «درک درخواست» is not keyword matching, and «هوش اجتماعی» is not warmth at
 * the end of every answer. A person writing:
 *
 *   «بازم ضرر کردم، به نظرت اینو نگه دارم؟»
 *
 * is asking a question about a position, but they are also frustrated, they
 * used the informal register, and the literal question hides a need for
 * containment rather than a forecast. An answer that only forecasts has
 * understood the words and missed the person.
 *
 * This module is a deterministic social read of the message:
 *
 *   · register — formal («شما», please, could you) vs informal (تو, داداش, bro)
 *   · tone — neutral / grateful / playful / confused / excited / anxious /
 *     frustrated / hostile
 *   · need — decision / risk containment / explanation / data / reassurance /
 *     small talk / information
 *   · ambiguity — how much the message leaves unsaid
 *   · signals — a confidence challenge, urgency, an indirect request
 *
 * It never guesses at facts, never authorises an action, and never adds a
 * model call. `renderSocialBrief` turns the read into obligations for the
 * answer; when the read is unremarkable it returns '' so an ordinary, neutral
 * question keeps the exact prompt it always had.
 *
 * Only the smartest mode sends the brief (balanced/swift stay byte-identical).
 */

export const SOCIAL_READ_SCHEMA = 'fbt.ai-social-read.v1';
export const SOCIAL_READ_VERSION = '1.0.0';

const PERSIAN_DIGITS = /[\u06F0-\u06F9]/g;

function fold(text) {
  return String(text || '')
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\u200c/g, '')
    .replace(/[\u064a\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .toLowerCase()
    .replace(/[!]{2,}/g, '!!');
}

/*
 * Persian is agglutinative: «مزخرفیه», «بی‌فایده‌اید», «نگرانم» carry their
 * grammar as a suffix. A strict trailing boundary therefore misses exactly the
 * messages this module exists for. Terms of 4+ Persian letters match as a
 * prefix; short ones («تو») stay strict so «توکن» is not read as «تو».
 */
function phrase(text, p) {
  const term = fold(p);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const persian = /[\u0600-\u06FF]/.test(term);
  const tail = persian && term.replace(/[^\u0600-\u06FF]/g, '').length >= 4 ? '' : '(?![\\p{L}])';
  return new RegExp(`(?<![\\p{L}])${escaped}${tail}`, 'u').test(text);
}

function anyPhrase(text, list) {
  return list.some((p) => phrase(text, p));
}

/* -------------------------------------------------------------------------- */
/*  LEXICONS                                                                  */
/* -------------------------------------------------------------------------- */

const FORMAL = [
  'شما', 'شماها', 'لطفا', 'لطفاً', 'ببخشید', 'محترم', 'جناب', 'سرکار', 'استاد',
  'please', 'could you', 'would you', 'kindly', 'sir', 'madam', 'excuse me'
];

const INFORMAL = [
  'تو', 'داداش', 'رفیق', 'بیخیال', 'چخبر', 'چطوری', 'چیه بابا',
  'bro', 'dude', 'yo', 'hey', 'mate', 'buddy'
];

const HOSTILE = [
  'احمق', 'بیفایده', 'چرت', 'مزخرف', 'مسخره', 'کلاهبردار', 'دروغگو', 'چی داری میگی',
  'idiot', 'stupid', 'useless', 'trash', 'garbage', 'scam', 'liar', 'nonsense'
];

const FRUSTRATED = [
  'بازم', 'کلافه', 'عصبی', 'اعصابم', 'خسته شدم', 'خسته‌ام', 'دیگه نمی‌کشم', 'حالم بد',
  'چرا هیچی', 'باز هم', 'نفرت', 'چه وضعشه', 'چه خبره', 'این چه برنامه',
  'frustrated', 'annoying', 'annoyed', 'fed up', 'sick of', 'tired of', 'again and again'
];

const ANXIOUS = [
  'می‌ترسم', 'میترسم', 'نگران', 'استرس', 'دلشوره', 'پولم بسوزه', 'از دست بدم',
  'ضرر نکنم', 'امن باشه', 'خطرناکه', 'خراب بشه',
  'scared', 'afraid', 'worried', 'anxious', 'nervous', 'lose my money', 'don’t want to lose', "don't want to lose"
];

const EXCITED = [
  'عالیه', 'عشقه', 'میره بالا', 'موشک', 'پامپ', 'توپه', 'انفجار قیمت',
  'moon', 'pump', 'excited', 'amazing', 'to the moon', 'rocket'
];

const GRATEFUL = [
  'مرسی', 'ممنون', 'دستت درد نکنه', 'دست شما درد نکنه', 'لطف کردی', 'سپاس',
  'thanks', 'thank you', 'appreciate', 'grateful'
];

const CONFUSED = [
  'نفهمیدم', 'گیج', 'منظورت چیه', 'واضح نیست', 'متوجه نشدم', 'سردرگم',
  'confused', "didn't understand", 'not clear', 'unclear', 'what do you mean'
];

const PLAYFUL = [
  'شوخی', 'شوخ', '😂', '😄', '😅', 'haha', 'lol', 'joking', 'kidding'
];

const URGENT = [
  'زود', 'سریع', 'فوری', 'همین الان', 'الان وقت', 'عجله',
  'urgent', 'asap', 'right now', 'quickly', 'emergency'
];

const CHALLENGE = [
  'مطمئنی', 'مطمئنید', 'مطمئن هستی', 'منبع', 'سند', 'از کجا میدونی', 'از کجا میدانید',
  'دروغ', 'حرفت را باور', 'چرا باید باور',
  'are you sure', 'source', 'proof', 'evidence', 'how do you know', 'really?'
];

const DECISION = [
  'چیکار کنم', 'چه کار کنم', 'بخرم یا نه', 'نگه دارم', 'بفروشم', 'به نظرت', 'نظرت چیه',
  'به صلاح', 'ارزششو داره', 'منطقیه',
  'should i', 'should we', 'worth it', 'would you', 'what do you think', 'hold or sell'
];

const RISK_NEED = [
  'ریسکش کمه', 'ریسک کم', 'امن', 'محافظت', 'ضرر نکنم', 'پولم بسوزه', 'جلوی ضرر',
  'protect', 'downside', 'safe', 'hedge', 'risk of loss'
];

const EXPLANATION = [
  'چرا', 'یعنی چی', 'توضیح', 'دلیلش چیه', 'چطور کار میکنه',
  'why', 'explain', 'what does', 'how does', 'reason'
];

const DATA = [
  'قیمت', 'چنده', 'چقدره', 'نرخ', 'آمار', 'داده', 'حجم',
  'price', 'how much', 'rate', 'data', 'volume', 'market cap'
];

const INDIRECT = [
  'نمیخوام', 'نمی‌خوام', 'فقط میخوام مطمئن', 'یه چیزی بپرسم', 'نگرانم',
  'i don', "i don't want", 'just want to be sure', 'not sure if', 'wondering if'
];

/*
 * Distress is not a tone: it is a safety state. Hyperbole is common in finance
 * («همه پولمو از دست دادم»), so the brief does not diagnose anyone — it simply
 * forbids trading advice, promises and lectures in that turn and points to real
 * human support.
 */
const DISTRESS = [
  'دیگه فایده ای نداره', 'دیگه فایده‌ای نداره', 'بهتره بمیرم', 'خودمو بکشم', 'زندگیم تمومه',
  'همه پولمو از دست دادم', 'همه چیمو از دست دادم', 'همه چیمو از دست دادم', 'نابود شدم',
  'want to die', 'kill myself', 'end it all', 'nothing matters', 'lost everything', 'no way out'
];

/* Persian politeness is not literal: «قربونت» is not a request and «اگر زحمتی
   نیست» is not a burden. Reading taarof literally produces either coldness or
   gushing, and both read as foreign to a Persian speaker. */
const TAAROF = [
  'قربونت', 'قربون دستت', 'دستت درد نکنه', 'دست شما درد نکنه', 'زحمت افتاد', 'زحمت شد',
  'شرمنده', 'خسته نباشی', 'لطف داری', 'مخلصیم', 'نوکرتم', 'به روی چشم', 'چشم'
];

const POLITE_REQUEST = [
  'اگر ممکنه', 'اگر امکانش هست', 'اگر زحمتی نیست', 'زحمت میشه', 'ممنون میشم',
  'لطف میکنی', 'لطف می‌کنی', 'if you could', 'if possible', 'would you mind'
];

const INDIRECT_REFUSAL = [
  'فعلا نه', 'فعلاً نه', 'شاید بعدا', 'شاید بعداً', 'بعدا شاید', 'سرم شلوغه',
  'وقت ندارم', 'نیازی نیست', 'لازم نیست', 'بیخیالش',
  'maybe later', 'not now', 'some other time', 'no thanks'
];

/* Words that carry no topic: used only for repetition detection. */
const REPEAT_STOPWORDS = new Set([
  'این', 'اون', 'آن', 'اینو', 'اونو', 'برای', 'درباره', 'میشه', 'میشود', 'کنم', 'کنم؟',
  'چیه', 'چیست', 'چطور', 'چه', 'چرا', 'کدام', 'الان', 'لطفا', 'لطفاً', 'ممنون', 'سلام',
  'the', 'this', 'that', 'what', 'with', 'about', 'please', 'could', 'would', 'should'
]);

const ASSET_OR_NUMBER = [
  /\b(btc|xbt|eth|sol|bnb|xrp|ada|doge|trx|ton|avax|dot|link|ltc|usdt|usdc)\b/i,
  /بیت\s*کوین|بیتکوین|اتریوم|تتر|سولانا|ریپل|دوج|کاردانو|شیبا/,
  /\d/
];

/* Priority: the loudest, most consequential state wins. */
const TONE_ORDER = ['hostile', 'frustrated', 'anxious', 'confused', 'excited', 'grateful', 'playful'];

/**
 * Read the social context of one message.
 * @param {{message?: string, locale?: string}} params
 * @returns {{schema, register, tone, need, ambiguity, signals, isSocialAct}}
 */
function detectTone(text) {
  const hits = {
    hostile: HOSTILE.filter((w) => phrase(text, w)).length,
    frustrated: FRUSTRATED.filter((w) => phrase(text, w)).length,
    anxious: ANXIOUS.filter((w) => phrase(text, w)).length,
    confused: CONFUSED.filter((w) => phrase(text, w)).length,
    excited: EXCITED.filter((w) => phrase(text, w)).length,
    grateful: GRATEFUL.filter((w) => phrase(text, w)).length,
    playful: /😂|😄|😅/.test(text) || PLAYFUL.some((w) => phrase(text, w))
  };
  return TONE_ORDER.find((id) => hits[id]) || 'neutral';
}

function significantWords(raw) {
  return [...new Set(fold(raw).replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !REPEAT_STOPWORDS.has(w) && !/^\d+$/.test(w)))];
}

/**
 * @param {object} params
 * @param {string} params.message  the current turn
 * @param {string} params.locale
 * @param {string} params.history  what the user already said (session summary)
 */
export function readSocialContext({ message = '', locale = 'fa', history = '' } = {}) {
  const raw = String(message || '').trim();
  const text = fold(raw);
  const historyText = fold(history);
  const signals = [];

  const formalHits = FORMAL.filter((w) => phrase(text, w)).length;
  const informalHits = INFORMAL.filter((w) => phrase(text, w)).length;
  const register = formalHits > informalHits ? 'formal' : informalHits > formalHits ? 'informal' : 'neutral';

  const tone = detectTone(text);
  if (tone !== 'neutral') signals.push(`tone:${tone}`);

  const distress = anyPhrase(text, DISTRESS);
  if (distress) signals.push('distress');

  const taarof = anyPhrase(text, TAAROF);
  if (taarof) signals.push('taarof');
  const politeRequest = anyPhrase(text, POLITE_REQUEST);
  if (politeRequest) signals.push('polite_request');
  const indirectRefusal = anyPhrase(text, INDIRECT_REFUSAL);
  if (indirectRefusal) signals.push('indirect_refusal');

  /*
   * Conversation-level social read. A person who asked the same thing twice is
   * not asking a second question — they are telling you the first answer was
   * not it. A tone that worsened across turns needs a different reply than the
   * same tone in a first message.
   */
  const historyTone = historyText ? detectTone(historyText) : 'neutral';
  const hasHistory = Boolean(historyText.trim());
  const currentWords = significantWords(raw);
  const overlap = hasHistory && currentWords.length >= 2
    ? currentWords.filter((w) => historyText.includes(w)).length / currentWords.length
    : 0;
  const repeat = hasHistory && currentWords.length >= 2 && overlap >= 0.6;
  if (repeat) signals.push('repeat_question');
  const negative = (t) => t === 'hostile' || t === 'frustrated';
  const escalation = hasHistory
    ? (negative(historyTone) && negative(tone) ? 'rising'
      : negative(historyTone) && !negative(tone) ? 'cooling'
        : !negative(historyTone) && negative(tone) ? 'rising' : 'stable')
    : 'unknown';
  if (escalation === 'rising') signals.push('tone_rising');
  if (escalation === 'cooling') signals.push('tone_cooling');

  const urgent = anyPhrase(text, URGENT);
  if (urgent) signals.push('urgency');

  const challenged = anyPhrase(text, CHALLENGE);
  if (challenged) signals.push('confidence_challenge');

  const indirect = anyPhrase(text, INDIRECT) && !/[?؟]/.test(raw);
  if (indirect) signals.push('indirect_request');

  /* Need: the strongest reading of what they are actually after. */
  let need = 'information';
  if (DECISION.some((w) => phrase(text, w))) need = 'decision';
  else if (RISK_NEED.some((w) => phrase(text, w)) || tone === 'anxious') need = 'risk_containment';
  else if (tone === 'hostile' || tone === 'frustrated') need = 'reassurance';
  else if (tone === 'confused' || anyPhrase(text, EXPLANATION)) need = 'explanation';
  else if (anyPhrase(text, DATA)) need = 'data';

  /* Ambiguity: what the message does not say. Short + no asset/amount is the
     classic «چیکار کنم؟» — answer the most likely reading, then ask ONE thing. */
  const hasSpecifics = ASSET_OR_NUMBER.some((re) => re.test(raw));
  const words = raw.split(/\s+/).filter(Boolean).length;
  const ambiguity = (!hasSpecifics && (words <= 6 || raw.length < 24))
    ? 'high'
    : (!hasSpecifics || words <= 2) ? 'medium' : 'low';
  if (ambiguity !== 'low') signals.push(`ambiguity:${ambiguity}`);

  return {
    schema: SOCIAL_READ_SCHEMA,
    version: SOCIAL_READ_VERSION,
    locale,
    register,
    tone,
    need,
    ambiguity,
    signals,
    urgent,
    challenged,
    indirect,
    distress,
    pragmatics: { taarof, politeRequest, indirectRefusal },
    relationship: {
      hasHistory,
      repeat,
      overlap: Number(overlap.toFixed(2)),
      historyTone,
      escalation,
      unresolved: repeat && negative(historyTone)
    },
    isSocialAct: words <= 4 && !hasSpecifics && !DECISION.some((w) => phrase(text, w))
  };
}

/**
 * Obligations for the answer. Empty string for an ordinary, clear, neutral
 * question — those turns must keep the prompt they always had.
 */
export function renderSocialBrief(read) {
  if (!read || read.schema !== SOCIAL_READ_SCHEMA) return '';
  const lines = [];

  /*
   * Safety first, and it outranks every style instruction below: a person who
   * says they have lost everything does not need a trading plan or a lecture.
   */
  if (read.distress) {
    lines.push('- SAFETY: they describe serious loss or distress. Open with one plain sentence that acknowledges it — no advice, no pep talk, no lecture about risk. Do NOT give trading or investment advice in this answer, do not promise that things will be fine, do not diagnose them, and do not moralise. Offer one concrete next step that does not involve money, and gently suggest talking to someone they trust or a professional. Keep it short.');
  }

  if (read.register === 'formal') {
    lines.push('- register: they wrote formally. Answer in the same register; do not slide into buddy tone.');
  } else if (read.register === 'informal') {
    lines.push('- register: they wrote informally. Keep it plain and direct; formality would read as distance, not respect.');
  }

  if (read.distress) {
    /* The tone lines below would compete with the safety instruction. */
  } else if (read.tone === 'hostile') {
    lines.push('- tone: they are hostile. Do not mirror it, do not scold, do not defend yourself. Answer the substance plainly and let the answer do the work.');
  } else if (read.tone === 'frustrated') {
    lines.push('- tone: they are frustrated (often after a loss). Acknowledge it in ONE short clause — no lecture, no pep talk, no moralising about risk.');
  } else if (read.tone === 'anxious') {
    lines.push('- tone: they are anxious. Say the risk once, plainly, and what is not knowable; never promise safety and never amplify the fear.');
  } else if (read.tone === 'confused') {
    lines.push('- tone: they did not understand something. Restate the point in simpler terms and define the one term that caused the confusion.');
  } else if (read.tone === 'excited') {
    lines.push('- tone: they are excited. Do not dampen it into a disclaimer, but state the downside once, concretely.');
  } else if (read.tone === 'grateful') {
    lines.push('- tone: they are grateful. One short human line, then the substance; no upsell.');
  } else if (read.tone === 'playful') {
    lines.push('- tone: they are playful. Stay warm and light, but keep the facts exact.');
  }

  if (!read.distress && read.need === 'risk_containment') {
    lines.push('- need: the literal question hides a need for risk containment. Answer the need, and name the interpretation you took.');
  } else if (!read.distress && read.need === 'decision') {
    lines.push('- need: they want a decision, not a survey. Give a recommendation with its condition and what would change it; do not hide behind "it depends".');
  } else if (!read.distress && read.need === 'reassurance') {
    lines.push('- need: they want to be taken seriously. Be direct and concrete; do not over-apologise.');
  } else if (!read.distress && read.need === 'explanation') {
    lines.push('- need: they want the reasoning, not only the number. Explain the mechanism in plain words.');
  }

  /* Persian pragmatics: taarof is politeness, not information. */
  if (read.pragmatics?.taarof) {
    lines.push('- taarof: they used a Persian politeness formula. Do not take it literally and do not answer it with inflated gratitude; one short warm clause is enough, then the substance.');
  }
  if (read.pragmatics?.politeRequest) {
    lines.push('- the request is wrapped in politeness («اگر زحمتی نیست», «ممنون میشم»). Treat it as a normal request: no apology for existing, no ceremony — just answer it.');
  }
  if (read.pragmatics?.indirectRefusal) {
    lines.push('- they declined politely. Accept it in one short line; do not push, do not re-offer the same thing, and do not ask why.');
  }

  /*
   * Conversation-level read: the same question twice is not a second question,
   * it is feedback that the first answer missed. A worsening tone is addressed
   * directly instead of being re-answered in the same voice.
   */
  if (read.relationship?.repeat) {
    lines.push('- they have already asked this. Do not repeat the same answer: say in one line what was already covered, then add what is new — or ask the one thing that was missing the first time.');
  }
  if (read.relationship?.escalation === 'rising') {
    lines.push('- the tone has worsened across the conversation. Do not become defensive or formal; name the unresolved point directly and fix it.');
  } else if (read.relationship?.escalation === 'cooling') {
    lines.push('- the tone has improved since the earlier turns. Do not re-open the earlier conflict or re-apologise; continue on the calmer footing.');
  }

  if (!read.distress) {
    if (read.ambiguity === 'high') {
      lines.push('- ambiguity: the request leaves almost everything unsaid. State the reading you chose in one line, answer that, and ask exactly ONE precise question at the end — never a list of questions.');
    } else if (read.ambiguity === 'medium') {
      lines.push('- ambiguity: one important detail is missing (asset, amount or horizon). Answer under a stated assumption and name the detail that would change the answer.');
    }
  }

  if (read.challenged) {
    lines.push('- they challenged your confidence or asked for a source. Separate what the evidence supports from what it does not, and never claim certainty the data cannot give. If no source exists, say so.');
  }
  if (read.urgent) {
    lines.push('- they are in a hurry. Put the recommendation and the single biggest risk in the first two sentences.');
  }
  if (read.indirect) {
    lines.push('- the request is indirect: answer the need behind the words and name that reading explicitly.');
  }

  if (!lines.length) return '';
  return `SOCIAL READ (how to answer this person, not only the question):\n${lines.join('\n')}`;
}

export default readSocialContext;
