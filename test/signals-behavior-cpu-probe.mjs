/**
 * SIGNAL BEHAVIOUR + CPU BUDGET PROBE  (signals-behavior-cpu-probe.mjs)
 * ---------------------------------------------------------------------------
 * Two promises were made in this change and neither is visible in a screenshot:
 *
 *  (A) «رفتارشناسی توکن» — the behaviour read added to the signal engine is
 *      MEASURED, DETERMINISTIC and FAIL-CLOSED. Every field is derived from a
 *      price series the page already holds; a series too short to measure
 *      yields `null` (not a neutral zero), a pegged asset cannot divide by a
 *      zero dispersion, and the same inputs always produce the same read. It
 *      must also actually change the SIGNAL: a one-sided tape with broad
 *      participation has to score differently from a hollow spike — otherwise
 *      the new plane is decoration.
 *
 *  (B) The Signals page must not spend Fluid Active CPU on work whose answer
 *      cannot have changed. That is asserted structurally, on the SOURCE of the
 *      page and of the AI client, because the failure mode is an effect that
 *      fires on every poll: one extra `/api/ai/outlook` per 30-second tick per
 *      open tab. The numbers here are the contract, so a later edit that
 *      quietly restores the per-tick call breaks this file instead of the
 *      deployment.
 *
 * Pure Node — no DOM, no network, no bundler needed for the engine half.
 */
import { readFileSync } from 'node:fs';
import {
  readTokenBehavior, moveBreadth, tapePressure, relativeStrength,
  volumeAgreement, moveAnomaly, patternRepeat, seriesVolPct
} from '../src/lib/tokenBehavior.js';
import { analyze } from '../src/lib/ai.js';
import { computeSignalCard, computeEarlySignals, buildEvidence, MIN_EVIDENCE } from '../src/lib/signalEngine.js';

const clamp = (v) => Number.isFinite(v);

/** Deterministic series: `f(i)` for i in 0..n-1, always positive. */
const seriesOf = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/** A steady grind up: most steps agree, no single spike dominates. */
const broadUptrend = (n = 90) => seriesOf(n, (i) => 100 * (1 + i * 0.004));
/** The same net move delivered by three fat candles and a flat tape. */
const spikeUptrend = (n = 90) => seriesOf(n, (i) => (i < n - 3 ? 100 : i === n - 3 ? 116 : i === n - 2 ? 118 : 120));

