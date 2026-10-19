import { Interface, isAddress } from 'ethers';
import { VAULT_EVENT_ABI, QUEUE_EVENT_ABI } from './abi.js';
import { COLLECTIVE_MAX_EVENT_SPAN } from './config.js';

const vaultInterface = new Interface(VAULT_EVENT_ABI);
const queueInterface = new Interface(QUEUE_EVENT_ABI);

const safeInteger = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

function serializeArgs(fragment, args) {
  const output = {};
  fragment.inputs.forEach((input, index) => {
    const value = args[index];
    output[input.name || String(index)] = typeof value === 'bigint' ? value.toString() : String(value);
  });
  return output;
}

function parseLog(log, iface, source) {
  try {
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) return null;
    return {
      source,
      event: parsed.name,
      blockNumber: Number(log.blockNumber),
      transactionIndex: Number(log.transactionIndex),
      logIndex: Number(log.index ?? log.logIndex ?? 0),
      transactionHash: log.transactionHash,
      address: log.address,
      args: serializeArgs(parsed.fragment, parsed.args)
    };
  } catch {
    // Unknown/future events are ignored rather than mislabelled.
    return null;
  }
}

/**
 * Bounded, chain-derived event indexing. It never accepts arbitrary RPC URLs,
 * and its block-range cap keeps a public history request from becoming an
 * unbounded provider scan. The index is reconstructible from on-chain logs.
 */
export async function scanVaultEvents(provider, {
  vaultAddress,
  queueAddress,
  fromBlock,
  toBlock,
  walletAddress,
  maxSpan = COLLECTIVE_MAX_EVENT_SPAN
} = {}) {
  if (!isAddress(vaultAddress) || !isAddress(queueAddress)) throw Object.assign(new Error('BAD_VAULT_ADDRESS'), { code: 'BAD_VAULT_ADDRESS' });
  const from = safeInteger(fromBlock);
  const to = safeInteger(toBlock);
  const cap = Number.isSafeInteger(Number(maxSpan)) ? Math.min(COLLECTIVE_MAX_EVENT_SPAN, Math.max(1, Number(maxSpan))) : COLLECTIVE_MAX_EVENT_SPAN;
  if (from == null || to == null || from > to) throw Object.assign(new Error('BAD_BLOCK_RANGE'), { code: 'BAD_BLOCK_RANGE' });
  if (to - from + 1 > cap) throw Object.assign(new Error('BLOCK_RANGE_TOO_LARGE'), { code: 'BLOCK_RANGE_TOO_LARGE' });
  if (walletAddress && !isAddress(walletAddress)) throw Object.assign(new Error('BAD_WALLET_ADDRESS'), { code: 'BAD_WALLET_ADDRESS' });

  const [vaultLogs, queueLogs] = await Promise.all([
    provider.getLogs({ address: vaultAddress, fromBlock: from, toBlock: to }),
    provider.getLogs({ address: queueAddress, fromBlock: from, toBlock: to })
  ]);
  const events = [
    ...vaultLogs.map((log) => parseLog(log, vaultInterface, 'vault')),
    ...queueLogs.map((log) => parseLog(log, queueInterface, 'withdrawal-queue'))
  ].filter(Boolean);

  const wallet = walletAddress?.toLowerCase();
  const filtered = wallet
    ? events.filter((event) => Object.values(event.args).some((value) => value.toLowerCase?.() === wallet))
    : events;
  filtered.sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex);
  return {
    events: filtered,
    scanned: { fromBlock: from, toBlock: to },
    nextFromBlock: to + 1,
    count: filtered.length,
    source: 'verified-chain-logs'
  };
}
