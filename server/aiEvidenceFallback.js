/**
 * FBT AI evidence policy — refuse unsupported factual answers cleanly.
 *
 * The model may help explain evidence, but its own completion is not evidence.
 * This module keeps the route's evidence gate and user-facing continuation
 * deterministic so the fallback is testable without importing the HTTP router.
 */

export const AI_EVIDENCE_POLICY_SCHEMA = 'fbt.ai-evidence-policy.v1';

const CURRENT_DATA_INTENTS = new Set([
  'MARKET_ANALYSIS', 'MARKET_CONTEXT', 'NEWS_SEARCH', 'ANALYZE_TOKEN',
  'RISK_ANALYSIS', 'PORTFOLIO_ANALYSIS', 'INVESTMENT_PLAN', 'GOAL_PLAN',
  'STRATEGY', 'STRATEGY_PLAN', 'YIELD_DISCOVERY', 'RECOMMENDATION',
  'DISCOVERY_RECOMMENDATION', 'WHY_MARKET_MOVE', 'SMART_MONEY', 'WHALE',
  'SIGNALS', 'STOCKS', 'FARM', 'LEND', 'BORROW', 'STAKING', 'REBALANCE',
  'WALLET_BALANCE', 'ORDERS', 'BUY', 'SELL', 'SWAP', 'BRIDGE', 'SEND', 'DCA'
]);
const MARKET_PRICE_INTENTS = new Set([
  'MARKET_ANALYSIS', 'MARKET_CONTEXT', 'ANALYZE_TOKEN', 'SIGNALS', 'STOCKS'
]);
const NEWS_INTENTS = new Set(['NEWS_SEARCH', 'WHY_MARKET_MOVE', 'RESEARCH']);
const SMART_MONEY_INTENTS = new Set(['SMART_MONEY', 'WHALE']);
const PORTFOLIO_INTENTS = new Set([
  'RISK_ANALYSIS', 'PORTFOLIO_ANALYSIS', 'INVESTMENT_PLAN', 'GOAL_PLAN',
  'STRATEGY', 'STRATEGY_PLAN', 'REBALANCE', 'WALLET_BALANCE', 'ORDERS'
]);
const YIELD_INTENTS = new Set(['YIELD_DISCOVERY', 'FARM', 'LEND', 'BORROW', 'STAKING']);
const EVIDENCE_ANSWER_PATHS = new Set(['TOOL', 'WEB', 'MULTI_AI', 'KNOWLEDGE']);
const NON_ANSWER_INTENTS = new Set([
  'NAVIGATION', 'CAPABILITIES', 'OPEN_CALM', 'PLAY_MUSIC', 'CONTINUE', 'CANCEL',
  'DETAILS', 'SETTINGS', 'NOTIFICATIONS', 'WALLET_CONNECT', 'WALLET_DISCONNECT'
]);
const TRUSTED_CONTEXT_SCHEMAS = new Set(['fbt.ai-context.v1', 'fbt.gateway-context.v1']);
const BAD_DATA_STATUSES = new Set(['unavailable', 'error', 'failed', 'stale', 'insufficient-evidence']);

/* A cross-asset price read older than this is not a current observation: it is
   a dead feed or a stale carry-over, and a condition evaluated on it would be
   a guess wearing a number. Crypto reads stamp `at: now` by construction, so
   this only bites macro/global feeds whose own timestamp has gone ancient.
   Seven days tolerates a market-closed weekend (Friday close → Monday) while
   still refusing a week-old quote presented as live. */
export const CONDITIONAL_READ_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const WINDOW_MS = { m: 60_000, h: 60 * 60_000, d: 24 * 60 * 60_000 };

/** Parse a Smart Money window label ('24h', '30m', '7d') into milliseconds. */
export function parseEvidenceWindowMs(window = '24h') {
  const match = String(window || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([mhd])$/);
  if (!match) return WINDOW_MS.h * 24;
  return Number(match[1]) * WINDOW_MS[match[2]];
}

/**
 * A Smart Money index read is only evidence for its claimed window when the
 * index was actually built inside that window. `indexedAt` is the data time;
 * `at` is merely when this request read the snapshot, so it must never be
 * used as a freshness proof. A missing `indexedAt` cannot prove freshness.
 */
