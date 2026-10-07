/**
 * FBT AI ORCHESTRATOR — EVIDENCE PLANNER (what data, which tool, how many brains)
 * ---------------------------------------------------------------------------
 * The question this file answers, before any model is called:
 *
 *   1. WHAT DATA does this turn actually need to be answerable?
 *   2. WHICH TOOL does FBT already have for each of those facts?
 *   3. WHICH of them does this turn ALREADY hold (so nothing is re-fetched)?
 *   4. HOW MANY independent models is this question worth, and does it need a
 *      judge that resolves disagreement?
 *
 * Why it exists: the previous path asked the fleet about whatever the route
 * happened to have injected, so a «چرا بازار ریخت؟» turn could be answered
 * without a single news item, and a portfolio turn could be answered without
 * the portfolio. Models are the last step of the chain, not the first.
 *
 * Laws (each has a probe):
 *   · ZERO EXECUTION. No facet here maps to an execution tool; the plan's
 *     `permissions.canExecute` is a literal false and there is no code path
 *     that could set it (execution plans are built by the Intent OS plan
 *     pipeline, not by this planner).
 *   · Already-satisfied facets are marked `satisfiedBy` and never re-fetched.
 *   · Every facet decision carries machine-readable `reasons`, so an answer
 *     can be audited ("why did it read the news?") instead of guessed at.
 *   · Stakes decide seats: a definition question costs one model, a
 *     money-moving comparison earns three plus a judge — never the reverse.
 */

export const EVIDENCE_PLAN_SCHEMA = 'fbt.evidence-plan.v1';
export const EVIDENCE_PLAN_VERSION = '14.0.0';

/* -------------------------------------------------------------------------- */
/*  FACETS — the FBT facts a turn can stand on                                 */
/* -------------------------------------------------------------------------- */

/**
 * `tool` must be a tool name the broker actually can run (server/aiToolBroker.js).
 * `cost` is the planner's currency: `low` tools are cache reads, `medium` ones
 * leave the process, `high` ones walk several upstream desks.
 */
export const FACETS = Object.freeze({
  market_prices: {
    id: 'market_prices', tool: 'fbt_get_market_snapshot', cost: 'low',
    label: { fa: 'قیمت لحظه‌ای بازار', en: 'live market prices' },
    why: { fa: 'هیچ عددی در پاسخ بدون خوانش قیمت گفته نمی‌شود.', en: 'No number is stated without a price read.' }
  },
  asset_regime: {
    id: 'asset_regime', tool: 'fbt_get_signals', cost: 'low',
    label: { fa: 'روند و نوسان دارایی', en: 'asset trend and volatility' },
    why: { fa: 'روند ۲۴ساعته/۷روزه و نوسان، به‌جای حدس.', en: 'Trend and volatility read instead of a guess.' }
  },
  portfolio_state: {
    id: 'portfolio_state', tool: 'fbt_get_portfolio', cost: 'low',
    label: { fa: 'وضعیت پرتفوی', en: 'portfolio state' },
    why: { fa: 'پاسخ دربارهٔ سرمایه باید از کیف پول خودِ کاربر بیاید، نه از مدل.', en: 'A money answer must come from the user wallet, never a model.' }
  },
  wallet_state: {
    id: 'wallet_state', tool: 'fbt_get_wallet_state', cost: 'low',
    label: { fa: 'وضعیت کیف پول', en: 'wallet state' },
    why: { fa: 'آدرس/شبکه و اتصال کیف پول.', en: 'Addresses, chains and connection state.' }
  },
  news_flow: {
    id: 'news_flow', tool: 'fbt_get_news', cost: 'medium',
    label: { fa: 'جریان خبری', en: 'news flow' },
    why: { fa: '«چرا افتاد؟» یک علت می‌خواهد؛ علت در خبر است نه در مدل.', en: 'A "why did it move" needs a cause — the cause is in the news, not in a model.' }
  },
  macro_state: {
    id: 'macro_state', tool: 'fbt_get_macro', cost: 'high',
    label: { fa: 'دادهٔ کلان', en: 'macro data' },
    why: { fa: 'نرخ بهره/تورم/دلار/طلا از میز کلان خوانده می‌شود.', en: 'Rates, inflation, dollar and gold come from the macro desk.' }
  },
  yield_rates: {
    id: 'yield_rates', tool: 'fbt_get_yields', cost: 'medium',
    label: { fa: 'بازده و سود', en: 'yields and rates' },
    why: { fa: 'هر عدد بازده باید خوانش استخر باشد، نه تخمین مدل.', en: 'Every APY must be a pool read, not a model estimate.' }
  },
  smart_money: {
    id: 'smart_money', tool: 'fbt_get_smart_money', cost: 'medium',
    label: { fa: 'پول هوشمند زنجیره‌ای', en: 'on-chain smart money' },
    why: { fa: 'جریان تأییدشدهٔ زنجیره به‌جای روایت.', en: 'Verified on-chain flow instead of a narrative.' }
  },
  knowledge: {
    id: 'knowledge', tool: 'fbt_rag_search', cost: 'low',
    label: { fa: 'دانش تأییدشدهٔ FBT', en: 'verified FBT knowledge' },
    why: { fa: 'واقعیت‌های محصول و کارمزد از دانش تأییدشده می‌آید.', en: 'Product facts and fees come from the verified knowledge base.' }
  },
  past_decisions: {
    id: 'past_decisions', tool: 'fbt_memory_recall', cost: 'low',
    label: { fa: 'حافظهٔ تصمیم‌های قبلی', en: 'past decisions memory' },
    why: { fa: 'اگر پیش‌تر چیزی گفته/تصمیم شده، همان لحاظ می‌شود.', en: 'If something was decided before, it is taken into account.' }
  }
});

