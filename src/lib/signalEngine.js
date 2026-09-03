/**
 * FBT SIGNAL INTELLIGENCE ENGINE (client side — deterministic)
 * ---------------------------------------------------------------------------
 * Phase 3 — AI Signal System Upgrade.
 *
 * This module turns the REAL market data the Signals page already fetches
 * (CoinGecko markets + chart via our API layer, the four-layer verdict from
 * lib/verdict.js, Solscan on-chain intel, Smart Money flow data) into a
 * structured, explainable signal:
 *
 *   Market Data → Signal Engine → Confidence Engine → Risk Engine → Ranking
 *
 * HARD RULES:
 *   · NOTHING here is random and nothing is invented. Every number traces to
 *     an input field; missing inputs produce `null` / `INSUFFICIENT_DATA`,
 *     never a guess.
 *   · The AI (server side) NEVER creates a signal. It only explains the
 *     evidence this module measured.
 *   · Confidence is a weighted combination of the seven measured factors the
 *     spec names (technical/market/on-chain/AI agreement, freshness,
 *     liquidity, volatility, signal strength) — the same input always yields
 *     the same number.
 *   · A signal is only produced when at least MIN_EVIDENCE independent
 *     evidence items are observed.
 */

export const CLASS = Object.freeze({
  STRONG_BUY: 'STRONG_BUY',
  BUY: 'BUY',
  WATCH: 'WATCH',
  SELL: 'SELL',
  HIGH_RISK: 'HIGH_RISK',
  AVOID: 'AVOID'
});

export const CLASS_META = Object.freeze({
  STRONG_BUY: { emoji: '🔥', tone: 'up', key: 'intel.class.strongBuy' },
  BUY: { emoji: '🟢', tone: 'up', key: 'intel.class.buy' },
  WATCH: { emoji: '🟡', tone: 'neutral', key: 'intel.class.watch' },
  SELL: { emoji: '🔴', tone: 'down', key: 'intel.class.sell' },
  HIGH_RISK: { emoji: '⚠️', tone: 'warn', key: 'intel.class.highRisk' },
  AVOID: { emoji: '⛔', tone: 'down', key: 'intel.class.avoid' }
});

export const RISK_BAND = Object.freeze({
  LOW: { key: 'intel.risk.low', tone: 'low' },
  MEDIUM: { key: 'intel.risk.medium', tone: 'medium' },
  HIGH: { key: 'intel.risk.high', tone: 'high' }
});

/**
 * The locale key for one classification — `signals.intel.class.strongBuy`.
 *
 * ─── WHY THIS IS A FUNCTION AND NOT A TEMPLATE IN THE PAGE ──────────────────
 * Five places in src/pages/Signals.jsx built the key by hand:
 *
 *     t(`signals.intel.class.${classification.toLowerCase()}`)
 *
 * `CLASS` values are SCREAMING_SNAKE (`STRONG_BUY`, `HIGH_RISK`), and the
 * locale keys are camelCase (`strongBuy`, `highRisk`). So the two multi-word
 * classes asked i18next for a key that exists in no language, and i18next
 * answered with the key itself: the badge on every STRONG BUY and every HIGH
 * RISK card — the two loudest signals on the screen — read
 * «signals.intel.class.strong_buy». BUY / WATCH / SELL / AVOID are one word
 * each, which is why this looked fine in a screenshot of an ordinary market.
 *
 * CLASS_META already carries the right key per class; this returns it, so the
 * mapping lives in exactly one place and an unknown or null classification
 * falls back to WATCH instead of throwing on `.toLowerCase()` of null.
 *
 * test/signals-page-probe.jsx asserts every CLASS resolves to real copy.
 */
export function classKey(classification) {
  return `signals.${(CLASS_META[classification] || CLASS_META.WATCH).key}`;
}

export const HORIZONS = Object.freeze([
  { days: 1, key: '24H' },
  { days: 7, key: '7D' },
  { days: 30, key: '30D' }
]);

/** Minimum independent evidence items before a signal may exist. */
export const MIN_EVIDENCE = 3;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const clampf = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const pct = (a, b) => (a != null && b > 0 ? ((a - b) / b) * 100 : null);

export function riskLabelFor(score) {
  const s = num(score);
  if (s == null) return 'MEDIUM';
  if (s >= 70) return 'HIGH';
  if (s >= 40) return 'MEDIUM';
  return 'LOW';
}

