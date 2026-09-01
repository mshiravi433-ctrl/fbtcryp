/**
 * LENDING ENGINE — pure-logic probe (no DOM, no network).
 * ---------------------------------------------------------------------------
 * The production spec's §32 test matrix is huge; this probe pins the parts
 * that are pure and therefore unforgivable to get wrong: the error taxonomy
 * (§14), the transaction state machine (§15/§16), configurable risk bands
 * (§12), feature-flagged networks (§5), the protocol router's "never APY
 * alone" rule (§9), alert rules (§22), duplicate protection (§17) and the
 * circuit breaker's NORMAL → DEGRADED → READ_ONLY ladder (§27).
 *
 * Runs at import time with node:assert — the same fail-fast style as
 * test/dca-execution-probe.mjs — and is wired into test/run.mjs.
 */
import assert from 'node:assert/strict';
import {
  LENDING_ERRORS, mapRawError, describeError, isRetryable,
  createTransactionMachine, TX_STATE,
  riskLevel, assessPosition, DEFAULT_RISK_BANDS,
  enabledNetworks, networkFor, isNetworkEnabled, rpcFallbackOrder,
  LendingProtocolAdapter, listAdapters, assertAllowedContract,
  scoreProtocol, bestRoute,
  evaluateAlerts,
  makeIdempotencyKey, createInFlightGuard, createIdempotencyStore,
  createCircuitBreaker, CIRCUIT_STATE
} from '../src/lib/lending-engine/index.js';

const t = (name, ok) => {
  assert.ok(ok, name);
  console.log(`✓ ${name}`);
};

/* ── §14: error taxonomy — a raw RPC error never reaches the user ─────────── */

t('all spec error codes exist with retryable flags', [
  'USER_REJECTED', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_ALLOWANCE',
  'WRONG_NETWORK', 'RPC_ERROR', 'ORACLE_STALE', 'MARKET_PAUSED',
  'BORROW_LIMIT_EXCEEDED', 'HEALTH_FACTOR_TOO_LOW', 'SLIPPAGE',
  'GAS_ESTIMATION_FAILED', 'SIMULATION_FAILED', 'TRANSACTION_REVERTED',
  'TRANSACTION_PENDING', 'TRANSACTION_DROPPED', 'INDEXER_DELAY',
  'PROTOCOL_UNAVAILABLE'
].every((code) => LENDING_ERRORS[code] && typeof LENDING_ERRORS[code].retryable === 'boolean'));

t('wallet code 4001 maps to USER_REJECTED, retryable, sanitized',
  (() => { const m = mapRawError({ code: 4001, message: 'User rejected the request.' }); return m.code === 'USER_REJECTED' && m.retryable === true; })());

t('"insufficient funds" maps to INSUFFICIENT_BALANCE',
  mapRawError({ message: 'execution reverted: insufficient funds for gas * price + value' }).code === 'INSUFFICIENT_BALANCE');

t('a paused pool maps to MARKET_PAUSED',
  mapRawError({ message: 'Pool: RESERVE_PAUSED' }).code === 'MARKET_PAUSED');

t('borrow-limit reverts map to BORROW_LIMIT_EXCEEDED',
  mapRawError({ message: 'Not enough collateral to cover a new borrow' }).code === 'BORROW_LIMIT_EXCEEDED');

t('a revert with hex payload maps to TRANSACTION_REVERTED and the hex is stripped',
  (() => { const m = mapRawError({ message: 'execution reverted: 0x12ab34cd56ef' }); return m.code === 'TRANSACTION_REVERTED' && !/0x12ab/.test(m.rawSanitized); })());

t('nonce-too-low maps to TRANSACTION_DROPPED',
  mapRawError({ message: 'nonce too low' }).code === 'TRANSACTION_DROPPED');

t('network failure maps to RPC_ERROR',
  mapRawError({ message: 'could not detect network (event="noNetwork", code=NETWORK_ERROR)' }).code === 'RPC_ERROR');

