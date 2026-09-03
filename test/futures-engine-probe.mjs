/**
 * FBT FUTURES ENGINE — pure-logic probe (no DOM, no network).
 * ---------------------------------------------------------------------------
 * Pins the parts of the v3 spec that are pure and therefore unforgivable to
 * get wrong: provider status derivation (§3/§4), the fee engine's
 * Protocol + Network + FBT = Total rule and its ceilings (§7), the risk
 * engine's liquidation model and block reasons (§8), the router's
 * "never on FBT revenue" law (§6), the transaction state machine (§13), the
 * error taxonomy (§23) and idempotency keys (§16).
 *
 * Runs at import time with node:assert, like test/lending-engine-probe.mjs.
 */
import assert from 'node:assert/strict';
import {
  PROVIDER_STATUS, PROVIDER_CATALOGUE, PROVIDER_IDS, FORBIDDEN_PROVIDER_IDS, EXECUTION_MODEL,
  resolveProviderStatus, isExecutableStatus,
  FBT_FEE_MAX_BPS, FEE_POLICIES, resolveFbtBps, computeFeeBreakdown, validateFeeBreakdown, notionalUsd,
  assessFuturesRisk, liquidationDistance, positionHealth, RISK_LEVEL,
  selectVenue, scoreCandidate, rejectReason,
  createFuturesTxMachine, FUTURES_TX_STATE, FUTURES_TRANSITIONS, isTerminalFuturesState,
  FUTURES_ERRORS, mapFuturesError, isFuturesSecurityStop,
  makeFuturesIdempotencyKey, isValidIdempotencyKey, makeFuturesRequestId,
  FUTURES_EVENTS, isFuturesEvent
} from '../src/lib/futures-engine/index.js';

const t = (name, ok) => { assert.ok(ok, name); console.log(`✓ ${name}`); };

/* ── §3/§4 providers ─────────────────────────────────────────────────────── */

t('provider catalogue lists no centralized exchange',
  PROVIDER_IDS.every((id) => !FORBIDDEN_PROVIDER_IDS.includes(id)) && Object.values(PROVIDER_CATALOGUE).every((p) => p.custody === 'onchain'));
t('only a provider with a built order path can claim canExecute',
  Object.values(PROVIDER_CATALOGUE).every((p) => !p.capabilities.canExecute
    || p.execution === EXECUTION_MODEL.ONCHAIN_UNSIGNED_TX
    || p.execution === EXECUTION_MODEL.CLIENT_BUILDS_TX));
/* The browser bundle moved to @velocity-exchange/sdk, so the venue builds and
   signs real Velocity orders in the tab: CLIENT_BUILDS_TX, executable. */
t('the Solana venue is Velocity and its order path is built in the tab',
  PROVIDER_CATALOGUE.drift.family === 'solana' && PROVIDER_CATALOGUE.drift.name === 'Velocity'
  && PROVIDER_CATALOGUE.drift.collateral === 'USDT'
  && PROVIDER_CATALOGUE.drift.execution === EXECUTION_MODEL.CLIENT_BUILDS_TX
  && PROVIDER_CATALOGUE.drift.capabilities.canExecute === true
  && PROVIDER_CATALOGUE.drift.capabilities.canPrepare === true
  && PROVIDER_CATALOGUE.drift.capabilities.canReadPositions === true
  && PROVIDER_CATALOGUE.drift.capabilities.canReadMarkets === true
  && PROVIDER_CATALOGUE.drift.capabilities.supportsTakeProfit === true
  && PROVIDER_CATALOGUE.drift.capabilities.supportsStopLoss === true);
t('status vocabulary is exactly the six spec words',
  JSON.stringify(Object.values(PROVIDER_STATUS).sort()) === JSON.stringify(['AVAILABLE', 'BLOCKED', 'DEGRADED', 'MAINTENANCE', 'READ_ONLY', 'UNAVAILABLE']));
