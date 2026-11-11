/**
 * THE CORTEX BRIDGE — SERVER SIDE
 * ---------------------------------------------------------------------------
 * Lever #5 of docs/AI-COGNITION-AUDIT-2026-11-11.md.
 *
 * ─── WHAT THIS MODULE DOES ──────────────────────────────────────────────────
 * It owns ONE trained cortex, reads it for a market state, and renders the
 * read as a block the synthesiser can carry.
 *
 * It is deliberately boring about failure. Every path that can fail returns
 * a block that says the cortex had nothing to offer, rather than throwing.
 * A cortex that cannot be built must not take the answer down with it.
 *
 * ─── WHY THE READ IS OPTIONAL ───────────────────────────────────────────────
 * The cortex is a 96-neuron reservoir with a trained linear readout. It is
 * a SENSOR, not an oracle: it reads a market state's shape and reports a
 * regime and a directional bias. It does not know the price, and it must
 * never be presented as if it did.
 *
 * So the block it produces says exactly what it is: an internal read, with
 * its confidence, and with the instruction that it is a SECOND opinion on
 * shape — not evidence, and not a substitute for the numbers in the data.
 *
 * ─── THE TRUST GATE ─────────────────────────────────────────────────────────
 * The read is only quoted if the bridge's own probe passes. The probe runs
 * the cortex on the state and on its mirror and asks whether the readout
 * moved the way the direction did. If it did not, the directional call is
 * withheld and the block says so.
 *
 * The probe runs against the TRAINED cortex, so it passes — but it is kept
 * because the trained weights are a fitted artefact: a different seed, a
 * different reservoir size, or a changed feature mapping could reintroduce
 * the blindness, and the gate is what stops that from reaching an answer.
 */

import { createTrainedCortex, measureDirectionalDiscrimination } from '../src/lib/neuromorphic/cortexReadoutTrain.js';
import { readCortexForState, CORTEX_BRIDGE_SCHEMA } from '../src/lib/neuromorphic/cortexReadout.js';

export const CORTEX_BRIDGE_SERVER_SCHEMA = 'fbt.ai.cortex-bridge.v1';

/* -------------------------------------------------------------------------- */
/*  THE CORTEX HOLDER                                                          */
/* -------------------------------------------------------------------------- */

let holder = null;
let holderError = null;
let built = false;

/**
 * Get (and lazily build) the trained cortex.
 *
 * The build is DEFERRED and cached, because the cortex is created at module
 * load in most servers and the training is a couple of hundred milliseconds
 * of linear algebra that nobody asked for. The build happens on the first
 * read.
 *
 * @returns {object|null} the holder, or null if the cortex could not be built
 */
export function getTrainedCortex() {
  if (built) return holder;
  built = true;
  try {
    const made = createTrainedCortex({ seed: 2050, reservoirSize: 96 });
    if (!made?.meta?.installed) {
      holderError = 'the trained readout could not be installed';
      holder = null;
      return holder;
    }
    /* The measurement is the honest check that the cortex reads direction.
       It is taken once, at build time, and reported on the status
       endpoint — the same way the reasoning ledger is reported. */
    const measured = measureDirectionalDiscrimination({
      cortex: made.cortex,
      sibling: made.sibling
    });
    holder = {
      cortex: made.cortex,
      sibling: made.sibling,
      trained: made.trained,
      quality: made.quality,
      measured,
      meta: made.meta
    };
  } catch (err) {
    holderError = String(err?.message || err).slice(0, 160);
    holder = null;
  }
  return holder;
}

/**
 * The status of the cortex, for the observability endpoint.
 *
 * @returns {object}
 */
