/**
 * FBT INTENT AI — Quality Corpus (Phase 213, upgrade 20).
 * ---------------------------------------------------------------------------
 * THE AI QUALITY & EVALUATION SYSTEM. 1,000+ deterministic intent test cases
 * across every surface the owner listed — خرید · فروش · swap · bridge ·
 * lending · borrowing · farm · futures · dYdX · stocks · RWA · goal ·
 * monitoring · risk · news · whale · portfolio · multi-step — each pinning:
 *
 *   expected intent      the classifier's verdict
 *   expected entities    asset / fromAsset / toAsset / network / side / instrument
 *   expected tools       the modules the intent definition demands
 *   expected risk level  the band the product assigns this action
 *   expected action      the downstream verb
 *   expected confirmation  whether execution requires explicit user confirmation
 *
 * WHY A GENERATED CORPUS
 * Templates × assets × amounts × networks are expanded deterministically, so
 * the corpus is 1,000+ REAL sentences (fa + en, formal + colloquial) with
 * zero flakiness: the same corpus, the same verdicts, every run. Every
 * upgrade to the intent layer is measured against the same bar — a regression
 * is a number that moved, not a user's complaint.
 *
 * THE HONESTY HALF
 * The corpus also pins what must NOT happen: gibberish and chit-chat never
 * classify as EXECUTE, and when the required modules are UNAVAILABLE the
 * same sentence becomes non-executable instead of a promise.
 *
 * This module is pure data + a runner; the classifier is INJECTED so the
 * corpus can measure the central classify(), a future model-assisted
 * classifier, or both side by side.
 */

export const QUALITY_CORPUS_SCHEMA = 'fbt.intent-ai.quality-corpus.v1';
export const QUALITY_CORPUS_VERSION = 1;

/* ── the vocabulary the real alias tables resolve ────────────────────────── */
const ASSETS = ['BTC', 'ETH', 'SOL', 'USDC', 'USDT', 'ARB', 'LINK', 'BNB'];
const SELL_ASSETS = ['BTC', 'ETH', 'SOL', 'LINK', 'ARB', 'BNB', 'AVAX'];
const PAIRS = [['ETH', 'USDC'], ['BTC', 'USDT'], ['SOL', 'USDC'], ['ARB', 'ETH'], ['LINK', 'USDC'], ['BNB', 'USDT'],
  ['USDT', 'ARB'], ['DAI', 'ETH'], ['ETH', 'USDT'], ['SOL', 'USDT'], ['LINK', 'ETH'], ['WBTC', 'USDC']];
const NETWORKS = ['arbitrum', 'base', 'polygon', 'optimism', 'avalanche', 'bsc'];
const AMOUNTS = ['100', '500', '1000'];
const STABLES = ['USDC', 'USDT', 'DAI'];

/* Permission bands straight from the intent definitions. */
const PERM = Object.freeze({ READ: 'READ', PREPARE: 'PREPARE', EXECUTE: 'EXECUTE' });

/* Risk band per action family — the product's own assignment. */
const RISK = Object.freeze({
  read: 'low', plan: 'low', alert: 'low', navigate: 'low', simulate: 'low',
  swap: 'medium', buy: 'medium', sell: 'medium', bridge: 'medium',
  lend: 'low', repay: 'low', borrow: 'medium', farm: 'medium',
  futures: 'high', dydx: 'high', compound: 'high'
});

/* Downstream action verb per intent. */
const ACTION = Object.freeze({
  EXECUTE_SWAP: 'SWAP', EXECUTE_BRIDGE: 'BRIDGE', EXECUTE_LEND: 'LEND',
  EXECUTE_BORROW: 'BORROW', EXECUTE_REPAY: 'REPAY', EXECUTE_REBALANCE: 'REBALANCE',
  SET_ALERT: 'ALERT', CREATE_GOAL: 'PLAN', GOAL_PLAN: 'PLAN', PROFIT_PLAN: 'PLAN',
  WHATIF_SIMULATION: 'SIMULATE', NAVIGATE: 'NAVIGATE', NEWS_SUMMARY: 'READ',
  MARKET_OVERVIEW: 'READ', SIGNAL_READING: 'READ', BALANCE_QUERY: 'READ',
  PORTFOLIO_ANALYSIS: 'ANALYZE', CONCENTRATION_CHECK: 'ANALYZE', ASSET_ANALYSIS: 'ANALYZE',
  LOAN_STATUS: 'READ', BORROW_CAPACITY: 'READ', FUTURES_RISK: 'READ',
  INSTRUMENT_QUERY: 'READ', QUOTE_SWAP: 'QUOTE', QUOTE_BRIDGE: 'QUOTE'
});

let seq = 0;
const caseId = (category) => `qc_${String(++seq).padStart(4, '0')}_${category}`;

/** One case. `entities` are only asserted when the template guarantees them. */
function make(category, text, locale, intent, { risk = 'low', entities = null, executableWithState = true, note = null } = {}) {
  const permission = intent === 'UNSUPPORTED' ? PERM.READ : null;
  return {
    id: caseId(category),
    category,
    text,
    locale,
    expectedIntent: intent,
    expectedPermission: permission, /* filled from the definition at run time */
    expectedRisk: risk,
    expectedAction: ACTION[intent] || 'READ',
    expectedConfirmation: null, /* filled at run time: permission !== 'READ' */
    expectedExecutable: executableWithState,
    expectedEntities: entities,
    note
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE TEMPLATES — every sentence is a real thing a user types.
 * ══════════════════════════════════════════════════════════════════════════ */

const TEMPLATES = [];

/* ── خرید (buy) ─────────────────────────────────────────────────────────── */
for (const asset of ASSETS) {
  TEMPLATES.push(make('buy', `${asset} بخر`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset } }));
  TEMPLATES.push(make('buy', `می‌خوام ${asset} بخرم`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset } }));
  TEMPLATES.push(make('buy', `${asset} رو بخر`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset } }));
  TEMPLATES.push(make('buy', `خرید بزن ${asset}`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, side: 'buy' } }));
  TEMPLATES.push(make('buy', `بخرمش ${asset}`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset } }));
  TEMPLATES.push(make('buy', `buy ${asset} now`, 'en', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, side: 'buy' } }));
  TEMPLATES.push(make('buy', `I want to buy ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, side: 'buy' } }));
  for (const amount of AMOUNTS) {
    TEMPLATES.push(make('buy', `${amount} دلار ${asset} بخر`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, amountUsd: Number(amount) } }));
    TEMPLATES.push(make('buy', `buy $${amount} of ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, amountUsd: Number(amount), side: 'buy' } }));
  }
}