const COIN = {
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 0,
  change24h: 2.4, change7d: 6.1, mcap: 1e12, volume: 4e10, rank: 1,
  dataProvenance: 'live'
};

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ═════════════════ (A) the behaviour read is real arithmetic ═══════════ */

  const broad = moveBreadth(broadUptrend());
  const spike = moveBreadth(spikeUptrend());
  t('move breadth separates a broad grind from a three-candle spike',
    broad && spike
    && broad.breadth > 0.9 && broad.spikeShare < 0.1
    && spike.breadth < 0.2 && spike.spikeShare > 0.8);

  const up = tapePressure(broadUptrend());
  const down = tapePressure(broadUptrend().map((v) => 250 - v));
  t('tape pressure is signed: buying tape positive, selling tape negative',
    up && down && up.score > 55 && down.score < -55);

  const rs = relativeStrength(broadUptrend(), seriesOf(90, (i) => 100 * (1 + i * 0.001)));
  t('relative strength compares the SAME window and reports the difference',
    rs && rs.diffPct > 10 && rs.label === 'outperforming');

  t('relative strength refuses misaligned or missing inputs (no invented number)',
    relativeStrength([1, 2, 3], seriesOf(90, (i) => 100 + i)) === null
    && relativeStrength(broadUptrend(), []) === null);

  const va = volumeAgreement({ coin: { change24h: 3, change7d: 8 }, turnoverPct: 9 });
  t('volume agreement labels an active uptrend as accumulation and a thin one as hollow',
    va.label === 'accumulating'
    && volumeAgreement({ coin: { change24h: 3, change7d: 8 }, turnoverPct: 0.5 }).label === 'hollow-rally');

  t('a pegged series cannot produce an anomaly sigma (no division by zero)',
    moveAnomaly(seriesOf(40, () => 1)) === null && seriesVolPct(seriesOf(40, () => 1)) === 0);

  t('pattern repeat reports the shape distance and where it was seen',
    patternRepeat(broadUptrend(), 6)?.distance >= 0
    && Number.isFinite(patternRepeat(broadUptrend(), 6)?.seenStepsAgo));

  t('a series too short for behaviour yields null — not a neutral reading',
    readTokenBehavior({ series: [1, 2, 3, 4] }) === null);

  const beh = readTokenBehavior({
    series: broadUptrend(), marketSeries: seriesOf(90, (i) => 100 * (1 + i * 0.001)),
    coin: { change24h: 2.4, change7d: 6.1, mcap: 1e12, volume: 4e10 }
  });
  t('the composite read is bounded, directional and counts only measured parts',
    beh && beh.score >= -100 && beh.score <= 100 && beh.direction === 'up'
    && beh.parts >= 2 && beh.confidence >= 20 && beh.confidence <= 90);

  t('the behaviour read is deterministic — same input, identical output',
    JSON.stringify(beh) === JSON.stringify(readTokenBehavior({
      series: broadUptrend(), marketSeries: seriesOf(90, (i) => 100 * (1 + i * 0.001)),
      coin: { change24h: 2.4, change7d: 6.1, mcap: 1e12, volume: 4e10 }
    })));

  /* ═════════════════ (A2) it changes the signal, not just the panel ═════ */

  const coinA = { ...COIN, price: broadUptrend().at(-1) };
  const analysisA = analyze(broadUptrend(), coinA);
  const cardBroad = computeSignalCard({
    coin: coinA, series: broadUptrend(), analysis: analysisA, behavior: beh, now: 1_700_000_000_000
  });
  t('the card carries the measured behaviour read and behaviour evidence',
    cardBroad.behavior?.score === beh.score
    && cardBroad.evidence.some((e) => e.source === 'behavior'));

  const coinB = { ...COIN, price: spikeUptrend().at(-1) };
  const analysisB = analyze(spikeUptrend(), coinB);
  const cardSpike = computeSignalCard({
    coin: coinB, series: spikeUptrend(), analysis: analysisB, now: 1_700_000_000_000
  });
  t('a hollow spike scores below the same move made of broad participation',
    cardBroad.score > cardSpike.score);

  /* Weights must be real: the same evidence with behaviour attached cannot
     come out identical to the evidence without it. */
  const base = buildEvidence({ coin: coinA, analysis: analysisA });
  const withBeh = buildEvidence({ coin: coinA, analysis: analysisA, behavior: beh });
  t('buildEvidence adds the behaviour plane only when a read exists',
    withBeh.length > base.length
    && withBeh.filter((e) => e.source === 'behavior').every((e) => Num(e.weight) > 0));

  t('a card still needs the documented minimum of independent evidence',
    computeSignalCard({ coin: coinA, series: [1, 2, 3], analysis: null }).status === 'INSUFFICIENT_DATA'
    && MIN_EVIDENCE >= 3);

  /* ═════════════════ (A3) early detection got an earlier plane ══════════ */

  const earlyEntries = [{
    coin: { ...COIN, id: 'ethereum', symbol: 'ETH', change24h: 0.4, change7d: 0.9, price: broadUptrend().at(-1) },
    series: broadUptrend(),
    analysis: analysisA,
    marketSeries: seriesOf(90, (i) => 100 * (1 + i * 0.001)),
    smToken: null
  }];
  const early = computeEarlySignals({ entries: earlyEntries });
  t('the early detector can qualify a token on behaviour + one other plane',
    early.length === 1
    && early[0].flags.some((f) => ['oneSidedBuy', 'moveBroadUp', 'relativeStrengthUp', 'volumeWithTrend'].includes(f))
    && early[0].behavior && Number.isFinite(early[0].behavior.score));

  t('the early detector still refuses an entry with no measurable behaviour',
    computeEarlySignals({ entries: [{ coin: COIN, series: [1, 2, 3], analysis: null }] }).length === 0);

  /* ═════════════════ (B) the CPU contract, asserted on the source ═══════ */

  const page = readFileSync(new URL('../src/pages/Signals.jsx', import.meta.url), 'utf8');
  const aiClient = readFileSync(new URL('../src/lib/aiClient.js', import.meta.url), 'utf8');
  /*
   * ── DURABLE TIER ────────────────────────────────────────────────────────
   * `withCache` is per instance: on a serverless host a cold start began with
   * an empty Map and the first visitor paid for the whole pulse (a 40-row
   * market walk plus a 14s-budgeted smart-money overview) and the whole radar
   * (DexScreener + up to sixteen Solscan enrichments). `withPersistentCache`
   * is what makes a quiet night cost one rebuild per TTL instead of one per
   * wake-up, so it must not be silently reverted to the memory-only call.
   */
  const sigEngine = readFileSync(new URL('../server/signalEngine.js', import.meta.url), 'utf8');
  const pulseFn = sigEngine.slice(sigEngine.indexOf('export async function buildMarketPulse'));
  t('the market pulse survives a cold start',
    pulseFn.slice(0, 1200).includes('withPersistentCache(') && pulseFn.includes("'sig:pulse'"));
  const radarFn = sigEngine.slice(sigEngine.indexOf('export async function buildSolanaRadar'));
  t('the Solana radar survives a cold start',
    radarFn.slice(0, 900).includes('withPersistentCache(') && radarFn.includes('sig:radar:solana:'));
  t('both keep the in-memory tier in front of the durable one',
    (sigEngine.match(/withCache\(\s*[`']sig:(pulse|radar)/g) || []).length >= 2);

  const server = readFileSync(new URL('../server/app.js', import.meta.url), 'utf8');
  const hooks = readFileSync(new URL('../src/hooks/useMarket.js', import.meta.url), 'utf8');

  const num = (name) => Number((new RegExp(`const ${name} = ([\\d_]+)`).exec(page) || [])[1]?.replace(/_/g, ''));

  t('poll clocks are named constants, not magic numbers spread through the page',
    ['PULSE_POLL_MS', 'SM_POLL_MS', 'CHART_POLL_MS', 'MARKET_REF_POLL_MS']
      .every((k) => clamp(num(k)) && num(k) >= 45_000));

  t('no poll on this page runs faster than the server route it calls can rebuild',
    num('PULSE_POLL_MS') >= 60_000 && num('SM_POLL_MS') >= 60_000
    && num('CHART_POLL_MS') >= 60_000 && num('MARKET_REF_POLL_MS') >= 60_000);

  t('the AI brief is requested per language per 6-hour block, not per poll',
    /briefBlock = Math\.floor\(Date\.now\(\) \/ \(6 \* 3600_000\)\)/.test(page)
    && /briefKeyRef\.current === briefKey/.test(page));

  t('the AI outlook is keyed by asset+language+horizon+day, never by analysis.score',
    /outlookKey = `\$\{coin\?\.id[^`]*\$\{outlookDay\}`/.test(page)
    && !/\}, \[coin\?\.id, analysis\?\.score/.test(page));

  t('both AI effects skip work while the tab is hidden',
    (page.match(/document\.visibilityState === 'hidden'/g) || []).length >= 2);

  t('an asset row is analysed once per poll and shared by cards and early detector',
    /const analysedRows = useMemo/.test(page)
    && (page.match(/analyze\(series, c\)/g) || []).length === 1);

  t('the on-chain token read is memoized by chain+address for five minutes',
    /onchainCache = useRef\(new Map\(\)\)/.test(page)
    && /5 \* 60_000/.test(page));

  t('the AI client honours the server offerings instead of POSTing into a 503',
    /aiOffering\('outlook'\)/.test(aiClient) && /aiOffering\('brief'\)/.test(aiClient));

  const statusRoute = server.slice(server.indexOf("app.get('/api/ai/status'"));
  t('/api/ai/status is cacheable and publishes its offerings',
    statusRoute.includes('offerings: {')
    && statusRoute.slice(0, 4000).includes("cache-control', 'public, max-age=60"));

  t('useChart/useMarkets accept an interval so a screen can match its route cache',
    /useChart = \(id, days, intervalMs = 60000\)/.test(hooks)
    && /useMarkets = \(perPage = 50, intervalMs = 30000\)/.test(hooks));

  return rows;
}

/** Small local mirror of the engine's numeric guard, for readability above. */
function Num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