export const FACET_IDS = Object.freeze(Object.keys(FACETS));

/* Order of preference when the per-turn tool budget cannot cover everything:
   a fact the user can see (portfolio) beats what only we can see (macro). */
const FACET_PRIORITY = Object.freeze({
  portfolio_state: 100,
  wallet_state: 95,
  market_prices: 90,
  asset_regime: 80,
  knowledge: 70,
  news_flow: 65,
  yield_rates: 60,
  smart_money: 55,
  past_decisions: 50,
  macro_state: 40
});

/* -------------------------------------------------------------------------- */
/*  What the words ask for (fa/en, the two languages the app answers in)        */
/* -------------------------------------------------------------------------- */

const SIGNALS = Object.freeze({
  market_prices: [
    /قیمت|چنده|چند\s*ه|چقدر\s*(?:ه|است)|ارزش\s*دارد|نرخ\s*(?:روز|بازار)|بازار|پرتفوی|سرمایه‌ام|ارزش‌گذاری/i,
    /\b(?:price|how\s+much|worth|market|valuation|quote)\b/i
  ],
  asset_regime: [
    /تحلیل|روند|سقوط|صعود|ریزش|نوسان|حمایت|مقاومت|سیگنال|مومنتوم|کندل|تکنیکال|پیش‌بینی/i,
    /\b(?:trend|analysis|signal|momentum|volatility|support|resistance|technicals|forecast|outlook)\b/i
  ],
  portfolio_state: [
    /پرتفوی|پورتفوی|پرتفو|دارایی(?:‌| )?ها(?:م)?|موجودی(?:‌| )?ها(?:م)?|سرمایه(?:‌| )?(?:من|ما)|سبد(?:‌| )?(?:من|ما)|هولدینگ|چند\s*تا\s*(?:توکن|کوین)|جمع\s*(?:دارایی|سرمایه)/i,
    /\b(?:portfolio|holdings|my\s+balance|net\s+worth|positions|allocation|rebalance)\b/i
  ],
  wallet_state: [
    /کیف\s*پول|والت|آدرس\s*(?:من|کیف)|زنجیره\s*(?:من)|شبکه\s*(?:من)|ولت/i,
    /\b(?:wallet|address|connected\s+chain|my\s+network)\b/i
  ],
  news_flow: [
    /خبر|اخبار|چرا\s*(?:افتاد|ریخت|رفت\s*بالا|پرید)|چه\s*(?:شد|خبری\s*شد)|اتفاق\s*افتاد|رویداد|شفافیت\s*خبری/i,
    /\b(?:news|why\s+(?:did|is)|what\s+happened|headline|announcement|event)\b/i
  ],
  macro_state: [
    /تورم|فدرال|فد|نرخ\s*بهره|بازده\s*اوراق|دلار\s*(?:شاخص|آمریکا)?|طلا|نفت|اقتصاد\s*کلان|رکود|بانک\s*مرکزی/i,
    /\b(?:inflation|federal\s+reserve|the\s+fed|interest\s+rate|treasury|dxy|dollar\s+index|gold|oil|macro|recession|central\s+bank)\b/i
  ],
  yield_rates: [
    /بازده|سود\s*(?:دهی|دهی)?|استیک|استیکینگ|فارم|فارمینگ|یلد|سپرده|وام|قرض|بهره\s*سپرده|لندینگ|نقدینگی/i,
    /\b(?:yield|apy|apr|staking|farming|farm|lending|borrow|supply\s+rate|liquidity\s+mining)\b/i
  ],
  smart_money: [
    /پول\s*هوشمند|اسمارت\s*مانی|نهنگ|وال‌های|وال\s*ها|جریان\s*پول|آدرس\s*هوشمند/i,
    /\b(?:smart\s*money|whales?|on-?chain\s+flows?|large\s+holders?)\b/i
  ],
  knowledge: [
    /چطور|چگونه|چیست|چیه|معنی|یعنی\s*چی|آموزش|راهنما|کارمزد|تفاوت|شرایط|قوانین|امنیت|چرا\s*(?:باید|نباید)/i,
    /\b(?:how\s+(?:do|does|to)|what\s+is|what\s+are|guide|fees?|difference|require|security|explain)\b/i
  ],
  past_decisions: [
    /قبلاً|قبلا|پیش‌تر|پیشتر|دفعه\s*(?:ی?\s*)?قبل|آخرین\s*بار|گفتم|گفته\s*بودم|تصمیم\s*(?:قبلی|قبل)|یادت/i,
    /\b(?:last\s+time|previously|earlier|as\s+we\s+(?:said|discussed)|you\s+said|our\s+decision)\b/i
  ]
});

