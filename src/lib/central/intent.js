/**
 * FBT CENTRAL INTELLIGENCE OS — Universal Intent object + state machine (§31/§32).
 * ---------------------------------------------------------------------------
 * Two jobs, both deliberately unglamorous:
 *
 * 1. Turn any message into ONE canonical `UniversalIntent`. Every surface used
 *    to have its own idea of what a request was (a chat turn, a command, a plan,
 *    a pending confirmation) and the seams between them are exactly where
 *    "the AI forgot what it was doing" comes from. One shape, one id, one status.
 *
 * 2. Make the pipeline's stages enforceable rather than aspirational. §44 lists
 *    sixteen stages; a `transition()` that throws on illegal moves is what turns
 *    that list into an invariant. "EXECUTE without CONFIRMATION" is not
 *    discouraged here, it is unrepresentable.
 *
 * Classification is LEXICAL FIRST and the model is optional, inverted on
 * purpose: the previous path reached for the LLM whenever its own regexes were
 * unsure, so ambiguity in the parser became a hallucination downstream. Here the
 * lexicon decides when the domain is decidable (which, for these verbs, is
 * almost always) and an LLM may only PROPOSE; a proposal is accepted when it
 * agrees with state, and ignored when it needs data the state does not have.
 */
import { CI_SCHEMA, INTENT_STATE_TRANSITIONS, INTENT_STATES, PERMISSION, round, hashString } from './schema.js';
import { detectFollowUp, extractAmounts, extractHorizon, findAssetsIn, findAssetsWithPositions, findNetworksIn, normalizeText, resolveReferences, usableSymbol } from './context.js';

export const INTENT_SCHEMA = 'fbt.universal-intent.v1';

/** The intent vocabulary the brain understands, with the modules each needs. */
export const INTENT_TYPES = Object.freeze({
  PORTFOLIO_ANALYSIS: { modules: ['wallet', 'portfolio', 'crypto', 'risk'], permission: PERMISSION.READ },
  /* «ETF بخرم؟» — the registry decides whether this is a route or a refusal. */
  INSTRUMENT_QUERY: { modules: ['stocks', 'etf', 'funds', 'forex', 'commodities', 'rwa', 'crypto'], permission: PERMISSION.READ },
  /* Phase 217 — «اگر طلا ۵٪ اصلاح کرد و BTC بالای X بود، ۱۰٪ سرمایه را به طلا
     اختصاص بده». Six understandings at once (asset + cross-asset + portfolio
     + risk + condition + allocation), across RWA / stocks / forex /
     commodities as well as crypto. PREPARE, not EXECUTE: the plan is
     proposed, the broker hand-off is unsigned, the wallet signs. */
  CONDITIONAL_ALLOCATION: { modules: ['portfolio', 'risk', 'crypto', 'stocks', 'etf', 'funds', 'forex', 'commodities', 'rwa', 'goals'], permission: PERMISSION.PREPARE },
  CONCENTRATION_CHECK: { modules: ['portfolio', 'risk'], permission: PERMISSION.READ },
  /*
   * ── THE PLAIN RISK QUESTION (2026-11-13) ──────────────────────────────
   *
   * «ریسک چقدره؟» is the most ordinary question a person can ask
   * about a portfolio, and it had NO intent. The `risk` module was
   * registered, readable, and produced a full verdict — level, factors,
   * confidence — and nothing could reach it, because every risk intent
   * that existed was about a SPECIFIC risk: concentration, liquidity,
   * futures. The general one had no rule, so it fell through to
   * UNSUPPORTED.
   *
   * It matters more than it looks: this is the second half of
   * «پورتفوی من چیست و ریسکش چقدر است». A two-part question whose
   * second part is «ریسک» cannot be answered in full while «ریسک» is
   * a hole.
   */
  RISK_OVERVIEW: { modules: ['portfolio', 'risk'], permission: PERMISSION.READ },
  /*
   * ── THE YIELD SURFACE (2026-11-12) ─────────────────────────────────────
   *
   * Three modules were REGISTERED and READABLE and NOTHING EVER ASKED THEM.
   * The measurement was blunt:
   *
   *     modules an intent asks   : 27
   *     REGISTERED BUT NEVER ASKED: farming, liquidity, staking
   *
   * So the brain could read the live yields engine, the live LP risk and
   * the live staking APR — and a user who asked «بهترین ییلد کجاست؟» or
   * «ریسک نقدینگی چقدره؟» got `UNSUPPORTED`.
   *
   * The corpus could answer a DEFINITION («استیکینگ چیه؟») but not a
   * QUESTION about the CURRENT numbers, because APR moves and a glossary
   * does not. Those are different questions and they need different
   * sources: the definition comes from the corpus, the number comes from
   * the engine.
   *
   * These three intents are therefore the bridge between the two.
   */
  YIELD_OPPORTUNITY: { modules: ['farming', 'portfolio', 'risk'], permission: PERMISSION.READ },
  /*
   * ── THE GLOBAL SURFACE (2026-11-12) ───────────────────────────────────
   *
   * The brain's own `signals` module is a price computation: an SMA cross
   * and a realized volatility over 30 days of closes. It is NOT smart
   * money.
   *
   * Smart money — paired-swap consensus, whale transfers, net flow,
   * accumulation vs distribution, the macro graph — lives in
   * `server/fios/` (50 files, 980 KB) and no intent could reach it. A
   * user who asked «پول هوشمند کجاست؟» got UNSUPPORTED while a working
   * engine sat there.
   *
   * `global-intel` is the module the brain reads to get there; it has no
   * state section because the snapshot is per-owner and is read through
   * the bridge rather than stored in the shared state store.
   */
  SMART_MONEY_READ: { modules: ['global-intel', 'markets', 'risk'], permission: PERMISSION.READ },
  /* The section is `globalIntel`; the module is `global-intel`. They have
     different names because the section name is a state key and the module
     name is a registry id, and the registry already uses `global-intel`
     for the module. */
  LIQUIDITY_RISK: { modules: ['liquidity', 'portfolio', 'risk'], permission: PERMISSION.READ },
  STAKING_REWARD: { modules: ['staking', 'portfolio', 'risk'], permission: PERMISSION.READ },
  /*
   * ── THE FIT SURFACE (2026-11-12) ──────────────────────────────────────
   *
   * "Which of these suits ME?" is a different question from "which of
   * these pays most?" — and the project could only answer the second one.
   *
   * The fit engine already existed in `server/fios/` (opportunityFit): it
   * scores an opportunity against the OWNER's risk profile, their capital,
   * their liquidity need and their goal — profit, probability, risk,
   * liquidity, costs, capital — and returns FITTED / CONDITIONAL /
   * NOT_FITTED with the reason for each dimension.
   *
   * What was missing was a way to ASK. «کدام گزینه مناسب من است؟» was
   * UNSUPPORTED, so a working engine answered nothing.
   *
   * The module reads through the SAME bridge as the global surface, for
   * the same reason: `fios` is built after the brain, and importing it
   * directly would put 980 KB of engines on every cold start.
   */
  OPPORTUNITY_FIT: { modules: ['opportunity-fit', 'portfolio', 'risk'], permission: PERMISSION.READ },
  /* The route-intelligence surface: WHICH bridge should carry this
     transfer, priced against the others. It reads the route ranking and
     the market context it is judged in. */
  ROUTE_INTELLIGENCE: { modules: ['route-intelligence', 'markets', 'risk'], permission: PERMISSION.READ },
  /* The why surface: «چرا این را گفتی؟» — the explanation of the
     brain's OWN decision, with its five why-lines and its falsifiers. It
     reads the decision, the risk view and the owner's own state. */
  WHY_DECISION: { modules: ['why-decision', 'portfolio', 'risk'], permission: PERMISSION.READ },
  ASSET_ANALYSIS: { modules: ['crypto', 'signals', 'news', 'risk'], permission: PERMISSION.READ },
  BALANCE_QUERY: { modules: ['wallet'], permission: PERMISSION.READ },
  LOAN_STATUS: { modules: ['lending', 'borrowing', 'portfolio', 'risk'], permission: PERMISSION.READ },
  BORROW_CAPACITY: { modules: ['lending', 'borrowing', 'wallet', 'risk'], permission: PERMISSION.READ },
  FUTURES_RISK: { modules: ['futures', 'dydx', 'portfolio', 'risk'], permission: PERMISSION.READ },
  /* The market overview now also reads the global surface (path 12). The
     macro graph is not a price list — it is the REGIME: what the world
     model, the global snapshot and the portfolio together say about the
     market right now. It was a complete engine, unreachable. */
  MARKET_OVERVIEW: { modules: ['crypto', 'signals', 'news', 'global-intel', 'macro-graph'], permission: PERMISSION.READ },
  NEWS_SUMMARY: { modules: ['news', 'signals', 'events'], permission: PERMISSION.READ },
  SIGNAL_READING: { modules: ['signals', 'crypto', 'news'], permission: PERMISSION.READ },
  GOAL_PLAN: { modules: ['goals', 'portfolio', 'forecast', 'risk', 'profit-plan', 'goal-scenarios'], permission: PERMISSION.READ },
  PROFIT_PLAN: { modules: ['profit-plan', 'portfolio', 'crypto', 'forecast', 'risk', 'goals'], permission: PERMISSION.READ },
  WHATIF_SIMULATION: { modules: ['lab', 'portfolio', 'forecast', 'risk'], permission: PERMISSION.PREPARE },
  QUOTE_SWAP: { modules: ['swap', 'crypto', 'wallet', 'risk'], permission: PERMISSION.PREPARE },
  QUOTE_BRIDGE: { modules: ['bridge', 'wallet'], permission: PERMISSION.PREPARE },
  /* «بفروش / بفروشش / می‌خوام بفروشم» are the most common way to ask for a swap in
     this product, and they name no destination asset, so they must NOT silently
     become a quote of something else. They are an execute intent whose missing
     field the brain then asks for. */
  EXECUTE_SWAP: { modules: ['swap', 'wallet', 'portfolio', 'risk', 'transactions'], permission: PERMISSION.EXECUTE },
  EXECUTE_BRIDGE: { modules: ['bridge', 'wallet', 'portfolio', 'risk', 'transactions'], permission: PERMISSION.EXECUTE },
  EXECUTE_LEND: { modules: ['lending', 'wallet', 'portfolio', 'risk', 'transactions'], permission: PERMISSION.EXECUTE },
  EXECUTE_BORROW: { modules: ['borrowing', 'lending', 'wallet', 'portfolio', 'risk', 'transactions'], permission: PERMISSION.EXECUTE },
  EXECUTE_REPAY: { modules: ['borrowing', 'lending', 'wallet', 'risk', 'transactions'], permission: PERMISSION.EXECUTE },
  EXECUTE_REBALANCE: { modules: ['portfolio', 'swap', 'risk', 'transactions'], permission: PERMISSION.EXECUTE },
  CREATE_GOAL: { modules: ['goals', 'portfolio', 'forecast'], permission: PERMISSION.PREPARE },
  SET_ALERT: { modules: ['alerts', 'crypto', 'notifications'], permission: PERMISSION.PREPARE },
  CONFIRM_PENDING: { modules: [], permission: PERMISSION.EXECUTE },
  CANCEL_PENDING: { modules: [], permission: PERMISSION.READ },
  NAVIGATE: { modules: ['session'], permission: PERMISSION.READ },
  UNSUPPORTED: { modules: [], permission: PERMISSION.READ }
});

