/**
 * PHASE 58 — LIVE MARKET REGIME
 * A regime read must come from real, fresh, sourced prices. A dead feed is
 * "unavailable", stale points are excluded rather than smoothed over, and the
 * answer always carries its source, timestamp and sample size.
 */
import { readFileSync } from 'node:fs';
import {
  normalizeSeries, seriesMetrics, buildRegimeEvidence,
  detectLiveMarketRegime, describeLiveRegime,
  MIN_REGIME_POINTS, LIVE_REGIME_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

/** A rising series: 24 hourly points, +1.5% each step. */
const rising = (n = 24, start = 100, stepPct = 1.5, endAt = NOW) =>
  Array.from({ length: n }, (_, i) => ({ t: endAt - (n - 1 - i) * HOUR, p: start * (1 + stepPct / 100) ** i }));
const falling = (n = 24) => rising(n, 100, -1.5);
const flat = (n = 24) => Array.from({ length: n }, (_, i) => ({ t: NOW - (n - 1 - i) * HOUR, p: 100 }));

try {
  /* ---------- normalising real series shapes ---------- */
  check('tuple series [[t,p]] normalise', normalizeSeries([[2, 5], [1, 4]]).length === 2);
  check('normalised points are sorted by time', normalizeSeries([[2, 5], [1, 4]])[0].t === 1);
  check('non-numeric and zero-price points are dropped',
    normalizeSeries([{ t: 1, p: 0 }, { t: 2, p: 'abc' }, { t: 3, p: 9 }]).length === 1);
  check('a non-array series normalises to empty', normalizeSeries(null).length === 0);

  /* ---------- metrics come from the real points ---------- */
  const upMetrics = seriesMetrics(normalizeSeries(rising()));
  check('an up series has a positive trend', upMetrics.trendPct > 10);
  check('metrics report the real sample size', upMetrics.points === 24);
  check('metrics carry the first and last observation times',
    upMetrics.firstAt === NOW - 23 * HOUR && upMetrics.lastAt === NOW);
  check('a flat series has ~zero trend', Math.abs(seriesMetrics(normalizeSeries(flat())).trendPct) < 0.001);
  check('a single point yields no metrics', seriesMetrics([{ t: 1, p: 1 }]).trendPct === null);

  /* ---------- evidence needs a source and enough fresh points ---------- */
  check('evidence without a source is refused',
    buildRegimeEvidence({ series: rising(), source: '', now: NOW }).ok === false);
  const thin = buildRegimeEvidence({ series: rising(MIN_REGIME_POINTS - 1), source: 'price:eth', now: NOW });
  check('too few fresh points cannot make evidence', thin.ok === false && thin.reason === 'NOT_ENOUGH_FRESH_POINTS');
  const stale = buildRegimeEvidence({ series: rising(24, 100, 1.5, NOW - 10 * 24 * HOUR), source: 'price:eth', now: NOW });
  check('a series whose points are all older than the window is refused', stale.ok === false);
  const good = buildRegimeEvidence({ series: rising(), source: 'price:eth', now: NOW });
  check('good evidence carries its source', good.ok === true && good.evidence.source === 'price:eth');
  check('good evidence carries the observation time', good.evidence.observedAt === NOW);
  check('evidence quality is bounded to 0..1', good.evidence.quality > 0 && good.evidence.quality <= 1);

  /* ---------- the live detector ---------- */
  const feed = (map) => async ({ assetId }) => {
    if (!(assetId in map)) throw new Error('no data');
    return map[assetId];
  };

  const noSource = await detectLiveMarketRegime({ assets: ['ethereum'], now: NOW });
  check('no price source at all is honest-unavailable',
    noSource.ok === false && noSource.dataStatus === 'unavailable' && noSource.regime === 'unavailable');
  check('the unavailable answer carries a classified error', typeof noSource.error?.code === 'string');

  const deadFeed = await detectLiveMarketRegime({
    assets: ['ethereum'], priceSource: async () => { throw new Error('502'); }, now: NOW
  });
  check('a dead feed never invents a regime',
    deadFeed.dataStatus === 'unavailable' && deadFeed.regime === 'unavailable');
  check('the failing asset is reported as skipped, with a reason',
    deadFeed.skipped?.[0]?.reason === 'FEED_FAILED');

  const staleFeed = await detectLiveMarketRegime({
    assets: ['ethereum'], priceSource: feed({ ethereum: rising(24, 100, 1.5, NOW - 30 * 24 * HOUR) }), now: NOW
  });
  check('a feed that only returns stale points is unavailable, not "sideways"',
    staleFeed.dataStatus === 'unavailable');

  const bull = await detectLiveMarketRegime({ assets: ['ethereum'], priceSource: feed({ ethereum: rising() }), now: NOW });
  check('a real rising series is detected as a bull regime',
    bull.ok === true && Array.isArray(bull.regime) && bull.regime.includes('bull'));
  check('the live result declares the live data status', bull.dataStatus === 'live' && bull.schema === LIVE_REGIME_SCHEMA);
  check('the answer names its source', bull.sources[0]?.source === 'price:ethereum');
  check('the answer carries the observation age', Number.isFinite(bull.sources[0]?.ageMs));
  check('the answer carries the sample size', bull.sources[0]?.points === 24);
  check('a regime never authorizes execution', bull.executionAuthorized === false);
  check('a regime never switches strategy by itself', bull.strategyChangesAutomatically === false);

  const bear = await detectLiveMarketRegime({ assets: ['ethereum'], priceSource: feed({ ethereum: falling() }), now: NOW });
  check('a real falling series is detected as a bear regime', bear.regime.includes('bear'));

  const sideways = await detectLiveMarketRegime({ assets: ['ethereum'], priceSource: feed({ ethereum: flat() }), now: NOW });
  check('a flat series is sideways, not bull or bear', sideways.regime.includes('sideways'));

  const thinLiquidity = await detectLiveMarketRegime({
    assets: ['ethereum'], priceSource: feed({ ethereum: flat() }), liquidityBy: { ethereum: 50_000 }, now: NOW
  });
  check('real thin liquidity surfaces as low-liquidity', thinLiquidity.regime.includes('low-liquidity'));
  check('low liquidity asks for a strategy review', thinLiquidity.requiresStrategyReview === true);

  const partial = await detectLiveMarketRegime({
    assets: ['ethereum', 'broken'], priceSource: feed({ ethereum: rising() }), now: NOW
  });
  check('one working feed plus one broken feed still answers, and says what was skipped',
    partial.ok === true && partial.sources.length === 1 && partial.skipped.length === 1);

  /* ---------- the user-facing description ---------- */
  const described = describeLiveRegime(bull);
  check('the description is available for a live regime', described.available === true);
  check('the description is an i18n key, not a built sentence',
    described.i18nKey === 'intentAI.regime.summary' && !/[a-z] [a-z]/.test(described.i18nKey));
  check('the description passes the sources through', typeof described.params.sources === 'string' && described.params.sources.length > 0);
  const describedDead = describeLiveRegime(deadFeed);
  check('an unavailable regime describes itself as unavailable',
    describedDead.available === false && describedDead.i18nKey === 'intentAI.regime.unavailable');

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the regime strings exist in en, fa and ar',
    locales.every((loc) => typeof loc?.intentAI?.regime?.summary === 'string' && typeof loc?.intentAI?.regime?.unavailable === 'string'));

  console.log(JSON.stringify({ probe: 'phase58-live-market-regime', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