/* Intent types whose answer is definitionally incomplete without a facet. */
const INTENT_FACETS = Object.freeze({
  MARKET_ANALYSIS: ['market_prices', 'asset_regime', 'news_flow'],
  MARKET_CONTEXT: ['market_prices', 'macro_state'],
  ANALYZE_TOKEN: ['asset_regime', 'market_prices'],
  PORTFOLIO_ANALYSIS: ['portfolio_state', 'market_prices'],
  WALLET_BALANCE: ['wallet_state', 'portfolio_state'],
  YIELD_DISCOVERY: ['yield_rates', 'market_prices'],
  FARM: ['yield_rates'],
  LEND: ['yield_rates', 'market_prices'],
  STAKING: ['yield_rates'],
  INVESTMENT_PLAN: ['portfolio_state', 'market_prices', 'yield_rates', 'macro_state'],
  REBALANCE: ['portfolio_state', 'market_prices'],
  STRATEGY: ['market_prices', 'asset_regime', 'portfolio_state'],
  RISK_ANALYSIS: ['portfolio_state', 'market_prices', 'macro_state'],
  NEWS_SEARCH: ['news_flow', 'knowledge'],
  SMART_MONEY: ['smart_money', 'market_prices'],
  WHALE: ['smart_money'],
  SIGNALS: ['market_prices', 'asset_regime'],
  STOCKS: ['market_prices', 'news_flow'],
  LEARN: ['knowledge'],
  GENERAL: ['knowledge']
});

/* Facets whose data IS the user's money. A model may never supply these. */
export const TOOL_TRUTH_FACETS = Object.freeze(['portfolio_state', 'wallet_state']);

/* Facts that can only be true with a tool read — a model's sentence about them
   is not evidence (see judge.js: `TOOL_TRUTH_FACETS`). */
export const EXECUTION_INTENTS = Object.freeze([
  'SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND', 'DCA', 'FUTURES', 'LEND', 'BORROW', 'FARM', 'STAKING'
]);

/* -------------------------------------------------------------------------- */
/*  Stakes                                                                     */
/* -------------------------------------------------------------------------- */

const HIGH_STAKES = [
  /همه\s*(?:ی|‌)?\s*(?:سرمایه|دارایی)|تمام\s*(?:سرمایه|دارایی)|آخرین\s*(?:پول|سرمایه)/i,
  /\b(?:all\s*in|everything\s+i\s+own|life\s+savings|leverage|margin\s+call)\b/i,
  /اهرم|مارجین|ضروری|اضطراری|عجله|سریع\s*باید|قرض|وام\s*بگیر/i,
  /بخرم\s*یا\s*نه|بفروشم\s*یا\s*نه|سود\s*می‌کنم|ضرر\s*می‌کنم|ریسک\s*ورشکستگی/i,
  /\b(?:should\s+i\s+(?:buy|sell|invest|borrow)|worth\s+the\s+risk|guaranteed)\b/i
];

