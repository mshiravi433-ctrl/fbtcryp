/**
 * PHASE 60 — EXPLAINABLE ANALYSIS ON REAL DATA
 * Every number in an answer must be traceable to a source and a time.
 * Unsourced, untimestamped, non-numeric and stale points are dropped; with
 * nothing checkable left, no recommendation is made at all.
 */
import { readFileSync } from 'node:fs';
import {
  screenDataPoints, whyFromLiveData, assertExplainable,
  LIVE_WHY_SCHEMA, DEFAULT_DATA_MAX_AGE_MS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const point = (over = {}) => ({ label: 'cost', source: 'dex:uniswap', observedAt: NOW - 60_000, value: 12, unit: 'usd', ...over });
const GOOD = [
  point(),
  point({ label: 'liquidity', value: 1_400_000, source: 'dex:pools' }),
  point({ label: 'risk', value: 30, source: 'risk:engine' })
];

try {
  /* ---------- screening drops what cannot be checked ---------- */
  check('a point with no source is dropped',
    screenDataPoints([point({ source: null })], { now: NOW }).accepted.length === 0);
  check('the drop reason is recorded',
    screenDataPoints([point({ source: null })], { now: NOW }).rejected[0].reason === 'NO_SOURCE');
  check('a point with no timestamp is dropped',
    screenDataPoints([point({ observedAt: null })], { now: NOW }).rejected[0].reason === 'NO_TIMESTAMP');
  check('a point with a non-numeric value is dropped',
    screenDataPoints([point({ value: 'cheap' })], { now: NOW }).rejected[0].reason === 'NO_NUMBER');
  check('a point with no label is dropped',
    screenDataPoints([point({ label: null })], { now: NOW }).rejected[0].reason === 'NO_LABEL');
  check('a stale point is dropped and counted',
    screenDataPoints([point({ observedAt: NOW - DEFAULT_DATA_MAX_AGE_MS - 1 })], { now: NOW }).rejected[0].reason === 'STALE');
  check('a non-object entry is dropped',
    screenDataPoints(['just a sentence'], { now: NOW }).rejected[0].reason === 'NOT_A_DATA_POINT');
  const screened = screenDataPoints(GOOD, { now: NOW });
  check('checkable points survive screening', screened.accepted.length === 3);
  check('surviving points keep their source', screened.accepted.every((row) => typeof row.source === 'string'));
  check('surviving points keep their observation time', screened.accepted.every((row) => Number.isFinite(row.observedAt)));
  check('surviving points carry their age', screened.accepted.every((row) => row.ageMs === 60_000));
  check('surviving points keep their number', screened.accepted.every((row) => Number.isFinite(row.value)));

  /* ---------- no checkable data means no recommendation ---------- */
  const nothing = whyFromLiveData({ action: 'swap 100 usdc to eth', decision: { reason: 'cheapest route' }, dataPoints: [], now: NOW });
  check('with no data at all, no recommendation is made',
    nothing.ok === false && nothing.recommendationAllowed === false);
  check('the refusal is not explainable-by-claim', nothing.explainable === false);
  check('the refusal is an i18n key', nothing.i18nKey === 'intentAI.why.noData');
  check('the refusal carries a classified error', typeof nothing.error?.code === 'string');
  const onlyJunk = whyFromLiveData({
    action: 'swap', decision: { reason: 'looks good' },
    dataPoints: [point({ source: null }), point({ observedAt: null })], now: NOW
  });
  check('data that cannot be checked is the same as no data', onlyJunk.recommendationAllowed === false);
  check('the dropped points are listed so the user can see what was missing', onlyJunk.rejected.length === 2);
  const onlyStale = whyFromLiveData({
    action: 'swap', decision: { reason: 'cheapest' },
    dataPoints: GOOD.map((row) => ({ ...row, observedAt: NOW - 48 * 3_600_000 })), now: NOW
  });
  check('an answer is not built on stale data', onlyStale.recommendationAllowed === false);

  /* ---------- a real answer is fully traceable ---------- */
  const why = whyFromLiveData({
    action: 'swap 100 usdc to eth', decision: { reason: 'lowest total cost on the checked routes' },
    actor: 'strategy', dataPoints: GOOD, now: NOW
  });
  check('checkable data produces an explainable answer', why.ok === true && why.explainable === true);
  check('the answer declares its schema', why.schema === LIVE_WHY_SCHEMA);
  check('the answer keeps the Spec-65 decision contract', typeof why.decisionSchema === 'string');
  check('every basis row names a source', why.basis.every((row) => Boolean(row.source)));
  check('every basis row names a time', why.basis.every((row) => Number.isFinite(row.observedAt)));
  check('every basis row names a number', why.basis.every((row) => Number.isFinite(row.value)));
  check('the answer lists its distinct sources', why.sources.length === 3);
  check('the answer reports the oldest and newest observation',
    why.oldestObservedAt === NOW - 60_000 && why.newestObservedAt === NOW - 60_000);
  check('the answer never authorizes execution', why.executionAuthorized === false);
  check('the summary is an i18n key', why.i18nKey === 'intentAI.why.basis');
  check('the summary params name the sources', typeof why.i18nParams.sources === 'string' && why.i18nParams.sources.includes('dex:uniswap'));
  check('the real cost figure reached the decision engine', why.factors.cost === 12);
  check('the real liquidity figure reached the decision engine', why.factors.liquidity === 1_400_000);

  /* ---------- the fail-closed guard ---------- */
  check('the guard accepts a fully traceable answer', assertExplainable(why).ok === true);
  check('the guard rejects a refusal', assertExplainable(nothing).ok === false);
  check('the guard rejects a hand-made object claiming to be an explanation',
    assertExplainable({ schema: LIVE_WHY_SCHEMA, ok: true, basis: [] }).ok === false);
  check('the guard rejects a basis row without a source',
    assertExplainable({ schema: LIVE_WHY_SCHEMA, ok: true, basis: [{ value: 1, observedAt: NOW }] }).ok === false);
  check('the guard rejects a basis row without a timestamp',
    assertExplainable({ schema: LIVE_WHY_SCHEMA, ok: true, basis: [{ value: 1, source: 'x' }] }).ok === false);
  check('the guard rejects nothing at all', assertExplainable(null).ok === false);

  /* ---------- an answer without evidence cannot claim "better" ---------- */
  const noCompare = whyFromLiveData({
    action: 'swap', decision: { reason: 'cheapest' },
    dataPoints: [point({ label: 'liquidity', value: 900_000 })],
    alternative: {}, now: NOW
  });
  check('a comparison without evidence on both sides is not claimed as better',
    noCompare.ok !== true || noCompare.saysBetter === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the why strings exist in en, fa and ar',
    locales.every((loc) => typeof loc?.intentAI?.why?.noData === 'string' && typeof loc?.intentAI?.why?.basis === 'string'));

  console.log(JSON.stringify({ probe: 'phase60-live-why', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