t('a built + configured + live provider is AVAILABLE',
  resolveProviderStatus({ execution: EXECUTION_MODEL.ONCHAIN_UNSIGNED_TX, configured: true, dataLive: true }).status === 'AVAILABLE');
t('a live feed with NO order path is READ_ONLY, never AVAILABLE',
  resolveProviderStatus({ execution: EXECUTION_MODEL.NOT_BUILT, configured: true, dataLive: true }).status === 'READ_ONLY');
t('an unconfigured order path is READ_ONLY even when the feed is live',
  resolveProviderStatus({ execution: EXECUTION_MODEL.ONCHAIN_UNSIGNED_TX, configured: false, dataLive: true }).status === 'READ_ONLY');
t('no data at all is UNAVAILABLE',
  resolveProviderStatus({ execution: EXECUTION_MODEL.ONCHAIN_UNSIGNED_TX, configured: true, dataLive: false }).status === 'UNAVAILABLE');
t('a stale feed is DEGRADED (still executable, flagged)',
  (() => { const r = resolveProviderStatus({ execution: EXECUTION_MODEL.ONCHAIN_UNSIGNED_TX, configured: true, dataLive: true, dataStale: true }); return r.status === 'DEGRADED' && isExecutableStatus(r.status); })());
t('five recent errors flip an executable venue to READ_ONLY',
  resolveProviderStatus({ execution: EXECUTION_MODEL.ONCHAIN_UNSIGNED_TX, configured: true, dataLive: true, recentErrors: 5 }).status === 'READ_ONLY');
t('BLOCKED beats everything, MAINTENANCE beats data',
  resolveProviderStatus({ blocked: true, dataLive: true, configured: true, execution: EXECUTION_MODEL.ONCHAIN_UNSIGNED_TX }).status === 'BLOCKED'
  && resolveProviderStatus({ maintenance: true, dataLive: true, configured: true, execution: EXECUTION_MODEL.ONCHAIN_UNSIGNED_TX }).status === 'MAINTENANCE');
t('a client-signed venue (dYdX) is READ_ONLY from the server\'s point of view',
  resolveProviderStatus({ execution: EXECUTION_MODEL.CLIENT_SIGNED_SESSION, configured: true, dataLive: true }).status === 'READ_ONLY');
t('a client-builds-tx venue with a live feed is AVAILABLE in this tab',
  resolveProviderStatus({ execution: EXECUTION_MODEL.CLIENT_BUILDS_TX, configured: true, dataLive: true }).status === 'AVAILABLE');
t('a client-builds-tx venue with a DEAD feed is the reported UNAVAILABLE · FEED_UNAVAILABLE',
  (() => { const r = resolveProviderStatus({ execution: EXECUTION_MODEL.CLIENT_BUILDS_TX, configured: true, dataLive: false }); return r.status === 'UNAVAILABLE' && r.reason === 'FEED_UNAVAILABLE'; })());
t('config can never make a NOT_BUILT venue executable',
  !isExecutableStatus(resolveProviderStatus({ execution: EXECUTION_MODEL.NOT_BUILT, configured: true, enabled: true, dataLive: true }).status));

/* ── §7 fee engine ───────────────────────────────────────────────────────── */

t('notional is collateral × leverage and null on bad input',
  notionalUsd({ collateralUsd: 100, leverage: 10 }) === 1000 && notionalUsd({ collateralUsd: 0, leverage: 10 }) === null && notionalUsd({ collateralUsd: 'x', leverage: 10 }) === null);
t('FBT fee ceiling is 10 bps and every policy sits under it',
  FBT_FEE_MAX_BPS === 10 && Object.values(FEE_POLICIES).every((p) => p.bps <= FBT_FEE_MAX_BPS));
t('an override above the ceiling is clamped, never honoured',
  resolveFbtBps({ overrideBps: 999 }).bps === 10 && resolveFbtBps({ overrideBps: 999 }).clamped === true);
t('the venue cap also applies, whichever is smaller',
  resolveFbtBps({ policyId: 'STANDARD', venueCapBps: 2 }).bps === 2);