const LOW_STAKES = [
  /^(?:سلام|درود|چطوری|خوبی|ممنون|مرسی|thanks|hello|hi|hey)\b/i,
  /یعنی\s*چی|چیست|چیه|تعریف|معنی|فرق\s*(?:شونده|داره)?|تفاوت/i,
  /\b(?:what\s+is|what\s+does|define|meaning|difference\s+between|how\s+does\s+.{0,20}\s+work)\b/i,
  /راهنما|آموزش|چطور\s*(?:کار\s*می‌کند|استفاده)/i
];

const truthyAmount = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

/**
 * How much is riding on this answer?
 *   LOW    — a definition or a social turn: one model at most.
 *   MEDIUM — a comparison, an analysis, a plan: two independent readings.
 *   HIGH   — money-moving or explicit risk: three readings + judge + verify.
 */
export function assessStakes({ message = '', intentType = null, entities = {} } = {}) {
  const text = String(message || '');
  const intent = String(intentType || 'GENERAL').toUpperCase();
  const signals = [];
  let level = 'MEDIUM';

  const amountUsd = Math.max(
    Number(entities?.amountUsd) || 0,
    Number(entities?.amount) || 0,
    Number(entities?.capital) || 0
  );

  const highHit = HIGH_STAKES.find((re) => re.test(text));
  const lowHit = LOW_STAKES.find((re) => re.test(text));

  if (EXECUTION_INTENTS.includes(intent)) { level = 'HIGH'; signals.push(`EXECUTION_INTENT:${intent}`); }
  if (highHit) { level = 'HIGH'; signals.push(`PHRASE:${String(highHit).slice(0, 40)}`); }
  if (amountUsd >= 1000) { level = 'HIGH'; signals.push(`AMOUNT_USD>=1000:${Math.round(amountUsd)}`); }
  else if (amountUsd > 0) { signals.push(`AMOUNT_USD:${Math.round(amountUsd)}`); }

  if (level !== 'HIGH') {
    if (intent === 'GENERAL' && lowHit) { level = 'LOW'; signals.push('DEFINITIONAL'); }
    else if (['LEARN', 'HELP', 'NAVIGATION'].includes(intent) && !entities?.token) { level = 'LOW'; signals.push(`LOW_INTENT:${intent}`); }
    else if (lowHit && !entities?.token && !truthyAmount(entities?.amount)) { level = 'LOW'; signals.push('DEFINITIONAL'); }
  }

  /* A money-math question is HIGH even without an amount: the answer decides a
     real allocation and the user did not state a number to bound it. */
  if (level === 'MEDIUM' && ['FUTURES', 'BORROW', 'LEND'].includes(intent)) {
    level = 'HIGH';
    signals.push(`RISK_INTENT:${intent}`);
  }

  return { level, signals, amountUsd: amountUsd || null };
}

/* -------------------------------------------------------------------------- */
/*  Context satisfaction — never re-fetch what the turn already holds          */
/* -------------------------------------------------------------------------- */

function satisfiedByContext(facetId, context = {}) {
  switch (facetId) {
    case 'market_prices': {
      const map = context?.market?.priceMap;
      if (map && typeof map === 'object' && Object.keys(map).length) return 'context.market.priceMap';
      const coins = context?.market?.coins;
      if (Array.isArray(coins) && coins.length) return 'context.market.coins';
      if (context?.market?.snapshot) return 'context.market.snapshot';
      return null;
    }
    case 'portfolio_state':
      return context?.portfolio?.totalValueUsd != null ? 'context.portfolio' : null;
    case 'wallet_state':
      return context?.wallet && (context.wallet.attached || context.wallet.address || context.wallet.chains?.length)
        ? 'context.wallet' : null;
    case 'yield_rates':
      return Array.isArray(context?.yields) && context.yields.length ? 'context.yields'
        : (context?.yields && typeof context.yields === 'object' && Object.keys(context.yields).length ? 'context.yields' : null);
    case 'news_flow':
      return Array.isArray(context?.news) && context.news.length ? 'context.news' : null;
    case 'knowledge':
      return Array.isArray(context?.knowledge) && context.knowledge.length ? 'context.knowledge' : null;
    case 'asset_regime':
      return context?.assetRegime ? 'context.assetRegime' : null;
    case 'smart_money':
      return context?.smartMoney ? 'context.smartMoney' : null;
    case 'macro_state':
      return context?.macro ? 'context.macro' : null;
    case 'past_decisions':
      return null; /* memory is per-owner and always freshly queried */
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  The plan                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAX_TOOLS = Number(process.env.AI_ORCH_MAX_TOOLS || 4);
const DEFAULT_MAX_SEATS = Number(process.env.AI_ORCH_MAX_SEATS || 3);

const SEATS_BY_STAKES = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3 });
const BUDGET_BY_STAKES = Object.freeze({ LOW: 8_000, MEDIUM: 12_000, HIGH: 16_000 });

