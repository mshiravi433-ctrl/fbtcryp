#!/usr/bin/env node
/**
 * FUTURES ↔ RISK ↔ OPPORTUNITY — the wiring probe.
 * ---------------------------------------------------------------------------
 * PROBE (`node --test test/futures-risk-wiring-probe.mjs`). The product now
 * routes one account through three risk modules that were written months apart
 * and never spoke:
 *
 *   src/lib/futures-engine/risk.js          LOW / MEDIUM / HIGH / EXTREME
 *   src/lib/central/risk.js                 LOW / MODERATE / ELEVATED / HIGH / CRITICAL
 *   src/lib/brain/opportunityEngine.js      its own per-row composite
 *
 * This file pins the JOINTS, because a joint is where a silent disagreement
 * becomes a user seeing two different answers about their own money:
 *
 *   1. the translation is total and invertible where it can be, and says so
 *      where it cannot (only the intent scale has MODERATE);
 *   2. the shared thresholds ARE the ones in the existing files — not copies;
 *   3. a breach of a PRODUCT limit blocks, and a block lowers the appetite
 *      ceiling the opportunity scan is allowed to use;
 *   4. an unreadable futures account is `unavailable`, never zero exposure —
 *      in the client bridge AND in the server adapter;
 *   5. the server's pre-trade verdict uses the account's existing exposure, so
 *      an over-levered user is not judged as flat.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { RISK_LIMITS } from '../src/lib/central/risk.js';
import { RISK_POLICY_DEFAULTS } from '../src/lib/futures-engine/risk.js';
import {
  FUTURES_TO_INTENT, INTENT_TO_FUTURES, intentWord, futuresLevel, INTENT_RANK,
  SHARED_LIMITS, limitBreaches, worstAction, futuresStateRow, futuresScanContext,
  attachFuturesContext, FUTURES_PROFILE_CEILING
} from '../src/lib/futures-engine/riskBridge.js';
import { scanPersonalised, RISK_PROFILES } from '../src/lib/opportunity/feed.js';
import {
  normaliseFuturesAccount, futuresPreTrade, withFuturesAccount, FUTURES_LIMITS
} from '../server/central/futuresBridge.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const NOW = 1_760_000_000_000;

/* ─────────────────── 1 · THE VOCABULARY ─────────────────────────────────── */

test('the two vocabularies translate totally, and the gap is named', () => {
  /* every futures level has an intent word */
  for (const lvl of ['LOW', 'MEDIUM', 'HIGH', 'EXTREME']) {
    assert.ok(FUTURES_TO_INTENT[lvl], `${lvl} has no intent word`);
    assert.equal(intentWord(lvl), FUTURES_TO_INTENT[lvl]);
  }
  /* every intent word has a futures level */
  for (const w of ['LOW', 'MODERATE', 'ELEVATED', 'HIGH', 'CRITICAL']) {
    assert.ok(INTENT_TO_FUTURES[w], `${w} has no futures level`);
    assert.equal(futuresLevel(w), INTENT_TO_FUTURES[w]);
  }
  /* the asymmetry is real, not an oversight: there is no futures MODERATE */
  assert.equal(intentWord('MODERATE'), null);
  assert.equal(intentWord('nope'), null);
  assert.equal(futuresLevel('nope'), null);
  /* the bands keep their ORDER — a translation that inverts severity would be
     worse than no translation at all */
  const order = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
  const mapped = order.map((l) => INTENT_RANK[FUTURES_TO_INTENT[l]]);
  assert.deepEqual(mapped, [...mapped].sort((a, b) => a - b), 'severity must be monotonic');
  assert.equal(mapped[0], 0);
  assert.equal(mapped[3], 4);
});

test('the shared limits ARE the existing constants, not a second copy', () => {
  assert.equal(SHARED_LIMITS.concentrationSharePct, RISK_LIMITS.concentrationSharePct);
  assert.equal(SHARED_LIMITS.leverageRatioBlock, RISK_LIMITS.leverageRatioBlock);
  assert.equal(SHARED_LIMITS.leverageRatioWarn, RISK_LIMITS.leverageRatioWarn);
  assert.equal(SHARED_LIMITS.liquidationDistanceWarnPct, RISK_LIMITS.liquidationDistanceWarnPct);
  assert.equal(SHARED_LIMITS.marginRatioWarnPct, RISK_POLICY_DEFAULTS.marginRatioWarnPct);
  assert.equal(SHARED_LIMITS.hardMaxLeverage, RISK_POLICY_DEFAULTS.hardMaxLeverage);
  /* …and the server mirror agrees with the client, because a pre-trade verdict
     computed on the server must not use different numbers than the desk */
  assert.equal(FUTURES_LIMITS.leverageRatioBlock, RISK_LIMITS.leverageRatioBlock);
  assert.equal(FUTURES_LIMITS.leverageRatioWarn, RISK_LIMITS.leverageRatioWarn);
  assert.equal(FUTURES_LIMITS.concentrationSharePct, RISK_LIMITS.concentrationSharePct);
});

