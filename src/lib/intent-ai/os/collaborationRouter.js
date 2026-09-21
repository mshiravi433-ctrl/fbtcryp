/**
 * FBT SMART INTENT OS — AI UPGRADE 5: COLLABORATION ROUTER (QUESTION ANALYZER)
 * ---------------------------------------------------------------------------
 * The deterministic brain that decides HOW MUCH intelligence a user question
 * needs, BEFORE any model is called. It is pure — no I/O, no network, no
 * provider keys — so every routing decision is testable and reproducible.
 *
 *   Question
 *     ↓
 *   Conversation-kind detection (greeting / thanks / casual / action / …)  §23-25
 *     ↓
 *   Emotion + FOMO detection (fear, panic, frustration, FOMO)              §26-27
 *     ↓
 *   Freshness classification (STATIC / RECENT / LIVE / BREAKING)           §15
 *     ↓
 *   Complexity classification (SIMPLE → HIGH_STAKES)                       §4
 *     ↓
 *   Collaboration level 1-5 (cost control)                                 §45
 *     ↓
 *   Question → Tool → Web → Multi-AI decision ladder                       §42
 *
 * Design laws (Upgrade 5 spec):
 *   - NEVER ask every model for everything (§4).
 *   - «سلام» / «ممنون» / «BTC چیست؟» must never reach Level 5, never trigger
 *     web search and never trigger financial tools (§14, §45).
 *   - More AI models never means more execution authority (§67) — this router
 *     only classifies; execution stays on the existing confirmed path.
 */

import { normalizeUpgrade4 } from './intentUnderstandingEngine.js';
/* Upgrade 13 — the social read. One classifier now owns greetings,
   pleasantries and «what's up» for all twelve UI languages; this router maps
   its result onto the conversation kinds it already emits, so every existing
   consumer (needsWeb, complexity, level, roles) keeps working unchanged. */
import { classifySocialAct, socialCostOf, SOCIAL_ACTS } from './conversation/socialIntent.js';

export const COLLABORATION_ROUTER_SCHEMA = 'fbt.collaboration-router.v5';
export const COLLABORATION_ROUTER_VERSION = '5.0.0';

/* -------------------------------------------------------------------------- */
/*  CONSTANTS                                                                  */
/* -------------------------------------------------------------------------- */

export const CONVERSATION_KINDS = Object.freeze({
  GREETING: 'GREETING',
  /* «چخبر؟» / «what's up» / «que hay de nuevo» — a greeting that carries a real
     request. Distinct from GREETING precisely because it must be ANSWERED: a
     hello in reply to it is a refusal. Costs one cached data read, no model. */
  WHATS_UP: 'WHATS_UP',
  THANKS: 'THANKS',
  CASUAL: 'CASUAL',
  EMOTIONAL: 'EMOTIONAL',
  FOLLOW_UP: 'FOLLOW_UP',
  QUESTION: 'QUESTION',
  ACTION: 'ACTION'
});

export const EMOTION_STATES = Object.freeze([
  'calm', 'curious', 'confused', 'uncertain',
  'fearful', 'panic', 'frustrated', 'excited'
]);

export const FRESHNESS_CLASSES = Object.freeze(['STATIC', 'RECENT', 'LIVE', 'BREAKING']);

export const COMPLEXITY_CLASSES = Object.freeze(['SIMPLE', 'MEDIUM', 'COMPLEX', 'HIGH_STAKES']);

/** AI task taxonomy (§6) */
export const TASK_TYPES = Object.freeze([
  'conversation', 'intent', 'reasoning', 'research', 'crypto-analysis',
  'market', 'news', 'risk', 'portfolio', 'strategy', 'summarization', 'verification'
]);

/** Logical AI roles (§5). Roles are logical — the router never assumes a
 *  specific provider exists; the gateway maps roles to configured providers. */
export const AI_ROLES = Object.freeze({
  INTENT_AI: 'intent',
  CONVERSATION_AI: 'conversation',
  CRYPTO_RESEARCH_AI: 'crypto_research',
  NEWS_AI: 'news',
  MARKET_AI: 'market',
  RISK_AI: 'risk',
  PORTFOLIO_AI: 'portfolio',
  STRATEGY_AI: 'strategy',
  VERIFICATION_AI: 'verification',
  FINAL_ANSWER_AI: 'final_answer'
});

/* -------------------------------------------------------------------------- */
/*  INPUT FOLDING                                                              */
/*  Persian text arrives with ZWNJ («می‌ریزه» = می+U+200C+ریزه) which is NOT
 *  \s for regex purposes, and JS \b word boundaries do not exist around
 *  Persian letters at all. Fold first: ZWNJ→space, trim. Every classifier
 *  below runs on the folded form.                                            */
