/**
 * FBT SMART INTENT OS — AI UPGRADE 5: EVALUATION ENGINE + REGRESSION CORPUS
 * ---------------------------------------------------------------------------
 * A controlled evaluation dataset (§35) spanning Persian, English, mixed
 * language, crypto, trading, wallet, news, risk, greetings, thanks, emotions
 * and ambiguity (§65). `runEvaluation()` replays the corpus through the real
 * question analyzer (planCollaboration) and computes accuracy — this is the
 * regression gate (§66): routing changes must not silently break intent
 * accuracy, greeting handling or web-usage discipline.
 *
 * The corpus is the contract; the analyzer is the code under test. Nothing
 * here calls an AI provider — evaluation is offline, deterministic and cheap.
 */

import { planCollaboration, CONVERSATION_KINDS } from './collaborationRouter.js';
import { clusterQuestion } from './questionIntel.js';

export const EVAL_SCHEMA = 'fbt.ai-evaluation.v5';

/* -------------------------------------------------------------------------- */
/*  CORPUS — representative questions (§65)                                    */
/*  expect fields:                                                            */
/*    kind      conversation kind                                             */
/*    emotion   detected emotion state                                        */
/*    fomo      FOMO must be detected                                         */
/*    freshness STATIC | RECENT | LIVE | BREAKING                             */
/*    maxLevel  collaboration level must NOT exceed this (cost law §45)       */
/*    minLevel  collaboration level must be at least this                     */
/*    needsWeb  web-research decision must equal this                         */
/*    cluster   expected question-intel cluster                               */
/* -------------------------------------------------------------------------- */

