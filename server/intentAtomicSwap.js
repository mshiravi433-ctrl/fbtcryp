/**
 * Cross-chain ATOMIC swap compiler + on-chain leg verifier (Phase 4d).
 * ---------------------------------------------------------------------------
 * This is the first mechanism in the Intent OS under which the word
 * "atomic" is TRUE for a cross-chain intent. It is true because — and only
 * because — both legs are locked in a hash-timelock escrow contract
 * (IntentAtomicSwap) on their own chain, under the SAME hashlock, with
 * timelocks ordered so that either both legs are claimed with one preimage
 * or both legs refund. The atomicity is enforced by the two contracts, not
 * by this server, and not by anyone's promise.
 *
 * Honesty, pinned in every compiled plan:
 *   - The escrow holds funds ONLY while a swap is open. FBT holds no key,
 *     has no owner role, cannot release, redirect or rescue funds.
 *   - Every leg transaction is user/counterparty-signed. The server never
 *     signs, never broadcasts, never executes (`executableByServer: false`).
 *   - The preimage lives on the user's device. The server sees only the
 *     hashlock. `claim` makes the preimage public on-chain by design — that
 *     is what lets the counterparty claim the paired leg.
 *   - Timelock safety ordering is enforced HERE, before any calldata is
 *     produced: destinationTimeout + margin <= sourceTimeout. A plan that
 *     violates it is refused (ATOMIC_SWAP_TIMELOCK_ORDER_UNSAFE), because a
 *     mis-ordered HTLC pair can pay out on one chain and refund on the other.
 *   - EVM<->EVM only. Solana legs are refused (ATOMIC_SWAP_UNSUPPORTED_CHAIN):
 *     no Solana program exists, and a "soon" program never becomes atomic.
 *   - With no configured contract addresses this module claims NOTHING:
 *     available stays false and the block code is published.
 *
 * The pre-existing sequential path (fbt.cross-chain-state.v1) stays exactly
 * as it was: evidence-only, non-atomic, ATOMIC_CROSS_CHAIN_UNAVAILABLE. An
 * HTLC plan never upgrades or re-labels that path.
 */

import { createHash } from 'node:crypto';
import { Interface, getAddress, isAddress } from 'ethers';

export const ATOMIC_SWAP_SCHEMA = 'fbt.atomic-swap.v1';
export const ATOMIC_SWAP_ID_DOMAIN = 'fbt.atomic-swap.v1/id';
export const ATOMIC_SWAP_MODE = 'htlc-evm-evm';
export const ATOMIC_SWAP_MECHANISM = 'hash-timelock-contract-escrow';

/* EVM<->EVM only. Solana (and any chain without a deployed IntentAtomicSwap)
   is refused, never silently downgraded to sequential. */