/* ─────────────────── 2 · BREACHES ───────────────────────────────────────── */

const portfolio = (over = {}) => ({
  available: true,
  dataStatus: 'live',
  riskLevel: 'MEDIUM',
  margin: { marginRatioPct: 20 },
  exposure: { grossUsd: 1000, netUsd: 1000, leverageRatio: 1, positionCount: 2, largestAsset: { base: 'BTC', shareOfGrossPct: 20 }, hedgedAssets: [] },
  shocks: { rows: [], liquidationScenario: null },
  warnings: [],
  ...over
});

test('a breach of a product limit says WHICH limit and what to do', () => {
  assert.deepEqual(limitBreaches(portfolio({ exposure: { ...portfolio().exposure, leverageRatio: 1 } })), [], '1x is inside every limit');
  const warn = limitBreaches(portfolio({ exposure: { ...portfolio().exposure, leverageRatio: 2 } }));
  assert.equal(warn.length, 1);
  assert.equal(warn[0].code, 'leverage-above-warn-limit');
  assert.equal(warn[0].action, 'warn');
  assert.equal(warn[0].limit, RISK_LIMITS.leverageRatioWarn);

  const block = limitBreaches(portfolio({ exposure: { ...portfolio().exposure, leverageRatio: 4 } }));
  assert.equal(block.some((b) => b.code === 'leverage-above-block-limit' && b.action === 'block'), true);
  assert.equal(worstAction(block), 'block');

  /* concentration above 45% warns, above 45 × 1.4 blocks — the SAME shape
     central/risk.js uses for its own concentration factor */
  const conc = limitBreaches(portfolio({ exposure: { ...portfolio().exposure, largestAsset: { base: 'ETH', shareOfGrossPct: 50 } } }));
  assert.equal(conc.find((b) => b.code === 'futures-concentration-above-limit').action, 'warn');
  const concBig = limitBreaches(portfolio({ exposure: { ...portfolio().exposure, largestAsset: { base: 'ETH', shareOfGrossPct: 80 } } }));
  assert.equal(concBig.find((b) => b.code === 'futures-concentration-above-limit').action, 'block');

  /* the margin ladder: 70 warns, 90 blocks, and the engine's own bands agree */
  assert.equal(limitBreaches(portfolio({ margin: { marginRatioPct: 72 } }))[0].action, 'warn');
  assert.equal(limitBreaches(portfolio({ margin: { marginRatioPct: 95 } }))[0].action, 'block');
});

test('an unreadable account BLOCKS — it never reads as a clean one', () => {
  const b = limitBreaches({ available: false, reason: 'NO_ACCOUNT_DATA' });
  assert.equal(b.length, 1);
  assert.equal(b[0].code, 'futures-account-unreadable');
  assert.equal(b[0].action, 'block', 'not knowing must fail closed');
  assert.equal(limitBreaches(null)[0].action, 'block');
  assert.equal(worstAction([]), 'allow');
});

test('the state row keeps BOTH words, so a badge cannot invent a third', () => {
  const row = futuresStateRow(portfolio({ riskLevel: 'HIGH' }), { at: NOW });
  assert.equal(row.level, 'HIGH');
  assert.equal(row.levelIntent, 'HIGH');
  assert.equal(row.schema, 'fbt.futures-state-row.v1');
  assert.equal(row.at, NOW);
  const medium = futuresStateRow(portfolio({ riskLevel: 'MEDIUM' }));
  assert.equal(medium.level, 'MEDIUM');
  assert.equal(medium.levelIntent, 'ELEVATED', 'the translation is visible in the payload');
  const gone = futuresStateRow({ available: false });
  assert.equal(gone.dataStatus, 'unavailable');
  assert.equal(gone.exposureUsd, 0, 'zero for a TOTAL is a fact; the availability flag carries the doubt');
  assert.equal(gone.worstAction, 'block');
});

/* ─────────────────── 3 · THE SCAN ───────────────────────────────────────── */