export const EVAL_QUESTIONS = Object.freeze([
  /* ── Greetings (§23) — never tools, never web, level 1 ────────────────── */
  { id: 'g01', text: 'سلام', locale: 'fa', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false, cluster: 'GREETING' } },
  { id: 'g02', text: 'سلام خوبی؟', locale: 'fa', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g03', text: 'صبح بخیر', locale: 'fa', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g04', text: 'شب بخیر', locale: 'fa', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g05', text: 'خسته نباشی', locale: 'fa', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g06', text: 'چه خبر؟', locale: 'fa', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g07', text: 'درود بر شما', locale: 'fa', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g08', text: 'hi', locale: 'en', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g09', text: 'hello how are you', locale: 'en', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g10', text: 'good morning', locale: 'en', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g11', text: 'hey there', locale: 'en', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },
  { id: 'g12', text: 'سلام سلام خوبی', locale: 'fa', category: 'Greeting', expect: { kind: 'GREETING', maxLevel: 1, needsWeb: false } },

  /* ── Thanks (§24) — never repeat a full financial explanation ─────────── */
  { id: 't01', text: 'ممنون', locale: 'fa', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false, cluster: 'THANKS' } },
  { id: 't02', text: 'مرسی', locale: 'fa', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false } },
  { id: 't03', text: 'دمت گرم', locale: 'fa', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false } },
  { id: 't04', text: 'خیلی کمک کردی', locale: 'fa', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false } },
  { id: 't05', text: 'عالی بود', locale: 'fa', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false } },
  { id: 't06', text: 'thanks a lot', locale: 'en', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false } },
  { id: 't07', text: 'thank you so much', locale: 'en', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false } },
  { id: 't08', text: 'thx bro', locale: 'en', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false } },
  { id: 't09', text: 'سپاسگزارم', locale: 'fa', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false } },
  { id: 't10', text: 'دستت درد نکنه', locale: 'fa', category: 'Thanks', expect: { kind: 'THANKS', maxLevel: 1, needsWeb: false } },

  /* ── Crypto knowledge (§65) — static, cheap, no web ───────────────────── */
  { id: 'k01', text: 'BTC چیه؟', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k02', text: 'بیت کوین چیست', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k03', text: 'USDT چیست؟', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k04', text: 'تتر یعنی چی', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k05', text: 'what is BTC?', locale: 'en', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k06', text: 'what is a stablecoin', locale: 'en', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k07', text: 'blockchain چگونه کار می‌کند؟', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k08', text: 'halving چیست', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k09', text: 'what is tokenomics', locale: 'en', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k10', text: 'اتریوم چیست', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k11', text: 'defi یعنی چه', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k12', text: 'what is impermanent loss', locale: 'en', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k13', text: 'اثبات کار چیست', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k14', text: 'کیف پول غیرامانی یعنی چی', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k15', text: 'slippage چیست', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k16', text: 'gas fee یعنی چی', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k17', text: 'what is proof of stake', locale: 'en', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },
  { id: 'k18', text: 'لایه دوم چیست', locale: 'fa', category: 'Crypto Knowledge', expect: { freshness: 'STATIC', maxLevel: 2, needsWeb: false } },

  /* ── Market (§15, §65) — live, web helps ──────────────────────────────── */
  { id: 'm01', text: 'چرا بیت کوین امروز افت کرد؟', locale: 'fa', category: 'Market', expect: { freshness: 'LIVE', needsWeb: true, minLevel: 3 } },
  { id: 'm02', text: 'BTC چرا ریخت؟', locale: 'fa', category: 'Market', expect: { freshness: 'LIVE', needsWeb: true, minLevel: 3 } },
  { id: 'm03', text: 'why did Bitcoin drop today?', locale: 'en', category: 'Market', expect: { freshness: 'LIVE', needsWeb: true, minLevel: 3 } },
  { id: 'm04', text: 'بازار امروز چطوره', locale: 'fa', category: 'Market', expect: { freshness: 'LIVE', needsWeb: true } },
  { id: 'm05', text: 'قیمت بیت کوین الان چنده', locale: 'fa', category: 'Market', expect: { freshness: 'LIVE', needsWeb: true, cluster: 'PRICE_CHECK' } },
  { id: 'm06', text: 'why is ethereum up today', locale: 'en', category: 'Market', expect: { freshness: 'LIVE', needsWeb: true } },
  { id: 'm07', text: 'امروز چه اتفاقی تو بازار افتاد', locale: 'fa', category: 'Market', expect: { freshness: 'LIVE', needsWeb: true } },
  { id: 'm08', text: 'eth price now', locale: 'en', category: 'Market', expect: { freshness: 'LIVE', needsWeb: true } },
  { id: 'm09', text: 'بیت کوین این هفته چه وضعی داشت', locale: 'fa', category: 'Market', expect: { freshness: 'RECENT' } },
  { id: 'm10', text: 'recent market news', locale: 'en', category: 'Market', expect: { freshness: 'RECENT' } },
  { id: 'm11', text: 'sol چطوره؟', locale: 'fa', category: 'Market', expect: { cluster: 'MARKET_OUTLOOK' } },
  { id: 'm12', text: 'نظرت درباره بیت کوین چیه', locale: 'fa', category: 'Market', expect: { cluster: 'MARKET_OUTLOOK' } },
  { id: 'm13', text: 'بیت کوین چه وضعیه؟', locale: 'fa', category: 'Market', expect: { cluster: 'MARKET_OUTLOOK' } },
  { id: 'm14', text: 'what is the bitcoin outlook', locale: 'en', category: 'Market', expect: { cluster: 'MARKET_OUTLOOK' } },

  /* ── News (§13, §18) — always web, breaking escalates ─────────────────── */
  { id: 'n01', text: 'اخبار امروز BTC چیست؟', locale: 'fa', category: 'News', expect: { freshness: 'LIVE', needsWeb: true, minLevel: 3 } },
  { id: 'n02', text: 'این خبر روی کریپتو چه تاثیری داره؟', locale: 'fa', category: 'News', expect: { needsWeb: true, minLevel: 3, cluster: 'NEWS_IMPACT' } },
  { id: 'n03', text: 'این خبر همین الان چه اثری دارد؟', locale: 'fa', category: 'News', expect: { freshness: 'BREAKING', needsWeb: true } },
  { id: 'n04', text: 'آیا این خبر می‌تواند باعث ریزش BTC شود؟', locale: 'fa', category: 'News', expect: { complexity: 'COMPLEX', minLevel: 4, needsWeb: true } },
  { id: 'n05', text: 'latest crypto regulation news', locale: 'en', category: 'News', expect: { freshness: 'RECENT', needsWeb: true } },
  { id: 'n06', text: 'خبر فوری بیت کوین', locale: 'fa', category: 'News', expect: { freshness: 'BREAKING', needsWeb: true } },
  { id: 'n07', text: 'just announced etf news impact', locale: 'en', category: 'News', expect: { freshness: 'BREAKING', needsWeb: true } },
  { id: 'n08', text: 'تصمیم نرخ بهره آمریکا روی بازار چه اثری دارد', locale: 'fa', category: 'News', expect: { needsWeb: true, cluster: 'NEWS_IMPACT' } },
  { id: 'n09', text: 'هک صرافی امروز چه تاثیری روی بازار داشت', locale: 'fa', category: 'News', expect: { freshness: 'LIVE', needsWeb: true } },
  { id: 'n10', text: 'what impact does the fed decision have on crypto', locale: 'en', category: 'News', expect: { needsWeb: true, cluster: 'NEWS_IMPACT' } },

  /* ── Risk (§65) ───────────────────────────────────────────────────────── */
  { id: 'r01', text: 'ریسکش چقدره؟', locale: 'fa', category: 'Risk', expect: {} },
  { id: 'r02', text: 'how risky is solana staking', locale: 'en', category: 'Risk', expect: { cluster: 'YIELD_STAKING' } },
  { id: 'r03', text: 'ریسک خرید میم کوین چیه', locale: 'fa', category: 'Risk', expect: {} },
  { id: 'r04', text: 'بدترین سناریو برای پرتفوی من چیه', locale: 'fa', category: 'Risk', expect: { complexity: 'COMPLEX', minLevel: 4 } },
  { id: 'r05', text: 'impermanent loss risk for eth-usdc pool', locale: 'en', category: 'Risk', expect: {} },

  /* ── Portfolio (§65) ──────────────────────────────────────────────────── */
  { id: 'p01', text: 'من BTC دارم؟', locale: 'fa', category: 'Portfolio', expect: { intent: 'tool' } },
  { id: 'p02', text: 'چقدر دارم؟', locale: 'fa', category: 'Portfolio', expect: { cluster: 'WALLET_BALANCE' } },
  { id: 'p03', text: 'پرتفوی من چه ریسکی دارد؟', locale: 'fa', category: 'Portfolio', expect: {} },
  { id: 'p04', text: 'how much do I have in my wallet', locale: 'en', category: 'Portfolio', expect: { cluster: 'WALLET_BALANCE' } },
  { id: 'p05', text: 'کدام دارایی بیشترین سهم را دارد؟', locale: 'fa', category: 'Portfolio', expect: {} },
  { id: 'p06', text: 'what is my portfolio allocation', locale: 'en', category: 'Portfolio', expect: {} },

  /* ── Wallet (§65) ─────────────────────────────────────────────────────── */
  { id: 'w01', text: 'آیا کیف پول من امن است؟', locale: 'fa', category: 'Wallet', expect: { cluster: 'WALLET_SECURITY' } },
  { id: 'w02', text: 'is my wallet safe', locale: 'en', category: 'Wallet', expect: { cluster: 'WALLET_SECURITY' } },
  { id: 'w03', text: 'کلید خصوصی من کجا نگهداری می شود', locale: 'fa', category: 'Wallet', expect: { cluster: 'WALLET_SECURITY' } },
  { id: 'w04', text: 'چطور کیف پولم رو بازیابی کنم', locale: 'fa', category: 'Wallet', expect: { cluster: 'WALLET_SECURITY' } },
  { id: 'w05', text: 'how do I recover my wallet', locale: 'en', category: 'Wallet', expect: { cluster: 'WALLET_SECURITY' } },

  /* ── Trading (§65) — high stakes get level 5 ──────────────────────────── */
  { id: 'x01', text: 'الان چی بخرم؟', locale: 'fa', category: 'Trading', expect: { minLevel: 5, cluster: 'BUY_DECISION' } },
  { id: 'x02', text: 'آیا الان BTC خرید خوبی است؟', locale: 'fa', category: 'Trading', expect: { minLevel: 5 } },
  { id: 'x03', text: 'بخرم یا بفروشم؟', locale: 'fa', category: 'Trading', expect: { minLevel: 5 } },
  { id: 'x04', text: 'should I buy bitcoin now', locale: 'en', category: 'Trading', expect: { minLevel: 5 } },
  { id: 'x05', text: 'is it a good time to invest in eth', locale: 'en', category: 'Trading', expect: { minLevel: 5 } },
  { id: 'x06', text: 'پس بفروشم؟', locale: 'fa', category: 'Trading', expect: { kind: 'QUESTION' } },
  { id: 'x07', text: 'نقطه ورود مناسب برای sol کجاست', locale: 'fa', category: 'Trading', expect: { cluster: 'BUY_DECISION' } },
  { id: 'x08', text: 'همه پولم رو بیت کوین بخرم؟', locale: 'fa', category: 'Trading', expect: { minLevel: 5 } },
  { id: 'x09', text: 'should i sell everything now', locale: 'en', category: 'Trading', expect: { minLevel: 5 } },
  { id: 'x10', text: 'با وام خونه بیت کوین بخرم', locale: 'fa', category: 'Trading', expect: { minLevel: 5 } },

  /* ── Emotional (§25-27, §65) ──────────────────────────────────────────── */
  { id: 'e01', text: 'میترسم ضرر کنم', locale: 'fa', category: 'Emotional', expect: { emotion: 'fearful', cluster: 'RISK_FEAR' } },
  { id: 'e02', text: 'استرس دارم', locale: 'fa', category: 'Emotional', expect: { emotion: 'fearful' } },
  { id: 'e03', text: 'خیلی نگرانم', locale: 'fa', category: 'Emotional', expect: { emotion: 'fearful' } },
  { id: 'e04', text: 'نکنه ضرر کنم؟', locale: 'fa', category: 'Emotional', expect: { emotion: 'fearful' } },
  { id: 'e05', text: 'نمیدونم چیکار کنم', locale: 'fa', category: 'Emotional', expect: { emotion: 'uncertain' } },
  { id: 'e06', text: 'احساس میکنم بازار می‌ریزه', locale: 'fa', category: 'Emotional', expect: { emotion: 'panic' } },
  { id: 'e07', text: 'وای داره می‌ریزه سریع بفروشم؟', locale: 'fa', category: 'Emotional', expect: { emotion: 'panic' } },
  { id: 'e08', text: 'میترسم پولم رو از دست بدم', locale: 'fa', category: 'Emotional', expect: { emotion: 'fearful' } },
  { id: 'e09', text: 'i am scared about the crash', locale: 'en', category: 'Emotional', expect: { emotion: 'panic' } },
  { id: 'e10', text: 'i am worried about my investment', locale: 'en', category: 'Emotional', expect: { emotion: 'fearful' } },
  { id: 'e11', text: 'this app is useless', locale: 'en', category: 'Emotional', expect: { emotion: 'frustrated' } },
  { id: 'e12', text: 'کار نمیکنه لعنتی', locale: 'fa', category: 'Emotional', expect: { emotion: 'frustrated' } },
  { id: 'e13', text: 'گیج شدم نمیفهمم چی شد', locale: 'fa', category: 'Emotional', expect: { emotion: 'confused' } },
  { id: 'e14', text: 'مطمئن نیستم درسته', locale: 'fa', category: 'Emotional', expect: { emotion: 'uncertain' } },

  /* ── FOMO (§27) — flagged, never amplified ────────────────────────────── */
  { id: 'f01', text: 'الان بخرم جا نمونم؟', locale: 'fa', category: 'Emotional', expect: { fomo: true, cluster: 'BUY_DECISION' } },
  { id: 'f02', text: 'همین الان دو برابر میشه؟', locale: 'fa', category: 'Emotional', expect: { fomo: true } },
  { id: 'f03', text: 'نکنه فرصت از دست بره؟', locale: 'fa', category: 'Emotional', expect: { fomo: true } },
  { id: 'f04', text: 'buy now before it pumps 10x', locale: 'en', category: 'Emotional', expect: { fomo: true } },
  { id: 'f05', text: 'dont miss this moon', locale: 'en', category: 'Emotional', expect: { fomo: true } },

  /* ── Intent / Execution (§65) — tools are source of truth ─────────────── */
  { id: 'i01', text: 'بیت کوین بخر', locale: 'fa', category: 'Intent', expect: { kind: 'ACTION', needsWeb: false } },
  { id: 'i02', text: 'ETH رو بفروش', locale: 'fa', category: 'Intent', expect: { kind: 'ACTION', needsWeb: false } },
  { id: 'i03', text: 'اون رو بفروش', locale: 'fa', category: 'Intent', expect: { kind: 'ACTION' } },
  { id: 'i04', text: 'buy 100 USDT of bitcoin', locale: 'en', category: 'Intent', expect: { kind: 'ACTION', needsWeb: false } },
  { id: 'i05', text: 'not ETH I meant BTC', locale: 'en', category: 'Intent', expect: { kind: 'QUESTION' } },
  { id: 'i06', text: 'نه ETH منظورم بود', locale: 'fa', category: 'Intent', expect: {} },
  { id: 'i07', text: 'swap sol to usdt', locale: 'en', category: 'Intent', expect: { kind: 'ACTION', needsWeb: false } },
  { id: 'i08', text: 'چطور USDT بخرم؟', locale: 'fa', category: 'Intent', expect: { cluster: 'USDT_PURCHASE', maxLevel: 3 } },
  { id: 'i09', text: 'با تومان تتر بخرم؟', locale: 'fa', category: 'Intent', expect: { cluster: 'USDT_PURCHASE' } },
  { id: 'i10', text: 'خرید تتر چطوریه؟', locale: 'fa', category: 'Intent', expect: { cluster: 'USDT_PURCHASE' } },

  /* ── Ambiguity (§65) — clarification over guessing (§40) ──────────────── */
  { id: 'a01', text: 'این ارز چیه؟', locale: 'fa', category: 'Ambiguity', expect: { cluster: 'TOKEN_RESEARCH' } },
  { id: 'a02', text: 'این ارز خوبه؟', locale: 'fa', category: 'Ambiguity', expect: {} },
  { id: 'a03', text: 'is this a good coin', locale: 'en', category: 'Ambiguity', expect: {} },
  { id: 'a04', text: 'چرا؟', locale: 'fa', category: 'Ambiguity', expect: { kind: 'FOLLOW_UP' } },
  { id: 'a05', text: 'خب حالا چی؟', locale: 'fa', category: 'Ambiguity', expect: { kind: 'FOLLOW_UP' } },
  { id: 'a06', text: 'why?', locale: 'en', category: 'Ambiguity', expect: { kind: 'FOLLOW_UP' } },
  { id: 'a07', text: 'ادامه بده', locale: 'fa', category: 'Ambiguity', expect: { kind: 'FOLLOW_UP' } },
  { id: 'a08', text: 'tell me more', locale: 'en', category: 'Ambiguity', expect: { kind: 'FOLLOW_UP' } },

  /* ── Mixed language (§53) — must not break intent detection ───────────── */
  { id: 'l01', text: 'BTC رو analyze کن', locale: 'fa', category: 'Mixed Language', expect: {} },
  { id: 'l02', text: 'ETH رو بررسی کن', locale: 'fa', category: 'Mixed Language', expect: {} },
  { id: 'l03', text: 'SOL buy کنم؟', locale: 'fa', category: 'Mixed Language', expect: {} },
  { id: 'l04', text: 'USDT بخر', locale: 'fa', category: 'Mixed Language', expect: { kind: 'ACTION' } },
  { id: 'l05', text: 'bitcoin رو swap کن به usdt', locale: 'fa', category: 'Mixed Language', expect: { kind: 'ACTION' } },
  { id: 'l06', text: 'why did بیت کوین ریخت', locale: 'fa', category: 'Mixed Language', expect: { freshness: 'LIVE' } },
  { id: 'l07', text: 'price اتریوم چنده', locale: 'fa', category: 'Mixed Language', expect: {} },
  { id: 'l08', text: 'check kon sol چطوره', locale: 'fa', category: 'Mixed Language', expect: {} },

  /* ── Persian quality (§52) — slang, typos, units ──────────────────────── */
  { id: 'q01', text: 'بیت چطوره', locale: 'fa', category: 'Persian', expect: { cluster: 'MARKET_OUTLOOK' } },
  { id: 'q02', text: 'بیتکویین امروز چرا ریخت', locale: 'fa', category: 'Persian', expect: { freshness: 'LIVE' } },
  { id: 'q03', text: 'ده تومن تتر بخرم', locale: 'fa', category: 'Persian', expect: {} },
  { id: 'q04', text: 'پنجاه میلیون روی بیت کوین سرمایه گذاری کنم', locale: 'fa', category: 'Persian', expect: {} },
  { id: 'q05', text: '۲۰ درصد ضرر کردم بفروشم', locale: 'fa', category: 'Persian', expect: {} },
  { id: 'q06', text: 'تترر بخر', locale: 'fa', category: 'Persian', expect: { kind: 'ACTION' } },
  { id: 'q07', text: 'اترروم چطوره', locale: 'fa', category: 'Persian', expect: {} },
  { id: 'q08', text: 'سولانا دو برابر میشه؟', locale: 'fa', category: 'Persian', expect: { fomo: true } },

  /* ── English general ──────────────────────────────────────────────────── */
  { id: 'z01', text: 'tell me about the solana project', locale: 'en', category: 'English', expect: { cluster: 'TOKEN_RESEARCH' } },
  { id: 'z02', text: 'how does staking work', locale: 'en', category: 'English', expect: { freshness: 'STATIC', cluster: 'GENERAL_CRYPTO_KNOWLEDGE' } },
  { id: 'z03', text: 'what are the risks of lending', locale: 'en', category: 'English', expect: {} },
  { id: 'z04', text: 'how do i bridge usdc to arbitrum', locale: 'en', category: 'English', expect: { cluster: 'HOW_TO_BRIDGE' } },
  { id: 'z05', text: 'how do i swap tokens here', locale: 'en', category: 'English', expect: { cluster: 'HOW_TO_SWAP' } },
  { id: 'z06', text: 'what fees does fbt charge', locale: 'en', category: 'English', expect: { cluster: 'FEES' } },
  { id: 'z07', text: 'is fbt safe to use', locale: 'en', category: 'English', expect: { cluster: 'WALLET_SECURITY' } },
  { id: 'z08', text: 'my transaction is stuck pending', locale: 'en', category: 'English', expect: { cluster: 'SUPPORT_ISSUE' } },
  { id: 'z09', text: 'set up dca for bitcoin', locale: 'en', category: 'English', expect: { kind: 'ACTION' } },
  { id: 'z10', text: 'what do smart money wallets do', locale: 'en', category: 'English', expect: { cluster: 'SIGNALS_SMART_MONEY' } },

  /* ── DeFi / Solana / Signals / Smart Money ────────────────────────────── */
  { id: 'd01', text: 'بهترین استخر استیکینگ چیه', locale: 'fa', category: 'DeFi', expect: { cluster: 'YIELD_STAKING' } },
  { id: 'd02', text: 'apy farms are they safe', locale: 'en', category: 'DeFi', expect: { cluster: 'YIELD_STAKING' } },
  { id: 'd03', text: 'tvl یعنی چی و کجا ببینمش', locale: 'fa', category: 'DeFi', expect: { cluster: 'TOKEN_RESEARCH' } },
  { id: 'd04', text: 'روی سولانا استیک کنم بهتره یا لن딩', locale: 'fa', category: 'Solana', expect: { cluster: 'YIELD_STAKING' } },
  { id: 'd05', text: 'notional whale flows on solana', locale: 'en', category: 'Solana', expect: {} },
  { id: 'd06', text: 'سیگنال امروز چیه', locale: 'fa', category: 'Signals', expect: { cluster: 'SIGNALS_SMART_MONEY' } },
  { id: 'd07', text: 'نهنگ ها دارن چی کار میکنن', locale: 'fa', category: 'Smart Money', expect: { cluster: 'SIGNALS_SMART_MONEY' } },
  { id: 'd08', text: 'what are the whales buying', locale: 'en', category: 'Smart Money', expect: { cluster: 'SIGNALS_SMART_MONEY' } },

  /* ── Errors / support ─────────────────────────────────────────────────── */
  { id: 's01', text: 'تراکنشم ناموفق بود', locale: 'fa', category: 'Errors', expect: { cluster: 'SUPPORT_ISSUE' } },
  { id: 's02', text: 'swap failed with error', locale: 'en', category: 'Errors', expect: { cluster: 'SUPPORT_ISSUE' } },
  { id: 's03', text: 'کارمزد خیلی زیاد بود', locale: 'fa', category: 'Errors', expect: { cluster: 'FEES' } },
  { id: 's04', text: 'app crashes when i open wallet', locale: 'en', category: 'Errors', expect: { cluster: 'SUPPORT_ISSUE' } }
]);

