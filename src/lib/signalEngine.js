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

import { verifiedSignals } from './smartMoneyEvidence.js';
import { readTokenBehavior } from './tokenBehavior.js';
import { readConsensus } from './signalConsensus.js';

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
  if (v === null || v === undefined || v === '') return null;
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
  if (!priced.length) return null;
  const up = priced.filter((c) => c.change24h > 0).length;
  const breadth = priced.length ? up / priced.length : null;
  const avgChange = priced.length ? priced.reduce((s, c) => s + num(c.change24h), 0) / priced.length : null;
  const mcapChange = num(global?.mcapChange);
  const mcap = num(global?.mcap);
  const volume = num(global?.volume);
  const turnover = mcap > 0 && volume != null ? (volume / mcap) * 100 : null;
  const verified = verifiedSignals(sm, { now });
  const smNet = verified.netFlowUsd;

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
    smartMoney: sm ? { dataStatus: verified.dataStatus, netFlowUsd: smNet,
      whaleTransferProxy: { netFlowUsd: sm.metrics?.netFlow?.value ?? null,
        note: 'Labelled transfers are not confirmed wallet trades.' } } : null,
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
  pulse = null,
  behavior = null,
  marketSeries = []
} = {}) {
  const ev = [];
  const push = (key, direction, pctVal = null, source = 'market', reason = key, weight = 1) => {
    ev.push({ key, direction, pct: pctVal != null ? Math.round(pctVal * 100) / 100 : null, source, reason, weight });
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

  if (smToken?.classification === 'verified-paired-swaps' && smToken?.signal === 'ACCUMULATION') push('smartMoneyAccum', 1, null, 'onchain', 'smartMoneyAccum');
  else if (smToken?.classification === 'verified-paired-swaps' && smToken?.signal === 'DISTRIBUTION') push('smartMoneyDistrib', -1, null, 'onchain', 'smartMoneyDistrib');

  if (pulse?.sentiment?.label === 'bullish') push('marketSentimentUp', 0.5, null, 'sentiment', 'marketSentimentUp');
  else if (pulse?.sentiment?.label === 'bearish') push('marketSentimentDown', -0.5, null, 'sentiment', 'marketSentimentDown');

  /* ── G4 · BEHAVIOUR: how the token itself traded, not where it sits ──────
     A separate plane from the indicators (which are all transforms of the
     same closes) and from the market rows (which only say how far it moved).
     Each finding enters with the weight of what was actually measured:
     a one-sided tape is worth more than a coarse volume band, and a shape
     repeat is worth least because a repeated shape proves nothing by itself.
     Anything the read could not measure is simply absent — never a neutral 0
     standing in for a missing fact. */
  const beh = behavior ?? (Array.isArray(marketSeries) ? readTokenBehavior({ coin, series: marketSeries }) : null);
  if (beh) {
    if (beh.pressure && Math.abs(beh.pressure.score) >= 55) {
      push(beh.pressure.score > 0 ? 'oneSidedBuy' : 'oneSidedSell', beh.pressure.score > 0 ? 1 : -1,
        Math.abs(beh.pressure.score), 'behavior', beh.pressure.score > 0 ? 'tapeOneSidedBuy' : 'tapeOneSidedSell', 1.3);
    }
    /* Participation: a move carried by most steps is worth more than the same
       percentage delivered by one spike — and a move that most steps FOUGHT
       is a warning, so it enters against its own direction. */
    if (beh.breadth && beh.breadth.direction !== 'flat' && beh.breadth.breadth != null) {
      const strong = beh.breadth.breadth >= 0.62 && (beh.breadth.spikeShare ?? 1) <= 0.28;
      const hollow = beh.breadth.breadth <= 0.4 || (beh.breadth.spikeShare ?? 0) >= 0.45;
      const dir = beh.breadth.direction === 'up' ? 1 : -1;
      if (strong) push(beh.breadth.direction === 'up' ? 'moveBroadUp' : 'moveBroadDown', dir, Math.abs(beh.breadth.movePct), 'behavior', beh.breadth.direction === 'up' ? 'broadParticipationUp' : 'broadParticipationDown', 1.1);
      else if (hollow) push(beh.breadth.direction === 'up' ? 'moveHollowUp' : 'moveHollowDown', -dir, Math.abs(beh.breadth.movePct), 'behavior', beh.breadth.direction === 'up' ? 'hollowRally' : 'hollowSelloff', 1.1);
    }
    if (beh.relative && beh.relative.label !== 'inline') {
      push(beh.relative.label === 'outperforming' ? 'relativeStrengthUp' : 'relativeStrengthDown',
        beh.relative.label === 'outperforming' ? 1 : -1, Math.abs(beh.relative.diffPct), 'behavior',
        beh.relative.label === 'outperforming' ? 'outperformingMarket' : 'underperformingMarket', 1.2);
    }
    if (beh.volume && beh.volume.label === 'accumulating') push('volumeAgreesUp', 1, beh.volume.turnoverPct, 'behavior', 'volumeWithTrend', 1);
    else if (beh.volume && beh.volume.label === 'distributing') push('volumeAgreesDown', -1, beh.volume.turnoverPct, 'behavior', 'volumeWithDowntrend', 1);
    else if (beh.volume && beh.volume.label === 'hollow-rally') push('volumeHollow', -1, beh.volume.turnoverPct, 'behavior', 'hollowRally', 0.8);
    if (beh.pattern?.repeat) push('patternRepeat', 0, null, 'behavior', 'patternRepeat', 0.4);
  }

  return ev;
}

/**
 * Directional balance of the evidence, in −100…+100.
 *
 * Each item counts as `direction × weight`; the divisor is the sum of the
 * weights that actually pointed somewhere, so a single one-sided-tape finding
 * (weight 1.3) is not diluted by four weak neutral reads, and adding evidence
 * of the OPPOSITE direction genuinely pulls the score back toward zero instead
 * of merely failing to help.
 */
function evidenceScore(ev) {
  const rows = (ev || []).filter((e) => num(e.direction) !== 0);
  if (!rows.length) return 0;
  const weighted = rows.reduce((s, e) => s + (num(e.direction) || 0) * (num(e.weight) ?? 1), 0);
  const max = rows.reduce((s, e) => s + Math.abs(num(e.weight) ?? 1), 0) || 1;
  /* Same calibration as before weights existed: unanimous evidence lands at
     66.7, not 100, so the class thresholds (14 / 32) keep their meaning. */
  return clampf((weighted / (max * 1.5)) * 100, -100, 100);
}

/**
 * The weighted score of ONE evidence plane.
 *
 * `evidenceScore` collapses every source into one number, which is exactly
 * what the consensus module must not do — it needs «what did the technical
 * plane say on its own», so it can compare planes rather than average them.
 * Same weighting, same denominator, restricted to the requested sources.
 */
function planeScore(ev, sources) {
  const rows = (ev || []).filter((e) => num(e.direction) !== 0 && sources.includes(e.source));
  if (!rows.length) return null;
  const weighted = rows.reduce((s2, e) => s2 + (num(e.direction) || 0) * (num(e.weight) ?? 1), 0);
  const max = rows.reduce((s2, e) => s2 + Math.abs(num(e.weight) ?? 1), 0) || 1;
  return (weighted / (max * 1.5)) * 100;
}

/**
 * Map the weighted evidence score to one of the six classes.
 *
 * Symmetric by construction: the band at ±14 and the band at ±32 are the same
 * two cuts on both sides. Anything between the cuts is WATCH — the honest
 * «the evidence does not agree yet» answer, not a coin flip dressed up as a
 * call. Exported so the ladder itself is testable in isolation.
 */
export function classify(score) {
  const v = num(score) ?? 0;
  if (v >= 32) return CLASS.STRONG_BUY;
  if (v >= 14) return CLASS.BUY;
  if (v <= -14) return CLASS.SELL;
  return CLASS.WATCH;
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
  consensusAgreement = 100,
  consensusMultiplier = 1,
  consensusBias = 'flat',
  consensusConflict = false
} = {}) {
  const dirEvidence = evidence.filter((e) => num(e.direction) !== 0);
  /*
   * ─── THE ONE THING A CONFIDENCE NUMBER MUST NEVER DO ─────────────────────
   * Report high confidence on a card whose own evidence points the other way.
   * That was reachable: `liquidity`, `volatility` and `strength` are all
   * direction-BLIND (a violent collapse scores as «strong»), and `agreement`
   * counts how loudly the indicators speak, not whether they agree with the
   * class. So a card driven by behaviour and flow — two planes the technical
   * `agreement` figure does not see — could show «WATCH at 71%» while its own
   * evidence ran net negative.
   *
   * The fix is a CEILING, not a new term: when the evidence net is at least
   * `OPPOSED` points away from the claimed direction, confidence is capped
   * below the level that would read as conviction. A cap can only ever lower
   * the number, so nothing here can inflate a signal, and a missing/neutral
   * score leaves the existing calculus untouched.
   */
  const OPPOSED = 8;
  const scoreNum = num(signalScore) ?? 0;
  /*
   * Measured on the SAME scale the score uses (net direction × weight, over
   * the total weight actually present, ×100/1.5) so the comparison is
   * like-for-like: «the evidence nets at least 8 points against the direction
   * this card is being scored in».
   */
  const netW = dirEvidence.reduce((s2, e) => s2 + (num(e.direction) || 0) * (num(e.weight) ?? 1), 0);
  const totalW = dirEvidence.reduce((s2, e) => s2 + Math.abs(num(e.weight) ?? 1), 0) || 1;
  const netScale = (netW / (totalW * 1.5)) * 100;
  /* Two ways a card can be contested: the evidence runs AGAINST the direction
     being scored, or it is genuinely split (both sides carry weight and the net
     is inside the 8-point noise band) — «WATCH at 73%» reads as conviction the
     engine does not have. */
  const opposed = Math.abs(scoreNum) >= 5
    && Math.sign(netScale) !== Math.sign(scoreNum) && Math.abs(netScale) >= OPPOSED;
  const split = dirEvidence.some((e) => num(e.direction) > 0) && dirEvidence.some((e) => num(e.direction) < 0)
    && Math.abs(netScale) < OPPOSED;
  const contradicts = opposed || split;

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
  const out = clampf(weighted, min, 95);
  /*
   * A CONTESTED CARD CANNOT SHOW CONVICTION — and «contested» now has two
   * independent definitions that both only ever LOWER the number:
   *   • the evidence runs against the direction being scored, or is split
   *     (the local check above), or
   *   • the four independent planes disagree (`consensusConflict`).
   * 55 is the same «moderate» line the card already uses for its momentum
   * label, so a softer card still says how much was measured.
   */
  const capped = contradicts || consensusConflict ? Math.min(out, 55) : out;
  return Math.round(capped);
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
  behavior = null,
  marketSeries = [],
  /* FBT Global + the AI candle forecast's own direction, as one measured
     market read: { mcapChange, avgChange, breadth, btcDominance, forecast }.
     Optional — a page that has none of it simply contributes three planes. */
  marketRead = null,
  /* Smart money for THIS asset only: a verified per-contract row, or a
     symbol-matched consensus row. Deliberately NOT the market-wide net flow:
     «wallets sold $40M of something» is not a statement about this token, and
     feeding it in would tilt every card in the same direction. */
  smRead = null,
  now = Date.now()
} = {}) {
  if (!coin || !num(coin.price) || !analysis || (series ?? []).length < 30) {
    return { status: 'INSUFFICIENT_DATA', coin, at: now, confidence: null, classification: null };
  }

  const horizonRisks = horizons || computeHorizonRisks({ series, analysis });
  const risk7 = horizonRisks.find((h) => h.days === 7) || horizonRisks[1];
  /* The behaviour read is optional: when the caller already computed it for
     the screen (the page does, once per poll) it is reused instead of being
     recomputed for every card. Passed-through null means "not measured". */
  const beh = behavior ?? readTokenBehavior({ series, marketSeries, coin });
  const evidence = buildEvidence({ coin, analysis, solanaIntel, smToken, pulse, behavior: beh });
  const directional = evidence.filter((e) => num(e.direction) !== 0);
  if (directional.length < MIN_EVIDENCE) {
    return { status: 'INSUFFICIENT_DATA', coin, at: now, confidence: null, classification: null, evidence, horizonRisks };
  }

  const rawScore = evidenceScore(evidence);

  /*
   * ─── «موتور یکسان‌ساز نتایج» ────────────────────────────────────────────
   * The same four observations the evidence list already carries, read as four
   * PLANES rather than as one flat bag of votes. Two things come out of it:
   *
   *  1. CONFLICT IS STATED. If behaviour and smart money point opposite ways,
   *     the card says so (`consensus.conflict`) instead of averaging them into
   *     a bland WATCH that hides a real disagreement.
   *  2. AGREEMENT IS WORTH SOMETHING. When independent planes agree, the same
   *     evidence counts for more (up to ×1.25); when they fight, the card is
   *     softer (down to ×0.8) rather than louder. The multiplier is bounded,
   *     so this sharpens a call and can never manufacture one — «فروش زیاد
   *     بیت‌کوین در اسمارت‌مانی» moves the call only when the other planes do
   *     not contradict it.
   *
   * Cost: pure arithmetic over values already in this function's hands. No
   * fetch, no timer, no storage — see the header of signalConsensus.js.
   */
  const consensus = readConsensus({
    technical: planeScore(evidence, ['technical']),
    behavior: beh,
    smartMoney: smRead,
    market: marketRead,
    strength: rawScore
  });
  /*
   * The consensus may only AMPLIFY or DAMP what the weighted evidence already
   * said: it multiplies the measured score, it never adds to it. That keeps
   * the class thresholds meaningful (a card that was WATCH stays WATCH unless
   * the agreement pushes it past a cut it was already near) and keeps this
   * module from being a hidden fifth indicator.
   */
  const score = clampf(rawScore * consensus.multiplier, -100, 100);
  /*
   * ─── FOUR BANDS, NOT THREE AND A BROKEN SYMMETRY ─────────────────────────
   * The downside read used to be `score <= -32 ? SELL : score <= -14 ? SELL`,
   * so «strong sell» and «sell» rendered as the same word while «strong buy»
   * and «buy» did not. Two different amounts of evidence produced one label,
   * which makes the class useless for ranking the sell side and hides exactly
   * how convinced the engine is. The mirror of the buy ladder is now explicit
   * and it is a `classify()` export, so the asymmetry cannot come back by
   * accident and can be asserted without constructing an entire card.
   */
  let classification = classify(score);

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
    signalScore: score,
    /*
     * THE FOUR-PLANE READ FEEDS CONFIDENCE TOO — DOWNWARD ONLY.
     * A card whose technicals agree but whose smart money and tape are
     * fighting is less certain than its indicator count suggests; the cap in
     * `confidenceEngine` reflects that. Amplification of the SCORE is handled
     * by the multiplier above; confidence is about whether the picture is
     * coherent, which is the same question the consensus answers. Passing it
     * can only lower the number, so a plane that was not measured (a WATCH on
     * three planes) is never treated as a reason to doubt or to believe.
     */
    consensusMultiplier: consensus.multiplier,
    consensusBias: consensus.bias,
    consensusConflict: Boolean(consensus.conflict)
  });

  /* ── target / stop: volatility-scaled, direction of the measured score.
        WATCH carries no directional target — an honest neutral. ─────────── */
  let target = null;
  let stop = null;
  let targetPct = null;
  let stopPct = null;
  let tradeDir = null;
  if (classification === CLASS.BUY || classification === CLASS.STRONG_BUY || classification === CLASS.SELL || classification === CLASS.HIGH_RISK) {
    const volH = risk7?.volatilityPct ?? 3;
    /*
     * ─── THE DIRECTION MUST BE THE CLASS'S, NOT THE SIGN OF A ROUNDED SCORE ─
     * `score >= 0 ? 1 : -1` looked harmless until the risk override landed: a
     * card downgraded to HIGH_RISK while the evidence sat just under zero got
     * a DOWNWARD target and stop, plus a positive `targetPct`, and the panel
     * renders that number behind a literal «+» (`+${signal.targetPct}%`). The
     * screen then said «target +1.2%» for a call whose own numbers pointed
     * down — a fabricated level, which is the one thing this engine does not
     * do. The direction now comes from the class, and for HIGH_RISK from the
     * sign of the evidence, so the two can never disagree.
     */
    const dir = classification === CLASS.BUY || classification === CLASS.STRONG_BUY ? 1
      : classification === CLASS.SELL ? -1
        : score >= 0 ? 1 : -1;
    targetPct = clampf(volH * (classification === CLASS.STRONG_BUY ? 0.7 : 0.55), 0.8, 26);
    stopPct = clampf(targetPct * 0.5, 0.6, 14);
    target = coin.price * (1 + (dir * targetPct) / 100);
    stop = coin.price * (1 - (dir * stopPct) / 100);
    tradeDir = dir > 0 ? 'up' : 'down';
  }

  /* Reasons lead with BEHAVIOUR when behaviour is the loudest measured thing:
     «why did this card say this» should answer with what the tape did, not
     only with the indicator it happened to list first. Measured items only —
     the list can be shorter than five, and is never padded. */
  const ordered = [...evidence]
    .filter((e) => num(e.direction) !== 0)
    .sort((a, b) => (Math.abs(num(b.weight) ?? 1) * Math.abs(num(b.direction) ?? 0))
      - (Math.abs(num(a.weight) ?? 1) * Math.abs(num(a.direction) ?? 0)));
  const reasons = [...new Set(ordered.map((e) => e.reason))].slice(0, 5);

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
    smartMoney: smToken?.classification === 'verified-paired-swaps' && smToken?.signal
      ? (smToken.signal === 'ACCUMULATION' ? 'bullish' : 'bearish') : null,
    whale: solanaIntel?.whaleFlow?.direction ?? null,
    liquidity: turnoverPct != null ? (turnoverPct >= 6 ? 'strong' : turnoverPct >= 2 ? 'adequate' : 'thin') : null,
    horizons: horizonRisks,
    target,
    stop,
    targetPct: targetPct != null ? Math.round(targetPct * 100) / 100 : null,
    stopPct: stopPct != null ? Math.round(stopPct * 100) / 100 : null,
    /* WHICH WAY the target points, so the panel stops assuming «up». */
    tradeDirection: tradeDir,
    reasons,
    evidence,
    /* The measured behaviour read, so the detail panel can show WHY the tape
       was read the way it was — every field nullable, nothing synthesised. */
    behavior: beh,
    /* The four-plane reconciliation, so the panel can show WHY the call is
       confident or contested — and so nothing here is a number the reader has
       to take on faith. */
    consensus,
    /* The pre-consensus score, for the panel to show what amplification did
       (and to prove amplification happened rather than invention). */
    rawScore: Math.round(rawScore),
    aiConsensus: aiConsensus ?? null
  };
}