/* -------------------------------------------------------------------------- */

const fold = (v) => String(v || '').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();

/* -------------------------------------------------------------------------- */
/*  GREETING / THANKS / CASUAL INTELLIGENCE (§23-25)                           */
/*  Trailing boundary: "not followed by a Persian/Latin letter" — \b is a lie
 *  for Persian, so the boundary is written explicitly.                        */
/* -------------------------------------------------------------------------- */

const NB = '(?![\\u0621-\\u06FFA-Za-z0-9])'; // "not a letter" boundary (؟ U+061F is punctuation, not a letter)

const GREETING_RE = new RegExp(`(?:^|\\s)(?:سلام|سلاام|سلامم|درود|صبح\\s*بخیر|شب\\s*بخیر|ظهر\\s*بخیر|عصر\\s*بخیر|خسته\\s*نباشی|خسته\\s*نباشید|چه\\s*خبر|چخبر|خوبین|حالت\\s*چطوره|حالت\\s*خوبه|hi|hello|hey|good\\s*(?:morning|evening|afternoon|night)|how\\s+are\\s+you|whats\\s*up|what's\\s*up|sup)${NB}`, 'i');

const THANKS_RE = new RegExp(`(?:^|\\s)(?:ممنون|ممنونم|مرسی|مرسیی|دمت\\s*گرم|دستت\\s*درد\\s*نکنه|خیلی\\s*کمک\\s*کردی|عالی\\s*بود|بسیار\\s*عالی\\s*بود|سپاس|سپاسگزارم|thanks|thank\\s*you|thx|ty|appreciate\\s+it|great\\s+help|well\\s+done)${NB}`, 'i');

const CASUAL_RE = new RegExp(`(?:^|\\s)(?:کی\\s*هستی|تو\\s*کیستی|اسمت\\s*چیه|چه\\s*کاری\\s*بلدی|میتونی\\s*چیکار|چه\\s*کارها|بیا\\s*حرف\\s*بزنیم|حوصله\\s*ندارم|بامزه|joke|شوخی)${NB}`, 'i');

/* -------------------------------------------------------------------------- */
/*  EMOTIONAL LANGUAGE, FEAR / PANIC & FOMO DETECTION (§25-27)                 */
/* -------------------------------------------------------------------------- */