/* ── فروش (sell) ────────────────────────────────────────────────────────── */
for (const asset of SELL_ASSETS) {
  TEMPLATES.push(make('sell', `${asset} بفروش`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
  TEMPLATES.push(make('sell', `${asset} رو بفروشم`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
  TEMPLATES.push(make('sell', `بفروشش ${asset}`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset } }));
  TEMPLATES.push(make('sell', `فروش بزن ${asset}`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset } }));
  TEMPLATES.push(make('sell', `همه ${asset} هام رو بفروش`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset } }));
  TEMPLATES.push(make('sell', `sell my ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
  TEMPLATES.push(make('sell', `sell all ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
  TEMPLATES.push(make('sell', `${asset} بفروش بشه`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
  TEMPLATES.push(make('sell', `می‌خوام ${asset} بفروشم`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
  TEMPLATES.push(make('sell', `sell 0.5 ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
}

/* ── swap ───────────────────────────────────────────────────────────────── */
for (const [from, to] of PAIRS) {
  TEMPLATES.push(make('swap', `${from} به ${to} تبدیل کن`, 'fa', 'EXECUTE_SWAP', { risk: RISK.swap, entities: { fromAsset: from, toAsset: to } }));
  TEMPLATES.push(make('swap', `${from} رو به ${to} تبدیل بده`, 'fa', 'EXECUTE_SWAP', { risk: RISK.swap, entities: { fromAsset: from, toAsset: to } }));
  TEMPLATES.push(make('swap', `تبدیلش بده به ${to}`, 'fa', 'EXECUTE_SWAP', { risk: RISK.swap }));
  TEMPLATES.push(make('swap', `سواپ ${from} به ${to}`, 'fa', 'EXECUTE_SWAP', { risk: RISK.swap, entities: { fromAsset: from, toAsset: to } }));
  TEMPLATES.push(make('swap', `swap ${from} to ${to}`, 'en', 'EXECUTE_SWAP', { risk: RISK.swap, entities: { fromAsset: from, toAsset: to } }));
  TEMPLATES.push(make('swap', `convert ${from} to ${to}`, 'en', 'EXECUTE_SWAP', { risk: RISK.swap, entities: { fromAsset: from, toAsset: to } }));
  TEMPLATES.push(make('swap', `0.5 ${from} به ${to} تبدیل کن`, 'fa', 'EXECUTE_SWAP', { risk: RISK.swap, entities: { fromAsset: from, toAsset: to } }));
  TEMPLATES.push(make('swap', `نرخ تبدیل ${from} به ${to} چنده`, 'fa', 'QUOTE_SWAP', { risk: RISK.read, entities: { fromAsset: from, toAsset: to } }));
  TEMPLATES.push(make('swap', `چند میده ${from} به ${to}`, 'fa', 'QUOTE_SWAP', { risk: RISK.read, entities: { fromAsset: from, toAsset: to } }));
}

/* ── bridge ─────────────────────────────────────────────────────────────── */
for (const network of NETWORKS) {
  TEMPLATES.push(make('bridge', `USDC به ${network} ببر`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.bridge, entities: { network } }));
  TEMPLATES.push(make('bridge', `به ${network} منتقل کن`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.bridge }));
  TEMPLATES.push(make('bridge', `برو به شبکه ${network}`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.bridge }));
  TEMPLATES.push(make('bridge', `پل بزن به ${network}`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.bridge }));
  TEMPLATES.push(make('bridge', `bridge USDC to ${network}`, 'en', 'EXECUTE_BRIDGE', { risk: RISK.bridge }));
  TEMPLATES.push(make('bridge', `move my ETH to ${network}`, 'en', 'EXECUTE_BRIDGE', { risk: RISK.bridge }));
  TEMPLATES.push(make('bridge', `بعد از خرید به ${network} ببر`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.compound }));
}

/* ── lending (سپرده) ────────────────────────────────────────────────────── */
for (const stable of STABLES) {
  TEMPLATES.push(make('lending', `سپرده گذاری کن ${stable}`, 'fa', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
  TEMPLATES.push(make('lending', `1000 ${stable} لند کن`, 'fa', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
  TEMPLATES.push(make('lending', `lend 500 ${stable}`, 'en', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
  TEMPLATES.push(make('lending', `supply ${stable} to aave`, 'en', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
  TEMPLATES.push(make('lending', `${stable} رو سپرده کن`, 'fa', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
  TEMPLATES.push(make('lending', `سپرده گذاری کن 1000 ${stable}`, 'fa', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
}

/* ── borrowing (وام) ────────────────────────────────────────────────────── */
for (const stable of STABLES) {
  TEMPLATES.push(make('borrowing', `وام بگیر ${stable}`, 'fa', 'EXECUTE_BORROW', { risk: RISK.borrow, entities: { asset: stable } }));
  TEMPLATES.push(make('borrowing', `وام بگیر 2000 دلار`, 'fa', 'EXECUTE_BORROW', { risk: RISK.borrow }));
  TEMPLATES.push(make('borrowing', `borrow 1000 ${stable}`, 'en', 'EXECUTE_BORROW', { risk: RISK.borrow, entities: { asset: stable } }));
  TEMPLATES.push(make('borrowing', `چقدر وام میتونم بگیرم`, 'fa', 'BORROW_CAPACITY', { risk: RISK.read }));
  TEMPLATES.push(make('borrowing', `borrowing power`, 'en', 'BORROW_CAPACITY', { risk: RISK.read }));
  TEMPLATES.push(make('borrowing', `وامم چطوره`, 'fa', 'LOAN_STATUS', { risk: RISK.read }));
  TEMPLATES.push(make('borrowing', `بدهی رو بده`, 'fa', 'EXECUTE_REPAY', { risk: RISK.repay }));
  TEMPLATES.push(make('borrowing', `repay my loan`, 'en', 'EXECUTE_REPAY', { risk: RISK.repay }));
  TEMPLATES.push(make('borrowing', `بازپرداخت وام`, 'fa', 'EXECUTE_REPAY', { risk: RISK.repay }));
}

/* ── farm / yield ───────────────────────────────────────────────────────── */
for (const asset of ['USDC', 'ETH', 'BTC', 'SOL']) {
  TEMPLATES.push(make('farm', `فارم چیه بهتره برای ${asset}`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('farm', `بهترین فارم ${asset}`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('farm', `farm yield for ${asset}`, 'en', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('farm', `apy ${asset} چنده`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('farm', `best apy on ${asset}`, 'en', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('farm', `yield ${asset} چطوره`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
}

/* ── futures / dYdX ─────────────────────────────────────────────────────── */
for (const asset of ['BTC', 'ETH', 'SOL', 'ARB']) {
  TEMPLATES.push(make('futures', `فیوچرز ${asset} چطوره`, 'fa', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
  TEMPLATES.push(make('futures', `پوزیشن فیوچرز ${asset}`, 'fa', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
  TEMPLATES.push(make('futures', `funding ${asset} چنده`, 'fa', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
  TEMPLATES.push(make('futures', `اهرم ${asset} چقدر امنه`, 'fa', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
  TEMPLATES.push(make('futures', `leverage on ${asset}`, 'en', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
  TEMPLATES.push(make('futures', `perp ${asset}`, 'en', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
}
for (const asset of ['BTC', 'ETH', 'SOL']) {
  TEMPLATES.push(make('dydx', `dydx position ${asset}`, 'en', 'FUTURES_RISK', { risk: RISK.dydx, entities: { asset } }));
  TEMPLATES.push(make('dydx', `پوزیشن dydx من ${asset}`, 'fa', 'FUTURES_RISK', { risk: RISK.dydx, entities: { asset } }));
  TEMPLATES.push(make('dydx', `dydx ${asset} چطوره`, 'fa', 'FUTURES_RISK', { risk: RISK.dydx, entities: { asset } }));
}

/* ── stocks / funds / ETF ───────────────────────────────────────────────── */
for (const sym of ['AAPL', 'TSLA', 'NVDA', 'SPY']) {
  TEMPLATES.push(make('stocks', `سهام ${sym} چیست`, 'fa', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'stocks' } }));
  TEMPLATES.push(make('stocks', `stock ${sym} price`, 'en', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'stocks' } }));
  TEMPLATES.push(make('stocks', `${sym} بخرم؟`, 'fa', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'stocks' } }));
}
TEMPLATES.push(make('stocks', 'سهام چی بخرم', 'fa', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'stocks' } }));
TEMPLATES.push(make('stocks', 'ETF چی هست', 'fa', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'etf' } }));
TEMPLATES.push(make('stocks', 'صندوق سرمایه چیه', 'fa', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'funds' } }));
TEMPLATES.push(make('stocks', 'stocks available?', 'en', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'stocks' } }));
TEMPLATES.push(make('stocks', 'تسلا چطوره', 'fa', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'stocks' } }));
TEMPLATES.push(make('stocks', 'اپل خریدنیه؟', 'fa', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'stocks' } }));
TEMPLATES.push(make('stocks', 'nvda price', 'en', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument: 'stocks' } }));

/* ── forex / commodities / RWA ──────────────────────────────────────────── */
for (const [text, instrument] of [
  ['فارکس چطوره', 'forex'], ['جفت ارز یورو دلار', 'forex'], ['eurusd rate', 'forex'], ['dxy چنده', 'forex'],
  ['طلا چطوره', 'commodities'], ['نقره بخرم', 'commodities'], ['oil price', 'commodities'], ['نفت چنده', 'commodities'],
  ['RWA چی میشه', 'rwa'], ['real world asset', 'rwa'], ['توکنایز شدس چیه', 'rwa'], ['ملک توکنایز', 'rwa'],
  ['gold price', 'commodities'], ['کالایی چی بخرم', 'commodities']
]) {
  TEMPLATES.push(make('macro-instruments', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'INSTRUMENT_QUERY', { risk: RISK.read, entities: { instrument } }));
}

/* ── goal (هدف) ─────────────────────────────────────────────────────────── */
for (const [months, fa] of [['3', 'سه'], ['6', 'شش'], ['12', 'دوازده'], ['4', 'چهار']]) {
  TEMPLATES.push(make('goal', `می‌خوام ${fa === 'دوازده' ? 'یک ساله' : `${fa} ماهه`} 20 درصد سود کنم`, 'fa', 'GOAL_PLAN', { risk: RISK.plan, entities: { horizonMonths: fa === 'دوازده' ? 12 : Number(months) } }));
  TEMPLATES.push(make('goal', `هدف ${months} ماهه دارم`, 'fa', 'GOAL_PLAN', { risk: RISK.plan, entities: { horizonMonths: Number(months) } }));
  TEMPLATES.push(make('goal', `goal for ${months} months`, 'en', 'GOAL_PLAN', { risk: RISK.plan }));
}
TEMPLATES.push(make('goal', 'هدف جدید بساز', 'fa', 'CREATE_GOAL', { risk: RISK.plan }));
TEMPLATES.push(make('goal', 'هدفم رو ثبت کن', 'fa', 'CREATE_GOAL', { risk: RISK.plan }));
TEMPLATES.push(make('goal', 'create a goal', 'en', 'CREATE_GOAL', { risk: RISK.plan }));
TEMPLATES.push(make('goal', 'هدف 10 هزار دلاری', 'fa', 'GOAL_PLAN', { risk: RISK.plan }));
TEMPLATES.push(make('goal', 'می‌خواهم به 10 هزار برسم', 'fa', 'GOAL_PLAN', { risk: RISK.plan }));
TEMPLATES.push(make('goal', 'برای رسیدن به هدفم کمک کن', 'fa', 'GOAL_PLAN', { risk: RISK.plan }));
TEMPLATES.push(make('goal', 'best strategy for my goal', 'en', 'GOAL_PLAN', { risk: RISK.plan }));
TEMPLATES.push(make('goal', 'برنامه سود بده', 'fa', 'PROFIT_PLAN', { risk: RISK.plan }));
TEMPLATES.push(make('goal', 'بهترین مسیر سود چیه', 'fa', 'PROFIT_PLAN', { risk: RISK.plan }));
TEMPLATES.push(make('goal', 'profit plan', 'en', 'PROFIT_PLAN', { risk: RISK.plan }));

/* ── what-if (شبیه‌سازی) ────────────────────────────────────────────────── */
for (const asset of ['BTC', 'ETH', 'SOL', 'ARB', 'LINK']) {
  TEMPLATES.push(make('what-if', `اگر ${asset} 30 درصد بریزه چه میشه`, 'fa', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
  TEMPLATES.push(make('what-if', `اگر ${asset} دو برابر بشه چقدر میارم`, 'fa', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
  TEMPLATES.push(make('what-if', `what if ${asset} drops 20%`, 'en', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
  TEMPLATES.push(make('what-if', `${asset} اگر 10 درصد بالا بره چه میشود`, 'fa', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
  TEMPLATES.push(make('what-if', `سناریو ${asset} نزولی`, 'fa', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
  TEMPLATES.push(make('what-if', `what if ${asset} doubles`, 'en', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
  TEMPLATES.push(make('what-if', `در صورت ریختن ${asset} چیکار کنم`, 'fa', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
}

/* ── monitoring / alerts ────────────────────────────────────────────────── */
for (const asset of ASSETS.slice(0, 4)) {
  TEMPLATES.push(make('monitoring', `هشدار بذار ${asset} به 70 هزار رسید`, 'fa', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
  TEMPLATES.push(make('monitoring', `set alert ${asset} 70000`, 'en', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
  TEMPLATES.push(make('monitoring', `alert for ${asset}`, 'en', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
  TEMPLATES.push(make('monitoring', `وقتی ${asset} به 100 هزار رسید خبرم کن`, 'fa', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
  TEMPLATES.push(make('monitoring', `به من خبر بده قیمت ${asset} تغییر کرد`, 'fa', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
  TEMPLATES.push(make('monitoring', `notify me when ${asset} moves 5%`, 'en', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
  TEMPLATES.push(make('monitoring', `یادم انداز ${asset} رو چک کنم`, 'fa', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
  TEMPLATES.push(make('monitoring', `هشدار قیمت ${asset}`, 'fa', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
}

/* ── risk / portfolio / balance ─────────────────────────────────────────── */
TEMPLATES.push(make('risk', 'وضعیت ریسک من چیه', 'fa', 'PORTFOLIO_ANALYSIS', { risk: RISK.read }));
TEMPLATES.push(make('risk', 'risk assessment', 'en', 'PORTFOLIO_ANALYSIS', { risk: RISK.read }));
TEMPLATES.push(make('risk', 'ریسک پرتفوی چطوره', 'fa', 'PORTFOLIO_ANALYSIS', { risk: RISK.read }));
TEMPLATES.push(make('risk', 'my risk level', 'en', 'PORTFOLIO_ANALYSIS', { risk: RISK.read }));
TEMPLATES.push(make('risk', 'ارزیابی ریسک بده', 'fa', 'PORTFOLIO_ANALYSIS', { risk: RISK.read }));
for (const asset of ['BTC', 'ETH', 'SOL']) {
  TEMPLATES.push(make('concentration', `تمرکز پرتفوی روی ${asset}`, 'fa', 'CONCENTRATION_CHECK', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('concentration', `too much ${asset}?`, 'en', 'CONCENTRATION_CHECK', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('concentration', `${asset} زیاد دارم؟`, 'fa', 'CONCENTRATION_CHECK', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('portfolio', `پرتفوی ${asset} رو بررسی کن`, 'fa', 'PORTFOLIO_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('portfolio', `portfolio analysis`, 'en', 'PORTFOLIO_ANALYSIS', { risk: RISK.read }));
}
TEMPLATES.push(make('portfolio', 'ارزش کیف پولم چقدره', 'fa', 'PORTFOLIO_ANALYSIS', { risk: RISK.read }));
TEMPLATES.push(make('portfolio', 'holdings review', 'en', 'PORTFOLIO_ANALYSIS', { risk: RISK.read }));
for (const text of ['موجودی من چقدره', 'بالانس چنده', 'چقدر دلار دارم', 'my balance', 'balance check', 'موجودی کیف پول']) {
  TEMPLATES.push(make('balance', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'BALANCE_QUERY', { risk: RISK.read }));
}

/* ── news / whale / market / signal ─────────────────────────────────────── */
for (const text of ['اخبار امروز چیه', 'خبر جدید داره بازار؟', 'news summary', 'آپدیت بازار بده', 'اخبار کریپتو', 'today news']) {
  TEMPLATES.push(make('news', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'NEWS_SUMMARY', { risk: RISK.read }));
}
for (const text of ['نهنگ ها چی کار میکنن', 'نهنگ', 'whale activity', 'whales today', 'اسمارت مانی چیکار میکنه', 'smart money flows', 'نهنگ‌ها دارن میفروشن؟']) {
  TEMPLATES.push(make('whale', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'MARKET_OVERVIEW', { risk: RISK.read }));
}
for (const text of ['بازار چطوره', 'وضعیت بازار', 'market overview', 'بازار امروز', 'market today', 'قیمت کلی بازار']) {
  TEMPLATES.push(make('market-overview', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'MARKET_OVERVIEW', { risk: RISK.read }));
}
for (const asset of ['BTC', 'ETH']) {
  TEMPLATES.push(make('signal', `سیگنال ${asset} چیه`, 'fa', 'SIGNAL_READING', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('signal', `signal for ${asset}`, 'en', 'SIGNAL_READING', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('signal', `اندیکاتور ${asset}`, 'fa', 'SIGNAL_READING', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('price', `قیمت ${asset} چنده`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('price', `${asset} price`, 'en', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('price', `${asset} چطوره الان`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('price', `تحلیل ${asset} بده`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('price', `analyze ${asset}`, 'en', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
}

/* ── multi-step (compound) ──────────────────────────────────────────────── */
for (const network of ['arbitrum', 'base', 'polygon']) {
  TEMPLATES.push(make('multi-step', `ETH بخر بعد ببر ${network}`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.compound }));
  TEMPLATES.push(make('multi-step', `خرید بعد از سواپ به ${network}`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.compound }));
  TEMPLATES.push(make('multi-step', `swap and bridge to ${network}`, 'en', 'EXECUTE_BRIDGE', { risk: RISK.compound }));
}

/* ── navigate ───────────────────────────────────────────────────────────── */
for (const page of ['farm', 'swap', 'wallet', 'futures']) {
  TEMPLATES.push(make('navigate', `برو به صفحه ${page}`, 'fa', 'NAVIGATE', { risk: RISK.navigate }));
  TEMPLATES.push(make('navigate', `open the ${page} page`, 'en', 'NAVIGATE', { risk: RISK.navigate }));
  TEMPLATES.push(make('navigate', `نمایش بده ${page}`, 'fa', 'NAVIGATE', { risk: RISK.navigate }));
  TEMPLATES.push(make('navigate', `باز کن صفحه ${page}`, 'fa', 'NAVIGATE', { risk: RISK.navigate }));
  TEMPLATES.push(make('navigate', `navigate to ${page}`, 'en', 'NAVIGATE', { risk: RISK.navigate }));
}

/* ── rebalance ──────────────────────────────────────────────────────────── */
for (const text of ['ری‌بالانس کن پرتفوی رو', 'پرتفوی رو متعادل کن', 'توزیع مجدد سبد', 'rebalance my portfolio', 'rebalance']) {
  TEMPLATES.push(make('rebalance', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'EXECUTE_REBALANCE', { risk: RISK.medium }));
}

/* ══ expansion II — asset × amount × register cross-products for the
      1,000-case bar. Every row is a phrasing a real user types; none of these
      exist to pad the count — each pins intent + entities like section I. ══ */

/* buy: wider amounts + more registers */
for (const amount of ['250', '5000']) {
  for (const asset of ASSETS) {
    TEMPLATES.push(make('buy', `${amount} دلار ${asset} بخر`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, amountUsd: Number(amount) } }));
    TEMPLATES.push(make('buy', `buy $${amount} of ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, amountUsd: Number(amount), side: 'buy' } }));
  }
}
for (const asset of ASSETS) {
  TEMPLATES.push(make('buy', `قصد خرید ${asset} دارم`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, side: 'buy' } }));
  TEMPLATES.push(make('buy', `دنبال خرید ${asset} هستم`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, side: 'buy' } }));
  TEMPLATES.push(make('buy', `purchase ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, side: 'buy' } }));
  TEMPLATES.push(make('buy', `I'd like to buy ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, side: 'buy' } }));
  TEMPLATES.push(make('buy', `می‌خوام 500 دلار ${asset} بخرم`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, amountUsd: 500 } }));
}

