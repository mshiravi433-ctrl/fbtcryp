/**
 * FBT INTENT OS — UPGRADE 7 · Confidence · Freshness · No-Hallucination
 * ---------------------------------------------------------------------------
 * Spec §14 (confidence + data freshness + source quality), §15 (fresh-data
 * awareness before market-sensitive answers), §16 (fact/signal/interpretation/
 * speculation labelling), §26 (no hallucination layer), §29 (explainability).
 *
 * `os/confidenceEngine.js` already scores a turn and stays untouched. This layer
 * answers the two questions it does not: *is the data allowed to be this old*,
 * and *is there a real source behind this claim at all*.
 */

export const CONFIDENCE7_SCHEMA = 'fbt.confidence.v7';

/* -------------------------------------------------------------------------- */
/*  §15 FRESHNESS POLICY                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Maximum age a value may have before it must be re-read. Price, balance,
 * quote and transaction status are never served from a stale cache — those are
 * the four the spec names explicitly.
 */
export const MAX_AGE_MS = Object.freeze({
  price: 30_000,
  balance: 20_000,
  quote: 15_000,
  transaction: 10_000,
  portfolio: 60_000,
  market: 120_000,
  news: 900_000,
  onchain: 300_000,
  yield: 600_000,
  static: Infinity
});

const MARKET_SENSITIVE = new Set(['price', 'balance', 'quote', 'transaction']);

export function classifyDataNeed({ intentType = '', deepIntent = null, message = '' } = {}) {
  const type = String(intentType || '').toUpperCase();
  const t = String(message || '').toLowerCase();
  const needs = new Set();

  if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND', 'DCA'].includes(type)) {
    needs.add('price'); needs.add('balance'); needs.add('quote');
  }
  if (['WALLET_BALANCE', 'PORTFOLIO_ANALYSIS', 'REBALANCE'].includes(type)) {
    needs.add('balance'); needs.add('portfolio'); needs.add('price');
  }
  if (['MARKET_ANALYSIS', 'MARKET_CONTEXT', 'ANALYZE_TOKEN', 'SIGNALS'].includes(type)) {
    needs.add('price'); needs.add('market');
  }
  if (['NEWS_SEARCH'].includes(type) || /چرا|why|خبر|news/.test(t)) needs.add('news');
  if (['SMART_MONEY', 'WHALE'].includes(type)) needs.add('onchain');
  if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(type)) needs.add('yield');
  if (['ORDERS', 'FUTURES'].includes(type)) needs.add('transaction');
  if (/قیمت|price/.test(t)) needs.add('price');
  if (/موجودی|balance/.test(t)) needs.add('balance');

  const list = [...needs];
  return {
    needs: list,
    marketSensitive: list.some((n) => MARKET_SENSITIVE.has(n)),
    requiresLive: list.filter((n) => MARKET_SENSITIVE.has(n))
  };
}

/**
 * @param {object} snapshots  { price: {value, fetchedAt, source}, ... }
 */
export function evaluateFreshness(need, snapshots = {}, now = Date.now()) {
  const results = [];
  for (const kind of need.needs || []) {
    const snap = snapshots[kind];
    const fetchedAt = Number(snap?.fetchedAt ?? snap?.updatedAt ?? snap?.timestamp);
    const maxAge = MAX_AGE_MS[kind] ?? 120_000;
    if (!snap || !Number.isFinite(fetchedAt)) {
      results.push({ kind, status: 'missing', ageMs: null, maxAge, mustRefetch: true, source: snap?.source || null });
      continue;
    }
    const ageMs = now - fetchedAt;
    const stale = ageMs > maxAge;
    results.push({
      kind, ageMs, maxAge, source: snap.source || null,
      status: stale ? 'stale' : 'fresh',
      // A market-sensitive value that went stale is not "old data we can caveat":
      // it must be read again before the answer is allowed out.
      mustRefetch: stale && MARKET_SENSITIVE.has(kind)
    });
  }
  const worst = results.reduce((acc, r) => (r.status === 'missing' ? 'missing' : (r.status === 'stale' && acc !== 'missing' ? 'stale' : acc)), 'fresh');
  const newest = results.filter((r) => Number.isFinite(r.ageMs)).sort((a, b) => a.ageMs - b.ageMs)[0] || null;
  return {
    items: results,
    overall: worst,
    mustRefetch: results.some((r) => r.mustRefetch),
    refetchKinds: results.filter((r) => r.mustRefetch).map((r) => r.kind),
    newestAgeMs: newest?.ageMs ?? null,
    label: worst === 'fresh' ? 'LIVE' : worst === 'stale' ? 'STALE' : 'UNAVAILABLE'
  };
}