t('an unknown policy falls back to STANDARD, not to the maximum',
  resolveFbtBps({ policyId: 'WHALE_PLATINUM' }).bps === FEE_POLICIES.STANDARD.bps);
t('ZERO policy charges nothing',
  computeFeeBreakdown({ collateralUsd: 100, leverage: 10, protocolFeeBps: 8, networkFeeUsd: 0.1, policyId: 'ZERO' }).fbt.feeUsd === 0);
{
  const b = computeFeeBreakdown({ collateralUsd: 100, leverage: 10, protocolFeeBps: 8, protocolFlatUsd: 0.1, networkFeeUsd: 0.05, policyId: 'STANDARD', venueCapBps: 50, recipient: '0x' + 'a'.repeat(40) });
  t('Protocol + Network + FBT = Total, to the cent',
    Math.abs(b.totalFeeUsd - (b.protocol.feeUsd + b.network.feeUsd + b.fbt.feeUsd)) < 1e-9 && b.complete === true);
  t('the FBT fee is charged on NOTIONAL and its share of collateral is stated',
    b.fbt.feeUsd === 0.5 && b.fbt.pctOfCollateral === 0.5);
  t('the breakdown carries policy, bps, recipient and when it is charged (ledger fields)',
    b.fbt.policyId === 'STANDARD' && b.fbt.bps === 5 && b.fbt.recipient && b.fbt.chargedOn === 'open');
  t('a valid breakdown passes validation', validateFeeBreakdown(b).ok);
  t('a tampered total is refused', !validateFeeBreakdown({ ...b, totalFeeUsd: b.totalFeeUsd + 1 }).ok);
  t('a hidden markup flag is refused', !validateFeeBreakdown({ ...b, hiddenMarkup: true }).ok);
  t('an out-of-range bps is refused', !validateFeeBreakdown({ ...b, fbt: { ...b.fbt, bps: 11, feeUsd: 1.1 } }).ok);
}
t('an unknown protocol fee makes the TOTAL null rather than a partial sum',
  (() => { const b = computeFeeBreakdown({ collateralUsd: 100, leverage: 10, protocolFeeBps: null, networkFeeUsd: 0.1 }); return b.totalFeeUsd === null && b.complete === false && b.fbt.feeUsd === 0.5; })());
t('an unknown network fee makes the TOTAL null too',
  computeFeeBreakdown({ collateralUsd: 100, leverage: 10, protocolFeeBps: 8, networkFeeUsd: null }).totalFeeUsd === null);
t('no breakdown for unusable inputs', computeFeeBreakdown({ collateralUsd: -5, leverage: 10 }) === null);

/* ── §8 risk engine ──────────────────────────────────────────────────────── */

t('Ostium liquidation model: 20x on a 100x pair liquidates at a 95% loss = 4.75% move',
  (() => { const l = liquidationDistance({ providerId: 'ostium', side: 'long', entryPrice: 100, leverage: 20, maxLeverage: 100 }); return l.lossPct === 95 && Math.abs(l.distancePct - 4.75) < 1e-9 && Math.abs(l.liquidationPrice - 95.25) < 1e-9 && l.model === 'ostium-docs'; })());
t('short liquidation price is above entry',
  liquidationDistance({ providerId: 'ostium', side: 'short', entryPrice: 100, leverage: 10, maxLeverage: 100 }).liquidationPrice > 100);
