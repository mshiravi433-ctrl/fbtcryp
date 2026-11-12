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
  GOAL_PLAN: { modules: ['goals', 'portfolio', 'forecast', 'risk', 'profit-plan'], permission: PERMISSION.READ },
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
  'FUTURES_RISK', 'LOAN_STATUS', 'BORROW_CAPACITY',
  'EXECUTE_LEND', 'EXECUTE_BORROW', 'EXECUTE_REPAY', 'EXECUTE_REBALANCE',
  'CREATE_GOAL', 'SET_ALERT', 'INSTRUMENT_QUERY'
]));

const RULES = Object.freeze([
  { intent: 'PORTFOLIO_ANALYSIS', patterns: [/پرتفوی|پورتفوی|سبد (سرمایه|من)|portfolio|holdings|ارزش (کیف|سبد)|ریسک (من|پرتفوی|سبد)|ارزیابی ریسک|my risk|risk (assessment|check|level)/i], requires: ['portfolio'] },
  { intent: 'CONCENTRATION_CHECK', patterns: [/زیاد (دارم|است|داری)|تمرکز|concentration|too much|比重|تک‌دارایی|تک دارایی/i], requires: ['portfolio'] },
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
  { intent: 'QUOTE_SWAP', patterns: /نرخ (تبدیل|سواپ)|چند می ?ده(?:د)?|quote|قیمت (تبدیل|خرید|فروش)/i, requires: ['markets'] },
  { intent: 'EXECUTE_SWAP', patterns: [/تبدیلش? (کن|کنید|بکن|بده|بدهید)|سواپ|\bswap\b|convert .* to|\bexchange .* for|(بفروشش|بفروشمش|بفروش|بفرست|بخرمش|بخرش|بخرم?|بخرید|فروش بزن|خرید بزن|\bsell\b|\bbuy\b|\bpurchase\b|قصد خرید|دنبال خرید)/i], requires: ['wallet'] },
  { intent: 'EXECUTE_BRIDGE', patterns: /به (آربیتروم|آربیتروm ?one|آربیتروم one|arbitrum|پالیگان|بیس|اپتیمیزم|اربیترم)|منتقل کن به|برو به شبکه|\bbridge\b|پل بزن|ببر (به|روی)|\bmove\b .{0,24}\bto\b|\btransfer\b .{0,24}\bto\b/i, requires: ['wallet'] },
  { intent: 'EXECUTE_BORROW', patterns: /وام.{0,16}(بگیر|گرفتن|دریافت کن)|borrow (me|some)?|بخوام بگیرم/i, requires: ['lending'] },
  { intent: 'EXECUTE_LEND', patterns: /سپرده.{0,16}(گذاری|بگذار|کن|کنید|بذار|بذارید)|لند (کن|کنید)|\blend\b|\bsupply\b|\bdeposit\b/i, requires: ['lending'] },
  { intent: 'EXECUTE_REPAY', patterns: /بدهی.{0,16}(را |رو )?بده|بازپرداخت (وام )?(کن|بکن)?|قسط (بده|ردیف)|repay (my |the )?(loan|debt|position)|\brepay\b/i, requires: ['lending'] },
  { intent: 'EXECUTE_REBALANCE', patterns: /ری[\s\u200c]?بالانس|ریبالانس|متعادل (کردن|کن)|توزیع مجدد|rebalance/i, requires: ['portfolio'] },
  { intent: 'CREATE_GOAL', patterns: /هدف (جدید|بساز|ثبت|-set)|create (a |new )?goal|هدفم رو ثبت/i, requires: [] },
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
  { intent: 'NAVIGATE', patterns: [/برو به (صفحه )?|نمایش بده|باز کن|open (the )?[\w\u0600-\u06FF]+ page|navigate|show me the/i], requires: [] }
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
  globalIntel: 'global-intel', opportunityFit: 'opportunity-fit'
});
function SERVE_UNAVAILABLE(context, section) {
  const caps = context?.capabilities;
  if (!caps || typeof caps !== 'object') return false;
  const status = caps[SECTION_OWNER[section] || section];
  return status === 'UNAVAILABLE' || status === 'INCOMPLETE';
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
  const hits = [];
  for (const rule of RULES) {
    if (rule.intent === 'EXECUTE_SWAP' && (isDistress || isDiscovery)) continue;
    /* Two shapes are allowed on purpose: one RegExp per rule, or an array of
       alternatives. Normalising here (instead of demanding one style) is what
       keeps a lexicon editable — and a lexicon that is painful to edit is a
       lexicon where a missed phrasing becomes "I did not understand you". */
    const patterns = Array.isArray(rule.patterns) ? rule.patterns : [rule.patterns];
    const hit = patterns.some((p) => p.test(text));
    if (!hit) continue;
    /* An intent is NOT downgraded for state we have not fetched yet — fetching is
       the brain's job, and on a cold session everything would look impossible,
       which quietly ranks «هدف بساز» (needs nothing) above a real market question.
       It is downgraded only when the module that owns the data is genuinely
       UNAVAILABLE or INCOMPLETE, because then no amount of fetching helps. */
    const unavailable = (rule.requires || []).filter((k) => SERVE_UNAVAILABLE(context, k));
    const needsFetch = (rule.requires || []).filter((k) => !context.stateHas?.[k]);
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
  if (isDistress || isDiscovery) {
    const unavailable = SERVE_UNAVAILABLE(context, 'markets') ? ['markets'] : [];
    hits.push({
      intent: 'MARKET_OVERVIEW',
      missingRequires: unavailable,
      needsFetch: context.stateHas?.markets ? [] : ['markets'],
      avail: unavailable.length ? 0.45 : 0.75,
      priority: 0.08,
      score: unavailable.length ? 0.48 : 0.85
    });
  }
  /* A follow-up rewrites the intent, because in a conversation the referent IS
     the intent: «بفروشم؟» after a BTC analysis is a swap quote on BTC, not a
     generic question about selling. */
  /*
   * ── AN EXPLICIT INTENT BEATS A FOLLOW-UP (2026-11-12) ─────────────────
   *
   * This is the second half of the yield-surface fix, and it is the half
   * that does NOT show up in a unit test of the classifier.
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

  /* Multi-step compound requests: «بعد از خرید به Arbitrum ببر» must become ONE
     intent whose plan has both legs, not two turns that race each other. */
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
    compound: compound.length ? compound.map((c) => ({ intent: c.intent, leg: c.leg })) : null,
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
  QUOTE_SWAP: 0.035, EXECUTE_REBALANCE: 0.035, CONCENTRATION_CHECK: 0.03, EXECUTE_SWAP: 0.03,
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
function detectCompound(text) {
  return COMPOUND_PATTERNS.filter((p) => p.test.test(text)).map(({ leg, intent, score }) => ({ leg, intent, score }));
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
