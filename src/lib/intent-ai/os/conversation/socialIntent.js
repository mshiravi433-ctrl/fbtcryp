/**
 * FBT INTENT OS — UPGRADE 13 (2/4): SOCIAL ACT
 * ---------------------------------------------------------------------------
 * «حالت چطوره» and «چخبر» look identical to a keyword engine: two or three
 * words, no token, no amount, no verb that moves money. Both used to land in
 * one `GREETING` bucket and both got the same sentence back:
 *
 *   «سلام! خوشحالم که اینجایی. درباره بازار، دارایی‌ها یا هر هدف مالی‌ات بپرس.»
 *
 * But a human reader does not hear them as the same thing at all:
 *
 *   · «حالت چطوره؟» is a **pleasantry**. Answer it as a person would and then
 *     stop. Any market data attached to it is noise.
 *   · «چه خبر؟» / «خب، خبری نیست؟» is a **request for news**. In a money app,
 *     the news a person is asking about is what their money is doing —
 *     prices, the day's move, a yield worth taking, their own wallet. A hello
 *     in reply to that is the assistant refusing the question it was asked.
 *
 * This module is the split, done properly and in every language the product
 * ships. It is pure and deterministic — no model, no network — because a
 * social read of a six-word sentence must cost nothing and must be testable.
 *
 * Laws:
 *   - an act is a *reading*, never an *authorization*: nothing here can
 *     produce or approve an action; `executionAuthorized: false` is returned
 *     so a caller cannot mistake a confident parse for consent
 *   - the action guard outranks everything: «سلام، ۵۰ دلار تتر بخر» is a BUY
 *     wearing a greeting, and routing it to small talk loses money
 *   - an unrecognised sentence is `NOT_SOCIAL`, not a guess. Silence about
 *     what we do not know is better than a confident wrong reading
 */

import { foldText, toAsciiDigits, foldAccents, detectLanguage, respondIn } from './languageSense.js';

export const SOCIAL_ACT_SCHEMA = 'fbt.ai-social-act.v13';
export const SOCIAL_ACT_VERSION = '13.0.0';

export const SOCIAL_ACTS = Object.freeze({
  GREETING: 'GREETING',
  HOW_ARE_YOU: 'HOW_ARE_YOU',
  WHATS_UP: 'WHATS_UP',
  THANKS: 'THANKS',
  GOODBYE: 'GOODBYE',
  IDENTITY: 'IDENTITY',
  CAPABILITY: 'CAPABILITY',
  WELLBEING: 'WELLBEING',
  SMALL_TALK: 'SMALL_TALK',
  NOT_SOCIAL: 'NOT_SOCIAL'
});

/* -------------------------------------------------------------------------- */
/*  THE ACTION GUARD                                                            */
/*  Words that mean somebody is about to move money or ask for a specific
 *  product answer. A social act may sit *beside* them (so the reply can greet
 *  first), but the turn is never routed to small talk.                     */
/* -------------------------------------------------------------------------- */

const ACTION_HINTS = Object.freeze([
  /* persian */ /بخرم?\b/, /بفروش|می\u200c?فروشم/, /سواپ|تبدیل|مبادله/, /بریز|واریز|ارسال|انتقال/, /پل\s*کن|بریج/, /استیک|فارم|لند|وام|قرض/, /فیوچرز|اهرم|لوریج|پاس\s*مارت/, /واریز\s*کن/, /حد\s*ضرر|استاپ/, /برداشت/,
  /* english */ /\b(?:buy|sell|swap|send|transfer|bridge|stake|farm|lend|borrow|deposit|withdraw|leverage|long|short|liquidat\w*|cancel|approve|revoke)\b/i, /\bdca\b/i, /\bplace\b.*\border\b/i, /\bset\s+an?\s+alert\b/i, /\bmove\s+\w+\s+to\b/i,
  /* arabic */ /اشتر|أشتري|ابيع|حوالة|تحويل|سحب|إيداع|جسر/,
  /* turkish */ /\b(?:al\b|sat\b|gönder|çek|yatır|değiştir|köprü|stake)\b/iu,
  /* russian */ /(?:купить|продать|обмен|отправить|вывести|внести|стейкинг)/i,
  /* chinese */ /买|卖|兑换|转账|提币|充币|质押/,
  /* hindi/urdu */ /खरीद|बेच|भेजें|लेن|خریدنا|بیچنا|بھیج/,
  /* es/pt/fr/id */ /\b(?:comprar|vender|enviar|cambiar|retirar|depo|transferir|mandar)\b/i, /\b(?:acheter|vendre|envoyer|échanger|retirer)\b/iu, /\b(?:beli|jual|kirim|tukar|tarik|setor)\b/i
]);