t('an unknown venue uses the full-collateral UPPER bound and says so',
  (() => { const l = liquidationDistance({ providerId: 'mystery', side: 'long', entryPrice: 100, leverage: 10 }); return l.lossPct === 100 && l.distancePct === 10 && l.model === 'full-collateral-upper-bound'; })());
{
  const r = assessFuturesRisk({ providerId: 'ostium', side: 'long', collateralUsd: 100, leverage: 5, maxLeverage: 100, entryPrice: 100, stopLoss: 95, availableBalanceUsd: 1000 });
  t('a modest, stopped, well-funded position is LOW risk and not blocked', r.riskLevel === RISK_LEVEL.LOW && r.blocked === false && r.warnings.length === 0);
  t('max recommended collateral is the risk budget share of the balance', r.maxRecommendedCollateralUsd === 250);
}
t('missing stop loss and unknown balance are warnings, not silent',
  (() => { const w = assessFuturesRisk({ providerId: 'ostium', side: 'long', collateralUsd: 100, leverage: 5, maxLeverage: 100, entryPrice: 100 }).warnings; return w.includes('NO_STOP_LOSS') && w.includes('BALANCE_UNKNOWN'); })());
t('leverage above product policy (50x) is BLOCKED',
  assessFuturesRisk({ providerId: 'ostium', side: 'long', collateralUsd: 100, leverage: 75, maxLeverage: 100, entryPrice: 100 }).blockReasons.includes('LEVERAGE_ABOVE_POLICY'));
t('leverage above the venue max is BLOCKED',
  assessFuturesRisk({ providerId: 'ostium', side: 'long', collateralUsd: 100, leverage: 20, maxLeverage: 10, entryPrice: 100 }).blockReasons.includes('LEVERAGE_ABOVE_VENUE_MAX'));
t('collateral above the wallet balance is BLOCKED (never a fake balance)',
  assessFuturesRisk({ providerId: 'ostium', side: 'long', collateralUsd: 100, leverage: 5, maxLeverage: 100, entryPrice: 100, availableBalanceUsd: 50 }).blockReasons.includes('INSUFFICIENT_BALANCE'));
t('a stop loss on the wrong side is BLOCKED',
  assessFuturesRisk({ providerId: 'ostium', side: 'long', collateralUsd: 100, leverage: 5, maxLeverage: 100, entryPrice: 100, stopLoss: 105 }).blockReasons.includes('STOP_LOSS_WRONG_SIDE'));
t('a take profit on the wrong side is BLOCKED',
  assessFuturesRisk({ providerId: 'ostium', side: 'short', collateralUsd: 100, leverage: 5, maxLeverage: 100, entryPrice: 100, takeProfit: 110 }).blockReasons.includes('TAKE_PROFIT_WRONG_SIDE'));
t('a closed market is BLOCKED',
  assessFuturesRisk({ providerId: 'ostium', side: 'long', collateralUsd: 100, leverage: 5, maxLeverage: 100, entryPrice: 100, isMarketOpen: false }).blockReasons.includes('MARKET_CLOSED'));
t('blocked positions report EXTREME regardless of score',
  assessFuturesRisk({ providerId: 'ostium', side: 'long', collateralUsd: 100, leverage: 2, maxLeverage: 100, entryPrice: 100, isMarketOpen: false }).riskLevel === RISK_LEVEL.EXTREME);
t('50x on a 50x pair is EXTREME: liquidation 1.5% away',
  (() => { const r = assessFuturesRisk({ providerId: 'ostium', side: 'long', collateralUsd: 100, leverage: 50, maxLeverage: 50, entryPrice: 100, availableBalanceUsd: 10000 }); return r.riskLevel === RISK_LEVEL.EXTREME && r.liquidationDistancePct === 1.5; })());
t('position health from a live mark: +2% move at 10x long = +20% PnL',
  (() => { const h = positionHealth({ providerId: 'ostium', side: 'long', entryPrice: 100, markPrice: 102, leverage: 10, maxLeverage: 100 }); return Math.abs(h.pnlPct - 20) < 1e-9 && h.distanceToLiquidationPct > 9; })());
t('position health returns nulls, not zeros, when the mark is unknown',
  positionHealth({ providerId: 'ostium', side: 'long', entryPrice: 100, markPrice: null, leverage: 10 }).pnlPct === null);

/* ── §6 router: execution quality only, never FBT revenue ────────────────── */