export const ATOMIC_SWAP_CHAINS = Object.freeze([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);

/* The counterparty locking the destination leg must still have time to claim
   the source leg after the user reveals the preimage. A pair without this
   margin is not atomic — it is a race — so it is refused. */
export const MIN_TIMELOCK_MARGIN_SECONDS = 3600;
export const MIN_TIMELOCK_WINDOW_SECONDS = 10 * 60;
export const MAX_TIMELOCK_WINDOW_SECONDS = 30 * 86400;

export const ATOMIC_SWAP_STATE_NAMES = Object.freeze(['empty', 'locked', 'claimed', 'refunded']);

export const ATOMIC_SWAP_ABI = Object.freeze([
  'function newSwap(bytes32 swapId, bytes32 hashlock, uint64 timeout, address recipient, address token, uint256 amount) payable',
  'function claim(bytes32 swapId, bytes preimage)',
  'function refund(bytes32 swapId)',
  'function swaps(bytes32 swapId) view returns (address sender, address recipient, address token, uint256 amount, bytes32 hashlock, uint64 timeout, uint8 state)',
  'event SwapLocked(bytes32 indexed swapId, address indexed sender, address indexed recipient, address token, uint256 amount, bytes32 hashlock, uint64 timeout)',
  'event SwapClaimed(bytes32 indexed swapId, address indexed recipient, bytes32 preimage)',
  'event SwapRefunded(bytes32 indexed swapId, address indexed sender)'
]);

const swapInterface = new Interface(ATOMIC_SWAP_ABI);
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const HASHLOCK_RE = /^0x[a-fA-F0-9]{64}$/;
/* Amounts are integer wei strings (uint256). Human units are converted by
   the caller before compilation; decimals never reach the calldata. */
const AMOUNT_RE = /^[1-9][0-9]{0,77}$/;
const ZERO_HASH = '0x' + '0'.repeat(64);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;

export function atomicSwapIdFor(plan) {
  return sha256Hex(`${ATOMIC_SWAP_ID_DOMAIN}\n${JSON.stringify(canonicalLegs(plan))}`);
}

function canonicalLegs(plan) {
  return {
    schema: ATOMIC_SWAP_SCHEMA,
    mode: ATOMIC_SWAP_MODE,
    hashlock: String(plan.hashlock).toLowerCase(),
    source: {
      chainId: Number(plan.source.chainId),
      sender: getAddress(plan.source.sender),
      recipient: getAddress(plan.source.recipient),
      token: normalizedTokenRef(plan.source.token),
      amount: String(plan.source.amount),
      timeout: Number(plan.source.timeout)
    },
    destination: {
      chainId: Number(plan.destination.chainId),
      sender: getAddress(plan.destination.sender),
      recipient: getAddress(plan.destination.recipient),
      token: normalizedTokenRef(plan.destination.token),
      amount: String(plan.destination.amount),
      timeout: Number(plan.destination.timeout)
    }
  };
}

function normalizedTokenRef(token) {
  if (token?.native === true) return { native: true };
  if (isAddress(token?.address)) return { native: false, address: getAddress(token.address) };
  return null;
}

/**
 * Parse INTENT_ATOMIC_SWAP_ADDRESSES. Accepts either a JSON object
 * {"56":"0x..","1":"0x.."} or comma pairs "56:0x..,1:0x..". Invalid entries
 * are dropped (never guessed at), and every surviving address is checksummed.
 */
export function parseAtomicSwapAddresses(raw = process.env.INTENT_ATOMIC_SWAP_ADDRESSES || '') {
  const text = String(raw || '').trim();
  const map = new Map();
  if (!text) return map;
  const put = (chainId, address) => {
    const chain = Number(chainId);
    if (!Number.isInteger(chain) || !ATOMIC_SWAP_CHAINS.includes(chain)) return;
    if (!isAddress(address)) return;
    map.set(chain, getAddress(address));
  };
  if (text.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return map;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [chainId, address] of Object.entries(parsed)) put(chainId, address);
    }
    return map;
  }
  for (const pair of text.split(',')) {
    const [chainId, address] = pair.split(':').map((part) => part && part.trim());
    if (chainId && address) put(chainId, address);
  }
  return map;
}

export function atomicSwapConfigured(addresses = parseAtomicSwapAddresses()) {
  /* A cross-chain swap needs at least two DIFFERENT configured chains. */
  return addresses.size >= 2;
}

function validateLeg(leg, role, now) {
  if (!leg || typeof leg !== 'object') return { ok: false, code: 'ATOMIC_SWAP_LEG_REQUIRED' };
  if (!ATOMIC_SWAP_CHAINS.includes(Number(leg.chainId))) return { ok: false, code: 'ATOMIC_SWAP_UNSUPPORTED_CHAIN' };
  if (!isEvmAddress(leg.sender)) return { ok: false, code: 'ATOMIC_SWAP_BAD_SENDER' };
  if (!isEvmAddress(leg.recipient)) return { ok: false, code: 'ATOMIC_SWAP_BAD_RECIPIENT' };
  if (getAddress(leg.sender) === getAddress(leg.recipient)) return { ok: false, code: 'ATOMIC_SWAP_BAD_PARTIES' };
  const token = normalizedTokenRef(leg.token);
  if (!token) return { ok: false, code: 'ATOMIC_SWAP_BAD_TOKEN' };
  if (!AMOUNT_RE.test(String(leg.amount ?? '')) || Number(leg.amount) <= 0) {
    return { ok: false, code: 'ATOMIC_SWAP_BAD_AMOUNT' };
  }
  const timeout = Number(leg.timeout);
  if (!Number.isInteger(timeout)) return { ok: false, code: 'ATOMIC_SWAP_BAD_TIMEOUT' };
  if (timeout < now + MIN_TIMELOCK_WINDOW_SECONDS) return { ok: false, code: 'ATOMIC_SWAP_TIMEOUT_TOO_SOON' };
  if (timeout > now + MAX_TIMELOCK_WINDOW_SECONDS) return { ok: false, code: 'ATOMIC_SWAP_TIMEOUT_TOO_FAR' };
  return {
    ok: true,
    leg: {
      role,
      chainId: Number(leg.chainId),
      sender: getAddress(leg.sender),
      recipient: getAddress(leg.recipient),
      token,
      amount: String(leg.amount),
      timeout
    }
  };
}

function isEvmAddress(value) {
  return typeof value === 'string' && isAddress(value);
}

/**
 * Compile an EVM<->EVM HTLC plan into two user/counterparty-signed `newSwap`
 * transactions. The calldata is REAL contract calldata (not a planned hash):
 * these are the exact bytes that lock each leg. The server still never sends
 * them; `executableByServer` stays false and every leg needs a signature.
 */
