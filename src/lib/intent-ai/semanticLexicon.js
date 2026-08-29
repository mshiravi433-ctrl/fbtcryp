/**
 * FBT INTENT AI — SEMANTIC LEXICON
 * ---------------------------------------------------------------------------
 * The vocabulary an agent needs in order to understand a customer who does not
 * speak in tickers and English verbs.
 *
 * Everything here is DATA, not logic, and none of it moves money. It exists so
 * the understanding layer can stay a transparent, auditable table a reviewer
 * can read top to bottom — the same reason `intentParser.js` is a rule engine
 * rather than an LLM call. If a customer's sentence is understood, it is
 * because a word in this file matched, and an audit can say which one.
 *
 * Twelve UI languages are covered, matching `parserLocales.js`. The asset table
 * is intentionally broader than the tickers the product can route today: a
 * customer who says "کاردانو" is understood and then told honestly whether
 * that asset is reachable, which is different from not understanding them.
 */

import { FUTURES_ACTION_STEMS, SPECULATE_RISK_STEMS } from './speculativeLexicon.js';

export const LEXICON_SCHEMA = 'fbt.semantic-lexicon.v1';

/* -------------------------------------------------------------------------- */
/*  ASSETS                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Canonical ticker → every name a real customer types for it.
 * Keys are matched case-insensitively after stripping punctuation and the
 * Persian/Arabic ZWNJ, so 'bit-coin' and 'بیت‌کوین' both land on BTC.
 */
export const ASSET_NAMES = Object.freeze({
  BTC: ['btc', 'bitcoin', 'bit coin', 'xbt',
    'بیت کوین', 'بیتکوین', 'بیت‌کوین', 'بیت کویین', 'بیتکویین', 'بیتکوین',
    'بيتكوين', 'بيت كوين', 'بيتكوين',
    'биткоин', 'биткойн', '比特币', 'बिटकॉइन', 'بٹ کوائن',
    'bitcoin', 'bitcoín', 'биткоїн'],
  ETH: ['eth', 'ether', 'ethereum',
    'اتر', 'اتریوم', 'اتریم', 'اثیر', 'اترییوم',
    'إيثيريوم', 'ايثيريوم', 'إثيريوم', 'ايثر',
    'эфириум', '以太坊', 'इथेरियम', 'ایتھر', 'eth', 'éter', 'eter', 'イーサリアム'],
  USDT: ['usdt', 'tether', 'usd t',
    'تتر', 'تتر تومان', 'تثر',
    'تيثر', 'تيذر', 'тезер', '泰达币', 'टेदर', 'ٹیڈر', 'usdt', 'tether'],
  USDC: ['usdc', 'usd coin', 'circle usd',
    'یو اس دی سی', 'یواس‌دی‌سی', 'يو اس دي سي', 'usdс', 'usdc'],
  DAI: ['dai', 'دای', 'دائي', 'dai'],
  SOL: ['sol', 'solana',
    'سولانا', 'سلانا', 'سولان',
    'سولانا', 'солана', '索拉纳', 'सोलाना', 'سولانہ', 'sólana'],
  BNB: ['bnb', 'bnb coin', 'binance coin', 'binancecoin',
    'بایننس کوین', 'بایننس', 'بينانس', 'بنا‌نس', 'bnb'],
  ARB: ['arb', 'arbitrum token', 'arbitrum',
    'آربیتروم', 'اربیتروم', 'آربیتروم', 'arbitrum'],
  OP: ['op', 'optimism token', 'optimism',
    'آپتیمیزم', 'اپتیمیزم', 'اوپتیمیزم', 'optimism'],
  MATIC: ['matic', 'pol', 'polygon token', 'polygon',
    'پالیگان', 'پالی‌گان', 'متیک', 'بولیجون', 'полигон', '波场'],
  AVAX: ['avax', 'avalanche',
    'آوالانچ', 'اولانچ', 'آوالانش', 'avalanche'],
  TRX: ['trx', 'tron',
    'ترون', 'ترونیکس', 'ترون', 'tron'],
  TON: ['ton', 'toncoin',
    'تون', 'تون کوین', 'تونکوین', 'toncoin'],
  ADA: ['ada', 'cardano',
    'کاردانو', 'کاردان', 'كارданو', 'كارديدانو', 'cardano'],
  DOGE: ['doge', 'dogecoin', 'doge coin',
    'دوج کوین', 'دوج', 'دوج‌کوین', 'دوجكوين', 'догикоин', 'dogecoin'],
  XRP: ['xrp', 'ripple',
    'ریپل', 'ریپپل', 'ایکس آر پی', 'اكس ار بي', '리플', 'ripple'],
  LTC: ['ltc', 'litecoin',
    'لایت کوین', 'لایتکوین', 'لايت كوين', 'litecoin'],
  DOT: ['dot', 'polkadot',
    'پولکادات', 'پولکادوت', 'بولكادوت', 'polkadot'],
  LINK: ['link', 'chainlink', 'chain link',
    'چین لینک', 'چینلینک', 'تشينلينك', 'chainlink'],
  FBT: ['fbt', 'fbt token', 'fbt coin', 'اف‌بی‌تی', 'fbt'],
  // Iranian-market reality: users price everything in toman/rial and want to
  // end up in a stablecoin. Understanding the word is not the same as offering
  // a toman rail, and the planner says so honestly.
  USD: ['usd', 'dollar', 'dollars', 'bucks',
    'دلار', 'دالر', 'دولار', 'دلار آمریکا',
    'دولار', 'دولارات', 'доллар', '美元', 'डॉलर', 'ڈالر', 'dólar', 'dólares']
});

