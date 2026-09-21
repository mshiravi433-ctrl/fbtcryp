/**
 * FBT INTENT OS — UPGRADE 13 (1/4): LANGUAGE SENSE
 * ---------------------------------------------------------------------------
 * The question the whole conversational layer has to answer before it can
 * answer anything is: **what language is this person actually talking in?**
 *
 * Until now the app asked the *client* (`locale`) and the client answered with
 * `document.documentElement.lang` — the UI language, which is a display
 * setting, not a statement about the sentence. That is fine for a Persian user
 * typing Persian, and wrong for every other case we now have to carry:
 *
 *   · an Afghan user whose UI is Persian but who writes «زما حالت ډیر ښه دی»
 *   · a Turkish user who pastes a German headline
 *   · anyone typing Finglish — «salam, khabar chie?» has no locale that means it
 *
 * Detection here is deliberately cheap and deterministic: script ranges first
 * (a Cyrillic sentence is Russian without needing a model), then a small
 * marker lexicon per language, then transliterated Persian/Urdu. It returns
 * `confidence` and the `evidence` it used, and when the two disagree with the
 * declared locale it says so instead of silently overruling the app.
 *
 * Laws:
 *   - never invents a language: below `MIN_CONFIDENCE` the result is
 *     `lang: null` with `reason: 'AMBIGUOUS'`, and callers keep the locale
 *   - pure and synchronous: no model, no network, no i18n import, so the
 *     server, the browser and a Node probe all get the identical answer
 *   - twelve UI languages + transliteration; an unsupported-but-identified
 *     language is reported as `detected` with `supported: false`, which is
 *     honest, rather than being forced into English
 */

export const LANGUAGE_SENSE_SCHEMA = 'fbt.ai-language-sense.v13';
export const LANGUAGE_SENSE_VERSION = '13.0.0';

/** The languages the product localises to (same twelve as `parserLocales`). */
export const SUPPORTED_LANGS = Object.freeze([
  'en', 'fa', 'ar', 'tr', 'ru', 'zh', 'hi', 'ur', 'id', 'es', 'pt', 'fr'
]);

export const MIN_CONFIDENCE = 0.45;

/* -------------------------------------------------------------------------- */
/*  FOLDING                                                                    */
/*  Persian ZWNJ is not \s and JS \b does not exist around Arabic-script       */
/*  letters, so every matcher below runs on a folded form. Same discipline as  */
/*  collaborationRouter's `fold`, but here it is exported so the reply layer    */
/*  and the dictation normaliser share ONE definition instead of three.         */
/* -------------------------------------------------------------------------- */

/**
 * Letters that NFD leaves behind, plus the ones whose accents are letters.
 * Turkish `ı` has no decomposition and `ß` is a letter of its own; without
 * these, «nasilsin» and «nasılsın» would be two different words to us.
 */
const ACCENT_RESIDUE = Object.freeze({
  'ı': 'i', 'İ': 'i', 'ğ': 'g', 'Ğ': 'g', 'ş': 's', 'Ş': 's', 'ç': 'c', 'Ç': 'c',
  'ø': 'o', 'Ø': 'o', 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe', 'ß': 'ss',
  'đ': 'd', 'Đ': 'd', 'ŧ': 't', 'ħ': 'h', 'Ħ': 'h', 'ı': 'i', 'ĳ': 'ij', 'Ĳ': 'ij',
  'ł': 'l', 'Ł': 'l', 'ž': 'z', 'Ž': 'z', 'š': 's', 'Š': 's', 'ț': 't', 'Ţ': 't'
});

/**
 * Remove diacritics — combining marks after NFD, then the residue letters.
 *
 * This is a MATCHING device only, never a display transform: what the user
 * typed is shown back to them exactly as they typed it.
 */
export function foldAccents(value) {
  const nfd = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!nfd) return '';
  let out = '';
  for (const ch of nfd) out += ACCENT_RESIDUE[ch] ?? ch;
  return out;
}