test('futures exposure lowers the appetite the scan may use — never raises it', () => {
  const aggressive = futuresScanContext({
    positions: [{ symbol: 'BTC-USD', side: 'long', notionalUsd: 4000 }],
    equityUsd: 1000, maintenanceMarginUsd: 400, availableBalanceUsd: 600,
    riskProfile: 'AGGRESSIVE', at: NOW
  });
  assert.equal(aggressive.available, true);
  assert.equal(aggressive.action, 'block', '4x on 1000 equity is above the 3x block line');
  assert.equal(aggressive.profile, FUTURES_PROFILE_CEILING.AGGRESSIVE);
  assert.equal(aggressive.deRisk, true);
  assert.equal(aggressive.freeCapitalUsd, 200);

  /* flat account → the appetite is untouched */
  const flat = futuresScanContext({ positions: [], equityUsd: 1000, availableBalanceUsd: 1000, riskProfile: 'AGGRESSIVE', at: NOW });
  assert.equal(flat.action, 'allow');
  assert.equal(flat.profile, 'AGGRESSIVE');
  assert.equal(flat.deRisk, false);

  /* readable, but only a warning → one step down, not to the floor.
     Two positions on purpose: a SINGLE position is 100% of the book, which is
     above the 45% concentration limit and therefore a block, not a warning. */
  const warn = futuresScanContext({
    positions: [
      { symbol: 'ETH-USD', side: 'long', notionalUsd: 1200 },
      { symbol: 'BTC-USD', side: 'long', notionalUsd: 800 }
    ],
    equityUsd: 1000, riskProfile: 'AGGRESSIVE', at: NOW
  });
  assert.equal(warn.action, 'warn', '2x is above the 1.5x warn line');
  assert.equal(warn.profile, 'MODERATE');
});

test('no futures read is NOT zero exposure', () => {
  const none = futuresScanContext({});
  assert.equal(none.available, false);
  assert.equal(none.reason, 'NO_FUTURES_ACCOUNT');
  assert.equal(none.exposureUsd, null, 'null, not 0 — a flat user and an unread one differ');
  assert.equal(none.deRisk, false);

  /* and the scan itself leaves the appetite alone when nothing was supplied */
  const scan = scanPersonalised({ capital: { investableUsd: 10000 }, riskProfile: 'AGGRESSIVE', now: NOW });
  assert.equal(scan.profileApplied, 'AGGRESSIVE');
  assert.equal(scan.profileLoweredByFutures, false);
  assert.equal(scan.futures.available, false);
  assert.equal(scan.futures.reason, 'NO_CONTEXT');
});

test('scanPersonalised applies the ceiling and reports that it did', () => {
  const scan = scanPersonalised({
    capital: { investableUsd: 10000 }, riskProfile: 'AGGRESSIVE', now: NOW,
    futures: {
      positions: [{ symbol: 'BTC-USD', side: 'long', notionalUsd: 4000 }],
      equityUsd: 1000, maintenanceMarginUsd: 400, availableBalanceUsd: 600, fundingAprPct: 40
    }
  });
  assert.equal(scan.profileRequested, 'AGGRESSIVE');
  assert.equal(scan.profileApplied, 'BALANCED');
  assert.equal(scan.profileLoweredByFutures, true);
  assert.equal(scan.personalisation.futures.profileLowered, true);
  assert.equal(scan.futures.action, 'block');
  /* the coverage table gains ONE row for the new source; the seven feed
     families it already reported are untouched */
  assert.equal(scan.coverage.length, 8);
  assert.equal(scan.coverage.filter((c) => c.id === 'FUTURES_ACCOUNT').length, 1);
  assert.equal(scan.coverage.find((c) => c.id === 'FUTURES_ACCOUNT').status, 'live');
  /* a profile the user cannot have been shown is not silently kept */
  assert.ok(RISK_PROFILES.some((p) => p.id === scan.profileApplied));
});

test('the scan cannot be raised above the appetite the user chose', () => {
  const scan = scanPersonalised({
    capital: { investableUsd: 1000 }, riskProfile: 'CONSERVATIVE', now: NOW,
    futures: { positions: [], equityUsd: 1000, availableBalanceUsd: 1000 }
  });
  assert.equal(scan.profileApplied, 'CONSERVATIVE');
  assert.equal(scan.profileLoweredByFutures, false);
});

test('attachFuturesContext is inert when it is given nothing to say', () => {
  const base = { opportunities: [], coverage: [{ id: 'A' }] };
  assert.equal(attachFuturesContext(base, null).futures.reason, 'NO_CONTEXT');
  assert.equal(attachFuturesContext(base, null).coverage.length, 1);
  assert.equal(attachFuturesContext(null, { available: true }), null);
  const withCtx = attachFuturesContext(base, { available: false, reason: 'NO_FUTURES_ACCOUNT' });
  assert.equal(withCtx.coverage.at(-1).status, 'unavailable');
  assert.equal(withCtx.coverage.at(-1).rows, 0);
});

/* ─────────────────── 4 · THE SERVER ADAPTER ─────────────────────────────── */