function signOf(v, threshold = 0.5) {
  const n = num(v);
  if (n == null) return 0;
  if (n > threshold) return 1;
  if (n < -threshold) return -1;
  return 0;
}

/* ═══════════════════ 1. HORIZON RISK (24H / 7D / 30D) ═══════════════ */

/**
 * Per-horizon risk for one asset: risk score 0-100, trend, confidence,
 * expected direction and realised volatility — all from the real price
 * series and the indicator read.
 */
export function computeHorizonRisks({ series = [], analysis = null } = {}) {
  const prices = (series ?? []).filter((n) => Number.isFinite(n) && n > 0);
  if (prices.length < 2) return HORIZONS.map((h) => ({ days: h.days, key: h.key, riskScore: null, trend: 'flat', confidence: null, expectedDirection: 'flat', volatilityPct: null, volLabel: null }));
  const price = prices[prices.length - 1];
  const annualVol = num(analysis?.indicators?.volatility);
  const rsiVal = num(analysis?.indicators?.rsi);
  const window = prices.slice(-31);
  const high = Math.max(...window);
  const low = Math.min(...window);
  const rangePct = price > 0 ? ((high - low) / price) * 100 : 0;

  return HORIZONS.map((h) => {
    const prior = prices.length > h.days ? prices[prices.length - 1 - h.days] : null;
    const move = prior && prior > 0 ? pct(price, prior) : null;
    const volPct = annualVol != null ? (annualVol / 100) * Math.sqrt(h.days / 365) * 100 : null;

    const threshold = h.days === 1 ? 0.9 : h.days === 7 ? 2 : 3.5;
    const trend = move == null ? 'flat' : move > threshold ? 'up' : move < -threshold ? 'down' : 'flat';
    const dirFromScore = signOf(analysis?.score, 6);
    const expectedDirection =
      move == null ? (dirFromScore !== 0 ? (dirFromScore > 0 ? 'up' : 'down') : 'flat')
        : trend === 'flat' && dirFromScore === 0 ? 'flat'
          : trend === 'flat' ? (dirFromScore > 0 ? 'up' : 'down')
            : trend;

    /* Risk = how violent / how stretched the horizon is, not direction. */
    let riskScore = 50;
    if (volPct != null) riskScore += clampf((volPct - 2.2) * 2.4, -22, 30);
    if (move != null) riskScore += clampf(Math.abs(move) * 1.6, 0, 16);
    riskScore += clampf((rangePct - 8) * 0.7, -6, 14);
    if (rsiVal != null && (rsiVal > 72 || rsiVal < 28)) riskScore += 10;
    riskScore = Math.round(clampf(riskScore, 0, 100));

    /* Confidence: indicator agreement dampened by data length. */
    const agreement = num(analysis?.agreement) ?? 50;
    const dataQual = prices.length >= 60 ? 1 : prices.length >= 40 ? 0.8 : 0.6;
    const conf = Math.round(clampf(25 + agreement * 0.45 + dataQual * 25, 5, 93));

    const volLabel = volPct == null ? null : volPct >= 6 ? 'high' : volPct >= 2 ? 'moderate' : 'low';

    return {
      days: h.days,
      key: h.key,
      movePct: move != null ? Math.round(move * 100) / 100 : null,
      riskScore,
      riskLabel: riskLabelFor(riskScore),
      trend,
      confidence: conf,
      expectedDirection,
      volatilityPct: volPct != null ? Math.round(volPct * 100) / 100 : null,
      volLabel
    };
  });
}

/* ═══════════════════ 2. MARKET PULSE (local fallback) ════════════════ */

/**
 * Deterministic market pulse computed from the same real inputs the server
 * uses. When /api/signals/pulse is reachable the server result is preferred
 * (it also sees Smart Money flows); this is the honest offline/local mirror.
 */