export function smartMoneyEvidenceFresh(evidence = null, { now = Date.now() } = {}) {
  const indexedAt = parseTimestamp(evidence?.indexedAt);
  if (indexedAt == null) return false;
  const ageMs = now - indexedAt;
  return ageMs >= -60_000 && ageMs <= parseEvidenceWindowMs(evidence?.window || '24h');
}

/** One conditional price read is fresh when it succeeded and is not ancient. */
export function isFreshConditionalRead(read = null, { now = Date.now() } = {}) {
  if (!read || read.ok !== true) return false;
  const at = parseTimestamp(read.at);
  if (at == null) return true; /* feed gave no timestamp; the read itself is this turn */
  const ageMs = now - at;
  return ageMs >= -60_000 && ageMs <= CONDITIONAL_READ_MAX_AGE_MS;
}

function hasConditionalEvidence(conditionalEvidence = null, { now = Date.now() } = {}) {
  const reads = Array.isArray(conditionalEvidence?.reads) ? conditionalEvidence.reads : [];
  if (!reads.length) return false;
  return reads.every((read) => isFreshConditionalRead(read, { now }));
}

function trustedContext(context = {}) {
  return TRUSTED_CONTEXT_SCHEMAS.has(String(context?.schema || ''));
}

function parseTimestamp(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function freshClientObservation(context = {}) {
  if (context.schema !== 'fbt.gateway-context.v1') return trustedContext(context);
  const market = context.market || {};
  const source = String(market.source || '').trim();
  const at = parseTimestamp(market.at || market.asOf || market.timestamp);
  if (!source || !at) return false;
  const ageMs = Date.now() - at;
  return ageMs >= -60_000 && ageMs <= 15 * 60_000;
}

function canonicalSymbol(value) {
  return String(value || '').toUpperCase().trim()
    .replace(/(?:[-_/](?:PERP|USD|USDT|USDC|PERPETUAL))+$/g, '')
    .replace(/(?:USDT|USDC)$/g, '');
}

function requestedSymbols(entities = {}) {
  return [...new Set([
    entities.token, entities.symbol, entities.asset,
    ...(Array.isArray(entities.tokens) ? entities.tokens : [])
  ].map(canonicalSymbol).filter(Boolean))];
}

function hasFiniteMarketValue(context = {}, entities = {}) {
  if (!trustedContext(context)) return false;
  const market = context.market;
  if (!market || BAD_DATA_STATUSES.has(String(market.dataStatus || '').toLowerCase())) return false;
  if (String(market.dataStatus || '').toLowerCase() !== 'live'
      && String(market.dataStatus || '').toLowerCase() !== 'observed') return false;
  if (!freshClientObservation(context)) return false;
  const prices = market.priceMap && typeof market.priceMap === 'object' ? market.priceMap : {};
  const metrics = market.metrics && typeof market.metrics === 'object' ? market.metrics : {};
  const symbols = requestedSymbols(entities);
  const known = [...Object.entries(prices), ...Object.entries(metrics)];
  if (symbols.length) {
    const marketSymbol = canonicalSymbol(market.symbol || market.asset || '');
    if (marketSymbol && symbols.includes(marketSymbol)
        && Object.values(metrics).some((value) => Number.isFinite(Number(value)))) return true;
    return known.some(([key, value]) => symbols.includes(canonicalSymbol(key))
      && value != null && value !== '' && Number.isFinite(Number(value))
      && Number(value) > 0);
  }
  return known.some(([, value]) => value != null && value !== ''
    && Number.isFinite(Number(value)) && Number(value) > 0);
}

function hasPortfolioValue(context = {}) {
  if (!trustedContext(context)) return false;
  const portfolio = context.portfolio || {};
  const value = portfolio.totalValueUsd;
  const status = String(portfolio.dataStatus || '').toLowerCase();
  if (context.schema === 'fbt.gateway-context.v1') {
    const source = String(portfolio.source || '').trim();
    const at = parseTimestamp(portfolio.at || portfolio.asOf || portfolio.timestamp);
    const ageMs = at == null ? Infinity : Date.now() - at;
    if (!source || ageMs < -60_000 || ageMs > 15 * 60_000) return false;
  }
  return value != null && value !== '' && Number.isFinite(Number(value))
    && !BAD_DATA_STATUSES.has(status)
    && (status === 'live' || status === 'observed' || status === 'client');
}

function hasYieldEvidence(context = {}) {
  if (!trustedContext(context)) return false;
  const status = String(context.dataStatus?.yield || '').toLowerCase();
  if (BAD_DATA_STATUSES.has(status) || (status && status !== 'live' && status !== 'observed')) return false;
  return Array.isArray(context.yields) && context.yields.some((row) => {
    const rowStatus = String(row?.dataStatus || '').toLowerCase();
    return row && !BAD_DATA_STATUSES.has(rowStatus)
      && row.apy != null && row.apy !== '' && Number.isFinite(Number(row.apy))
      && (row.symbol || row.protocol || row.id || row.source);
  });
}

function validWebSources(sources = [], { freshness = '' } = {}) {
  const usable = (Array.isArray(sources) ? sources : []).filter((source) => {
    const tier = Number(source?.tier);
    const title = String(source?.title || '').trim();
    const snippet = String(source?.snippet || source?.description || '').trim();
    try {
      const url = new URL(String(source?.url || ''));
      return url.protocol === 'https:' && title.length > 2 && snippet.length > 8
        && Number.isFinite(tier) && tier >= 1 && tier <= 3;
    } catch {
      return false;
    }
  });
  if (!usable.length) return [];
  if (String(freshness).toUpperCase() !== 'BREAKING') return usable;
  const hosts = new Set(usable.map((source) => {
    try { return new URL(source.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  }).filter(Boolean));
  return hosts.size >= 2 ? usable : [];
}

function hasOrchestrationEvidence(orchestration = null, { intent = '', live = false } = {}) {
  if (orchestration?.ok !== true || !String(orchestration?.answer || '').trim()) return false;
  const observedRows = Array.isArray(orchestration.evidence)
    ? orchestration.evidence.filter((row) => String(row?.status || '').toLowerCase() === 'observed')
    : [];
  const relevantObserved = observedRows.some((row) => {
    const facet = String(row?.facetId || '').toLowerCase();
    if (!live && facet === 'knowledge') return true;
    if (NEWS_INTENTS.has(intent)) return facet === 'news_flow';
    if (SMART_MONEY_INTENTS.has(intent)) return facet === 'smart_money';
    if (YIELD_INTENTS.has(intent)) return facet === 'yield_rates';
    if (['WALLET_BALANCE', 'ORDERS'].includes(intent)) return facet === 'portfolio_state';
    if (PORTFOLIO_INTENTS.has(intent)) return ['portfolio_state', 'wallet_state'].includes(facet);
    if (MARKET_PRICE_INTENTS.has(intent)) return ['market_prices', 'asset_regime', 'macro_state'].includes(facet);
    if (live) return ['market_prices', 'asset_regime', 'news_flow', 'macro_state', 'yield_rates', 'smart_money'].includes(facet);
    return Boolean(facet && facet !== 'past_decisions');
  });
  const citedPassage = !live && Array.isArray(orchestration.passages) && orchestration.passages.some((passage) => {
    const reference = passage?.cite || passage?.url || passage?.id;
    const description = passage?.text || passage?.content || passage?.title;
    return passage?.status !== 'unverified' && passage?.status !== 'deprecated'
      && Boolean(String(reference || '').trim()) && String(description || '').trim().length > 8;
  });
  return relevantObserved || citedPassage;
}

/**
 * Return the independent evidence sources available to support this answer.
 * A provider/model response by itself is deliberately not counted.
 */
export function assessAnswerEvidence({
  context = {},
  collaboration = null,
  orchestration = null,
  productRead = null,
  tokenCard = null,
  smartMoneyEvidence = null,
  conditionalEvidence = null,
  entities = {},
  intentType = null,
  freshness = null
} = {}) {
  const sources = [];
  const evidence = collaboration?.evidence || {};
  const intent = String(intentType || '').toUpperCase();
  const freshnessTag = String(freshness || '').toUpperCase();
  const live = ['LIVE', 'BREAKING', 'RECENT'].includes(freshnessTag);
  const marketValue = hasFiniteMarketValue(context, entities);
  const portfolioValue = hasPortfolioValue(context);
  const yieldValue = hasYieldEvidence(context);

  if (productRead?.confidence === 'verified') sources.push('verified-product-knowledge');
  if (marketValue && MARKET_PRICE_INTENTS.has(intent)) sources.push('market-tool');
  if (portfolioValue && PORTFOLIO_INTENTS.has(intent)) sources.push('portfolio-tool');
  if (yieldValue && YIELD_INTENTS.has(intent)) sources.push('yield-tool');
  const requested = requestedSymbols(entities);
  const cardSymbol = canonicalSymbol(tokenCard?.symbol || '');
  const cardFresh = !BAD_DATA_STATUSES.has(String(tokenCard?.dataStatus || '').toLowerCase());
  const cardMatches = !requested.length || (cardSymbol && requested.includes(cardSymbol));
  if (cardFresh && cardMatches && Number.isFinite(Number(tokenCard?.priceUsd)) && Number(tokenCard.priceUsd) > 0) {
    sources.push('token-card');
  }
  /* A static FBT passage cannot substantiate a live price, latest news or
     another RECENT claim. It remains valid for static/educational answers. */
  if (evidence.knowledgeUsed === true && !live) sources.push('verified-knowledge');
  const webSources = validWebSources(collaboration?.sources, { freshness: freshnessTag });
  if (evidence.webUsed === true && webSources.length) sources.push('web-source');
  if (SMART_MONEY_INTENTS.has(intent) && smartMoneyEvidence
      && ['observed', 'insufficient-evidence'].includes(String(smartMoneyEvidence.dataStatus || '').toLowerCase())
      && Array.isArray(smartMoneyEvidence.rows)
      && smartMoneyEvidenceFresh(smartMoneyEvidence)) {
    sources.push('smart-money-index');
  }
  if (hasConditionalEvidence(conditionalEvidence)) sources.push('conditional-price-reads');
  const groundedSources = new Set([
    'verified-product-knowledge', 'market-tool', 'portfolio-tool', 'yield-tool',
    'token-card', 'verified-knowledge', 'web-source', 'smart-money-index',
    'conditional-price-reads'
  ]);
  if (evidence.internalSynthesis === true && sources.some((source) => groundedSources.has(source))) {
    sources.push('grounded-internal-synthesis');
  }
  if (hasOrchestrationEvidence(orchestration, { intent, live })) sources.push('orchestrator-evidence');

  const uniqueSources = [...new Set(sources)];
  return {
    schema: AI_EVIDENCE_POLICY_SCHEMA,
    available: uniqueSources.length > 0,
    sources: uniqueSources,
    reason: uniqueSources.length ? 'TRUSTED_EVIDENCE_AVAILABLE' : 'NO_TRUSTED_EVIDENCE'
  };
}

/**
 * Whether a response path is expected to make factual claims that require
 * grounding. Social turns, UI navigation and already-authorized handoffs are
 * excluded; the latter are handled by their own explicit confirmation gates.
 */
export function answerRequiresEvidence({
  answerPath = null,
  freshness = null,
  intentType = null,
  conversationKind = null,
  socialHandled = false,
  pendingIntent = false,
  actionPlan = false,
  uiType = null,
  productVerified = false,
  nonFactualResponse = false,
  /* ─── EXPLANATION, NOT OBSERVATION (2026-11-19) ──────────────────────────
   * A question that asks what something IS, how it works, or what to do is
   * answered from stable knowledge and reasoning; it does not need a live
   * quote, and demanding one turned «ایمپرمننت لاس چیه؟» into «منبع
   * تأییدشده‌ای ندارم». This flag comes from server/aiQuestionShape.js, which
   * refuses to set it the moment the question names a price, today's news or
   * the user's own balance — those still require verified data.
   */
  conceptual = false
} = {}) {
  if (socialHandled || pendingIntent || actionPlan || productVerified || nonFactualResponse) return false;
  if (conceptual && !['LIVE', 'BREAKING', 'RECENT'].includes(String(freshness || '').toUpperCase())) return false;
  if (['ACTION_CARD', 'CHOICE', 'CONNECT_WALLET'].includes(String(uiType || '').toUpperCase())) return false;
  if (NON_ANSWER_INTENTS.has(String(intentType || '').toUpperCase())) return false;
  const kind = String(conversationKind || '').toUpperCase();
  if (['GREETING', 'THANKS', 'CASUAL'].includes(kind)) return false;
  if (EVIDENCE_ANSWER_PATHS.has(String(answerPath || '').toUpperCase())) return true;
  if (CURRENT_DATA_INTENTS.has(String(intentType || '').toUpperCase())) return true;
  if (['LIVE', 'BREAKING', 'RECENT'].includes(String(freshness || '').toUpperCase())) return true;
  /* A «what's up?» brief is still a current-data answer, and an action question
     still needs facts. Emotional acknowledgements alone do not. */
  return ['QUESTION', 'FOLLOW_UP', 'WHATS_UP', 'ACTION'].includes(kind);
}

function localizedQuestion(value, lang) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String((lang === 'fa' ? value.fa : value.en) || value.en || value.fa || '').trim();
}

/**
 * Explicit, actionable no-evidence fallback. It never fills an unknown value.
 */
export function buildEvidenceLimitationReply({
  locale = 'fa',
  intentType = 'GENERAL',
  freshness = null,
  minimalQuestion = null,
  partialQuestion = null,
  clarificationOnly = false,
  providerAnswered = null
} = {}) {
  const lang = String(locale || 'fa').toLowerCase().startsWith('fa') ? 'fa' : 'en';
  const intent = String(intentType || 'GENERAL').toUpperCase();
  const question = localizedQuestion(minimalQuestion, lang) || localizedQuestion(partialQuestion, lang);
  const providerNote = providerAnswered === false
    ? (lang === 'fa'
      ? ' هیچ ارائه‌دهندهٔ مدل زنده‌ای در این نوبت پاسخ نداد.'
      : ' No live AI provider returned an answer in this turn.')
    : '';
  const finish = (text) => `${text}${providerNote}`;

  /* The caller appends the existing read-back + the ONE slot question below. */
  if (clarificationOnly) {
    return finish(lang === 'fa'
      ? 'در این نوبت شاهد تأییدشدهٔ کافی ندارم و بخش نامشخص را حدس نمی‌زنم.'
      : 'I do not have enough verified evidence in this turn, so I will not guess the missing detail.');
  }

  if (question) {
    return finish(lang === 'fa'
      ? `در این نوبت شاهد تأییدشدهٔ کافی ندارم و اطلاعاتِ جاافتاده را حدس نمی‌زنم. ${question}`
      : `I do not have enough verified evidence in this turn, so I will not guess the missing information. ${question}`);
  }

  if (['WALLET_BALANCE', 'PORTFOLIO_ANALYSIS', 'ORDERS', 'BTC_WALLET'].includes(intent)) {
    return finish(lang === 'fa'
      ? 'در این نوبت به دادهٔ تأییدشدهٔ کیف پول یا پرتفوی دسترسی ندارم؛ موجودی یا موقعیت‌ها را حدس نمی‌زنم. کیف پول را متصل/انتخاب کنید یا خلاصهٔ بدون اطلاعات حساس را بفرستید تا دوباره بررسی کنم.'
      : 'I do not have verified wallet or portfolio data in this turn, so I will not guess balances or positions. Connect/select the wallet or share a non-sensitive summary, then I can check again.');
  }

  const current = ['LIVE', 'BREAKING', 'RECENT'].includes(String(freshness || '').toUpperCase())
    || ['MARKET_ANALYSIS', 'MARKET_CONTEXT', 'NEWS_SEARCH', 'ANALYZE_TOKEN', 'SMART_MONEY', 'WHALE', 'SIGNALS', 'YIELD_DISCOVERY', 'STOCKS'].includes(intent);
  if (current) {
    return finish(lang === 'fa'
      ? 'برای این درخواست تازه یا بازاری، در این نوبت منبع زندهٔ تأییدشده‌ای ندارم؛ قیمت، خبر یا روند را حدس نمی‌زنم. دارایی و بازهٔ زمانی را مشخص کنید یا منبع معتبری بفرستید تا بر پایهٔ همان ادامه بدهم.'
      : 'I do not have a verified live source for this current or market request, so I will not guess a price, news item or trend. Specify the asset and time window, or share a reliable source, and I can continue from it.');
  }

  return finish(lang === 'fa'
    ? 'برای پاسخ قابل اتکا، در این نوبت شاهد یا منبع تأییدشده‌ای ندارم و نتیجه را حدس نمی‌زنم. پرسش را با موضوع/دارایی و بازهٔ موردنظرت دقیق‌تر کنید یا منبع معتبری بفرستید تا بر پایهٔ همان ادامه بدهم.'
    : 'I do not have a verified source for a reliable answer in this turn, so I will not guess. Narrow the topic/asset and time window or share a reliable source, and I can continue from it.');
}