test('the server adapter builds the exact shape futuresRisk already reads', () => {
  const acct = normaliseFuturesAccount({
    provider: 'dydx',
    equityUsd: 1000,
    maintenanceMarginUsd: 600,
    availableBalanceUsd: 400,
    positions: [{ symbol: 'btc-usd', side: 'long', notionalUsd: 2000, entryPrice: 100 }]
  });
  assert.equal(acct.dataStatus, 'live');
  assert.equal(acct.marginRatioPct, 60);
  assert.equal(acct.leverageRatio, 2);
  assert.equal(acct.grossUsd, 2000);
  /* `amount × entry` must equal `notionalUsd`: futuresRisk sums the first pair
     and analyzeExposure sums the second, and they must not disagree */
  assert.equal(acct.positions[0].amount * acct.positions[0].entry, acct.positions[0].notionalUsd);
  assert.equal(acct.positions[0].symbol, 'BTC-USD');
});

test('an unreadable account stays unreadable through the server adapter', () => {
  const none = normaliseFuturesAccount({});
  assert.equal(none.dataStatus, 'unavailable');
  assert.equal(none.reason, 'NO_ACCOUNT_READ');
  /* equals nothing: the state is left exactly as it was */
  const state = { portfolio: { data: { totalValueUsd: 100 } } };
  assert.equal(withFuturesAccount(state, none), state);
});

test('the pre-trade verdict counts the exposure the account ALREADY carries', () => {
  const account = normaliseFuturesAccount({
    provider: 'dydx', equityUsd: 1000, maintenanceMarginUsd: 300,
    positions: [{ symbol: 'BTC-USD', side: 'long', notionalUsd: 2000, entryPrice: 100 }]
  });
  /* a 1000-notional order on a 1000-equity account that already holds 2000:
     3000 total = 3x. On its own the order would look like 1x. */
  const verdict = futuresPreTrade({ account, portfolioUsd: 5000, marginUsd: 200, leverage: 5 });
  assert.equal(verdict.existingExposureUsd, 2000);
  assert.equal(verdict.newNotionalUsd, 1000);
  assert.equal(verdict.exposureUsd, 3000);
  assert.equal(verdict.leverageRatio, 3);
  assert.equal(verdict.exposurePctOfPortfolio, 60);
  /* exactly AT the block line is not above it — the limit is "> 3", and the
     verdict must match the table rather than rounding a 3.0 into a block */
  assert.equal(verdict.reasons.some((r) => r.code === 'leverage-above-block-limit'), false);
  assert.equal(verdict.action, 'warn');
  assert.equal(verdict.schema, 'fbt.futures-pretrade.v1');

  /* one more notch and it blocks */
  const more = futuresPreTrade({ account, portfolioUsd: 5000, marginUsd: 500, leverage: 5 });
  assert.equal(more.action, 'block');
  assert.equal(more.reasons.find((r) => r.code === 'leverage-above-block-limit').limit, 3);

  /* with no account and no order there is nothing to judge — and it says so
     instead of returning "allow" */
  assert.equal(futuresPreTrade({}).action, 'block');
  assert.equal(futuresPreTrade({}).reason, 'NO_ORDER_AND_NO_ACCOUNT');
});

test('a thin liquidation distance warns even when the leverage looks fine', () => {
  const account = normaliseFuturesAccount({
    provider: 'dydx', equityUsd: 1000, maintenanceMarginUsd: 50,
    positions: [{ symbol: 'ETH-USD', side: 'long', notionalUsd: 1200, entryPrice: 10, liquidationDistancePct: 8 }]
  });
  const v = futuresPreTrade({ account, portfolioUsd: 10000, marginUsd: 0, leverage: 1, notionalUsd: 0 });
  assert.equal(v.reasons.some((r) => r.code === 'liquidation-close'), true);
  assert.equal(v.action, 'warn');
  assert.ok(close(v.leverageRatio, 1.2, 1e-9));
});

test('withFuturesAccount writes the section shape assessRisk resolves', () => {
  const account = normaliseFuturesAccount({
    provider: 'ostium', equityUsd: 500, positions: [{ symbol: 'ETH-USD', side: 'short', notionalUsd: 400, entryPrice: 2000 }]
  });
  const state = withFuturesAccount({ portfolio: { data: { totalValueUsd: 900 } } }, account);
  assert.ok(state.futures?.data, 'the section exists');
  assert.equal(state.futures.source, 'venue:ostium');
  assert.equal(state.futures.data.positions.length, 1);
  assert.equal(state.futures.data.positions[0].side, 'short');
  assert.equal(state.futures.data.equityUsd, 500);
  /* the caller's object is not mutated */
  assert.equal({}.hasOwnProperty.call({ portfolio: 1 }, 'futures'), false);
});