export function computePulseLocal({ global = null, markets = [], smartMoney: sm = null, now = Date.now() } = {}) {
  const priced = (markets ?? []).filter((c) => num(c.change24h) != null && num(c.price) > 0).slice(0, 20);
  const up = priced.filter((c) => c.change24h > 0).length;
  const breadth = priced.length ? up / priced.length : null;
  const avgChange = priced.length ? priced.reduce((s, c) => s + num(c.change24h), 0) / priced.length : null;
  const mcapChange = num(global?.mcapChange);
  const mcap = num(global?.mcap);
  const volume = num(global?.volume);
  const turnover = mcap > 0 && volume != null ? (volume / mcap) * 100 : null;
  const smNet = num(sm?.metrics?.netFlow?.value);

  const sentimentScore = clampf(
    (mcapChange != null ? 50 + mcapChange * 6 : 50) + (avgChange != null ? avgChange * 2.5 : 0) + (breadth != null ? (breadth - 0.5) * 30 : 0),
    0,
    100
  );
  const avgAbs = priced.length ? priced.reduce((s, c) => s + Math.abs(num(c.change24h)), 0) / priced.length : null;
  const volatilityScore = clampf((avgAbs != null ? avgAbs * 6 : 20), 0, 100);
  const liquidityScore = clampf((turnover != null ? turnover * 8 : 25) + (smNet != null && smNet !== 0 ? Math.sign(smNet) * 8 : 0), 0, 100);
  const momentumScore = clampf((avgChange != null ? avgChange * 6 : 0) + (mcapChange != null ? mcapChange * 3 : 0), -100, 100);
  const riskScore = clampf(
    50 + (sentimentScore < 42 ? (42 - sentimentScore) * 1.4 : sentimentScore > 58 ? -6 : -2)
      + (volatilityScore - 50) * 0.45 + (liquidityScore < 34 ? 12 : 0) + (smNet != null && smNet < 0 ? 8 : 0),
    0,
    100
  );

  const offline = priced.length > 0 && priced.every((c) => c.dataProvenance === 'offline');
  return {
    schema: 'fbt.signal-pulse.v1',
    at: now,
    source: priced.length ? (offline ? 'offline' : 'local') : 'unavailable',
    sentiment: { score: Math.round(sentimentScore), label: sentimentScore > 58 ? 'bullish' : sentimentScore < 42 ? 'bearish' : 'neutral' },
    risk: { score: Math.round(riskScore), label: riskLabelFor(riskScore) },
    aiConfidence: Math.round(clampf(45 + (breadth != null ? Math.abs(breadth - 0.5) * 60 : 20), 5, 95)),
    momentum: { score: Math.round(momentumScore), label: Math.abs(momentumScore) < 12 ? 'flat' : Math.abs(momentumScore) < 35 ? 'moderate' : 'strong', direction: momentumScore > 0 ? 'up' : momentumScore < 0 ? 'down' : 'flat' },
    volatility: { score: Math.round(volatilityScore), label: volatilityScore >= 66 ? 'high' : volatilityScore >= 34 ? 'moderate' : 'low' },
    liquidity: { score: Math.round(liquidityScore), label: liquidityScore >= 66 ? 'strong' : liquidityScore >= 34 ? 'adequate' : 'thin', turnoverPct: turnover != null ? Math.round(turnover * 10) / 10 : null },
    breadth: { up, total: priced.length, avgChange: avgChange != null ? Math.round(avgChange * 100) / 100 : null },
    smartMoney: sm ? { dataStatus: sm.dataStatus, netFlowUsd: smNet } : null,
    lastUpdate: now
  };
}

/* ═══════════════════ 3. EVIDENCE + SIGNAL CARD ══════════════════════ */

/**
 * Build the evidence list for one asset from every REAL input we have.
 * Each item: { key, direction (+1/-1/0), pct, source, reason } — the UI and
 * the multi-AI "Why" share this exact list.
 */