const FEAR_RE = /(می\s*ترسم|میترسم|ترسیدم|ترسناک|استرس|نگران|نگرانی|نگرانم|وحشت|scared|afraid|fear|worried|anxious|anxiety|nervous)/i;
const PANIC_RE = /(وای|ای\s*وای|داره\s*می\s*ریزه|بازار\s*می\s*ریز|می\s*ریزه|سقوط|داره\s*سقوط|سریع\s*بفروش|همین\s*الان\s*بفروش|panic|dump|crash|falling|ریزش\s*شدید|سقوط\s*کرد)/i;
const LOSS_FEAR_RE = /(ضرر\s*کنم|ضرر\s*می\s*کنم|پولم\s*رو\s*از\s*دست|از\s*دست\s*بد[مه]|همه\s*چیزم\s*رو|lose\s*(?:my|all)|loosing|losing\s+money)/i;
const FRUSTRATION_RE = /(لعنتی|چرت|بیخود|مسخره|خسته\s*شدم|کار\s*نمی\s*کنه|درست\s*کار\s*نمیکنه|useless|stupid|broken|frustrat|annoying|waste)/i;
const CONFUSION_RE = /(نمی\s*فهمم|نمیفهمم|گیج|سردرگم|منظورت\s*چیه|یعنی\s*چی|confused|don'?t\s+understand|dont\s+get\s+it|what\s+does\s+that\s+mean)/i;
const UNCERTAINTY_RE = /(نمی\s*دونم|نمیدونم|مطمئن\s*نیستم|شک\s*دارم|شاید|نمی\s*دانم|not\s+sure|unsure|maybe|i\s+guess|dunno)/i;
const EXCITEMENT_RE = /(فوق\s*العاده|عالیه|پرواز|به\s*ماه|to\s+the\s+moon|pump|بترکون|هیجان|excited|amazing|bull\s+run|let'?s\s+go|lfg)/i;
const CURIOSITY_RE = /(چرا|چطور|چگونه|چیه|چیست|یعنی|how|why|what|explain|توضیح)/i;

const FOMO_RE = /(جا\s*نمونم|جا\s*نمانم|جا\s*موندم|جام\s*نمونه|از\s*دست\s*بره|از\s*دستش\s*نده|دیر\s*بشه|دیر\s*نشه|همین\s*الان\s*بخرم|الان\s*نخرم\s*حیف|دو\s*برابر\s*می\s*شه|دو\s*برابر\s*میشه|صد\s*برابر|۲\s*برابر|10x|100x|fomo|miss\s+(?:the|this)\s+(?:pump|moon|chance)|before\s+it\s+(?:pumps|moons)|don'?t\s+miss)/i;

/**
 * Detect the user's emotional state. Used INTERNALLY to adapt response style
 * (§26) — never surfaced as a judgment of the user.
 */
export function detectEmotion(rawText) {
  const text = fold(rawText);
  if (!text) return { state: 'calm', intensity: 0, signals: [] };

  const signals = [];
  let state = 'calm';
  let intensity = 0;

  const hit = (re, s, w) => { if (re.test(text)) { signals.push(s); intensity += w; return true; } return false; };

  const fear = hit(FEAR_RE, 'fear', 2) || hit(LOSS_FEAR_RE, 'loss-fear', 2);
  const panic = hit(PANIC_RE, 'panic', 3);
  const frustration = hit(FRUSTRATION_RE, 'frustration', 2);
  const confusion = hit(CONFUSION_RE, 'confusion', 1);
  const uncertainty = hit(UNCERTAINTY_RE, 'uncertainty', 1);
  const excitement = hit(EXCITEMENT_RE, 'excitement', 2);
  const curiosity = hit(CURIOSITY_RE, 'curiosity', 1);

  // Escalation order: panic > fearful > frustrated > excited > confused > uncertain > curious
  if (panic || (fear && intensity >= 4)) state = 'panic';
  else if (fear) state = 'fearful';
  else if (frustration) state = 'frustrated';
  else if (excitement) state = 'excited';
  else if (confusion) state = 'confused';
  else if (uncertainty) state = 'uncertain';
  else if (curiosity) state = 'curious';

  intensity = Math.min(5, intensity);
  return { state, intensity, signals };
}

/** FOMO detection (§27). The engine must NOT amplify FOMO — it only flags it
 *  so the answer can pair Opportunity + Risk + Alternative + Uncertainty. */
export function detectFomo(rawText) {
  const text = fold(rawText);
  const detected = FOMO_RE.test(text);
  const strongSignals = [
    /دو\s*برابر|صد\s*برابر|10x|100x/i,
    /همین\s*الان\s*بخرم/i,
    /جا\s*نمونم|جا\s*نمانم/i,
    /fomo|miss\s+the\s+pump/i
  ].filter((re) => re.test(text)).length;
  return {
    detected,
    intensity: detected ? Math.min(3, 1 + strongSignals) : 0
  };
}

/* -------------------------------------------------------------------------- */
/*  CONVERSATION KIND (§23-25)                                                 */
/* -------------------------------------------------------------------------- */

/** Short follow-ups that must resolve against the previous turn (§41). */
const FOLLOW_UP_RE = /^(?:چرا|چطور\s*شد|چگونه|خب\s*حالا(?:\s*چی)?|حالا\s*چی|پس\s*(?:چی|چطور|چه)|ادامه(?:\s*بده)?|بیشتر(?:\s*بگو)?|توضیح\s*بده|why|why\s+so|how\s+so|and\s+then|what\s+next|go\s+on|tell\s+me\s+more|more|continue|so|really)[\s?!؟.]*$/i;

/*
 * An imperative is an imperative in every language the product speaks. The old
 * list only knew «سواپ کن»; a user who writes «سواپ رو انجام بده» — the way
 * people actually say it — was being sent to the web-research path with a
 * pending execution in their hands. First-person forms («انجام بدم») are NOT
 * here on purpose: those are decision questions (§41).
 */
const ACTION_RE = /(بخر|بفروش|swap\s*(?:it|this|now)?|buy|sell|convert|تبدیل\s*کن|بریز\s*به|ارسال\s*کن|send|انتقال\s*بده|bridge\s*(?:it|this|now)?|استیک\s*کن|farm|lend|وام\s*بگیر|dca|سواپ\s*کن|(?:رو|را|را\s+هم)\s*انجام\s*بده|انجام\s*بده|بفرما\s*کن)|(?:сделай|выполни|проведи)\s*(?:свап|обмен|перевод|операцию)|(?:swap|işlem|transfer)\s*(?:yap|gerçekleştir)|نفذ\s*(?:السواب|العملية|التحويل)/i;

/* «پس بفروشم؟» is a DECISION QUESTION about the previous analysis (§41), not
   an execution command. First-person subjunctive + question mark ⇒ question;
   the imperative forms («بفروش», «بخر») stay on the action path. */
const DECISION_QUESTION_RE = /(بخرم|بفروشم|بخریم|بفروشیم|بریزم|انتقال\s*بدم|should\s+i\s+(?:buy|sell))[^a-zA-Z\u0600-\u06FF]*[؟?][\s]*$/i;

/**
 * Conversation kind for one message.
 *
 * Upgrade 13 changed HOW this is decided (and left the vocabulary intact):
 * the social read now runs first, so a Turkish «nasılsın», a Russian «как
 * дела» or a Chinese «你好吗» is recognised as a pleasantry instead of falling
 * through to the QUESTION default — which used to spend two model calls and a
 * web search to answer "how are you", and answer it in English.
 *
 * The action guard still outranks politeness, so «سلام، ۵۰ تتر بخر» stays a
 * BUY and never becomes small talk.
 */
export function classifyConversationKind(rawText, { priorIntent = null, locale = null } = {}) {
  const text = fold(rawText);
  if (!text) return CONVERSATION_KINDS.CASUAL;

  /* ── Upgrade 13: multilingual social act, twelve locales ─────────────── */
  const social = classifySocialAct(text, { locale, prior: priorIntent ? { intent: priorIntent } : null });
  if (social.social) {
    switch (social.act) {
      case SOCIAL_ACTS.WHATS_UP: return CONVERSATION_KINDS.WHATS_UP;
      case SOCIAL_ACTS.GREETING:
      case SOCIAL_ACTS.HOW_ARE_YOU: return CONVERSATION_KINDS.GREETING;
      case SOCIAL_ACTS.THANKS: return CONVERSATION_KINDS.THANKS;
      default: return CONVERSATION_KINDS.CASUAL;
    }
  }

  const short = text.length <= 40;
  const thanks = THANKS_RE.test(text);
  const greeting = GREETING_RE.test(text);

  /* Legacy path, kept as the net under the new classifier: the regexes still
     catch a localised greeting the lexicon has not met yet. «پس بفروشم؟» and
     friends are untouched below. */
  if (/^(?:سلام[\s,،]*)?خوبی[\s؟?!.]*$/.test(text)) return CONVERSATION_KINDS.GREETING;
  if (short && greeting && !ACTION_RE.test(text)) return CONVERSATION_KINDS.GREETING;
  if (thanks && !ACTION_RE.test(text)) return CONVERSATION_KINDS.THANKS;
  if (short && CASUAL_RE.test(text)) return CONVERSATION_KINDS.CASUAL;
  if (FOLLOW_UP_RE.test(text) && priorIntent) return CONVERSATION_KINDS.FOLLOW_UP;
  if (DECISION_QUESTION_RE.test(text)) return CONVERSATION_KINDS.QUESTION;

  const emotion = detectEmotion(text);
  if ((emotion.state === 'fearful' || emotion.state === 'panic') && !ACTION_RE.test(text)) {
    return CONVERSATION_KINDS.EMOTIONAL;
  }
  if (ACTION_RE.test(text)) return CONVERSATION_KINDS.ACTION;
  return CONVERSATION_KINDS.QUESTION;
}

/* -------------------------------------------------------------------------- */
/*  FRESHNESS CLASSIFIER (§15)                                                 */
/* -------------------------------------------------------------------------- */

const BREAKING_RE = /(همین\s*الان|همین\s*لحظه|الان\s*الان|این\s*خبر\s*همین|breaking|just\s+(?:happened|now|announced)|right\s+now|همین\s*تازه|خبر\s*فوری)/i;
/* LIVE = about today/now. Bare "news/خبر" is NOT automatically live — news is
   fresh by default and lands in RECENT; a live call needs a now-marker. */
const LIVE_RE = /(امروز|امشب|الان|کنون|تو\s*این\s*لحظه|today|tonight|last\s+hour|ساعت\s*اخیر|همین\s*روزها|(?:چرا|why)[\s\S]{0,30}(?:ریخت|افت|ریزش|drop|fall|dump|بالا|up|pump)|price\s+now|قیمت\s*(?:الان|لحظه)|لحظه\s*ای|outlook|چشم\s*انداز)/i;
const RECENT_RE = /(این\s*هفته|هفته\s*گذشته|اخیرا|این\s*روزها|recently|this\s+week|last\s+(?:week|days)|past\s+few\s+days|latest|خبر|news|اخبار|اعلامیه|announcement|لیست\s*شد|هک)/i;
const STATIC_RE = /(چیست|چیه|یعنی\s*چ|کار\s*می\s*کن[هد]|چطور\s*کار|what\s+(?:is|are)\b|how\s+(?:does|do)\s+.{0,30}\s+work|define|tokenomics|توکنومیکس|whitepaper|وایت\s*پیپر|history|تاریخچه)/i;
/* Product how-to questions are answered from the FBT Knowledge Center, not
   from the web (§14, §55): «چطور USDT بخرم؟» / «how do I bridge». */
const PRODUCT_HOWTO_RE = /((چطور|چگونه|how)[\s\S]{0,28}(usdt|تتر|swap|سواپ|bridge|بریج|buy|بخر|stake|استیک|recover|بازیابی|send|ارسال|dca|farm|کیف\s*پول|wallet))|((usdt|تتر|swap|سواپ|bridge|بریج|استیک|stake)[\s\S]{0,28}(چطور|چگونه|how))/i;

/**
 * STATIC  → stable knowledge («BTC چیست؟») — no web needed.
 * RECENT  → last days/weeks — web helps, not urgent.
 * LIVE    → today/now market & news — web needed.
 * BREAKING→ this very moment — web + multi-source verification needed.
 */
export function classifyFreshness(rawText) {
  const text = fold(rawText);
  if (!text) return 'STATIC';
  if (BREAKING_RE.test(text)) return 'BREAKING';
  if (LIVE_RE.test(text)) return 'LIVE';
  if (RECENT_RE.test(text)) return 'RECENT';
  if (STATIC_RE.test(text) || PRODUCT_HOWTO_RE.test(text)) return 'STATIC';
  /* Default: a bare market question («بیت کوین چطوره؟») needs current data to
     be honest; a bare definition lands in STATIC above. */
  return 'RECENT';
}

/* -------------------------------------------------------------------------- */
/*  WEB / TOOL NEED (§13, §14, §42)                                            */
/* -------------------------------------------------------------------------- */

/** Web search is for CURRENT information. Never for greetings, thanks,
 *  execution commands or static definitions — unless freshness is actually
 *  relevant. (§13/§14) */
export function needsWebResearch({ freshness, conversationKind, intentType = null }) {
  /* WHATS_UP is answered from the CACHED market read, not from the web: «چخبر»
     must not become a search-engine round trip in a chat that already has the
     prices. Data that is already in the turn is the fastest honest source. */
  if (conversationKind === CONVERSATION_KINDS.WHATS_UP) return false;
  if (conversationKind === CONVERSATION_KINDS.GREETING || conversationKind === CONVERSATION_KINDS.THANKS) return false;
  if (conversationKind === CONVERSATION_KINDS.CASUAL) return false;
  /* Execution intents are grounded by tools and live quotes (§43), not by
     web articles — the swap preview is the truth, not a news search. */
  if (conversationKind === CONVERSATION_KINDS.ACTION) return false;
  if (freshness === 'BREAKING' || freshness === 'LIVE') return true;
  if (freshness === 'RECENT') {
    /* Static-looking intents that are merely "recent" don't need the web. */
    if (intentType && ['LEARN', 'DOCS'].includes(String(intentType).toUpperCase())) return false;
    return true;
  }
  return false;
}

/** Intents whose truth MUST come from tools, never from a model (§43). */
export const TOOL_TRUTH_INTENTS = Object.freeze([
  'WALLET_BALANCE', 'PORTFOLIO_ANALYSIS', 'ORDERS', 'SWAP', 'BRIDGE', 'SEND',
  'BUY', 'SELL', 'DCA', 'FARM', 'LEND', 'BORROW', 'STAKING', 'FUTURES',
  'REBALANCE', 'BTC_WALLET', 'WALLET_CONNECT', 'SIGNALS', 'SMART_MONEY', 'WHALE'
]);

/**
 * Question → Tool decision ladder (§42):
 *   stable knowledge → ANSWER | exact tool exists → TOOL | fresh facts → WEB | complex → MULTI_AI
 */
export function decideAnswerPath({ conversationKind, freshness, intentType = null, entities = {}, complexity }) {
  if (conversationKind === CONVERSATION_KINDS.WHATS_UP) return 'BRIEF';
  if (conversationKind === CONVERSATION_KINDS.GREETING || conversationKind === CONVERSATION_KINDS.THANKS || conversationKind === CONVERSATION_KINDS.CASUAL) {
    return 'CONVERSATION';
  }
  if (intentType && TOOL_TRUTH_INTENTS.includes(String(intentType).toUpperCase())) return 'TOOL';
  if (freshness === 'LIVE' || freshness === 'BREAKING') return 'WEB';
  if (complexity === 'COMPLEX' || complexity === 'HIGH_STAKES') return 'MULTI_AI';
  if (freshness === 'STATIC' && (entities.token || intentType === 'LEARN')) return 'KNOWLEDGE';
  return 'ANSWER';
}

/* -------------------------------------------------------------------------- */
/*  COMPLEXITY & COLLABORATION LEVEL (§4, §45)                                 */
/* -------------------------------------------------------------------------- */

const HIGH_STAKES_RE = /(همه\s*(?:پول|سرمایه|دارایی)|کل\s*(?:پول|سرمایه)|all\s*(?:my\s+)?(?:money|funds|savings)|everything\s+now|الان\s*چی\s*بخرم|الان[\s\S]{0,12}بخرم|بخرم\s*یا\s*بفروشم|should\s+i\s+(?:buy|sell|invest)\s+now|should\s+i\s+(?:buy|sell)|buy\s+(?:bitcoin|btc|eth|ethereum|sol|solana)?\s*now|مناسب\s*سرمایه\s*گذاری|(?:خرید|سرمایه\s*گذاری)\s*خوبی|for\s+investment|is\s+it\s+a\s+good\s+(?:buy|investment|time)|life\s+savings|خانه|خون?ه|وام[\s\S]{0,30}بخرم|بخرم[\s\S]{0,30}وام|قرض|وام\s*خون?ه|مقصد\s*آخر)/i;

const COMPLEX_RE = /(آیا\s*این\s*خبر|این\s*خبر\s*(?:روی|به)|چه\s*تاثیری|چه\s*اثری|impact\s+(?:of|on)|می\s*تواند\s*باعث|می‌تواند\s*باعث|باعث\s*ریزش|سناریو|scenario|استراتژی|strategy|مقایسه|compare|تحلیل\s*کامل|full\s+analysis|deep\s+dive|بررسی\s*کامل|آیا\s*ممکن|رابطه\s*بین|correlation|پیش\s*بینی|forecast|تحقیق|هولدر|holders|tvl\s*چقدر|هک\s*شده|exploit|بدترین\s*سناریو|worst\s+case)/i;

const MEDIUM_RE = /(چرا\s*ریخت|چرا\s*افت|چرا\s*بالا|why\s+did|why\s+is|چطوره|چه\s*وضع|اخبار|news|قیمت|price|ریسک|risk|market|بازار|outlook|چشم\s*انداز|پروژه|project|buy|sell|خرید|فروش|استیک|farm|yield|سود|tokenomics|توکنومیکس)/i;

export function classifyComplexity(rawText, { conversationKind, freshness, intentType = null } = {}) {
  const text = fold(rawText);
  if (conversationKind === CONVERSATION_KINDS.WHATS_UP) return 'SIMPLE';
  if (conversationKind === CONVERSATION_KINDS.GREETING || conversationKind === CONVERSATION_KINDS.THANKS || conversationKind === CONVERSATION_KINDS.CASUAL) {
    return 'SIMPLE';
  }
  if (HIGH_STAKES_RE.test(text)) return 'HIGH_STAKES';
  if (COMPLEX_RE.test(text)) return 'COMPLEX';
  if (freshness === 'BREAKING') return 'COMPLEX';
  if (MEDIUM_RE.test(text) || (intentType && ['MARKET_ANALYSIS', 'ANALYZE_TOKEN', 'RISK_ANALYSIS', 'NEWS_SEARCH', 'PORTFOLIO_ANALYSIS', 'SIGNALS', 'SMART_MONEY', 'STRATEGY'].includes(String(intentType).toUpperCase()))) {
    return 'MEDIUM';
  }
  if (freshness === 'STATIC') return 'SIMPLE';
  return 'MEDIUM';
}

/**
 * Collaboration levels (§45). Hard law: greetings/thanks/static definitions
 * NEVER exceed level 1-2; web + multi-AI only for questions that need it.
 *   L1  one model
 *   L2  one model + tools/knowledge
 *   L3  two models + tools (+web when live)
 *   L4  multi-model + web + verification
 *   L5  high-stakes collaborative reasoning + verification + uncertainty engine
 */
export function determineCollaborationLevel({ conversationKind, complexity, freshness, needsWeb }) {
  /* Level 1 = "no model needed". WHATS_UP sits here on purpose: the brief is
     computed from data the app already holds, so depth costs a memory read
     rather than a billable completion. */
  if (conversationKind === CONVERSATION_KINDS.WHATS_UP) return 1;
  if (conversationKind === CONVERSATION_KINDS.GREETING || conversationKind === CONVERSATION_KINDS.THANKS || conversationKind === CONVERSATION_KINDS.CASUAL) {
    return 1;
  }
  if (complexity === 'HIGH_STAKES') return 5;
  if (complexity === 'COMPLEX') return needsWeb ? 4 : 4;
  if (complexity === 'MEDIUM') {
    if (needsWeb && (freshness === 'LIVE' || freshness === 'BREAKING')) return 3;
    if (needsWeb) return 3;
    return 2;
  }
  // SIMPLE
  return freshness === 'STATIC' ? 2 : 1;
}

/* -------------------------------------------------------------------------- */
/*  TASK TYPES & ROLES PER QUESTION (§5, §8)                                   */
/* -------------------------------------------------------------------------- */

export function selectTaskTypes({ conversationKind, complexity, freshness, intentType = null, entities = {} }) {
  const kind = conversationKind;
  if (kind === CONVERSATION_KINDS.WHATS_UP) return ['market', 'summarization'];
  if (kind === CONVERSATION_KINDS.GREETING || kind === CONVERSATION_KINDS.THANKS || kind === CONVERSATION_KINDS.CASUAL) {
    return ['conversation'];
  }
  const tasks = new Set(['intent']);
  const it = String(intentType || '').toUpperCase();

  if (it === 'NEWS_SEARCH' || /خبر|news/i.test(String(entities.topic || ''))) tasks.add('news');
  if (['MARKET_ANALYSIS', 'MARKET_CONTEXT'].includes(it) || freshness === 'LIVE' || freshness === 'BREAKING') tasks.add('market');
  if (it === 'ANALYZE_TOKEN' || entities.token) tasks.add('crypto-analysis');
  if (it === 'RISK_ANALYSIS' || complexity === 'HIGH_STAKES') tasks.add('risk');
  if (it === 'PORTFOLIO_ANALYSIS') tasks.add('portfolio');
  if (it === 'STRATEGY' || complexity === 'HIGH_STAKES') tasks.add('strategy');
  if (freshness === 'LIVE' || freshness === 'BREAKING' || it === 'NEWS_SEARCH') tasks.add('research');
  if (complexity === 'COMPLEX' || complexity === 'HIGH_STAKES') {
    tasks.add('reasoning');
    tasks.add('verification');
  }
  if (tasks.size === 1 && complexity === 'SIMPLE') tasks.add(freshness === 'STATIC' ? 'crypto-analysis' : 'conversation');
  tasks.add('summarization');
  return TASK_TYPES.filter((t) => tasks.has(t));
}

export function selectRoles({ conversationKind, taskTypes = [], complexity }) {
  if (conversationKind === CONVERSATION_KINDS.GREETING || conversationKind === CONVERSATION_KINDS.THANKS || conversationKind === CONVERSATION_KINDS.CASUAL) {
    return [AI_ROLES.CONVERSATION_AI, AI_ROLES.FINAL_ANSWER_AI];
  }
  const roles = new Set([AI_ROLES.INTENT_AI]);
  if (taskTypes.includes('conversation')) roles.add(AI_ROLES.CONVERSATION_AI);
  if (taskTypes.includes('market')) roles.add(AI_ROLES.MARKET_AI);
  if (taskTypes.includes('news')) roles.add(AI_ROLES.NEWS_AI);
  if (taskTypes.includes('crypto-analysis') || taskTypes.includes('research')) roles.add(AI_ROLES.CRYPTO_RESEARCH_AI);
  if (taskTypes.includes('risk')) roles.add(AI_ROLES.RISK_AI);
  if (taskTypes.includes('portfolio')) roles.add(AI_ROLES.PORTFOLIO_AI);
  if (taskTypes.includes('strategy')) roles.add(AI_ROLES.STRATEGY_AI);
  if (complexity === 'COMPLEX' || complexity === 'HIGH_STAKES') roles.add(AI_ROLES.VERIFICATION_AI);
  roles.add(AI_ROLES.FINAL_ANSWER_AI);
  return [...roles];
}

/**
 * The kinds that are answered from a phrase rather than from evidence. Level
 * 1, no web, no financial tools. WHATS_UP is deliberately NOT one of them —
 * it is a request for data wearing the grammar of a greeting.
 */
export function isPureSmallTalk(conversationKind) {
  return conversationKind === CONVERSATION_KINDS.GREETING
    || conversationKind === CONVERSATION_KINDS.THANKS
    || conversationKind === CONVERSATION_KINDS.CASUAL;
}

/* -------------------------------------------------------------------------- */
/*  MAIN ENTRY — QUESTION ANALYSIS                                             */
/* -------------------------------------------------------------------------- */

/**
 * Analyze one user question and produce the full collaboration plan.
 * Pure + deterministic: identical input ⇒ identical plan.
 *
 * @param {object} params
 * @param {string} params.message        raw user message
 * @param {string|null} params.intentType  classified intent (Intent OS)
 * @param {object} params.entities       extracted entities (token, amount…)
 * @param {object} params.context        page/wallet context (currentPage…)
 * @param {string|null} params.priorIntent  previous turn intent (follow-ups §41)
 * @param {string} params.locale         'fa' | 'en' | …
 */
export function planCollaboration({ message = '', intentType = null, entities = {}, context = {}, priorIntent = null, locale = 'fa' } = {}) {
  const text = String(message || '').trim();
  const normalized = normalizeUpgrade4(text);

  const conversationKind = classifyConversationKind(text, { priorIntent, locale });
  const social = classifySocialAct(text, { locale, prior: priorIntent ? { intent: priorIntent } : null });
  const emotion = detectEmotion(text);
  const fomo = detectFomo(text);
  const freshness = classifyFreshness(text);
  const complexity = classifyComplexity(text, { conversationKind, freshness, intentType });
  const needsWeb = needsWebResearch({ freshness, conversationKind, intentType });
  const answerPath = decideAnswerPath({ conversationKind, freshness, intentType, entities, complexity });
  const level = determineCollaborationLevel({ conversationKind, complexity, freshness, needsWeb });
  const taskTypes = selectTaskTypes({ conversationKind, complexity, freshness, intentType, entities });
  const roles = selectRoles({ conversationKind, taskTypes, complexity });

  /* Emotional questions get at least one careful model pass (§25) — but never
     the full 5-model machine unless the money decision is real. */
  const effectiveLevel = conversationKind === CONVERSATION_KINDS.EMOTIONAL ? Math.max(2, level) : level;

  /* Personalization guard (§40): "این ارز خوبه؟" with no asset anywhere must
     end in a clarification, never a guess. */
  const needsAssetClarification = Boolean(
    /(این\s*(?:ارز|کوین|توکن)|this\s+(?:coin|token|asset))/.test(text) &&
    !entities.token &&
    !(context.currentPage && /\/coin\//.test(String(context.currentPage)))
  );

  return {
    schema: COLLABORATION_ROUTER_SCHEMA,
    normalized,
    conversationKind,
    /* Upgrade 13 — the social read, kept beside conversationKind so nothing
       that consumed the old field has to change. `social.lang` is the language
       the USER WROTE IN, which is what the reply layer must use; `declared`
       locale is only the app's display setting. */
    social: {
      act: social.act,
      acts: social.acts || [],
      also: social.acts?.length > 1 ? (social.acts || []).slice(1) : [],
      lang: social.lang,
      langSource: social.langSource,
      locale: String(locale || 'fa').toLowerCase().split('-')[0] || null,
      social: Boolean(social.social),
      pure: Boolean(social.pure),
      needsData: Boolean(social.needsData),
      confidence: social.confidence || 0,
      evidence: social.evidence || [],
      guard: social.guard || { action: false, specific: false, blocks: false },
      cost: socialCostOf(social.act),
      executionAuthorized: false
    },
    briefRequested: conversationKind === CONVERSATION_KINDS.WHATS_UP,
    emotion,
    fomo,
    freshness,
    complexity,
    needsWeb,
    answerPath,
    level: effectiveLevel,
    baseLevel: level,
    taskTypes,
    roles,
    needsAssetClarification,
    requiresExecutionGuard: fomo.detected || emotion.state === 'panic',
    locale: String(locale || 'fa').slice(0, 5)
  };
}

/** Human-readable label used by the ops dashboard (§62). */
export function describeAnalysis(analysis = {}, locale = 'fa') {
  const fa = String(locale || 'fa').startsWith('fa');
  const L = {
    1: fa ? 'تک‌مدل سریع' : 'single fast model',
    2: fa ? 'یک مدل + ابزار/دانش' : 'one model + tools/knowledge',
    3: fa ? 'دو مدل + ابزار' : 'two models + tools',
    4: fa ? 'چندمدل + وب + تأیید' : 'multi-model + web + verification',
    5: fa ? 'همکاری کامل + راستی‌آزمایی' : 'full collaboration + verification'
  };
  return L[analysis.level] || L[1];
}

export default planCollaboration;
