/**
 * INTENT RECEIPT OUTPUT EXTRACTION PROBE
 * ---------------------------------------------------------------------------
 * Locks the honesty contract of predicted-vs-actual:
 *   · Transfer logs to the recipient of the output token are summed
 *   · Transfers to someone else, or from another contract, are ignored
 *   · Native output comes from WETH Withdrawal, never a balance delta
 *   · Missing / malformed logs return null — never 0, never the prediction
 *   · Observation payloads stay bucketed and never carry an address or amount
 *   · An old Execution Proof v1 still verifies
 */

import {
  ERC20_TRANSFER_TOPIC,
  WETH_WITHDRAWAL_TOPIC,
  WRAPPED_NATIVE,
  extractActualOutput,
  outputDeltaBps
} from '../src/lib/intentReceipt.js';
import { buildIntentObservation, containsSensitiveValue } from '../src/lib/intentObservation.js';
import {
  EXECUTION_PROOF_SCHEMA,
  createExecutionProof,
  verifyExecutionProof
} from '../src/lib/executionProof.js';

function mockLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear()
  };
}

const padAddr = (addr) => `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`;
const weiHex = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;

const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const OTHER = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const STRANGER = '0x2222222222222222222222222222222222222222';
const SENDER = '0x3333333333333333333333333333333333333333';

const usdc = { symbol: 'USDC', address: TOKEN, decimals: 6, native: false };
const eth = { symbol: 'ETH', address: null, decimals: 18, native: true };

function transfer({ token = TOKEN, to = RECIPIENT, amount, from = SENDER }) {
  return {
    address: token,
    topics: [ERC20_TRANSFER_TOPIC, padAddr(from), padAddr(to)],
    data: weiHex(amount)
  };
}

