/**
 * EMOTION READ — what the person is feeling, how strongly, and what an answer
 * owes that feeling.
 * ---------------------------------------------------------------------------
 * `socialRead` already answers «is this person hostile, anxious, confused?» —
 * one label per message. That is enough to avoid the wrong tone, and not
 * enough to answer a person who is grieving a loss, ashamed of a decision, or
 * quietly relieved. Those are different states with different obligations:
 *
 *   «همه پولمو از دست دادم»   grief + shock      → acknowledge, no advice
 *   «چقدر احمقم که فروختم»     shame, self-blame  → separate the decision
 *                                                   from their worth
 *   «برنامه‌تون دوباره خراب شد»  anger at a system → no grovelling, no
 *                                                   defensiveness, say what is
 *                                                   true and what happens next
 *   «بالاخره خوب شد، خیالم راحت» relief            → do not dampen it
 *
 * So this module reads emotion deterministically — no model call:
 *
 *   · primary emotion + mixed emotions (ambivalence is real and common)
 *   · valence / arousal / dominance (the three axes that change pacing)
 *   · intensity (0..1), from hits, boosters and diminishers, with negation
 *   · self-directed (shame) vs other-directed (anger at the platform/market)
 *   · cause: loss | market | platform | self | life | unknown
 *   · the needs that follow (acknowledgement, containment, repair, perspective)
 *   · trajectory across turns: rising / cooling / stable / unknown
 *
 * `renderEmpathyContract` turns that into obligations, and `checkEmotionTone`
 * holds the draft to the ones that matter: toxic positivity, moralising,
 * confirming self-blame, and answering a person in acute fear with advice and
 * no acknowledgement. Each is narrow on purpose — a checker that fires on every
 * sentence protects nothing.
 *
 * Smartest mode, level 2+. balanced/swift keep the prompt they always had.
 */

export const EMOTION_SCHEMA = 'fbt.ai-emotion-read.v1';
export const EMOTION_VERSION = '1.0.0';

/* ── text helpers ─────────────────────────────────────────────────────────── */

const FA_DIGITS = /[\u06F0-\u06F9]/g;

function fold(text) {
  return String(text || '')
    .replace(FA_DIGITS, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\u200c/g, ' ')
    .replace(/[\u064a\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/[ \t]+/g, ' ')
    .toLowerCase();
}

/*
 * Persian carries its grammar in suffixes («نگرانم», «داغونم»), so a strict
 * trailing boundary misses exactly the messages this module exists for. Terms
 * of 4+ Persian letters match as a prefix; short ones stay strict so «غم» does
 * not fire inside «مغز» or «تو» inside «توکن».
 */
function has(text, term) {
  const t = fold(term);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s]*');
  const persianLetters = t.replace(/[^\u0600-\u06FF]/g, '').length;
  const tail = persianLetters >= 4 ? '' : '(?![\\p{L}])';
  return new RegExp(`(?<![\\p{L}])${escaped}${tail}`, 'u').test(text);
}

function countHits(text, list) {
  return list.reduce((n, term) => n + (has(text, term) ? 1 : 0), 0);
}

/* ── lexicons ─────────────────────────────────────────────────────────────── */

const FEAR = [
  'می‌ترسم', 'میترسم', 'ترس', 'ترسیده', 'نگران', 'نگرانی', 'استرس', 'دلشوره', 'وحشت',
  'اضطراب', 'پولم بسوزه', 'از دست بدم', 'از دست بدهم', 'ضرر نکنم', 'امن باشه', 'خطرناکه',
  'scared', 'afraid', 'worried', 'anxious', 'nervous', 'panic', 'terrified'
];

const GRIEF = [
  'غمگین', 'غم', 'ناراحت', 'داغون', 'داغونم', 'افسرده', 'گریه', 'دلم گرفت', 'حالم گرفت', 'حالم گرفته', 'دلگیر', 'حیف',
  'از دست دادم', 'از دست دادمش', 'نابود شدم', 'زندگی‌ام خراب', 'زندگیم خراب', 'بدبخت شدم',
  'sad', 'grief', 'devastated', 'cried', 'crying', 'lost everything', 'hopeless'
];

