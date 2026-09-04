/**
 * SIGNAL INTELLIGENCE CENTER PROBE  (signals-intel-probe.mjs)
 * ---------------------------------------------------------------------------
 * Phase 3 — AI Signal System Upgrade. Proves the claims the UI makes:
 *
 *  (a) The signal engine is DETERMINISTIC and FAIL-CLOSED: the same real
 *      inputs produce the same card; thin data yields INSUFFICIENT_DATA
 *      instead of an invented signal; confidence is bounded and driven by
 *      measured agreement.
 *  (b) Risk overrides only DOWNGRADE a call (HIGH risk can never become a
 *      BUY) and produce the six documented classes.
 *  (c) The server sanitizer drops anything outside the evidence allowlist —
 *      a wallet address, a key or a seed can never reach an AI.
 *  (d) explainSignal produces an honest LOCAL explanation when no AI provider
 *      is configured (no network, no hallucination).
 *  (e) The Solana early-token scoring is deterministic, flags only observable
 *      risk, and reports unobservable authority/lock/honeypot fields as null.
 *  (f) The learning loop (record -> settle -> performance) uses only real
 *      outcomes and starts empty rather than showing fabricated stats.
 *  (g) Alerts fire once per cooldown, watchlist dedupes, and portfolio
 *      consent defaults to OFF with aggregate-only summaries.
 */
import { analyze } from '../src/lib/ai.js';
import {
  computeHorizonRisks, computeSignalCard, computePulseLocal, computeEarlySignals,
  filterSignals, searchSignals, confidenceEngine, localReasonFromEvidence
} from '../src/lib/signalEngine.js';

const ALLOWED_EVIDENCE = new Set([
  'price', 'change24h', 'change7d', 'momentum', 'rsi', 'macd', 'ma20', 'ma50',
  'bollinger', 'support', 'resistance', 'volumeTurnover', 'liquidityUsd',
  'volatilityPct', 'whaleFlow', 'holderTrend', 'topHolderPct', 'dexPressure',
  'smartMoneyNetUsd', 'smartMoneySignal', 'marketSentiment', 'btcDominance',
  'riskScore', 'confidence', 'agreement', 'evidenceCount', 'timeframe'
]);

/* localStorage shim for the pure client store (node has none). */
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};