export function freshnessNotice(freshness, locale = 'fa') {
  const fa = String(locale || 'fa').startsWith('fa');
  if (!freshness || freshness.overall === 'fresh') {
    const s = Math.round((freshness?.newestAgeMs ?? 0) / 1000);
    if (!Number.isFinite(s)) return null;
    return fa ? `داده به‌روزرسانی شده: ${s} ثانیه پیش` : `Data updated: ${s} seconds ago`;
  }
  if (freshness.overall === 'stale') {
    return fa ? 'ممکن است داده بازار به‌روز نباشد.' : 'Market data may be outdated.';
  }
  return fa ? 'برای بخشی از این پاسخ داده تاییدشده در دسترس نیست.' : 'Verified data is not available for part of this answer.';
}

/* -------------------------------------------------------------------------- */
/*  §14 SOURCE QUALITY                                                          */
/* -------------------------------------------------------------------------- */

const SOURCE_TIER = Object.freeze({
  onchain: 1.0, wallet: 1.0, rpc: 1.0,
  exchange: 0.92, aggregator: 0.9, oracle: 0.9,
  api: 0.85, provider: 0.85,
  cache: 0.7, derived: 0.65,
  news: 0.6, social: 0.4, model: 0.35, unknown: 0.3
});

export function scoreSourceQuality(sources = []) {
  const list = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
  if (!list.length) return { score: 0, tier: 'none', sources: [] };
  const scored = list.map((s) => {
    const key = String(s?.kind || s?.type || s || 'unknown').toLowerCase();
    const match = Object.keys(SOURCE_TIER).find((k) => key.includes(k)) || 'unknown';
    return { source: key, weight: SOURCE_TIER[match] };
  });
  const score = scored.reduce((a, s) => a + s.weight, 0) / scored.length;
  return {
    score: Math.round(score * 100) / 100,
    tier: score >= 0.9 ? 'primary' : score >= 0.7 ? 'secondary' : 'weak',
    sources: scored
  };
}

/* -------------------------------------------------------------------------- */
/*  §26 NO-HALLUCINATION LAYER                                                  */
/* -------------------------------------------------------------------------- */

/** Claims that may never be produced without a verified source behind them. */
export const GUARDED_CLAIMS = Object.freeze([
  'wallet_balance', 'transaction_status', 'price', 'profit', 'order_status',
  'position', 'apy', 'gas_fee'
]);

/**
 * @param {object} claims  { price: {value, source}, wallet_balance: {...} }
 * @returns verdict describing which claims are allowed out.
 */
export function verifyClaims(claims = {}, { locale = 'fa' } = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const verified = [];
  const unverified = [];

  for (const [key, claim] of Object.entries(claims)) {
    if (!GUARDED_CLAIMS.includes(key)) { verified.push({ claim: key, guarded: false }); continue; }
    const hasValue = claim != null && claim.value != null && claim.value !== '';
    const hasSource = Boolean(claim?.source || claim?.provider || claim?.tool);
    const fresh = claim?.fetchedAt ? (Date.now() - Number(claim.fetchedAt)) <= (MAX_AGE_MS[key.split('_')[0]] ?? 120_000) : true;
    if (hasValue && hasSource && fresh) verified.push({ claim: key, guarded: true, source: claim.source || claim.provider || claim.tool });
    else unverified.push({ claim: key, reason: !hasValue ? 'NO_VALUE' : !hasSource ? 'NO_SOURCE' : 'STALE' });
  }

  return {
    ok: unverified.length === 0,
    verified,
    unverified,
    // The exact sentence the spec asks for, instead of a guess.
    fallbackMessage: unverified.length
      ? (fa ? 'در حال حاضر داده تاییدشده‌ای برای این مورد ندارم.' : "I don't currently have verified data for this.")
      : null
  };
}

/** Belt-and-braces: strip a numeric claim that no source backs. */
export function assertSourced(claimKey, value, source) {
  if (!GUARDED_CLAIMS.includes(claimKey)) return { ok: true, value };
  if (value == null || !source) {
    return { ok: false, value: null, reason: value == null ? 'NO_VALUE' : 'NO_SOURCE' };
  }
  return { ok: true, value, source };
}

/* -------------------------------------------------------------------------- */
/*  §16 FACT / SIGNAL / INTERPRETATION / SPECULATION                            */
/* -------------------------------------------------------------------------- */

export const EPISTEMIC = Object.freeze({
  FACT: 'fact', SIGNAL: 'signal', INTERPRETATION: 'interpretation', SPECULATION: 'speculation'
});

const LABELS = {
  fa: { fact: 'واقعیت', signal: 'سیگنال', interpretation: 'تفسیر', speculation: 'گمانه‌زنی' },
  en: { fact: 'Fact', signal: 'Signal', interpretation: 'Interpretation', speculation: 'Speculation' }
};