/*
 * Weighted lexical rules, highest score wins. Each rule names the state it
 * needs; `requires` is what makes a hit honest — «وامم چقدر امنه» can only be a
 * LOAN_STATUS if a lending position could actually be read, otherwise the intent
 * is still LOAN_STATUS but with `executable:false` and a stated reason (§21).
 */
/*
 * Intents that NAME a capability, and therefore carry their own referent.
 *
 * `ASSET_ANALYSIS` is deliberately NOT in this set: it matches «چطور است»,
 * «بررسی کن» and «چطوره», so half the sentences in the product would
 * count as "explicit" and follow-ups would stop working entirely.
 *
 * `MARKET_OVERVIEW` is not in it either — «بازار» is a topic, not a
 * capability name.
 */
const EXPLICIT_INTENTS = Object.freeze(new Set([
  'STAKING_REWARD', 'LIQUIDITY_RISK', 'YIELD_OPPORTUNITY', 'OPPORTUNITY_FIT',
  'ROUTE_INTELLIGENCE', 'WHY_DECISION',
  'FUTURES_RISK', 'LOAN_STATUS', 'BORROW_CAPACITY', 'RISK_OVERVIEW',
  'EXECUTE_LEND', 'EXECUTE_BORROW', 'EXECUTE_REPAY', 'EXECUTE_REBALANCE',
  'CREATE_GOAL', 'SET_ALERT', 'INSTRUMENT_QUERY'
]));