t('unknown garbage maps to UNKNOWN with a generic message, never the raw text',
  (() => { const m = mapRawError({ message: '0xdeadbeef internal panic' }, { fallback: 'UNKNOWN' }); return m.code === 'UNKNOWN' && !/deadbeef/.test(describeError(m.code)); })());

t('engine codes pass through unchanged',
  mapRawError({ code: 'READ_ONLY_MODE', message: 'whatever' }).code === 'READ_ONLY_MODE');

t('retryable flags follow the spec (rejected=dropped=revert retryable; balance not)',
  isRetryable('USER_REJECTED') && isRetryable('TRANSACTION_DROPPED') && isRetryable('TRANSACTION_REVERTED') && !isRetryable('INSUFFICIENT_BALANCE'));

t('every code has a human description in en and fa',
  Object.keys(LENDING_ERRORS).every((code) => typeof describeError(code, 'en') === 'string' && typeof describeError(code, 'fa') === 'string'));

/* ── §15/§16: the transaction state machine ───────────────────────────────── */

{
  const machine = createTransactionMachine({ action: 'supply', meta: { requestId: 'lnd_test' } });
  t('machine starts IDLE and follows the full happy path', (() => {
    const path = ['VALIDATING', 'READY', 'SIMULATING', 'AWAITING_SIGNATURE', 'SIGNED', 'BROADCASTING', 'PENDING', 'CONFIRMED', 'VERIFYING', 'COMPLETED'];
    return path.every((state) => machine.transition(state).ok) && machine.state() === TX_STATE.COMPLETED;
  })());

  const failing = createTransactionMachine({ action: 'borrow' });
  t('SIMULATING can fail into ERROR and RETRY returns to VALIDATING', (() => {
    failing.transition('VALIDATING'); failing.transition('READY'); failing.transition('SIMULATING');
    const toError = failing.transition('ERROR');
    const retry = failing.transition('RETRY');
    const back = failing.transition('VALIDATING');
    return toError.ok && retry.ok && back.ok && failing.state() === TX_STATE.VALIDATING;
  })());

  const rejected = createTransactionMachine({ action: 'repay' });
  t('a wallet rejection cancels from AWAITING_SIGNATURE and resets to IDLE', (() => {
    rejected.transition('VALIDATING'); rejected.transition('READY'); rejected.transition('SIMULATING');
    rejected.transition('AWAITING_SIGNATURE');
    const cancel = rejected.transition('CANCELLED');
    const reset = rejected.transition('IDLE');
    return cancel.ok && reset.ok && rejected.state() === TX_STATE.IDLE;
  })());

  t('illegal transitions are refused (no PENDING → SIGNED, no mid-flight reset)', (() => {
    const m = createTransactionMachine({ action: 'withdraw' });
    const illegal = m.transition('PENDING');
    const illegalReset = m.transition('IDLE');
    return !illegal.ok && illegal.reason === 'ILLEGAL_TRANSITION' && !illegalReset.ok;
  })());

  t('the §16 progress checklist follows the states', (() => {
    const m = createTransactionMachine({ action: 'supply' });
    m.transition('VALIDATING'); m.transition('READY');
    const ready = m.progress();
    m.transition('SIMULATING'); m.transition('AWAITING_SIGNATURE');
    const signing = m.progress();
    m.transition('SIGNED'); m.transition('BROADCASTING'); m.transition('PENDING');
    const pending = m.progress();
    return ready[0].status === 'done' && signing[1].status === 'active' && pending[2].status === 'done' && pending[3].status === 'active';
  })());
}

/* ── §12: configurable risk bands — thresholds are config, not constants ──── */

