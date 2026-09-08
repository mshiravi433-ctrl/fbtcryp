#!/usr/bin/env node
/**
 * HyperEVM launch gate regression probe.
 *
 * This never contacts a live endpoint. It drives the fail-closed verifier with
 * synthetic HTTP responses, proving that a green CI result cannot be produced
 * by a network error, malformed body, missing fee echo, wrong fee mode, or a
 * route/build whose native transaction value is wrong.
 */

import assert from 'node:assert/strict';
import { FEE_BPS } from '../src/lib/feeBps.js';
import {
  EVM_NATIVE_SENTINEL,
  HYPEREVM_CHAIN_ID,
  HYPEREVM_CORE_TRANSFER_ADDRESS,
  HYPEREVM_NATIVE,
  HYPEREVM_USDC,
  HYPEREVM_WHYPE,
  assertRecipientAllowedOnChain,
  assertTokenAllowedOnChain,
  isHyperEvmAllowedToken,
  remoteTokenListsAllowed,
  tokenImportAllowed
} from '../src/lib/hyperevm.js';
import {
  ROUTE_PROBES,
  main,
  validateBuiltTransaction,
  validateRouteSummary,
  verifyRouteProbe
} from '../scripts/verify-fees.mjs';

const RECIPIENT = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
const ROUTER = '0x1111111111111111111111111111111111111111';
const AMOUNT_IN = '1000000000000000000';
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0);
let failed = false;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  process.stdout.write(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok) failed = true;
}

function routeBody(overrides = {}) {
  const summary = {
    tokenIn: EVM_NATIVE_SENTINEL,
    tokenOut: HYPEREVM_USDC.toLowerCase(),
    amountIn: AMOUNT_IN,
    amountOut: '987654321',
    route: [[{ pool: '0x3333333333333333333333333333333333333333' }]],
    routeID: 'route-999',
    checksum: 'checksum-999',
    extraFee: {
      feeAmount: String(FEE_BPS),
      feeReceiver: RECIPIENT,
      chargeFeeBy: 'currency_in',
      isInBps: true
    }
  };
  const data = { routeSummary: summary, routerAddress: ROUTER };
  return {
    code: 0,
    message: 'successfully',
    data: { ...data, ...overrides.data, routeSummary: { ...summary, ...overrides.summary } },
    ...overrides.top
  };
}

function buildBody(overrides = {}) {
  return {
    code: 0,
    message: 'successfully',
    data: {
      amountOut: '987654321',
      data: '0x1234567890',
      routerAddress: ROUTER,
      transactionValue: AMOUNT_IN,
      ...overrides
    }
  };
}

function response(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function expectCode(name, fn, code) {
  try {
    await fn();
    check(name, false, 'did not reject');
  } catch (error) {
    check(name, error?.code === code || String(error?.message).startsWith(code), String(error?.code || error?.message));
  }
}

const calls = [];
const goodFetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  if (String(url) === ROUTE_PROBES[999].rpc) {
    const request = JSON.parse(options.body);
    if (request.method === 'eth_chainId') return response({ jsonrpc: '2.0', id: 1, result: '0x3e7' });
    if (request.method === 'eth_blockNumber') return response({ jsonrpc: '2.0', id: 2, result: '0x12345' });
  }
  if (String(url).includes('/routes?')) {
    const parsed = new URL(url);
    check('probe sends native HYPE sentinel', parsed.searchParams.get('tokenIn') === EVM_NATIVE_SENTINEL);
    check('probe sends canonical HyperEVM USDC', parsed.searchParams.get('tokenOut') === HYPEREVM_USDC);
    check('probe asks exact configured fee bps', parsed.searchParams.get('feeAmount') === String(FEE_BPS));
    check('probe asks input-currency fee', parsed.searchParams.get('chargeFeeBy') === 'currency_in');
    check('probe excludes RFQ for non-executing verification', parsed.searchParams.get('excludeRFQSources') === 'true');
    return response(routeBody());
  }
  if (String(url).endsWith('/route/build')) {
    const payload = JSON.parse(options.body);
    check('route build posts the fee-bearing route unchanged', payload.routeSummary?.extraFee?.feeAmount === String(FEE_BPS));
    check('route build has a valid no-broadcast recipient', payload.sender === RECIPIENT && payload.recipient === RECIPIENT);
    return response(buildBody());
  }
  throw new Error(`unexpected URL ${url}`);
};