const ANGER = [
  'عصبانی', 'عصبیم', 'حرص', 'حرصم', 'خشم', 'خشمگین', 'کلافه', 'دیگه تحمل', 'تحمل ندارم',
  'چرت', 'مزخرف', 'مسخره', 'کلاهبردار', 'دروغ', 'خفه', 'بی‌شرف',
  'angry', 'furious', 'pissed', 'annoyed', 'fed up', 'scam', 'liar', 'useless'
];

const SHAME = [
  'احمقم', 'احمق', 'خنگم', 'خنگ', 'بی‌عقل', 'بی عقلم', 'نادان', 'تقصیر خودم', 'خودمو نمی‌بخشم',
  'چرا این‌کارو کردم', 'چرا این کارو کردم', 'خجالت', 'شرمنده',
  'stupid', 'idiot', 'my fault', 'ashamed', 'embarrassed', 'i am dumb', "i'm dumb"
];

const HOPE = ['امیدوار', 'امید', 'انشالله', 'ان شاالله', 'باور دارم', 'میشه', 'hopeful', 'hope', 'believe it will'];
const RELIEF = ['خیالم راحت', 'نفس راحت', 'راحت شدم', 'بالاخره خوب', 'relieved', 'relief', 'finally fine'];
const JOY = ['خوشحال', 'عالیه', 'هیجان', 'هیجان‌زده', 'ذوق', 'happy', 'excited', 'thrilled', 'amazing'];
const LONELY = ['تنهام', 'تنها', 'کسی نیست', 'هیچ‌کس نیست', 'تنهایی', 'lonely', 'alone', 'no one'];
const BURNOUT = ['خسته شدم', 'خسته‌ام', 'بریدم', 'دیگه نمی‌کشم', 'انرژی ندارم', 'بی‌انگیزه', 'burnout', 'exhausted', 'tired of everything'];

/* Despair is not a stronger adjective, it is a different register: these say
   the person has stopped expecting anything. Weighted separately so a calm
   sentence with one of them is still read as acute. */
const DESPAIR = [
  'فایده‌ای نداره', 'فایده نداره', 'فایده‌ای نمی‌بینم', 'زندگی ارزش', 'دیگه نمی‌خوام', 'تحمل ندارم',
  'نابود شدم', 'همه پولمو از دست دادم', 'همه پولم رفت', 'نمی‌دونم چیکار کنم',
  'no point', 'not worth it', 'nothing left', 'lost everything', 'cannot take it'
];

const BOOSTERS = [
  'خیلی', 'بسیار', 'کاملاً', 'واقعاً', 'شدید', 'فوق‌العاده', 'داغون', 'دیگه', 'همیشه', 'هرگز',
  'very', 'really', 'so much', 'extremely', 'totally', 'completely'
];
const DIMINISHERS = ['کمی', 'یه ذره', 'یکم', 'کم', 'تقریباً', 'a bit', 'a little', 'slightly', 'somewhat'];

const NEGATED = [
  'نگران نیستم', 'نمی‌ترسم', 'نمیترسم', 'ترسی ندارم', 'مشکلی نیست', 'عصبانی نیستم', 'ناراحت نیستم',
  'خوشحال نیستم', 'امیدوار نیستم', 'not worried', 'not afraid', "don't worry", 'not angry', 'not sad'
];

const PLATFORM_TARGET = ['برنامه', 'اپلیکیشن', 'اپ', 'سایت', 'پلتفرم', 'صرافی', 'پشتیبانی', 'شما', 'شماها', 'fbt', 'app', 'platform', 'support', 'you'];
const MARKET_TARGET = ['بازار', 'قیمت', 'بیت‌کوین', 'بیت کوین', 'اتریوم', 'سیگنال', 'market', 'price', 'btc', 'eth'];

const ACK_MARKERS = [
  'متأسفم', 'متاسفم', 'می‌فهمم', 'میفهمم', 'درک می‌کنم', 'سخته', 'سخت است', 'طبیعیه', 'طبیعی است',
  'حق داری', 'حق داری که', 'می‌شنوم', 'میبینم که', 'می‌بینم که', 'حسابت را می‌فهمم',
  'sorry', 'i understand', 'that sounds', 'must be hard', 'i hear you', 'makes sense'
];

const TOXIC_POSITIVITY = [
  'نگران نباش', 'غصه نخور', 'همه چی خوب میشه', 'همه چیز خوب می‌شود', 'همه چی درست میشه', 'همه چیز درست می‌شود',
  'مطمئن باش', 'حتماً جبران میشه', 'حتما جبران می‌شود', 'فکرت رو ناراحت نکن', 'خوشحال باش',
  'don\'t worry', 'everything will be fine', 'it will all work out', 'cheer up', 'look on the bright side'
];