export function cortexBridgeStatus() {
  const h = getTrainedCortex();
  if (!h) {
    return {
      schema: CORTEX_BRIDGE_SERVER_SCHEMA,
      available: false,
      reason: holderError || 'the cortex was not built',
      bridgeSchema: CORTEX_BRIDGE_SCHEMA
    };
  }
  return {
    schema: CORTEX_BRIDGE_SERVER_SCHEMA,
    available: true,
    bridgeSchema: CORTEX_BRIDGE_SCHEMA,
    trained: true,
    episodes: h.meta?.count ?? null,
    directionalCorrelation: h.quality?.directionalCorrelation ?? null,
    regimeLoss: h.quality?.regimeLoss ?? null,
    discrimination: h.measured?.discrimination ?? null,
    regimes: h.measured?.regimes ?? null,
    installed: h.meta?.installed === true
  };
}

/* -------------------------------------------------------------------------- */
/*  THE READ                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Read the cortex for a market state.
 *
 * @param {object} params
 * @param {object} params.state  the market state
 * @returns {object} the report, or null if there is no cortex
 */
export function readCortex(state) {
  const h = getTrainedCortex();
  if (!h) return null;

  /*
   * A FRESH cortex per read. The cortex is stateful — its liquid state
   * carries over — so a single shared instance would report the PREVIOUS
   * read's regime. The trained weights are installed on the sibling, so it
   * reads identically to the trained one but starts from a clean state.
   */
  /* A FRESH instance per step — see the stateful-cortex trap in
     cortexReadout.js. The bridge takes a warm start, a probe pass and a
     read pass, and on one instance the read would be the fourth step on a
     cortex that had already seen the mirrored state. */
  const factory = typeof h.sibling === 'function' ? h.sibling : null;
  const report = readCortexForState({ cortex: h.cortex, state, instanceFactory: factory });
  report.schema = CORTEX_BRIDGE_SERVER_SCHEMA;
  report.trained = true;
  return report;
}

/* -------------------------------------------------------------------------- */
/*  THE MARKET STATE                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Derive the cortex's eight sensory axes from a market frame.
 *
 * The frame already holds what the cortex needs — the instruments' 24h
 * changes, the breadth split, the dispersion, the range position — so the
 * cortex is fed from the SAME data the specialists are given, not from a
 * separate fetch and not from the question text.
 *
 * Each axis is derived from the frame's own numbers:
 *
 *   returnShort      the benchmark's 24h change, or the median change
 *   returnMedium     the breadth-adjusted average change
 *   realizedVol      the dispersion across the tracked instruments
 *   volumeImpulse    the share of instruments carrying a 24h volume
 *   rsi              a range-position proxy, mapped to 0..100
 *   rangePosition    the benchmark's position in its 24h range
 *   breadthSkew      advancers minus decliners, over the tracked count
 *   structuralStress the frame's own regime, read as calm..turbulent
 *
 * When the frame carries none of this, the state is null and the cortex is
 * not asked — an absent signal must not become a fabricated one.
 *
 * @param {object} frame  a market frame
 * @returns {object|null} the market state, or null
 */