/** Flat alias → ticker index, built once. */
export const ASSET_ALIAS_INDEX = (() => {
  const index = new Map();
  for (const [symbol, names] of Object.entries(ASSET_NAMES)) {
    for (const raw of names) {
      const key = normalizeWord(raw);
      if (key && !index.has(key)) index.set(key, symbol);
    }
  }
  return index;
})();

/** Tickers the product can actually quote and route right now. */
export const ROUTABLE_ASSETS = Object.freeze([
  'BTC', 'ETH', 'USDT', 'USDC', 'DAI', 'SOL', 'BNB', 'ARB', 'OP',
  'MATIC', 'AVAX', 'TRX', 'TON', 'ADA', 'DOGE', 'XRP', 'LTC', 'DOT', 'LINK'
]);

export const STABLE_TICKERS = Object.freeze(['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD']);

/* -------------------------------------------------------------------------- */
/*  ACTIONS                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * action → { keywords, kind }
 *
 * Persian verbs arrive conjugated: خرید/بخر/بخرم/بخرید/خریدم all mean buy, and
 * فروختن/بفروش/بفروشم all mean sell. The table lists the stems a customer
 * actually types; matching is substring-aware for Persian/Arabic because those
 * scripts have no \b word boundary that a JS regex can use.
 */
export const ACTION_LEXICON = Object.freeze([
  {
    action: 'buy', kind: 'swap', direction: 'buy',
    keywords: ['buy', 'purchase', 'acquire', 'go long', 'long', 'accumulate', 'add to', 'pick up', 'invest in', 'put into', 'put money in'],
    cjk: ['买入', '购买'],
    // Persian/Arabic are matched by stem, not whole word.
    stems: ['خرید', 'بخر', 'خریدم', 'خریدار', 'لانگ', 'شراء', 'اشتر', 'اشتري', 'شرا', 'купить', 'покупа', 'al', 'satın', 'comprar', 'acheter', 'beli', 'खरीद', 'خریدیں']
  },
  {
    action: 'sell', kind: 'swap', direction: 'sell',
    keywords: ['sell', 'short', 'go short', 'exit', 'dump', 'close position', 'cash out', 'cashout', 'cash me out', 'cash us out', 'take profit', 'get out of', 'liquidate', 'into stablecoins', 'to stablecoins'],
    cjk: ['卖出'],
    stems: ['فروش', 'بفروش', 'فروختم', 'شورت', 'بيع', 'بِع', 'прода', 'sat', 'vender', 'vendre', 'jual', 'बेच', 'فروخت']
  },
  {
    action: 'swap', kind: 'swap',
    keywords: ['swap', 'exchange', 'convert', 'trade', 'switch', 'change into', 'turn into', 'swap out'],
    cjk: ['兑换', '交换'],
    stems: ['تبدیل', 'مبادله', 'تعویض', 'عوض', 'تبدیلش', 'ببر', 'بده', 'بگیر', 'انتقال بده', 'تبديل', 'обмен', 'обменя', 'takas', 'değiştir', 'cambiar', 'intercambiar', 'échanger', 'echanger', 'tukar', 'trocar', 'बदल']
  },
  {
    action: 'bridge', kind: 'bridge',
    keywords: ['bridge', 'cross-chain', 'cross chain', 'move to another chain', 'transfer across'],
    cjk: ['跨链'],
    stems: ['پل زدن', 'پل بزن', 'بریج', 'انتقال بین', 'جسر', 'мост', 'köprü', 'puente', 'ponte']
  },
  {
    action: 'send', kind: 'send',
    keywords: ['send', 'transfer', 'pay', 'withdraw to', 'move to my', 'wire'],
    cjk: ['发送', '转账'],
    stems: ['ارسال', 'بفرست', 'واریز', 'انتقال بده', 'إرسال', 'отправить', 'gönder', 'enviar', 'envoyer', 'kirim', 'भेज']
  },
  {
    action: 'farm', kind: 'defi',
    keywords: ['farm', 'stake', 'staking', 'yield', 'lp', 'add liquidity', 'provide liquidity', 'earn interest', 'earn yield', 'put to work'],
    cjk: [],
    stems: ['استیک', 'فارم', 'سود دهی', 'سوددهی', 'نقدشوندگی', 'تامین نقدینگی', 'تحصیل', 'стейк', 'stake', 'kazanç']
  },
  {
    action: 'defi', kind: 'defi',
    keywords: ['defi', 'lend', 'borrow', 'supply', 'deposit', 'collateral'],
    cjk: [],
    stems: ['دیفای', 'وام', 'قرض', 'سپرده', 'إقراض', 'дефи', 'ödünç']
  },
  {
    /*
     * The Persian/Arabic stems come from speculativeLexicon.js, which the
     * store build replaces with an empty stub — that build has no margin
     * venue, so it has nothing here to recognise. See the note at the top of
     * that file for why the words cannot simply live in this table.
     */
    action: 'futures', kind: 'futures',
    keywords: ['futures', 'perp', 'perps', 'perpetual', 'perpetuals', 'leverage', 'leveraged', 'margin', 'contract'],
    cjk: [],
    stems: [...FUTURES_ACTION_STEMS]
  },
  {
    action: 'dydx', kind: 'futures', keywords: ['dydx', 'd y d x'], cjk: [], stems: []
  },
  {
    action: 'analyze', kind: 'analysis',
    keywords: ['analyze', 'analyse', 'analysis', 'research', 'look at', 'check', 'review', 'what about', 'how about', 'tell me about', 'is it a good', 'should i', 'compare', 'versus', 'vs', 'better'],
    cjk: ['分析'],
    stems: ['تحلیل', 'بررسی', 'چطور', 'چگونه', 'بهتره', 'نظرت', 'تحليل', 'анализ', 'analiz', 'analizar', 'analyser', 'analisis', 'विश्लेषण']
  },
  {
    action: 'portfolio', kind: 'analysis',
    keywords: ['portfolio', 'wallet', 'holdings', 'balance', 'my assets', 'what do i own', 'net worth', 'performance'],
    cjk: ['投资组合'],
    stems: ['موجودی', 'دارایی', 'سبد', 'پرتفوی', 'کیف پولم', 'محفظة', 'портфель', 'portföy', 'cartera', 'portefeuille', 'portofolio']
  },
  {
    action: 'news', kind: 'analysis',
    keywords: ['news', 'signal', 'headline', 'what is happening', 'whats happening', 'market update'],
    cjk: [],
    stems: ['اخبار', 'خبر', 'سیگنال', 'أخبار', 'новости', 'haber']
  },
  {
    action: 'goal', kind: 'goal',
    keywords: ['goal', 'target', 'aim', 'objective', 'want to reach', 'want to make', 'return of', 'profit of', 'grow', 'growth', 'double', 'triple', 'multiply'],
    cjk: ['目标'],
    stems: ['هدف', 'سود کنم', 'سود کردن', 'رشد کنه', 'رشد', 'هدف', 'цель', 'hedef', 'objetivo', 'objectif', 'sasaran', 'लक्ष्य']
  },
  {
    action: 'conversation', kind: 'conversation', subType: 'greeting',
    keywords: ['good morning', 'good evening', 'good afternoon'],
    cjk: [],
    stems: ['سلام', 'درود', 'مرحبا', 'اهلاً', 'أهلا', 'привет', 'merhaba', 'hola', 'bonjour', 'नमस्ते']
  },
  {
    action: 'conversation', kind: 'conversation', subType: 'thanks',
    keywords: ['thanks', 'thank you', 'cheers', 'appreciate it'],
    cjk: [],
    stems: ['ممنون', 'تشکر', 'مرسی', 'سپاس', 'شكرا', 'شکرا', 'спасибо', 'teşekkür', 'gracias', 'merci']
  },
  {
    action: 'conversation', kind: 'conversation', subType: 'goodbye',
    keywords: ['bye', 'goodbye', 'see you', 'later'],
    cjk: [],
    stems: ['خداحافظ', 'بدرود', 'وداعا', 'مع السلامة', 'пока', 'güle', 'adiós']
  }
]);

