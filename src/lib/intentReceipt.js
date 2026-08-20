/**
 * ACTUAL OUTPUT FROM RECEIPT — fbt.intent-receipt.v1
 * ---------------------------------------------------------------------------
 * Pure log parsing. No React, no ethers, no network. The predicted quote is
 * NEVER substituted for a missing actual: if the logs cannot prove what the
 * recipient received, this module returns null.
 *
 * Native output is taken from the wrapped-native Withdrawal event, never from
 * a balance delta (gas would contaminate that number).
 */

export const INTENT_RECEIPT_SCHEMA = 'fbt.intent-receipt.v1';

/** keccak256("Transfer(address,address,uint256)") */
export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** keccak256("Withdrawal(address,uint256)") — WETH / wrapped native */
export const WETH_WITHDRAWAL_TOPIC =
  '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';

/**
 * Wrapped-native contracts for the EVM chains this app swaps on.
 * Duplicated here so this module stays free of chains.js / ethers.
 */
export const WRAPPED_NATIVE = Object.freeze({
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  10: '0x4200000000000000000000000000000000000006',
  56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  146: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
  8453: '0x4200000000000000000000000000000000000006',
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  43114: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  59144: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f'
});

const fail = (reason, transfersCounted = 0) => ({
  actualOutputWei: null,
  source: null,
  transfersCounted,
  reason
});

const ok = (wei, source, transfersCounted) => ({
  actualOutputWei: wei.toString(),
  source,
  transfersCounted,
  reason: null
});

function normHex(value) {
  if (value == null) return '';
  const s = String(value).trim().toLowerCase();
  return s.startsWith('0x') ? s : `0x${s}`;
}

function isAddress(value) {
  return /^0x[a-f0-9]{40}$/.test(normHex(value));
}

function topicAddress(topic) {
  const hex = normHex(topic);
  if (!/^0x[a-f0-9]{64}$/.test(hex)) return null;
  return `0x${hex.slice(26)}`;
}

function uint256(data) {
  const hex = normHex(data).replace(/^0x/, '');
  if (!hex || hex.length > 64 || /[^a-f0-9]/.test(hex)) return null;
  try {
    return BigInt(`0x${hex || '0'}`);
  } catch {
    return null;
  }
}

function asLogs(logs) {
  if (!logs) return [];
  if (Array.isArray(logs)) return logs;
  return [];
}

/**
 * ((actual - predicted) / predicted) * 10000, integer, signed.
 * Null when either side is missing or predicted is zero. Never invents 0.
 */
export function outputDeltaBps(predictedWei, actualWei) {
  if (predictedWei == null || actualWei == null) return null;
  let predicted;
  let actual;
  try {
    predicted = BigInt(String(predictedWei));
    actual = BigInt(String(actualWei));
  } catch {
    return null;
  }
  if (predicted === 0n) return null;
  return Number(((actual - predicted) * 10000n) / predicted);
}

export function extractActualOutput({
  logs,
  toToken = null,
  recipient = null,
  chainId = null
} = {}) {
  try {
    const rows = asLogs(logs);
    if (!rows.length) return fail('NO_LOGS');
    if (!toToken || typeof toToken !== 'object') return fail('MISSING_TOKEN');

    const native = Boolean(toToken.native);
    if (native) {
      const wrapped = WRAPPED_NATIVE[Number(chainId)];
      if (!wrapped) return fail('UNKNOWN_WRAPPED_NATIVE');
      return sumWithdrawals(rows, wrapped);
    }

    if (!isAddress(toToken.address)) return fail('MISSING_TOKEN');
    if (!isAddress(recipient)) return fail('MISSING_RECIPIENT');
    return sumTransfers(rows, toToken.address, recipient);
  } catch {
    return fail('MALFORMED_LOG');
  }
}

function sumTransfers(logs, tokenAddress, recipient) {
  const token = normHex(tokenAddress);
  const to = normHex(recipient);
  let total = 0n;
  let counted = 0;
  let malformed = false;

  for (const log of logs) {
    if (!log || typeof log !== 'object') {
      malformed = true;
      continue;
    }
    const topics = Array.isArray(log.topics) ? log.topics : [];
    if (!topics.length) {
      malformed = true;
      continue;
    }
    if (normHex(topics[0]) !== ERC20_TRANSFER_TOPIC) continue;
    if (normHex(log.address) !== token) continue;
    if (topics.length < 3) {
      malformed = true;
      continue;
    }
    const dest = topicAddress(topics[2]);
    if (!dest) {
      malformed = true;
      continue;
    }
    if (dest !== to) continue;
    const amount = uint256(log.data);
    if (amount == null) {
      malformed = true;
      continue;
    }
    total += amount;
    counted += 1;
  }

  if (counted === 0) return fail(malformed ? 'MALFORMED_LOG' : 'NO_MATCHING_TRANSFER', 0);
  return ok(total, 'erc20-transfer-log', counted);
}

function sumWithdrawals(logs, wrappedAddress) {
  const wrapped = normHex(wrappedAddress);
  let total = 0n;
  let counted = 0;
  let malformed = false;

  for (const log of logs) {
    if (!log || typeof log !== 'object') {
      malformed = true;
      continue;
    }
    const topics = Array.isArray(log.topics) ? log.topics : [];
    if (!topics.length) {
      malformed = true;
      continue;
    }
    if (normHex(topics[0]) !== WETH_WITHDRAWAL_TOPIC) continue;
    if (normHex(log.address) !== wrapped) continue;
    const amount = uint256(log.data);
    if (amount == null) {
      malformed = true;
      continue;
    }
    total += amount;
    counted += 1;
  }

  if (counted === 0) return fail(malformed ? 'MALFORMED_LOG' : 'NO_MATCHING_WITHDRAWAL', 0);
  return ok(total, 'weth-withdrawal-log', counted);
}
