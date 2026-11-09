/**
 * DISCOURSE MIRROR — answer in the register the person is actually using.
 * ---------------------------------------------------------------------------
 * A person who writes «قربونت، لطف داری، یه سؤال داشتم» and a person who writes
 * «ببین داداش، این بازار گندش رو درآورد، الان چیکار کنم؟» are asking the same
 * kind of question. Answering both in the same flat institutional voice is a
 * social failure in both directions: the first reads as cold, the second reads
 * as being talked down to.
 *
 * So this module reads the *discourse* — not the topic:
 *
 *   warmth     «ممنون»، «لطف داری»، «قربونت»، emoji, softened requests
 *   command    bare imperatives («بگو»، «بذار کنار»، «الان انجام بده»)
 *   charge     expletives and profanity, and WHERE they point: at the
 *              situation, at the market, or at the assistant
 *   play       jokes, «😂», «شوخیکردم»
 *   energy     calm / plain / charged (drives sentence length and openers)
 *
 *  and says how far the answer may follow:
 *
 *   · warmth  → be warm back; informal stays informal; no flattery, no
 *               distance disguised as respect.
 *   · command → answer first, no preamble, no hedging, short lines.
 *   · a profane remark ABOUT THE SITUATION → matching one mild expletive at the
 *     same level is allowed (and often what makes the answer feel human). Never
 *     above the user's level, never invented, never aimed at them.
 *   · profanity AIMED AT THE ASSISTANT → do not mirror it, do not scold, do not
 *     moralise; answer plainly.
 *   · slurs → never, at any level. Anger can be acknowledged without slurs.
 *   · nothing readable → be normal: plain, courteous, no styling. That is the
 *     default the user asked for.
 *
 * `checkDiscourseMirror` then holds the draft to the boundary: escalation above
 * the user's level, profanity where the user used none, mirrors of abuse, and a
 * cold institutional reply to a warm message.
 *
 * Smartest mode, level 2+. balanced/swift keep the prompt they always had.
 */

export const DISCOURSE_SCHEMA = 'fbt.ai-discourse.v1';
export const DISCOURSE_VERSION = '1.0.0';

/* ── text helpers ─────────────────────────────────────────────────────────── */