/* -------------------------------------------------------------------------- */
/*  OBJECTIVES — what the customer is actually trying to achieve               */
/* -------------------------------------------------------------------------- */

/**
 * A customer who says "I want my money to grow" has given an objective, not an
 * order. Objectives are what let the planner propose something useful instead
 * of asking five questions.
 */
export const OBJECTIVE_LEXICON = Object.freeze([
  {
    objective: 'preserve',
    rank: 1,
    keywords: ['safe', 'safety', 'secure', 'protect', 'preserve', 'capital preservation', 'no risk', 'low risk', 'risk free', 'risk-free', 'stable', 'hedge', 'inflation', 'dont lose', "don't lose", 'not lose', 'keep value', 'store of value', 'peace of mind'],
    stems: ['امن', 'ایمن', 'حفظ', 'کم ریسک', 'بدون ریسک', 'بی‌ریسک', 'بی ریسک', 'ارزشش کم نشه', 'از دست نره', 'سرمایه‌ام حفظ', 'سرمایه ام حفظ', 'تورم', 'آمن', 'حفاظ', 'безопасн', 'сохран', 'güvenli', 'seguro', 'sûr', 'aman', 'सुरक्षित']
  },
  {
    objective: 'income',
    rank: 2,
    keywords: ['passive income', 'monthly income', 'yield', 'interest', 'cash flow', 'cashflow', 'dividend', 'earn on', 'make my money work', 'steady return', 'regular income', 'rent'],
    stems: ['سود ماهانه', 'درآمد ماهانه', 'درآمد غیرفعال', 'سود روزانه', 'سود ثابت', 'سود بگیرم', 'سود بگیر', 'دنبال سود', 'سود هستم', 'پول کار کنه', 'پولم کار کنه', 'درآمد', 'دخل شهري', 'أرباح شهرية', 'пассивный', 'процент', 'pasif gelir', 'ingreso', 'revenu', 'pendapatan', 'आय']
  },
  {
    objective: 'growth',
    rank: 3,
    keywords: ['grow', 'growth', 'appreciate', 'capital gain', 'long term', 'accumulate', 'build wealth', 'make profit', 'profit', 'returns', 'upside', 'moon', 'outperform', 'beat inflation'],
    stems: ['رشد', 'رشد کنه', 'بزرگ بشه', 'سرمایه‌گذاری', 'سرمایه گذاری', 'بلندمدت', 'بلند مدت', 'سود کنم', 'سود دهی', 'بازدهی', 'نمو', 'عائد', 'рост', 'прибыл', 'büyü', 'crecer', 'croissance', 'tumbuh', 'वृद्धि']
  },
  {
    objective: 'speculate',
    rank: 4,
    keywords: ['quick profit', 'fast money', 'high risk', 'high reward', 'aggressive', 'yolo', 'all in', 'leverage it', 'moonshot', 'bet on', 'gamble', 'short term pump', 'pump'],
    stems: ['ریسک بالا', 'ریسکش بالا', 'سود سریع', 'سود بالا', 'یک شبه', 'یه شبه', 'میخوام بترکونم', 'مخاطرة', 'риск', 'yüksek risk', 'riesgo alto', 'risque élevé', ...SPECULATE_RISK_STEMS]
  },
  {
    objective: 'learn',
    rank: 0,
    keywords: ['beginner', 'new to crypto', 'new here', 'just starting', 'how do i start', 'teach me', 'explain', 'i dont know', "i don't know", 'guide me', 'what should i do', 'not sure', 'help me decide', 'no idea'],
    stems: ['تازه وارد', 'تازه‌کار', 'مبتدی', 'نمیدونم', 'نمی‌دونم', 'بلد نیستم', 'راهنمایی', 'راهنماییم', 'از کجا شروع', 'چیکار کنم', 'چی کار کنم', 'مبتدئ', 'جديد', 'новичок', 'yeni', 'principiante', 'débutant', 'pemula', 'शुरुआत']
  }
]);