/* -------------------------------------------------------------------------- */
/*  EVALUATION RUNNER (§35)                                                    */
/* -------------------------------------------------------------------------- */

function checkOne(question, { analyzer = planCollaboration, clusterer = clusterQuestion } = {}) {
  const failures = [];
  const expect = question.expect || {};
  const ctx = { priorIntent: expect.kind === 'FOLLOW_UP' ? 'MARKET_ANALYSIS' : null };
  const analysis = analyzer({ message: question.text, locale: question.locale, ...ctx });

  if (expect.kind && analysis.conversationKind !== expect.kind) {
    failures.push(`kind: expected ${expect.kind}, got ${analysis.conversationKind}`);
  }
  if (expect.emotion && analysis.emotion.state !== expect.emotion) {
    failures.push(`emotion: expected ${expect.emotion}, got ${analysis.emotion.state}`);
  }
  if (expect.fomo === true && !analysis.fomo.detected) {
    failures.push('fomo: expected detection, got none');
  }
  if (expect.freshness && analysis.freshness !== expect.freshness) {
    failures.push(`freshness: expected ${expect.freshness}, got ${analysis.freshness}`);
  }
  if (expect.maxLevel != null && analysis.level > expect.maxLevel) {
    failures.push(`level: ${analysis.level} exceeds max ${expect.maxLevel}`);
  }
  if (expect.minLevel != null && analysis.level < expect.minLevel) {
    failures.push(`level: ${analysis.level} below min ${expect.minLevel}`);
  }
  if (expect.needsWeb != null && analysis.needsWeb !== expect.needsWeb) {
    failures.push(`needsWeb: expected ${expect.needsWeb}, got ${analysis.needsWeb}`);
  }
  if (expect.complexity && analysis.complexity !== expect.complexity) {
    failures.push(`complexity: expected ${expect.complexity}, got ${analysis.complexity}`);
  }
  if (expect.cluster) {
    const c = clusterer(question.text);
    if (c.clusterId !== expect.cluster) {
      failures.push(`cluster: expected ${expect.cluster}, got ${c.clusterId}`);
    }
  }
  return failures;
}