export function classifyStatement(text, { source = null } = {}) {
  const t = String(text || '').toLowerCase();
  if (/(ممکن است|شاید|احتمالا|might|may|could|probably|احتمالاً|پیش‌بینی می‌کنم|expect)/.test(t)) return EPISTEMIC.SPECULATION;
  if (/(به نظر می‌رسد|نشان می‌دهد|suggests|indicates|به احتمال زیاد|likely)/.test(t)) return EPISTEMIC.INTERPRETATION;
  if (/(جریان|حجم|روند|inflow|outflow|volume|trend|whale|signal|سیگنال)/.test(t)) return EPISTEMIC.SIGNAL;
  if (source) return EPISTEMIC.FACT;
  return EPISTEMIC.INTERPRETATION;
}

export function labelStatements(statements = [], locale = 'fa') {
  const lang = String(locale || 'fa').startsWith('fa') ? 'fa' : 'en';
  return statements.map((s) => {
    const text = typeof s === 'string' ? s : s.text;
    const source = typeof s === 'string' ? null : s.source;
    const kind = (typeof s === 'object' && s.kind) || classifyStatement(text, { source });
    return { text, kind, source: source || null, label: LABELS[lang][kind] };
  });
}

/* -------------------------------------------------------------------------- */
/*  §14 COMBINED VERDICT                                                        */
/* -------------------------------------------------------------------------- */

export function buildConfidenceReport({
  baseConfidence = null, synthesis = null, freshness = null, sourceQuality = null, claims = null, locale = 'fa'
} = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  let score = Number(baseConfidence?.confidenceScore);
  if (!Number.isFinite(score)) score = 70;

  const factors = [];
  if (synthesis?.divergence) { score -= 25; factors.push({ name: 'AGENT_DIVERGENCE', delta: -25 }); }
  else if (synthesis?.agreement === 1 && (synthesis.contributingAgents?.length || 0) >= 3) { score += 6; factors.push({ name: 'AGENT_CONSENSUS', delta: +6 }); }

  if (freshness?.overall === 'stale') { score -= 15; factors.push({ name: 'STALE_DATA', delta: -15 }); }
  if (freshness?.overall === 'missing') { score -= 25; factors.push({ name: 'MISSING_DATA', delta: -25 }); }

  if (sourceQuality?.tier === 'primary') { score += 5; factors.push({ name: 'PRIMARY_SOURCE', delta: +5 }); }
  if (sourceQuality?.tier === 'weak') { score -= 10; factors.push({ name: 'WEAK_SOURCE', delta: -10 }); }

  if (claims && claims.ok === false) { score -= 20; factors.push({ name: 'UNVERIFIED_CLAIM', delta: -20 }); }

  const final = Math.max(10, Math.min(98, Math.round(score)));
  const label = final >= 85 ? 'HIGH' : final >= 65 ? 'MODERATE' : 'LOW';

  const notices = [];
  const fn = freshnessNotice(freshness, locale);
  if (fn) notices.push(fn);
  if (synthesis?.warning) notices.push(synthesis.warning);
  if (claims?.fallbackMessage) notices.push(claims.fallbackMessage);

  return {
    schema: CONFIDENCE7_SCHEMA,
    score: final,
    label,
    labelFa: label === 'HIGH' ? 'بالا' : label === 'MODERATE' ? 'متوسط' : 'پایین',
    display: fa ? `اطمینان: ${label === 'HIGH' ? 'بالا' : label === 'MODERATE' ? 'متوسط' : 'پایین'}` : `Confidence: ${label[0]}${label.slice(1).toLowerCase()}`,
    dataFreshness: freshness?.label || 'UNKNOWN',
    sourceQuality: sourceQuality?.tier || 'unknown',
    factors,
    notices,
    requiresCaveat: label === 'LOW' || freshness?.overall !== 'fresh',
    createdAt: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/*  §29 EXPLAINABILITY — the result, never the reasoning                        */
/* -------------------------------------------------------------------------- */

export function buildExplanation({
  recommendation = null, dataUsed = [], risks = [], whatCanGoWrong = [], nextAction = null, locale = 'fa'
} = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  return {
    schema: 'fbt.explanation.v7',
    why: recommendation || null,
    dataUsed: dataUsed.filter(Boolean),
    risks: risks.filter(Boolean),
    whatCanGoWrong: whatCanGoWrong.filter(Boolean),
    nextAction: nextAction || null,
    headings: fa
      ? { why: 'چرا این پیشنهاد؟', dataUsed: 'از چه داده‌ای استفاده شد؟', risks: 'ریسک‌ها', whatCanGoWrong: 'چه چیزی ممکن است اشتباه پیش برود؟', nextAction: 'چه اتفاقی می‌افتد؟' }
      : { why: 'Why this recommendation?', dataUsed: 'What data was used?', risks: 'What are the risks?', whatCanGoWrong: 'What can go wrong?', nextAction: 'What action will happen?' }
  };
}