/* -------------------------------------------------------------------------- */
/*  RISK STANCE                                                                */
/* -------------------------------------------------------------------------- */

export const RISK_LEXICON = Object.freeze({
  low: {
    keywords: ['safe', 'low risk', 'no risk', 'risk free', 'risk-free', 'conservative', 'careful', 'cautious', 'not risky', 'no risky', 'avoid risk', 'protect capital'],
    stems: ['کم‌ریسک', 'کم ریسک', 'بدون ریسک', 'بی‌ریسک', 'ریسک نکن', 'ریسک نکنم', 'محتاط', 'امن', 'ایمن', 'منخفض المخاطر', 'низкий риск', 'düşük risk', 'bajo riesgo']
  },
  medium: {
    keywords: ['balanced', 'moderate risk', 'medium risk', 'some risk', 'middle ground'],
    stems: ['متعادل', 'متوسط', 'ریسک متوسط', 'معتدل', 'умерен', 'orta risk', 'riesgo medio']
  },
  high: {
    keywords: ['high risk', 'aggressive', 'risk it', 'i accept risk', 'all in', 'yolo', 'max leverage', 'go big', 'no fear'],
    stems: ['حاضرم ریسک کنم', 'ریسک میکنم', 'ریسک می‌کنم', 'ریسک بالا', 'پرریسک', 'پر ریسک', 'مخاطرة عالية', 'высокий риск', 'yüksek risk', 'riesgo alto', 'haut risque']
  }
});

