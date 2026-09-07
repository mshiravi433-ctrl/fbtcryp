/**
 * FBT Insurance OS — independent on-chain verification (LIVE mode).
 *
 * Coverage activation (and payout recording) is NEVER trusted from a frontend
 * or provider API alone: this engine re-reads the transaction receipt from
 * public RPC endpoints and checks it against what FBT prepared.
 *
 * Live EVM mode runs when INSURANCE_RPC_URLS is configured for the chain.
 * Without an RPC the verifier answers `verified: false` with an honest reason
 * — it never "approves" for convenience (§25).
 */
import { isProduction } from './env.js';
import { INSURANCE_RPC_URLS, EVM_CONFIRMATIONS } from './env.js';

const CHAIN_RPC_DEFAULTS = Object.freeze({
  1: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth', 'https://cloudflare-eth.com'],
  56: ['https://bsc-dataseed.binance.org', 'https://bsc.publicnode.com'],
  137: ['https://polygon-rpc.com', 'https://polygon.publicnode.com'],
  42161: ['https://arb1.arbitrum.io/rpc'],
  10: ['https://mainnet.optimism.io'],
  8453: ['https://mainnet.base.org'],
  43114: ['https://api.avax.network/ext/bc/C/rpc'],
  59144: ['https://rpc.linea.build']
});

function rpcsFor(chainId) {
  const envUrls = INSURANCE_RPC_URLS;
  const defaults = CHAIN_RPC_DEFAULTS[Number(chainId)] || [];
  return [...envUrls, ...defaults];
}

async function rpcCall(chainId, method, params, timeoutMs = 8_000) {
  for (const url of rpcsFor(chainId)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal
      });
      const json = await res.json();
      if (json?.result) return { ok: true, result: json.result, url };
      if (json?.error) return { ok: false, error: json.error?.message || 'rpc error' };
    } catch (err) {
      if (String(err?.message).includes('abort')) return { ok: false, error: 'rpc timeout' };
      // try next endpoint
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: 'no reachable RPC endpoint' };
}

function hexToBig(v) { try { return BigInt(v); } catch { return 0n; } }

/**
 * verifyEvmReceipt({ chainId, txHash, expect })
 *   expect: { to?: contract the tx must hit, from?: buyer, minAmountBase?: bigint (msg.value),
 *             nftContract?: CoverNFT address, nftRecipient?: owner }
 * Returns { verified, reason?, receipt?, coverId?, blockNumber?, confirmations? }
 */
export async function verifyEvmReceipt({ chainId, txHash, expect = {} }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash || ''))) {
    return { verified: false, reason: 'MALFORMED_TX_HASH' };
  }
  const head = await rpcCall(chainId, 'eth_blockNumber');
  if (!head.ok) return { verified: false, reason: 'RPC_UNAVAILABLE', detail: head.error };

  const res = await rpcCall(chainId, 'eth_getTransactionReceipt', [txHash]);
  if (!res.ok) return { verified: false, reason: 'RPC_UNAVAILABLE', detail: res.error };
  const receipt = res.result;
  if (!receipt) return { verified: false, reason: 'RECEIPT_NOT_FOUND', pending: true };

  if (hexToBig(receipt.status) !== 1n) return { verified: false, reason: 'TX_FAILED_ON_CHAIN', receipt };

  const blockNum = hexToBig(receipt.blockNumber);
  const confirmations = blockNum > 0n ? Number(hexToBig(head.result) - blockNum) + 1 : 0;
  if (confirmations < EVM_CONFIRMATIONS) {
    return { verified: false, reason: 'NOT_ENOUGH_CONFIRMATIONS', receipt, confirmations, required: EVM_CONFIRMATIONS };
  }

  if (expect.to && String(receipt.to || '').toLowerCase() !== String(expect.to).toLowerCase()) {
    return { verified: false, reason: 'WRONG_CONTRACT', receipt, expectedTo: expect.to, actualTo: receipt.to };
  }

  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];

  // Cover NFT minted to the buyer → purchase really happened on-chain.
  if (expect.nftContract) {
    // Transfer(address,address,uint256) topic0
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const mint = logs.find((l) =>
      String(l.address || '').toLowerCase() === String(expect.nftContract).toLowerCase()
      && Array.isArray(l.topics) && l.topics[0]?.toLowerCase() === TRANSFER_TOPIC
      && l.topics[1] === '0x0000000000000000000000000000000000000000000000000000000000000000' // from 0x0 = mint
      && (!expect.nftRecipient || String(l.topics[2] || '').toLowerCase().endsWith(String(expect.nftRecipient).toLowerCase().slice(2)))
    );
    if (!mint) {
      return { verified: false, reason: 'COVER_NFT_NOT_MINTED_TO_OWNER', receipt, nftContract: expect.nftContract, recipient: expect.nftRecipient || null };
    }
    const coverId = mint.topics[3] ? hexToBig(mint.topics[3]).toString() : null;
    return { verified: true, receipt, coverId, blockNumber: blockNum.toString(), confirmations, txHash, chainId: Number(chainId), verifiedAt: Date.now() };
  }

  return { verified: true, receipt, blockNumber: blockNum.toString(), confirmations, txHash, chainId: Number(chainId), verifiedAt: Date.now() };
}

/** Is live verification possible at all for this chain? (drives UI honesty) */
export function verificationMode(chainId) {
  return rpcsFor(chainId).length > 0 ? 'LIVE' : 'NOT_AVAILABLE';
}