const MORALISING = [
  'نباید هیجانی', 'باید صبور باشی', 'باید یاد بگیری', 'خودت مقصر', 'تقصیر خودت', 'باید بیشتر دقت',
  'دفعهٔ بعد', 'دفعه بعد بهتر', 'درس عبرت', 'باید بلد باشی', 'اشتباه تو بود',
  'you should have', 'you must learn', 'your mistake', 'lesson learned', 'be more careful'
];

/* ── the read ─────────────────────────────────────────────────────────────── */

function intensityOf(text, categories) {
  const hits = Object.values(categories).reduce((n, list) => n + countHits(text, list), 0);
  if (!hits) return { hits: 0, intensity: 0 };
  const boosters = countHits(text, BOOSTERS);
  const diminishers = countHits(text, DIMINISHERS);
  const negated = countHits(text, NEGATED);
  const raw = 0.35 + Math.min(hits, 4) * 0.12 + boosters * 0.08 - diminishers * 0.2 - negated * 0.3;
  return { hits, intensity: Math.max(0, Math.min(1, Number(raw.toFixed(2)))) };
}

function causeOf(text, emotion) {
  if (emotion === 'shame') return 'self';
  if (['fear', 'grief'].includes(emotion)) {
    if (has(text, 'بازار') || has(text, 'قیمت') || has(text, 'ریخت') || has(text, 'افتاد')) return 'market';
    return 'loss';
  }
  if (emotion === 'anger') {
    if (countHits(text, PLATFORM_TARGET) > countHits(text, MARKET_TARGET)) return 'platform';
    return 'market';
  }
  return 'unknown';
}

const NEEDS = {
  fear: ['acknowledgement', 'containment', 'one_next_step'],
  grief: ['acknowledgement', 'no_advice_yet', 'company'],
  anger: ['acknowledgement', 'no_defensiveness', 'plain_facts'],
  shame: ['separation_of_decision_and_worth', 'no_lecture', 'perspective'],
  relief: ['no_dampening'],
  joy: ['no_dampening', 'one_caveat'],
  hope: ['calibration'],
  loneliness: ['acknowledgement', 'one_next_step'],
  burnout: ['acknowledgement', 'smallest_step_only'],
  neutral: []
};

/**
 * Read the emotion in this message.
 *
 * `history` is the conversation summary (text); it is used only to say whether
 * the state is rising or cooling, never to invent a feeling that is not there.
 */