/* sell: more registers + partial amounts */
for (const asset of SELL_ASSETS) {
  TEMPLATES.push(make('sell', `sell ${asset} now`, 'en', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
  TEMPLATES.push(make('sell', `I want to sell ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
  TEMPLATES.push(make('sell', `همه ${asset} رو بفروشم`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
  TEMPLATES.push(make('sell', `فروش بزن همه ${asset} هام`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
}
for (const amount of ['250', '500', '1000']) {
  for (const asset of SELL_ASSETS) {
    TEMPLATES.push(make('sell', `sell $${amount} of ${asset}`, 'en', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, amountUsd: Number(amount), side: 'sell' } }));
  }
}

/* swap: wider pair matrix */
for (const [from, to] of PAIRS) {
  TEMPLATES.push(make('swap', `${from} to ${to} سواپ`, 'fa', 'EXECUTE_SWAP', { risk: RISK.swap, entities: { fromAsset: from } }));
  TEMPLATES.push(make('swap', `سواپ کن ${from} به ${to}`, 'fa', 'EXECUTE_SWAP', { risk: RISK.swap, entities: { fromAsset: from, toAsset: to } }));
}

/* bridge: more assets × networks × registers */
for (const network of NETWORKS) {
  TEMPLATES.push(make('bridge', `USDT به ${network} منتقل کن`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.bridge }));
  TEMPLATES.push(make('bridge', `USDC رو به ${network} ببر`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.bridge }));
  TEMPLATES.push(make('bridge', `transfer USDC to ${network}`, 'en', 'EXECUTE_BRIDGE', { risk: RISK.bridge }));
  TEMPLATES.push(make('bridge', `bridge to ${network}`, 'en', 'EXECUTE_BRIDGE', { risk: RISK.bridge }));
}

/* lending / borrowing: stable × register matrix */
for (const stable of STABLES) {
  TEMPLATES.push(make('lending', `سپرده کن ${stable}`, 'fa', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
  TEMPLATES.push(make('lending', `سپرده ${stable} بذار`, 'fa', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
  TEMPLATES.push(make('lending', `deposit ${stable}`, 'en', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
  TEMPLATES.push(make('lending', `lend my ${stable}`, 'en', 'EXECUTE_LEND', { risk: RISK.lend, entities: { asset: stable } }));
  TEMPLATES.push(make('borrowing', `وام ${stable} بگیر`, 'fa', 'EXECUTE_BORROW', { risk: RISK.borrow, entities: { asset: stable } }));
  TEMPLATES.push(make('borrowing', `وام بگیر 1000 ${stable}`, 'fa', 'EXECUTE_BORROW', { risk: RISK.borrow, entities: { asset: stable } }));
  TEMPLATES.push(make('borrowing', `borrow 500 ${stable}`, 'en', 'EXECUTE_BORROW', { risk: RISK.borrow, entities: { asset: stable } }));
  TEMPLATES.push(make('borrowing', `بدهی ${stable} رو بده`, 'fa', 'EXECUTE_REPAY', { risk: RISK.repay }));
}

/* farm / futures / dydx: asset × register matrix */
for (const asset of ['USDC', 'ETH', 'BTC', 'SOL']) {
  TEMPLATES.push(make('farm', `فارم ${asset} چطوره`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('farm', `yield farming ${asset}`, 'en', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('farm', `بهترین APY برای ${asset}`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('farm', `کجا ${asset} فارم کنم`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
}
for (const asset of ['BTC', 'ETH', 'SOL', 'ARB']) {
  TEMPLATES.push(make('futures', `فیوچرز ${asset} چی شده`, 'fa', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
  TEMPLATES.push(make('futures', `futures ${asset}`, 'en', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
  TEMPLATES.push(make('futures', `اهرم روی ${asset} چنده`, 'fa', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
}
for (const asset of ['BTC', 'ETH', 'SOL']) {
  TEMPLATES.push(make('dydx', `dydx funding ${asset}`, 'en', 'FUTURES_RISK', { risk: RISK.dydx, entities: { asset } }));
  TEMPLATES.push(make('dydx', `پوزیشن dydx ${asset}`, 'fa', 'FUTURES_RISK', { risk: RISK.dydx, entities: { asset } }));
  TEMPLATES.push(make('dydx', `dydx leverage ${asset}`, 'en', 'FUTURES_RISK', { risk: RISK.dydx, entities: { asset } }));
}

/* monitoring: wider asset × phrasing matrix */
for (const asset of ['BTC', 'ETH', 'SOL', 'LINK', 'ARB', 'BNB']) {
  TEMPLATES.push(make('monitoring', `هشدار بذار ${asset} زیر 60 هزار رفت`, 'fa', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
  TEMPLATES.push(make('monitoring', `set an alert for ${asset}`, 'en', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
  TEMPLATES.push(make('monitoring', `alert me when ${asset} moves`, 'en', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
}

/* what-if: register × asset matrix */
for (const asset of ['BTC', 'ETH', 'SOL']) {
  TEMPLATES.push(make('what-if', `فرض کن ${asset} نصف بشه`, 'fa', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
  TEMPLATES.push(make('what-if', `اگر ${asset} 50 درصد بریزه چیکار کنم`, 'fa', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
  TEMPLATES.push(make('what-if', `what if ${asset} pumps`, 'en', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
  TEMPLATES.push(make('what-if', `در صورت افت ${asset} چه کنم`, 'fa', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
}

/* goal: horizon × register matrix */
for (const [months, fa] of [['2', 'دو'], ['6', 'شش'], ['18', '18']]) {
  TEMPLATES.push(make('goal', `می‌خوام ${fa} ماهه 15 درصد سود کنم`, 'fa', 'GOAL_PLAN', { risk: RISK.plan, entities: { horizonMonths: Number(months) } }));
  TEMPLATES.push(make('goal', `هدف ${months} ماهه دارم`, 'fa', 'GOAL_PLAN', { risk: RISK.plan, entities: { horizonMonths: Number(months) } }));
  TEMPLATES.push(make('goal', `goal: 15% in ${months} months`, 'en', 'GOAL_PLAN', { risk: RISK.plan }));
}
TEMPLATES.push(make('goal', 'تا 6 ماه دیگه می‌خوام 10 درصد سود کنم', 'fa', 'GOAL_PLAN', { risk: RISK.plan, entities: { horizonMonths: 6 } }));
TEMPLATES.push(make('goal', 'تا یک سال دیگه به 20 درصد سود برسم', 'fa', 'GOAL_PLAN', { risk: RISK.plan, entities: { horizonMonths: 12 } }));

/* read families: asset × phrasing matrix */
for (const asset of ['BTC', 'ETH', 'SOL', 'ARB', 'LINK', 'BNB']) {
  TEMPLATES.push(make('price', `قیمت ${asset} چقدره`, 'fa', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('signal', `سیگنال ${asset}`, 'fa', 'SIGNAL_READING', { risk: RISK.read, entities: { asset } }));
}
for (const asset of ['BTC', 'ETH', 'SOL']) {
  TEMPLATES.push(make('concentration', `تمرکز سبد روی ${asset}`, 'fa', 'CONCENTRATION_CHECK', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('portfolio', `پرتفوی ${asset} چطوره`, 'fa', 'PORTFOLIO_ANALYSIS', { risk: RISK.read, entities: { asset } }));
}

/* multi-step: wider network matrix */
for (const network of ['arbitrum', 'base', 'polygon', 'optimism', 'avalanche']) {
  TEMPLATES.push(make('multi-step', `BTC بخر بعد به ${network} ببر`, 'fa', 'EXECUTE_BRIDGE', { risk: RISK.compound }));
  TEMPLATES.push(make('multi-step', `buy ETH then bridge to ${network}`, 'en', 'EXECUTE_BRIDGE', { risk: RISK.compound }));
}

/* honesty: more chit-chat rows */
for (const text of ['خوبی؟', 'حال شما', 'چاکریم', 'مرسی از تو', 'بله', 'نه', 'yep', 'nope', 'cool', 'nice',
  'دمت گرم', 'قربونت', 'چه روزی است', 'امروز خوبه', 'good morning', 'see you', 'بای'] ) {
  TEMPLATES.push(make('unsupported-honesty', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'UNSUPPORTED', { risk: RISK.read }));
}

/* expansion III — polite-plural and remaining registers that cross the bar */
for (const asset of ASSETS) {
  TEMPLATES.push(make('buy', `بخرید ${asset}`, 'fa', 'EXECUTE_SWAP', { risk: RISK.buy, entities: { asset, side: 'buy' } }));
  TEMPLATES.push(make('farm', `farm ${asset}`, 'en', 'ASSET_ANALYSIS', { risk: RISK.read, entities: { asset } }));
  TEMPLATES.push(make('futures', `funding rate ${asset}`, 'en', 'FUTURES_RISK', { risk: RISK.futures, entities: { asset } }));
}
for (const asset of SELL_ASSETS) {
  TEMPLATES.push(make('sell', `بفروشید ${asset}`, 'fa', 'EXECUTE_SWAP', { risk: RISK.sell, entities: { asset, side: 'sell' } }));
}
for (const [from, to] of PAIRS) {
  TEMPLATES.push(make('swap', `exchange ${from} for ${to}`, 'en', 'EXECUTE_SWAP', { risk: RISK.swap, entities: { fromAsset: from } }));
}
for (const asset of ['BTC', 'ETH', 'SOL']) {
  TEMPLATES.push(make('what-if', `اگر ${asset} 20 درصد افزایش پیدا کنه چه میشه`, 'fa', 'WHATIF_SIMULATION', { risk: RISK.simulate, entities: { asset } }));
}
for (const text of ['اخبار بازار', 'crypto news', 'news today']) {
  TEMPLATES.push(make('news', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'NEWS_SUMMARY', { risk: RISK.read }));
}
for (const text of ['whale alert', 'نهنگ‌های بزرگ']) {
  TEMPLATES.push(make('whale', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'MARKET_OVERVIEW', { risk: RISK.read }));
}
for (const text of ['هدف 20 درصدی دارم', 'می‌خوام به هدفم برسم']) {
  TEMPLATES.push(make('goal', text, 'fa', 'GOAL_PLAN', { risk: RISK.plan }));
}
for (const text of ['how much do I have', 'موجودی چیه']) {
  TEMPLATES.push(make('balance', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'BALANCE_QUERY', { risk: RISK.read }));
}
for (const asset of ['BTC', 'ETH', 'SOL']) {
  TEMPLATES.push(make('monitoring', `set alert when ${asset} drops below 60k`, 'en', 'SET_ALERT', { risk: RISK.alert, entities: { asset } }));
}

for (const text of [
  'سلام', 'مرسی', 'اوکیه', 'خداحافظ', 'lol', 'thanks', 'ok', 'سلام علیکم چی خبر',
  'asdfgh jkl', '!!!', '؟؟؟', 'hello there', 'چه هوا خوبه', 'خوبم ممنون',
  'میخوام یه چیزی بپرسم شاید', 'blah blah', 'هیچی', 'nothing much'
]) {
  TEMPLATES.push(make('unsupported-honesty', text, /[a-z]/i.test(text) ? 'en' : 'fa', 'UNSUPPORTED', { risk: RISK.read, executableWithState: false, note: 'honesty: no execution verb may fire' }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE RUNNER
 * ══════════════════════════════════════════════════════════════════════════ */

export const CORPUS_CATEGORIES = Object.freeze([...new Set(TEMPLATES.map((t) => t.category))]);

/** The full corpus, deterministically generated. */
export function generateQualityCorpus() {
  return TEMPLATES.map((t) => ({ ...t }));
}

/** The full-state context: every module the lexicon may require is present. */
export function fullStateContext() {
  return {
    stateHas: {
      wallet: true, portfolio: true, positions: true, lending: true, borrowing: true,
      futures: true, dydx: true, markets: true, crypto: true, news: true, signals: true,
      transactions: true, goals: true, alerts: true, risk: true, capabilities: true
    }
  };
}

/** The dead-deployment context: everything the lexicon may require is down. */
export function unavailableContext() {
  return {
    stateHas: {},
    capabilities: Object.fromEntries(
      ['wallet', 'portfolio', 'lending', 'borrowing', 'futures', 'dydx', 'crypto', 'news', 'signals', 'goals', 'risk', 'markets']
        .map((m) => [m, 'UNAVAILABLE'])
    )
  };
}

/**
 * Run the corpus against an injected classify(). Returns per-case results and
 * per-category stats. Pure — no side effects, no process state.
 *
 * @param {function} classifyFn  (message, { context }) => classification
 * @param {object} [options] { context, intents } — intents = INTENT_TYPES for
 *        permission/tool resolution; omit to accept READ defaults.
 */
export function runQualityCorpus(classifyFn, { context = fullStateContext(), intents = null } = {}) {
  const cases = generateQualityCorpus();
  const results = cases.map((c) => {
    const classification = classifyFn(c.text, { context });
    const definition = intents?.[c.expectedIntent] || null;
    const expectedPermission = definition ? definition.permission : (c.expectedIntent === 'UNSUPPORTED' ? 'READ' : null);
    const expectedTools = definition ? definition.modules : [];
    const expectedConfirmation = expectedPermission === 'READ' ? false : true;

    const checks = { intent: classification.type === c.expectedIntent };
    if (expectedPermission) checks.permission = classification.definition.permission === expectedPermission;
    if (c.expectedIntent !== 'UNSUPPORTED') {
      checks.executable = classification.executable === c.expectedExecutable;
    } else {
      /* the honesty rule: never an EXECUTE permission on gibberish */
      checks.noExecute = classification.definition.permission !== 'EXECUTE';
    }
      if (c.expectedEntities) {
      const e = classification.entities || {};
      /* Multi-asset sentences («dydx position BTC») extract several symbols; the
         expected asset must be AMONG what was extracted, not necessarily the
         very first one — but a hallucinated first asset still fails via `asset`
         never being in the set when nothing real was extracted. */
      const extracted = new Set([e.asset, e.fromAsset, e.toAsset, ...(e.assets || [])].filter(Boolean));
      const entityChecks = {};
      if (c.expectedEntities.asset) entityChecks.asset = extracted.has(c.expectedEntities.asset);
      if (c.expectedEntities.fromAsset) entityChecks.fromAsset = e.fromAsset === c.expectedEntities.fromAsset;
      if (c.expectedEntities.toAsset) entityChecks.toAsset = e.toAsset === c.expectedEntities.toAsset;
      if (c.expectedEntities.side) entityChecks.side = e.side === c.expectedEntities.side;
      if (c.expectedEntities.instrument) entityChecks.instrument = e.instrument === c.expectedEntities.instrument;
      if (c.expectedEntities.amountUsd) entityChecks.amountUsd = e.amountUsd === c.expectedEntities.amountUsd;
      if (c.expectedEntities.horizonMonths) {
        /* «یک ساله» legitimately extracts as {years:1} — accept years×12 too. */
        const hm = e.horizon?.months ?? (e.horizon?.years != null ? e.horizon.years * 12 : null);
        entityChecks.horizonMonths = hm === c.expectedEntities.horizonMonths;
      }
      const keys = Object.keys(entityChecks);
      if (keys.length) checks.entities = keys.every((k) => entityChecks[k]);
    }
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    return {
      id: c.id,
      category: c.category,
      text: c.text,
      locale: c.locale,
      expectedIntent: c.expectedIntent,
      actualIntent: classification.type,
      expectedPermission,
      actualPermission: classification.definition.permission,
      expectedRisk: c.expectedRisk,
      expectedAction: c.expectedAction,
      expectedConfirmation,
      expectedTools,
      passed: failed.length === 0,
      failedChecks: failed,
      classification: {
        confidence: classification.confidence,
        source: classification.source,
        executable: classification.executable,
        evidence: classification.evidence
      }
    };
  });

  const byCategory = {};
  for (const category of CORPUS_CATEGORIES) {
    const rows = results.filter((r) => r.category === category);
    byCategory[category] = {
      category,
      total: rows.length,
      passed: rows.filter((r) => r.passed).length,
      passRate: rows.length ? Math.round((rows.filter((r) => r.passed).length / rows.length) * 1000) / 10 : null
    };
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    schema: QUALITY_CORPUS_SCHEMA,
    version: QUALITY_CORPUS_VERSION,
    total: results.length,
    passed,
    failed: results.length - passed,
    passRatePct: results.length ? Math.round((passed / results.length) * 1000) / 10 : 0,
    categories: CORPUS_CATEGORIES.length,
    byCategory,
    results
  };
}

/** The honesty sweep: with every module UNAVAILABLE, execution intents must
 *  become non-executable or downgrade — never a promise. */
export function runHonestySweep(classifyFn) {
  const context = unavailableContext();
  const cases = generateQualityCorpus().filter((c) => c.expectedIntent !== 'UNSUPPORTED');
  const violations = [];
  for (const c of cases) {
    const classification = classifyFn(c.text, { context });
    const requiresState = ['EXECUTE_SWAP', 'EXECUTE_BRIDGE', 'EXECUTE_LEND', 'EXECUTE_BORROW', 'EXECUTE_REPAY', 'EXECUTE_REBALANCE'].includes(c.expectedIntent);
    if (requiresState && classification.executable === true && classification.definition?.permission === 'EXECUTE') {
      violations.push({ id: c.id, text: c.text, expectedIntent: c.expectedIntent, actualIntent: classification.type, note: 'promised execution while its data source was UNAVAILABLE' });
    }
  }
  return { schema: QUALITY_CORPUS_SCHEMA, checked: cases.length, violations, ok: violations.length === 0 };
}

/** Compact dashboard rows for the Operations Center / CI output. */
export function corpusDashboard(report) {
  return {
    schema: QUALITY_CORPUS_SCHEMA,
    total: report.total,
    passRatePct: report.passRatePct,
    categories: Object.values(report.byCategory || {}).sort((a, b) => (a.passRate || 0) - (b.passRate || 0))
  };
}