export function buildAtomicSwapPlan(input, now = Math.floor(Date.now() / 1000)) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'BAD_BODY' };
  if (input.schema !== undefined && input.schema !== ATOMIC_SWAP_SCHEMA) return { ok: false, code: 'BAD_SCHEMA' };
  const hashlock = String(input.hashlock || '').toLowerCase();
  if (!HASHLOCK_RE.test(hashlock)) return { ok: false, code: 'ATOMIC_SWAP_HASHLOCK_REQUIRED' };
  if (hashlock === ZERO_HASH) return { ok: false, code: 'ATOMIC_SWAP_HASHLOCK_REQUIRED' };

  const source = validateLeg(input.source, 'source', now);
  if (!source.ok) return source;
  const destination = validateLeg(input.destination, 'destination', now);
  if (!destination.ok) return destination;

  if (source.leg.chainId === destination.leg.chainId) {
    return { ok: false, code: 'ATOMIC_SWAP_SAME_CHAIN' };
  }
  /* THE safety rule: the leg the preimage-holder claims (destination) must
     expire strictly earlier than the counter-leg, leaving the counterparty a
     margin to react after the reveal. Without it, the user could claim the
     destination leg and still let the source leg refund. */
  if (destination.leg.timeout + MIN_TIMELOCK_MARGIN_SECONDS > source.leg.timeout) {
    return { ok: false, code: 'ATOMIC_SWAP_TIMELOCK_ORDER_UNSAFE' };
  }

  const addresses = parseAtomicSwapAddresses();
  const plan = { hashlock, source: source.leg, destination: destination.leg };
  const swapId = atomicSwapIdFor(plan);
  if (!TX_RE_64.test(swapId)) return { ok: false, code: 'ATOMIC_SWAP_BAD_ID' };

  const legs = [source.leg, destination.leg].map((leg) => {
    const to = addresses.get(leg.chainId) || null;
    const tokenAddress = leg.token.native ? ZERO_ADDRESS : leg.token.address;
    const data = swapInterface.encodeFunctionData('newSwap', [
      swapId,
      hashlock,
      leg.timeout,
      leg.recipient,
      tokenAddress,
      BigInt(leg.amount)
    ]);
    return {
      role: leg.role,
      chainId: leg.chainId,
      sender: leg.sender,
      recipient: leg.recipient,
      refundTo: leg.sender,
      token: leg.token,
      amount: leg.amount,
      timeout: leg.timeout,
      to,
      data,
      value: leg.token.native ? leg.amount : '0',
      configured: Boolean(to),
      contractEscrow: Boolean(to),
      executableByServer: false,
      userSignatureRequired: true
    };
  });

  const configured = atomicSwapConfigured(addresses);
  return {
    ok: true,
    schema: ATOMIC_SWAP_SCHEMA,
    swapId,
    mode: ATOMIC_SWAP_MODE,
    hashlock,
    legs,
    safety: {
      timelockOrdering: 'destination-plus-margin-<=-source',
      marginSeconds: MIN_TIMELOCK_MARGIN_SECONDS,
      destinationTimeout: destination.leg.timeout,
      sourceTimeout: source.leg.timeout,
      preimageHolder: 'user-device-only',
      serverNeverSeesPreimage: true
    },
    atomicity: {
      mechanism: ATOMIC_SWAP_MECHANISM,
      scope: 'evm-evm',
      enforcedBy: 'on-chain-hash-timelock-contracts',
      eitherBothLegsClaimedOrBothRefund: true,
      assumptions: [
        'both chains stay live and finalise within their timelock windows',
        'both legs lock under the same keccak256 hashlock with the enforced timeout ordering',
        'the preimage is revealed only by claiming the destination leg'
      ]
    },
    /* Disclosure, pinned: an open swap IS escrowed — by the two contracts. */
    custody: 'on-chain-contract-escrow-while-open',
    fbtHoldsKeys: false,
    fbtCustody: false,
    serverExecutesTransactions: false,
    executableByServer: false,
    userSignatureRequired: true,
    configured,
    blockCode: configured ? null : 'ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED',
    /* The pre-existing sequential path is never re-labelled by this plan. */
    sequentialCrossChainPathUnchanged: 'ATOMIC_CROSS_CHAIN_UNAVAILABLE'
  };
}

/**
 * Verify one leg on-chain by reading `swaps(swapId)` over every configured
 * RPC for that chain. A leg state is reported only from RPC reads; nothing is
 * taken on trust from the caller. Consensus = all reachable RPCs agree.
 */