export function readEmotion({ message = '', locale = 'fa', history = '', social = null } = {}) {
  const raw = String(message || '');
  const text = fold(raw);

  const categories = { fear: FEAR, grief: GRIEF, anger: ANGER, shame: SHAME, hope: HOPE, relief: RELIEF, joy: JOY, loneliness: LONELY, burnout: BURNOUT };
  const scores = {};
  for (const [name, list] of Object.entries(categories)) {
    const hits = countHits(text, list);
    if (hits) scores[name] = hits;
  }

  const { intensity } = intensityOf(text, categories);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = ranked.length ? ranked[0][0] : 'neutral';
  /* Ambivalence is common and must not be flattened: fear + hope is a real
     position, not a reading error. */
  const mixed = ranked.slice(1).filter(([, hits]) => hits > 0).map(([name]) => name).slice(0, 3);

  const negatedAll = countHits(text, NEGATED);
  const despair = countHits(text, DESPAIR);
  const effectiveIntensity = negatedAll && ranked.length <= negatedAll
    ? Math.max(0, Number((intensity - 0.4).toFixed(2)))
    : Math.min(1, Number((intensity + despair * 0.25).toFixed(2)));

  const selfDirected = primary === 'shame' || has(text, 'تقصیر خودم') || has(text, 'خودمو') || has(text, 'my fault');
  const otherDirected = ['anger', 'fear', 'grief'].includes(primary) ? causeOf(text, primary) : null;

  /* Valence/arousal/dominance: the three axes that change pacing, not labels. */
  const valence = { joy: 0.8, relief: 0.6, hope: 0.4, neutral: 0, burnout: -0.5, fear: -0.6, grief: -0.8, shame: -0.7, loneliness: -0.7, anger: -0.5 }[primary] ?? 0;
  const arousal = Math.min(1, Number((effectiveIntensity * (['anger', 'fear', 'joy'].includes(primary) ? 1 : 0.7)).toFixed(2)));
  const dominance = selfDirected ? Math.max(0, 0.5 - effectiveIntensity / 2) : primary === 'neutral' ? 0.6 : 0.4;

  const historyText = fold(history);
  let trajectory = 'unknown';
  if (historyText.trim()) {
    const pastHits = countHits(historyText, [].concat(FEAR, GRIEF, ANGER, SHAME, BURNOUT));
    if (pastHits && effectiveIntensity > 0.5) trajectory = 'rising';
    else if (pastHits && effectiveIntensity <= 0.35) trajectory = 'cooling';
    else if (pastHits) trajectory = 'stable';
    else trajectory = effectiveIntensity > 0.4 ? 'rising' : 'unknown';
  }

  const needs = new Set(NEEDS[primary] || []);
  if (effectiveIntensity >= 0.7) needs.add('short_sentences');
  if (selfDirected) needs.add('no_lecture');
  if (social?.distress) {
    needs.add('no_advice_yet');
    needs.add('no_pep_talk');
  }

  return {
    schema: EMOTION_SCHEMA,
    version: EMOTION_VERSION,
    locale,
    primary,
    mixed,
    valence,
    arousal,
    dominance,
    intensity: effectiveIntensity,
    acute: primary !== 'neutral' && (effectiveIntensity >= 0.55 || despair > 0),
    selfDirected,
    otherDirected,
    cause: primary === 'neutral' ? 'unknown' : causeOf(text, primary),
    needs: [...needs],
    trajectory,
    /* Small talk and neutral questions carry an emotion read too, but no
       obligation: the renderer returns '' for those. */
    signals: ranked.map(([name, hits]) => `${name}:${hits}`).slice(0, 4)
  };
}

/* ── obligations ──────────────────────────────────────────────────────────── */

/**
 * What the answer owes this emotional state. '' for a neutral, low-intensity
 * message — an ordinary question keeps the prompt it always had.
 */
export function renderEmpathyContract(read) {
  if (!read || read.schema !== EMOTION_SCHEMA) return '';
  if (read.primary === 'neutral' || read.intensity < 0.35) return '';

  const lines = [`EMOTION READ (this is about the person, not only the question — intensity ${read.intensity.toFixed(2)}):`];

  if (read.primary === 'grief') {
    lines.push('- grief: acknowledge the loss in ONE plain sentence, then stop. Do not offer a plan, do not reframe the loss as a lesson, do not say it will get better.');
  } else if (read.primary === 'fear') {
    lines.push('- fear: name the risk once, plainly, and say what is genuinely not knowable. No promises of safety, no amplifying the worst case.');
  } else if (read.primary === 'anger') {
    lines.push('- anger: do not mirror it, do not grovel, do not defend yourself. State what is true and what happens next, plainly.');
  } else if (read.primary === 'shame') {
    lines.push('- shame: the person is blaming themselves. Separate the decision from their worth — one bad trade is not a verdict on them. Do not lecture, do not agree with the self-insult.');
  } else if (read.primary === 'relief') {
    lines.push('- relief: do not dampen it with cautions; confirm the good thing happened and add at most one thing to keep watching.');
  } else if (read.primary === 'joy') {
    lines.push('- excitement: do not crush it into a disclaimer; state one concrete downside once, and no more.');
  } else if (read.primary === 'loneliness') {
    lines.push('- loneliness: answer as company, not as a form. One next step, small and concrete.');
  } else if (read.primary === 'burnout') {
    lines.push('- exhaustion: give the smallest next step only. No plan with ten items, no "you should have".');
  } else if (read.primary === 'hope') {
    lines.push('- hope: respect it and calibrate it — say what would have to be true, not that it will happen.');
  }

  if (read.mixed.length) {
    lines.push(`- mixed feelings (${read.mixed.join(' + ')}): hold both, do not flatten them into one. Name the one that changes the decision.`);
  }
  if (read.selfDirected) {
    lines.push('- self-directed anger: never agree that they are stupid. Put the mistake in the decision, not in the person.');
  }
  if (read.trajectory === 'rising') lines.push('- the emotion has been escalating across turns: do not repeat the previous answer, name the unresolved point once.');
  if (read.trajectory === 'cooling') lines.push('- the emotion has cooled: do not reopen the old fight, build on the calmer register.');
  if (read.intensity >= 0.65) lines.push('- keep sentences short; a wall of text reads as indifference at this intensity.');
  if (read.needs.includes('no_advice_yet')) lines.push('- do not give trading advice in this answer; one non-financial next step is enough.');

  lines.push('- never use toxic positivity («نگران نباش»، «همه چی خوب میشه»، «مطمئن باش») and never moralise about risk. Acknowledge precisely, then answer the question.');
  return lines.join('\n');
}