/* -------------------------------------------------------------------------- */
/*  RELATIVE AMOUNTS — "half of my money" is a number the agent can compute    */
/* -------------------------------------------------------------------------- */

export const FRACTION_LEXICON = Object.freeze([
  { pct: 100, keywords: ['all', 'everything', 'whole', 'entire', 'full amount', 'my whole', 'all of it', 'cash me out', 'liquidate everything'],
    stems: ['همه', 'همه‌اش', 'همه اش', 'تمام', 'کل', 'کل موجودی', 'کل پولم', 'همه‌چیز', 'همه چی', 'همه موجودی', 'همه‌ی', 'كل', 'جميع', 'всё', 'все', 'tamamı', 'todo', 'tout', 'semua', 'सब'] },
  { pct: 75, keywords: ['three quarters', '75 percent'], stems: ['سه چهارم', '۷۵ درصد', 'ثلاثة أرباع', '75 процентов'] },
  { pct: 50, keywords: ['half', 'one half', '50 percent'], stems: ['نصف', 'نیمی', 'نیم', 'نصفش', 'نصف پولم', 'نصف دارایی', 'نصفه', 'نصف', 'половина', 'yarısı', 'mitad', 'moitié', 'setengah', 'आधा'] },
  { pct: 33, keywords: ['one third', 'a third'], stems: ['یک سوم', 'یک‌سوم', 'ثلث', 'треть', 'üçte bir', 'un tercio', 'un tiers'] },
  { pct: 25, keywords: ['quarter', 'one quarter', 'a fourth', '25 percent'], stems: ['یک چهارم', 'یک‌چهارم', 'ربع', 'چهارم', 'четверть', 'çeyrek', 'un cuarto', 'un quart'] },
  { pct: 20, keywords: ['a fifth', 'one fifth', '20 percent'], stems: ['یک پنجم', 'خمس', 'пятая', 'beşte bir', 'un quinto'] },
  { pct: 10, keywords: ['a tenth', 'one tenth', '10 percent'], stems: ['یک دهم', 'عشر', 'десятая', 'onda bir', 'un décimo'] },
  { pct: 5, keywords: ['5 percent'], stems: ['۵ درصد', '5 بالمئة'] }
]);

/**
 * Words that mean "some, not much" — a real signal that the customer has no
 * number yet. The planner must PROPOSE a size and say it proposed it, never
 * invent one silently.
 */