const caps = PROVIDER_CATALOGUE.ostium.capabilities;
const mk = (over) => ({ providerId: 'a', status: 'AVAILABLE', capabilities: caps, isMarketOpen: true, maxLeverage: 100, protocolFeeBps: 8, protocolFlatUsd: 0.1, networkFeeUsd: 0.05, spreadBps: 5, openInterestUsd: 1e7, fundingAprPct: 5, dataAgeMs: 1000, supportsMarket: true, ...over });
t('the cheaper venue for the USER wins',
  selectVenue([mk({ providerId: 'pricey', protocolFeeBps: 20 }), mk({ providerId: 'cheap', protocolFeeBps: 5 })], { notionalUsd: 1000, leverage: 10 }).providerId === 'cheap');
t('a READ_ONLY venue is rejected with its status as the reason',
  selectVenue([mk({ providerId: 'ro', status: 'READ_ONLY' })], { notionalUsd: 1000, leverage: 10 }).rejected[0].reason === 'STATUS_READ_ONLY');
t('a closed market is rejected', rejectReason(mk({ isMarketOpen: false }), {}) === 'MARKET_CLOSED');
t('a venue that cannot set TP is rejected when the order needs TP',
  rejectReason(mk({ capabilities: { ...caps, supportsTakeProfit: false } }), { needTp: true }) === 'NO_TAKE_PROFIT');
t('a venue without an execution path is rejected even if AVAILABLE',
  rejectReason(mk({ capabilities: PROVIDER_CATALOGUE.gmx.capabilities }), {}) === 'NO_EXECUTION_PATH');
t('no executable venue → ok:false with NO_EXECUTABLE_VENUE',
  selectVenue([mk({ status: 'UNAVAILABLE' })], { notionalUsd: 1000 }).reasons.includes('NO_EXECUTABLE_VENUE'));
t('the score function has no FBT-fee input at all (revenue cannot steer routing)',
  (() => { const a = scoreCandidate(mk({ fbtFeeBps: 0, fbtRevenueUsd: 0 }), { notionalUsd: 1000 }).score; const b = scoreCandidate(mk({ fbtFeeBps: 10, fbtRevenueUsd: 100 }), { notionalUsd: 1000 }).score; return a === b; })());
t('ranking is identical under every fee policy',
  (() => {
    /* y's 20 bps spread (10 bps half-spread) costs the user more than x's
       extra 6 bps of protocol fee, so the honest order is z > x > y. */
    const cands = [mk({ providerId: 'x', protocolFeeBps: 12 }), mk({ providerId: 'y', protocolFeeBps: 6, spreadBps: 20 }), mk({ providerId: 'z', protocolFeeBps: 6 })];
    const orders = Object.keys(FEE_POLICIES).map(() => selectVenue(cands, { notionalUsd: 5000, leverage: 5 }).ranked.map((r) => r.providerId).join('>'));
    return new Set(orders).size === 1 && orders[0] === 'z>x>y';
  })());
t('every routing decision explains itself',
  selectVenue([mk({})], { notionalUsd: 1000 }).reasons.length > 0);

/* ── §13 state machine ───────────────────────────────────────────────────── */

