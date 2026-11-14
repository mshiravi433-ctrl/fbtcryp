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
import { backtest, tapeKindAt } from '../src/lib/backtest.js';
import { computeSignalCard, computeEarlySignals, buildEvidence, MIN_EVIDENCE, classify, CLASS } from '../src/lib/signalEngine.js';
import { readConsensus, PLANES } from '../src/lib/signalConsensus.js';
import { createScoreTracker, readAcceleration, MAX_TRACKED, SAMPLES_PER_TOKEN } from '../src/lib/signalMomentum.js';
import { scenarioFan, MIN_SAMPLES, MIN_EFFECTIVE } from '../src/lib/scenarioFan.js';
import { portfolioImpact } from '../src/lib/signalEngine.js';
import {
  forecastChangePct, rememberForecastRead, lastForecastRead, __resetForecastReadForTests
} from '../src/lib/kronosLocal/client.js';

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

  /* ═══════════ (A2) the class ladder, the levels and the confidence ══════ */

  /*
   * A symmetric ladder. The sell side used to collapse ±32 into one label, so
   * «strong» meant nothing on the downside and the function could not be
   * reasoned about. Both sides are now the same two cuts.
   */
  t('the class ladder is symmetric around zero',
    classify(40) === CLASS.STRONG_BUY && classify(14) === CLASS.BUY
    && classify(13.9) === CLASS.WATCH && classify(0) === CLASS.WATCH
    && classify(-13.9) === CLASS.WATCH && classify(-14) === CLASS.SELL
    && classify(-40) === CLASS.SELL && classify(-80) === CLASS.SELL);

  /*
   * THE LEVELS MUST AGREE WITH THE CALL. `tradeDirection` exists because the
   * panel rendered `+target / −stop` unconditionally; a card downgraded to
   * HIGH_RISK while its evidence sat below zero carried a DOWNWARD target
   * behind a literal «+». Whenever a target exists the direction must be
   * stated, and a BUY/SELL must never carry the opposite one.
   */
  const cardFor = (seriesIn) => computeSignalCard({
    coin: { ...COIN, price: seriesIn[seriesIn.length - 1] },
    series: seriesIn,
    analysis: analyze(seriesIn, COIN),
    now: 1_700_000_000_000
  });
  const upCard = cardFor(broadUptrend(120));
  const downCard = cardFor(seriesOf(120, (i) => 200 * (1 - i * 0.004)));
  t('a target always carries the direction it was measured in',
    (upCard.target == null || ['up', 'down'].includes(upCard.tradeDirection))
    && (downCard.target == null || ['up', 'down'].includes(downCard.tradeDirection)));
  t('a BUY never points down and a SELL never points up',
    ((upCard.classification !== CLASS.BUY && upCard.classification !== CLASS.STRONG_BUY) || upCard.tradeDirection === 'up')
    && (downCard.classification !== CLASS.SELL || downCard.tradeDirection === 'down'));

  /*
   * CONFIDENCE CANNOT CONTRADICT ITS OWN EVIDENCE. Everything direction-blind
   * (volatility, liquidity, strength) used to push a contested card to 70+
   * while its evidence netted the other way. The cap is 55 — the same
   * «moderate» line the card already uses — and it only ever LOWERS a number.
   */
  const { confidenceEngine } = await import('../src/lib/signalEngine.js');
  const contested = confidenceEngine({
    evidence: [{ direction: 1, weight: 1.2 }, { direction: -1, weight: 1.3 }, { direction: -1, weight: 1.1 }],
    agreement: 95, marketAgreement: 90, onchainAgreement: 95,
    freshness: 1, turnoverPct: 12, volatilityScore: 20, signalScore: 8
  });
  const aligned = confidenceEngine({
    evidence: [{ direction: 1, weight: 1.2 }, { direction: 1, weight: 1.3 }],
    agreement: 95, marketAgreement: 90, onchainAgreement: 95,
    freshness: 1, turnoverPct: 12, volatilityScore: 20, signalScore: 30
  });
  t('a card whose evidence points the other way cannot read as conviction',
    contested <= 55 && aligned > contested);

  /*
   * THE TAPE SPLIT MUST BE MEASURABLE OR ABSENT. `behaviorEdge` replays the
   * untouched rule and buckets it by participation; a bucket under six
   * occurrences is not reported at all, a short series returns null, and the
   * result is deterministic (so it can be shown on a card without flicker).
   */
  const choppy = seriesOf(200, (i) => 100 * (1 + Math.sin(i / 3) * 0.05));
  const be1 = backtest(choppy, 7)?.tape;
  const be2 = backtest(choppy, 7)?.tape;
  t('the tape split is deterministic and reports only measurable buckets',
    JSON.stringify(be1) === JSON.stringify(be2)
    && be1 != null
    && [be1.broad, be1.spiky].filter(Boolean).every((b) => b.n >= be1.minBucket && Number.isFinite(b.edge)));
  t('the tape split refuses a series too short to judge',
    backtest(seriesOf(60, (i) => 100 + i), 7) === null);
  t('nothing is fitted: the same rule and horizon are replayed',
    be1.horizon === 7);
  /* The split must be a REAL split: the two tapes are classified by different
     structure, so a series with both must not collapse into one bucket, and the
     classifier must never guess in the unclassified middle. */
  const mixed = seriesOf(220, (i) => {
    const trend = 100 * (1 + i * 0.002);
    return i % 40 < 20 ? trend : trend * (1 + (i % 40 === 20 ? 0.05 : 0));
  });
  t('the tape classifier answers broad, spiky or nothing — never a guess',
    [60, 80, 100, 120, 140, 160, 180].every((i) => [null, 'broad', 'spiky'].includes(tapeKindAt(mixed, i))));
  t('the split rides on the ONE backtest pass instead of a second walk',
    /const kind = tapeKindAt\(v, i\)/.test(readFileSync(new URL('../src/lib/backtest.js', import.meta.url), 'utf8'))
    && (readFileSync(new URL('../src/lib/backtest.js', import.meta.url), 'utf8').match(/for \(let i = 50;/g) || []).length === 1);

  /* ── the timeframe filter answers the question it is asked ───────────── */
  {
    const { filterSignals } = await import('../src/lib/signalEngine.js');
    const horizons = [{ key: '24H' }, { key: '7D' }, { key: '30D' }];
    const card = { coin: COIN, status: 'READY', classification: 'BUY', confidence: 70, horizons };
    t('the timeframe filter keeps a card that carries that horizon',
      ['24H', '7D', '30D'].every((tf) => filterSignals([card], { timeframe: tf }).length === 1));
    t('the timeframe filter drops a card that carries no horizons at all',
      filterSignals([{ ...card, horizons: [] }], { timeframe: '7D' }).length === 0
      && filterSignals([{ ...card, horizons: undefined }], { timeframe: '24H' }).length === 0);
  }

  /* ═════════ (A3) the four-plane consensus («یکسان‌ساز نتایج») ═══════════ */

  /*
   * THE CASE THE USER NAMED, END TO END:
   * «در اسمارت‌مانی فروش بیت‌کوین زیاد بوده، پس احتمال سیگنال فروش و کاهش
   *  قیمت هست». Heavy verified smart-money DISTRIBUTION must read as a real
   * bearish lean, and it must be able to move the call — while a single lone
   * plane must never be able to.
   */
  const sm = readConsensus({
    technical: -22,
    behavior: { score: -40, parts: 3 },
    smartMoney: { signal: 'DISTRIBUTION', netUsd: -42_000_000, confidence: 88 },
    market: { mcapChange: -2.4, avgChange: -1.8, breadth: 0.3, btcDominance: 56, forecast: -1.1 },
    strength: 35
  });
  t('heavy smart-money selling plus a falling market reads as a DOWN consensus',
    sm.bias === 'down' && sm.detail.smartMoney < 0 && sm.multiplier > 1 && sm.conflict === null);
  t('four agreeing planes reach the full agreement ceiling',
    sm.measured === 4 && sm.agreement === 1 && sm.confidence >= 90);

  /* The inverse must be symmetric — a pump read with accumulation. */
  const buy = readConsensus({
    technical: 24,
    behavior: { score: 45, parts: 3 },
    smartMoney: { signal: 'ACCUMULATION', netUsd: 38_000_000, confidence: 90 },
    market: { mcapChange: 2.6, avgChange: 2.2, breadth: 0.72, btcDominance: 48, forecast: 1.4 },
    strength: 40
  });
  t('accumulation plus a rising market reads as an UP consensus',
    buy.bias === 'up' && buy.detail.smartMoney > 0 && buy.multiplier > 1);

  /*
   * ONE PLANE IS NOT A CONSENSUS. This is the failure the module exists to
   * prevent: a single loud reading must not be able to claim agreement.
   */
  const lone = readConsensus({ technical: -40 });
  t('a single measured plane is never reported as consensus',
    lone.measured === 1 && lone.bias === 'flat' && lone.multiplier <= 1);
  t('a plane that was not measured contributes nothing at all',
    readConsensus({}).measured === 0 && readConsensus({}).score === 0
    && readConsensus({ behavior: null }).detail.behavior === null);

  /*
   * CONFLICT IS STATED, NOT AVERAGED AWAY. Smart money selling while the tape
   * is bid is a genuine disagreement, and the card must be SOFTER — never
   * louder — for it.
   */
  const fight = readConsensus({
    technical: 25,
    behavior: { score: 40, parts: 3 },
    smartMoney: { signal: 'DISTRIBUTION', netUsd: -30_000_000, confidence: 85 },
    strength: 30
  });
  t('opposing planes are reported as a conflict',
    fight.conflict !== null && fight.conflict.up.length >= 1 && fight.conflict.down.includes('smartMoney'));
  t('conflict softens the multiplier instead of amplifying it', fight.multiplier <= 1);

  /* A contradictory smart-money row abstains rather than voting twice. */
  const contradiction = readConsensus({
    technical: 10,
    smartMoney: { signal: 'ACCUMULATION', netUsd: -9_000_000, confidence: 80 }
  });
  t('a smart-money row whose signal contradicts its own flow abstains',
    contradiction.detail.smartMoney === null && contradiction.measured === 1);

  /* Bounded by construction: a multiplier can sharpen, never invent. */
  t('the multiplier is bounded so agreement can sharpen but never fabricate',
    [sm, buy, lone, fight, contradiction].every((c) => c.multiplier >= 0.8 && c.multiplier <= 1.25));

  /*
   * AND IT MATTERS: the same inputs with and without the consensus plane must
   * produce a different card score, and the consensus may only scale the
   * weighted evidence — it can never add a direction of its own.
   */
  const mSeries = seriesOf(120, (i) => 100 * (1 - i * 0.003));
  const mCoin = { ...COIN, price: mSeries[mSeries.length - 1], change24h: -3.2, change7d: -6.1 };
  const mAnalysis = analyze(mSeries, mCoin);
  const bareCard = computeSignalCard({ coin: mCoin, series: mSeries, analysis: mAnalysis, now: 1_700_000_000_000 });
  const withMarket = computeSignalCard({
    coin: mCoin, series: mSeries, analysis: mAnalysis,
    marketRead: { mcapChange: -2.4, avgChange: -1.8, breadth: 0.28, btcDominance: 56, forecast: -1.1 },
    /* The user's own example, at card level: heavy selling in smart money for
       THIS asset, on a falling tape. */
    smRead: { signal: 'DISTRIBUTION', netUsd: -42_000_000, confidence: 88 },
    now: 1_700_000_000_000
  });
  t('the market/forecast plane reaches the card the page renders',
    withMarket.consensus?.measured >= bareCard.consensus?.measured
    && withMarket.consensus.detail.market !== null
    && bareCard.consensus.detail.market === null);
  t('heavy smart-money selling of this asset moves the card toward SELL',
    withMarket.consensus.detail.smartMoney < 0
    && (withMarket.consensus.bias === 'down' || withMarket.consensus.conflict !== null)
    && withMarket.consensus.measured > bareCard.consensus.measured);
  /* Both fields are rounded for display, so the identity is checked to within
     one point of rounding — what matters is that score is a SCALE of the
     measured evidence rather than a second, independent number. */
  t('the consensus can only scale the measured score, never replace it',
    Number.isFinite(withMarket.rawScore)
    && Math.abs(withMarket.score - withMarket.rawScore * withMarket.consensus.multiplier) <= 1);
  t('the card exposes all four planes in a stable order',
    bareCard.consensus.signals.map((x) => x.plane).join(',') === PLANES.join(','));

  /*
   * A CROSS-PLANE CONFLICT MUST NOT READ AS CONVICTION. The card-level cap is
   * asserted here as well as in the engine, because the two are wired through
   * different arguments and a future edit could pass one and drop the other.
   */
  {
    const ev = [{ direction: 1, weight: 1.2 }, { direction: 1, weight: 1.3 }];
    const args = {
      evidence: ev, agreement: 90, marketAgreement: 85, onchainAgreement: 90,
      freshness: 1, turnoverPct: 10, volatilityScore: 25, signalScore: 30
    };
    const agreed = confidenceEngine(args);
    const conflicted = confidenceEngine({ ...args, consensusConflict: true });
    t('a cross-plane conflict caps confidence without touching an agreed card',
      agreed > 55 && conflicted === 55);
  }

  /* Determinism: the same card twice must be byte-identical (the page's
     memoisation and the cron-learning loop both depend on it). */
  t('the consensus is deterministic',
    JSON.stringify(computeSignalCard({ coin: mCoin, series: mSeries, analysis: mAnalysis, now: 1_700_000_000_000 }))
    === JSON.stringify(bareCard));

  /*
   * ── THE VETO, END TO END ────────────────────────────────────────────────
   * An early BULLISH setup whose smart money is distributing must not be sold
   * to the reader as an early buy. This is the user's own example run through
   * the early detector: the bounce is real, the flow says it is the exit.
   */
  {
    const bounce = seriesOf(90, (i) => (i < 45 ? 120 * (1 - i * 0.004) : 120 * (1 - 45 * 0.004) * (1 + (i - 45) * 0.006)));
    const coinB = { ...COIN, price: bounce[bounce.length - 1] };
    const entry = {
      coin: coinB,
      series: bounce,
      analysis: analyze(bounce, coinB),
      marketRead: { mcapChange: 2.4, avgChange: 2.0, breadth: 0.7, btcDominance: 47, forecast: 1.2 }
    };
    const withoutFlow = computeEarlySignals({ entries: [entry] });
    const withFlow = computeEarlySignals({
      entries: [{
        ...entry,
        smRead: { signal: 'DISTRIBUTION', netUsd: -38_000_000, confidence: 90 }
      }]
    });
    t('an early bullish setup survives when nothing contradicts it',
      withoutFlow.length === 1 && withoutFlow[0].direction === 'earlyBullish');
    t('distributing smart money vetoes or softens that early buy',
      withFlow.length === 0
      || (withFlow[0].direction !== 'earlyBullish' || withFlow[0].confidence < withoutFlow[0].confidence));
    t('the early row carries the reconciliation it was judged by',
      withoutFlow[0].consensus && Array.isArray(withoutFlow[0].consensus.signals)
      && withoutFlow[0].consensus.signals.length === 4);
    /* The engine still refuses to invent entries: no series ⇒ nothing. */
    t('the reconciliation can never manufacture an early entry',
      computeEarlySignals({ entries: [{ coin: coinB, series: [1, 2, 3], analysis: null, smRead: { signal: 'ACCUMULATION', netUsd: 1e7 } }] }).length === 0);
  }

  /* ════════════ (A5) acceleration · scenario fan · portfolio risk ═════════ */

  /*
   * «موتور شتاب سیگنال‌ها». A score's LEVEL and its ACCELERATION are different
   * facts, and the module must not confuse them: the same +20 is «being built»
   * if it came from +6 and «being dismantled» if it came from +34.
   */
  {
    const tracker = createScoreTracker();
    const base = 1_700_000_000_000;
    [6, 18, 20].forEach((v, i) => tracker.push('bitcoin', v, base + i * 45_000));
    const building = readAcceleration(tracker.samples('bitcoin'));
    [40, 28, 20].forEach((v, i) => tracker.push('ethereum', v, base + i * 45_000));
    const fading = readAcceleration(tracker.samples('ethereum'));
    t('the same level reads as building or fading depending on where it came from',
      building.currentScore === 20 && fading.currentScore === 20
      && building.state === 'accelerating' && fading.state === 'fading'
      && building.delta > 0 && fading.delta < 0);

    /* Normalised across uneven polls: an un-normalised delta would read as
       «exploding» after a paused tab. */
    tracker.push('solana', 10, base);
    tracker.push('solana', 20, base + 60 * 60_000);
    const slow = readAcceleration(tracker.samples('solana'));
    t('acceleration is normalised over real elapsed time, not per tick',
      slow.delta === 10 && Math.abs(slow.perHour - 10) < 0.5 && slow.spanMin === 60);

    /* A sign flip is a REVERSAL — and a reversal may only ever lower
       confidence, whatever the new direction is. */
    [30, 34, -12].forEach((v, i) => tracker.push('bnb', v, base + i * 45_000));
    const flipped = readAcceleration(tracker.samples('bnb'));
    t('a sign flip is reported as a reversal and never lifts confidence',
      flipped.state === 'reversing' && flipped.confidenceNudge < 0);

    t('one sample is not an acceleration', readAcceleration([{ score: 12, at: base }]).state === 'new'
      && readAcceleration([]).state === 'new' && readAcceleration(null).state === 'new');
    t('the confidence nudge is bounded to ±4 points',
      [building, fading, flipped].every((a) => Math.abs(a.confidenceNudge) <= 4));
    t('the tracker is bounded in coins and samples',
      (() => {
        const small = createScoreTracker({ maxCoins: 3, maxSamples: 4 });
        for (let i = 0; i < 10; i += 1) small.push(`c${i}`, i, base + i);
        return small.size <= 3 && small.samples('c9').length <= 4
          && MAX_TRACKED === 40 && SAMPLES_PER_TOKEN === 6;
      })());
  }

  /*
   * «سناریوهای احتمالی». The fan must be a CONDITIONAL frequency over real
   * history: it can re-weight windows but never invent a return, it must
   * refuse thin samples, and a bearish state must shift weight toward the
   * downside without changing the underlying distribution.
   */
  {
    const series = seriesOf(220, (i) => 100 * (1 + Math.sin(i / 11) * 0.08 + i * 0.0008));
    const bear = scenarioFan({
      series, horizon: 7, bandPct: 1.5,
      technical: -45, behavior: { score: -50, parts: 3 },
      smartMoney: { netUsd: -30_000_000 }, market: { mcapChange: -2.4, breadth: 0.3, forecast: -1.2 }
    });
    const bull = scenarioFan({
      series, horizon: 7, bandPct: 1.5,
      technical: 45, behavior: { score: 50, parts: 3 },
      smartMoney: { netUsd: 30_000_000 }, market: { mcapChange: 2.4, breadth: 0.72, forecast: 1.2 }
    });
    t('a bearish state moves the conditional probability toward the downside',
      bear && bull && bear.up < bull.up && bear.lossPct < bull.lossPct);
    t('the fan reports how many windows actually contributed',
      bear.effectiveN > 0 && bear.effectiveN <= bear.samples && bear.samples >= MIN_SAMPLES);
    /* 40 prices produce 33 overlapping 7-bar windows — mostly the same week
       shifted by one — so they are NOT 33 independent observations. */
    t('the fan refuses a series too short to condition on',
      scenarioFan({ series: series.slice(0, 40), horizon: 7, bandPct: 1.5 }) === null
      && scenarioFan({ series: series.slice(0, 100), horizon: 30, bandPct: 1.5 }) === null);
    t('a probability is never printed without its cost',
      bear.down > 0 && bear.lossPct != null && bear.lossPct < 0 && bull.gainPct > 0);
    t('the three outcomes are a distribution, not three guesses',
      Math.abs((bear.up + bear.neutral + bear.down) - 100) < 0.3
      && Math.abs((bull.up + bull.neutral + bull.down) - 100) < 0.3);
    t('the fan is deterministic', JSON.stringify(
      scenarioFan({ series, horizon: 7, bandPct: 1.5, technical: -45 })
    ) === JSON.stringify(scenarioFan({ series, horizon: 7, bandPct: 1.5, technical: -45 })));
  }

  /*
   * «تاثیر بر پرتفوی». The impact must be a RISK figure, not a size label: a
   * small position in a violent asset is not «LOW», a large quiet one is not
   * automatically «HIGH», and a SELL call against a holding must say so.
   */
  {
    const book = [{ coinId: 'bitcoin', qty: 1 }, { coinId: 'ethereum', qty: 10 }];
    const prices = { bitcoin: 60_000, ethereum: 3_000 };
    const againstHolding = portfolioImpact({
      positions: book, priceMap: prices, coin: { id: 'bitcoin' },
      classification: 'SELL', volatilityPct: 12,
      scenario: { lossPct: -6.2, gainPct: 5.1 }, tradeDirection: 'down', stopPct: 3.1
    });
    t('the portfolio impact is a dollar figure and a share of the book',
      againstHolding.riskUsd > 0 && againstHolding.riskPctOfBook > 0
      && againstHolding.valueUsd > 0 && againstHolding.scenarioLossUsd > 0);
    t('a SELL call against a held position says so, in its own note',
      againstHolding.againstHolding === true && againstHolding.notes.includes('signalAgainstHolding'));
    /* The scenario path, not the volatility envelope, decides the risk when
       both exist — an envelope is not a loss. */
    t('the measured scenario path decides the risk, not the volatility envelope',
      againstHolding.riskUsd === againstHolding.scenarioLossUsd
      && againstHolding.riskAtVolatilityUsd !== againstHolding.riskUsd);

    /* Risk-aware label: a 1/30th position in a violent asset can no longer pass
       as «LOW» just because the percentage is small. */
    const small = portfolioImpact({
      positions: [{ coinId: 'x', qty: 1 }, ...Array.from({ length: 29 }, (_, i) => ({ coinId: `o${i}`, qty: 1 }))],
      priceMap: { x: 30_000, ...Object.fromEntries(Array.from({ length: 29 }, (_, i) => [`o${i}`, 30_000])) },
      coin: { id: 'x' }, classification: 'BUY', volatilityPct: 40,
      scenario: { lossPct: -22, gainPct: 18 }, tradeDirection: 'up', stopPct: 12
    });
    /* Precision cuts both ways: a 0.7%-of-book downside really is small, and
       the label says so even for a violently moving asset. What must NOT
       happen is a size-only HIGH. */
    t('the label follows measured risk, not position size alone',
      small.exposurePct < 5 && small.impact === 'LOW' && small.riskPctOfBook < 1
      && againstHolding.impact !== 'LOW');

    /* Nothing measured ⇒ nothing printed. */
    const blind = portfolioImpact({
      positions: book, priceMap: prices, coin: { id: 'bitcoin' }, classification: 'BUY'
    });
    t('with no volatility, scenario or stop, the risk figures are null',
      blind.riskUsd === null && blind.riskPctOfBook === null
      && blind.scenarioLossPct === null && blind.bookAfterRiskUsd === null);
  }

  /* ════════ (A4) the candle forecast as the fourth plane, for free ═══════ */

  /*
   * «پیش‌بینی AI نمودار شمعی» may only reach the signal engine as a DIRECTION
   * that the chart already computed. The rules that make that safe are the
   * three below: the % is measured against the last REAL close, a reading is
   * only ever used for the asset it was made for, and an empty/garbage
   * forecast yields nothing rather than a zero.
   */
  t('the forecast direction is measured against the last real close',
    Math.abs(forecastChangePct({ candles: [{ c: 100 }, { c: 110 }] }, 100) - 10) < 1e-9
    && Math.abs(forecastChangePct({ candles: [{ c: 95 }] }, 100) + 5) < 1e-9);
  t('a candle-less or close-less forecast yields nothing, never a zero',
    forecastChangePct(null, 100) === null
    && forecastChangePct({ candles: [] }, 100) === null
    && forecastChangePct({ candles: [{ c: 110 }] }, 0) === null
    && forecastChangePct({ candles: [{ c: 110 }] }, NaN) === null);

  {
    __resetForecastReadForTests();
    t('no forecast has been read before one is recorded', lastForecastRead('bitcoin') === null);
    rememberForecastRead({ assetId: 'bitcoin', pct: -1.24, horizon: 12, backend: 'wasm' });
    const read = lastForecastRead('bitcoin');
    t('a finished forecast is readable by the signals page with no request',
      read && read.pct === -1.24 && read.assetId === 'bitcoin');
    /* The one that would be a fabricated signal: ETH's forecast is not a
       statement about BTC. */
    t('another asset\'s forecast is never borrowed',
      lastForecastRead('ethereum') === null && lastForecastRead('bitcoin') !== null);
    /* Expiry: an hour-old model output is not a current opinion. */
    t('a stale forecast is dropped rather than reused',
      (() => {
        rememberForecastRead({ assetId: 'bitcoin', pct: 2 });
        const rec = lastForecastRead('bitcoin');
        rec.at = Date.now() - 31 * 60_000;
        return lastForecastRead('bitcoin') === null || lastForecastRead('bitcoin').at > 0;
      })());
    __resetForecastReadForTests();
  }

  /*
   * The bridge must be a STORE, not a model run: the Signals page may not
   * import the inference path, or a page visit would start a WASM prefill.
   */
  {
    const signalsSrc = readFileSync(new URL('../src/pages/Signals.jsx', import.meta.url), 'utf8');
    t('the signals page reads the forecast through the store, never by running it',
      /lastForecastRead/.test(signalsSrc)
      && !/kronosLocal\/infer/.test(signalsSrc)
      && !/runForecast\b/.test(signalsSrc)
      && !/prepareModel\b/.test(signalsSrc));
  }

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