/**
 * Build the evidence plan for a turn. Pure: same input, same plan, no I/O.
 *
 * @param {object} input
 * @param {string} input.message
 * @param {string} [input.intentType]
 * @param {object} [input.entities]
 * @param {object} [input.context]         what this turn already holds
 * @param {string[]} [input.satisfiedFacets] explicit "already read" facets
 * @param {number} [input.availableProviders] how many model seats exist at all
 * @param {number} [input.maxTools]
 * @param {number} [input.maxSeats]
 * @param {number} [input.deadlineMs]
 */
export function buildEvidencePlan({
  message = '',
  intentType = null,
  entities = {},
  context = {},
  satisfiedFacets = [],
  availableProviders = null,
  maxTools = DEFAULT_MAX_TOOLS,
  maxSeats = DEFAULT_MAX_SEATS,
  deadlineMs = null,
  locale = 'fa'
} = {}) {
  const text = String(message || '');
  const intent = String(intentType || 'GENERAL').toUpperCase();
  const reasons = [];

  /* 1 — which facets does this turn ask for? */
  const wanted = new Map();
  const addFacet = (facetId, reason) => {
    if (!FACETS[facetId]) return;
    wanted.set(facetId, [...(wanted.get(facetId) || []), reason]);
  };

  for (const [facetId, patterns] of Object.entries(SIGNALS)) {
    const hit = patterns.find((re) => re.test(text));
    if (hit) addFacet(facetId, `WORD:${facetId}`);
  }
  for (const facetId of INTENT_FACETS[intent] || INTENT_FACETS.GENERAL) {
    addFacet(facetId, `INTENT:${intent}`);
  }
  if (entities?.token && !wanted.has('asset_regime')) addFacet('asset_regime', 'ENTITY:token');
  if (truthyAmount(entities?.amount ?? entities?.amountUsd) && !wanted.has('portfolio_state')) {
    addFacet('portfolio_state', 'ENTITY:amount');
  }
  /* A definition question that mentions an asset still needs the asset read —
     but only the price/regime, never the wallet. */
  if (entities?.token && EXECUTION_INTENTS.includes(intent)) addFacet('news_flow', 'EXECUTION_CONTEXT');

  /* 2 — what is already in hand? */
  const satisfied = [];
  const requests = [];
  const deferred = [];
  const explicit = new Set((satisfiedFacets || []).map(String));

  for (const facetId of wanted.keys()) {
    const fromContext = satisfiedByContext(facetId, context);
    if (fromContext) {
      satisfied.push({ facetId, satisfiedBy: fromContext, reasons: wanted.get(facetId) });
      continue;
    }
    if (explicit.has(facetId)) {
      satisfied.push({ facetId, satisfiedBy: 'caller-verified', reasons: wanted.get(facetId) });
      continue;
    }
    requests.push({
      facetId,
      tool: FACETS[facetId].tool,
      cost: FACETS[facetId].cost,
      priority: FACET_PRIORITY[facetId] ?? 10,
      reasons: wanted.get(facetId)
    });
  }

  /* 3 — tool budget: keep the facts that matter most, say out loud what was
     dropped (a dropped fact becomes a stated limitation, not silent absence). */
  const budget = Math.max(0, Math.min(8, Number(maxTools) || 0));
  requests.sort((a, b) => b.priority - a.priority);
  while (requests.length > budget) {
    const dropped = requests.pop();
    deferred.push({ facetId: dropped.facetId, reasons: ['TOOL_BUDGET'], priority: dropped.priority });
    reasons.push(`DEFERRED:${dropped.facetId}:TOOL_BUDGET`);
  }

  /* 4 — stakes → how many brains, and whether a judge is warranted. */
  const stakes = assessStakes({ message: text, intentType: intent, entities });
  let seats = SEATS_BY_STAKES[stakes.level] ?? 1;
  const providerCeiling = availableProviders == null ? null : Math.max(0, Number(availableProviders) || 0);
  if (providerCeiling != null) {
    if (providerCeiling === 0) { seats = 0; reasons.push('NO_EXTERNAL_PROVIDER'); }
    else if (seats > providerCeiling) { seats = providerCeiling; reasons.push(`SEATS_CAPPED_BY_FLEET:${providerCeiling}`); }
  }
  if (seats > Math.max(1, Number(maxSeats) || 1)) { seats = Math.max(1, Number(maxSeats) || 1); reasons.push(`SEATS_CAPPED_BY_CONFIG:${seats}`); }
  /* A turn with unresolved high-cost facts needs a second reading even at LOW
     stakes — one model plus a stale macro read is not an answer. */
  const unresolved = requests.filter((r) => r.cost !== 'low').length;
  if (stakes.level === 'LOW' && unresolved > 0) { seats = Math.max(seats, 2); reasons.push('SEATS_RAISED:UNRESOLVED_SOURCES'); }

  const needJudge = seats >= 2 || stakes.level !== 'LOW';
  if (needJudge && stakes.level === 'HIGH') reasons.push('JUDGE:HIGH_STAKES');
  const needVerify = stakes.level === 'HIGH';

  const plannedBudgetMs = deadlineMs != null
    ? Math.max(1_500, Number(deadlineMs))
    : (BUDGET_BY_STAKES[stakes.level] ?? 12_000);

  /* A top-level audit trail: which facet was requested (and why), which was
     already in hand, which was deferred. Every facet keeps its full reason
     list too; this is the one-line-per-decision view an operator reads. */
  for (const req of requests) reasons.push(`REQUESTED:${req.facetId}:${(req.reasons || []).join('+')}`);
  for (const sat of satisfied) reasons.push(`SATISFIED_BY_CONTEXT:${sat.facetId}`);

  return {
    ok: true,
    schema: EVIDENCE_PLAN_SCHEMA,
    version: EVIDENCE_PLAN_VERSION,
    locale: String(locale || 'fa').slice(0, 5),
    intentType: intent,
    stakes: { level: stakes.level, signals: stakes.signals, amountUsd: stakes.amountUsd },
    facets: {
      requested: [...wanted.keys()],
      satisfied,
      requests,
      deferred
    },
    analysis: {
      seats,
      needJudge,
      needVerify,
      /** Web research is never planned here: aiCollaboration owns that path and
          a second network hop would spend the same budget twice. */
      needWeb: false,
      roles: seats === 0 ? [] : ['analyst', 'risk-reviewer', 'macro-reviewer'].slice(0, seats)
    },
    budgetMs: plannedBudgetMs,
    reasons,
    /** Literal, so a caller cannot lose track of it (§67). */
    permissions: { canExecute: false, canSign: false, canMoveFunds: false },
    executionToolsPlanned: 0,
    at: Date.now()
  };
}