{
  const m = createFuturesTxMachine({ action: 'open' });
  const path = ['VALIDATING', 'QUOTING', 'RISK_CHECK', 'READY', 'SIMULATING', 'AWAITING_SIGNATURE', 'SIGNED', 'BROADCASTING', 'PENDING', 'CONFIRMED', 'VERIFYING', 'COMPLETED'];
  t('the happy path IDLE → … → COMPLETED is legal end to end', path.every((s) => m.transition(s).ok) && m.state() === 'COMPLETED');
  t('COMPLETED is final: no reset, no transitions', !m.reset().ok && FUTURES_TRANSITIONS.COMPLETED.length === 0);
}
{
  const m = createFuturesTxMachine();
  m.transition('VALIDATING'); m.transition('QUOTING'); m.transition('RISK_CHECK');
  t('a risk block goes to BLOCKED and can be reset once inputs change', m.transition('BLOCKED').ok && isTerminalFuturesState(m.state()) && m.reset().ok && m.state() === 'IDLE');
}
{
  const m = createFuturesTxMachine();
  ['VALIDATING', 'QUOTING', 'RISK_CHECK', 'READY', 'SIMULATING', 'AWAITING_SIGNATURE'].forEach((s) => m.transition(s));
  t('a wallet rejection is REJECTED (terminal), not retried into SIGNED', m.transition('REJECTED').ok && !m.can('SIGNED'));
}
t('PENDING → SIGNED is refused (illegal jump)',
  (() => { const m = createFuturesTxMachine(); ['VALIDATING', 'QUOTING', 'RISK_CHECK', 'READY', 'SIMULATING', 'AWAITING_SIGNATURE', 'SIGNED', 'BROADCASTING', 'PENDING'].forEach((s) => m.transition(s)); return m.transition('SIGNED').reason === 'ILLEGAL_TRANSITION'; })());
t('a timed-out pending tx recovers through VERIFYING, never through re-signing',
  FUTURES_TRANSITIONS.TIMEOUT.includes('VERIFYING') && !FUTURES_TRANSITIONS.TIMEOUT.includes('AWAITING_SIGNATURE'));
t('the progress checklist keys are i18n keys, not English prose',
  createFuturesTxMachine().progress().every((s) => /^futures\.progress\./.test(s.labelKey)));

/* ── §23 errors ──────────────────────────────────────────────────────────── */

t('every error code carries retryable + recovery + security flags',
  Object.values(FUTURES_ERRORS).every((e) => typeof e.retryable === 'boolean' && typeof e.recovery === 'string' && typeof e.security === 'boolean'));
t('wallet code 4001 → USER_REJECTED, never retryable', mapFuturesError({ code: 4001, message: 'User rejected the request.' }).code === 'USER_REJECTED' && !FUTURES_ERRORS.USER_REJECTED.retryable);
t('insufficient funds for gas → NO_GAS', mapFuturesError(new Error('insufficient funds for gas * price + value')).code === 'NO_GAS');
t('a revert with hex payload is TRANSACTION_REVERTED and the hex is stripped',
  (() => { const m = mapFuturesError(new Error('execution reverted: 0x08c379a000000000')); return m.code === 'TRANSACTION_REVERTED' && !/0x08c3/.test(String(m.rawSanitized || '')); })());
t('an engine code passes through unchanged', mapFuturesError({ code: 'MARKET_CLOSED' }).code === 'MARKET_CLOSED');
t('CONTRACT_MISMATCH and PROVIDER_BLOCKED are security stops', isFuturesSecurityStop('CONTRACT_MISMATCH') && isFuturesSecurityStop('PROVIDER_BLOCKED') && !isFuturesSecurityStop('TIMEOUT'));

/* ── §16 ids / idempotency ───────────────────────────────────────────────── */

t('the same order yields the same idempotency key; a different size a different one',
  (() => {
    const a = makeFuturesIdempotencyKey({ action: 'open', wallet: '0xAbC', providerId: 'ostium', marketId: '0', side: 'long', collateralUsd: 100, leverage: 10 });
    const b = makeFuturesIdempotencyKey({ action: 'open', wallet: '0xabc', providerId: 'ostium', marketId: '0', side: 'long', collateralUsd: 100, leverage: 10 });
    const c = makeFuturesIdempotencyKey({ action: 'open', wallet: '0xabc', providerId: 'ostium', marketId: '0', side: 'long', collateralUsd: 101, leverage: 10 });
    return a === b && a !== c && isValidIdempotencyKey(a);
  })());
t('request ids are unique and prefixed', (() => { const a = makeFuturesRequestId(); const b = makeFuturesRequestId(); return a !== b && a.startsWith('fut_req_'); })());
t('a malformed idempotency key is refused', !isValidIdempotencyKey('short') && !isValidIdempotencyKey('has spaces in it 1234'));