/**
 * Run the full regression corpus. Returns per-question results plus per-category
 * accuracy. The deployment gate (§66) compares accuracy against the previous
 * run: routing changes that lower intent accuracy do not ship.
 */
export function runEvaluation({ analyzer = planCollaboration, clusterer = clusterQuestion, questions = EVAL_QUESTIONS } = {}) {
  const byCategory = {};
  const failures = [];
  let passed = 0;

  for (const q of questions) {
    const qFailures = checkOne(q, { analyzer, clusterer });
    const cat = q.category || 'Other';
    byCategory[cat] = byCategory[cat] || { total: 0, passed: 0, failures: [] };
    byCategory[cat].total += 1;
    if (qFailures.length === 0) {
      passed += 1;
      byCategory[cat].passed += 1;
    } else {
      failures.push({ id: q.id, text: q.text, category: cat, failures: qFailures });
      byCategory[cat].failures.push({ id: q.id, failures: qFailures });
    }
  }

  const total = questions.length;
  return {
    schema: EVAL_SCHEMA,
    total,
    passed,
    failed: total - passed,
    accuracy: total ? Number((passed / total).toFixed(4)) : 0,
    byCategory,
    failures,
    ranAt: Date.now()
  };
}

/** Category coverage required by §35 — the corpus must span all of these. */
export const REQUIRED_EVAL_CATEGORIES = Object.freeze([
  'Greeting', 'Crypto Knowledge', 'Market', 'News', 'Risk', 'Portfolio',
  'Wallet', 'Trading', 'Intent', 'Emotional', 'Ambiguity', 'Persian',
  'English', 'Mixed Language', 'DeFi', 'Solana', 'Signals', 'Smart Money', 'Errors'
]);

export function validateCorpusCoverage(questions = EVAL_QUESTIONS) {
  const present = new Set(questions.map((q) => q.category));
  const missing = REQUIRED_EVAL_CATEGORIES.filter((c) => !present.has(c));
  return { ok: missing.length === 0, total: questions.length, missing, categories: [...present].sort() };
}