export const FUZZY_AMOUNT_WORDS = Object.freeze({
  tiny: {
    keywords: ['a little', 'a bit', 'small amount', 'tiny amount', 'just a little', 'pocket money'],
    stems: ['یکم', 'یه کم', 'یک مقدار کم', 'مبلغ کم', 'جزئی', 'قليل', 'немного', 'biraz', 'un poco', 'un peu', 'sedikit']
  },
  small: {
    keywords: ['some', 'a few', 'modest', 'a small part'],
    stems: ['یک مقدار', 'یه مقدار', 'مقداری', 'چند تا', 'بعضی', 'مقدار', 'biraz', 'algo de', 'quelque', 'beberapa']
  }
});

/* -------------------------------------------------------------------------- */
/*  RECURRENCE — "every week $50 of BTC"                                       */
/* -------------------------------------------------------------------------- */

export const RECURRENCE_LEXICON = Object.freeze([
  { recurring: 'daily', hours: 24,
    keywords: ['every day', 'each day', 'daily', 'per day', 'day by day'],
    stems: ['هر روز', 'روزانه', 'روزی', 'يوميا', 'يومي', 'каждый день', 'ежедневно', 'her gün', 'günlük', 'cada día', 'diario', 'chaque jour', 'setiap hari', 'रोज'] },
  { recurring: 'weekly', hours: 168,
    keywords: ['every week', 'each week', 'weekly', 'per week', 'week by week'],
    stems: ['هر هفته', 'هفتگی', 'هفته ای', 'هفته‌ای', 'أسبوعيا', 'كل أسبوع', 'каждую неделю', 'еженедельно', 'her hafta', 'haftalık', 'cada semana', 'semanal', 'chaque semaine', 'setiap minggu', 'हर हफ्ते'] },
  { recurring: 'monthly', hours: 720,
    keywords: ['every month', 'each month', 'monthly', 'per month', 'month by month'],
    stems: ['هر ماه', 'ماهانه', 'شهري', 'شهريا', 'كل شهر', 'каждый месяц', 'ежемесячно', 'her ay', 'aylık', 'cada mes', 'mensal', 'chaque mois', 'setiap bulan', 'हर महीने'] }
]);

/* -------------------------------------------------------------------------- */
/*  TIME UNITS                                                                 */
/* -------------------------------------------------------------------------- */

export const TIME_UNITS = Object.freeze([
  { unit: 'minute', hours: 1 / 60, words: ['minute', 'minutes', 'min', 'mins'],
    stems: ['دقیقه', 'دقايق', 'минут', 'dakika', 'minuto', 'minute', 'menit', 'मिनट'] },
  { unit: 'hour', hours: 1, words: ['hour', 'hours', 'hr', 'hrs', 'h'],
    stems: ['ساعت', 'ساعات', 'час', 'saat', 'hora', 'heure', 'jam', 'घंटा'] },
  { unit: 'day', hours: 24, words: ['day', 'days', 'd'],
    stems: ['روز', 'أيام', 'يوم', 'день', 'дней', 'gün', 'día', 'jour', 'hari', 'दिन'] },
  { unit: 'week', hours: 168, words: ['week', 'weeks', 'w'],
    stems: ['هفته', 'أسبوع', 'недел', 'hafta', 'semana', 'semaine', 'minggu', 'हफ्ता'] },
  { unit: 'month', hours: 720, words: ['month', 'months', 'mo'],
    stems: ['ماه', 'شهر', 'месяц', 'ay', 'mes', 'mois', 'bulan', 'महीना'] },
  { unit: 'year', hours: 8760, words: ['year', 'years', 'y'],
    stems: ['سال', 'سنة', 'год', 'yıl', 'año', 'an', 'tahun', 'साल'] }
]);

/* -------------------------------------------------------------------------- */
/*  MULTIPLIERS — "double my money" is 100%, "triple" is 200%                  */
/* -------------------------------------------------------------------------- */

export const MULTIPLIER_LEXICON = Object.freeze([
  { factor: 1.5, words: ['one and a half times', '1.5x'], stems: ['یک و نیم برابر', '۱.۵ برابر', 'نصف مرة أخرى'] },
  { factor: 2, words: ['double', 'twice', '2x', 'two times'], stems: ['دو برابر', 'دوبرابر', '۲ برابر', 'ضعف', 'مرتين', 'вдвое', 'iki katı', 'doble', 'doubler', 'dobro', 'दोगुना'] },
  { factor: 3, words: ['triple', 'three times', '3x'], stems: ['سه برابر', '۳ برابر', 'ثلاثة أضعاف', 'втрое', 'üç katı', 'triple', 'treble'] },
  { factor: 5, words: ['five times', '5x'], stems: ['پنج برابر', '۵ برابر', 'خمسة أضعاف', 'в пять раз'] },
  { factor: 10, words: ['ten times', '10x', 'tenfold'], stems: ['ده برابر', '۱۰ برابر', 'عشرة أضعاف', 'в десять раз'] }
]);