function fold(text) {
  return String(text || '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\u200c/g, ' ')
    .replace(/[\u064a\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .toLowerCase();
}

function has(text, term) {
  const t = String(term);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\u200c]*');
  const persianLetters = t.replace(/[^\u0600-\u06FF]/g, '').length;
  const tail = persianLetters >= 4 ? '' : '(?![\\p{L}])';
  return new RegExp(`(?<![\\p{L}])${escaped}${tail}`, 'iu').test(String(text || ''));
}

function countHits(text, list) {
  return list.reduce((n, term) => n + (has(text, term) ? 1 : 0), 0);
}

/* ── lexicons ─────────────────────────────────────────────────────────────── */

const WARM = [
  'ممنون', 'مرسی', 'سپاس', 'لطف داری', 'لطف کردی', 'لطف شما', 'قربونت', 'دستت درد نکنه',
  'دست شما درد نکنه', 'خدا خیرت بده', 'عزیزی', 'گلم', 'جانم', 'مهربون', 'مهربان',
  'thanks', 'thank you', 'appreciate', 'kind of you', 'my friend', 'buddy', 'please and thanks'
];

const AFFECTION = ['عزیزم', 'جانم', 'دوستت دارم', 'قربون دستت', 'love you', 'dear', 'sweetheart'];

const PLAY = ['😂', '😄', '🤣', '😅', 'شوخی', 'شوخیکردم', 'haha', 'lol', 'joking', 'kidding', '😉'];

const COMMAND = [
  'بگو', 'بگو چی', 'بذار', 'بذار کنار', 'انجام بده', 'الان بگو', 'سریع بگو', 'بیا بگو',
  'فقط جواب بده', 'بدون مقدمه', 'خلاصه بگو', 'بهم بگو',
  'tell me', 'just answer', 'answer me', 'do it', 'give me', 'now', 'no preamble'
];

const EXCLAMATION = ['!', '!!', '!!!'];

/* Profanity, by weight. Level 1 is everyday frustration, level 2 is real
   swearing, level 3 is a slur — and slurs are never mirrored, at any level. */
const MILD = [
  'چرت', 'مزخرف', 'لعنتی', 'لعنتی‌ها', 'کوفت', 'زهرمار', 'پدرسوخته', 'خاک بر سر',
  'damn', 'heck', 'crap', 'bloody', 'darn'
];
const STRONG = [
  'گه', 'گه خورد', 'گه‌خور', 'گند', 'گندش', 'کثافت', 'تخمی', 'کیری', 'کسشر', 'چس',
  'shit', 'fuck', 'fucking', 'bullshit', 'bollocks', 'ass', 'dick', 'piss'
];
const SLUR = [
  'حرومزاده', 'حرامزاده', 'بی‌غیرت', 'بی غیرت', 'جنده', 'کس‌کش', 'کون', 'کس', 'می‌کشمت',
  'asshole', 'bastard', 'bitch', 'motherfucker', 'retard', 'slut', 'whore'
];

const AT_ASSISTANT = [
  'تو', 'شما', 'هوش مصنوعی', 'ربات', 'برنامه', 'اپ', 'پشتیبانی', 'سیستم', 'بات',
  'you', 'your', 'bot', 'ai', 'support', 'app'
];

const PROFANITY_ABOUT_SITUATION = ['بازار', 'قیمت', 'قیمتا', 'بیت', 'اتریوم', 'سکه', 'صرافی', 'معامله', 'پوزیشن', 'مارکت', 'market', 'price', 'exchange'];

const COLD_INSTITUTIONAL = [
  'لطفاً توجه داشته باشید', 'در پاسخ به درخواست شما', 'به استحضار می‌رساند', 'بدینوسیله',
  'احتراماً به آگاهی می‌رساند', 'مقتضی است',
  'please note that', 'we wish to inform', 'kindly be advised', 'pursuant to'
];

/* ── the read ─────────────────────────────────────────────────────────────── */

function readProfanity(text) {
  const mild = countHits(text, MILD);
  const strong = countHits(text, STRONG);
  const slur = countHits(text, SLUR);
  let level = 0;
  if (slur) level = 3;
  else if (strong) level = 2;
  else if (mild) level = 1;

  /* Who the swearing points at: the situation (market, exchange, the day) or
     the assistant. `\b` is ASCII-only and never matches at «تو», so the
     address has to be read with the same Persian-boundary helper as the rest. */
  const addressed = ['تو', 'شما', 'شماها', 'هوش مصنوعی', 'ربات', 'بات', 'پشتیبانی', 'برنامه', 'اپ', 'سیستم', 'you', 'your', 'bot', 'ai', 'support', 'app'];
  const assistantHits = countHits(text, addressed);
  const situationHits = countHits(text, PROFANITY_ABOUT_SITUATION);
  const targetedAtAssistant = level > 0 && assistantHits > 0 && assistantHits >= Math.max(1, situationHits);
  return { level, mild, strong, slur, targetedAtAssistant, situationHits };
}

/**
 * Read the discourse style of the message.
 *
 * Returns `confidence: 'none'` when nothing readable is present — the caller
 * then sends no brief at all, which is the "be normal" fallback.
 */
export function readDiscourse({ message = '', locale = 'fa', social = null, emotion = null } = {}) {
  const raw = String(message || '');
  const text = fold(raw);

  const warmthHits = countHits(text, WARM) + countHits(text, AFFECTION);
  const playHits = countHits(text, PLAY);
  const commandHits = countHits(text, COMMAND);
  const exclamations = (raw.match(/[!]{1,}/g) || []).length;
  const profanity = readProfanity(text);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(raw);
  const words = text.split(/\s+/).filter(Boolean).length;
  const imperativeOpen = /^(?:بگو|بذار|بده|بهم بگو|الان|فقط|tell|give|do|just)\b/u.test(text) || /^(?:بگو|بذار|بده|بهم|الان|فقط)/u.test(text);

  const warmth = warmthHits > 0 && warmthHits >= profanity.level ? 'warm' : 'none';
  const playful = playHits > 0;
  const commanding = commandHits > 0 || (imperativeOpen && words <= 8);

  let style = 'neutral';
  if (profanity.level >= 2) style = 'charged';
  else if (profanity.level === 1) style = 'frustrated';
  else if (warmth === 'warm') style = 'warm';
  else if (playful) style = 'playful';
  else if (commanding) style = 'commanding';

  /* Emotions outrank a single polite word: «ممنون ولی داغونم» is not a warm
     message with a sad topic, it is a sad message with a polite opener. */
  if (emotion && ['grief', 'shame', 'fear', 'burnout', 'loneliness'].includes(emotion.primary) && Number(emotion.intensity) >= 0.55) {
    style = 'hurt';
  }

  const energy = profanity.level >= 2 || (emotion?.arousal ?? 0) >= 0.7 || exclamations >= 2 ? 'charged'
    : style === 'neutral' ? 'plain' : 'warm';

  /* How far the answer may follow the user's language. */
  let profanityPolicy = 'none';
  if (profanity.level === 3) profanityPolicy = 'never_slur';
  else if (profanity.targetedAtAssistant) profanityPolicy = 'do_not_mirror';
  else if (profanity.level === 2) profanityPolicy = 'match_at_level';
  else if (profanity.level === 1) profanityPolicy = 'match_at_level';

  const readable = style !== 'neutral' || profanity.level > 0 || emoji;

  return {
    schema: DISCOURSE_SCHEMA,
    version: DISCOURSE_VERSION,
    locale,
    style,
    warmth,
    playful,
    commanding,
    energy,
    emoji,
    profanity: {
      level: profanity.level,
      targetedAtAssistant: profanity.targetedAtAssistant,
      policy: profanityPolicy
    },
    signals: [
      warmthHits ? `warmth:${warmthHits}` : null,
      playHits ? `play:${playHits}` : null,
      commandHits ? `command:${commandHits}` : null,
      exclamations >= 2 ? 'excited-punctuation' : null,
      profanity.level ? `profanity:${profanity.level}` : null,
      emoji ? 'emoji' : null
    ].filter(Boolean),
    confidence: readable ? 'read' : 'none'
  };
}

/* ── obligations ──────────────────────────────────────────────────────────── */

const STYLE_RULES = {
  warm: [
    'they wrote warmly. Open warmly — one natural warm clause, not a flourish — and keep their level of informality. Do not answer a kind message with an institutional voice.',
    'warmth is not flattery: no «چه سؤال عالی», no compliments about the question, no gratitude for their gratitude.'
  ],
  playful: [
    'they are being playful. Stay light, and if they used an emoji, at most one back. Do not lecture, do not turn the joke into a risk warning.',
    'still answer the question under the joke.'
  ],
  commanding: [
    'they are giving orders. Answer first, in the imperative mode they used: no preamble, no «بستگی دارد» opener, no hedging paragraphs.',
    'short lines, one decision per line. Politeness stays, padding goes.'
  ],
  frustrated: [
    'they are swearing at the situation, not at you. Do not police their language and do not turn clinical.',
    'matching ONE mild expletive at their level — about the situation — is allowed and often reads as honesty. Never go above their level, never invent a stronger word, never aim it at them.'
  ],
  charged: [
    'they are swearing hard about the situation. Do not scold and do not sanitise the conversation; answer the substance plainly.',
    'you may match their level once, about the situation. Never above it, never a slur, never at them. If their words are aimed at you, do not mirror at all.'
  ],
  hurt: [
    'they are hurt, not styling a message. Warmth is welcome; profanity is not — not even mirrored. Keep it short and kind.'
  ],
  neutral: [
    'no strong register to follow. Be normal: plain, courteous, direct.'
  ]
};

/**
 * The discourse as a prompt block. '' when nothing readable was present — the
 * "be normal" case costs no tokens and changes nothing.
 */
export function renderDiscourseContract(discourse) {
  if (!discourse || discourse.schema !== DISCOURSE_SCHEMA || discourse.confidence === 'none') return '';
  const lines = [`DISCOURSE (match how they are talking, not just what they asked):`];

  const rules = STYLE_RULES[discourse.style] || STYLE_RULES.neutral;
  for (const rule of rules) lines.push(`- ${rule}`);

  if (discourse.profanity.level > 0) {
    const level = discourse.profanity.level;
    if (discourse.profanity.policy === 'never_slur') {
      lines.push('- their message contains a slur. The answer must not repeat it or answer with any slur, ever; acknowledge the anger in plain words and answer the substance.');
    } else if (discourse.profanity.policy === 'do_not_mirror') {
      lines.push('- their swearing is aimed at you. Do not mirror it, do not defend yourself, do not scold them; answer plainly and let the answer earn the tone back.');
    } else {
      lines.push(`- their profanity is level ${level} of 3 and is about the situation. You may use at most the SAME level, once, about the situation. Never stronger, never a slur, never at them, never gratuitous.`);
    }
  } else {
    lines.push('- they did not swear. Do not swear: profanity without invitation is the clearest way to sound fake.');
  }

  if (discourse.emoji) lines.push('- they used an emoji: at most one back, and only if it fits.');
  if (discourse.energy === 'charged') lines.push('- energy is high: keep sentences short and land the answer early.');

  return lines.join('\n');
}

/* ── compliance ───────────────────────────────────────────────────────────── */

function profanityLevelOf(text) {
  return readProfanity(fold(text));
}

/**
 * Did the answer keep the discourse boundary?
 *
 * Four checks, each with its own trigger. They never ask an answer to swear —
 * only to stop above the line the user drew.
 */
export function checkDiscourseMirror({ discourse = null, answer = '' } = {}) {
  const text = String(answer || '');
  const issues = [];
  if (!discourse || discourse.schema !== DISCOURSE_SCHEMA || !text.trim() || discourse.confidence === 'none') {
    return { schema: DISCOURSE_SCHEMA, applicable: false, issues, compliant: true };
  }

  const reply = profanityLevelOf(text);
  const userLevel = discourse.profanity.level;

  if (reply.slur) {
    issues.push({
      id: 'SLUR_IN_ANSWER',
      severity: 'HIGH',
      detail: 'the answer contains a slur. Slurs are never mirrored, at any level; acknowledge the anger and answer the substance.'
    });
  } else if (discourse.profanity.policy === 'do_not_mirror' && reply.level > 0) {
    issues.push({
      id: 'MIRRORED_AT_ASSISTANT',
      severity: 'HIGH',
      detail: 'their swearing was aimed at you and the answer swears back. Do not mirror abuse; answer plainly and let the answer do the work.'
    });
  } else if (userLevel === 0 && reply.level > 0) {
    issues.push({
      id: 'PROFANITY_WITHOUT_INVITATION',
      severity: 'HIGH',
      detail: 'the user did not swear and the answer does. Swearing at someone who wrote politely is the clearest way to sound fake.'
    });
  } else if (userLevel > 0 && reply.level > userLevel) {
    issues.push({
      id: 'MIRROR_ESCALATION',
      severity: 'HIGH',
      detail: `the user swore at level ${userLevel} and the answer at level ${reply.level}. Match or stay below; escalation turns a shared complaint into an insult.`
    });
  }

  if (discourse.style === 'warm' && !reply.level) {
    const cold = countHits(fold(text), COLD_INSTITUTIONAL) > 0
      || /^(?:لطفاً توجه|به استحضار|در پاسخ به)/u.test(String(text).trim());
    if (cold) {
      issues.push({
        id: 'COLD_REPLY_TO_WARM_MESSAGE',
        severity: 'MEDIUM',
        detail: 'they wrote warmly and the answer opens like a formal notice. Warm one clause back and drop the institutional phrasing.'
      });
    }
  }

  return {
    schema: DISCOURSE_SCHEMA,
    applicable: true,
    style: discourse.style,
    issues,
    compliant: issues.length === 0
  };
}

/** The reviewer's MUST-FIX block ('' when the draft matches the register). */
export function renderDiscourseDeficit(check) {
  if (!check || check.compliant !== false || !check.issues?.length) return '';
  return `DISCOURSE VIOLATIONS (the answer is in the wrong register for this message; fix each one):\n${check.issues
    .map((i) => `- [${i.id}] ${i.detail}`)
    .join('\n')}`;
}

export default readDiscourse;