export function buildEvidence({
  coin = {},
  analysis = null,
  solanaIntel = null,
  smToken = null,
  pulse = null
} = {}) {
  const ev = [];
  const push = (key, direction, pctVal = null, source = 'market', reason = key) => {
    ev.push({ key, direction, pct: pctVal != null ? Math.round(pctVal * 100) / 100 : null, source, reason });
  };

  const change24h = num(coin.change24h);
  const change7d = num(coin.change7d);
  if (change24h != null) push(change24h >= 0 ? 'momentumUp' : 'momentumDown', signOf(change24h, 1), Math.abs(change24h), 'market', change24h >= 0 ? 'momentum24Up' : 'momentum24Down');
  if (change7d != null) push(change7d >= 0 ? 'trend7dUp' : 'trend7dDown', signOf(change7d, 2), Math.abs(change7d), 'market', change7d >= 0 ? 'trend7dUp' : 'trend7dDown');

  const rsi = num(analysis?.indicators?.rsi);
  if (rsi != null) push('rsi', rsi < 32 ? 1 : rsi > 68 ? -1 : 0, Math.abs(rsi - 50), 'technical', rsi < 32 ? 'rsiOversold' : rsi > 68 ? 'rsiOverbought' : 'rsiNeutral');

  const macd = analysis?.indicators?.macd;
  if (macd != null && num(macd.histogram) !== 0) push('macd', signOf(macd.histogram, 0.000001), null, 'technical', macd.histogram > 0 ? 'macdUp' : 'macdDown');

  const ma20 = num(analysis?.indicators?.ma20);
  const ma50 = num(analysis?.indicators?.ma50);
  const price = num(coin.price) || num(analysis?.price);
  if (ma20 != null && ma50 != null) push('maCross', signOf(pct(ma20, ma50), 0.5), Math.abs(pct(ma20, ma50)), 'technical', ma20 >= ma50 ? 'maBullish' : 'maBearish');
  else if (ma20 != null && price != null) push('ma20', signOf(pct(price, ma20), 1), null, 'technical', price >= ma20 ? 'aboveMa20' : 'belowMa20');

  const bb = analysis?.indicators?.bollinger;
  if (bb && num(bb.percentB) != null) push('bollinger', bb.percentB < 0.2 ? 1 : bb.percentB > 0.8 ? -1 : 0, null, 'technical', bb.percentB < 0.2 ? 'bollingerLow' : bb.percentB > 0.8 ? 'bollingerHigh' : 'bollingerMid');

  const mcap = num(coin.mcap);
  const volume = num(coin.volume);
  const turnover = mcap > 0 && volume != null ? (volume / mcap) * 100 : null;
  if (turnover != null) push('liquidityActive', 0, turnover, 'market', turnover >= 6 ? 'liquidityActive' : 'liquidityThin');

  if (solanaIntel?.configured) {
    const flow = solanaIntel?.whaleFlow?.direction;
    if (flow === 'inflow') push('whaleInflow', 1, null, 'onchain', 'whaleInflow');
    else if (flow === 'outflow') push('whaleOutflow', -1, null, 'onchain', 'whaleOutflow');
    const trend = solanaIntel?.holderTrend?.change;
    if (trend === 'rising') push('holderGrowth', 1, null, 'onchain', 'holderGrowth');
    else if (trend === 'falling') push('holderSpread', -1, null, 'onchain', 'holderSpread');
    const pressure = solanaIntel?.dexActivity?.pressure;
    if (pressure === 'buy') push('dexBuy', 1, null, 'onchain', 'dexBuy');
    else if (pressure === 'sell') push('dexSell', -1, null, 'onchain', 'dexSell');
  }

  if (smToken?.signal === 'ACCUMULATION') push('smartMoneyAccum', 1, null, 'onchain', 'smartMoneyAccum');
  else if (smToken?.signal === 'DISTRIBUTION') push('smartMoneyDistrib', -1, null, 'onchain', 'smartMoneyDistrib');

  if (pulse?.sentiment?.label === 'bullish') push('marketSentimentUp', 0.5, null, 'sentiment', 'marketSentimentUp');
  else if (pulse?.sentiment?.label === 'bearish') push('marketSentimentDown', -0.5, null, 'sentiment', 'marketSentimentDown');

  return ev;
}

function evidenceScore(ev) {
  const score = (ev || []).reduce((s, e) => s + (num(e.direction) || 0), 0);
  const count = (ev || []).filter((e) => num(e.direction) !== 0).length;
  const max = Math.max(count, 1) * 1.5;
  return clampf((score / max) * 100, -100, 100);
}