/* ── compliance ───────────────────────────────────────────────────────────── */

const ADVICE_RE = /(?<![\p{L}])(?:بخر|بفروش|نگه\s*دار|وارد\s*شو|خارج\s*شو|بستن\s*پوزیشن|حد\s*ضرر\s*بگذار|سرمایه\s*گذاری\s*کن|بخرش|بفروشش)(?![\p{L}])|(?<![\p{L}])(?:you\s+should\s+(?:buy|sell)|enter\s+now|set\s+a\s+stop)(?![\p{L}])/iu;

function firstSentence(text = '') {
  return String(String(text || '').trim().split(/(?<=[.!?؟])\s+/)[0] || '').trim();
}

/**
 * Did the answer respect the emotion it was told about?
 *
 * Four narrow checks. They fire on acute or self-directed states only, because
 * a calm market question owes no empathy preamble and must not be nagged.
 */
export function checkEmotionTone({ read = null, answer = '' } = {}) {
  const text = String(answer || '');
  const issues = [];
  if (!read || read.schema !== EMOTION_SCHEMA || !text.trim() || read.primary === 'neutral' || read.intensity < 0.35) {
    return { schema: EMOTION_SCHEMA, applicable: false, issues, compliant: true };
  }

  const hasAck = countHits(fold(text), ACK_MARKERS) > 0;

  if (read.acute && ['fear', 'grief', 'shame'].includes(read.primary)) {
    if (countHits(fold(text), TOXIC_POSITIVITY) > 0) {
      issues.push({
        id: 'TOXIC_POSITIVITY',
        severity: 'HIGH',
        detail: 'the answer tells them not to worry or promises it will be fine. At this intensity that reads as not listening. Acknowledge the situation and say what is actually known.'
      });
    }
    if (countHits(fold(text), MORALISING) > 0) {
      issues.push({
        id: 'MORALISING',
        severity: 'HIGH',
        detail: 'the answer lectures about risk or points at their mistake. At this intensity the person needs the situation acknowledged, not a lesson.'
      });
    }
  }

  if (read.selfDirected && countHits(fold(text), MORALISING) > 0) {
    issues.push({
      id: 'SELF_BLAME_CONFIRMED',
      severity: 'HIGH',
      detail: 'the person is blaming themselves and the answer agrees or lectures. Separate the decision from their worth; never confirm the self-insult.'
    });
  }

  /* Only states that owe an acknowledgement. Relief and joy are not debts. */
  if (read.acute && ['fear', 'grief', 'shame', 'anger', 'loneliness', 'burnout'].includes(read.primary) && !hasAck) {
    issues.push({
      id: 'NO_ACKNOWLEDGEMENT',
      severity: 'MEDIUM',
      detail: 'the person is in an acute emotional state and the answer opens with content. Acknowledge the situation in one clause first, then answer.'
    });
  }

  if (read.needs.includes('no_advice_yet') || (read.acute && read.primary === 'grief')) {
    if (ADVICE_RE.test(text)) {
      issues.push({
        id: 'ADVICE_IN_GRIEF',
        severity: 'MEDIUM',
        detail: 'this is a grief/distress turn and the answer gives trading advice. No buy/sell/hold instruction here; one non-financial next step is enough.'
      });
    }
  }

  return {
    schema: EMOTION_SCHEMA,
    applicable: true,
    primary: read.primary,
    intensity: read.intensity,
    issues,
    compliant: issues.length === 0
  };
}

/** The reviewer's MUST-FIX block ('' when the draft respects the emotion). */
export function renderEmotionDeficit(check) {
  if (!check || check.compliant !== false || !check.issues?.length) return '';
  return `EMOTION VIOLATIONS (the answer misreads how the person feels; fix each one):\n${check.issues
    .map((i) => `- [${i.id}] ${i.detail}`)
    .join('\n')}`;
}

export default readEmotion;