/** A concrete asset name or a quantity makes it a task, not chatter. */
const SPECIFICITY = Object.freeze([
  /\$?\s*\d[\d.,]*\s*(?:\$|usd|usdt?|dollar|toman|tooman|تومان|دلار|درهم|euro|eur|ریال)?/i,
  /\b(btc|xbt|eth|sol|bnb|xrp|ada|doge|trx|ton|avax|dot|link|uni|ltc|bch|matic|pol|arb|op|base|tron|polygon)\b/i,
  /بیت\s*کوین|اتریوم|اتر|تتر|سولانا|بایننس|دوج|شیبا|ریپل|کاردانو/,
  /\b(usdc|dai|stable|stablecoin)\b/i
]);

/* -------------------------------------------------------------------------- */
/*  ACT LEXICONS                                                               */
/*  One entry per act, twelve languages each, matched on the folded text.      */
/*  Anchored where the idiom is only social at the START of a short message    */
/*  («چطوری» at the head of a long sentence is a follow-up, not a hello).      */
/* -------------------------------------------------------------------------- */

const PATTERNS = Object.freeze({
  [SOCIAL_ACTS.GREETING]: [
    /(?:^|\s)(?:سلام|سلاام|سلامت|درود|سلام\s*علیک|عزیزی|خوش\s*اومدی)/,
    /(السلام\s*عل[يی][ك]?م|وعليكم|أهلا|اهلا|مرحبا|هلا|صباح\s*الخير|مساء\s*الخير|هلو|يا\s*هلا)/,
    /(?:^|\s)(?:salam|salaam|selam|merhaba|hello|hi|hey|hola|ola|ciao|bonjour|salut|halo|привет|здравствуйте|здарова|你好|您好|नमस्ते|नमस्कार|greetings|yo)/,
    /(dobrý\s*den|dobry\s*den|günaydın|gunaydin|good\s*morning|good\s*afternoon|good\s*evening|صبح\s*بخیر|شب\s*بخیر|ظهر\s*بخیر|عصر\s*بخیر|good\s*day)/,
    /(hey\s*there|hi\s*there|hello\s*there|hey\s*dear)/
  ],
  [SOCIAL_ACTS.HOW_ARE_YOU]: [
    /(حالت\s*چطوره|حالت\s*خوبه|حالت\s*چطو|چطوری|خوبی|خوبین|خوب\s*هستید|چطوره\s*حالت)/,
    /(كيف\s*حالك|شلونك|شنو\s*حالتك|كيفك|كيف\s*الصحة|خيرا\s*إن\s*شاء\s*الله)/,
    /(کیسے\s*ہو|کیسی\s*ہو|سب\s*ٹھیک|کیا\s*حال\s*ہے|تم\s*کیسے\s*ہو)/,
    /\b(nasılsın|nasilsin|iyi misin|ne\s*haber|naber|neredesin)\b/iu,
    /* `est[áa]?\w*` on purpose: «¿cómo estás?», «como estás tu», the rioplatense
       «cómo estái» and every unaccented phone spelling are the same sentence. */
    /\b(c(?:o|ó)mo\s*est\w*|qu(?:é|e)\s*tal|todo\s*bien|c(?:o|ó)mo\s*te\s*va|qu(?:é|e)\s*pas\w*|qu(?:é|e)\s*onda)\b/i,
    /\b(tudo\s*(?:bem|bom|certo|tranquilo|joia|bonito|beleza)|como\s*vai|como\s+(?:voc(ê|e)\s+)?est\w*|voc(ê|e)\s*est\w*\s*(?:bem|ok|bem\?)|t\s*na\s*hora|beleza\?)\b/iu,
    /\b(comment\s*ça\s*va|comment\s*allez[- ]vous|ça\s*va|ça\s*(?:roule|gaze|baigne)|tu\s*vas\s*bien|vous\s*allez\s*bien)\b/iu,
    /(как\s*дела|как\s*ты|как\s*вы|как\s*сам|чё\s*как|как\s*жизнь|норм)/i,
    /(你好吗|你最近怎么样|最近好吗|身体好吗|你好不好)/,
    /* `kha?bar` because Malay speakers write «apa khabar» — one letter, same sentence. */
    /\b(apa\s*kh?abar|kh?abarmu|gimana\s*kh?abarnya|bagaimana\s*kh?abar)\b/i,
    /(आप\s*कैसे\s*हैं|कैसे\s*हो|कैसी\s*हो|सब\s*ठीक)/,
    /\b(how\s*are\s*you|how'?re\s*you|how\s*do\s*you\s*do|how\s*is\s*it\s*going|how\s*are\s*u|hru|how\s*ya\s*doing|are\s*you\s*(good|okay|ok|well))\b/i,
    /\b(wie\s*geht'?s|alles\s*gut)\b/i
  ],
  /*
   * «چه خبر» family. In Persian this is a greeting for some speakers and a real
   * "tell me something new" for others — which is exactly why it must not be
   * answered with a bare hello: the brief costs nothing and a missed question
   * costs the whole turn. Idioms that merely LOOK literal are NOT included:
   * Indonesian «apa kabar» and Urdu «کیا حال ہے» are pleasanties (HOW_ARE_YOU),
   * not news requests, so they are matched there instead.
   */
  [SOCIAL_ACTS.WHATS_UP]: [
    /(چه\s*خبر|چخبر|خبر\s*چیه|خبری\s*نیست?|تازه\s*چی|چیه\s*خبر|بازار\s*چی\s*می?گه|بازار\s*چیکره|چخبرا)/,
    /(شو\s*في\s*جديد|ايه\s*الاخبار|أي\s*أخبار|شنو\s*الاخبار|عندك\s*خبر|في\s*جديد|واش\s*عندك\s*اخبار)/,
    /(کیا\s*خبر\s*ہے|کوئی\s*خبر|نئی\s*خبریں|کیا\s*ہوا\s*بازار)/,
    /\b(ne\s*var\s*ne\s*yok|son\s*dakika|gelişmeler\s*var\s*mı|piyasada\s*ne\s*var)\b/iu,
    /\b(qué\s*hay\s*de\s*nuevo|que\s*hay\s*de\s*nuevo|hay\s*novedad|qué\s*pasa|que\s*pasa)\b/iu,
    /* Portuguese keeps `que`/`de` as separate words and the accents arrive folded,
       so the patterns are written without them on purpose. */
    /\b(o\s*que\s*ha\s*de\s*novo|o\s*que\s*vai\s*de\s*novo|alguma\s*n(?:ovidade|oticia)|tem\s*n(?:ovidade|ovidades|oticia)|\bnovidades\b|como\s*estao\s*as\s*coisas)\b/iu,
    /(quoi\s*de\s*neuf|des\s*nouvelles|il\s*se\s*passe\s*quoi|quoi\s*de\s*neuf\s*sur)/,
    /(что\s*нового|что\s*случилось|что\s*на\s*рынке|какие\s*новости|че\s*нового|новости\s*есть)/,
    /(有什么新闻|有什么新消息|有什么消息|最近有什么|有啥新鲜事|市场有什么动静)/,
    /\b(what'?s\s*up|whats\s*up|what\s*is\s*up|what'?s\s*new|whats\s*new|any\s*news|any\s*updates|what'?s\s*happening|what\s*is\s*happening|update\s*me|fill\s*me\s*in|catch\s*me\s*up|what\s*happened)\b/i,
    /\b(ada\s*berita|apa\s*berita|berita\s*terbaru|ada\s*update|update\s*dong)\b/i,
    /(कोई\s*खबर|क्या\s*खबर|बाज़ार\s*क्या\s*कहता\s*है|कोई\s*खबर\s*नहीं)/,
    /\b(gibt\s*es\s*neues|was\s*ist\s*los|neue\s*infos)\b/iu
  ],
  [SOCIAL_ACTS.THANKS]: [
    /(ممنون|مرسی|سپاس|دستت\s*درد\s*نکنه|دمت\s*گرم|قربانت|لطف\s*کردی|زحمت\s*کشیدی|خیلی\s*خوب\s*بود|عالی\s*بود)/,
    /(شكرا|شکرا|متشكرم|يسلمو|تسلم|ميرسي|عافيت)/,
    /(شکریہ|بہت\s*شکریہ|زبردست)/,
    /\b(teşekkür|tesekkurler|sag\s*ol|sağol|eyvallah|tamamdır|tamamdir)\b/iu,
    /\b(gracias|muchas\s*gracias|te\s*lo\s*agradezco|genial|perfecto)\b/i,
    /\b(obrigad[oa]|muito\s*obrigad|valeu)\b/i,
    /\b(merci|thanks|thank\s*you|thx|ty|cheers|appreciate|awesome\s*thanks)\b/i,
    /(спасибо|благодарю|сенкс)/,
    /(谢谢|多谢|感谢|辛苦了)/,
    /\b(terima\s*kasih|makasih|nuhun)\b/i,
    /(धन्यवाद|थैंक\s*यू|शुक्रिया)/
  ],
  [SOCIAL_ACTS.GOODBYE]: [
    /(خداحافظ|بدرود|خدافظ|فعلا|فعلاً|خدا\s*حافظ|به\s*امید\s*دیدار|شب\s*خوش)/,
    /(مع\s*السلامة|إلى\s*اللقاء|الي\s*اللقاء|باي\s*باي|تصبح\s*على\s*خير)/,
    /(خدا\s*حافظ|الوداع|مillos)/,
    /\b(görüşürüz|gorusuruz|bay\s*bay|iyi\s*geceler|kendine\s*iyi\s*bak)\b/iu,
    /\b(hasta\s*la\s*vista|nos\s*vemos|buenas\s*noches|chao|adi[óo]s)\b/iu,
    /\b(tchau|at[ée]\s*(?:amanh[ãa]|logo)|boa\s*noite|adeus)\b/iu,
    /\b(goodbye|good\s*bye|\bbye\b|see\s*you|cya|talk\s*later|good\s*night|gn)\b/i,
    /(пока|до\s*свидания|всего\s*доброго|спокойной\s*ночи)/,
    /(再见|晚安|拜拜)/,
    /\b(sampai\s*jumpa|selamat\s*(malam|siang)|dadah)\b/i,
    /(अलविदा|फिर\s*मिलेंगे|शुभ\s*रात्रि)/
  ],
  [SOCIAL_ACTS.IDENTITY]: [
    /(تو\s*کیستی|کی\s*هستی|اسمت\s*چیه|نامت\s*چیه|خودتو\s*معرفی|تو\s*کی\b|تو\s*چیستی)/,
    /(من\s*أنت|اسمك\s*إيه|انت\s*mien|عرفني\s*على\s*نفسك)/,
    /(آپ\s*کون\s*ہیں|تم\s*کون)/,
    /\b(kimsin|adın\s*ne|kendini\s*tanıt)\b/iu,
    /\b(who\s*are\s*you|what'?s\s*your\s*name|whats\s*your\s*name|introduce\s*yourself|are\s*you\s*human|are\s*you\s*a\s*bot|what\s*are\s*you)\b/i,
    /(你是什么|你是谁|你的名字)/,
    /\b(quem\s*é\s*você|qual\s*é\s*o\s*seu\s*nome|você\s*é\s*humano)\b/iu,
    /\b(qui\s*es[-\s]tu|c'est\s*quoi\s*ton\s*nom)\b/i,
    /(ты\s*кто|как\s*тебя\s*зовут|представься)/i,
    /\b(kamu\s*siapa|siapa\s*nama\s*kamu)\b/i,
    /(आप\s*कौन\s*हैं|तुम\s*कौन\s*हो)/
  ],
  [SOCIAL_ACTS.CAPABILITY]: [
    /(چه\s*کاری\s*بلدی|چیکار\s*می?کنی|چیکار\s*بلدی|بلدی\s*چی|دستت\s*به\s*چی\s*می?رسه|چی\s*می?تونی\s*بکنی|چطور\s*کمکی|کمکم\s*می?کنی)/,
    /(ماذا\s*تقدم|عندك\s*ايه\s*مميزات|شنو\s*تسوي|شو\s*بتعرف\s*تسوي)/,
    /(کیا\s*کر\s*سکتے\s*ہو)/,
    /\b(ne\s*yapabilirsin|neler\s*yapabilirsin|hangi\s*işlemler|hangi islemler)\b/iu,
    /\b(qu[ée]\s*puedes\s*hacer|para\s*qu[ée]\s*sirves|qu[ée]\s*haces)\b/iu,
    /\b(o\s*que\s*(?:você\s*)?(?:faz|pode\s*fazer)|pra\s*que\s*serve)\b/iu,
    /\b(what\s*can\s*you\s*do|what\s*do\s*you\s*do|how\s*can\s*you\s*help|what\s*are\s*you\s*capable)\b/i,
    /(你能做什么|你会什么|你能帮我什么)/,
    /\b(que\s*pouvez[- ]vous\s*faire|tu\s*fais\s*quoi)\b/i,
    /(что\s*ты\s*умеешь|чем\s*можешь\s*помочь|что\s*можешь\s*сделать)/i,
    /\b(apa\s*yang\s*bisa\s*kamu\s*lakukan|bisa\s*apa\s*aja)\b/i,
    /(आप\s*क्या\s*कर\s*सकते\s*हैं|तुम\s*क्या\s*कर\s*सकते\s*हो)/
  ],
  [SOCIAL_ACTS.WELLBEING]: [
    /(حوصله\s*ام\s*سر\s*رفته|حوصله\s*م\s*سررفته|بی?حوصله|خسته\s*ام|خسته\s*شدم|کلافه|ناراحتم|غمگین|استرس\s*دارم|نمی?تونم\s*بخوابم|یه\s*چیزی\s*بگو|دلم\s*گرفته)/,
    /\b(muy\s*aburrido|estoy\s*triste|no\s*puedo\s*dormir|estoy\s*cansado)\b/i,
    /\b(estou\s*cansado|triste|não\s*consigo\s*dormir|to\s*sem\s*graça)\b/iu,
    /\b(je\s*m'ennuie|je\s*suis\s*fatigué|je\s*suis\s*triste)\b/iu,
    /\b(yorgunum|üzgünüm|sildim|uyuyamıyorum)\b/iu,
    /\b(i'?m\s*bored|so\s*boring|can'?t\s*sleep|i'?m\s*tired|entertain\s*me|say\s*something)\b/i,
    /(мне\s*скучно|не\s*спится|устал|грустно)/,
    /(我好累|睡不着|我无聊)/,
    /\b(aku\s*bosan|ngantuk|gabisa\s*tidur|lagi\s*sepi)\b/i,
    /(मुझे\s*नींद\s*नहीं|मैं\s*थक\s*गया|बोर\s*हो\s*रहा)/
  ],
  [SOCIAL_ACTS.SMALL_TALK]: [
    /(بیا\s*حرف\s*بزنیم|گپ\s*بزنیم|یه\s*جوک\s*بگو|شوخی\s*کن|بامزه|چت\s*کنیم)/,
    /\b(joke|make\s*me\s*laugh|tell\s*me\s*a\s*joke|just\s*chatting|small\s*talk)\b/i,
    /\b(sohbet\s*edelim|şaka\s*yap|sohbet\s*etsek)\b/iu,
    /(давай\s*поболтаем|пошути|поговорим)/
  ]
});

/*
 * ── TRANSLITERATION ───────────────────────────────────────────────────────
 * Plenty of Persian users type Finglish, because a phone keyboard is one tap
 * away and switching layouts is not. A social read that only understands the
 * Persian script is not bilingual — it is monolingual plus a script check.
 * These run on Latin-script text only, so they cannot outvote a real word of
 * another language («salam» is not Spanish, «khabar» is not Indonesian).
 */
/*
 * A duplicate key in an object literal is not a syntax error in JavaScript — the
 * second one simply wins, and the first list vanishes without a sound. This
 * table had exactly that bug for a whole session: Finglish `chetori` was
 * overwritten by the Romanised-Urdu block, so «salam chetori» was answered as a
 * bare hello and «shukriya» deleted «mamnoon». Merging two named groups makes
 * the collision structurally impossible instead of reviewed-by-eye.
 */
function mergeActLists(...groups) {
  const out = {};
  for (const group of groups) {
    for (const [act, list] of Object.entries(group)) out[act] = (out[act] || []).concat(list);
  }
  return Object.freeze(out);
}

const FINGLISH_PATTERNS = Object.freeze({
  [SOCIAL_ACTS.GREETING]: [/(?:^|\s)(?:salam|salaa+m|salaam|drud|dorood|sobh\s*be\s*kheir|shab\s*be\s*kheir)(?:\s|$|[,?.!])/i],
  [SOCIAL_ACTS.HOW_ARE_YOU]: [/\b(?:chetor(i|e|am)?|kh+o+b+i|khobi|khubi|khowbi|haalet\s*chetore|aat\s*chetore|xobi)\b/i],
  [SOCIAL_ACTS.WHATS_UP]: [/(?:cha|che)\s*kha(v|b)r/i, /\bkhabar\s*(?:chie|nist|نیس)/i, /\bchekhbar\b/i, /\bbazar\s*chi\s*mige?\b/i],
  [SOCIAL_ACTS.THANKS]: [/(?:mamnoon|merci|dastet\s*dard\s*nakone|ghorbanat|damet\s*gharm)/i],
  [SOCIAL_ACTS.GOODBYE]: [/\b(?:khodaa?\s*hafez|khodahafez|bia\s*raftan|khosh\s*bash)\b/i]
});

/* Romanised Urdu — the same argument as Finglish, one keyboard shortcut away
   for every Urdu speaker in the user base. */
const ROMAN_URDU_PATTERNS = Object.freeze({
  [SOCIAL_ACTS.HOW_ARE_YOU]: [/\b(?:k|ki)y?a\s*(?:ha+?l|haal)\b/i, /\b(?:theek\s*hoon|main\s*theek|theek\s*hain|sab\s*theek|hain\s*theek)\b/i],
  [SOCIAL_ACTS.THANKS]: [/\bshukriya\b/i, /\bbohat\s*shukriya\b/i],
  [SOCIAL_ACTS.IDENTITY]: [/\baap\s*koun\b/i]
});

const TRANSLIT_PATTERNS = mergeActLists(FINGLISH_PATTERNS, ROMAN_URDU_PATTERNS);
/* -------------------------------------------------------------------------- */
/*  MATCHING                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * «nasilsin» and «nasılsın», «ca va» and «ça va», «voce esta» and «você está» are
 * the same sentence typed by two people with two keyboards — and half this
 * audience has no accented keys on a phone. The patterns above keep their
 * correct orthography for the human reader; both sides of a match are folded
 * here, once per pattern, so an accent is never the difference between being
 * understood and being ignored.
 *
 * Matching is a pure fold of BOTH sides. Only the folded text is ever handed to
 * these helpers, so the two directions cannot drift apart.
 */
const FOLDED_PATTERNS = new WeakMap();
function foldedPattern(re) {
  let out = FOLDED_PATTERNS.get(re);
  if (!out) {
    /* `g` is dropped: a sticky lastIndex on a shared, cached pattern would make
       the second caller see a different answer from the first. */
    out = new RegExp(foldAccents(re.source), re.flags.replace('g', ''));
    FOLDED_PATTERNS.set(re, out);
  }
  return out;
}

function matches(text, patterns) {
  const hits = [];
  for (const re of patterns) {
    if (foldedPattern(re).test(text)) hits.push(re.source.slice(0, 40));
  }
  return hits;
}

function hasAny(text, patterns) {
  for (const re of patterns) if (foldedPattern(re).test(text)) return true;
  return false;
}

/**
 * Classify one utterance into its social structure.
 *
 * @param {string} raw
 * @param {object} [opts]
 * @param {string|null} [opts.locale]  the client's UI language, used as a tie-break
 * @param {object} [opts.prior]        previous turn `{intent, surface}` — a
 *   bare «خوبی؟» right after an analysis is a follow-up, not a hello
 * @returns {{act: string, acts: string[], also: string[], lang: string,
 *   langSource: string, social: boolean, pure: boolean, needsData: boolean,
 *   guard: object, confidence: number, evidence: string[], schema: string,
 *   executionAuthorized: false}}
 */
export function classifySocialAct(raw, { locale = null, prior = null } = {}) {
  const text = foldText(toAsciiDigits(raw));
  /* Folded for matching only — `text` above is what any display would reuse. */
  const lower = foldAccents(text.toLowerCase());
  const { lang, source: langSource, detection } = respondIn(raw, { declared: locale });
  const empty = {
    schema: SOCIAL_ACT_SCHEMA,
    act: SOCIAL_ACTS.NOT_SOCIAL,
    acts: [],
    also: [],
    lang,
    langSource,
    social: false,
    pure: false,
    needsData: false,
    guard: { action: false, specific: false, blocks: false },
    confidence: 0,
    evidence: [],
    languageDetection: detection,
    executionAuthorized: false
  };
  if (!text) return { ...empty, reason: 'EMPTY' };

  const found = {};
  const latinOnly = !/\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Devanagari}|\p{Script=Han}/u.test(text);
  for (const [act, patterns] of Object.entries(PATTERNS)) {
    const hits = matches(lower, patterns);
    if (latinOnly && TRANSLIT_PATTERNS[act]) hits.push(...matches(lower, TRANSLIT_PATTERNS[act]));
    if (hits.length) found[act] = hits;
  }
  const acts = Object.keys(found);

  /* The guard is checked before anything is returned: a greeting inside a
     money sentence decorates the reply, it does not steer the turn. */
  const action = hasAny(lower, ACTION_HINTS);
  const specific = hasAny(lower, SPECIFICITY);
  const guard = { action, specific, blocks: action || specific };

  if (!acts.length) {
    /* No social marker at all. Only a message with NOTHING in it but
       punctuation or emoji is small talk — «چرا؟» is four characters and is the
       most follow-up-shaped sentence in Persian, so length alone must never
       make a message social. A short-but-lexical message belongs to whatever
       the rest of the pipeline says it is, not to a shrug here. */
    if (/^[^\p{L}\p{N}]+$/u.test(text)) {
      return {
        ...empty,
        act: SOCIAL_ACTS.SMALL_TALK,
        acts: [SOCIAL_ACTS.SMALL_TALK],
        social: true,
        pure: true,
        confidence: 0.35,
        evidence: ['short:non-content'],
        executionAuthorized: false
      };
    }
    return { ...empty, evidence: guard.blocks ? ['guard:action'] : ['no-social-marker'] };
  }

  /* Ranking: the act that carries a request outranks politeness, because that
     is the difference between answering «چه خبر» and merely saying hi. */
  const priority = [
    SOCIAL_ACTS.WHATS_UP,
    SOCIAL_ACTS.CAPABILITY,
    SOCIAL_ACTS.IDENTITY,
    SOCIAL_ACTS.WELLBEING,
    SOCIAL_ACTS.HOW_ARE_YOU,
    SOCIAL_ACTS.GOODBYE,
    SOCIAL_ACTS.THANKS,
    SOCIAL_ACTS.SMALL_TALK,
    SOCIAL_ACTS.GREETING
  ];
  const ranked = priority.filter((a) => found[a]);
  const act = ranked[0];
  const also = ranked.slice(1);

  /* A greeting that opens a sentence about the market is still a greeting plus
     a question; the guard decides which one the pipeline serves. */
  if (guard.blocks && act !== SOCIAL_ACTS.WHATS_UP) {
    return {
      ...empty,
      act: SOCIAL_ACTS.NOT_SOCIAL,
      acts: ranked,
      also: ranked,
      guard,
      confidence: 0,
      evidence: [...(found[act] || []).slice(0, 1), 'guard:action-dominates'],
      social: false,
      executionAuthorized: false
    };
  }

  /* A bare «خوبی؟» immediately after a real answer is a follow-up tick, not a
     new greeting — flagged so the router can lean on the previous turn. */
  const followUpLike = Boolean(prior?.intent) && text.length <= 18 && (act === SOCIAL_ACTS.HOW_ARE_YOU || act === SOCIAL_ACTS.SMALL_TALK);

  /* `needsData` is the whole point of the split: one act asks for the market,
     the others ask for nothing. `pure` says "nothing besides politeness was
     in this message", which is what lets the router skip every paid call. */
  const needsData = act === SOCIAL_ACTS.WHATS_UP;
  const pure = !guard.blocks;

  return {
    schema: SOCIAL_ACT_SCHEMA,
    act,
    acts: ranked,
    also,
    lang,
    langSource,
    social: true,
    pure: !guard.blocks,
    needsData,
    followUpLike,
    prior,
    guard,
    confidence: Math.min(0.97, 0.6 + 0.1 * Math.min(3, found[act].length) + (also.length ? 0.05 : 0)),
    evidence: [...found[act], ...(also.length ? [`also:${also.join(',')}`] : []), `lang:${lang}/${langSource}`],
    languageDetection: detection,
    executionAuthorized: false
  };
}

/**
 * Does this turn need a data feed, or can it be answered from nothing?
 * «حالت چطوره» must cost the platform zero provider calls and zero web
 * searches — politeness that bills a model is how a free feature dies.
 */
export function socialCostOf(act) {
  switch (act) {
    case SOCIAL_ACTS.GREETING:
    case SOCIAL_ACTS.HOW_ARE_YOU:
    case SOCIAL_ACTS.THANKS:
    case SOCIAL_ACTS.GOODBYE:
    case SOCIAL_ACTS.IDENTITY:
    case SOCIAL_ACTS.SMALL_TALK:
      return Object.freeze({ modelCalls: 0, webCalls: 0, toolCalls: 0, latencyClass: 'instant' });
    case SOCIAL_ACTS.WHATS_UP:
      /* The brief reads the already-cached market snapshot: a memory read, not
         a network call. It is the cheapest possible way to answer properly. */
      return Object.freeze({ modelCalls: 0, webCalls: 0, toolCalls: 1, latencyClass: 'cached' });
    default:
      return Object.freeze({ modelCalls: null, webCalls: null, toolCalls: null, latencyClass: 'unknown' });
  }
}

export default classifySocialAct;