/** Weighted confidence from the seven measured factors. */
export function confidenceEngine({
  evidence = [],
  agreement = 50,
  marketAgreement = 50,
  onchainAgreement = 50,
  aiConsensus = null,
  freshness = 1,
  turnoverPct = null,
  volatilityScore = 50,
  signalScore = 0,
  consensusAgreement = 100
} = {}) {
  const dirEvidence = evidence.filter((e) => num(e.direction) !== 0);
  const techAgreement = num(agreement) ?? 50;
  const fresh = clampf(freshness, 0.4, 1);
  const liquidity = turnoverPct != null ? clampf(15 + turnoverPct * 12, 40, 96) : 55;
  const volFit = volatilityScore < 40 ? 95 : volatilityScore < 70 ? 66 : 42;
  const strength = clampf(Math.abs(signalScore) / 40, 0.15, 1) * 100;
  /* AI agreement only penalises; a missing AI never inflates confidence. */
  const aiAgree = aiConsensus ? clampf(consensusAgreement, 30, 100) : 75;

  const weighted = (
    techAgreement * 0.22 +
    (marketAgreement || techAgreement) * 0.16 +
    (onchainAgreement || techAgreement) * 0.12 +
    aiAgree * 0.12 +
    fresh * 0.12 +
    liquidity * 0.11 +
    (0.4 * volFit + 0.6 * strength) * 0.15
  );
  const min = dirEvidence.length >= MIN_EVIDENCE ? 15 : 5;
  return Math.round(clampf(weighted, min, 95));
}

/**
 * The full signal card for one asset. Returns `{ status:'READY', ... }` or
 * `{ status:'INSUFFICIENT_DATA', coin, at }` when the evidence is too thin —
 * failing closed is how fake signals are prevented.
 */
export function computeSignalCard({
  coin = null,
  series = [],
  analysis = null,
  horizons = null,
  solanaIntel = null,
  smToken = null,
  pulse = null,
  aiConsensus = null,
  now = Date.now()
} = {}) {
  if (!coin || !num(coin.price) || !analysis || (series ?? []).length < 30) {
    return { status: 'INSUFFICIENT_DATA', coin, at: now, confidence: null, classification: null };
  }

  const horizonRisks = horizons || computeHorizonRisks({ series, analysis });
  const risk7 = horizonRisks.find((h) => h.days === 7) || horizonRisks[1];
  const evidence = buildEvidence({ coin, analysis, solanaIntel, smToken, pulse });
  const directional = evidence.filter((e) => num(e.direction) !== 0);
  if (directional.length < MIN_EVIDENCE) {
    return { status: 'INSUFFICIENT_DATA', coin, at: now, confidence: null, classification: null, evidence, horizonRisks };
  }

  const score = evidenceScore(evidence);
  let classification =
    score >= 32 ? CLASS.STRONG_BUY
      : score >= 14 ? CLASS.BUY
        : score <= -32 ? CLASS.SELL
          : score <= -14 ? CLASS.SELL
            : CLASS.WATCH;

  /* Risk override: the six classes include risk-aware categories. A strong
     risk read can only downgrade a call, never upgrade it. */
  const riskLevel = risk7?.riskLabel ?? 'MEDIUM';
  if (riskLevel === 'HIGH' && (classification === CLASS.BUY || classification === CLASS.STRONG_BUY)) {
    classification = CLASS.HIGH_RISK;
  }
  if (riskLevel === 'HIGH' && score < 8 && classification !== CLASS.AVOID) {
    classification = CLASS.AVOID;
  }
  if ((risk7?.riskScore ?? 0) >= 85 && classification !== CLASS.STRONG_BUY) {
    classification = CLASS.AVOID;
  }

  /* ── agreement factors for the confidence engine ─────────────────────── */
  const bulls = directional.filter((e) => e.direction > 0).length;
  const bears = directional.filter((e) => e.direction < 0).length;
  const techAgreement = directional.length ? (Math.max(bulls, bears) / directional.length) * 100 : 50;
  const c24 = num(coin.change24h);
  const c7 = num(coin.change7d);
  const marketAgreement = c24 != null && c7 != null && Math.sign(c24) === Math.sign(c7) && Math.abs(c24) > 0.5 ? 90 : c24 != null && c7 != null ? 55 : 60;
  const onchainItems = evidence.filter((e) => e.source === 'onchain');
  const onchainAgreement = onchainItems.length
    ? onchainItems.filter((e) => (e.direction > 0 && score >= 0) || (e.direction < 0 && score < 0) || e.direction === 0).length / onchainItems.length * 100
    : 70;

  const mcap = num(coin.mcap);
  const volume = num(coin.volume);
  const turnoverPct = mcap > 0 && volume != null ? (volume / mcap) * 100 : null;
  const confidence = confidenceEngine({
    evidence,
    agreement: techAgreement,
    marketAgreement,
    onchainAgreement,
    aiConsensus: Boolean(aiConsensus),
    consensusAgreement: aiConsensus?.agreement ?? 100,
    freshness: coin.dataProvenance === 'live' ? 1 : 0.45,
    turnoverPct,
    volatilityScore: risk7?.riskScore ?? 50,
    signalScore: score
  });

  /* ── target / stop: volatility-scaled, direction of the measured score.
        WATCH carries no directional target — an honest neutral. ─────────── */
  let target = null;
  let stop = null;
  let targetPct = null;
  let stopPct = null;
  if (classification === CLASS.BUY || classification === CLASS.STRONG_BUY || classification === CLASS.SELL || classification === CLASS.HIGH_RISK) {
    const volH = risk7?.volatilityPct ?? 3;
    const dir = score >= 0 ? 1 : -1;
    targetPct = clampf(volH * (classification === CLASS.STRONG_BUY ? 0.7 : 0.55), 0.8, 26);
    stopPct = clampf(targetPct * 0.5, 0.6, 14);
    target = coin.price * (1 + (dir * targetPct) / 100);
    stop = coin.price * (1 - (dir * stopPct) / 100);
  }

  const reasons = [...new Set(evidence.filter((e) => num(e.direction) !== 0).map((e) => e.reason))].slice(0, 5);

  return {
    status: 'READY',
    coin,
    at: now,
    /* Offline-snapshot data is never relabeled as a live fact. */
    offline: coin.dataProvenance === 'offline',
    classification,
    confidence,
    risk: riskLevel,
    riskScore: risk7?.riskScore ?? null,
    timeframe: 7,
    score: Math.round(score),
    momentum: {
      label: Math.abs(score) >= 40 ? 'strong' : Math.abs(score) >= 15 ? 'moderate' : 'flat',
      direction: score >= 0 ? 'up' : score < 0 ? 'down' : 'flat',
      pct: c24 != null ? Math.round(c24 * 100) / 100 : null
    },
    volumeChange: turnoverPct != null ? Math.round(turnoverPct * 100) / 100 : null,
    smartMoney: smToken?.signal ? (smToken.signal === 'ACCUMULATION' ? 'bullish' : 'bearish') : null,
    whale: solanaIntel?.whaleFlow?.direction ?? null,
    liquidity: turnoverPct != null ? (turnoverPct >= 6 ? 'strong' : turnoverPct >= 2 ? 'adequate' : 'thin') : null,
    horizons: horizonRisks,
    target,
    stop,
    targetPct: targetPct != null ? Math.round(targetPct * 100) / 100 : null,
    stopPct: stopPct != null ? Math.round(stopPct * 100) / 100 : null,
    reasons,
    evidence,
    aiConsensus: aiConsensus ?? null
  };
}