/* -------------------------------------------------------------------------- */
/*  MAX LOSS — "don't lose more than $100"                                     */
/* -------------------------------------------------------------------------- */

export const LOSS_GUARD_LEXICON = Object.freeze({
  keywords: ['max loss', 'maximum loss', 'stop loss', 'lose no more than', "don't lose more than", 'risk no more than', 'limit my loss', 'cap my loss'],
  stems: ['ضرر نکن', 'ضرر نکنم', 'بیشتر از این ضرر', 'حد ضرر', 'حد ضررم', 'خسارت', 'لا تخسر أكثر', 'максимальный убыток', 'maksimum zarar', 'pérdida máxima', 'perte maximale']
});

/* -------------------------------------------------------------------------- */
/*  WORD HELPERS                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Fold a word to the form the lexicon is keyed on.
 *
 * The ZWNJ (U+200C) matters more than it looks: Persian compounds are written
 * both ways — «بیت‌کوین» and «بیت کوین» — and a lexicon that only knows one of
 * them silently fails on half of what users type. Arabic YEH/KEH are folded to
 * their Persian equivalents for the same reason, so one entry serves both.
 */
export function normalizeWord(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\u200c/g, ' ')      // ZWNJ → space
    .replace(/\u200f|\u200e/g, '') // RLM/LRM
    .replace(/[يى]/g, 'ی')        // Arabic YEH → Persian YEH
    .replace(/ك/g, 'ک')           // Arabic KEH → Persian KEH
    .replace(/ة/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[\u064B-\u0652\u0670]/g, '') // Arabic diacritics
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split into matchable tokens, keeping multi-word phrases reachable. */
export function tokenize(text) {
  return normalizeWord(text).split(' ').filter(Boolean);
}

/**
 * Levenshtein distance, capped: callers only ever compare against a small
 * threshold, so bailing out early keeps this cheap enough to run over every
 * word of every utterance.
 */
export function editDistance(a, b, cap = 3) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (Math.abs(s.length - t.length) > cap) return cap + 1;
  let prev = new Array(t.length + 1);
  let curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[t.length];
}

/**
 * How many edits a word may be away from a known term and still count as a
 * typo of it. Tight for short words (a 4-letter word at distance 1 is already
 * a quarter different and would match half the dictionary), looser for long
 * ones, where a doubled letter is the commonest mistake there is.
 */
export function typoTolerance(word) {
  const n = String(word).length;
  /*
   * No typo tolerance below five characters, in any script.
   *
   * A 4-letter word at distance 1 is a quarter different, and in a dense
   * alphabet like Persian that is enough to collide: "اشتر" (the Arabic verb
   * "buy") is one deletion away from "اتر" (ETH), and an agent that read the
   * verb as an asset would try to buy the wrong thing. Measured on the
   * corpus, the threshold costs nothing — every typo case in it is 5+
   * characters ("swapp", "bitcoiin", "arbitrom") — and it removes the false
   * positive entirely.
   */
  if (n <= 4) return 0;
  if (n <= 7) return 1;
  return 2;
}

/**
 * Persian/Arabic possessive and plural suffixes. "تترهام" is تتر + هام, and a
 * customer writing about their own holdings attaches one constantly. Stripped
 * before asset lookup so the lexicon only has to know the bare noun.
 */
export const RTL_SUFFIXES = Object.freeze([
  'هایم', 'هات', 'هام', 'های', 'هاى', 'ها', 'مان', 'تان', 'شان', 'ام', 'ات', 'اش', 'م'
]);

/** Remove one trailing Persian/Arabic suffix, if the remainder is still sane. */
export function stripRtlSuffix(word) {
  const w = String(word ?? '');
  for (const suf of RTL_SUFFIXES) {
    if (w.length > suf.length + 1 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return null;
}

/** True when the word is written in a right-to-left script. */
export function isRtlWord(word) {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(String(word ?? ''));
}