/** Human-readable one-liner for logs, the API and the ops panel. */
export function describeEvidencePlan(plan = {}, locale = 'fa') {
  if (!plan?.facets) return '';
  const fa = String(locale || 'fa').startsWith('fa');
  const names = plan.facets.requests.map((r) => (fa ? FACETS[r.facetId]?.label?.fa : FACETS[r.facetId]?.label?.en) || r.facetId);
  const held = plan.facets.satisfied.map((s) => (fa ? FACETS[s.facetId]?.label?.fa : FACETS[s.facetId]?.label?.en) || s.facetId);
  if (fa) {
    const parts = [
      `دادهٔ لازم: ${names.length ? names.join('، ') : 'خوانش تازه‌ای لازم نیست'}`,
      held.length ? `از قبل در دست: ${held.join('، ')}` : null,
      `تحلیل: ${plan.analysis.seats} مدل${plan.analysis.needJudge ? ' + قاضی' : ''}`,
      plan.facets.deferred.length ? `به تعویق (بودجه‌ٔ ابزار): ${plan.facets.deferred.map((d) => d.facetId).join('، ')}` : null
    ].filter(Boolean);
    return parts.join(' · ');
  }
  const parts = [
    `data needed: ${names.length ? names.join(', ') : 'no fresh read'}`,
    held.length ? `already held: ${held.join(', ')}` : null,
    `analysis: ${plan.analysis.seats} model(s)${plan.analysis.needJudge ? ' + judge' : ''}`,
    plan.facets.deferred.length ? `deferred (tool budget): ${plan.facets.deferred.map((d) => d.facetId).join(', ')}` : null
  ].filter(Boolean);
  return parts.join(' · ');
}

export default buildEvidencePlan;