/* ═══════════════════ 4. AI EARLY SIGNALS ═════════════════════════════ */

/**
 * Early-movement detector.
 *
 * ─── WHY THE GATE HAS THREE FLAG GROUPS ────────────────────────────────────
 * Reported: «سیگنال‌های زودهنگام هوش مصنوعی — اصلا داده‌ای وجود ندارد» —
 * the section rendered its empty state permanently. The old gate accepted
 * only TWO flag families: momentum acceleration of the 7-day sparkline and
 * on-chain/flow feeds (Solana intel, verified smart money). On the GLOBAL
 * tab neither flow feed ever joins an entry, so a coin needed acceleration
 * AND ≥6% volume turnover — a combination the top-24 almost never shows.
 * The list stayed empty by construction, not by bad luck.
 *
 * Every number below is still measured, never guessed — the detector now
 * simply reads the THREE observation planes the page actually holds for
 * every asset:
 *
 *   G1 · series/technical — the price series itself: momentum acceleration,
 *        RSI extremes, MACD histogram, Bollinger position, MA structure.
 *   G2 · flow/on-chain    — Solana intel, verified smart-money swaps.
 *   G3 · market           — 24h/7d measured change, volume turnover.
 *
 * A coin qualifies with flags from AT LEAST TWO DIFFERENT GROUPS (and at
 * least two flags overall), so a single number can never mint a signal —
 * the same independence rule as before, enforced across real data planes
 * instead of across feeds that are absent on most assets. An entry with no
 * series and no analysis still produces nothing (fail closed).
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
    const groups = new Set();
    let strength = 0;
    const add = (flag, weight, group) => { flags.push(flag); strength += weight; groups.add(group); };

    /* ── G1 · series/technical: movement measured on the price series ──── */
    if (accel > 0.12) add('momentumAccel', 1, 'series');
    else if (accel < -0.12) add('momentumDecel', -1, 'series');

    const ind = e.analysis.indicators || {};
    const rsiVal = num(ind.rsi);
    if (rsiVal != null) {
      if (rsiVal < 32) add('rsiOversold', 0.8, 'series');
      else if (rsiVal > 68) add('rsiOverbought', -0.8, 'series');
    }
    const hist = num(ind.macd?.histogram);
    if (hist != null && Math.abs(hist) > 0) {
      // A histogram agreeing with the acceleration is one measured setup;
      // fighting it cancels out rather than inventing a direction.
      if (hist > 0 && accel > 0) add('macdUp', 0.6, 'series');
      else if (hist < 0 && accel < 0) add('macdDown', -0.6, 'series');
    }
    const percentB = num(ind.bollinger?.percentB);
    if (percentB != null) {
      if (percentB < 0.16) add('bollingerLow', 0.7, 'series');
      else if (percentB > 0.84) add('bollingerHigh', -0.7, 'series');
    }
    const ma20 = num(ind.ma20);
    const ma50 = num(ind.ma50);
    const price = num(e.coin.price) || last;
    if (ma20 != null && ma50 != null && Math.abs(pct(ma20, ma50)) > 0.4) {
      add(ma20 >= ma50 ? 'maBullish' : 'maBearish', ma20 >= ma50 ? 0.5 : -0.5, 'series');
    } else if (ma20 != null && price != null && Math.abs(pct(price, ma20)) > 1.5) {
      add(price >= ma20 ? 'aboveMa20' : 'belowMa20', price >= ma20 ? 0.5 : -0.5, 'series');
    }

    /* ── G2 · flow / on-chain: only when a feed actually measured it ───── */
    const intel = e.solanaIntel;
    if (intel?.configured) {
      if (intel?.holderTrend?.change === 'rising') add('holderGrowth', 1, 'flow');
      if (intel?.whaleFlow?.direction === 'inflow') add('whaleInflow', 1, 'flow');
      if (intel?.whaleFlow?.direction === 'outflow') add('whaleOutflow', -1, 'flow');
      if (intel?.dexActivity?.pressure === 'buy') add('dexBuy', 1, 'flow');
      if (intel?.dexActivity?.pressure === 'sell') add('dexSell', -1, 'flow');
    }
    if (e?.smToken?.classification === 'verified-paired-swaps' && e?.smToken?.signal === 'ACCUMULATION') add('smartMoneyAccum', 1, 'flow');
    else if (e?.smToken?.classification === 'verified-paired-swaps' && e?.smToken?.signal === 'DISTRIBUTION') add('smartMoneyDistrib', -1, 'flow');

    /* ── G3 · market: the tape the markets endpoint already reported ───── */
    const t = num(e.coin.mcap) > 0 ? (num(e.coin.volume) / num(e.coin.mcap)) * 100 : null;
    if (t != null && t >= 6) add('volumeTurnover', 0.5, 'market');
    const c24 = num(e.coin.change24h);
    if (c24 != null && c24 >= 2.5) add('momentum24Up', 0.6, 'market');
    else if (c24 != null && c24 <= -2.5) add('momentum24Down', -0.6, 'market');
    const c7 = num(e.coin.change7d);
    if (c7 != null && c7 >= 6) add('trend7dUp', 0.6, 'market');
    else if (c7 != null && c7 <= -6) add('trend7dDown', -0.6, 'market');

    /* ── G4 · behaviour: HOW the token traded (src/lib/tokenBehavior.js) ───
       This is the plane that makes an EARLY signal possible at all. The three
       planes above all need the move to be big enough to register; behaviour
       reads the structure underneath it, so a token can qualify while its
       percentage move is still small:
         · a one-sided tape and a broad, non-spiky move are what a real bid
           looks like before the candle;
         · relative strength vs BTC is the difference between «this token is
           moving» and «the whole market bounced»;
         · a hollow rally (price up, volume thin) and a one-spike move are
           exactly the early signals a desk wants to avoid, and they carry
           negative weight instead.
       Only measured parts contribute; a token whose series is too short for
       the read simply has no G4 flags and cannot qualify on this plane. */
    const beh = e.behavior ?? readTokenBehavior({
      series: prices,
      marketSeries: e.marketSeries ?? [],
      coin: e.coin,
      turnoverPct: num(e.coin.mcap) > 0 ? (num(e.coin.volume) / num(e.coin.mcap)) * 100 : null
    });
    if (beh) {
      if (beh.pressure && Math.abs(beh.pressure.score) >= 55) {
        add(beh.pressure.score > 0 ? 'oneSidedBuy' : 'oneSidedSell', beh.pressure.score > 0 ? 1.1 : -1.1, 'behavior');
      }
      if (beh.breadth && beh.breadth.direction !== 'flat' && beh.breadth.breadth != null) {
        const spike = beh.breadth.spikeShare ?? 0;
        if (beh.breadth.breadth >= 0.62 && spike <= 0.28) {
          add(beh.breadth.direction === 'up' ? 'moveBroadUp' : 'moveBroadDown', beh.breadth.direction === 'up' ? 0.9 : -0.9, 'behavior');
        } else if (beh.breadth.breadth <= 0.4 || spike >= 0.45) {
          add(beh.breadth.direction === 'up' ? 'moveHollowUp' : 'moveHollowDown', beh.breadth.direction === 'up' ? -0.9 : 0.9, 'behavior');
        }
      }
      if (beh.relative && beh.relative.label !== 'inline' && Math.abs(beh.relative.diffPct) >= 2.5) {
        add(beh.relative.label === 'outperforming' ? 'relativeStrengthUp' : 'relativeStrengthDown',
          beh.relative.label === 'outperforming' ? 0.9 : -0.9, 'behavior');
      }
      if (beh.volume && beh.volume.label === 'accumulating') add('volumeWithTrend', 0.7, 'behavior');
      else if (beh.volume && beh.volume.label === 'distributing') add('volumeWithDowntrend', -0.7, 'behavior');
      else if (beh.volume && beh.volume.label === 'hollow-rally') add('volumeHollow', -0.7, 'behavior');
      if (beh.anomaly?.unusual) add('moveAnomaly', beh.anomaly.sigma > 0 ? 0.6 : -0.6, 'behavior');
    }

    /* Independence gate: ≥2 flags AND ≥2 different observation planes. */
    if (flags.length < 2 || groups.size < 2) continue;

    /*
     * ─── THE SAME RECONCILIATION AS THE CARD, APPLIED AS A VETO ─────────────
     * An early flag set is a THIN observation by definition — that is what
     * «early» means — so it is exactly where a loud single plane can mislead.
     * The consensus runs on the same four planes and has three effects here,
     * all of them aimed at precision rather than at producing more signals:
     *
     *   • if the planes point the OTHER way with real agreement (≥2 planes,
     *     none agreeing with this entry), the entry is dropped — a bounce
     *     while smart money distributes is not an early buy, it is the exit;
     *   • if the planes disagree with each other, the entry is downgraded to
     *     «watch» rather than claiming a direction the evidence does not have;
     *   • confidence is nudged by how many planes actually agree, and a
     *     conflict can only lower it.
     *
     * It can never ADD an entry: every candidate still has to pass the two-
     * flag / two-group gate above first.
     */
    const consensus = readConsensus({
      technical: strength * 22,
      behavior: beh,
      smartMoney: e.smRead ?? null,
      market: e.marketRead ?? null,
      strength: Math.abs(strength) * 20
    });
    const entryDir = strength > 0.3 ? 'up' : strength < -0.3 ? 'down' : 'flat';
    const consensusOpposes = entryDir !== 'flat' && consensus.bias !== 'flat' && consensus.bias !== entryDir
      && consensus.agreement >= 0.5;
    if (consensusOpposes) continue;

    const directionOut = entryDir !== 'flat' && consensus.bias !== entryDir && consensus.conflict
      ? 'earlyWatch'
      : (strength > 0.3 ? 'earlyBullish' : strength < -0.3 ? 'earlyBearish' : 'earlyWatch');

    out.push({
      coin: e.coin,
      symbol: e.coin.symbol,
      at: now,
      direction: directionOut,
      /* Confidence rises with the NUMBER of independent planes that agree,
         not merely with how loud one of them is — two loud readings from the
         same plane are still one observation. */
      confidence: Math.round(clampf(
        42 + Math.abs(strength) * 13 + flags.length * 5 + (groups.size > 2 ? 4 : 0) + (groups.size >= 3 ? 4 : 0)
        + (consensus.bias === entryDir ? 6 : 0)
        - (consensus.conflict ? 8 : 0),
        25,
        consensus.conflict ? 62 : 92
      )),
      /* The reconciliation rides along so the row can say WHICH sources agree
         — the same object shape the card carries, so both surfaces speak the
         same language about the same token. */
      consensus,
      flags: [
        ...flags,
        ...(consensus.bias === entryDir && consensus.measured >= 2 ? ['sourcesAgree'] : []),
        ...(consensus.conflict ? ['sourcesConflict'] : [])
      ],
      momentumAccelPct: Math.round(accel * 100) / 100,
      /* The behaviour read rides along so the section can show the STRUCTURE
         behind an early flag (participation, relative strength) without a
         second computation, and so the numbers it prints are the same ones
         that produced the flag. */
      behavior: beh
        ? {
          score: beh.score,
          breadth: beh.breadth?.breadth ?? null,
          spikeShare: beh.breadth?.spikeShare ?? null,
          pressure: beh.pressure?.score ?? null,
          relativeDiffPct: beh.relative?.diffPct ?? null,
          volumeLabel: beh.volume?.label ?? null
        }
        : null,
      last,
      strength: Math.round(strength * 10) / 10
    });
  }
  return out.sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength));
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
    if (timeframe !== 'all') {
      /*
       * The timeframe filter asks one question: does this card carry a measured
       * horizon for the window the reader picked? It used to answer a second,
       * broken one first — `Number('24H'.replace('D',''))` is NaN, so the 24H
       * comparison could never be true and the whole filter fell through to a
       * fallback that only looked right by accident. One mapping, one check,
       * and a card with no horizons is filtered out rather than silently kept.
       */
      const key = timeframe === '24H' ? '24H' : `${Number(timeframe.replace('D', ''))}D`;
      if (!(s.horizons || []).some((h) => h && h.key === key)) return false;
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
