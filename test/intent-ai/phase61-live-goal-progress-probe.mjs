/**
 * PHASE 61 — LIVE GOAL PROGRESS
 * A countdown is not progress. Progress is only shown when it comes from a
 * real, sourced, fresh valuation of real holdings — otherwise it is an
 * explicit "unknown", never a bar sitting at 0%.
 */
import { readFileSync } from 'node:fs';
import {
  valueHoldings, liveGoalProgress, progressBarState, LIVE_GOAL_PROGRESS_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const HOLDINGS = [{ symbol: 'eth', amount: 0.5 }, { symbol: 'usdc', amount: 250 }];
const priceSource = (over = {}) => async () => ({
  ETH: { usd: 2500, at: NOW - 60_000, source: 'coingecko' },
  USDC: { usd: 1, at: NOW - 60_000, source: 'coingecko' },
  ...over
});

try {
  /* ---------- valuing real holdings ---------- */
  const valued = await valueHoldings({ holdings: HOLDINGS, priceSource: priceSource(), now: NOW });
  check('real holdings are valued at real prices', valued.ok === true && valued.valueUsd === 1500);
  check('the valuation names its source', valued.sources.includes('coingecko'));
  check('the valuation carries the oldest observation time', valued.oldestAt === NOW - 60_000);
  check('no price source at all is refused', (await valueHoldings({ holdings: HOLDINGS, now: NOW })).ok === false);
  check('no holdings at all is refused', (await valueHoldings({ holdings: [], priceSource: priceSource(), now: NOW })).ok === false);
  check('a throwing feed is refused',
    (await valueHoldings({ holdings: HOLDINGS, priceSource: async () => { throw new Error('502'); }, now: NOW })).reason === 'PRICE_FEED_FAILED');
  check('a price with no source is refused',
    (await valueHoldings({ holdings: HOLDINGS, priceSource: priceSource({ ETH: { usd: 2500, at: NOW } }), now: NOW })).ok === false);
  check('a stale price is refused',
    (await valueHoldings({ holdings: HOLDINGS, priceSource: priceSource({ ETH: { usd: 2500, at: NOW - 86_400_000, source: 'x' } }), now: NOW })).ok === false);
  check('a missing price for one asset refuses the whole valuation',
    (await valueHoldings({ holdings: HOLDINGS, priceSource: priceSource({ ETH: null }), now: NOW })).ok === false);

  /* ---------- unknown progress is null, never zero ---------- */
  const noFeed = await liveGoalProgress({ targetCapital: 3000, holdings: HOLDINGS, now: NOW });
  check('with no price source the progress is null', noFeed.progressPct === null);
  check('a null progress is NOT reported as zero', noFeed.progressPct !== 0);
  check('the unknown state is explicit', noFeed.status === 'unattested' && noFeed.progressComputable === false);
  check('the unknown state is an i18n key', noFeed.i18nKey === 'intentAI.goalProgress.unknown');
  check('the unknown state carries a classified error', typeof noFeed.error?.code === 'string');
  const deadFeed = await liveGoalProgress({
    targetCapital: 3000, holdings: HOLDINGS, priceSource: async () => { throw new Error('down'); }, now: NOW
  });
  check('a dead feed yields unknown progress, not stale progress', deadFeed.progressPct === null);
  const noTarget = await liveGoalProgress({ holdings: HOLDINGS, priceSource: priceSource(), now: NOW });
  check('without a target there is no percentage', noTarget.progressPct === null);
  const staleFeed = await liveGoalProgress({
    targetCapital: 3000, holdings: HOLDINGS,
    priceSource: priceSource({ ETH: { usd: 2500, at: NOW - 86_400_000, source: 'coingecko' } }), now: NOW
  });
  check('stale prices yield unknown progress', staleFeed.progressComputable === false);

  /* ---------- a real, attested progress reading ---------- */
  const live = await liveGoalProgress({ targetCapital: 3000, holdings: HOLDINGS, initialCapitalUsd: 1000, priceSource: priceSource(), now: NOW });
  check('live prices produce a real percentage', live.ok === true && live.progressPct === 50);
  check('the result declares its schema', live.schema === LIVE_GOAL_PROGRESS_SCHEMA);
  check('the result is attested', live.status === 'attested' && live.progressComputable === true);
  check('the result reports the real current value', live.currentValueUsd === 1500);
  check('the result reports what is still missing', live.remainingUsd === 1500);
  check('growth from the initial capital is computed from real numbers', live.growthFromInitialPct === 50);
  check('the result names its sources', live.sources.includes('coingecko'));
  check('the result carries the observation time', live.observedAt === NOW - 60_000);
  check('the result lists the priced holdings', live.holdings.length === 2 && live.holdings[0].price === 2500);
  check('progress never authorizes execution', live.executionAuthorized === false);
  const past = await liveGoalProgress({ targetCapital: 1000, holdings: HOLDINGS, priceSource: priceSource(), now: NOW });
  check('exceeding the target is reported honestly, above 100%', past.progressPct === 150);

  /* ---------- the bar state the UI renders ---------- */
  const barKnown = progressBarState(live);
  check('a known progress renders a real bar', barKnown.known === true && barKnown.widthPct === 50);
  check('a known progress passes the percentage through', barKnown.pct === 50);
  const barUnknown = progressBarState(noFeed);
  check('an unknown progress is a distinct state, not a 0% bar', barUnknown.known === false && barUnknown.pct === null);
  check('the unknown bar state uses the unknown i18n key', barUnknown.i18nKey === 'intentAI.goalProgress.unknown');
  check('the bar width is clamped at 100', progressBarState(past).widthPct === 100);
  check('an over-target bar is flagged as reached', progressBarState(past).reached === true);
  check('a null result is an unknown bar', progressBarState(null).known === false);

  /* ---------- the component actually renders it ---------- */
  const jsx = readFileSync('src/components/GoalCountdown.jsx', 'utf8');
  check('the countdown component accepts a progress percentage', /progressPct/.test(jsx));
  check('the countdown component renders a progress bar', /data-testid="goal-progress-bar"/.test(jsx));
  check('the component exposes an accessible progressbar role', /role="progressbar"/.test(jsx));
  check('the component has a distinct unknown state', /data-testid="goal-progress-unknown"/.test(jsx));
  check('the bar is only rendered when the progress is known', /progressKnown \?/.test(jsx));
  check('the component contains no Persian or Arabic literals', !/[\u0600-\u06FF]/.test(jsx));
  const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');
  check('the panel passes a progress percentage to the countdown', /progressPct=\{goalProgressView/.test(panel));
  check('the panel only shows progress from an attested balance', /attestedBalance/.test(panel));

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the goal progress strings exist in en, fa and ar',
    locales.every((loc) => ['title', 'percent', 'unknown', 'unknownShort', 'summary', 'source']
      .every((k) => typeof loc?.intentAI?.goalProgress?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase61-live-goal-progress', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
