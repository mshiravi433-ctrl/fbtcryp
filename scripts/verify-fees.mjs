#!/usr/bin/env node
/**
 * FEE ROUTING VERIFIER
 * ---------------------------------------------------------------------------
 * Answers, with live evidence rather than assurances: "will the platform fee
 * actually be encoded into a transaction that can be signed on this chain?"
 *
 * A successful probe verifies ALL of the following:
 *   1. the fee recipient resolves to a valid address for the chain family;
 *   2. the chain RPC returns its expected chain id and a real block number;
 *   3. KyberSwap returns a non-empty route for the exact candidate pair;
 *   4. routeSummary.extraFee exactly echoes bps, recipient, charge side and
 *      isInBps mode requested by the app;
 *   5. /route/build returns non-empty calldata for THAT unmodified summary,
 *      a real router address, and the expected native transaction value.
 *
 * It never signs, broadcasts, approves, or sends user funds.  Route building
 * is deliberately requested with excludeRFQSources=true so this release gate
 * does not reserve a maker quote without an execution intent.
 *
 * Usage:
 *   node scripts/verify-fees.mjs
 *   node scripts/verify-fees.mjs --chain 999 --strict
 *   node scripts/verify-fees.mjs --chain 999 --strict --evidence artifacts/fee-route.json
 *
 * Any unavailable upstream, non-200 response, malformed response, no route,
 * missing/mismatched fee echo, failed build, or malformed chain selection is a
 * FAILURE (non-zero exit status).  This is a release gate, not a best-effort
 * diagnostic: a green result must mean something.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILY, PAYOUT_DIRECTORY, isValidFor, resolvePayout } from '../src/lib/payout.js';
import { FEE_BPS } from '../src/lib/feeBps.js';
import {
  EVM_NATIVE_SENTINEL,
  HYPEREVM_CHAIN_ID,
  HYPEREVM_CORE_TRANSFER_ADDRESS,
  HYPEREVM_KYBER_SLUG,
  HYPEREVM_NATIVE,
  HYPEREVM_RPC,
  HYPEREVM_USDC
} from '../src/lib/hyperevm.js';

const AGG = 'https://aggregator-api.kyberswap.com';
const CLIENT_ID = 'fbt-swap';
const CHARGE_FEE_BY = 'currency_in';
const TIMEOUT_MS = 20_000;
const PROBE_RECIPIENT = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]+$/;
const INTEGER_RE = /^\d+$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const normal = (value) => String(value ?? '').trim().toLowerCase();

/**
 * One independently reviewed output asset per active EVM network.  `999` is
 * intentionally present even before the network is in the public picker: this
 * is the isolated candidate probe that must pass before activation.
 */