export async function verifyAtomicSwapLeg({ chainId, swapId, rpcUrls = [], providerFactory = null } = {}) {
  const chain = Number(chainId);
  if (!ATOMIC_SWAP_CHAINS.includes(chain)) return { ok: false, code: 'ATOMIC_SWAP_UNSUPPORTED_CHAIN' };
  if (!TX_RE_64.test(String(swapId || ''))) return { ok: false, code: 'ATOMIC_SWAP_BAD_ID' };
  const urls = (Array.isArray(rpcUrls) ? rpcUrls : []).filter((url) => /^https?:\/\//.test(String(url || '')));
  if (!urls.length) return { ok: false, code: 'ATOMIC_SWAP_RPC_UNCONFIGURED' };

  const addresses = parseAtomicSwapAddresses();
  const contract = addresses.get(chain) || null;
  if (!contract) return { ok: false, code: 'ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED' };

  const callData = swapInterface.encodeFunctionData('swaps', [swapId]);
  const results = [];
  await Promise.all(urls.map(async (url) => {
    try {
      const provider = providerFactory
        ? providerFactory(url, chain)
        : await import('ethers').then(({ JsonRpcProvider }) => new JsonRpcProvider(url, chain, { staticNetwork: true }));
      const raw = await provider.call({ to: contract, data: callData });
      const decoded = swapInterface.decodeFunctionResult('swaps', raw);
      results.push({
        url,
        ok: true,
        sender: decoded[0],
        recipient: decoded[1],
        token: decoded[2],
        amount: decoded[3].toString(),
        hashlock: decoded[4],
        timeout: Number(decoded[5]),
        state: ATOMIC_SWAP_STATE_NAMES[Number(decoded[6])] || 'unknown'
      });
      await provider.destroy?.();
    } catch (error) {
      results.push({ url, ok: false, error: String(error?.shortMessage || error?.message || error).slice(0, 160) });
    }
  }));

  const good = results.filter((row) => row.ok);
  if (!good.length) return { ok: false, code: 'ATOMIC_SWAP_RPC_UNREACHABLE', attempts: results };
  const states = [...new Set(good.map((row) => row.state))];
  const consensus = states.length === 1;
  return {
    ok: true,
    schema: ATOMIC_SWAP_SCHEMA,
    chainId: chain,
    swapId,
    contract,
    state: consensus ? states[0] : 'rpc-disagreement',
    consensus,
    readableRpcCount: good.length,
    unreachableRpcCount: results.length - good.length,
    leg: consensus && states[0] !== 'empty' ? good[0] : null,
    /* Reading state never settles anything and never claims atomicity that
       the contracts do not enforce themselves. */
    verificationOnly: true,
    serverExecutesTransactions: false
  };
}

/** Capability block — configured flips only when >= 2 chains have a real
 *  deployed IntentAtomicSwap address. Otherwise it stays honestly blocked. */
export function atomicSwapProtocolStatus({ addresses = parseAtomicSwapAddresses() } = {}) {
  const configured = atomicSwapConfigured(addresses);
  return {
    schema: ATOMIC_SWAP_SCHEMA,
    mode: ATOMIC_SWAP_MODE,
    mechanism: ATOMIC_SWAP_MECHANISM,
    available: configured,
    crossChainAtomic: configured,
    chains: [...addresses.keys()].sort((a, b) => a - b),
    configuredChainCount: addresses.size,
    atomicityEnforcedBy: 'on-chain-hash-timelock-contracts',
    eitherBothLegsClaimedOrBothRefund: configured,
    hashFunction: 'keccak256',
    minTimelockMarginSeconds: MIN_TIMELOCK_MARGIN_SECONDS,
    minTimelockWindowSeconds: MIN_TIMELOCK_WINDOW_SECONDS,
    maxTimelockWindowSeconds: MAX_TIMELOCK_WINDOW_SECONDS,
    /* Pinned disclosures. */
    custody: 'on-chain-contract-escrow-while-open',
    escrowDuringSwap: true,
    fbtHoldsKeys: false,
    fbtCustody: false,
    serverExecutesTransactions: false,
    executableByServer: false,
    userSignatureRequired: true,
    preimageHeldOn: 'user-device-only',
    serverNeverSeesPreimage: true,
    assumptions: [
      'both chains stay live and finalise within their timelock windows',
      'both legs lock under the same keccak256 hashlock with the enforced timeout ordering',
      'the preimage is revealed only by claiming the destination leg'
    ],
    limitations: [
      'EVM<->EVM pairs only; Solana is excluded until a real program exists',
      'open swaps are escrowed by the contracts until claimed or refunded',
      'the sequential cross-chain path stays non-atomic (ATOMIC_CROSS_CHAIN_UNAVAILABLE) and is never re-labelled by this mechanism'
    ],
    blockCode: configured ? null : 'ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED'
  };
}