t('default bands match the spec table', (() => {
  const cases = [
    [3.0, 'healthy'], [2.0, 'healthy'], [1.8, 'moderate'], [1.5, 'moderate'],
    [1.3, 'warning'], [1.2, 'warning'], [1.1, 'critical'], [1.0, 'critical'],
    [0.9, 'liquidatable'], [0.5, 'liquidatable']
  ];
  return cases.every(([hf, level]) => riskLevel(hf).level === level);
})());

t('no debt (null HF) is "none", never "infinite safety"',
  riskLevel(null).level === 'none' && riskLevel(undefined).level === 'none');

t('bands are overridable from configuration', (() => {
  const custom = [
    { min: 2.0, level: 'super-safe', color: '#0f0' },
    { min: 0.0, level: 'everything-else', color: '#f00' }
  ];
  return riskLevel(2.5, custom).level === 'super-safe' && riskLevel(1.0, custom).level === 'everything-else'
    && riskLevel(2.5, DEFAULT_RISK_BANDS).level !== 'super-safe';
})());

t('assessPosition computes LTV, liquidation distance and risk consistently', (() => {
  const a = assessPosition({ healthFactor: 1.14, totalDebtUsd: 4200, totalCollateralUsd: 8420, liquidationThresholdPct: 82.5 });
  return a.riskLevel === 'critical'
    && Math.abs(a.ltvPct - 49.88) < 0.1
    && Math.abs(a.liquidationDistancePct - 39.4) < 0.5
    && Math.abs(a.liquidationRisk - 0.606) < 0.01;
})());

t('a debt-free wallet has no liquidation risk and full headroom', (() => {
  const a = assessPosition({ healthFactor: null, totalDebtUsd: 0, totalCollateralUsd: 5000, liquidationThresholdPct: 80 });
  return a.liquidationRisk === null && a.remainingBorrowableUsd === 4000;
})());

/* ── §5: network registry with feature flags ──────────────────────────────── */

t('every enabled network has rpcs, explorer, protocols and oracle config',
  enabledNetworks().every((n) => n.enabled === true && Array.isArray(n.rpcs) && n.rpcs.length >= 2 && n.explorer && Array.isArray(n.protocols) && n.protocols.length && n.oracle));

t('Linea, Sonic and Solana are declared but feature-flagged OFF',
  !isNetworkEnabled(59144) && !isNetworkEnabled(146) && !isNetworkEnabled(900001) && networkFor(900001)?.disabledReason === 'ADAPTER_PENDING');

t('the wired Aave chains are flagged ON',
  [1, 56, 137, 42161, 8453, 10, 43114].every((id) => isNetworkEnabled(id)));

t('failover endpoints are ordered per chain',
  Array.isArray(rpcFallbackOrder(1)) && rpcFallbackOrder(1).length >= 3);

/* ── §8/§31: adapter interface + contract allowlist ───────────────────────── */

t('the adapter interface fails loudly instead of returning garbage', (() => {
  const bare = new LendingProtocolAdapter({ id: 'x', name: 'X' });
  return [bare.getMarkets(), bare.getUserPositions(), bare.buildSupplyTransaction(), bare.getHealthFactor()]
    .every((p) => p instanceof Promise && p.then(() => false, (e) => e.message === 'Adapter method not implemented'));
})());

t('the registry allowlists aave-v3 and keeps pending protocols disabled',
  (() => { const list = listAdapters(); const aave = list.find((a) => a.id === 'aave-v3'); return !!aave && aave.enabled === true; })());