/* ── §15 events ──────────────────────────────────────────────────────────── */

t('the FUTURES_* vocabulary covers the lifecycle the spec names',
  ['FUTURES_MARKET_SELECTED', 'FUTURES_QUOTE_UPDATED', 'FUTURES_ORDER_PREPARED', 'FUTURES_ORDER_CONFIRMED', 'FUTURES_POSITION_OPENED', 'FUTURES_POSITION_CLOSED', 'FUTURES_TP_SL_UPDATED', 'FUTURES_FEE_RECORDED', 'FUTURES_PROVIDER_HEALTH_CHANGED'].every(isFuturesEvent)
  && FUTURES_EVENTS.every((e) => e.startsWith('FUTURES_')));

/* ── server Ostium encoder pinned to the SDK golden vectors ──────────────── */
/*
 * The BFF hand-encodes openTrade/approve with ethers, mirroring
 * src/lib/ostium.js. Both must produce the SDK's exact bytes: a drift here is
 * a signed transaction that reverts — or pays the builder fee to nobody.
 */
{
  const { readFileSync } = await import('node:fs');
  const golden = JSON.parse(readFileSync(new URL('./ostium-golden.json', import.meta.url), 'utf8'));
  const srv = await import('../server/futures/adapters/ostium.js');
  for (const c of golden.openTrade) {
    const built = srv.buildOpenTrade({
      trader: c.trader, pairId: c.pairId, buy: c.buy, price: c.price, collateralUsd: c.collateralUsd, leverage: c.leverage,
      takeProfit: c.takeProfit ?? '0', stopLoss: c.stopLoss ?? '0', isDayTrade: c.isDayTrade ?? false, slippageBps: c.slippageBps ?? 25,
      builder: golden.builder, builderFeeBps: c.bps
    });
    t(`server openTrade calldata matches the SDK — ${c.n}`, built.data.toLowerCase() === c.data && built.to.toLowerCase() === c.to.toLowerCase() && built.chainId === 42161);
  }
  const approve = srv.buildApprove({ amountUsd: golden.approve.amountUsd });
  t('server approve calldata matches the SDK (spender = TradingStorage, exact amount)', approve.data.toLowerCase() === golden.approve.data && approve.to.toLowerCase() === golden.approve.to.toLowerCase());
  t('server builders refuse a collateral below the venue minimum before encoding',
    (() => { try { srv.buildOpenTrade({ trader: golden.openTrade[0].trader, pairId: 0, buy: true, price: '1', collateralUsd: '4.99', leverage: '2', builder: golden.builder, builderFeeBps: 5 }); return false; } catch (e) { return e.code === 'BELOW_MIN'; } })());
  t('server builders refuse an invalid builder address as CONTRACT_MISMATCH',
    (() => { try { srv.buildOpenTrade({ trader: golden.openTrade[0].trader, pairId: 0, buy: true, price: '1', collateralUsd: '10', leverage: '2', builder: '0xnope', builderFeeBps: 5 }); return false; } catch (e) { return e.code === 'CONTRACT_MISMATCH'; } })());
  t('every server-built target is on the allowlist',
    [srv.buildCloseTrade({ pairId: 0, index: 0, closePercent: 50, price: '100' }), srv.buildUpdateTp({ pairId: 0, index: 0, takeProfit: 110 }), srv.buildUpdateSl({ pairId: 0, index: 0, stopLoss: 90 }), srv.buildUpdateCollateral({ pairId: 0, index: 0, amountUsd: 10 }), approve]
      .every((tx) => srv.OSTIUM_ALLOWED_TARGETS.includes(tx.to.toLowerCase())));
  t('fee bps → contract units is ×10,000 (10 bps = 100000), the factor-of-100 trap', srv.feeBpsToContractUnits(10) === 100_000 && srv.feeBpsToContractUnits(5) === 50_000 && srv.feeBpsToContractUnits(0) === 0);
}