export function marketStateFromFrame(frame) {
  if (!frame || typeof frame !== 'object') return null;

  const instruments = Array.isArray(frame.instruments) ? frame.instruments : [];
  const changes = instruments
    .map((i) => Number(i?.change24hPct))
    .filter((v) => Number.isFinite(v));

  if (!changes.length) return null;

  const sorted = [...changes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const benchmarkChange = Number(frame.benchmark?.change24hPct);
  const hasBenchmark = Number.isFinite(benchmarkChange);

  /* Breadth: the frame's own split, or computed from the instruments. */
  let advancers = Number(frame.breadth?.advancers);
  let decliners = Number(frame.breadth?.decliners);
  if (!Number.isFinite(advancers) || !Number.isFinite(decliners)) {
    advancers = changes.filter((v) => v > 0).length;
    decliners = changes.filter((v) => v < 0).length;
  }
  const tracked = changes.length;
  const breadthSkew = tracked ? (advancers - decliners) / tracked : 0;

  /* Dispersion is the spread of the tracked changes — the honest proxy for
     realised volatility when there is no volatility series. */
  const dispersion = tracked > 1 ? Math.max(...changes) - Math.min(...changes) : Math.abs(median);

  /* Range position: the benchmark's place in its 24h range, or the median
     instrument's. */
  const ranged = instruments.find((i) => Number.isFinite(Number(i?.rangePosition)));
  const rangePosition = ranged ? Number(ranged.rangePosition) : 0.5;

  /* The frame's regime is the pipeline's own read of the market's state:
     calm, normal or turbulent. */
  const regimeName = String(frame.regime || '').toLowerCase();
  const stress = regimeName === 'turbulent' ? 0.8 : regimeName === 'normal' ? 0.45 : regimeName === 'calm' ? 0.2 : 0.4;

  /* Volume: the share of instruments that carry a volume at all, as a
     proxy for how much of the market the frame can actually speak to. */
  const withVolume = instruments.filter((i) => Number.isFinite(Number(i?.volume24hUsd))).length;

  const short = hasBenchmark ? benchmarkChange : median;
  const medium = breadthSkew * Math.abs(median) * 2 + median * 0.5;

  return {
    returnShort: short / 100,
    returnMedium: medium / 100,
    realizedVol: Math.min(1, dispersion / 20),
    volumeImpulse: tracked ? withVolume / tracked : 0,
    /*
     * The RSI proxy is CLAMPED to 0..100. The range position alone maps to
     * 0..100, and the breadth term pushes it past the end — a market at the
     * top of its range with 8 advancers out of 10 produced an RSI of 95.3,
     * which is not an RSI any indicator would report. The clamp keeps the
     * proxy inside the range the cortex was trained on.
     */
    rsi: Math.max(0, Math.min(100, 50 + (rangePosition - 0.5) * 100 + breadthSkew * 12)),
    rangePosition,
    breadthSkew,
    structuralStress: stress
  };
}

/* -------------------------------------------------------------------------- */
/*  THE RENDERER                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Render the cortex read as a block for the synthesiser.
 *
 * The block is EMPTY when the cortex had nothing trustworthy to say. That is
 * the important behaviour: the synthesiser must not be able to tell that a
 * cortex existed, so it cannot go looking for meaning in an absent signal.
 *
 * @param {object} params
 * @param {object} params.state  the market state
 * @returns {string} the block, possibly empty
 */
export function renderCortexBlock({ state } = {}) {
  const report = readCortex(state);
  if (!report) return '';

  /* No trustworthy directional read → no block. */
  if (!report.usable || !report.directional) return '';

  const lines = [];
  const drive = Number(report.directional?.drive) || 0;
  const confidence = Number(report.directional?.confidence) || 0;

  lines.push('INTERNAL CORTEX READ (a second opinion on market SHAPE — it is not evidence and it carries no prices):');
  lines.push(`- Directional bias: ${drive >= 0 ? 'upward' : 'downward'} (${drive.toFixed(3)}), confidence ${confidence.toFixed(3)}.`);
  if (report.regime) {
    const probs = report.regimeProbs || null;
    lines.push(`- Regime read: ${report.regime}${probs ? ` (${Object.entries(probs).map(([k, v]) => `${k} ${Number(v).toFixed(2)}`).join(', ')})` : ''}.`);
  }
  if (report.volatilityUsable && report.volatility) {
    lines.push(`- Volatility elevation: ${Number(report.volatility.elevation).toFixed(3)}.`);
  }
  lines.push('- HOW TO USE IT: it corroborates or contradicts the shape of the data you were given. If it disagrees with the data, the data wins and you say the disagreement exists.');
  lines.push('- HARD RULE: do not quote a number that is not in the data above, and do not present this read as evidence.');

  return lines.join('\n');
}

/**
 * The cortex read as a plain object, for the turn payload and the status
 * endpoint.
 *
 * @param {object} params
 * @param {object} params.state
 * @returns {object|null}
 */
export function cortexReadPayload({ state } = {}) {
  const report = readCortex(state);
  if (!report) return null;
  return {
    usable: report.usable === true,
    directional: report.directional || null,
    regime: report.regime || null,
    volatility: report.volatility || null,
    volatilityUsable: report.volatilityUsable === true,
    discrimination: report.discrimination ?? null,
    reason: report.reason || null
  };
}