const RULES = Object.freeze([
  /*
   * WHY DECISION (path 15).
   *
   * «چرا این را گفتی؟» — «why did you say that?» — is the question every
   * assistant is eventually asked, and until now it was UNSUPPORTED: the
   * product had a why engine (five why-lines and four named falsifiers)
   * and no way to reach it.
   *
   * It is placed FIRST on purpose. The question is about the PREVIOUS
   * answer, and it is a question about the assistant's own reasoning — so
   * it cannot be captured by a surface that reads the market, the
   * portfolio or the goals. And it is a FOLLOW-UP in the literal sense:
   * «چرا؟» after any answer means «explain what you just said».
   *
   * The wording is deliberately specific about WHAT is being explained.
   * «چرا بیت‌کوین بالا رفت؟» is a market question and belongs to the
   * market surface; «چرا این را گفتی؟» is a question about the answer.
   */
  {
    intent: 'WHY_DECISION',
    patterns: [
      /(چرا|چطور|چه\s*طور|بر\s*چه\s*اساس|دلیل|منطق)\s*.{0,26}?(این\s*(را|و)?\s*(گفتی|گفتید|پیشنهاد\s*دادی|پیشنهاد\s*دادید|انتخاب\s*کردی|انتخاب\s*کردید|انتخاب\s*کردم)|تصمیم|پیشنهاد|توصیه|پاسخ|جواب|کاری\s*که\s*کردی)/i,
      /(چرا|بر\s*چه\s*اساس|دلیل)\s*.{0,20}?(این|اون)\s*(گزینه|مسیر|پل|استراتژی|راه|برنامه|حساب)?\s*(را\s*)?(انتخاب|پیشنهاد|گفتی|گزیدی|ساختی)?/i,
      /\bwhy\s+(did\s+you|do\s+you|you)\s+(say|recommend|suggest|choose|pick|tell\s+me)/i,
      /\bwhy\s+(this|that|it)\s+(recommendation|suggestion|answer|choice|path|route)/i,
      /\bwhy\s+did\s+you\s+(say|recommend|choose|pick)\b/i,
      /\b(reason|reasoning|rationale|justify)\b.{0,26}\b(recommendation|suggestion|answer|decision|choice)\b/i,
      /\bwhy\b.{0,26}\b(recommend|suggest|choose|pick)\b/i
    ],
    requires: ['why-decision']
  },
  /* The plain «ریسک من / my risk» is NOT here: it is the RISK_OVERVIEW
     question, and a rule that claimed it made «ریسک من چقدر است؟»
     answer about the portfolio's composition instead of its risk. The
     portfolio reading keeps the forms that NAME the portfolio. */
  { intent: 'PORTFOLIO_ANALYSIS', patterns: [/پرتفوی|پورتفوی|سبد (سرمایه|من)|portfolio|holdings|ارزش (کیف|سبد)|ریسک (پورتفوی|سبد)|ارزیابی ریسک|risk (assessment|check)/i], requires: ['portfolio'] },
  { intent: 'CONCENTRATION_CHECK', patterns: [/زیاد (دارم|است|داری)|تمرکز|concentration|too much|比重|تک‌دارایی|تک دارایی/i], requires: ['portfolio'] },
  /*
   * «ریسک چقدره» — the plain form of the question. The subject is
   * «ریسک» alone, with no qualifier, so it must not steal the
   * specific risks: «ریسک نقدینگی», «ریسک فیوچرز», «ریسک تمرکز».
   * Those carry their own nouns and their own intents.
   *
   * The possessive suffix is the tell that this is the SECOND half of
   * a question whose first half named the thing: «ریسکش چقدر است» —
   * its «ش» points back at the portfolio. So «ریسکش» is read as a
   * risk question about whatever was just named.
   */
  { intent: 'RISK_OVERVIEW', patterns: [
      /* The subject is «ریسک» and NOTHING else — «ریسک پورتفوی» is the
         portfolio reading and «ریسک نقدینگی» is the liquidity one, and
         the plain risk question is the one that names no other thing.
         The possessive is allowed («ریسکش», «ریسکم») because it points
         back at the thing named in the first half of the sentence. */
      /ریسک(?:\s|\u200c)*(?:ش|من|م|ت|ی)?\s*(?:چقدر|چند|چه\s*طور|چقدره|زیاد|بالا|کم|چطوره)/i,
      /\brisk\s+(score|level|of my|right now|now)\b/i,
      /how (much|risky) am i/i
    ], requires: ['portfolio'] },
  { intent: 'LOAN_STATUS', patterns: /وامم|وام من|وام(?:م)? (چطور|چقدر|چنده|امن|سلامت)|وضعیت وام|loan status|بدهی ?م|my loan/i, requires: ['lending'] },
  /* Buying an instrument the app may not sell is the most dangerous place to be
     vague: a cheerful «بله، در حال خرید ETF…» would be a lie, and a «متوجه نشدم»
     wastes the turn. It classifies as its own intent so the registry, not the
     language model, decides whether the answer is a route or a refusal (§8). */
  /* Phase 217 — a CONDITIONAL cross-asset instruction. It is placed above
     INSTRUMENT_QUERY on purpose: «اگر طلا ۵٪ اصلاح کرد… اختصاص بده» mentions
     gold, and the old reading turned that into a QUESTION about the gold
     page. The defining signal is the PAIR — a conditional marker («اگر / if /
     وقتی / when») AND an action verb («اختصاص بده / allocate / buy») — so
     «اگر بیت‌کوین ۲۰٪ بریزد چه می‌شود» (a what-if) and «وقتی رسید به ۱۰۰هزار
     خبرم کن» (an alert) keep their own intents. Neither names an action. */
  {
    intent: 'CONDITIONAL_ALLOCATION',
    patterns: [
      /(اگر|اگه|چنانچه|هرگاه|هر وقت|هر زمان|وقتی|زمانی که|در صورت|به شرطی که|\bif\b|\bwhen\b|\bonce\b|\bwhenever\b|in case|provided)[^]{0,80}(اختصاص|تخصیص|منتقل کن|انتقال بده|بگذار|بذار|سرمایه[\s\u200c]?گذاری|ری[\s\u200c]?بالانس|متعادل کن|\ballocat\w*|\bassign\w*|\btransfer\b|\bmove\b|\bshift\b|\bput\b|\binvest\w*|\brebalance\w*|\bre-allocate\w*|\bbuy\b|\bsell\b|\bget\b)/i,
      /(اگر|اگه|چنانچه|هرگاه|هر وقت|هر زمان|وقتی|زمانی که|در صورت|به شرطی که|\bif\b|\bwhen\b|\bonce\b|\bwhenever\b|in case|provided)[^]{0,80}(درصد|%|در صد)[^]{0,60}(اختصاص|تخصیص|\ballocat\w*|\bassign\w*|منتقل|بذار|بگذار|\bbuy\b|\bsell\b|\binvest\w*)/i
    ],
    requires: ['markets']
  },
  { intent: 'INSTRUMENT_QUERY', patterns: [/\betf\b|\beft\b|صندوق (سرمایه|درآمد| ETF)?|fund\b|stock|سهام|شرکت|فارکس|forex|جفت ?ارز|commodit|کالایی|طلا|نقره|نفت|خاک ?سبز|rwa|real.?world|tokeniz|توکنایز|ملک|املاک/, /\b(aapl|tsla|msft|nvda|spy|qqq|googl?e?|amzn|meta|eurusd|usdjpy|dxy|gold|silver|oil|brent|wti|copper)\b/, /اپل|تسلا|مایکروسافت|انویدیا|گوگل|آمازون|متوان/i], requires: ['markets'] },
  { intent: 'BORROW_CAPACITY', patterns: /(?:چقدر|چه مقدار|حداکثر|سقف|چند).{0,28}(وام|borrow|اعتبار)|ظرفیت (وام|دریافت)|borrowing power|max borrow/i, requires: ['lending'] },
  { intent: 'FUTURES_RISK', patterns: /(فیوچرز|آتی|اهرم|leverage|funding|مارجین|perp|position (باز|open)|\bdydx\b|\bfutures\b)/i, requires: ['futures'] },
  { intent: 'WHATIF_SIMULATION', patterns: [/اگر .{0,40}(بیفتد|بیفته|بریزد|بریزه|ریخت|سقوط|بالا برود|بالا بره|بره بالا|افزایش|کاهش|برسه|دو برابر|برابر بشه|نصف بشه)|چه می ?شود|what.?if|در صورت (ریختن|افت)|سناریو|فرض کن/i], requires: ['portfolio'] },
  { intent: 'GOAL_PLAN', patterns: [/هدف|\bgoal\b|برای (رسیدن|برسم)|می[\s\u200c]?خوا?ه?م (به|برسم|.{0,40}(سود|درآمد))|تا .{0,24}(سود|درآمد|برسم)|target (of|:)/i], requires: [] },
  { intent: 'PROFIT_PLAN', patterns: /برنامه (سود|کسب سود|درآمد)|profit plan|بهینه ?سازی (سود|پرتفوی)|بهترین مسیر/i, requires: ['portfolio'] },
  { intent: 'NEWS_SUMMARY', patterns: /(?<!چی )(?<!چه )خبر|اخبار|\bnews\b|آپدیت (جدید|بازار)|رویداد/i, requires: ['news'] },
  { intent: 'SIGNAL_READING', patterns: /سیگنال|signal|اندیکاتور|تایم?فریم/i, requires: ['signals'] },
  /*
   * ── THE GLOBAL SURFACE (2026-11-12) ───────────────────────────────────
   *
   * This rule sits ABOVE MARKET_OVERVIEW, and it has to: that rule
   * already claimed «نهنگ», «اسمارت مانی» and «smart money», and its
   * modules are `markets, signals, news` — so a question about smart
   * money was answered with a price summary instead of the flows.
   *
   * The words are separated by what the user is ASKING FOR:
   *   · smart money / whale / net flow / accumulation ⇒ the global engine
   *   · the market itself ⇒ MARKET_OVERVIEW
   */
  {
    intent: 'SMART_MONEY_READ',
    patterns: [
      /* «پول هوشمند», «سرمایه هوشمند», «پول بزرگ», «پول نهادی» —
         with the ZWNJ that Persian actually writes them with. */
      /(پول|جریان|سرمایه)\s*[\u200c\s]*(هوشمند|بزرگ|نهادی|خرد)/i,
      /(هوشمند|خرد)\s*[\u200c\s]*(پول|سرمایه|بازیگر)/i,
      /smart\s*money/i,
      /* «اسمارت مانی» — the two words with a plain space, which is how
         it is written in Persian and how the market-overview rule spells
         it. */
      /اسمارت\s*مانی/i,
      /* «نهنگ‌ها», «نهنگ ها», «نهنگها» — the plural suffix is written
         three ways and the question word may come before it. */
      /(نهنگ|نهنگها|نهنگ‌ها|نهنگ ها|whales?)/i,
      /(ورود|خروج|انباشت|توزیع)\s*[\u200c\s]*(پول|نقدینگی|دارایی)/i,
      /(جریان|فلو)\s*[\u200c\s]*(خالص|خروج|ورود)/i,
      /(on-?chain|زنجیره.?ای)\s*[\u200c\s]*(فعالیت|رفتار|جریان)/i
    ],
    requires: []
  },
  { intent: 'MARKET_OVERVIEW', patterns: [/بازار|market|قیمت (کلی|بازار)|وضعیت (کلی )?بازار|نهنگ|whale|اسمارت ?مانی|smart money|تورم|نرخ\s*بهره|فدرال|دارایی[‌\s]*های\s*کمیاب|سیاست\s*پولی|inflation|interest\s*rate|\bfed\b|monetary/i], requires: ['markets'] },
  /*
   * A QUOTE IS A QUESTION, AND AN EXECUTION IS AN ORDER.
   *
   * The two were sharing the words «سواپ» and «قیمت», so «قیمت سواپ
   * بیت‌کوین چقدر است؟» — a question about a price — was read as
   * EXECUTE_SWAP, and the user got a trade instead of a number.
   *
   * So the quote patterns now carry the QUESTION MARKERS that make it a
   * question: «چقدر», «چند», «قیمت», «نرخ», «چه قیمتی», and the English
   * «how much» / «what is the price». The execution patterns keep the
   * ORDER markers: «سواپ کن», «بخر», «بفروش», «convert X to Y».
   *
   * A question about a price and an order to trade use the same nouns and
   * differ only in the words around them, so those words are the pattern.
   */
  { intent: 'QUOTE_SWAP', patterns: [
    /نرخ (تبدیل|سواپ|تبدیلش)/i,
    /چند می ?ده(?:د)?/i,
    /\bquote\b/i,
    /قیمت (تبدیل|خرید|فروش|سواپ)/i,
    /چه قیمتی/i,
    /*
     * «چقدر» ALONE is not a swap question. It is the question word for
     * everything: «موجودی من چقدر است؟», «تمرکز پرتفوی من چقدر
     * است؟», «ریسک چقدر است؟». So it only counts when the SENTENCE
     * is about converting something — the swap nouns have to be there
     * too.
     */
    /(?:تبدیل|سواپ|swap|convert).{0,16}چقدر|چقدر.{0,16}(?:تبدیل|سواپ|swap|convert)/i,
    /how much (would|does|is|for)/i,
    /what (is|'s) the (price|rate|quote)/i
  ], requires: ['markets'] },
  { intent: 'EXECUTE_SWAP', patterns: [/تبدیلش? (کن|کنید|بکن|بده|بدهید)|سواپ|\bswap\b|convert .* to|\bexchange .* for|(بفروشش|بفروشمش|بفروش|بفرست|بخرمش|بخرش|بخرم?|بخرید|فروش بزن|خرید بزن|\bsell\b|\bbuy\b|\bpurchase\b|قصد خرید|دنبال خرید)/i], requires: ['wallet'] },
  {
    /*
     * ROUTE INTELLIGENCE (2026-11-12).
     *
     * The question is «which BRIDGE», and the words that carry it are the
     * crossing words: پل / بریج / انتقال / عبور / تبدیل بین شبکه‌ها.
     * A route question is a COMPARISON between ways of moving money, and
     * it is the one place where the answer has to name a cost, a time and
     * a risk — so the ranking is over the LIVE candidates the provider
     * returned, not over a preference order.
     *
     * It is placed above YIELD_OPPORTUNITY because «کدام پل بهتر است»
     * is a route question and not a yield question: a bridge does not
     * yield anything, it charges for the crossing. And it is placed
     * below OPPORTUNITY_FIT because «کدام گزینه مناسب من است» is about
     * the OWNER, not about the route.
     */
    intent: 'ROUTE_INTELLIGENCE',
    patterns: [
      /(کدام|کدوم|چه|چند|which|what)\s*.{0,26}?(پل|بریج|bridge|روت|route).{0,26}?(بهتر|بهترین|ارزان|ارزان‌تر|سریع‌تر|safe|safer|cheaper|fastest|best)?/i,
      /(پل|بریج|bridge|روت|route)\s*.{0,26}?(کدام|کدوم|بهتر|بهترین|ارزان|ارزان‌تر|سریع‌تر|compare|مقایسه|رتبه|rank)/i,
      /(انتقال|عبور|بردن|فرستادن|جابه‌جا|منتقل)\s*.{0,26}?(بین\s*.{0,18}?)?(شبکه|chain|بلاک‌چین)/i,
      /(cross[-\s]?chain|bridging|crossing)\s*.{0,26}?(route|cheapest|fastest|best|compare|rank)?/i,
      /(ارزان‌ترین|سریع‌ترین|کم‌هزینه‌ترین|کم‌ریسک‌ترین)\s*.{0,26}?(پل|بریج|bridge|راه|مسیر|روت|route)/i,
      /\b(best|cheapest|fastest|safest)\s+(bridge|route|path)\b/i,
      /\b(compare|rank)\b.{0,26}\b(routes?|bridges?|paths?)\b/i
    ],
    requires: ['route-intelligence']
  },
  /*
   * `QUOTE_BRIDGE` had NO RULE AT ALL.
   *
   * The intent was declared in `INTENT_TYPES`, given modules, given a
   * priority and given a place in the plan — and there was no pattern
   * that could ever produce it. So «قیمت پل زدن چقدر است؟» could only
   * be EXECUTE_BRIDGE, which means the user asking what a bridge COSTS
   * was asking for a bridge to be taken.
   *
   * The rule is the mirror of `EXECUTE_BRIDGE`: the question markers ask
   * for a price, the order markers ask for the crossing.
   */
  { intent: 'QUOTE_BRIDGE', patterns: /قیمت (پل|انتقال|برید|رفتن به)|هزینه (پل|انتقال|برید)|نرخ (پل|انتقال)|چقدر (پل|انتقال|برید)|چه قیمتی.{0,12}(پل|انتقال)|کدام پل.{0,24}(ارزان|بهتر|کم ?هزینه|سریع)|how much.{0,20}(bridge|transfer|cross)|what.{0,20}(bridge|cross).{0,20}(cost|fee|price)/i, requires: ['markets'] },
  { intent: 'EXECUTE_BRIDGE', patterns: /به (آربیتروم|آربیتروm ?one|آربیتروم one|arbitrum|پالیگان|بیس|اپتیمیزم|اربیترم)|منتقل کن به|برو به شبکه|\bbridge\b|پل بزن|ببر (به|روی)|\bmove\b .{0,24}\bto\b|\btransfer\b .{0,24}\bto\b/i, requires: ['wallet'] },
  { intent: 'EXECUTE_BORROW', patterns: /وام.{0,16}(بگیر|گرفتن|دریافت کن)|borrow (me|some)?|بخوام بگیرم/i, requires: ['lending'] },
  /*
   * LENDING AND REPAYING, IN THE WORDS PEOPLE USE.
   *
   * These two patterns only knew «سپرده» and «بدهی». Both are the
   * BANK's word for the thing; neither is the word a person uses when
   * they mean it. The words people use are «وام بگذار» and «وام را
   * برگردان» — and both of those were UNSUPPORTED.
   *
   * The word «وام» alone is ambiguous: «وام بگیر» is a BORROW and
   * «وام بگذار» is a LEND, so the VERB is what decides, not the noun.
   * The verb lists below are disjoint, which is what keeps the two from
   * stealing each other's sentences.
   */
  { intent: 'EXECUTE_LEND', patterns: /سپرده.{0,16}(گذاری|بگذار|کن|کنید|بذار|بذارید)|(?:وام|پول|دارایی).{0,12}(?:بگذار|بگذارید|بذار|بذارید|واریز کن|واریز کنید|استیک کن|استیک کنید|قفل کن|قفل کنید)|لند (کن|کنید)|\blend\b|\bsupply\b|\bdeposit\b|\bstake\b/i, requires: ['lending'] },
  { intent: 'EXECUTE_REPAY', patterns: /بدهی.{0,16}(را |رو )?بده|بازپرداخت (وام )?(کن|بکن)?|قسط (بده|ردیف)|(?:وام|بدهی|قرض).{0,12}(?:برگردان|برگردانید|بپرداز|بپردازید|تسویه|تسویه کن|تسویه کنید|باز کن|باز کنید)|repay (my |the )?(loan|debt|position)|\brepay\b/i, requires: ['lending'] },
  { intent: 'EXECUTE_REBALANCE', patterns: /ری[\s\u200c]?بالانس|ریبالانس|متعادل (کردن|کن)|توزیع مجدد|rebalance/i, requires: ['portfolio'] },
  /*
   * «یک هدف برایم بساز» — the most natural way to ask for a goal — did
   * not match, because the pattern wanted «هدف» IMMEDIATELY followed by
   * «بساز». The word «برایم» sat between them.
   *
   * The gap between «هدف» and its verb is where Persian puts the
   * possessives («هدفم»، «هدف من»، «هدف برایم»), so the pattern has to
   * allow them. It is a fixed distance, not an open one: «هدف» and
   * «هدفمن» are not the same word.
   */
  { intent: 'CREATE_GOAL', patterns: /هدف(?:م| من| برایم| برام)?[\s\u200c]{0,3}(?:جدید|بساز|بسازید|بذار|بذارید|ثبت|ثبت کن|ثبت کنید|-set)|create (a |new )?goal|set (a |new )?goal|هدفم رو ثبت/i, requires: [] },
  { intent: 'SET_ALERT', patterns: /هشدار|\bset (an )?alert\b|alert (set|کن|for|on|me)|به من خبر بده|وقتی رسید به|خبرم کن|یادم انداز|notify me when/i, requires: [] },
  { intent: 'BALANCE_QUERY', patterns: /مانده|بالانس|موجودی|\bbalance\b|چقدر (دارم|تومان|دلار)|how much (do i|have|i have|to i)/i, requires: ['wallet'] },
  /*
   * ── THE YIELD SURFACE (2026-11-12) ─────────────────────────────────────
   *
   * These three sit ABOVE the ASSET_ANALYSIS rule, and they have to.
   *
   * ASSET_ANALYSIS matches `\byield\b`, `\bfarm\b` and `\bapy\b` — so
   * «بهترین ییلد کجاست؟» and «ریسک LP چقدره؟» were both landing on the
   * crypto-analysis intent, whose modules are `crypto, signals, news,
   * risk`. The yield engine was never consulted.
   *
   * The three rules are deliberately narrow. A sentence has to name the
   * THING (staking / LP / a pool / a farm) AND the QUESTION (what does it
   * yield / how risky / where is the best), because a bare «سود» is
   * ambiguous and a wrong intent is worse than an unsupported one.
   */
  {
    intent: 'STAKING_REWARD',
    patterns: [
      /(استیک|ستیک|استیکینگ|staking|stake|validat)/i,
      /(ویگی|validator|delegat)/i
    ],
    requires: ['farming']
  },
  {
    intent: 'LIQUIDITY_RISK',
    patterns: [
      /(نقدینگی|liquidity|امپرینت|permanent loss|\bIL\b)/i,
      /\bLP\b/i
    ],
    requires: ['liquidity']
  },
  {
    /*
     * The fit question: the words that mean «suitable for me», «matches my
     * profile», «what fits my situation».
     *
     * The distinguishing feature is the OWNER: «مناسب من», «با پروفایل من»,
     * «طبق ریسک من», «for my profile», «fits me». A sentence that says
     * only «کدام بهتر است» is a yield question, not a fit question — that
     * is `YIELD_OPPORTUNITY`'s, and it is claimed above.
     */
    intent: 'OPPORTUNITY_FIT',
    patterns: [
      /(مناسب\s*[\u200c\s]*(من|ما|خودم|کاربر)|تناسب\s*[\u200c\s]*(من|ما|خودم|کاربر)|متناسب\s*[\u200c\s]*(من|ما|خودم|کاربر))/i,
      /* The profile words need the FIT word with them. «وضعیت ریسک من
         چیه» is a question about the profile itself — that is
         PORTFOLIO_ANALYSIS, and stealing it would break the risk
         category. So this pattern only fires when the sentence also says
         which OPPORTUNITY fits: «کدام گزینه با ریسک من». */
      /(پروفایل|ریسک|ترجیح|شرایط|سرمایه|سبک)\s*[\u200c\s]*(من|ما|خودم|کاربر)\s*.{0,26}?(مناسب|جور|هم\s*خوان|همخوان|می\s*خوره|میخوره|فیت|سازگار|بنده|بخوره)/i,
      /(مناسب|جور|هم\s*خوان|همخوان|می\s*خوره|میخوره|فیت|سازگار)\s*.{0,26}?(پروفایل|ریسک|ترجیح|شرایط|سرمایه|سبک)\s*[\u200c\s]*(من|ما|خودم|کاربر)/i,
      /((برای|با|طبق|بر اساس)\s*)[\u200c\s]*(ریسک|پروفایل|شرایط|پروفایل|سرمایه|سبک|ترجیح)\s*[\u200c\s]*(من|ما|خودم)/i,
      /\b(fits?|fit\s+for|suitable\s+for|matches?\s+my|matches?\s+my\s+profile|right\s+for\s+me|for\s+my\s+profile)\b/i,
      /\b(which|what|best)\b.{0,28}\b(fits?|suitable|match)\b/i,
      /* «کدام گزینه به پروفایل ریسک من می‌خوره» / «کدوم با شرایط من جور است» */
      /(کدام|کدوم|چی|چه|which|what)\s*.{0,30}?(جور|هم\s*خوان|همخوان|می\s*خوره|میخوره|مناسب|فیت)\s*[\u200c\s]*(من|ما|خودم)/i
    ],
    requires: ['opportunity-fit']
  },
  {
    intent: 'YIELD_OPPORTUNITY',
    patterns: [
      /* The yield noun and the farm noun, in either order, with anything in
         between: «بهترین فارم USDC», «فارم چیه بهتره برای USDC»,
         «yield farming ETH», «کجا USDC فارم کنم». */
      /(ییلد|بازده|سود|درآمد|apr|apy|farm|فارم|استخر|pool|کشت‌?سود|depos\w*|سپرده)\s*.{0,30}?(ییلد|بازده|سود|درآمد|apr|apy|farm|فارم|استخر|pool|depos\w*|سپرده|lend| lend|بهتره|بهتر|کجاست|کجا|where|best)/i,
      /* «yield farming ETH» — the yield noun immediately followed by the farm
         noun and nothing but the asset after it. The question word is the
         yield noun itself: the sentence IS the request. */
      /(yield|بازده|سود|درآمد|apy|apr)\s*(farm|فارم|pool|استخر|استیک|staking|deposit|سپرده)/i,
      /* The question word and the yield noun: «بهترین APY برای ETH»,
         «best apy on ETH», «کدام ییلد», «which pool pays most». */
      /(بهترین|بهتر|بیشترین|کدام|کدوم|کجا|چند|چقدر|what|which|best|highest|top)\s*.{0,24}?(ییلد|بازده|apr|apy|farm|فارم|pool|استخر|کشت‌?سود)/i,
      /* The yield noun and the question word: «apy USDC چنده»,
         «سود استیکینگ چقدره», «ییلد چقدر است», «farm yield for ETH». */
      /(ییلد|بازده|apr|apy|farm|فارم|pool|استخر|کشت‌?سود)\s*.{0,30}?(چند|چقدر|چقدره|چنده|چه ?مقدار|کدام|کدوم|کجا|بهترین|بیشترین|how much|how high|what|which|best|where|for\b)/i,
      /* A verb that only makes sense for a pool: «USDC فارم کنم»,
         «where can I farm USDC». */
      /(.{0,30}?)(فارم\s*(کن|کنم|کنید)|استخر\s*(بذار|بگذار|بگذارم)|ییلد\s*(بگیرم|بگیر)|درآمد\s*(داشته\s*باشم|داشته باشم|بگیرم))/i
    ],
    requires: ['farming']
  },
  { intent: 'ASSET_ANALYSIS', patterns: /(بررسی|تحلیل|وضعیت) ?(کن|ش)?|analyze|check .* out|چطور (است|ه)|چطوره|چه حالی|\bfarm\b|فارم|\bapy\b|\byield\b/i, requires: ['markets'] },
  /* Price questions are the single most common message in a trading app, and a
     lexicon that misses them turns "36,000 USDT" into "please clarify". Ordered
     after QUOTE_SWAP / BALANCE_QUERY / LOAN_STATUS so those keep their ground. */
  { intent: 'ASSET_ANALYSIS', patterns: /قیمت|price|چنده|چقدره|چند است|چند شد|چند شده|رسید (به|چند)|رساند|rate (is|of)/i, requires: ['markets'] },
  /*
   * NAVIGATION IS A PAGE, NOT A DESTINATION.
   *
   * The pattern used to be `/برو به (صفحه )?/` — «go to», with an
   * OPTIONAL page word. That made every «برو به …» a navigation
   * request, including «برو به شبکه پالیگان», which is a BRIDGE
   * OPERATION: the user is not asking to see a screen, they are asking
   * to move money to Polygon.
   *
   * It only showed up when the wallet was unreadable. With a live wallet
   * the EXECUTE_BRIDGE pattern matched too and won on priority. With a
   * broken wallet the execute intent was down-scored (0.45 instead of
   * 0.7) and navigation won — so a sentence that MEANT a transfer was
   * read as a page request, and a transfer that was meant was never
   * planned.
   *
   * A destination that is a place on a chain is not a page. So the
   * navigation verbs now need their OBJECT: a page, a tab, a menu, a
   * section, or a screen. The bare «برو به» is not enough.
   */
  { intent: 'NAVIGATE', patterns: [
    /برو به (صفحه|بخش|منو|تب|داشبورد|صفحهٔ)/i,
    /باز کن (صفحه|بخش|منو|تب)/i,
    /(?:open|show|navigate to)\s+(?:the\s+)?[\w\u0600-\u06FF]+\s+(?:page|tab|screen|section|menu)/i,
    /نمایش بده/i,
    /navigate to\b/i,
    /show me the/i
  ], requires: [] }
]);

/**
 * `classify` — deterministic first, model second, and the model can only fill
 * an UNSURE slot. Returns confidence so downstream honesty (and §26 "no
 * recommendation without a reason") can point at why a choice was made.
 */
/** Which module has to answer for a state section to exist (§9 dependency check). */
const SECTION_OWNER = Object.freeze({
  wallet: 'wallet', portfolio: 'portfolio', positions: 'portfolio', markets: 'crypto',
  crypto: 'crypto', lending: 'lending', borrowing: 'borrowing', futures: 'futures',
  dydx: 'dydx', goals: 'goals', signals: 'signals', news: 'news', transactions: 'transactions',
  alerts: 'alerts', risk: 'risk', capabilities: 'risk', health: 'risk',
  /*
   * The yield surface. `farming` and `liquidity` are STATE SECTIONS — they
   * exist in `createSystemState()` and they were owned by nobody, which
   * meant `SERVE_UNAVAILABLE` could not tell whether the section was
   * missing or merely unreadable.
   *
   * `staking` has no section of its own: its module reads `farming`, so
   * the owner is `farming` too.
   */
  farming: 'farming', liquidity: 'liquidity', staking: 'farming',
  globalIntel: 'global-intel', opportunityFit: 'opportunity-fit',
  /*
   * The three surfaces added after the yield and global ones.
   *
   * `routeIntelligence`, `whyDecision`, `macroGraph` and `goalScenarios`
   * are STATE SECTIONS, and their MODULES are `route-intelligence`,
   * `why-decision`, `macro-graph` and `goal-scenarios`. A rule names
   * the MODULE it needs («route-intelligence»), and the state has the
   * SECTION — and without this mapping the two were never the same
   * name, so the rule's requirement could never be found in either
   * place.
   *
   * That silence is worse than an error. `SERVE_UNAVAILABLE` asks
   * «can this intent still be served?» and got «yes, I have never
   * heard of it» — so an intent whose source was DOWN kept its full
   * score and could win a sentence it must not answer. And
   * `needsFetch` asked «have we read it yet?» and got «no» forever,
   * so the intent never got the warmth nudge that a warm section
   * earns.
   *
   * The consequence was measured: with a wallet connected,
   * «کدام پل برای انتقال بیت‌کوین به پالیگان بهتر است؟» classified as
   * EXECUTE_BRIDGE — the loose pattern matched «به پالیگان» — because
   * the route intent could never learn that its own section was
   * already in memory. A comparison question was read as an
   * instruction to move the money.
   */
  routeIntelligence: 'route-intelligence',
  whyDecision: 'why-decision',
  macroGraph: 'macro-graph',
  goalScenarios: 'goal-scenarios',
  profitPlan: 'profit-plan'
});
/*
 * The reverse of SECTION_OWNER: from a MODULE name to the STATE SECTION
 * that holds its data. `stateHas` is keyed by section, and a rule's
 * `requires` is keyed by module.
 */
const STATE_SECTION_FOR_MODULE = Object.freeze({
  'global-intel': 'globalIntel',
  'opportunity-fit': 'opportunityFit',
  'route-intelligence': 'routeIntelligence',
  'why-decision': 'whyDecision',
  'macro-graph': 'macroGraph',
  'goal-scenarios': 'goalScenarios',
  'profit-plan': 'profitPlan',
  staking: 'staking',
  crypto: 'crypto'
});

function SERVE_UNAVAILABLE(context, section) {
  const caps = context?.capabilities;
  if (!caps || typeof caps !== 'object') return false;
  const status = caps[SECTION_OWNER[section] || section];
  return status === 'UNAVAILABLE' || status === 'INCOMPLETE';
}

/**
 * Score one sentence (or one CLAIM of a sentence) against the rule table.
 *
 * The rule table is about VOCABULARY. Whether a sentence is one question
 * or two is about STRUCTURE, and the two are kept apart: this function
 * answers «what is this about», and `splitClaims` answers «how many
 * things is this about».
 *
 * @param {string} text the normalized text to score
 * @param {object} opts
 * @returns {Array<object>} the hits, best first is decided by the caller
 */
function scoreClaim(text, { context = {}, state = {}, isDistress = false, isDiscovery = false } = {}) {
  const hits = [];
  for (const rule of RULES) {
    if (rule.intent === 'EXECUTE_SWAP' && (isDistress || isDiscovery)) continue;
    const patterns = Array.isArray(rule.patterns) ? rule.patterns : [rule.patterns];
    const hit = patterns.some((p) => p.test(text));
    if (!hit) continue;
    /* An intent is NOT downgraded for state we have not fetched yet — fetching is
       the brain's job, and on a cold session everything would look impossible,
       which quietly ranks «هدف بساز» (needs nothing) above a real market question.
       It is downgraded only when the module that owns the data is genuinely
       UNAVAILABLE or INCOMPLETE, because then no amount of fetching helps. */
    const unavailable = (rule.requires || []).filter((k) => SERVE_UNAVAILABLE(context, k));
    /*
     * The state has SECTIONS and the capability matrix has MODULES, and
     * they are named differently — `routeIntelligence` versus
     * `route-intelligence`. A rule names the module it needs, so the
     * lookup for «have we read it yet?» has to ask about the SECTION
     * that owns it, or it asks a question the state cannot answer.
     */
    const needsFetch = (rule.requires || []).filter((k) => {
      const section = STATE_SECTION_FOR_MODULE[k] || k;
      return !context.stateHas?.[section];
    });
    /* Three signals, added once, in the order that matters:
       - availability: an intent whose data source is UNAVAILABLE can never outrank
         one that is actionable, because we would promise what we cannot do;
       - specificity: which intent the sentence is REALLY about («وام از این
         پرتفوی» mentions the portfolio but is a borrow-capacity question), so a
         generic rule must not steal a specific one;
       - warmth: whether the state is already in memory, a 2-point nudge only,
         because it says something about our cache, not about the user's words. */
    const avail = unavailable.length ? 0.45 : 0.7;
    const priority = rule.priority ?? INTENT_PRIORITY[rule.intent] ?? 0;
    const warm = needsFetch.length ? 0 : 0.02;
    hits.push({
      intent: rule.intent, missingRequires: unavailable, needsFetch, avail, priority,
      score: round(Math.min(0.95, avail + priority + warm), 3)
    });
  }
  /*
   * A DISCOVERED OR DISTRESSED OWNER IS A MARKET QUESTION.
   *
   * «چی خوبه بخرم؟» and «همه پولمو بفروش» are not about an asset —
   * they are about the owner, and the honest answer is the market view
   * with the risk beside it. So they get their own hit, and they get it
   * in this function so that a CLAIM of a two-part sentence is judged the
   * same way a whole sentence is.
   */
  if (isDistress || isDiscovery) {
    const unavailable = SERVE_UNAVAILABLE(context, 'markets') ? ['markets'] : [];
    hits.push({
      intent: 'MARKET_OVERVIEW',
      missingRequires: unavailable,
      score: unavailable.length ? round(0.45 * (0.45 / 0.7), 3) : 0.45,
      distress: true
    });
  }
  return hits;
}

export function classify(message = '', { context = {}, state = {}, suggestions = null } = {}) {
  const text = normalizeText(message);
  const follow = context.followUp || detectFollowUp(message, context.memory, context.page);
  const isDistress = (
    /(?:حالم\s*بد|ناراحتم|ترسیدم|پریشونم|داغونم|خسته\s*شدم|panic|scared|terrified|lost\s+everything)/i.test(text)
    && /(?:ضرر|باخت|بفروشم|خروج|همشو|همه\s*چیمو|همه\s*پولمو|sell|loss|lose)/i.test(text)
  ) || /(?:همشو|همه\s*چیمو|همه\s*پولمو|کل\s*سرمایه.{0,12}بفروشم|sell\s*everything|liquidate\s*all)/i.test(text);
  const isDiscovery = /(?:معرفی\s*کن|پیشنهاد\s*بده|چی\s*(?:خوبه|بخرم)|کدوم\s*(?:ارز|توکن|کوین)|چه\s*ارزی|بهترین\s*(?:گزینه|ارز).{0,20}(?:خرید|بخرم)|what\s+(?:should\s+i|to)\s+buy|which\s+(?:coin|token|asset)\s+(?:should\s+i|to)\s+buy|suggest\s+(?:a\s+)?(?:coin|token|asset)|recommend\s+(?:a\s+)?(?:coin|token|asset))/i.test(text)
    && !/[0-9]+/.test(text);
  const hits = scoreClaim(text, { context, state, isDistress, isDiscovery });
  /* A follow-up rewrites the intent, because in a conversation the referent IS
     the intent: «بفروشم؟» after a BTC analysis is a swap quote on BTC, not a
     generic question about selling. */
  /*
   * ── AN EXPLICIT INTENT BEATS A FOLLOW-UP (2026-11-12) ─────────────────
   *
   * `RISK_QUERY` fires on «ریسک … چقدره؟» and rewrites the intent to
   * `LOAN_STATUS` — on the assumption that «ریسک» always means the risk of
   * a loan. That assumption is true for «ریسک وامم چقدره؟» and false for
   * «ریسک نقدینگی LP چقدره؟».
   *
   * The tell is not the word «ریسک» — it is that the sentence NAMES A
   * CAPABILITY. «نقدینگی», «LP», «استیکینگ» and «ییلد» are names, not
   * pronouns: they carry their own referent, so the sentence is not a
   * follow-up to whatever was said before. Rewriting it to the previous
   * intent answers a question the user did not ask.
   *
   * The rule is narrow on purpose. An explicit intent wins only when it
   * is a REAL intent with its own modules (not `ASSET_ANALYSIS`, which
   * matches almost any sentence containing «چطور است»), and only when
   * the follow-up is not a confirmation or a cancellation — those are
   * about an ACTION and must always win.
   */
  const followupIntent = followIntent(follow, context);
  if (followupIntent && !(isDistress && ['EXECUTE_SWAP'].includes(followupIntent.intent))) {
    const explicit = hits.find((h) => EXPLICIT_INTENTS.has(h.intent) && (h.score || 0) >= 0.7);
    const actionFollowUp = followupIntent.intent === 'CONFIRM_PENDING' || followupIntent.intent === 'CANCEL_PENDING';
    if (!explicit || actionFollowUp) {
      hits.unshift({ ...followupIntent, score: followupIntent.score ?? 0.9 });
    }
  }

  const compound = detectCompound(text);
  /* A compound request is the whole sentence, so it is ranked with the same rule
     as everything else — its own score is a floor, not an automatic win. */
  hits.push(...compound.map((c) => {
    /* A compound request inherits its intent's availability check — «به arbitrum
       ببر» with the wallet UNAVAILABLE must refuse both legs, not promise them.
       Without this the compound floor (0.76) outranked every honest single
       intent in a dead deployment. */
    const rule = RULES.find((r) => r.intent === c.intent);
    const unavailable = (rule?.requires || []).filter((k) => SERVE_UNAVAILABLE(context, k));
    const base = round(Math.max(0.72, c.score ?? 0.72), 3);
    return {
      intent: c.intent,
      score: unavailable.length ? round(base * (0.45 / 0.7), 3) : base,
      compound: true, leg: c.leg,
      missingRequires: unavailable.length ? unavailable : undefined
    };
  }));

  /* A sentence that names a PAGE («برو به صفحه swap», «open the swap page») is a
     navigation request even when the page's name is also an operation verb — the
     user asked to SEE the page, not to run it. Lift NAVIGATE above every execute
     verb (max 0.75) but below conversation follow-ups (0.85+). */
  if (/صفحه|\bpage\b|\btab\b|منو|بخش|نمایش بده|navigate to\b|show me the/.test(text)) {
    const nav = hits.find((h) => h.intent === 'NAVIGATE');
    if (nav) {
      nav.score = round(Math.max(nav.score, 0.78), 3);
      hits.sort((a, b) => (b.score || 0) - (a.score || 0));
    }
  }

  /*
   * ─── TWO CLAIMS, TWO INTENTS, ONE PLAN ─────────────────────────────────
   *
   * The sentence may be two questions. If it is, each half is
   * classified on its own and the halves become the compound legs.
   *
   * This is done HERE, at the end, rather than by making the rule
   * table understand conjunctions — because the rule table is about
   * VOCABULARY and this is about STRUCTURE, and a rule table that
   * tried to match «X و Y» would need one rule per pair of intents.
   *
   * The halves must be DIFFERENT intents. Two halves that classify to
   * the same intent are one question asked twice — «پورتفوی و موجودی
   * من» — and two legs would read the same section twice and answer
   * it twice.
   */
  const claims = splitClaims(text);
  let multiLegs = null;
  if (claims.length > 1) {
    const legs = [];
    for (const claim of claims) {
      const legHits = scoreClaim(claim, { context, state, isDistress, isDiscovery });
      if (!legHits.length) continue;
      legs.push({ intent: legHits[0].intent, score: legHits[0].score, claim });
    }
    const distinct = Array.from(new Set(legs.map((l) => l.intent)));
    if (distinct.length > 1) {
      multiLegs = legs.map((l, i) => ({ intent: l.intent, leg: i + 1, claim: l.claim }));
      /* The second half's own hit joins the evidence trail, so the reply
         can show WHICH words produced the second leg. */
      hits.push(...legs.slice(1).map((l) => ({ intent: l.intent, score: l.score, compound: true, leg: 2 })));
    }
  }

  hits.sort((a, b) => (b.score || 0) - (a.score || 0));
  const best = hits[0] || null;
  const definition = best ? INTENT_TYPES[best.intent] : null;
  const entities = extractEntities(message, { context, state });
  entities.isDistress = isDistress;
  entities.isDiscovery = isDiscovery;
  const executable = Boolean(definition) && !best?.missingRequires?.length;
  const proposed = suggestions && typeof suggestions === 'object' ? suggestions : null;
  const modelUsed = Boolean(proposed?.intent && (!best || best.score < 0.5));
  const acceptedModel = modelUsed && proposed.confidence >= 0.6 && INTENT_TYPES[proposed.intent];
  return {
    type: acceptedModel ? proposed.intent : (best?.intent || 'UNSUPPORTED'),
    confidence: acceptedModel ? round(Math.max(0.5, Number(proposed.confidence) || 0.5), 3) : (best ? best.score : 0.2),
    source: acceptedModel ? 'model-override' : (best ? (best.compound ? 'lexical+compound' : 'lexical') : 'none'),
    evidence: hits.slice(0, 4).map((h) => h.intent + (h.compound ? '(leg)' : '')),
    followUp: follow.kind,
    missingRequires: best?.missingRequires || [],
    needsFetch: best?.needsFetch || [],
    entities,
    definition: definition ? { modules: definition.modules, permission: definition.permission } : { modules: [], permission: PERMISSION.READ },
    /** A model may not upgrade an intent that needs data we cannot read (§3). */
    executable,
    /*
     * The compound legs are the union of the two sources: the LEGACY
     * two-step patterns («convert, then bridge») and the NEW claim
     * split («price AND balance»). A sentence can have both — «ETH را
     * بخر و بعدش ببر روی آربیتروم» is a claim split AND a bridge leg —
     * and the intent is the same either way, so the union is by
     * INTENT and not by source.
     */
    compound: (() => {
      const all = [
        ...compound.map((c) => ({ intent: c.intent, leg: c.leg })),
        ...(multiLegs || [])
      ];
      if (!all.length) return null;
      const seen = new Set();
      const merged = [];
      for (const c of all) {
        if (seen.has(c.intent)) continue;
        seen.add(c.intent);
        merged.push(c);
      }
      return merged;
    })(),
    needsState: (definition?.modules || []).slice()
  };
}

/** Which intent wins when a sentence matches several; see `classify`. */
const INTENT_PRIORITY = Object.freeze({
  BORROW_CAPACITY: 0.07, EXECUTE_REPAY: 0.075, LOAN_STATUS: 0.06, WHATIF_SIMULATION: 0.05,
  /* Phase 217 — above INSTRUMENT_QUERY: the same sentence names an instrument,
     and the instruction reading is the more specific one. */
  CONDITIONAL_ALLOCATION: 0.085,
  INSTRUMENT_QUERY: 0.05, SET_ALERT: 0.05, NEWS_SUMMARY: 0.045, SIGNAL_READING: 0.045,
  PROFIT_PLAN: 0.045, QUOTE_BRIDGE: 0.04, EXECUTE_BRIDGE: 0.04, FUTURES_RISK: 0.04,
  /*
   * The route surface sits ABOVE EXECUTE_BRIDGE, and the reason is the
   * question's own grammar: «کدام پل بهتر است» and «which bridge is
   * cheapest» are COMPARISONS, while «پل بزن» and «move X to Y» are
   * commands. Both sentences mention a bridge and a network, and the
   * EXECUTE_BRIDGE pattern is deliberately loose — it has to be, because
   * «برو به شبکه» appears in the middle of an ordinary sentence.
   *
   * So the comparison words decide, and they are given the higher
   * priority. Without this, «which bridge is cheapest for this
   * transfer?» would be read as an instruction to move the money.
   */
  ROUTE_INTELLIGENCE: 0.055,
  /*
   * The why surface sits at the TOP of the priority list. «چرا این را
   * گفتی؟» is a question about the previous answer, and it is the
   * clearest signal a user can give that they want the REASONING rather
   * than another reading. Anything that would steal it — a market
   * question, a portfolio question — is a question about the world, and
   * the world did not just get a recommendation.
   */
  WHY_DECISION: 0.09,
  QUOTE_SWAP: 0.035, EXECUTE_REBALANCE: 0.035, CONCENTRATION_CHECK: 0.03, EXECUTE_SWAP: 0.03,
  /* The plain risk question is specific: it names the subject and the
     measurement, and the risk engine is the only module that answers it. */
  RISK_OVERVIEW: 0.055,
  CREATE_GOAL: 0.04, GOAL_PLAN: 0.03, BALANCE_QUERY: 0.03, EXECUTE_LEND: 0.025, EXECUTE_BORROW: 0.025,
  PORTFOLIO_ANALYSIS: 0.0, MARKET_OVERVIEW: 0.0, ASSET_ANALYSIS: -0.045, NAVIGATE: -0.02,
  /*
   * The yield surface sits above ASSET_ANALYSIS, because ASSET_ANALYSIS
   * claims the words `yield`, `farm` and `apy` — and a question about a
   * pool's APR is not a question about the crypto market.
   */
  STAKING_REWARD: 0.05, LIQUIDITY_RISK: 0.05, YIELD_OPPORTUNITY: 0.05,
  /* Above MARKET_OVERVIEW, which claims «smart money» and «نهنگ». */
  SMART_MONEY_READ: 0.06,
  /*
   * The fit question is about the OWNER, and the owner is the most
   * specific thing a sentence can name. It sits above the yield question
   * («بهترین ییلد کجاست؟») because that one never mentions «من» — and
   * below nothing, because there is nothing more specific than a fit.
   */
  OPPORTUNITY_FIT: 0.055
});

/**
 * Which venue a request belongs to, from the words only. Returning `null` is a
 * real answer: it means the sentence named no instrument, and the caller must not
 * invent one (§3).
 */
export function instrumentOf(text = '') {
  const t = String(text).toLowerCase();
  if (/\betf\b|\beft\b|صندوق ?etf|etf ?صندوق/.test(t)) return 'etf';
  if (/صندوق (سرمایه|درآمد ثابت|سرمایه‌گذاری|سرمایه گذاری)|\bfund\b|mutual fund/.test(t)) return 'funds';
  if (/stock|سهام|شرکت (آمریکا|امریکا)|\b(aapl|tsla|msft|nvda|spy|qqq)\b|اپل|تسلا|مایکروسافت|انویدیا/.test(t)) return 'stocks';
  if (/forex|فارکس|جفت ?ارز|\beurusd\b|\bdxy\b|\busdjpy\b/.test(t)) return 'forex';
  if (/commodit|کالایی|\bxau\b|\bxag\b|gold|طلا|silver|نقره|oil|نفت|brent|wti|gas ?oil/.test(t)) return 'commodities';
  if (/\brwa\b|real.?world.?asset|tokeniz|توکنایز|صندوق مسدود|ملک|املاک/.test(t)) return 'rwa';
  return null;
}

function followIntent(follow, context) {
  const asset = context.entities?.asset || null;
  switch (follow?.kind) {
    case 'CONFIRM_PENDING': return { intent: 'CONFIRM_PENDING', score: 0.97, requiresAsset: false };
    case 'CANCEL_PENDING': return { intent: 'CANCEL_PENDING', score: 0.95 };
    case 'SELL_LAST_ASSET': return { intent: 'EXECUTE_SWAP', score: 0.9, sellSide: true, asset };
    case 'BUY_LAST_ASSET': return { intent: 'EXECUTE_SWAP', score: 0.85, asset };
    case 'EXECUTE_LAST': return { intent: 'CONFIRM_PENDING', score: 0.88 };
    case 'CAPACITY_QUERY': return { intent: 'BORROW_CAPACITY', score: 0.9 };
    case 'RISK_QUERY': return { intent: 'LOAN_STATUS', score: 0.88 };
    case 'QUERY_LAST_ASSET': return { intent: asset ? 'ASSET_ANALYSIS' : 'MARKET_OVERVIEW', score: 0.7, asset };
    default: return null;
  }
}

const COMPOUND_PATTERNS = [
  /* «… تبدیل کن و بریزد روی آربیتروم» and «… بعدش ببر روی base» are the same request
     in two shapes, so the connector is optional as long as a destination network or
     a bridge verb follows — the destination is what makes it a second leg. */
  { leg: 2, intent: 'EXECUTE_BRIDGE', score: 0.76, test: /((بعد از (خرید|سواپ|تبدیل)|بعدش|سپس|و بعد|بعد|then|after ?that)[^\n]{0,24})?\s*(و\s*)?(به\s+|روی\s+|بریز?د?\s*(روی|به)?\s+|ببر\s*(به|روی)?\s*|منتقل\s*(به|روی)?\s*|پل\s*بزن|bridge\s*(to)?\s*)(arbitrum|arbi\b|base\b|polygon|matic|optimism|bnb chain|bsc\b|avalanche|پل\b|bridge|شبکه)/i },
  { leg: 2, intent: 'EXECUTE_LEND', score: 0.68, test: /(بعد از (خرید|سواپ)|then|سپس).{0,40}(لند|وام بده|supply)/i }
];
/*
 * A COMPARISON IS NOT A COMMAND.
 *
 * The compound patterns are loose on purpose — «برو به شبکه» and
 * «منتقل کن به ...» appear at the end of ordinary sentences, and the
 * connector is optional. But that looseness also catches a QUESTION:
 *
 *   «کدام پل برای انتقال بیت‌کوین به شبکهٔ پالیگان بهتر است؟»
 *
 * contains «انتقال ... به شبکه», so the bridge leg fires and the
 * sentence is read as «buy, then bridge». It is not a command at all —
 * the user is asking WHICH bridge, which is a comparison.
 *
 * The comparison words are the tell. A sentence that asks «کدام»,
 * «بهتر», «ارزان‌تر» or «which/best/cheapest» is asking the product to
 * CHOOSE, and a choice is never a leg of a two-step execution.
 *
 * The guard is here, in the compound detector, rather than in each
 * pattern: it is a property of the sentence, not of one verb.
 */
const COMPARISON_QUESTION = /(کدام|کدوم|چه\s*پل|چند\s*پل|بهتر(?:ین)?|ارزان(?:تر|‌تر)?|سریع(?:تر|‌تر)?|کم\s*هزینه|کم\s*ریسک|رتبه|مقایسه|which|what|best|cheapest|fastest|safest|compare|rank)/i;

function detectCompound(text) {
  /* A comparison asks for a choice; a choice is not an execution leg. */
  if (COMPARISON_QUESTION.test(text)) return [];
  return COMPOUND_PATTERNS.filter((p) => p.test.test(text)).map(({ leg, intent, score }) => ({ leg, intent, score }));
}

/*
 * ─── THE HALF OF THE QUESTION THAT WAS DROPPED ───────────────────────────
 *
 * A person asks two things when they say two things. «قیمت بیت‌کوین
 * چقدره و موجودی من چقدره» is a price question AND a balance
 * question, and the reply has to answer both or admit it answered one.
 *
 * It used to answer one. The classifier picks ONE intent, the planner
 * builds ONE template, and the other half of the sentence vanishes —
 * silently, with a reply that has a headline, a reason, data and a
 * confidence, so nothing in the answer says a half is missing.
 *
 * Measured over six two-part questions: **6 of 12 parts answered.**
 *
 * THE FIX IS NOT A BIGGER CLASSIFIER. It is splitting the SENTENCE and
 * classifying each half, then letting the existing compound machinery
 * merge the two plans.
 *
 * The merging already works — `planner.js` merges the leg templates
 * into ONE plan, with one confirmation gate before the first
 * money-moving step and `dependsOn` still resolving. That was built
 * for «convert, then bridge to Arbitrum». This is the same machinery,
 * reached from a different door.
 *
 * WHAT IS NOT A SECOND PART.
 *
 *   · a comparison — «کدام پل بهتر است؟» is one question about a
 *     choice, not two questions;
 *   · a sentence whose halves are the SAME intent — «پورتفوی و
 *     موجودی من» is one thing asked twice, and two legs would read the
 *     same section twice;
 *   · a half that is not a question at all — «بگو» and «نشان بده»
 *     are instructions about the answer, not parts of the subject.
 */
const CLAUSE_CONNECTOR = /\s+(?:و|همچنین|هم‌?ـ?|و\s+هم|plus|and)\s+/gi;
/* The same connector WITHOUT the global flag, for the one check that only
   asks «is there a conjunction at all». A `g` regex keeps a `lastIndex`
   between calls, and a check whose answer depends on the previous call is
   a check that will pass once and fail the next time. */
const HAS_CLAUSE_CONNECTOR = /\s+(?:و|همچنین|هم‌?ـ?|و\s+هم|plus|and)\s+/i;

/* A half that asks for the FORM of the answer rather than being one. */
const ANSWER_FORM = /^(?:بگو|نشان\s*بده|بگوی|بگید|توضیح\s*بده|در\s*باره|درباره|about\s+the\s+answer|tell\s+me)\b/i;

/**
 * Split a sentence into its two claims, if it has two.
 *
 * @param {string} text the normalized sentence
 * @returns {string[]} one part, or two
 */
function splitClaims(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  /* A comparison asks for a choice. A choice is one question.
     *
     * BUT the comparison words can be inside ONE HALF of a two-part
     * question: «وضعیت بازار چطوره و کدام گزینه مناسب منه» — the second
     * half asks WHICH option fits, and that is a real second claim. So
     * the guard is about the WHOLE sentence: if the sentence has a
     * conjunction, each half is judged on its own, and the comparison
     * words in one half do not dissolve the other half.
     */
  if (COMPARISON_QUESTION.test(t) && !HAS_CLAUSE_CONNECTOR.test(t)) return [t];
  /* Only the conjunction that joins two CLAIMS counts. A sentence with
     no conjunction is one claim, whatever else it contains. */
  const parts = [];
  let rest = t;
  for (;;) {
    CLAUSE_CONNECTOR.lastIndex = 0;
    let cut = null;
    let m;
    while ((m = CLAUSE_CONNECTOR.exec(rest)) !== null) {
      const left = rest.slice(0, m.index).trim();
      const right = rest.slice(m.index + m[0].length).trim();
      /* The conjunction has to be BETWEEN two claims: both sides must
         have content, and the right side must not be an answer-form
         instruction («... و بگو» asks for the answer, it is not a
         second claim). */
      if (left && right && !ANSWER_FORM.test(right) && !ANSWER_FORM.test(left)) {
        cut = { left, right };
        break;
      }
    }
    if (!cut) break;
    parts.push(cut.left);
    rest = cut.right;
  }
  if (!parts.length) return [t];
  parts.push(rest.trim());
  return parts.filter((p) => p && !ANSWER_FORM.test(p));
}

/** Entities are extracted from FOUR places, in priority order, and the origin of
 *  each is kept so a reply can say where a number came from (§43). */
export function extractEntities(message, { context = {}, state = {} } = {}) {
  const text = normalizeText(message);
  const assetsWithPositions = findAssetsWithPositions(text);
  const amounts = extractAmounts(message);
  const refs = context.entities || resolveReferences(message, context.memory, context.page);
  const assets = findAssetsIn(text);
  const networks = findNetworksIn(text);
  /* Direction comes from the WORDS, not from array order: «X رو به Y تبدیل کن» puts
     X first and Y after the preposition, while «از Y به X» inverts it. Picking by
     index would flip a sell into a buy for half the sentences people type. */
  const toByPreposition = /(?:به|برای|به سمت|تبدیل به)\s+([a-z0-9$]{2,6}|[\u0600-\u06FF]{2,12})/i.exec(text);
  /* A quantity written in words («۰.۱ بیت‌کوین») has no ASCII symbol next to the
     number, so the amount regex alone misses it. Pair the nearest number with the
     nearest named asset instead of losing the amount — a lost amount is what makes
     a swap turn into a clarifying question the user has already answered. */
  if (!amounts.amountRaw && amounts.numbers?.length && assetsWithPositions.length) {
    const pairs = amounts.numbers
      .map((n) => {
        const best = assetsWithPositions
          .map((a) => ({ asset: a.asset, gap: Math.min(Math.abs(a.at - n.end), Math.abs(n.at - a.end)) }))
          .sort((x, y) => x.gap - y.gap)[0];
        return best && best.gap <= 24 ? { value: n.value, asset: best.asset, at: n.at } : null;
      })
      .filter(Boolean);
    if (pairs.length) amounts.amountRaw = pairs[0];
  }
  const toSym = toByPreposition ? usableSymbol(toByPreposition[1]) : null;
  const first = assets[0] || null;
  const second = assets[1] || null;
  const fromAsset = amounts.amountRaw?.asset || (toSym && first !== toSym ? first : (second && toSym === second ? first : null)) || (assets.length > 1 ? first : null) || null;
  const toAsset = toSym && toSym !== fromAsset ? toSym : (assets.length > 1 ? assets.find((a) => a !== fromAsset) || null : null);
  const horizon = extractHorizon(message);
  return {
    asset: refs.asset || amounts.amountRaw?.asset || first || null,
    assetOrigin: refs.assetOrigin,
    fromAsset,
    toAsset,
    assets,
    network: networks[0] || refs.network || context.page?.selectedNetwork || null,
    destinationNetwork: networks[networks.length - 1] || null,
    amountUsd: amounts.amountUsd,
    amount: amounts.amountRaw,
    percent: amounts.percent,
    sharePct: amounts.sharePct ?? null,
    assetPositions: assetsWithPositions,
    targetUsd: amounts.targetUsd,
    horizon: horizon.years || horizon.months || horizon.days ? horizon : null,
    side: /فروش|sell/i.test(text) ? 'sell' : (/خرید|buy|purchase/i.test(text) ? 'buy' : null),
    /* Which non-crypto venue the sentence names, decided by the lexicon and never
       by a guess: `null` means the user did not name one. */
    instrument: instrumentOf(text),
    explicit: { ...amounts }
  };
}

/* ── the intent record ─────────────────────────────────────────────────── */
export function createIntent({ message, classification, context, requestId, sessionId, owner, locale, now = Date.now() } = {}) {
  const intentId = requestId ? `intent_${hashString(String(requestId))}` : `intent_${now.toString(36)}_${hashString(`${message}|${now}`)}`;
  return {
    schema: INTENT_SCHEMA,
    brain: CI_SCHEMA,
    intentId,
    requestId: requestId ? String(requestId).slice(0, 128) : null,
    sessionId: sessionId ? String(sessionId).slice(0, 80) : null,
    owner: owner ? String(owner).slice(0, 80) : null,
    userMessage: String(message || '').slice(0, 1200),
    locale: locale === 'fa' || locale === 'en' ? locale : 'en',
    intentType: classification.type,
    confidence: classification.confidence,
    classification: { source: classification.source, evidence: classification.evidence, followUp: classification.followUp },
    entities: classification.entities || {},
    context: {
      route: context?.page?.route || '/', module: context?.page?.module || 'session', tab: context?.page?.tab || null,
      digest: context?.contextDigest || null, missing: context?.missingInformation || []
    },
    requiredModules: classification.definition?.modules || [],
    requiredTools: [],
    plan: [],
    risk: null,
    policy: null,
    results: {},
    confirmationRequired: (classification.definition?.permission || PERMISSION.READ) === PERMISSION.EXECUTE,
    executionRequired: (classification.definition?.permission || PERMISSION.READ) === PERMISSION.EXECUTE,
    verificationRequired: (classification.definition?.permission || PERMISSION.READ) === PERMISSION.EXECUTE,
    executable: classification.executable !== false,
    missingRequires: classification.missingRequires || [],
    status: 'RECEIVED',
    history: [{ state: 'RECEIVED', at: now, reason: 'received' }],
    attempts: 0,
    error: null,
    events: [],
    actions: [],
    createdAt: now,
    updatedAt: now
  };
}

export class IllegalTransition extends Error {
  constructor(from, to) {
    super(`Illegal intent transition ${from} → ${to}`);
    this.name = 'IllegalTransition';
    this.code = 'ILLEGAL_TRANSITION';
    this.from = from;
    this.to = to;
  }
}

/**
 * §32. The legal graph is the point: an intent cannot arrive at EXECUTION
 * without having passed CONFIRMATION, and cannot leave SAFE_STOP at all — a
 * stopped operation that could be nudged forward again is not stopped.
 */
export function transition(intent, next, { reason = '', at = Date.now(), patch = {} } = {}) {
  if (!INTENT_STATES.includes(next)) throw new IllegalTransition(intent.status, next);
  const allowed = INTENT_STATE_TRANSITIONS[intent.status] || [];
  if (!allowed.includes(next)) throw new IllegalTransition(intent.status, next);
  return {
    ...intent,
    status: next,
    updatedAt: at,
    history: [...(intent.history || []), { state: next, at, reason: String(reason).slice(0, 120) }].slice(-40),
    ...patch
  };
}

export function intentStageIndex(intent) {
  return INTENT_STATES.indexOf(intent?.status || 'RECEIVED');
}

/** True once the pipeline has reached or passed a stage — used by the probes. */
export function intentReached(intent, stage) {
  const order = INTENT_STATES.filter((s) => !['COMPLETED', 'ERROR', 'SAFE_STOP', 'CANCELLED', 'DUPLICATE'].includes(s));
  const have = (intent?.history || []).map((h) => h.state);
  return have.includes(stage) || order.indexOf(intent?.status) >= order.indexOf(stage);
}