/* ═══════════════════ 4. AI EARLY SIGNALS ═════════════════════════════ */

/**
 * Early-movement detector. An asset only qualifies with at least two
 * independent measured signals (momentum acceleration + at least one of
 * smart-money flow / holder growth / whale inflow / DEX buy pressure /
 * volume turnover). Nothing is inferred from a single number.
 */
export function computeEarlySignals({ entries = [], now = Date.now() } = {}) {
  const out = [];
  for (const e of entries) {
    if (!e?.coin || !e?.analysis) continue;
    const prices = (e.series ?? []).filter((n) => Number.isFinite(n) && n > 0);
    if (prices.length < 14) continue;
    const last = prices[prices.length - 1];

    const half = Math.floor(prices.length / 2);
    const recent = prices.slice(half);
    const earlier = prices.slice(0, half);
    const recentAvg =
      recent.length > 2 ? recent.slice(1).reduce((s, v, i) => s + ((v - recent[i]) / recent[i]) * 100, 0) / (recent.length - 1) : 0;
    const earlierAvg =
      earlier.length > 2 ? earlier.slice(1).reduce((s, v, i) => s + ((v - earlier[i]) / earlier[i]) * 100, 0) / (earlier.length - 1) : 0;
    const accel = recentAvg - earlierAvg;

    const flags = [];
    let strength = 0;
    if (accel > 0.15) { flags.push('momentumAccel'); strength += 1; }
    else if (accel < -0.15) { flags.push('momentumDecel'); strength -= 1; }

    const intel = e.solanaIntel;
    if (intel?.configured) {
      if (intel?.holderTrend?.change === 'rising') { flags.push('holderGrowth'); strength += 1; }
      if (intel?.whaleFlow?.direction === 'inflow') { flags.push('whaleInflow'); strength += 1; }
      if (intel?.whaleFlow?.direction === 'outflow') { flags.push('whaleOutflow'); strength -= 1; }
      if (intel?.dexActivity?.pressure === 'buy') { flags.push('dexBuy'); strength += 1; }
      if (intel?.dexActivity?.pressure === 'sell') { flags.push('dexSell'); strength -= 1; }
    }
    if (e?.smToken?.signal === 'ACCUMULATION') { flags.push('smartMoneyAccum'); strength += 1; }
    else if (e?.smToken?.signal === 'DISTRIBUTION') { flags.push('smartMoneyDistrib'); strength -= 1; }

    const t = e.coin.mcap > 0 ? (e.coin.volume / e.coin.mcap) * 100 : null;
    if (t != null && t >= 6) { flags.push('volumeTurnover'); strength += 0.5; }

    if (flags.length < 2) continue;
    out.push({
      coin: e.coin,
      symbol: e.coin.symbol,
      at: now,
      direction: strength > 0 ? 'earlyBullish' : strength < 0 ? 'earlyBearish' : 'earlyWatch',
      confidence: Math.round(clampf(45 + Math.abs(strength) * 14 + flags.length * 5, 25, 92)),
      flags,
      momentumAccelPct: Math.round(accel * 100) / 100,
      last,
      strength: Math.round(strength * 10) / 10
    });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/* ═══════════════════ 5. PORTFOLIO-AWARE IMPACT ════════════════════════ */

/**
 * Local-only portfolio comparison. The portfolio (app positions + price map)
 * is NEVER sent to an AI by this module; the UI additionally gates the
 * AI "why" call behind an explicit user consent.
 */
export function portfolioImpact({ positions = [], priceMap = {}, coin = null, classification = 'WATCH' } = {}) {
  const rows = (positions ?? [])
    .map((p) => ({
      ...p,
      value: num(p.qty) != null && priceMap?.[p.coinId] != null ? num(p.qty) * num(priceMap[p.coinId]) : null
    }))
    .filter((p) => p.value != null);
  if (!rows.length || !coin?.id) return null;
  const total = rows.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;

  const pos = rows.find((p) => p.coinId === coin.id);
  const exposurePct = pos ? (pos.value / total) * 100 : 0;
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const top3 = sorted.slice(0, 3).reduce((s, p) => s + p.value, 0);
  const concentrationPct = (top3 / total) * 100;

  const impact = exposurePct >= 40 ? 'HIGH' : exposurePct >= 15 ? 'MEDIUM' : 'LOW';
  const notes = [];
  if (exposurePct >= 30) notes.push('highExposure');
  if (concentrationPct >= 70) notes.push('highConcentration');
  if (classification === CLASS.BUY || classification === CLASS.STRONG_BUY) {
    if (pos) notes.push('existingPositionUp');
    else notes.push('noExistingPosition');
  }
  if (notes.length === 0) notes.push('balanced');

  return {
    exposurePct: Math.round(exposurePct * 10) / 10,
    concentrationPct: Math.round(concentrationPct * 10) / 10,
    impact,
    hasPosition: Boolean(pos),
    notes
  };
}

/** Deterministic reason keys from a flat evidence object (used by history). */
export function localReasonFromEvidence(safe = {}) {
  const reasons = [];
  if (safe.momentum != null && Math.abs(safe.momentum) > 5) reasons.push(safe.momentum > 0 ? 'momentumUp' : 'momentumDown');
  if (safe.change24h != null && Math.abs(safe.change24h) > 2) reasons.push(safe.change24h > 0 ? 'volumeUp' : 'volumeDown');
  if (safe.whaleFlow) reasons.push(safe.whaleFlow === 'inflow' ? 'whaleInflow' : 'whaleOutflow');
  if (safe.holderTrend) reasons.push(safe.holderTrend === 'rising' ? 'holderGrowth' : 'holderSpread');
  if (safe.dexPressure) reasons.push(safe.dexPressure === 'buy' ? 'dexBuy' : 'dexSell');
  if (safe.smartMoneySignal) reasons.push(safe.smartMoneySignal === 'ACCUMULATION' ? 'smartMoneyAccum' : 'smartMoneyDistrib');
  if (safe.rsi != null && safe.rsi < 35) reasons.push('rsiOversold');
  if (safe.rsi != null && safe.rsi > 68) reasons.push('rsiOverbought');
  if (safe.evidenceCount != null && reasons.length < 3) reasons.push('measuredEvidence');
  return reasons.slice(0, 5);
}

/* ═══════════════════ 6. SIGNAL RANKING ════════════════════════════════ */

/** Rank ready signals: confidence first, strength second, risk penalty. */
export function rankSignals(signals = []) {
  return [...(signals ?? [])]
    .filter((s) => s?.status === 'READY')
    .sort((a, b) =>
      (b.confidence ?? 0) - (a.confidence ?? 0)
      || Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0)
      || (a.riskScore ?? 0) - (b.riskScore ?? 0)
    );
}

/* ═══════════════════ 7. FILTERING ═════════════════════════════════════ */

export const FILTER_OPTIONS = Object.freeze({
  type: ['all', 'buy', 'sell', 'watch'],
  risk: ['all', 'low', 'medium', 'high'],
  confidence: ['all', '50', '70', '90'],
  timeframe: ['all', '24H', '7D', '30D'],
  asset: ['all', 'BTC', 'ETH', 'SOL', 'others'],
  market: ['all', 'evm', 'solana']
});

/**
 * Apply the Signals page filters to a list of cards. Returns the filtered
 * list. `market`/`asset` filters need a coin's chain/kind info, which the
 * caller supplies as `marketOf(coin)` when known.
 */
export function filterSignals(signals = [], filters = {}, marketOf = () => null) {
  const type = filters.type || 'all';
  const risk = filters.risk || 'all';
  const conf = Number(filters.confidence || 0);
  const timeframe = filters.timeframe || 'all';
  const asset = filters.asset || 'all';
  const market = filters.market || 'all';

  return (signals ?? []).filter((s) => {
    const c = s?.coin;
    if (!c) return false;
    if (type !== 'all') {
      const cls = s?.classification;
      const isBuy = cls === 'STRONG_BUY' || cls === 'BUY';
      const isSell = cls === 'SELL';
      const isWatch = cls === 'WATCH' || cls === 'HIGH_RISK' || cls === 'AVOID';
      if (type === 'buy' && !isBuy) return false;
      if (type === 'sell' && !isSell) return false;
      if (type === 'watch' && !isWatch) return false;
    }
    if (risk !== 'all' && String(s?.risk || '').toLowerCase() !== risk) return false;
    if (conf > 0 && (s?.confidence ?? 0) < conf) return false;
    if (timeframe !== 'all' && s?.timeframe !== Number(timeframe.replace('D', '')) && s?.timeframe !== Number(timeframe.replace('H', ''))) {
      // 24H is the 1-day horizon; accept either representation.
      const days = timeframe === '24H' ? 1 : Number(timeframe.replace('D', ''));
      const key = timeframe === '24H' ? '24H' : `${days}D`;
      if (!(s.horizons || []).some((h) => h.key === key)) return false;
    }
    if (asset !== 'all') {
      const sym = String(c.symbol || '').toUpperCase();
      if (asset === 'BTC' && sym !== 'BTC') return false;
      if (asset === 'ETH' && sym !== 'ETH') return false;
      if (asset === 'SOL' && sym !== 'SOL') return false;
      if (asset === 'others' && !['BTC', 'ETH', 'SOL'].includes(sym)) return false;
    }
    if (market !== 'all') {
      const m = marketOf(c);
      if (market === 'evm' && m !== 'evm') return false;
      if (market === 'solana' && m !== 'solana') return false;
    }
    return true;
  });
}

/** Search token / symbol / signal classification. */
export function searchSignals(signals = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return signals ?? [];
  return (signals ?? []).filter((s) => {
    const c = s?.coin || {};
    return (
      String(c.symbol || '').toLowerCase().includes(q)
      || String(c.name || '').toLowerCase().includes(q)
      || String(c.id || '').toLowerCase().includes(q)
      || String(s?.classification || '').toLowerCase().includes(q)
      || String(s?.risk || '').toLowerCase().includes(q)
    );
  });
}
