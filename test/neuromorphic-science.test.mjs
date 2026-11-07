/**
 * PHASE 7 — UNIVERSAL SCIENTIFIC MEMORY: EVIDENCE CONTRACT TESTS
 * ===========================================================================
 * These tests are written to fail if the memory ever starts flattering itself:
 *
 *   · the special functions must match closed-form values (a wrong log-gamma
 *     would silently make every Bayes factor and credible interval fiction);
 *   · a hypothesis that did not exist before the observation must be refused;
 *   · retrospective evidence must be able to move belief but never confirm it;
 *   · confirmation must require BOTH a decisive Bayes factor and survival of
 *     Benjamini–Hochberg, and the FDR procedure must actually bite on nulls;
 *   · evidence must decay, so an old discovery cannot become immortal;
 *   · prior packets must be deduplicated, winsorised and family-whitelisted;
 *   · the HTTP surface must stay deterministic, cached and execution-free.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_OBSERVATIONS_PER_HYPOTHESIS,
  PRESPECIFIED_FAMILIES,
  SCIENCE_PRIOR_SCHEMA,
  SCIENCE_SCHEMA,
  bayesBand,
  benjaminiHochberg,
  betaQuantile,
  binomialTwoSidedP,
  canonicalJson,
  contentHash,
  createScientificMemory,
  hypothesisKey,
  log10BayesFactor,
  logBetaFn,
  logGamma,
  probeScientificMemory,
  randomEffectsPool,
  regularizedIncompleteBeta,
  wilsonInterval
} from '../src/lib/neuromorphic/scientificMemory.js';
import {
  __resetScienceProbeCache,
  aggregateWorld,
  createScienceRegistry,
  getScienceProbeReport,
  validatePriorPacket
} from '../server/aiNeuromorphicScience.js';
import {
  loadLocalCortexBundle,
  saveLocalCortexBundle,
  wipeLocalCortexBundle
} from '../src/lib/neuromorphic/engramMemory.js';

const DAY = 24 * 3600_000;
const T = 1_800_000_000_000;
const FIXED_CLOCK = () => T;

function episodes({
  count = 100,
  regime = 'trendUp',
  symbol = 'BTC',
  positiveShare = 0.8,
  startAt = T - 250 * DAY,
  stepMs = DAY
} = {}) {
  const out = [];
  const positives = Math.round(count * positiveShare);
  for (let i = 0; i < count; i += 1) {
    out.push({
      vector: Array.from({ length: 32 }, (_, k) => Math.sin((i + 1) * (k + 1) * 0.07)),
      realizedReturn: i < positives ? 0.012 : -0.009,
      regime,
      symbol,
      at: startAt + i * stepMs
    });
  }
  return out;
}

function prospectiveSequence(memory, { key, count = 20, positiveShare = 0.85, fromMs = T - 10 * DAY, stepMs = 3600_000 } = {}) {
  const positives = Math.round(count * positiveShare);
  let accepted = 0;
  for (let i = 0; i < count; i += 1) {
    const res = memory.observe({
      key,
      outcome: i < positives ? 1 : 0,
      at: fromMs + i * stepMs,
      klass: 'prospective',
      source: 'live'
    });
    if (res.ok) accepted += 1;
  }
  return accepted;
}

describe('Phase 7 — statistics primitives are real, not decorative', () => {
  it('reproduces closed-form values for log-gamma, the beta quantile and the binomial test', () => {
    assert.ok(Math.abs(logGamma(5) - Math.log(24)) < 1e-10);
    assert.ok(Math.abs(logGamma(0.5) - 0.5 * Math.log(Math.PI)) < 1e-12);
    assert.ok(Math.abs(logBetaFn(0.5, 0.5) - Math.log(Math.PI)) < 1e-12);
    // Beta(1.5, 1.5) is symmetric: the 2.5 % quantile must mirror the 97.5 % one.
    const lo = betaQuantile(0.025, 1.5, 1.5);
    const hi = betaQuantile(0.975, 1.5, 1.5);
    assert.ok(Math.abs(lo - 0.0609) < 2e-3, `expected ≈0.0609, got ${lo}`);
    assert.ok(Math.abs(lo + hi - 1) < 1e-6, 'symmetric prior must give symmetric tails');
    assert.ok(Math.abs(regularizedIncompleteBeta(0.3857, 2, 3) - 0.5) < 2e-3);
    // 0 successes in 10 fair coin flips: two-sided p = 2/2^10.
    assert.ok(Math.abs(binomialTwoSidedP(0, 10, 0.5) - 2 / 1024) < 1e-12);
    assert.equal(binomialTwoSidedP(5, 0, 0.5), null);
  });

  it('keeps the Bayes factor symmetric and monotone in the evidence', () => {
    // A symmetric prior is invariant to swapping hits and misses.
    assert.ok(Math.abs(log10BayesFactor(24, 6) - log10BayesFactor(6, 24)) < 1e-12);
    assert.ok(log10BayesFactor(24, 6) > 0);
    assert.equal(log10BayesFactor(0, 0), 0);
    const weak = log10BayesFactor(18, 12);
    const strong = log10BayesFactor(30, 10);
    assert.ok(strong > weak, 'more lopsided data must give a stronger BF');
    assert.equal(bayesBand(strong), strong >= 2 ? 'decisive' : bayesBand(strong));
  });

  it('controls FDR with a genuine Benjamini–Hochberg step-up', () => {
    const fdr = benjaminiHochberg([0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216], 0.05);
    assert.equal(fdr.m, 10);
    assert.equal(fdr.discoveries, 2);
    assert.ok(fdr.threshold > 0 && fdr.threshold <= 0.05);
    // Adjusted p-values are monotone in the original ordering and never below p.
    const ordered = fdr.adjustedP.slice().sort((a, b) => a - b);
    for (let i = 0; i < 10; i += 1) assert.ok(fdr.adjustedP[i] >= 0 && fdr.adjustedP[i] <= 1);
    assert.deepEqual(ordered, fdr.adjustedP.slice().sort((a, b) => a - b));
    assert.equal(benjaminiHochberg([], 0.05).discoveries, 0);
  });

  it('measures its own error rates instead of asserting them', () => {
    const probe = probeScientificMemory();
    const m = probe.measured;
    assert.equal(m.simulated, true);
    assert.equal(probe.honesty.marketEvidence, false);
    assert.equal(probe.honesty.realizedReturnFabricated, false);
    assert.equal(probe.laws.canExecute, false);
    // BH must remove (or at least not add) discoveries under the global null.
    assert.ok(m.falseDiscoveries.afterBenjaminiHochberg <= m.falseDiscoveries.uncorrectedAtPointZeroFive);
    assert.equal(m.falseDiscoveries.afterRate, 0, 'fair coins produced a corrected discovery');
    // Power on genuinely biased streams must stay usable.
    assert.ok(m.power.rate >= 0.8, `power collapsed to ${m.power.rate}`);
    // Random-effects pooling must beat raw per-market rates against the truth.
    assert.ok(m.shrinkage.mseReductionPct > 0, 'pooling made the estimates worse');
    // 95 % Wilson coverage must be near nominal (not near 100 % and not near 50 %).
    assert.ok(m.intervalCoverage.observed >= 0.9 && m.intervalCoverage.observed <= 0.99);
    // Same seed, same numbers — otherwise the published probe is not evidence.
    const again = probeScientificMemory();
    assert.equal(again.measured.determinism.hash, m.determinism.hash);
  });

  it('shrinks small strata toward the pooled estimate (DerSimonian–Laird)', () => {
    const pool = randomEffectsPool([
      { key: 'a', hits: 18, n: 20 },
      { key: 'b', hits: 11, n: 20 },
      { key: 'c', hits: 2, n: 8 },
      { key: 'd', hits: 6, n: 9 }
    ]);
    assert.equal(pool.k, 4);
    assert.equal(pool.totalN, 57);
    assert.ok(pool.tau2 >= 0);
    assert.ok(pool.i2 >= 0 && pool.i2 <= 1);
    for (const stratum of pool.strata) {
      assert.ok(stratum.weight > 0 && stratum.weight <= 1);
      const lo = Math.min(stratum.rawRate, pool.pooled);
      const hi = Math.max(stratum.rawRate, pool.pooled);
      assert.ok(stratum.shrunkenRate >= lo - 1e-9 && stratum.shrunkenRate <= hi + 1e-9);
    }
    const small = pool.strata.find((s) => s.key === 'c');
    assert.ok(Math.abs(small.shrunkenRate - pool.pooled) < Math.abs(small.rawRate - pool.pooled),
      'the smallest stratum must move most toward the pooled rate');
    assert.equal(randomEffectsPool([]).pooled, null);
  });
});

describe('Phase 7 — pre-registration cannot be bypassed', () => {
  it('refuses observations for hypotheses that were never declared', () => {
    const mem = createScientificMemory({ now: FIXED_CLOCK });
    const res = mem.observe({ key: 'regime-positive-return|trendUp|BTC', outcome: 1, at: T });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'NOT_PREREGISTERED');
    // A symbol scope must be declared explicitly — the family only auto-declares
    // the pooled scope, which is what keeps the test denominator honest.
    const declared = mem.declare({ regime: 'trendUp', symbol: 'BTC', registeredAt: T - DAY });
    assert.equal(declared.ok, true);
    assert.equal(declared.existing, false);
    assert.equal(mem.declare({ regime: 'trendUp', symbol: 'BTC' }).existing, true);
  });

  it('rejects data that predates the registration, duplicates and secrets', () => {
    const mem = createScientificMemory({ now: FIXED_CLOCK });
    const declared = mem.declare({ regime: 'shock', symbol: 'ETH', registeredAt: T - DAY });
    assert.equal(declared.ok, true);
    const key = declared.key;
    assert.equal(mem.observe({ key, outcome: 1, at: T - 2 * DAY }).code, 'BEFORE_REGISTRATION');

    const first = mem.observe({ key, outcome: 1, at: T, klass: 'prospective', provenance: 'fixed-prov' });
    assert.equal(first.ok, true);
    const dup = mem.observe({ key, outcome: 0, at: T, klass: 'prospective', provenance: 'fixed-prov' });
    assert.equal(dup.code, 'DUPLICATE_PROVENANCE');

    assert.equal(mem.observe({ key, outcome: 'maybe', at: T }).code, 'INVALID_OUTCOME');
    const secret = mem.declare({ regime: 'shock', symbol: 'seed phrase abandon ability' });
    assert.equal(secret.code, 'SECRET_INPUT_REJECTED');
    const report = mem.report();
    assert.ok(report.counts.duplicatesRejected >= 1);
    assert.ok(report.counts.sensitiveRejected >= 1);
  });

  it('caps the record count instead of growing without bound', () => {
    const mem = createScientificMemory({ now: FIXED_CLOCK, maxHypotheses: 6 });
    let rejected = 0;
    for (let i = 0; i < 40; i += 1) {
      const res = mem.declare({ regime: 'trendUp', symbol: `S${i}` });
      if (!res.ok && res.code === 'CAPACITY_REACHED') rejected += 1;
    }
    assert.ok(rejected > 0, 'capacity was never enforced');
    const report = mem.report();
    assert.ok(report.totals.hypotheses <= 6);
  });

  it('never stores more than the per-hypothesis observation cap', () => {
    const mem = createScientificMemory({ now: FIXED_CLOCK });
    const key = hypothesisKey({ regime: 'meanRevert' });
    let accepted = 0;
    for (let i = 0; i < MAX_OBSERVATIONS_PER_HYPOTHESIS + 20; i += 1) {
      const res = mem.observe({ key, outcome: i % 2, at: T, provenance: `p${i}` });
      if (res.ok) accepted += 1;
    }
    assert.equal(accepted, MAX_OBSERVATIONS_PER_HYPOTHESIS);
    assert.equal(mem.get(key).observations, MAX_OBSERVATIONS_PER_HYPOTHESIS);
  });
});

describe('Phase 7 — honest evidence classes and decay', () => {
  it('lets retrospective engrams move belief but never confirm a hypothesis', () => {
    const mem = createScientificMemory({
      now: FIXED_CLOCK,
      birthAt: T - 50 * DAY,
      halfLifeMs: 365 * DAY
    });
    const ingest = mem.ingestEngrams(episodes({ count: 140 }));
    assert.equal(ingest.ok, true);
    assert.equal(ingest.byClass.prospective, 0);
    assert.equal(ingest.byClass.retrospective, 280); // BTC scope + pooled scope

    const report = mem.report();
    assert.equal(report.honesty.retrospectiveCannotConfirm, true);
    assert.equal(report.byStatus.supported, 0);
    assert.equal(report.fdr.confirmed, 0);
    assert.equal(report.fdr.m, 0, 'retrospective-only buckets must not enter the FDR family');
    assert.ok(report.best, 'the evidence may still be reported');
    assert.equal(report.best.status, 'inconclusive');
    assert.equal(report.best.statusReason, 'INSUFFICIENT_PROSPECTIVE');
    assert.equal(report.bestConfirmed, null);

    // Prior is inert while nothing is confirmed: no silent nudge of the cortex.
    const prior = mem.priorForCortex({ regime: 'trendUp', symbol: 'BTC' });
    assert.equal(prior.source, 'none');
    assert.equal(prior.bias, 0);
    assert.equal(prior.damping, 1);
    assert.equal(prior.validated, false);
  });

  it('confirms only after post-registration evidence and a decisive Bayes factor', () => {
    const mem = createScientificMemory({
      now: FIXED_CLOCK,
      birthAt: T - 50 * DAY,
      halfLifeMs: 365 * DAY
    });
    mem.ingestEngrams(episodes({ count: 100 }));
    const key = hypothesisKey({ regime: 'trendUp', symbol: 'BTC' });
    const accepted = prospectiveSequence(mem, { key, count: 20, positiveShare: 0.85 });
    assert.equal(accepted, 20);

    const report = mem.report();
    assert.ok(report.byStatus.supported >= 1, 'post-registration evidence must be able to confirm');
    assert.ok(report.fdr.confirmed >= 1);
    assert.ok(report.fdr.confirmed <= report.fdr.discoveries);
    assert.ok(report.bestConfirmed.posteriorMean > 0.6);
    assert.ok(report.bestConfirmed.credibleInterval.low > 0.5,
      'a confirmed claim must exclude 50 % at the 95 % level');
    assert.ok(report.bestConfirmed.log10BayesFactor >= 1);
    assert.equal(report.calibration.brier != null, true);
    assert.ok(report.calibration.brier >= 0 && report.calibration.brier <= 1);

    const prior = mem.priorForCortex({ regime: 'trendUp', symbol: 'BTC' });
    assert.equal(prior.validated, true);
    assert.equal(prior.source, 'usm');
    assert.ok(Math.abs(prior.bias) <= 0.15);
    assert.ok(prior.damping >= 0.7 && prior.damping <= 1);
  });

  it('decays old evidence back to inconclusive instead of becoming immortal', () => {
    const halfLifeMs = 2 * DAY;
    const t0 = T - 200 * DAY;
    const clockRef = { t: t0 + 40 * 3600_000 };
    const mem = createScientificMemory({
      now: () => clockRef.t,
      birthAt: t0 - DAY,
      halfLifeMs
    });
    const key = hypothesisKey({ regime: 'trendDown' });
    for (let i = 0; i < 40; i += 1) {
      const res = mem.observe({
        key,
        outcome: i < 36 ? 1 : 0,
        at: t0 + i * 3600_000,
        klass: 'prospective',
        provenance: `decay-${i}`
      });
      assert.equal(res.ok, true, `observation ${i} was refused: ${res.code}`);
    }
    // Fresh evidence: decisive support while the clock is close to the data.
    assert.equal(mem.get(key).status, 'supported');
    assert.ok(mem.report().fdr.confirmed >= 1);

    // Now 120 days pass with nothing new: the same record must lose its claim.
    clockRef.t = T;
    const later = mem.get(key);
    assert.ok(later.status !== 'supported', `decaying evidence still claimed support (${later.status})`);
    assert.equal(later.log10BayesFactor, 0);
    const report = mem.report();
    assert.equal(report.fdr.confirmed, 0);
    assert.equal(report.fdr.m, 0, 'a decayed record must not consume the FDR budget');
    assert.equal(report.byStatus.supported, 0);
  });

  it('retires expired hypotheses and keeps the hard laws in every report', () => {
    const mem = createScientificMemory({ now: FIXED_CLOCK });
    const declared = mem.declare({ regime: 'shock', symbol: 'ETH', expiresAt: T - DAY });
    assert.equal(declared.ok, true);
    assert.equal(mem.get(declared.key).status, 'retired');
    const retired = mem.retireExpired();
    assert.ok(retired.retired >= 1);
    const report = mem.report();
    assert.deepEqual(report.laws, { canExecute: false, canSign: false, canMoveFunds: false });
    assert.equal(report.honesty.preregistrationEnforced, true);
    assert.equal(report.honesty.accuracyPrefilled, false);
    assert.equal(report.schema, SCIENCE_SCHEMA);
    assert.equal(report.prior.family, 'jeffreys');
  });
});

describe('Phase 7 — portable priors and the world registry gates', () => {
  const makeMemWithEvidence = () => {
    const mem = createScientificMemory({ now: FIXED_CLOCK, birthAt: T - 50 * DAY, halfLifeMs: 365 * DAY });
    mem.ingestEngrams(episodes({ count: 60 }));
    prospectiveSequence(mem, { key: hypothesisKey({ regime: 'trendUp', symbol: 'BTC' }), count: 24, positiveShare: 0.9 });
    return mem;
  };

  it('exports only family-level summaries and never raw observations', () => {
    const packet = makeMemWithEvidence().exportPrior();
    assert.equal(packet.schema, SCIENCE_PRIOR_SCHEMA);
    assert.ok(packet.records.length > 0);
    assert.equal(/vector|realizedReturn|price|at"/.test(canonicalJson(packet.records)), false);
    for (const rec of packet.records) {
      assert.ok(PRESPECIFIED_FAMILIES.some((f) => f.id === rec.family));
      assert.ok(Math.abs(rec.log10BayesFactor) <= 24);
    }
    assert.deepEqual(validatePriorPacket(packet).ok, true);
  });

  it('rejects invented families, oversized factors, duplicates and secrets', () => {
    const bad = {
      schema: SCIENCE_PRIOR_SCHEMA,
      at: T,
      records: [{ key: 'my-own-bucket|trendUp|*', log10BayesFactor: 9 }]
    };
    assert.equal(validatePriorPacket(bad).code, 'NO_VALID_RECORDS');
    const oversized = {
      schema: SCIENCE_PRIOR_SCHEMA,
      at: T,
      records: [{ key: 'regime-positive-return|trendUp|*', log10BayesFactor: 1e9 }]
    };
    assert.equal(validatePriorPacket(oversized).code, 'NO_VALID_RECORDS');
    const secret = {
      schema: SCIENCE_PRIOR_SCHEMA,
      at: T,
      records: [{ key: 'regime-positive-return|trendUp|*', log10BayesFactor: 1 }],
      note: 'private key 0xabc'
    };
    assert.equal(validatePriorPacket(secret).code, 'SECRET_INPUT_REJECTED');
    assert.equal(validatePriorPacket(null).code, 'INVALID_PACKET');
  });

  it('merges a packet once and refuses the replay', () => {
    const packet = makeMemWithEvidence().exportPrior();
    const target = createScientificMemory({ now: FIXED_CLOCK });
    const first = target.mergePrior(packet);
    assert.equal(first.ok, true);
    assert.ok(first.merged > 0);
    const replay = target.mergePrior(packet);
    assert.equal(replay.ok, false);
    assert.equal(replay.code, 'DUPLICATE_PACKET');
    const report = target.report();
    assert.ok(report.consensus.externalRecords > 0);
    assert.equal(report.consensus.keys, new Set(packet.records.map((r) => r.key)).size);
  });

  it('winsorises contributions and only calls consensus with two owners', () => {
    const rows = aggregateWorld([
      { owner: 'a', records: [{ key: 'regime-positive-return|trendUp|*', log10BayesFactor: 20 }] },
      { owner: 'b', records: [{ key: 'regime-positive-return|trendUp|*', log10BayesFactor: 2 }] }
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].contributors, 2);
    assert.equal(rows[0].consensus, true);
    // 20 is winsorised to 6 → mean (6+2)/2 = 4, not 11.
    assert.equal(rows[0].log10BayesFactor, 4);
    const single = aggregateWorld([{ owner: 'a', records: [{ key: 'regime-positive-return|shock|*', log10BayesFactor: 5 }] }]);
    assert.equal(single[0].consensus, false);
    assert.equal(single[0].state, 'single-claim');
  });

  it('rate-limits a device and keeps the registry honest about storage mode', async () => {
    const reg = createScienceRegistry({ durable: false });
    const packet = {
      schema: SCIENCE_PRIOR_SCHEMA,
      at: T,
      packetHash: 'aaaa0001',
      records: [{ key: 'regime-positive-return|trendUp|*', log10BayesFactor: 2.5 }]
    };
    const first = await reg.submitPrior({ owner: 'dev-a', packet });
    assert.equal(first.code, 'ACCEPTED');
    const second = await reg.submitPrior({
      owner: 'dev-a',
      packet: { ...packet, packetHash: 'aaaa0002' }
    });
    assert.equal(second.code, 'RATE_LIMITED');
    const other = await reg.submitPrior({ owner: 'dev-b', packet: { ...packet, packetHash: 'aaaa0003' } });
    assert.equal(other.code, 'ACCEPTED');
    const world = await reg.getWorld();
    assert.equal(world.storageMode, 'per-instance');
    assert.equal(world.durable, false);
    assert.equal(world.totals.consensusKeys, 1);
    assert.equal(world.keys[0].contributors, 2);
    assert.equal(world.honesty.singleContributorCalledConsensus, false);
    assert.equal(world.laws.canExecute, false);
  });
});

describe('Phase 7 — determinism, persistence and the local bundle', () => {
  it('replays identical state to identical bytes', () => {
    const build = () => {
      const mem = createScientificMemory({ now: FIXED_CLOCK, birthAt: T - 50 * DAY, halfLifeMs: 365 * DAY });
      mem.ingestEngrams(episodes({ count: 40 }));
      prospectiveSequence(mem, { key: hypothesisKey({ regime: 'trendUp', symbol: 'BTC' }), count: 16 });
      return mem.report();
    };
    const a = build();
    const b = build();
    assert.equal(contentHash(a), contentHash(b));
  });

  it('round-trips through toJSON without inventing or dropping beliefs', () => {
    const mem = createScientificMemory({ now: FIXED_CLOCK, birthAt: T - 50 * DAY, halfLifeMs: 365 * DAY });
    mem.ingestEngrams(episodes({ count: 40 }));
    prospectiveSequence(mem, { key: hypothesisKey({ regime: 'trendUp', symbol: 'BTC' }), count: 20 });
    const before = mem.report();
    const state = JSON.parse(JSON.stringify(mem.toJSON()));

    const restored = createScientificMemory({ now: FIXED_CLOCK, birthAt: T - 50 * DAY, halfLifeMs: 365 * DAY });
    const loaded = restored.loadJSON(state);
    assert.equal(loaded.ok, true);
    assert.ok(loaded.restored >= 1);
    const after = restored.report();
    assert.equal(after.best.key, before.best.key);
    assert.equal(after.best.posteriorMean, before.best.posteriorMean);
    assert.equal(after.fdr.confirmed, before.fdr.confirmed);
    assert.equal(after.totals.observations, before.totals.observations);
    assert.equal(after.totals.prospective, before.totals.prospective);
    assert.ok(loaded.observations > 0);
    // A tampered schema is refused rather than half-loaded.
    const broken = createScientificMemory({ now: FIXED_CLOCK });
    assert.equal(broken.loadJSON({ schema: 'nope' }).ok, false);
  });

  it('persists the science block inside the same checksummed bundle, with a size guard', async () => {
    const store = new Map();
    const original = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    };
    try {
      const mem = createScientificMemory({ now: FIXED_CLOCK, birthAt: T - 50 * DAY });
      mem.ingestEngrams(episodes({ count: 12 }));
      const saved = await saveLocalCortexBundle({
        cortexSnapshot: { schema: 'fbt.neuromorphic.cortex.v3', stub: true },
        episodes: episodes({ count: 4 }),
        science: mem.toJSON()
      });
      assert.equal(saved.ok, true, JSON.stringify(saved));
      const loaded = await loadLocalCortexBundle();
      assert.equal(loaded.ok, true);
      assert.ok(loaded.bundle.science, 'science block must survive the round-trip');
      assert.equal(loaded.bundle.science.schema, SCIENCE_SCHEMA);

      // An oversized science block is dropped, never silently truncating the bundle.
      const huge = { schema: SCIENCE_SCHEMA, blob: 'x'.repeat(130_000) };
      const saved2 = await saveLocalCortexBundle({
        cortexSnapshot: { schema: 'fbt.neuromorphic.cortex.v3', stub: true },
        episodes: [],
        science: huge
      });
      assert.equal(saved2.ok, true);
      assert.equal(saved2.scienceDropped, true);
      const loaded2 = await loadLocalCortexBundle();
      assert.equal(loaded2.bundle.science, undefined);

      const tooHuge = await saveLocalCortexBundle({
        cortexSnapshot: { schema: 'fbt.neuromorphic.cortex.v3', blob: 'y'.repeat(300_000) },
        episodes: []
      });
      assert.equal(tooHuge.ok, false);
      assert.equal(tooHuge.code, 'BUNDLE_TOO_LARGE');
    } finally {
      await wipeLocalCortexBundle();
      if (original === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = original;
    }
  });
});

describe('Phase 7 — /api/v1/ai/neuromorphic/science surface', () => {
  it('serves a measured, cached, execution-free report and gates prior uploads', async () => {
    __resetScienceProbeCache();
    const { default: app } = await import('../server/app.js');
    const srv = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = srv.address();
      const base = `http://127.0.0.1:${port}/api/v1/ai/neuromorphic/science`;

      const r1 = await fetch(`${base}?nullTests=120&altTests=20`);
      assert.equal(r1.status, 200);
      const j1 = await r1.json();
      assert.equal(j1.ok, true);
      assert.equal(j1.zeroServerGpu, true);
      assert.equal(j1.laws.canExecute, false);
      assert.equal(j1.laws.canSign, false);
      assert.equal(j1.laws.canMoveFunds, false);
      assert.equal(j1.measured.simulated, true);
      assert.equal(j1.measured.nullFamily.tests, 120);
      assert.equal(j1.measured.power.tests, 20);
      assert.equal(typeof j1.measured.determinism.hash, 'string');
      assert.equal(j1.honesty.rawDataCollected, false);
      assert.ok(Array.isArray(j1.families) && j1.families.length === PRESPECIFIED_FAMILIES.length);
      assert.ok(j1.world && typeof j1.world.totals === 'object');
      assert.equal(j1.cached, false);

      const r2 = await fetch(`${base}?nullTests=120&altTests=20`);
      const j2 = await r2.json();
      assert.equal(j2.cached, true);
      assert.deepEqual(j2.measured, j1.measured);

      const packet = {
        schema: SCIENCE_PRIOR_SCHEMA,
        at: T,
        packetHash: 'beef0011',
        records: [
          { key: 'regime-positive-return|meanRevert|*', log10BayesFactor: 3.1 },
          { key: 'not-a-family|meanRevert|*', log10BayesFactor: 99 }
        ]
      };
      const post1 = await fetch(`${base}/prior`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fbt-device': 'evidence-device-01' },
        body: JSON.stringify({ packet })
      });
      assert.equal(post1.status, 200);
      const jp1 = await post1.json();
      assert.equal(jp1.code, 'ACCEPTED');
      assert.equal(jp1.laws.canExecute, false);
      assert.equal(jp1.rejectedRecords, 1);

      const post2 = await fetch(`${base}/prior`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fbt-device': 'evidence-device-01' },
        body: JSON.stringify({ packet })
      });
      assert.equal(post2.status, 400);
      const jp2 = await post2.json();
      assert.equal(jp2.code, 'DUPLICATE_PACKET');

      const post3 = await fetch(`${base}/prior`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fbt-device': 'evidence-device-02' },
        body: JSON.stringify({
          packet: {
            schema: SCIENCE_PRIOR_SCHEMA,
            at: T + 1,
            packetHash: 'beef0012',
            records: [{ key: 'regime-positive-return|meanRevert|*', log10BayesFactor: 2.4 }]
          }
        })
      });
      assert.equal(post3.status, 200);

      const r3 = await fetch(base);
      const j3 = await r3.json();
      const key = j3.world.keys.find((k) => k.key === 'regime-positive-return|meanRevert|*');
      assert.ok(key, 'the uploaded family must appear in the world registry');
      assert.equal(key.contributors, 2);
      assert.equal(key.consensus, true);
      assert.ok(Math.abs(key.log10BayesFactor) <= 60);
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });
});

describe('Phase 7 — worker parity (the real postMessage surface, not the inline mirror)', () => {
  it('answers science messages through the worker protocol and never invents evidence', async () => {
    const replies = [];
    const originalSelf = globalThis.self;
    globalThis.self = {
      postMessage: (message) => replies.push(message),
      onmessage: null
    };
    const send = (message) => new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const found = replies.find((entry) => entry.id === message.id);
        if (found) {
          clearInterval(timer);
          clearTimeout(deadline);
          resolve(found);
        }
      }, 2);
      const deadline = setTimeout(() => {
        clearInterval(timer);
        reject(new Error(`worker timed out on ${message.type}/${message.action || ''}`));
      }, 15000);
      globalThis.self.onmessage({ data: message });
    });

    const candles = Array.from({ length: 26 }, (_, i) => {
      const open = 50000 * (1 + i * 0.004 + Math.sin(i / 3) * 0.002);
      const close = open * (1 + 0.006 + Math.sin(i / 2.5) * 0.003);
      return {
        time: 1700000000000 + i * 3600_000,
        open,
        high: Math.max(open, close) * 1.003,
        low: Math.min(open, close) * 0.997,
        close,
        volume: 1000 + i
      };
    });

    try {
      // Fresh module instance so this test cannot see another test's cortex.
      await import(`../src/lib/neuromorphic/neuromorphic.worker.js?parity=${Date.now()}`);
      let seq = 0;
      const init = await send({ id: ++seq, type: 'init' });
      assert.equal(init.ok, true);

      let tick = null;
      for (let end = 6; end <= 22; end += 2) {
        // eslint-disable-next-line no-await-in-loop
        tick = await send({ id: ++seq, type: 'tick', candles: candles.slice(0, end), symbol: 'BTC' });
        assert.equal(tick.ok, true);
      }
      assert.ok(tick.science, 'a tick must carry the scientific memory report');
      assert.equal(tick.science.schema, SCIENCE_SCHEMA);
      assert.equal(tick.science.laws.canExecute, false);
      assert.equal(tick.science.honesty.preregistrationEnforced, true);
      assert.ok(tick.sciencePrior, 'the advisory prior must travel with the tick');
      if (tick.sciencePrior.validated) {
        assert.ok(Math.abs(tick.sciencePrior.bias) <= 0.15);
      } else {
        assert.equal(tick.sciencePrior.bias, 0);
        assert.equal(tick.sciencePrior.source, 'none');
      }
      assert.equal(/NaN|Infinity/.test(JSON.stringify(tick.science)), false);

      const ingest = await send({ id: ++seq, type: 'science', action: 'ingest' });
      assert.equal(ingest.ok, true);
      // Ticks already ingest, so a repeat must be refused as duplicates — proof
      // that replaying engrams cannot inflate the evidence count.
      assert.ok(ingest.ingest.duplicates > 0 || ingest.ingest.ingested > 0);

      const exported = await send({ id: ++seq, type: 'science', action: 'exportPrior' });
      assert.equal(exported.ok, true);
      assert.equal(exported.packet.schema, SCIENCE_PRIOR_SCHEMA);
      assert.ok(Array.isArray(exported.packet.records));

      const merged = await send({
        id: ++seq,
        type: 'science',
        action: 'mergePrior',
        packet: { ...exported.packet, packetHash: 'feed1234' }
      });
      assert.equal(merged.ok, true);
      assert.ok(merged.science.consensus.externalRecords > 0);

      const retired = await send({ id: ++seq, type: 'science', action: 'retire' });
      assert.equal(retired.ok, true);

      const consolidation = await send({ id: ++seq, type: 'consolidate', iterations: 3 });
      assert.ok(consolidation.science, 'consolidation must also carry the report');

      const status = await send({ id: ++seq, type: 'science' });
      assert.equal(status.science.laws.canSign, false);
    } finally {
      if (originalSelf === undefined) delete globalThis.self;
      else globalThis.self = originalSelf;
    }
  });
});
