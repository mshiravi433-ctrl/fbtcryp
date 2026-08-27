/**
 * PHASE 85 — MULTI-REGION EDGE, PRODUCT LEVEL
 * Latency is measured, never configured. Too few samples is "unknown", a
 * failover is announced with a reason, and zero healthy regions is honest.
 */
import { readFileSync } from 'node:fs';
import {
  measureRegion, selectRegion, recordFailover, drainRegion, assertEdgeHonest,
  EDGE_SCHEMA, REGIONS, MIN_LATENCY_SAMPLES, SLOW_P95_MS, SAMPLE_MAX_AGE_MS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const samples = (n, ms, at = NOW, ok = true) => Array.from({ length: n }, () => ({ latencyMs: ms, at, ok }));

try {
  /* ---------- measuring ---------- */
  const eu = measureRegion({ region: 'eu-central', samples: samples(10, 120), now: NOW });
  check('a measured region reports latency', eu.latencyKnown === true && eu.schema === EDGE_SCHEMA);
  check('the percentiles come from real samples', eu.p50Ms === 120 && eu.p95Ms === 120);
  check('the sample size is reported', eu.sampleSize === 10);
  check('a healthy region is not flagged slow', eu.slow === false && eu.i18nKey === 'intentAI.edge.healthy');
  const thin = measureRegion({ region: 'us-east', samples: samples(MIN_LATENCY_SAMPLES - 1, 80), now: NOW });
  check('too few samples means latency is UNKNOWN', thin.latencyKnown === false);
  check('an unknown latency is not a number', thin.p50Ms === null && thin.p95Ms === null);
  check('the unknown latency is a translatable notice', thin.i18nKey === 'intentAI.edge.latencyUnknown');
  const stale = measureRegion({ region: 'us-east', samples: samples(10, 80, NOW - SAMPLE_MAX_AGE_MS - 1), now: NOW });
  check('stale samples do not count as measurement', stale.latencyKnown === false);
  const slow = measureRegion({ region: 'ap-south', samples: samples(10, SLOW_P95_MS + 400), now: NOW });
  check('a slow region is flagged slow', slow.slow === true && slow.i18nKey === 'intentAI.edge.slow');
  const flaky = measureRegion({ region: 'me-central', samples: [...samples(6, 100), ...samples(4, 100, NOW, false)], now: NOW });
  check('the error rate is measured too', flaky.errorRate === 0.4);
  check('an unknown region is refused', measureRegion({ region: 'moon-1', samples: samples(10, 10), now: NOW }).ok === false);
  check('samples with no timestamp are ignored',
    measureRegion({ region: 'eu-central', samples: Array.from({ length: 9 }, () => ({ latencyMs: 10 })), now: NOW }).latencyKnown === false);
  check('every region is a known region', REGIONS.length === 4);

  /* ---------- selection ---------- */
  const chosen = selectRegion({ measurements: [eu, slow, flaky], now: NOW });
  check('a healthy region is selected', chosen.ok === true && chosen.region === 'eu-central');
  check('the alternatives are listed', chosen.alternatives.includes('ap-south'));
  check('the selection carries the measured number', chosen.p95Ms === 120);
  check('the selection is a translatable notice', chosen.i18nKey === 'intentAI.edge.serving');
  check('a preferred healthy region wins', selectRegion({ measurements: [eu, slow], preferred: 'ap-south', now: NOW }).region === 'eu-central');
  check('a preferred SLOW region is quietly replaced and the switch is flagged',
    selectRegion({ measurements: [eu, slow], preferred: 'ap-south', now: NOW }).switchedFromPreferred === true);
  check('an unmeasured region is never selected', selectRegion({ measurements: [thin], now: NOW }).ok === false);
  check('a region failing most requests is not selected',
    selectRegion({ measurements: [{ ...flaky, errorRate: 0.9 }], now: NOW }).ok === false);
  check('with no healthy region the answer is honest', selectRegion({ measurements: [], now: NOW }).i18nKey === 'intentAI.edge.noRegion');
  check('no healthy region is a provider failure, not a silent default',
    selectRegion({ measurements: [], now: NOW }).error.code === 'PROVIDER_ERROR');

  /* ---------- failover is announced ---------- */
  const moved = recordFailover({ from: 'ap-south', to: 'eu-central', reason: 'HIGH_LATENCY', measurements: [eu], now: NOW });
  check('a failover is recorded', moved.ok === true);
  check('the failover is announced to the user', moved.announced === true && moved.userVisible === true);
  check('the reason travels with it', moved.event.reason === 'HIGH_LATENCY');
  check('the event is frozen', Object.isFrozen(moved.event));
  check('the announcement is a translatable key', moved.i18nKey === 'intentAI.edge.failover');
  check('failing over INTO an unhealthy region is refused',
    recordFailover({ from: 'eu-central', to: 'me-central', measurements: [{ ...flaky, errorRate: 0.9 }], now: NOW }).ok === false);
  check('a failover to nowhere is refused', recordFailover({ from: 'eu-central', now: NOW }).ok === false);

  /* ---------- draining ---------- */
  const drained = drainRegion(eu, { reason: 'MAINTENANCE', now: NOW });
  check('a region can be drained', drained.ok === true && drained.measurement.drained === true);
  check('the drain reason is kept', drained.measurement.drainReason === 'MAINTENANCE');
  check('a drained region is not selected', selectRegion({ measurements: [drained.measurement], now: NOW }).ok === false);
  check('draining nothing is refused', drainRegion(null).ok === false);

  /* ---------- the guard ---------- */
  check('an honest measurement passes', assertEdgeHonest(eu).ok === true);
  check('an unknown latency with a number is caught',
    assertEdgeHonest({ ...thin, p95Ms: 42 }).reasons.includes('LATENCY_INVENTED'));
  check('a known latency from too few samples is caught',
    assertEdgeHonest({ ...eu, sampleSize: 1 }).reasons.includes('UNDER_SAMPLED_LATENCY'));
  check('an unknown region is caught', assertEdgeHonest({ ...eu, region: 'moon-1' }).ok === false);
  check('a non-view is caught', assertEdgeHonest({ p95Ms: 5 }).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the edge copy is translated in en, fa and ar',
    locales.every((loc) => ['serving', 'healthy', 'slow', 'latencyUnknown', 'failover', 'drained', 'noRegion']
      .every((k) => typeof loc?.intentAI?.edge?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase85-regional-edge', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