// ── Initial HyperEVM asset and recipient policy ────────────────────────────
check('HyperEVM native HYPE is accepted', isHyperEvmAllowedToken({ ...HYPEREVM_NATIVE, native: true }));
check('canonical WHYPE is accepted', isHyperEvmAllowedToken({ symbol: 'WHYPE', address: HYPEREVM_WHYPE, decimals: 18 }));
check('native Circle USDC is accepted', isHyperEvmAllowedToken({ symbol: 'USDC', address: HYPEREVM_USDC, decimals: 6 }));
check('a same-symbol counterfeit is rejected', !isHyperEvmAllowedToken({ symbol: 'USDC', address: '0x4444444444444444444444444444444444444444', decimals: 6 }));
check('0x2222 system endpoint is never an allowed token', !isHyperEvmAllowedToken({ symbol: 'HYPE', address: HYPEREVM_CORE_TRANSFER_ADDRESS, decimals: 18 }));
check('HyperEVM remote token lists are disabled', remoteTokenListsAllowed(HYPEREVM_CHAIN_ID) === false);
check('HyperEVM arbitrary token imports are disabled', tokenImportAllowed(HYPEREVM_CHAIN_ID) === false);
check('ordinary EVM imports remain available', tokenImportAllowed(1) === true);
await expectCode('HyperEVM system recipient is hard-blocked', () => assertRecipientAllowedOnChain(999, HYPEREVM_CORE_TRANSFER_ADDRESS), 'HYPEREVM_CORE_TRANSFER_ADDRESS_BLOCKED');
await expectCode('unreviewed HyperEVM token is hard-blocked', () => assertTokenAllowedOnChain(999, { symbol: 'FAKE', address: '0x4444444444444444444444444444444444444444', decimals: 18 }), 'HYPEREVM_TOKEN_NOT_ALLOWLISTED');

// ── Strict route/build validation ──────────────────────────────────────────
const route = validateRouteSummary({ body: routeBody(), probe: ROUTE_PROBES[999], recipient: RECIPIENT });
check('well-formed exact fee echo is accepted', route.fee.feeAmount === String(FEE_BPS));
validateBuiltTransaction({ body: buildBody(), route });
check('well-formed native build is accepted', true);

await expectCode('missing extraFee fails closed', () => validateRouteSummary({
  body: routeBody({ summary: { extraFee: null } }), probe: ROUTE_PROBES[999], recipient: RECIPIENT
}), 'FEE_ECHO_MISSING');
await expectCode('wrong fee bps fails closed', () => validateRouteSummary({
  body: routeBody({ summary: { extraFee: { feeAmount: '69', feeReceiver: RECIPIENT, chargeFeeBy: 'currency_in', isInBps: true } } }),
  probe: ROUTE_PROBES[999], recipient: RECIPIENT
}), 'FEE_AMOUNT_MISMATCH');
await expectCode('wrong fee receiver fails closed', () => validateRouteSummary({
  body: routeBody({ summary: { extraFee: { feeAmount: String(FEE_BPS), feeReceiver: ROUTER, chargeFeeBy: 'currency_in', isInBps: true } } }),
  probe: ROUTE_PROBES[999], recipient: RECIPIENT
}), 'FEE_RECIPIENT_MISMATCH');
await expectCode('wrong fee currency side fails closed', () => validateRouteSummary({
  body: routeBody({ summary: { extraFee: { feeAmount: String(FEE_BPS), feeReceiver: RECIPIENT, chargeFeeBy: 'currency_out', isInBps: true } } }),
  probe: ROUTE_PROBES[999], recipient: RECIPIENT
}), 'FEE_CHARGE_SIDE_MISMATCH');
await expectCode('wrong bps mode fails closed', () => validateRouteSummary({
  body: routeBody({ summary: { extraFee: { feeAmount: String(FEE_BPS), feeReceiver: RECIPIENT, chargeFeeBy: 'currency_in', isInBps: false } } }),
  probe: ROUTE_PROBES[999], recipient: RECIPIENT
}), 'FEE_BPS_MODE_MISMATCH');
await expectCode('wrong native transaction value fails closed', () => validateBuiltTransaction({
  body: buildBody({ transactionValue: '1' }), route
}), 'BUILD_NATIVE_VALUE_MISMATCH');

const evidence = await verifyRouteProbe({
  chainId: 999,
  label: 'HyperEVM',
  gas: 'HYPE',
  recipient: RECIPIENT,
  fetchImpl: goodFetch,
  now: NOW
});
check('full HyperEVM probe passes only after RPC + route + build', evidence.chainId === 999 && evidence.fee.echoed.feeAmount === String(FEE_BPS) && evidence.build.transactionValue === AMOUNT_IN);
check('full probe made RPC, route, and build calls', calls.length === 4);

await expectCode('unreachable route endpoint fails closed', () => verifyRouteProbe({
  chainId: 999,
  recipient: RECIPIENT,
  fetchImpl: async (url, options) => {
    if (String(url) === ROUTE_PROBES[999].rpc) return goodFetch(url, options);
    throw new TypeError('network unreachable');
  },
  now: NOW
}), 'ROUTE_UNREACHABLE');

await expectCode('malformed route JSON fails closed', () => verifyRouteProbe({
  chainId: 999,
  recipient: RECIPIENT,
  fetchImpl: async (url, options) => {
    if (String(url) === ROUTE_PROBES[999].rpc) return goodFetch(url, options);
    return response('{not json');
  },
  now: NOW
}), 'ROUTE_MALFORMED_JSON');

// The CLI must translate a failed probe into a non-zero result, not merely log a warning.
const realLog = console.log;
console.log = () => {};
try {
  const goodExit = await main(['--chain', '999', '--strict'], { fetchImpl: goodFetch, now: NOW });
  const badExit = await main(['--chain', '999', '--strict'], {
    fetchImpl: async () => { throw new TypeError('offline'); },
    now: NOW
  });
  check('CLI returns zero only for a complete strict proof', goodExit === 0);
  check('CLI returns non-zero for unavailable upstream', badExit === 1);
} finally {
  console.log = realLog;
}

if (failed) process.exitCode = 1;