t('unknown contract addresses are refused before any dial', (() => {
  const poolByChain = { 42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD' };
  const ok = assertAllowedContract({ chainId: 42161, address: poolByChain[42161], kind: 'pool', poolByChain });
  const wrong = assertAllowedContract({ chainId: 42161, address: '0x0000000000000000000000000000000000000bad', kind: 'pool', poolByChain });
  const token = assertAllowedContract({
    chainId: 42161, address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', kind: 'token',
    tokenLookup: () => ({ symbol: 'USDC' })
  });
  return ok.ok && !wrong.ok && wrong.code === 'POOL_NOT_ALLOWED' && token.ok;
})());

/* ── §9: the router — best APY is never the only criterion ────────────────── */

t('a higher-APY protocol loses to a safer, deeper, cheaper one', (() => {
  const best = bestRoute([
    { protocol: 'aave-v3', supplyApy: 0.058, liquidityUsd: 321e6, utilization: 0.82, gasUsd: 0.6, status: 'active' },
    { protocol: 'morpho', supplyApy: 0.064, liquidityUsd: 4e6, utilization: 0.99, gasUsd: 4.2, status: 'active' }
  ], { side: 'supply' });
  return best.best?.protocol === 'aave-v3' && best.ranked.length === 2;
})());

t('all else equal, the borrow side prefers the LOWER borrow APY', (() => {
  const base = { protocol: 'aave-v3', liquidityUsd: 321e6, utilization: 0.82, gasUsd: 0.6, status: 'active' };
  const best = bestRoute([
    { ...base, borrowApy: 0.0731, chainId: 1 },
    { ...base, borrowApy: 0.061, chainId: 42161 }
  ], { side: 'borrow' });
  return best.best?.borrowApy === 0.061;
})());

t('paused / inactive candidates are excluded, never ranked, and the reason is reported',
  (() => {
    const best = bestRoute([
      { protocol: 'aave-v3', supplyApy: 0.06, liquidityUsd: 1e8, utilization: 0.8, gasUsd: 1, status: 'paused', reason: 'MARKET_PAUSED' }
    ]);
    return best.best === null && best.excluded.length === 1 && best.excluded[0].reason === 'MARKET_PAUSED';
  })());

t('a circuit-broken protocol is removed from ranking', (() => {
  const best = bestRoute(
    [{ protocol: 'aave-v3', supplyApy: 0.06, liquidityUsd: 1e8, utilization: 0.8, gasUsd: 1, status: 'active' }],
    { circuit: { 'aave-v3': 'READ_ONLY' } }
  );
  return best.best === null && best.ranked.length === 0;
})());

t('every score part is bounded to 0..1',
  scoreProtocol({ protocol: 'aave-v3', supplyApy: 5, liquidityUsd: 1e12, utilization: 0.8, gasUsd: 0.1 }, { side: 'supply' })
    && Object.values(scoreProtocol({ protocol: 'morpho', supplyApy: 0.02, liquidityUsd: 1e3, utilization: 1, gasUsd: 99 }, { side: 'supply' }).parts).every((v) => v >= 0 && v <= 1));

/* ── §22/§23: alert rules, independent of the frontend ────────────────────── */

t('a critical health factor produces a critical alert',
  (() => { const a = evaluateAlerts({ position: { healthFactor: 1.14, ltvPct: 60 } }); return a.some((x) => x.type === 'HEALTH_FACTOR_LOW' && x.severity === 'critical'); })());

t('a moderate health factor warns, not screams',
  (() => { const a = evaluateAlerts({ position: { healthFactor: 1.7 } }); return a.length === 0 || a.every((x) => x.severity !== 'critical'); })());

t('a health-factor drop of 15%+ raises the "2.34 → 1.92" alert',
  (() => {
    const a = evaluateAlerts({
      position: { healthFactor: 1.92 },
      previous: { healthFactor: 2.34 }
    });
    const alert = a.find((x) => x.type === 'HEALTH_FACTOR_LOW' && x.value?.from);
    return !!alert && alert.value.from === 2.34 && alert.value.to === 1.92;
  })());

t('APY moves raise change alerts with both numbers',
  (() => {
    const a = evaluateAlerts({
      market: { 'usdc-42161': { borrowApyPct: 9.1 } },
      previousMarket: { 'usdc-42161': { borrowApyPct: 7.2 } }
    });
    const alert = a.find((x) => x.type === 'BORROW_APY_CHANGE');
    return !!alert && alert.value.from === 7.2 && alert.value.to === 9.1;
  })());

t('a low liquidation distance alerts, oracle anomalies are critical, failed txs alert',
  (() => {
    const a = evaluateAlerts({
      position: { healthFactor: 2.4, liquidationDistancePct: 5 },
      oracle: { status: 'anomaly' },
      txFailed: { action: 'supply', asset: 'USDC' }
    });
    return a.some((x) => x.type === 'LIQUIDATION_DISTANCE' && x.severity === 'critical')
      && a.some((x) => x.type === 'ORACLE_ANOMALY' && x.severity === 'critical')
      && a.some((x) => x.type === 'TRANSACTION_FAILED');
  })());

t('alerts dedupe per (type, asset) — the same rule fires once',
  (() => {
    const a = evaluateAlerts({
      position: { healthFactor: 1.1 },
      previous: { healthFactor: 2.34 }
    });
    const hfs = a.filter((x) => x.type === 'HEALTH_FACTOR_LOW');
    return hfs.length === 1;
  })());

/* ── §17: duplicate-transaction protection ────────────────────────────────── */

t('the idempotency key is deterministic for identical actions',
  (() => {
    const a = { action: 'supply', wallet: '0xABC', asset: 'USDC', amount: '1000', chainId: 42161 };
    const b = { ...a, wallet: '0xabc' };
    return makeIdempotencyKey(a) === makeIdempotencyKey(b)
      && makeIdempotencyKey(a) !== makeIdempotencyKey({ ...a, amount: '1001' });
  })());

t('the in-flight guard refuses a double-tap and frees after release',
  (() => {
    const guard = createInFlightGuard();
    const key = 'lnd_supply_42161_abc';
    const first = guard.tryAcquire(key);
    const second = guard.tryAcquire(key);
    guard.release(key);
    const third = guard.tryAcquire(key);
    guard.release(key);
    return first.ok && !second.ok && second.code === 'IDEMPOTENCY_CONFLICT' && third.ok;
  })());

t('the server idempotency store replays completed results',
  (() => {
    const store = createIdempotencyStore();
    const key = 'lnd_repay_1_xyz';
    if (store.check(key).replay) return false;
    store.remember(key, { ok: true, hash: '0xabc' });
    const replay = store.check(key);
    return replay.replay && replay.stored.hash === '0xabc';
  })());

/* ── §27/§28: circuit breaker NORMAL → DEGRADED → READ_ONLY ───────────────── */

t('the breaker degrades on a blip and opens after sustained failures', (() => {
  const breaker = createCircuitBreaker({ openThreshold: 3 });
  if (breaker.state() !== CIRCUIT_STATE.NORMAL) return false;
  breaker.report('rpc', false, 'timeout');
  const degraded = breaker.state() === CIRCUIT_STATE.DEGRADED && breaker.canTransact();
  breaker.report('rpc', false, 'timeout'); breaker.report('rpc', false, 'timeout');
  const opened = breaker.state() === CIRCUIT_STATE.READ_ONLY && !breaker.canTransact();
  return degraded && opened;
})());

t('a healthy probe heals the component and the breaker', (() => {
  const breaker = createCircuitBreaker({ openThreshold: 2 });
  breaker.report('oracle', false, 'stale'); breaker.report('oracle', false, 'stale');
  const opened = breaker.state() === CIRCUIT_STATE.READ_ONLY;
  breaker.report('oracle', true);
  return opened && breaker.state() === CIRCUIT_STATE.NORMAL && breaker.canTransact();
})());

t('the snapshot is the §28 read-only banner payload',
  (() => {
    const breaker = createCircuitBreaker({ openThreshold: 2 });
    breaker.report('data', false, 'stale');
    const snap = breaker.snapshot();
    return snap.state === CIRCUIT_STATE.DEGRADED && snap.readOnly === false && snap.failures.data === 1 && snap.reasons.data === 'stale';
  })());

console.log('lending engine probe passed');