export function foldText(value) {
  return String(value ?? '')
    .replace(/\u200c/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARABIC_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
const INDIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const DEVANAGARI_DIGITS = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
const BENGALI_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
const ALL_DIGITS = { ...ARABIC_DIGITS, ...INDIC_DIGITS, ...DEVANAGARI_DIGITS, ...BENGALI_DIGITS };

/** Localised digits and separators become ASCII, so «۵۰دلار» = 50. */
export function toAsciiDigits(value) {
  let out = '';
  for (const ch of String(value ?? '')) out += ALL_DIGITS[ch] ?? ch;
  return out
    .replace(/\u066B/g, '.')   // Arabic decimal separator
    .replace(/\u066C/g, '')    // Arabic thousands separator
    .replace(/\u066A/g, '.')   // Arabic percent sign → keep the number, drop the glyph
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}

/* -------------------------------------------------------------------------- */
/*  SCRIPT RANGES — the strongest, cheapest signal there is                    */
/* -------------------------------------------------------------------------- */

const SCRIPTS = Object.freeze([
  { script: 'Arabic', re: /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/, langs: ['fa', 'ar', 'ur'] },
  { script: 'Devanagari', re: /[\u0900-\u097F]/, langs: ['hi'] },
  { script: 'Bengali', re: /[\u0980-\u09FF]/, langs: ['ur'] },
  { script: 'Gurmukhi', re: /[\u0A00-\u0A7F]/, langs: ['ur'] },
  { script: 'Cyrillic', re: /[\u0400-\u04FF]/, langs: ['ru'] },
  { script: 'Han', re: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/, langs: ['zh'] },
  { script: 'Latin', re: /[A-Za-z\u00C0-\u024F]/, langs: ['en', 'tr', 'es', 'pt', 'fr', 'id'] }
]);

function scriptOf(text) {
  let best = { script: null, count: 0, langs: [] };
  for (const entry of SCRIPTS) {
    const matches = text.match(entry.re);
    const count = matches ? matches.length : 0;
    if (count > best.count) best = { script: entry.script, count, langs: entry.langs };
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/*  MARKER LEXICONS                                                            */
/*  Common words that a native reader resolves instantly and a counter can     */
/*  count. Kept small on purpose: a social sentence is three to six words,     */
/*  so five markers are plenty and a hundred would only add false positives.    */
/* -------------------------------------------------------------------------- */

const MARKERS = Object.freeze({
  /*
   * One-word markers only carry weight when they are not universal. `y`, `o`,
   * `el`, `la`, `bu` were in here once and made Spanish win any sentence that
   * contained a letter combination by accident; they are gone. Short function
   * words are the language's fingerprints, not its nouns.
   */
  fa: ['سلام', 'خوبم', 'خوبی', 'چطوری', 'چطوره', 'ممنون', 'مرسی', 'لطفا', 'بخرم', 'فروشم', 'هستم', 'نیست', 'نیس', 'میخوام', 'چیه', 'خبر', 'امروز', 'شما', 'کجا', 'چرا', 'که', 'است', 'بود', 'یه', 'یک', 'پول', 'قیمت', 'بدم', 'کردم', 'کنم', 'بگو', 'میگه', 'بازار', 'خرید', 'ببخشید', 'درود', 'خسته نباشی', 'صبح بخیر', 'شب بخیر', 'خداحافظ', 'بدرود', 'خسته', 'حوصله', 'کیف',
       /*
        * Words that exist only in Persian. `تتر`/`دلار` are deliberately left
        * out — an Arabic speaker writes them exactly the same way, and a marker
        * that two languages share decides nothing.
        */
       'بخر', 'بفروش', 'بخرم', 'این', 'اون', 'الان', 'چند', 'چقدر', 'میشه', 'نمیشه', 'بشه', 'میدم', 'میگم', 'داشتم', 'برا', 'پیش', 'دلم', 'شلوغ'],
  ar: ['السلام', 'عليكم', 'مرحبا', 'أهلا', 'اهلا', 'كيف', 'حالك', 'بخير', 'شكرا', 'من فضلك', 'انا', 'اليوم', 'اخبار', 'سعر', 'اشتري', 'عندك', 'هل', 'هذي', 'مش', 'كويس', 'حاجة', 'الجديد', 'جديد'],
  /* The Romanised forms are here too: an Urdu speaker on a phone with an English
     keyboard is the commonest case, not the exotic one. */
  ur: ['السلام', 'کیا', 'ہے', 'ہوں', 'آپ', 'میں', 'شکریہ', 'قیمت', 'خریدوں', 'بیچوں', 'کیسا', 'کیسی', 'ٹھیک', 'خبریں', 'آج', 'بھی', 'نہیں', 'ہمارا', 'میرا',
       'aap', 'ap', 'theek', 'theek_hoon', 'bohat', 'shukriya', 'zaroor', 'Zaroorat', 'nahi', 'kya', 'kiya', 'kesay', 'kaisay', 'keren', 'karein'],
  tr: ['merhaba', 'selam', 'nasılsın', 'nasilsin', 'iyiyim', 'teşekkür', 'tesekkur', 'bugün', 'bugun', 'fiyat', 'ne var', 'naber', 'günaydın', 'gunaydin', 'iyi geceler', 'lütfen', 'lutfen', 'değil', 'degil', 'şey', 'sey', 'ben', 'siz'],
  ru: ['привет', 'здравствуйте', 'как дела', 'как вы', 'хорошо', 'спасибо', 'сегодня', 'цена', 'купить', 'продать', 'новости', 'пожалуйста', 'меня', 'тебя', 'норм', 'здарова'],
  zh: ['你好', '您好', '我很好', '谢谢', '今天', '价格', '买', '卖', '新闻', '市场', '怎么样', '什么', '多少', '我'],
  hi: ['नमस्ते', 'नमस्कार', 'कैसे', 'मैं', 'आप', 'धन्यवाद', 'कीमत', 'आज', 'क्या', 'हाल', 'ठीक'],
  es: ['hola', 'qué', 'que tal', 'cómo estás', 'como estas', 'gracias', 'hoy', 'precio', 'comprar', 'vender', 'noticias', 'por favor', 'estoy', 'puedo', 'cuánto', 'cuanto', 'novedad', 'como', 'estas', 'buenas', 'todo', 'bien', 'nada', 'ahora', 'esto', 'pasa', 'cuando', 'cuál', 'cual'],
  pt: ['olá', 'ola', 'tudo bem', 'como vai', 'obrigado', 'obrigada', 'hoje', 'preço', 'preco', 'comprar', 'vender', 'notícias', 'noticias', 'por favor', 'estou', 'quanto', 'você', 'voce', 'não', 'nao', 'novidade', 'beleza', 'você', 'voce', 'estou', 'estamos', 'tá', 'ta', 'então', 'entao', 'aí', 'ai', 'tudo', 'beleza', 'joia', 'tranquilo'],
  fr: ['bonjour', 'salut', 'ça va', 'ca va', 'comment allez', 'tu vas', 'ici', 'maintenant', 'alors', 'aussi', 'nous', 'mon', 'mes', 'merci', 'aujourd', 'prix', 'acheter', 'vendre', 'actualités', "s'il vous", 'vous', 'quoi', 'oui', 'non', 'c est', 'très', 'tres', 'nouveauté', 'nouveautes', 'je suis'],
  id: ['halo', 'apa kabar', 'apa khabar', 'kabar', 'terima kasih', 'hari ini', 'harga', 'beli', 'jual', 'berita', 'apakah', 'saya', 'anda', 'bagaimana', 'tidak', 'buat', 'berita'],
  en: ['hello', 'hi', 'hey', 'how are you', "i'm", 'im fine', 'thanks', 'thank you', 'today', 'price', 'buy', 'sell', 'news', 'please', "what's", 'whats', 'market', 'your', 'this', 'that', 'what', 'how'],
  de: ['hallo', 'wie geht', 'danke', 'bitte', 'guten morgen', 'ich bin', 'nicht', 'preis', 'neuigkeiten']
});

/* Diacritic sets that decide a Latin-script sentence without a lexicon. */
/*
 * Diacritics are a hint, not a verdict: `ç` belongs to Turkish, French,
 * Portuguese and Catalan at once, so a weight of 3 on `ç` used to read
 * «comment ça va» as Portuguese. Only unambiguous letters carry real weight,
 * and word markers outrank them.
 */
const LATIN_TIEBREAK = Object.freeze([
  { lang: 'tr', re: /[ıİğĞşŞ]/, weight: 3 },
  { lang: 'pt', re: /(ão|õ|ê|ç)/, weight: 2 },
  { lang: 'es', re: /[¿¡ñÑ]/, weight: 3 },
  { lang: 'es', re: /[áéíóú]/, weight: 1 },
  /*
   * `\best\b` used to sit here as a French marker. Without the `u` flag `á` is
   * not a word character, so it also fired inside the Spanish `estás` and a
   * Spanish greeting came back French. Elisions are the real fingerprint.
   */
  { lang: 'fr', re: /(œ|»|«|très|\\b(?:c|j|d|l|qu|s|n|d)')/, weight: 2 },
  { lang: 'de', re: /(ß|ö|ä|ü)/, weight: 2 }
]);

/*
 * Finglish / Pinglish: Persian and Urdu written in ASCII, which is what people
 * actually type on a phone with no Persian keyboard. Without this the whole
 * social layer treats «salam chetori» as English and answers in English.
 * These patterns are Romanisations, so they only run on ASCII-only input and
 * never override a real word of another language.
 */
const TRANSLIT = Object.freeze({
  /*
   * Finglish markers, chosen for words English/French/Spanish do not contain.
   * `man`, `to`, `az` and `can` are deliberately absent: an Urdu speaker and an
   * English speaker both write those, and a language guess is only worth
   * making when it cannot be an accident.
   */
  fa: [/\bsala+am\b/i, /\bchetor\w*/i, /\bhaalet\b/i, /\bkho+b+i\b/i, /\bmamnoon\b/i, /\bmerc(i|a)\b/i,
       /\b(?:cha|che)\s*kha(?:b|v)r\b/i, /\bkhabar\s*(?:chie|chi|nist|ahval|داد|دارید)/i, /\b(?:chi|chie)\b/i, /\bbekheir\b/i,
       /\b(?:ghor|khaste)\s* nabashi\b/i, /\bshoma\b/i, /\bkhodaa?hafez\b/i, /\blotfan\b/i,
       /\bmikham|mikhay\b/i, /\bbefr(o|i)os\b/i, /\bkhariat|kharid\b/i, /\b(?:toman|tooman|tuman)\b/i,
       /\bgheymat|gheimat\b/i, /\bbazar\b/i, /\bbede\b/i, /\bkon\b/i],
  ur: [/\bassalam\b/i, /\bshukriya\b/i, /\bkaisay\b/i, /\btheek\b/i, /\bmain\b.*\bhoon\b/i]
});

/* Languages we can name but the product does not localise to. Naming them is
   useful: it lets the reply layer say "I read this as X and answer in Y". */
const NAMED_UNSUPPORTED = Object.freeze([
  { lang: 'de', re: /\b(hallo|wie geht|danke|bitte|ich|nicht)\b/i },
  { lang: 'it', re: /\b(ciao|come stai|grazie|prego|oggi|prezzo)\b/i },
  { lang: 'ckb', re: /[ڕۆێچۆڵژ](?:\s|$)/ },
  { lang: 'bn', re: /[\u0980-\u09FF]/ },
  { lang: 'pa', re: /[\u0A00-\u0A7F]/ }
]);

/* -------------------------------------------------------------------------- */
/*  DETECTION                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Which language is this sentence written in?
 *
 * @param {string} text  raw user text
 * @param {object} [opts]
 * @param {string|null} [opts.declared]  the client's UI locale, used only as a
 *   tie-breaker — never as the answer
 * @returns {{lang: string|null, script: string|null, confidence: number,
 *   evidence: string[], supported: boolean, declared: string|null,
 *   overrides: boolean, schema: string}}
 */
export function detectLanguage(text, { declared = null } = {}) {
  const raw = foldText(text);
  const declaredLang = String(declared || '').toLowerCase().split('-')[0] || null;
  const base = {
    schema: LANGUAGE_SENSE_SCHEMA,
    script: null,
    lang: null,
    confidence: 0,
    evidence: [],
    supported: false,
    declared: declaredLang,
    overrides: false
  };
  if (!raw) return { ...base, reason: 'EMPTY' };

  const digitFree = toAsciiDigits(raw);
  const { script, langs, count } = scriptOf(digitFree);
  if (!script) return { ...base, reason: 'NO_SCRIPT' };

  const lower = digitFree.toLowerCase();
  const evidence = [`script:${script}`];

  /* Scripts with exactly one supported language are decided on the spot. */
  if (script === 'Han') {
    return finish(base, { lang: 'zh', confidence: 0.97, evidence, script });
  }
  if (script === 'Cyrillic') {
    return finish(base, { lang: 'ru', confidence: 0.95, evidence, script });
  }
  if (script === 'Devanagari') {
    return finish(base, { lang: 'hi', confidence: 0.95, evidence, script });
  }
  if (script === 'Bengali') {
    return finish(base, { lang: 'bn', confidence: 0.9, evidence, script, supportedOverride: false });
  }
  if (script === 'Gurmukhi') {
    return finish(base, { lang: 'pa', confidence: 0.9, evidence, script, supportedOverride: false });
  }

  /* Arabic script: fa vs ar vs ur — letter identity does most of the work,
     because Persian/Urdu `ی`/`ے` and Arabic `ي`/`ة`/`إ` are different code points. */
  if (script === 'Arabic') {
    const urduMarks = (digitFree.match(/[ٹڈڑںھۓےے]/g) || []).length; // ی alone is shared with Persian — never an Urdu marker
    const urduFinalYe = (digitFree.match(/ے/g) || []).length;
    const arabicMarks = (digitFree.match(/[أإآؤةيى]/g) || []).length;
    const harakat = (digitFree.match(/[\u064B-\u0652]/g) || []).length;
    const persianMarks = (digitFree.match(/[پچژگ]/g) || []).length;
    const scores = { fa: 0, ar: 0, ur: 0 };
    if (urduFinalYe) { scores.ur += 3 + urduFinalYe; evidence.push('ur:final-ے'); }
    if (arabicMarks) { scores.ar += 2 * arabicMarks; evidence.push(`ar:${arabicMarks} arabic-only letters`); }
    if (harakat) { scores.ar += harakat; evidence.push(`ar:${harakat} diacritics`); }
    if (persianMarks) { scores.fa += persianMarks; evidence.push(`fa:${persianMarks} پچژگ`); }
    if (/می\s|می‌|نمی|خودم|تان\b/.test(digitFree)) { scores.fa += 2; evidence.push('fa:verb-prefix می'); }
    if (/ہے|کیا|نہیں|میں/.test(digitFree)) { scores.ur += 3; evidence.push('ur:ہے/کیا'); }
    if (urduMarks && !persianMarks) scores.ur += urduMarks;

    for (const [lang, words] of Object.entries(MARKERS)) {
      if (!['fa', 'ar', 'ur'].includes(lang)) continue;
      for (const w of words) if (lower.includes(w.toLowerCase())) { scores[lang] += 1; }
    }
    const ranked = Object.entries(scores).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    const [lang, score] = ranked[0];
    const margin = ranked[0][1] - (ranked[1]?.[1] ?? 0);
    if (!score) {
      /* No lexical clue at all — trust the declared locale when it is one of
         the three Arabic-script languages we support, else stay unknown. */
      if (['fa', 'ar', 'ur'].includes(declaredLang)) {
        evidence.push('declared-locale-tiebreak');
        return finish(base, { lang: declaredLang, confidence: 0.55, evidence, script });
      }
      return { ...base, script, reason: 'AMBIGUOUS_ARABIC_SCRIPT', evidence };
    }
    const confidence = Math.min(0.97, 0.5 + Math.min(0.27, score * 0.03) + (margin > 1 ? 0.2 : margin > 0 ? 0.1 : 0));
    return finish(base, { lang, confidence, evidence: [...evidence, `markers:${lang}=${score}`], script });
  }

  /* Latin script: diacritics, then marker counts, then transliteration. */
  const scores = {};
  for (const { lang, re, weight } of LATIN_TIEBREAK) {
    const hits = lower.match(new RegExp(re.source, 'gi'));
    if (hits?.length && weight) {
      scores[lang] = (scores[lang] || 0) + Math.min(3, hits.length) * weight;
      evidence.push(`${lang}:${hits.length} diacritics`);
    }
  }
  for (const [lang, words] of Object.entries(MARKERS)) {
    let hits = 0;
    for (const w of words) {
      if (!w) continue;
      const needle = w.toLowerCase();
      if (needle.includes(' ')) { if (lower.includes(needle)) hits += 3; continue; }
      const re = new RegExp(`(?:^|[^a-zÀ-ÿ])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-zÀ-ÿ])`, 'i');
      if (re.test(lower)) hits += 2;
    }
    if (hits) scores[lang] = (scores[lang] || 0) + hits;
  }
  const isAsciiOnly = !/[^\x00-\x7F]/.test(lower);
  if (isAsciiOnly && count) {
    for (const [lang, pats] of Object.entries(TRANSLIT)) {
      let hits = 0;
      for (const re of pats) if (re.test(lower)) hits += 1;
      if (hits) {
        scores[lang] = (scores[lang] || 0) + hits * 2;
        evidence.push(`translit:${lang}=${hits}`);
      }
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  if (!ranked.length) {
    /* A bare number, a ticker, one English-ish word with no marker: not enough
       to call. Declared locale wins, marked as such. */
    const lang = SUPPORTED_LANGS.includes(declaredLang) ? declaredLang : null;
    if (!lang) return { ...base, script, reason: 'NO_MARKERS', evidence };
    return finish(base, { lang, confidence: 0.5, evidence: [...evidence, 'declared-locale-only'], script });
  }
  const [lang, score] = ranked[0];
  const runner = ranked[1]?.[1] ?? 0;
  const margin = score - runner;
  /* An unsolicited named-but-unsupported language (German, Italian) only wins
     if it beats the field clearly; otherwise markers speak louder. */
  let unsupportedPick = null;
  for (const { lang: u, re } of NAMED_UNSUPPORTED) {
    if (re.test(lower) && u !== lang) { unsupportedPick = u; break; }
  }
  const chosen = unsupportedPick && margin <= 1 ? unsupportedPick : lang;
  const confidence = chosen === lang
    ? Math.min(0.96, 0.5 + Math.min(0.3, score * 0.04) + (margin > 2 ? 0.16 : margin > 0 ? 0.1 : 0))
    : 0.5;
  return finish(base, { lang: chosen, confidence, evidence: [...evidence, `markers:${lang}=${score}`, `runner=${runner}`], script });
}

function finish(base, { lang, confidence, evidence, script, supportedOverride = null }) {
  const supported = supportedOverride === null ? SUPPORTED_LANGS.includes(lang) : supportedOverride;
  const out = {
    ...base,
    script,
    lang: confidence >= MIN_CONFIDENCE ? lang : null,
    probableLang: lang,
    confidence: Number(confidence.toFixed(2)),
    evidence,
    supported
  };
  if (out.lang && base.declared && out.lang !== base.declared) {
    out.overrides = true;
    out.declaredMismatch = { declared: base.declared, detected: out.lang };
  }
  if (!out.lang) out.reason = 'BELOW_CONFIDENCE';
  return out;
}

/**
 * The ONE language a reply should be written in: what the user typed, and
 * failing that what the app is displaying, and failing that English.
 *
 * @returns {{lang: string, source: 'detected'|'declared'|'fallback', detection: object}}
 */
export function respondIn(text, { declared = null } = {}) {
  const detection = detectLanguage(text, { declared });
  if (detection.lang && detection.supported) return { lang: detection.lang, source: 'detected', detection };
  const declaredLang = String(declared || '').toLowerCase().split('-')[0];
  if (SUPPORTED_LANGS.includes(declaredLang)) return { lang: declaredLang, source: 'declared', detection };
  return { lang: 'en', source: 'fallback', detection };
}

export default detectLanguage;
