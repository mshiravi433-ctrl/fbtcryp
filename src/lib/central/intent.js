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
  CONCENTRATION_CHECK: { modules: ['portfolio', 'risk'], permission: PERMISSION.READ },
  ASSET_ANALYSIS: { modules: ['crypto', 'signals', 'news', 'risk'], permission: PERMISSION.READ },
  BALANCE_QUERY: { modules: ['wallet'], permission: PERMISSION.READ },
  LOAN_STATUS: { modules: ['lending', 'borrowing', 'portfolio', 'risk'], permission: PERMISSION.READ },
  BORROW_CAPACITY: { modules: ['lending', 'borrowing', 'wallet', 'risk'], permission: PERMISSION.READ },
  FUTURES_RISK: { modules: ['futures', 'dydx', 'portfolio', 'risk'], permission: PERMISSION.READ },
  MARKET_OVERVIEW: { modules: ['crypto', 'signals', 'news'], permission: PERMISSION.READ },
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
const RULES = Object.freeze([
  { intent: 'PORTFOLIO_ANALYSIS', patterns: [/پرتفوی|پورتفوی|سبد (سرمایه|من)|portfolio|holdings|ارزش (کیف|سبد)/i], requires: ['portfolio'] },
  { intent: 'CONCENTRATION_CHECK', patterns: [/زیاد (دارم|است|داری)|تمرکز|concentration|too much|比重|تک‌دارایی|تک دارایی/i], requires: ['portfolio'] },
  { intent: 'LOAN_STATUS', patterns: /وامم|وام من|وام(?:م)? (چطور|چقدر|چنده|امن|سلامت)|وضعیت وام|loan status|بدهی ?م|my loan/i, requires: ['lending'] },
  /* Buying an instrument the app may not sell is the most dangerous place to be
     vague: a cheerful «بله، در حال خرید ETF…» would be a lie, and a «متوجه نشدم»
     wastes the turn. It classifies as its own intent so the registry, not the
     language model, decides whether the answer is a route or a refusal (§8). */
  { intent: 'INSTRUMENT_QUERY', patterns: /\betf\b|\beft\b|صندوق (سرمایه|درآمد| ETF)?|fund\b|stock|سهام|شرکت|farik?س|فارکس|forex|جفت ?ارز|commodit|کالایی|طلا|نقره|نفت|خاک ?سبز|rwa|real.?world|tokeniz/i, requires: ['markets'] },
  { intent: 'BORROW_CAPACITY', patterns: /(?:چقدر|چه مقدار|حداکثر|سقف|چند).{0,28}(وام|borrow|اعتبار)|ظرفیت (وام|دریافت)|borrowing power|max borrow/i, requires: ['lending'] },
  { intent: 'FUTURES_RISK', patterns: /(فیوچرز|آتی|اهرم|leverage|funding|مارجین|perp|position (باز|open))/i, requires: ['futures'] },
  { intent: 'WHATIF_SIMULATION', patterns: [/اگر .{0,40}(بیفتد|بریزد|بریزه|بالا برود|بره بالا|افزایش|کاهش|برسه)|چه می ?شود|what.?if|در صورت (ریختن|افت)|سناریو/i], requires: ['portfolio'] },
  { intent: 'GOAL_PLAN', patterns: [/هدف|goal|برای (رسیدن|برسم)|می ?خواهم (به|برسم)|target (of|:)/i], requires: [] },
  { intent: 'PROFIT_PLAN', patterns: /برنامه (سود|کسب سود|درآمد)|profit plan|بهینه ?سازی (سود|پرتفوی)|بهترین مسیر/i, requires: ['portfolio'] },
  { intent: 'NEWS_SUMMARY', patterns: /خبر|اخبار|news|آپدیت (جدید|بازار)|رویداد/i, requires: ['news'] },
  { intent: 'SIGNAL_READING', patterns: /سیگنال|signal|اندیکاتور|تایم?فریم/i, requires: ['signals'] },
  { intent: 'MARKET_OVERVIEW', patterns: /بازار|market|قیمت (کلی|بازار)|وضعیت (کلی )?بازار/i, requires: ['markets'] },
  { intent: 'QUOTE_SWAP', patterns: /نرخ (تبدیل|سواپ)|چند می ?دهد|quote|قیمت (تبدیل|خرید|فروش)/i, requires: ['markets'] },
  { intent: 'EXECUTE_SWAP', patterns: /تبدیل (کن|کنید|بکن)|سواپ|swap (این|به|to)|convert .* to| exchange .* for| تبدیلش بده|(بفروشش|بفروشمش|بفروش|بفرست|بخرمش|بخرش|فروش بزن|خرید بزن|\bsell\b|\bbuy\b)/i, requires: ['wallet'] },
  { intent: 'EXECUTE_BRIDGE', patterns: /به (آربیتروم|آربیتروm ?one|آربیتروم one|arbitrum|پالیگان|بیس|اپتیمیزم|اربیترم)|منتقل کن به|برو به شبکه|bridge|پل بزن|ببر (به|روی)/i, requires: ['wallet'] },
  { intent: 'EXECUTE_BORROW', patterns: /وام (بگیر|گرفتن|دریافت کن)|borrow (me|some)?|بخوام بگیرم/i, requires: ['lending'] },
  { intent: 'EXECUTE_LEND', patterns: /سپرده (گذاری|بگذار)|لند (کن|کنید)|lend|supply (کن|کردن)/i, requires: ['lending'] },
  { intent: 'EXECUTE_REPAY', patterns: /بدهی (را )?بده| بازپرداخت|قسط (بده|ردیف)|repay/i, requires: ['lending'] },
  { intent: 'EXECUTE_REBALANCE', patterns: /ری‌بالانس|متعادل (کردن|کن)|توزیع مجدد|rebalance/i, requires: ['portfolio'] },
  { intent: 'CREATE_GOAL', patterns: /هدف (جدید|بساز|ثبت|-set)|create goal|هدفم رو ثبت/i, requires: [] },
  { intent: 'SET_ALERT', patterns: /هشدار|alert (set|کن)|به من خبر بده|وقتی رسید به|خبرم کن|یادم انداز/i, requires: [] },
  { intent: 'BALANCE_QUERY', patterns: /مانده|بالانس|موجودی|balance|چقدر (دارم|تومان|دلار)/i, requires: ['wallet'] },
  { intent: 'ASSET_ANALYSIS', patterns: /(بررسی|تحلیل|وضعیت) ?(کن|ش)?|analyze|check .* out|چطور است/i, requires: ['markets'] },
  /* Price questions are the single most common message in a trading app, and a
     lexicon that misses them turns "36,000 USDT" into "please clarify". Ordered
     after QUOTE_SWAP / BALANCE_QUERY / LOAN_STATUS so those keep their ground. */
  { intent: 'ASSET_ANALYSIS', patterns: /قیمت|price|چنده|چقدره|چند است|چند شد|چند شده|رسید (به|چند)|رساند|rate (is|of)/i, requires: ['markets'] },
  { intent: 'NAVIGATE', patterns: /برو به (صفحه )?|نمایش بده|باز کن|open (the )?page|navigate/i, requires: [] }
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
  alerts: 'alerts', risk: 'risk', capabilities: 'risk', health: 'risk'
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
  const hits = [];
  for (const rule of RULES) {
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
  /* A follow-up rewrites the intent, because in a conversation the referent IS
     the intent: «بفروشم؟» after a BTC analysis is a swap quote on BTC, not a
     generic question about selling. */
  const followupIntent = followIntent(follow, context);
  if (followupIntent) hits.unshift({ ...followupIntent, score: followupIntent.score ?? 0.9 });

  /* Multi-step compound requests: «بعد از خرید به Arbitrum ببر» must become ONE
     intent whose plan has both legs, not two turns that race each other. */
  const compound = detectCompound(text);
  /* A compound request is the whole sentence, so it is ranked with the same rule
     as everything else — its own score is a floor, not an automatic win. */
  hits.push(...compound.map((c) => ({ intent: c.intent, score: round(Math.max(0.72, c.score ?? 0.72), 3), compound: true, leg: c.leg })));

  hits.sort((a, b) => (b.score || 0) - (a.score || 0));
  const best = hits[0] || null;
  const definition = best ? INTENT_TYPES[best.intent] : null;
  const entities = extractEntities(message, { context, state });
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
  BORROW_CAPACITY: 0.07, LOAN_STATUS: 0.06, EXECUTE_REPAY: 0.06, WHATIF_SIMULATION: 0.05,
  INSTRUMENT_QUERY: 0.05, SET_ALERT: 0.045, NEWS_SUMMARY: 0.045, SIGNAL_READING: 0.045,
  PROFIT_PLAN: 0.045, QUOTE_BRIDGE: 0.04, EXECUTE_BRIDGE: 0.04, FUTURES_RISK: 0.04,
  QUOTE_SWAP: 0.035, EXECUTE_REBALANCE: 0.035, CONCENTRATION_CHECK: 0.03, EXECUTE_SWAP: 0.03,
  CREATE_GOAL: 0.03, GOAL_PLAN: 0.03, BALANCE_QUERY: 0.03, EXECUTE_LEND: 0.025, EXECUTE_BORROW: 0.025,
  PORTFOLIO_ANALYSIS: 0.0, MARKET_OVERVIEW: 0.0, ASSET_ANALYSIS: -0.045, NAVIGATE: -0.02
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
  if (/\brwa\b|real.?world.?asset|tokeniz|صندوق مسدود|ملک/.test(t)) return 'rwa';
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
  { leg: 2, intent: 'EXECUTE_BRIDGE', score: 0.72, test: /(بعد از (خرید|سواپ|تبدیل)|بعدش|سپس|و بعد|بعد|then|after ?that)?\s*(و\s*)?(به\s*|روی\s*|بریز?د?\s*(روی|به)?\s*|ببر\s*(به|روی)?\s*|منتقل\s*(به|روی)?\s*)?(arbitrum|arbi\b|base\b|polygon|matic|optimism|bnb|bsc|avalanche|پل\b|bridge|شبکه)/i },
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
    side: /فروش|sell/i.test(text) ? 'sell' : (/خرید|buy/i.test(text) ? 'buy' : null),
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