export default async function run() {
  const store = await import('../src/lib/signalStore.js');
  const { sanitizeEvidence, scoreSolanaToken, explainSignal } = await import('../server/signalEngine.js');

  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* deterministic synthetic series — 90 points with a mild uptrend */
  const makeSeries = (n = 90, start = 100, drift = 0.0015) => {
    const out = [];
    let v = start;
    for (let i = 0; i < n; i += 1) {
      v = v * (1 + drift + Math.sin(i / 5) * 0.004);
      out.push(v);
    }
    return out;
  };

  const COIN = {
    id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 0, change24h: 2.4, change7d: 6.1,
    mcap: 1e12, volume: 4e10, rank: 1, dataProvenance: 'live'
  };
  const series = makeSeries();
  COIN.price = series[series.length - 1];
  const analysis = analyze(series, COIN);
  const pulse = computePulseLocal({
    global: { mcapChange: 2.1, mcap: 2.4e12, volume: 2.1e11, avgChange: 1.2 },
    markets: [
      { ...COIN, change24h: 2.4 },
      { ...COIN, id: 'ethereum', symbol: 'ETH', name: 'Ethereum', change24h: -1.2 }
    ],
    smartMoney: { dataStatus: 'live', metrics: { netFlow: { value: 2e6 } } }
  });

  /* ─────────────── (a) deterministic + fail-closed engine ─────────────── */
  const NOW = 1_700_000_000_000;
  const card = computeSignalCard({ coin: COIN, series, analysis, pulse, now: NOW });
  t('a real data card is READY with a documented class and bounded confidence',
    card.status === 'READY'
    && ['STRONG_BUY', 'BUY', 'WATCH', 'SELL', 'HIGH_RISK', 'AVOID'].includes(card.classification)
    && card.confidence >= 1 && card.confidence <= 95
    && Array.isArray(card.evidence) && card.evidence.length >= 3
    && Array.isArray(card.horizons) && card.horizons.length === 3);

  t('the engine is deterministic — same inputs, identical card',
    JSON.stringify(card) === JSON.stringify(computeSignalCard({ coin: COIN, series, analysis, pulse, now: NOW })));

  t('horizon risks cover 24H / 7D / 30D with scores and labels',
    card.horizons.map((h) => h.key).join(',') === '24H,7D,30D'
    && card.horizons.every((h) => h.riskScore >= 0 && h.riskScore <= 100)
    && card.horizons.every((h) => ['LOW', 'MEDIUM', 'HIGH'].includes(h.riskLabel)));

  const thinSeries = makeSeries(12);
  const thin = computeSignalCard({ coin: COIN, series: thinSeries, analysis: analyze(thinSeries, COIN), pulse });
  t('thin data fails closed: INSUFFICIENT_DATA, no invented signal',
    thin.status === 'INSUFFICIENT_DATA' && thin.classification === null);

  /* confidence engine respects its bounds for wild inputs */
  t('the confidence engine cannot exceed 95 or drop below 5',
    confidenceEngine({ evidence: [], agreement: 100, signalScore: 100, turnoverPct: 99 }) <= 95
    && confidenceEngine({ evidence: [], agreement: 0, signalScore: 0, turnoverPct: 0 }) >= 5);

  /* ─────────────── (b) risk can only downgrade a call ──────────────────── */
  const highRiskHorizons = computeHorizonRisks({ series: makeSeries(90, 100, 0.003), coin: COIN });
  const stressed = highRiskHorizons.map((h) => ({ ...h, riskScore: 85, riskLabel: 'HIGH', volatilityPct: 9 }));
  const risky = computeSignalCard({ coin: COIN, series, analysis, horizons: stressed, pulse });
  t('HIGH risk + bullish read → HIGH_RISK (never BUY)',
    risky.classification === 'HIGH_RISK' || risky.classification === 'AVOID');

  const extremeRisk = computeSignalCard({
    coin: COIN, series, analysis,
    horizons: stressed.map((h) => ({ ...h, riskScore: 92, riskLabel: 'HIGH' })),
    pulse
  });
  t('extreme risk ≥ 85 → AVOID, not a trade signal',
    extremeRisk.classification === 'AVOID');

  /* ─────────────── (c) server sanitizer — nothing but evidence ─────────── */
  const dirty = {
    price: 67450, rsi: 61, momentum: 12, change24h: 2.4,
    walletAddress: '0xdeadbeef', privateKey: 'sk_live_secret', seed: 'abandon abandon',
    portfolioId: 'p-42', mintAuthority: 'fake'
  };
  const clean = sanitizeEvidence(dirty);
  t('the sanitizer drops addresses, keys, seeds and portfolio ids',
    !('walletAddress' in clean) && !('privateKey' in clean)
    && !('seed' in clean) && !('portfolioId' in clean) && !('mintAuthority' in clean)
    && Object.keys(clean).every((k) => ALLOWED_EVIDENCE.has(k)));

  /* ─────────────── (d) explainSignal → honest local when no AI ─────────── */
  const savedEnv = {};
  for (const k of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'AIMLAPI_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'BLOB_READ_WRITE_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    savedEnv[k] = process.env[k];
    process.env[k] = '';
  }
  try {
    const why = await explainSignal({
      symbol: 'BTC', name: 'Bitcoin', lang: 'en',
      evidence: { price: 67450, rsi: 61, momentum: 12, change24h: 2.4, whaleFlow: 'inflow', smartMoneySignal: 'ACCUMULATION' },
      classification: 'BUY', confidence: 71, riskLabel: 'MEDIUM', timeframe: 7
    });
    t('explainSignal is honest local when no provider is configured',
      why.source === 'local' && why.schema === 'fbt.signal-why.v1'
      && typeof why.sections.technical === 'string' && why.sections.technical.length > 0
      && typeof why.technical === 'string'
      && !/guarantee|100% profit/i.test(why.conclusion));
    const insufficient = await explainSignal({
      symbol: 'X', name: 'X', lang: 'en',
      evidence: { price: 1, rsi: 50 },
      classification: 'WATCH'
    });
    t('too-little evidence → explicit insufficient local explanation',
      insufficient.source === 'local' && String(insufficient.aiMeta.note).includes('Not enough'));
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  t('deterministic reason keys come only from measured evidence',
    localReasonFromEvidence({ momentum: 12, change24h: 3, whaleFlow: 'inflow', holderTrend: 'rising' }).includes('whaleInflow'));

  /* ─────────────── (e) Solana early-token scoring ──────────────────────── */
  const young = scoreSolanaToken({
    address: 'A'.repeat(44), symbol: 'NEW', name: 'New', ageHours: 6,
    liquidityUsd: 8000, volumeH24: 120000, buysH24: 90, sellsH24: 10, fdv: 30000
  }, null);
  t('a brand-new thin-liquidity token scores HIGH risk with observable flags',
    young.riskScore >= 75 && young.riskLabel === 'HIGH'
    && young.flags.includes('brandNew') && young.flags.includes('unknownOnchain'));

  const grown = scoreSolanaToken({
    address: 'B'.repeat(44), symbol: 'GRO', name: 'Grown', ageHours: 300,
    liquidityUsd: 400000, volumeH24: 500000, buysH24: 320, sellsH24: 250, fdv: 900000
  }, { configured: true, topHolderPct: 18, holderTrend: { change: 'rising' }, dexActivity: { pressure: 'buy' } });
  t('a mature token with flow data can score opportunity above risk',
    grown.opportunityScore > grown.riskScore && grown.holderTrend === 'rising' && grown.riskScore < 50);

  t('unobservable safety fields are null, never guessed',
    young.mintAuthority === null && young.freezeAuthority === null
    && young.lpLocked === null && young.honeypot === null && young.liquidityRemoval === null);

  /* ─────────────── (f) learning loop: real outcomes only ───────────────── */
  const s1 = store.recordSignal({ ...card, coin: COIN, status: 'READY', timeframe: 7 });
  t('recordSignal stores one entry per coin/horizon/day (no poll spam)',
    s1.length === 1 && store.recordSignal({ ...card, coin: COIN, status: 'READY', timeframe: 7 }).length === 1);

  const settled = store.settleHistory({
    history: s1,
    prices: { bitcoin: COIN.price * 1.06 },
    now: s1[0].ts + 8 * 24 * 3600_000
  });
  t('settling compares prediction with the REAL price and marks the result',
    settled[0].settled === true && settled[0].result === 'success' && Math.abs(settled[0].outcomePct - 6) < 0.6);

  const emptyPerf = store.performance([]);
  const perf = store.performance(settled);
  t('performance is honest: zero settled signals → null stats, not zeros',
    emptyPerf.accuracy === null && emptyPerf.note === 'insufficientHistory'
    && perf.accuracy === 100 && perf.settledSignals === 1);

  /* ─────────────── (g) alerts + watchlist + consent ────────────────────── */
  store.createAlert({ symbol: 'BTC', kind: 'confidence', condition: 'above', value: 88 });
  const fired = store.evaluateSignalAlerts({ alerts: store.readAlerts(), signals: [{ coin: COIN, status: 'READY', confidence: 91 }] });
  t('a confidence alert fires once against real signal data',
    fired.fired.length === 1 && fired.fired[0].kind === 'confidence');
  const cooldown = store.evaluateSignalAlerts({ alerts: fired.next, signals: [{ coin: COIN, status: 'READY', confidence: 95 }] });
  t('the same alert is quiet during its cooldown',
    cooldown.fired.length === 0);

  t('watchlist toggle is idempotent (add → remove)',
    store.toggleWatch('bitcoin').includes('bitcoin') && !store.toggleWatch('bitcoin').includes('bitcoin'));

  t('portfolio consent defaults to OFF',
    store.readConsent().portfolioAi === false);
  const summary = store.portfolioSummaryForAi({
    positions: [{ symbol: 'SOL', coinId: 'solana', qty: 20 }],
    priceMap: { solana: 150 }
  });
  t('portfolio summary is aggregate only — symbol and %, never an address',
    summary && summary.exposure[0].symbol === 'SOL' && !JSON.stringify(summary).includes('address'));

  /* pure helpers stay sane */
  t('filterSignals + searchSignals behave on ready cards',
    filterSignals([card], { confidence: '50' }).length === 1 && searchSignals([card], 'btc').length === 1);
  t('early signals never fabricate — they return measured entries only',
    computeEarlySignals({ entries: [{ coin: COIN, series: [], analysis: null, smToken: null }] }).length === 0);

  return rows;
}