export const ROUTE_PROBES = Object.freeze({
  1: Object.freeze({ slug: 'ethereum', rpc: 'https://eth.llamarpc.com', tokenOut: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }),
  10: Object.freeze({ slug: 'optimism', rpc: 'https://mainnet.optimism.io', tokenOut: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' }),
  56: Object.freeze({ slug: 'bsc', rpc: 'https://bsc-rpc.publicnode.com', tokenOut: '0x55d398326f99059fF775485246999027B3197955' }),
  137: Object.freeze({ slug: 'polygon', rpc: 'https://polygon-rpc.com', tokenOut: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }),
  146: Object.freeze({ slug: 'sonic', rpc: 'https://rpc.soniclabs.com', tokenOut: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894' }),
  5000: Object.freeze({ slug: 'mantle', rpc: 'https://rpc.mantle.xyz', tokenOut: '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9' }),
  8453: Object.freeze({ slug: 'base', rpc: 'https://mainnet.base.org', tokenOut: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }),
  43114: Object.freeze({ slug: 'avalanche', rpc: 'https://api.avax.network/ext/bc/C/rpc', tokenOut: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7' }),
  59144: Object.freeze({ slug: 'linea', rpc: 'https://rpc.linea.build', tokenOut: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff' }),
  80094: Object.freeze({ slug: 'berachain', rpc: 'https://rpc.berachain.com', tokenOut: '0x6969696969696969696969696969696969696969' }),
  130: Object.freeze({ slug: 'unichain', rpc: 'https://mainnet.unichain.org', tokenOut: '0x4200000000000000000000000000000000000006' }),
  143: Object.freeze({ slug: 'monad', rpc: 'https://rpc.monad.xyz', tokenOut: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A' }),
  [HYPEREVM_CHAIN_ID]: Object.freeze({
    label: 'HyperEVM',
    gas: HYPEREVM_NATIVE.symbol,
    slug: HYPEREVM_KYBER_SLUG,
    rpc: HYPEREVM_RPC,
    tokenIn: EVM_NATIVE_SENTINEL,
    tokenOut: HYPEREVM_USDC,
    amountIn: (10n ** BigInt(HYPEREVM_NATIVE.decimals)).toString()
  })
});

export class FeeRouteVerificationError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FeeRouteVerificationError';
    this.code = code;
    this.detail = detail;
  }
}

const fail = (code, detail = '') => {
  throw new FeeRouteVerificationError(code, detail);
};

const assert = (condition, code, detail = '') => {
  if (!condition) fail(code, detail);
};

const asPositiveInteger = (value) => {
  const text = String(value ?? '');
  if (!INTEGER_RE.test(text)) return null;
  try {
    const n = BigInt(text);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
};

const addressIsUsable = (address) =>
  ADDRESS_RE.test(String(address || '')) &&
  normal(address) !== ZERO_ADDRESS &&
  normal(address) !== normal(HYPEREVM_CORE_TRANSFER_ADDRESS);

function expectedRpc(chainId, probe) {
  return probe.rpc || null;
}

/** Parse a response as JSON and turn every upstream failure into a hard gate failure. */
async function fetchJson(fetchImpl, url, options, step) {
  let res;
  try {
    res = await fetchImpl(url, options);
  } catch (error) {
    fail(`${step}_UNREACHABLE`, String(error?.message || error).slice(0, 180));
  }

  assert(res && typeof res.ok === 'boolean', `${step}_MALFORMED_RESPONSE`);
  if (!res.ok) fail(`${step}_HTTP_${Number(res.status) || 0}`);

  let text;
  try {
    text = await res.text();
  } catch (error) {
    fail(`${step}_BODY_UNREADABLE`, String(error?.message || error).slice(0, 180));
  }

  try {
    return JSON.parse(text);
  } catch {
    fail(`${step}_MALFORMED_JSON`, String(text || '').slice(0, 180));
  }
}

async function rpcCall({ fetchImpl, rpc, method, id }) {
  const body = await fetchJson(
    fetchImpl,
    rpc,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: [] }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    },
    'RPC'
  );
  if (body?.error) fail('RPC_ERROR', `${body.error.code ?? ''} ${body.error.message ?? ''}`.trim());
  assert(typeof body?.result === 'string', 'RPC_MALFORMED_RESULT');
  return body.result;
}

/** Validate the immutable fee-bearing route before it is posted to /route/build. */
export function validateRouteSummary({ body, probe, recipient, feeBps = FEE_BPS }) {
  assert(Number(body?.code) === 0, 'ROUTE_API_ERROR', String(body?.message ?? 'missing success code'));
  const summary = body?.data?.routeSummary;
  assert(summary && typeof summary === 'object', 'ROUTE_SUMMARY_MISSING');

  const tokenIn = probe.tokenIn || EVM_NATIVE_SENTINEL;
  const amountIn = String(probe.amountIn || 10n ** 18n);
  assert(normal(summary.tokenIn) === normal(tokenIn), 'ROUTE_TOKEN_IN_MISMATCH', String(summary.tokenIn ?? ''));
  assert(normal(summary.tokenOut) === normal(probe.tokenOut), 'ROUTE_TOKEN_OUT_MISMATCH', String(summary.tokenOut ?? ''));
  assert(String(summary.amountIn) === amountIn, 'ROUTE_AMOUNT_IN_MISMATCH', String(summary.amountIn ?? ''));
  assert(asPositiveInteger(summary.amountOut) != null, 'ROUTE_AMOUNT_OUT_INVALID', String(summary.amountOut ?? ''));
  assert(Array.isArray(summary.route) && summary.route.length > 0, 'ROUTE_PATH_MISSING');
  assert(addressIsUsable(body?.data?.routerAddress), 'ROUTE_ROUTER_INVALID', String(body?.data?.routerAddress ?? ''));

  const fee = summary.extraFee;
  assert(fee && typeof fee === 'object', 'FEE_ECHO_MISSING');
  assert(String(fee.feeAmount) === String(feeBps), 'FEE_AMOUNT_MISMATCH', String(fee.feeAmount ?? ''));
  assert(normal(fee.feeReceiver) === normal(recipient), 'FEE_RECIPIENT_MISMATCH', String(fee.feeReceiver ?? ''));
  assert(fee.chargeFeeBy === CHARGE_FEE_BY, 'FEE_CHARGE_SIDE_MISMATCH', String(fee.chargeFeeBy ?? ''));
  assert(fee.isInBps === true, 'FEE_BPS_MODE_MISMATCH', String(fee.isInBps));

  return { summary, routerAddress: body.data.routerAddress, fee, amountIn };
}

/** Validate that route-building preserved the native payment semantics. */
export function validateBuiltTransaction({ body, route, tokenIn = EVM_NATIVE_SENTINEL }) {
  assert(Number(body?.code) === 0, 'BUILD_API_ERROR', String(body?.message ?? 'missing success code'));
  const built = body?.data;
  assert(built && typeof built === 'object', 'BUILD_DATA_MISSING');
  assert(typeof built.data === 'string' && HEX_RE.test(built.data) && built.data.length > 10, 'BUILD_CALLDATA_INVALID');
  assert(addressIsUsable(built.routerAddress), 'BUILD_ROUTER_INVALID', String(built.routerAddress ?? ''));
  assert(normal(built.routerAddress) === normal(route.routerAddress), 'BUILD_ROUTER_MISMATCH');
  assert(asPositiveInteger(built.amountOut) != null, 'BUILD_AMOUNT_OUT_INVALID', String(built.amountOut ?? ''));

  if (normal(tokenIn) === normal(EVM_NATIVE_SENTINEL)) {
    assert(String(built.transactionValue) === String(route.amountIn), 'BUILD_NATIVE_VALUE_MISMATCH', String(built.transactionValue ?? ''));
  }

  return built;
}

/**
 * Execute one fully fail-closed probe.  `fetchImpl` is injectable so the
 * validator is unit-testable without a network or an actual quote request.
 */
export async function verifyRouteProbe({
  chainId,
  label,
  gas,
  family = FAMILY.EVM,
  recipient,
  probe = ROUTE_PROBES[Number(chainId)],
  fetchImpl = globalThis.fetch,
  now = Date.now()
} = {}) {
  const cid = Number(chainId);
  assert(probe && typeof probe === 'object', 'PROBE_NOT_CONFIGURED', String(chainId));
  assert(family === FAMILY.EVM, 'CHAIN_NOT_EVM', String(family));
  assert(isValidFor(family, recipient), 'PAYOUT_INVALID', String(recipient ?? ''));
  assert(addressIsUsable(recipient), 'PAYOUT_UNSAFE', String(recipient ?? ''));
  assert(typeof fetchImpl === 'function', 'FETCH_UNAVAILABLE');

  const rpc = expectedRpc(cid, probe);
  assert(/^https:\/\//.test(String(rpc || '')), 'RPC_NOT_CONFIGURED', String(rpc ?? ''));

  const chainHex = await rpcCall({ fetchImpl, rpc, method: 'eth_chainId', id: 1 });
  assert(Number.parseInt(chainHex, 16) === cid, 'RPC_CHAIN_ID_MISMATCH', String(chainHex));
  const blockHex = await rpcCall({ fetchImpl, rpc, method: 'eth_blockNumber', id: 2 });
  assert(/^0x[0-9a-f]+$/i.test(blockHex) && BigInt(blockHex) > 0n, 'RPC_BLOCK_INVALID', String(blockHex));

  const tokenIn = probe.tokenIn || EVM_NATIVE_SENTINEL;
  const amountIn = String(probe.amountIn || 10n ** 18n);
  const params = new URLSearchParams({
    tokenIn,
    tokenOut: probe.tokenOut,
    amountIn,
    gasInclude: 'true',
    // A release gate does not consume an RFQ for an execution it will not make.
    excludeRFQSources: 'true',
    feeAmount: String(FEE_BPS),
    isInBps: 'true',
    chargeFeeBy: CHARGE_FEE_BY,
    feeReceiver: recipient
  });

  const routeBody = await fetchJson(
    fetchImpl,
    `${AGG}/${probe.slug}/api/v1/routes?${params.toString()}`,
    {
      headers: { 'x-client-id': CLIENT_ID, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    },
    'ROUTE'
  );
  const route = validateRouteSummary({ body: routeBody, probe: { ...probe, tokenIn, amountIn }, recipient });

  // This address is public and receives no transaction in the probe.  It gives
  // Kyber a syntactically valid sender/recipient for calldata generation.
  const buildPayload = {
    routeSummary: route.summary,
    sender: PROBE_RECIPIENT,
    recipient: PROBE_RECIPIENT,
    slippageTolerance: 50,
    deadline: Math.floor(now / 1000) + 20 * 60,
    source: CLIENT_ID
  };
  const buildBody = await fetchJson(
    fetchImpl,
    `${AGG}/${probe.slug}/api/v1/route/build`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': CLIENT_ID,
        accept: 'application/json'
      },
      body: JSON.stringify(buildPayload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    },
    'BUILD'
  );
  const built = validateBuiltTransaction({ body: buildBody, route, tokenIn });

  const expectedFeeWei = (BigInt(amountIn) * BigInt(FEE_BPS)) / 10_000n;
  return {
    schema: 'fbt.fee-route-evidence.v1',
    checkedAt: new Date(now).toISOString(),
    chainId: cid,
    label: label || probe.label || String(cid),
    family,
    gas: gas || probe.gas || null,
    rpc: { url: rpc, chainId: chainHex, blockNumber: blockHex },
    pair: {
      tokenIn,
      tokenOut: probe.tokenOut,
      amountIn,
      nativeInput: normal(tokenIn) === normal(EVM_NATIVE_SENTINEL)
    },
    fee: {
      requestedBps: FEE_BPS,
      expectedRawAmount: expectedFeeWei.toString(),
      receiver: recipient,
      chargeFeeBy: CHARGE_FEE_BY,
      isInBps: true,
      echoed: {
        feeAmount: String(route.fee.feeAmount),
        feeReceiver: route.fee.feeReceiver,
        chargeFeeBy: route.fee.chargeFeeBy,
        isInBps: route.fee.isInBps
      }
    },
    route: {
      routerAddress: route.routerAddress,
      amountOut: String(route.summary.amountOut),
      routeId: route.summary.routeID ?? null,
      checksum: route.summary.checksum ?? null,
      paths: route.summary.route.length
    },
    build: {
      routerAddress: built.routerAddress,
      calldataBytes: (built.data.length - 2) / 2,
      transactionValue: String(built.transactionValue ?? '0'),
      amountOut: String(built.amountOut)
    }
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const valueAfter = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1] ?? null;
  };
  return {
    chain: valueAfter('--chain'),
    strict: argv.includes('--strict'),
    evidencePath: valueAfter('--evidence')
  };
}

function rowsForChain(chainValue) {
  if (chainValue == null) {
    return PAYOUT_DIRECTORY.filter((row) => row.family === FAMILY.EVM);
  }
  if (!/^\d+$/.test(String(chainValue))) return null;
  const chainId = Number(chainValue);
  const probe = ROUTE_PROBES[chainId];
  if (!probe) return null;
  return [
    PAYOUT_DIRECTORY.find((row) => Number(row.chainId) === chainId) || {
      id: `candidate-${chainId}`,
      chainId,
      family: FAMILY.EVM,
      label: probe.label || `chain ${chainId}`,
      gas: probe.gas || null
    }
  ];
}

const ok = (message) => `\x1b[32m✓\x1b[0m ${message}`;
const bad = (message) => `\x1b[31m✗\x1b[0m ${message}`;

function logSuccess(evidence) {
  console.log(ok(`RPC healthy: ${evidence.rpc.chainId}, block ${evidence.rpc.blockNumber}`));
  console.log(ok(`route: ${evidence.pair.tokenIn} → ${evidence.pair.tokenOut}, ${evidence.route.paths} path(s)`));
  console.log(ok(`fee echo: ${evidence.fee.echoed.feeAmount} bps · ${evidence.fee.echoed.chargeFeeBy} · ${evidence.fee.echoed.feeReceiver}`));
  console.log(ok(`build: ${evidence.build.calldataBytes} bytes calldata · native value ${evidence.build.transactionValue}`));
}

/** Run the CLI program; exported for harnesses and CI tests. */
export async function main(argv = process.argv.slice(2), { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const args = parseArgs(argv);
  const rows = rowsForChain(args.chain);
  const report = {
    schema: 'fbt.fee-route-verification-report.v1',
    checkedAt: new Date(now).toISOString(),
    strict: Boolean(args.strict),
    feeBps: FEE_BPS,
    results: []
  };

  console.log('FEE ROUTING VERIFICATION (fail closed)');
  console.log(`Platform fee: ${FEE_BPS} bps (${FEE_BPS / 100}%), charged on the INPUT token.`);

  if (!rows?.length) {
    const error = { chainId: args.chain ?? null, ok: false, error: 'CHAIN_OR_PROBE_NOT_CONFIGURED' };
    report.results.push(error);
    console.log(bad(`chain selection is invalid or has no verified route probe: ${args.chain ?? '(none)'}`));
  } else {
    for (const row of rows) {
      const chainId = Number(row.chainId);
      const probe = ROUTE_PROBES[chainId];
      console.log(`\n── ${row.label} (${chainId}) ──────────────────────────────`);

      if (!probe) {
        const error = { chainId, label: row.label, ok: false, error: 'PROBE_NOT_CONFIGURED' };
        report.results.push(error);
        console.log(bad('no route probe is configured for this active EVM network'));
        continue;
      }

      const resolved = resolvePayout(chainId, row.family);
      if (!resolved) {
        const error = { chainId, label: row.label, ok: false, error: 'PAYOUT_MISSING' };
        report.results.push(error);
        console.log(bad('no payout address resolves for this network — fees would be lost'));
        continue;
      }

      try {
        const evidence = await verifyRouteProbe({
          chainId,
          label: row.label,
          gas: row.gas,
          family: row.family,
          recipient: resolved.address,
          probe,
          fetchImpl,
          now
        });
        report.results.push({ chainId, label: row.label, ok: true, evidence });
        logSuccess(evidence);
      } catch (error) {
        const code = error instanceof FeeRouteVerificationError ? error.code : 'UNEXPECTED_ERROR';
        const detail = String(error?.detail || error?.message || error).slice(0, 220);
        report.results.push({ chainId, label: row.label, ok: false, error: code, detail });
        console.log(bad(`${code}${detail && detail !== code ? ` — ${detail}` : ''}`));
      }
    }
  }

  report.failures = report.results.filter((result) => !result.ok).length;
  report.ok = report.failures === 0;

  if (args.evidencePath) {
    const output = resolve(args.evidencePath);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\nEvidence written to ${args.evidencePath}`);
  }

  console.log(
    report.ok
      ? '\n\x1b[32mAll selected route probes passed.\x1b[0m\n'
      : `\n\x1b[31m${report.failures} route probe(s) FAILED — do not activate or ship those swaps.\x1b[0m\n`
  );
  return report.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