function withdrawal({ wrapped, amount }) {
  return {
    address: wrapped,
    topics: [WETH_WITHDRAWAL_TOPIC, padAddr(SENDER)],
    data: weiHex(amount)
  };
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  mockLocalStorage();
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import('node:crypto');
    globalThis.crypto = webcrypto;
  }

  /* ---------------------- 1. simple ERC-20 transfer ---------------------- */
  {
    const out = extractActualOutput({
      logs: [transfer({ amount: 1_000_000n })],
      toToken: usdc,
      recipient: RECIPIENT,
      chainId: 1
    });
    t('a single Transfer to the recipient is extracted', out.actualOutputWei === '1000000');
    t('the source is erc20-transfer-log', out.source === 'erc20-transfer-log');
    t('transfersCounted is 1', out.transfersCounted === 1);
    t('reason is null on success', out.reason === null);
  }

  /* ---------------------- 2. multi-hop: sum transfers -------------------- */
  {
    const out = extractActualOutput({
      logs: [
        transfer({ amount: 400_000n }),
        transfer({ amount: 600_000n })
      ],
      toToken: usdc,
      recipient: RECIPIENT,
      chainId: 1
    });
    t('multiple Transfers to the recipient are summed', out.actualOutputWei === '1000000');
    t('both transfers are counted', out.transfersCounted === 2);
  }

  /* ---------------------- 3. other recipient ignored --------------------- */
  {
    const out = extractActualOutput({
      logs: [
        transfer({ amount: 1_000_000n, to: STRANGER }),
        transfer({ amount: 50_000n })
      ],
      toToken: usdc,
      recipient: RECIPIENT,
      chainId: 1
    });
    t('a Transfer to someone else is not counted', out.actualOutputWei === '50000' && out.transfersCounted === 1);
  }

  /* ---------------------- 4. other token ignored ------------------------- */
  {
    const out = extractActualOutput({
      logs: [
        transfer({ token: OTHER, amount: 9_999_999n }),
        transfer({ amount: 42n })
      ],
      toToken: usdc,
      recipient: RECIPIENT,
      chainId: 1
    });
    t('a Transfer from another token contract is ignored', out.actualOutputWei === '42');
  }

  /* ---------------------- 5. fee-on-transfer (negative delta) ------------ */
  {
    const predicted = '1000000';
    const actual = '970000';
    const extracted = extractActualOutput({
      logs: [transfer({ amount: 970_000n })],
      toToken: usdc,
      recipient: RECIPIENT,
      chainId: 1
    });
    const delta = outputDeltaBps(predicted, extracted.actualOutputWei);
    t('fee-on-transfer records the smaller actual', extracted.actualOutputWei === actual);
    t('outputDeltaBps is negative when actual < predicted', delta === -300);
    t('the prediction is never substituted', extracted.actualOutputWei !== predicted);
  }

  /* ---------------------- 6. native via WETH Withdrawal ------------------ */
  {
    const wrapped = WRAPPED_NATIVE[1];
    const out = extractActualOutput({
      logs: [withdrawal({ wrapped, amount: 123456789n })],
      toToken: eth,
      recipient: RECIPIENT,
      chainId: 1
    });
    t('native output is taken from the Withdrawal log', out.actualOutputWei === '123456789');
    t('the source is weth-withdrawal-log', out.source === 'weth-withdrawal-log');
  }

  /* ---------------------- 7. empty logs → null, not zero ----------------- */
  {
    const out = extractActualOutput({
      logs: [],
      toToken: usdc,
      recipient: RECIPIENT,
      chainId: 1
    });
    t('a receipt without logs returns null, not zero', out.actualOutputWei === null && out.source === null);
    t('the empty-log reason is NO_LOGS', out.reason === 'NO_LOGS');
    t('outputDeltaBps stays null when actual is missing', outputDeltaBps('100', null) === null);
  }

  /* ---------------------- 8. malformed logs never throw ------------------ */
  {
    let threw = false;
    let out;
    try {
      out = extractActualOutput({
        logs: [
          { address: TOKEN, topics: [ERC20_TRANSFER_TOPIC], data: '0x' },
          { address: TOKEN, topics: null, data: null },
          'not-a-log',
          { address: TOKEN, topics: [ERC20_TRANSFER_TOPIC, padAddr(SENDER)], data: '0xzz' }
        ],
        toToken: usdc,
        recipient: RECIPIENT,
        chainId: 1
      });
    } catch {
      threw = true;
    }
    t('malformed logs do not throw', threw === false);
    t('malformed logs return null', out?.actualOutputWei === null && out?.source === null);
    t('the malformed reason is a code', out?.reason === 'MALFORMED_LOG' || out?.reason === 'NO_MATCHING_TRANSFER');
  }

  /* ---------------------- 9. address comparison is case-insensitive ------ */
  {
    const out = extractActualOutput({
      logs: [{
        address: TOKEN.toUpperCase(),
        topics: [ERC20_TRANSFER_TOPIC, padAddr(SENDER), padAddr(RECIPIENT.toUpperCase())],
        data: weiHex(7n)
      }],
      toToken: { ...usdc, address: TOKEN.toLowerCase() },
      recipient: RECIPIENT.toUpperCase(),
      chainId: 1
    });
    t('address comparison is case-insensitive', out.actualOutputWei === '7');
  }

  /* ---------------------- 10. observation never carries raw amounts ------ */
  {
    const extracted = extractActualOutput({
      logs: [transfer({ amount: 1_000_000n })],
      toToken: usdc,
      recipient: RECIPIENT,
      chainId: 42161
    });
    const delta = outputDeltaBps('1000000', extracted.actualOutputWei);
    const obs = buildIntentObservation({
      intentKind: 'swap',
      chainId: 42161,
      routePolicy: 'MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2',
      solver: 'kyberswap',
      quoteCount: 2,
      hopCount: 1,
      simulationStatus: 'passed',
      outputErrorBps: delta,
      outcome: 'completed',
      failureCode: 'NONE',
      policyVersion: 'fbt.intent-lifecycle-policy.v1'
    });
    t('observation buckets the output error', obs.outputErrorBpsBucket === 'lte10');
    t('observation has no raw output field', !('actualOutput' in obs) && !('outputErrorBps' in obs));
    t('observation contains no address or amount', containsSensitiveValue(obs) === false);
    t('the observation JSON does not include the recipient or token',
      !JSON.stringify(obs).includes(RECIPIENT) && !JSON.stringify(obs).includes(TOKEN.slice(2)));
  }

  /* ---------------------- 11. Execution Proof v1 still verifies ---------- */
  {
    const quote = {
      amountOutWei: '1000000',
      amountOut: 1,
      source: 'kyberswap',
      selectedSolver: 'kyberswap',
      feeBps: 70,
      slippage: 0.5,
      minOut: 0.99,
      executionTrace: {
        observedAt: '2026-01-01T00:00:00.000Z',
        selectionPolicy: 'MAX_OUTPUT_EXECUTABLE_SAME_FEE_AND_SLIPPAGE',
        coverage: { requested: 1, answered: 1, usable: 1 },
        candidates: [{
          solver: 'kyberswap',
          status: 'quoted',
          executable: true,
          amountOutWei: '1000000',
          amountOut: 1,
          feeBps: 70,
          slippage: 0.5
        }]
      }
    };
    const v1 = await createExecutionProof({
      txHash: `0x${'ab'.repeat(32)}`,
      chainId: 42161,
      fromToken: { symbol: 'ETH', native: true },
      toToken: usdc,
      amountIn: '1',
      quote,
      receipt: { status: 1, blockNumber: 1, gasUsed: 21000n },
      deadlineMinutes: 20,
      createdAt: 1
    });
    const checked = await verifyExecutionProof(v1);
    t('a v1 proof is still produced when executionCore is omitted', v1.schema === EXECUTION_PROOF_SCHEMA);
    t('an old Execution Proof v1 still verifies', checked.ok === true && checked.code === 'DIGEST_MATCH');

    const v2 = await createExecutionProof({
      txHash: `0x${'cd'.repeat(32)}`,
      chainId: 42161,
      fromToken: { symbol: 'ETH', native: true },
      toToken: usdc,
      amountIn: '1',
      quote,
      receipt: { status: 1, blockNumber: 1, gasUsed: 21000n },
      deadlineMinutes: 20,
      createdAt: 2,
      executionCore: {
        actualOutput: '970000',
        actualOutputSource: 'erc20-transfer-log',
        predictedOutput: '1000000',
        outputDeltaBps: -300,
        lifecycleFinalStatus: 'COMPLETED',
        routeFingerprint: 'route-aaaa',
        quoteFingerprint: 'quote-bbbb'
      }
    });
    t('v2 records the extracted actual output', v2.payload.executionCore.settlement.actualOutput === '970000');
    t('v2 records the log source', v2.payload.executionCore.settlement.actualOutputSource === 'erc20-transfer-log');
    t('v2 records a negative output delta', v2.payload.executionCore.settlement.outputDeltaBps === -300);
    t('claimLimits.outputProvenFromReceipt is true when actual exists',
      v2.payload.executionCore.claimLimits.outputProvenFromReceipt === true);
    t('v2 still verifies', (await verifyExecutionProof(v2)).ok === true);

    const emptyCore = await createExecutionProof({
      txHash: `0x${'ef'.repeat(32)}`,
      chainId: 42161,
      fromToken: { symbol: 'ETH', native: true },
      toToken: usdc,
      amountIn: '1',
      quote,
      receipt: { status: 1, blockNumber: 1, gasUsed: 21000n },
      deadlineMinutes: 20,
      createdAt: 3,
      executionCore: {
        actualOutput: null,
        predictedOutput: '1000000',
        outputDeltaBps: null,
        lifecycleFinalStatus: 'COMPLETED',
        routeFingerprint: 'route-aaaa',
        quoteFingerprint: 'quote-bbbb'
      }
    });
    t('a failed extraction leaves actualOutput null in the proof',
      emptyCore.payload.executionCore.settlement.actualOutput === null);
    t('outputProvenFromReceipt stays false without a receipt amount',
      emptyCore.payload.executionCore.claimLimits.outputProvenFromReceipt === false);
  }

  return rows;
}
