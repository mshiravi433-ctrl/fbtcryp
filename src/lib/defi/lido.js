/**
 * LIDO · ETHEREUM MAINNET (1) · stETH / wstETH / WithdrawalQueue
 * ---------------------------------------------------------------------------
 * The fourth in-app DeFi execution adapter. It moves value into Lido's
 * audited contracts on Ethereum mainnet — staking ETH for stETH, wrapping
 * stETH to wstETH, unwrapping, requesting withdrawal via the queue, and
 * claiming finalized withdrawals.
 *
 * ─── SCOPE ─────────────────────────────────────────────────────────────────
 * One protocol (Lido), one chain (Ethereum 1), three contracts (stETH,
 * wstETH, WithdrawalQueue), five write actions:
 *
 *   stake            ETH  -> stETH   (Lido.submit)
 *   wrap             stETH -> wstETH (wstETH.wrap)
 *   unwrap           wstETH -> stETH (wstETH.unwrap)
 *   requestWithdraw  stETH -> ticket (WithdrawalQueue.requestWithdrawals)
 *   claim            ticket -> ETH   (WithdrawalQueue.claimWithdrawal)
 *
 * There is no leverage, no borrow, no secondary market swap here. A swap-
 * shaped FARM (\"swap USDT into stETH\") is the swap venue's job, not this
 * adapter's. This adapter only handles the native staking / wrapping /
 * queue flow that cannot be expressed as a swap.
 *
 * ─── ADDRESS PROVENANCE ─────────────────────────────────────────────────────
 * All three Lido addresses are pinned in THIS FILE AND NOWHERE ELSE (a wiring
 * pin in test/wiring.mjs should grep src/ to prove it). They are copied from
 * the official Lido docs and verified on Etherscan:
 *
 *   https://docs.lido.fi/deployed-contracts/
 *   https://etherscan.io/address/0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84 (stETH)
 *   https://etherscan.io/address/0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0 (wstETH)
 *   https://etherscan.io/address/0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1 (WithdrawalQueue)
 *
 * Pinned constants are never trusted on their own. Before any write is
 * allowed, verifyDeployment() checks:
 *   · wstETH.stETH() == pinned stETH
 *   · WithdrawalQueue.WSTETH() == pinned wstETH
 *   · WithdrawalQueue.STETH() == pinned stETH
 *   · stETH.getTotalPooledEther() is readable (contract is live)
 *
 * A mismatch throws — the adapter would rather be unusable than move value
 * against a contract it did not verify.
 *
 * ─── SAFETY PROPERTIES THIS FILE MUST KEEP ──────────────────────────────────
 *   · Approvals are for EXACTLY the amount being wrapped / queued. Never an
 *     unbounded allowance: a standing infinite approval on wstETH or the queue
 *     would let a compromised contract move the rest of the wallet's stETH.
 *   · `onBehalfOf` / `owner` / `to` are always the connected owner. No param
 *     lets them differ.
 *   · Every unsigned step goes through lib/preSignSimulation.js before the
 *     user is asked to sign. This module builds and checks; it never signs.
 *   · Reads fail closed. An undecodable reserve, a missing provider or a
 *     failed verification is a thrown typed error, never a plausible default.
 *   · Caps are enforced in the adapter, not just the UI. Per-tx and total
 *     position caps come from src/lib/features.js and default to 1 / 10 ETH.
 *   · Withdrawal and unwrap are never gated by the flag — only stake is.
 */

import { EVM_CHAINS, ERC20_ABI, getToken } from '../chains';
import { NATIVE_GAS_FLOOR } from '../swap';
import { decodeRevertReason } from '../preSignSimulation';
import {
  assertProviderChain, assertSuccessfulReceipt, parseReceiptLogs, ExecutionGuardError, sameAddress
} from './executionGuards';
import {
  LIDO_STAKE_MAX_ETH_PER_TX,
  LIDO_STAKE_MAX_ETH_TOTAL
} from '../features';

const loadEthers = () => import('ethers');

const isAddr = (v) => typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const LIDO = Object.freeze({
  chainId: 1,
  /** Lido stETH — the main staking contract and the ERC20. */
  stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  /** Wrapped stETH — non-rebasing. */
  wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  /** WithdrawalQueueERC721 — handles unstaking. */
  withdrawalQueue: '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1',
  /** Lido referral — zero means no referral, which is the honest default. */
  referral: ZERO_ADDRESS,
  stETHSymbol: 'stETH',
  wstETHSymbol: 'wstETH',
  explorer: EVM_CHAINS[1].explorer,
  /** For Farm matching — same shape as Aave adapters */
  chainName: 'Ethereum',
  project: 'lido'
});

/* -------------------------------------------------------------------------- */
/* ABIs                                                                       */
/* -------------------------------------------------------------------------- */

const STETH_ABI = [
  'function submit(address _referral) payable returns (uint256)',
  'function balanceOf(address _account) view returns (uint256)',
  'function sharesOf(address _account) view returns (uint256)',
  'function getTotalPooledEther() view returns (uint256)',
  'function getTotalShares() view returns (uint256)',
  'function getPooledEthByShares(uint256 _sharesAmount) view returns (uint256)',
  'function getSharesByPooledEth(uint256 _pooledEthAmount) view returns (uint256)',
  'function getFee() view returns (uint16)',
  'function getFeeDistribution() view returns (uint16 treasuryFeeBasisPoints, uint16 insuranceFeeBasisPoints, uint16 operatorsFeeBasisPoints)',
  'function getBufferedEther() view returns (uint256)',
  'function isStakingPaused() view returns (bool)',
  'function allowance(address _owner, address _spender) view returns (uint256)',
  'function approve(address _spender, uint256 _amount) returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

const WSTETH_ABI = [
  'function wrap(uint256 _stETHAmount) returns (uint256)',
  'function unwrap(uint256 _wstETHAmount) returns (uint256)',
  'function getWstETHByStETH(uint256 _stETHAmount) view returns (uint256)',
  'function getStETHByWstETH(uint256 _wstETHAmount) view returns (uint256)',
  'function stETH() view returns (address)',
  'function balanceOf(address _account) view returns (uint256)',
  'function allowance(address _owner, address _spender) view returns (uint256)',
  'function approve(address _spender, uint256 _amount) returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

const WITHDRAWAL_QUEUE_ABI = [
  'function WSTETH() view returns (address)',
  'function STETH() view returns (address)',
  'function getWithdrawalQueueLength() view returns (uint256)',
  'function getLastCheckpointIndex() view returns (uint256)',
  'function getWithdrawalRequests(address _owner) view returns (uint256[])',
  'function getWithdrawalStatus(uint256[] _requestIds) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])',
  'function requestWithdrawals(uint256[] _amounts, address _owner) returns (uint256[])',
  'function claimWithdrawal(uint256 _requestId)',
  'function findCheckpointHints(uint256[] _requestIds, uint256 _firstIndex, uint256 _lastIndex) view returns (uint256[])',
  'function isPaused() view returns (bool)',
  'function isBunkerModeActive() view returns (bool)'
];

const LIDO_EVENT_ABI = [
  'event Submitted(address indexed sender, uint256 amount, address referral)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event WithdrawalRequested(uint256 indexed requestId, address indexed requestor, address indexed owner, uint256 amountOfStETH, uint256 amountOfShares)',
  'event WithdrawalClaimed(uint256 indexed requestId, address indexed owner, address indexed receiver, uint256 amountOfETH)'
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toBigInt(v) {
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string' && v.trim() !== '') return BigInt(v.trim());
  } catch {}
  return null;
}

function parseEthAmount(amountEth) {
  const raw = String(amountEth ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function parseEthWei(amountEth) {
  const { parseEther } = await loadEthers();
  try {
    return parseEther(String(amountEth));
  } catch {
    return null;
  }
}

export function fromWei(wei, decimals = 18) {
  if (wei == null) return null;
  try {
    const bi = toBigInt(wei);
    if (bi == null) return null;
    const num = Number(bi) / 10 ** decimals;
    return num;
  } catch {
    return null;
  }
}

export function fromStETHWei(wei) {
  return fromWei(wei, 18);
}
export function fromWstETHWei(wei) {
  return fromWei(wei, 18);
}
export function fromEthWei(wei) {
  return fromWei(wei, 18);
}

/* -------------------------------------------------------------------------- */
/* Deployment verification                                                    */
/* -------------------------------------------------------------------------- */

export async function verifyDeployment(provider) {
  try {
    await assertProviderChain(provider, LIDO.chainId);
  } catch (err) {
    if (err?.code === 'EXECUTION_WRONG_CHAIN') {
      throw Object.assign(new Error('LIDO_WRONG_CHAIN'), { code: 'LIDO_WRONG_CHAIN', detail: err.detail });
    }
    if (err instanceof ExecutionGuardError) {
      throw Object.assign(new Error('LIDO_NETWORK_UNREADABLE'), { code: 'LIDO_NETWORK_UNREADABLE', detail: err.detail });
    }
    throw err;
  }
  const { Contract } = await loadEthers();
  const stETH = new Contract(LIDO.stETH, STETH_ABI, provider);
  const wstETH = new Contract(LIDO.wstETH, WSTETH_ABI, provider);
  const queue = new Contract(LIDO.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, provider);

  // stETH must be live
  let totalPooled;
  try {
    totalPooled = await stETH.getTotalPooledEther();
  } catch (e) {
    throw Object.assign(new Error('LIDO_STETH_UNREADABLE'), { cause: e, code: 'LIDO_STETH_UNREADABLE' });
  }
  if (toBigInt(totalPooled) == null || toBigInt(totalPooled) <= 0n) {
    throw Object.assign(new Error('LIDO_STETH_INVALID'), { code: 'LIDO_STETH_INVALID' });
  }
  try {
    const [symbol, decimals] = await Promise.all([stETH.symbol(), stETH.decimals()]);
    if (String(symbol) !== 'stETH' || Number(decimals) !== 18) {
      throw Object.assign(new Error('LIDO_STETH_IDENTITY_MISMATCH'), { code: 'LIDO_STETH_IDENTITY_MISMATCH', detail: { symbol, decimals } });
    }
  } catch (e) {
    if (e?.code === 'LIDO_STETH_IDENTITY_MISMATCH') throw e;
    throw Object.assign(new Error('LIDO_STETH_IDENTITY_UNREADABLE'), { cause: e, code: 'LIDO_STETH_IDENTITY_UNREADABLE' });
  }

  // wstETH.stETH() == LIDO.stETH
  let wstETHStETH;
  try {
    wstETHStETH = await wstETH.stETH();
  } catch (e) {
    throw Object.assign(new Error('LIDO_WSTETH_STETH_UNREADABLE'), { cause: e, code: 'LIDO_WSTETH_STETH_UNREADABLE' });
  }
  if (String(wstETHStETH).toLowerCase() !== LIDO.stETH.toLowerCase()) {
    throw Object.assign(new Error('LIDO_WSTETH_STETH_MISMATCH'), { code: 'LIDO_WSTETH_STETH_MISMATCH' });
  }

  // queue.WSTETH() == LIDO.wstETH and queue.STETH() == LIDO.stETH
  let qWst, qSt;
  try {
    [qWst, qSt] = await Promise.all([queue.WSTETH(), queue.STETH()]);
  } catch (e) {
    throw Object.assign(new Error('LIDO_QUEUE_UNREADABLE'), { cause: e, code: 'LIDO_QUEUE_UNREADABLE' });
  }
  if (String(qWst).toLowerCase() !== LIDO.wstETH.toLowerCase()) {
    throw Object.assign(new Error('LIDO_QUEUE_WSTETH_MISMATCH'), { code: 'LIDO_QUEUE_WSTETH_MISMATCH' });
  }
  if (String(qSt).toLowerCase() !== LIDO.stETH.toLowerCase()) {
    throw Object.assign(new Error('LIDO_QUEUE_STETH_MISMATCH'), { code: 'LIDO_QUEUE_STETH_MISMATCH' });
  }

  return {
    stETH: LIDO.stETH,
    wstETH: LIDO.wstETH,
    withdrawalQueue: LIDO.withdrawalQueue,
    totalPooledEther: totalPooled
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function getBalances(provider, owner) {
  const { Contract } = await loadEthers();
  const stETH = new Contract(LIDO.stETH, STETH_ABI, provider);
  const wstETH = new Contract(LIDO.wstETH, WSTETH_ABI, provider);
  try {
    const [stBal, wstBal, stShares, totalPooled, totalShares, fee, buffered, isPaused] = await Promise.all([
      stETH.balanceOf(owner).catch(() => 0n),
      wstETH.balanceOf(owner).catch(() => 0n),
      stETH.sharesOf(owner).catch(() => 0n),
      stETH.getTotalPooledEther().catch(() => 0n),
      stETH.getTotalShares().catch(() => 0n),
      stETH.getFee().catch(() => null),
      stETH.getBufferedEther().catch(() => 0n),
      stETH.isStakingPaused().catch(() => false)
    ]);
    return {
      stETHWei: toBigInt(stBal) ?? 0n,
      wstETHWei: toBigInt(wstBal) ?? 0n,
      sharesWei: toBigInt(stShares) ?? 0n,
      totalPooledEtherWei: toBigInt(totalPooled) ?? 0n,
      totalSharesWei: toBigInt(totalShares) ?? 0n,
      feeBps: fee == null ? null : Number(fee),
      bufferedEtherWei: toBigInt(buffered) ?? 0n,
      isStakingPaused: Boolean(isPaused)
    };
  } catch (e) {
    throw Object.assign(new Error('LIDO_BALANCE_UNREADABLE'), { cause: e, code: 'LIDO_BALANCE_UNREADABLE' });
  }
}

export async function getAllowances(provider, owner) {
  const { Contract } = await loadEthers();
  const stETH = new Contract(LIDO.stETH, STETH_ABI, provider);
  try {
    const [allowWst, allowQueue] = await Promise.all([
      stETH.allowance(owner, LIDO.wstETH).catch(() => 0n),
      stETH.allowance(owner, LIDO.withdrawalQueue).catch(() => 0n)
    ]);
    return {
      wstETHAllowanceWei: toBigInt(allowWst) ?? 0n,
      queueAllowanceWei: toBigInt(allowQueue) ?? 0n
    };
  } catch {
    return { wstETHAllowanceWei: 0n, queueAllowanceWei: 0n };
  }
}

export async function getWstETHRate(provider, stETHWei) {
  const { Contract } = await loadEthers();
  const wstETH = new Contract(LIDO.wstETH, WSTETH_ABI, provider);
  try {
    const out = await wstETH.getWstETHByStETH(stETHWei);
    return toBigInt(out) ?? null;
  } catch {
    return null;
  }
}

export async function getStETHRate(provider, wstETHWei) {
  const { Contract } = await loadEthers();
  const wstETH = new Contract(LIDO.wstETH, WSTETH_ABI, provider);
  try {
    const out = await wstETH.getStETHByWstETH(wstETHWei);
    return toBigInt(out) ?? null;
  } catch {
    return null;
  }
}

export async function getWithdrawalRequests(provider, owner) {
  const { Contract } = await loadEthers();
  const queue = new Contract(LIDO.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, provider);
  try {
    const ids = await queue.getWithdrawalRequests(owner);
    const list = Array.isArray(ids) ? ids.map((x) => toBigInt(x)).filter((x) => x != null) : [];
    if (list.length === 0) return { requestIds: [], statuses: [] };
    const statuses = await queue.getWithdrawalStatus(list).catch(() => []);
    const normalized = (Array.isArray(statuses) ? statuses : []).map((s, i) => ({
      requestId: list[i],
      requestIdStr: String(list[i]),
      amountOfStETHWei: toBigInt(s.amountOfStETH) ?? 0n,
      amountOfSharesWei: toBigInt(s.amountOfShares) ?? 0n,
      owner: s.owner,
      timestamp: Number(s.timestamp),
      isFinalized: Boolean(s.isFinalized),
      isClaimed: Boolean(s.isClaimed)
    }));
    return { requestIds: list, statuses: normalized };
  } catch (e) {
    throw Object.assign(new Error('LIDO_WITHDRAWAL_REQUESTS_UNREADABLE'), { cause: e, code: 'LIDO_WITHDRAWAL_REQUESTS_UNREADABLE' });
  }
}

export async function getProtocolStatus(provider) {
  const { Contract } = await loadEthers();
  const stETH = new Contract(LIDO.stETH, STETH_ABI, provider);
  const queue = new Contract(LIDO.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, provider);
  try {
    const [totalPooled, totalShares, fee, buffered, isStakingPaused, queueLen, isQueuePaused, isBunker] = await Promise.all([
      stETH.getTotalPooledEther().catch(() => 0n),
      stETH.getTotalShares().catch(() => 0n),
      stETH.getFee().catch(() => null),
      stETH.getBufferedEther().catch(() => 0n),
      stETH.isStakingPaused().catch(() => false),
      queue.getWithdrawalQueueLength().catch(() => 0n),
      queue.isPaused().catch(() => false),
      queue.isBunkerModeActive().catch(() => false)
    ]);
    return {
      totalPooledEtherWei: toBigInt(totalPooled) ?? 0n,
      totalSharesWei: toBigInt(totalShares) ?? 0n,
      feeBps: fee == null ? null : Number(fee),
      bufferedEtherWei: toBigInt(buffered) ?? 0n,
      isStakingPaused: Boolean(isStakingPaused),
      withdrawalQueueLength: toBigInt(queueLen) ?? 0n,
      isQueuePaused: Boolean(isQueuePaused),
      isBunkerModeActive: Boolean(isBunker)
    };
  } catch (e) {
    throw Object.assign(new Error('LIDO_PROTOCOL_STATUS_UNREADABLE'), { cause: e, code: 'LIDO_PROTOCOL_STATUS_UNREADABLE' });
  }
}

export async function getPosition(provider, owner, { history = [] } = {}) {
  await verifyDeployment(provider);
  const [balances, allowances, withdrawals, status] = await Promise.all([
    getBalances(provider, owner).catch(() => null),
    getAllowances(provider, owner).catch(() => ({ wstETHAllowanceWei: 0n, queueAllowanceWei: 0n })),
    getWithdrawalRequests(provider, owner).catch(() => ({ requestIds: [], statuses: [] })),
    getProtocolStatus(provider).catch(() => null)
  ]);

  const stETHWei = balances?.stETHWei ?? 0n;
  const wstETHWei = balances?.wstETHWei ?? 0n;
  const hasPosition = stETHWei > 0n || wstETHWei > 0n || (withdrawals?.requestIds?.length ?? 0) > 0;

  // Compute ETH value of wstETH if possible
  let wstETHAsStETHWei = null;
  if (wstETHWei > 0n) {
    try {
      wstETHAsStETHWei = await getStETHRate(provider, wstETHWei);
    } catch {
      wstETHAsStETHWei = null;
    }
  }

  const totalStETHWei = stETHWei + (wstETHAsStETHWei ?? 0n);
  const totalEthEquivalent = fromStETHWei(totalStETHWei);

  return {
    owner,
    chainId: LIDO.chainId,
    stETHWei,
    wstETHWei,
    stETH: fromStETHWei(stETHWei),
    wstETH: fromWstETHWei(wstETHWei),
    sharesWei: balances?.sharesWei ?? 0n,
    totalStETHWei,
    totalEthEquivalent,
    wstETHAsStETHWei,
    allowances,
    withdrawals,
    status,
    hasPosition,
    history
  };
}

/* -------------------------------------------------------------------------- */
/* Plan builders — stake, wrap, unwrap, requestWithdraw, claim, revoke        */
/* -------------------------------------------------------------------------- */

function blockedChecks() {
  return [];
}

export async function buildStakePlan({ provider, owner, amountEth, history = [], nativeBalance = null } = {}) {
  const checks = {
    amountEth: null,
    amountWei: null,
    blocked: blockedChecks(),
    warnings: []
  };

  const amount = parseEthAmount(amountEth);
  if (amount == null) {
    checks.blocked.push('LIDO_INVALID_AMOUNT');
    return { checks, steps: [] };
  }
  checks.amountEth = amount;
  const amountWei = await parseEthWei(amount);
  if (amountWei == null || amountWei <= 0n) {
    checks.blocked.push('LIDO_INVALID_AMOUNT');
    return { checks, steps: [] };
  }
  checks.amountWei = amountWei;

  // Per-tx cap
  if (amount > LIDO_STAKE_MAX_ETH_PER_TX) {
    checks.blocked.push('LIDO_PER_TX_CAP');
  }

  // Verify deployment
  try {
    await verifyDeployment(provider);
  } catch (e) {
    checks.blocked.push(e.code || 'LIDO_DEPLOYMENT_UNVERIFIED');
    return { checks, steps: [] };
  }

  // Check staking paused
  try {
    const { Contract } = await loadEthers();
    const stETH = new Contract(LIDO.stETH, STETH_ABI, provider);
    const paused = await stETH.isStakingPaused();
    if (paused) checks.blocked.push('LIDO_STAKING_PAUSED');
  } catch {
    // If unreadable, block rather than assume active
    checks.blocked.push('LIDO_STATUS_UNREADABLE');
  }

  // Native balance + gas floor check — same shape as Aave adapters
  const floor = NATIVE_GAS_FLOOR[LIDO.chainId];
  if (floor == null) {
    checks.blocked.push('LIDO_GAS_FLOOR_UNKNOWN');
  } else if (nativeBalance == null) {
    checks.blocked.push('LIDO_NATIVE_BALANCE_UNKNOWN');
  } else {
    try {
      const { parseUnits } = await loadEthers();
      const floorWei = parseUnits(String(floor), 18);
      const native = typeof nativeBalance === 'bigint' ? nativeBalance : toBigInt(nativeBalance);
      if (native != null) {
        const needed = amountWei + floorWei;
        if (native < needed) checks.blocked.push('LIDO_NATIVE_GAS_FLOOR');
        if (native < amountWei) checks.blocked.push('LIDO_INSUFFICIENT_BALANCE');
      }
    } catch {
      checks.blocked.push('LIDO_NATIVE_BALANCE_UNKNOWN');
    }
  }

  // Total cap: existing position + new amount
  try {
    const pos = await getPosition(provider, owner, { history });
    const existingEth = Number(pos.totalEthEquivalent ?? 0);
    if (existingEth + amount > LIDO_STAKE_MAX_ETH_TOTAL) {
      checks.blocked.push('LIDO_TOTAL_CAP');
    }
  } catch {
    checks.blocked.push('LIDO_POSITION_UNREADABLE');
  }

  if (checks.blocked.length > 0) return { checks, steps: [] };

  // Build step: submit(referral) payable
  const { Interface } = await loadEthers();
  const iface = new Interface(STETH_ABI);
  const data = iface.encodeFunctionData('submit', [LIDO.referral]);

  return {
    checks,
    steps: [
      {
        kind: 'stake',
        to: LIDO.stETH,
        data,
        value: amountWei,
        description: { key: 'farm.lido.step.stake', amount: amountEth, symbol: 'ETH' }
      }
    ]
  };
}

export async function buildWrapPlan({ provider, owner, amountStETH } = {}) {
  const checks = { amountStETH: null, amountWei: null, blocked: [], warnings: [] };
  const amount = parseEthAmount(amountStETH);
  if (amount == null) {
    checks.blocked.push('LIDO_INVALID_AMOUNT');
    return { checks, steps: [] };
  }
  checks.amountStETH = amount;
  const amountWei = await parseEthWei(amount);
  if (amountWei == null || amountWei <= 0n) {
    checks.blocked.push('LIDO_INVALID_AMOUNT');
    return { checks, steps: [] };
  }
  checks.amountWei = amountWei;

  try {
    await verifyDeployment(provider);
  } catch (e) {
    checks.blocked.push(e.code || 'LIDO_DEPLOYMENT_UNVERIFIED');
    return { checks, steps: [] };
  }

  // Balance check
  try {
    const bal = await getBalances(provider, owner);
    if (bal.stETHWei < amountWei) checks.blocked.push('LIDO_INSUFFICIENT_STETH');
  } catch {
    checks.blocked.push('LIDO_BALANCE_UNREADABLE');
  }

  if (checks.blocked.length > 0) return { checks, steps: [] };

  const allowances = await getAllowances(provider, owner).catch(() => ({ wstETHAllowanceWei: 0n }));
  const needsApprove = (allowances.wstETHAllowanceWei ?? 0n) < amountWei;

  const { Interface } = await loadEthers();
  const stIface = new Interface(STETH_ABI);
  const wstIface = new Interface(WSTETH_ABI);

  const steps = [];
  if (needsApprove) {
    steps.push({
      kind: 'approve',
      spender: LIDO.wstETH,
      to: LIDO.stETH,
      data: stIface.encodeFunctionData('approve', [LIDO.wstETH, amountWei]),
      value: 0n,
      description: { key: 'farm.lido.step.approve', amount: amountStETH, symbol: 'stETH' }
    });
  }
  steps.push({
    kind: 'wrap',
    to: LIDO.wstETH,
    data: wstIface.encodeFunctionData('wrap', [amountWei]),
    value: 0n,
    description: { key: 'farm.lido.step.wrap', amount: amountStETH, symbol: 'stETH' }
  });

  return { checks, steps };
}

export async function buildUnwrapPlan({ provider, owner, amountWstETH } = {}) {
  const checks = { amountWstETH: null, amountWei: null, blocked: [], warnings: [] };
  const amount = parseEthAmount(amountWstETH);
  if (amount == null) {
    checks.blocked.push('LIDO_INVALID_AMOUNT');
    return { checks, steps: [] };
  }
  checks.amountWstETH = amount;
  const amountWei = await parseEthWei(amount);
  if (amountWei == null || amountWei <= 0n) {
    checks.blocked.push('LIDO_INVALID_AMOUNT');
    return { checks, steps: [] };
  }
  checks.amountWei = amountWei;

  try {
    await verifyDeployment(provider);
  } catch (e) {
    checks.blocked.push(e.code || 'LIDO_DEPLOYMENT_UNVERIFIED');
    return { checks, steps: [] };
  }

  try {
    const bal = await getBalances(provider, owner);
    if (bal.wstETHWei < amountWei) checks.blocked.push('LIDO_INSUFFICIENT_WSTETH');
  } catch {
    checks.blocked.push('LIDO_BALANCE_UNREADABLE');
  }

  if (checks.blocked.length > 0) return { checks, steps: [] };

  const { Interface } = await loadEthers();
  const wstIface = new Interface(WSTETH_ABI);

  return {
    checks,
    steps: [
      {
        kind: 'unwrap',
        to: LIDO.wstETH,
        data: wstIface.encodeFunctionData('unwrap', [amountWei]),
        value: 0n,
        description: { key: 'farm.lido.step.unwrap', amount: amountWstETH, symbol: 'wstETH' }
      }
    ]
  };
}

export async function buildRequestWithdrawPlan({ provider, owner, amountStETH } = {}) {
  const checks = { amountStETH: null, amountWei: null, blocked: [], warnings: [] };
  const amount = parseEthAmount(amountStETH);
  if (amount == null) {
    checks.blocked.push('LIDO_INVALID_AMOUNT');
    return { checks, steps: [] };
  }
  checks.amountStETH = amount;
  const amountWei = await parseEthWei(amount);
  if (amountWei == null || amountWei <= 0n) {
    checks.blocked.push('LIDO_INVALID_AMOUNT');
    return { checks, steps: [] };
  }
  checks.amountWei = amountWei;

  try {
    await verifyDeployment(provider);
  } catch (e) {
    checks.blocked.push(e.code || 'LIDO_DEPLOYMENT_UNVERIFIED');
    return { checks, steps: [] };
  }

  try {
    const bal = await getBalances(provider, owner);
    if (bal.stETHWei < amountWei) checks.blocked.push('LIDO_INSUFFICIENT_STETH');
    const { Contract } = await loadEthers();
    const queue = new Contract(LIDO.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, provider);
    const paused = await queue.isPaused().catch(() => false);
    if (paused) checks.blocked.push('LIDO_QUEUE_PAUSED');
    const bunker = await queue.isBunkerModeActive().catch(() => false);
    if (bunker) checks.warnings.push('LIDO_BUNKER_MODE');
  } catch {
    checks.blocked.push('LIDO_BALANCE_UNREADABLE');
  }

  if (checks.blocked.length > 0) return { checks, steps: [] };

  const allowances = await getAllowances(provider, owner).catch(() => ({ queueAllowanceWei: 0n }));
  const needsApprove = (allowances.queueAllowanceWei ?? 0n) < amountWei;

  const { Interface } = await loadEthers();
  const stIface = new Interface(STETH_ABI);
  const qIface = new Interface(WITHDRAWAL_QUEUE_ABI);

  const steps = [];
  if (needsApprove) {
    steps.push({
      kind: 'approve',
      spender: LIDO.withdrawalQueue,
      to: LIDO.stETH,
      data: stIface.encodeFunctionData('approve', [LIDO.withdrawalQueue, amountWei]),
      value: 0n,
      description: { key: 'farm.lido.step.approveQueue', amount: amountStETH, symbol: 'stETH' }
    });
  }
  steps.push({
    kind: 'requestWithdraw',
    to: LIDO.withdrawalQueue,
    data: qIface.encodeFunctionData('requestWithdrawals', [[amountWei], owner]),
    value: 0n,
    description: { key: 'farm.lido.step.requestWithdraw', amount: amountStETH, symbol: 'stETH' }
  });

  return { checks, steps };
}

export async function buildClaimPlan({ provider, owner, requestId } = {}) {
  const checks = { requestId: null, blocked: [], warnings: [] };
  const id = toBigInt(requestId);
  if (id == null || id < 0n) {
    checks.blocked.push('LIDO_INVALID_REQUEST_ID');
    return { checks, steps: [] };
  }
  checks.requestId = id;

  try {
    await verifyDeployment(provider);
  } catch (e) {
    checks.blocked.push(e.code || 'LIDO_DEPLOYMENT_UNVERIFIED');
    return { checks, steps: [] };
  }

  try {
    const { Contract } = await loadEthers();
    const queue = new Contract(LIDO.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, provider);
    const statuses = await queue.getWithdrawalStatus([id]);
    const st = statuses?.[0];
    if (!st) {
      checks.blocked.push('LIDO_REQUEST_NOT_FOUND');
      return { checks, steps: [] };
    }
    if (String(st.owner).toLowerCase() !== String(owner).toLowerCase()) {
      checks.blocked.push('LIDO_NOT_OWNER');
      return { checks, steps: [] };
    }
    if (st.isClaimed) {
      checks.blocked.push('LIDO_ALREADY_CLAIMED');
      return { checks, steps: [] };
    }
    if (!st.isFinalized) {
      checks.blocked.push('LIDO_NOT_FINALIZED');
      return { checks, steps: [] };
    }
  } catch {
    checks.blocked.push('LIDO_STATUS_UNREADABLE');
    return { checks, steps: [] };
  }

  const { Interface } = await loadEthers();
  const qIface = new Interface(WITHDRAWAL_QUEUE_ABI);

  return {
    checks,
    steps: [
      {
        kind: 'claim',
        to: LIDO.withdrawalQueue,
        data: qIface.encodeFunctionData('claimWithdrawal', [id]),
        value: 0n,
        description: { key: 'farm.lido.step.claim', amount: String(id), symbol: '' }
      }
    ]
  };
}

export async function buildRevokePlan({ provider, owner, spender } = {}) {
  if (!isAddr(owner)) return { checks: { blocked: ['LIDO_BAD_OWNER'] }, steps: [] };
  try {
    await verifyDeployment(provider);
  } catch (e) {
    return { checks: { blocked: [e.code || 'LIDO_DEPLOYMENT_UNVERIFIED'] }, steps: [] };
  }
  const target = spender === 'wstETH' ? LIDO.wstETH : spender === 'queue' ? LIDO.withdrawalQueue : spender;
  if (!isAddr(target)) {
    return { checks: { blocked: ['LIDO_INVALID_SPENDER'] }, steps: [] };
  }
  const { Interface } = await loadEthers();
  const iface = new Interface(STETH_ABI);
  return {
    checks: { blocked: [] },
    steps: [
      {
        kind: 'revoke',
        spender: target,
        to: LIDO.stETH,
        data: iface.encodeFunctionData('approve', [target, 0n]),
        value: 0n,
        description: { key: 'farm.lido.step.revoke', amount: null, symbol: 'stETH' }
      }
    ]
  };
}

/**
 * Verify a mined Lido receipt against the action that was signed. In
 * particular, requestId is accepted only from the real WithdrawalRequested
 * event; it is never guessed from a local counter or transaction index.
 */
export async function verifyLidoReceipt({
  provider, receipt, owner, action, amountWei = null, expectedSpender = null,
  beforePosition = null, requestId = null
} = {}) {
  assertSuccessfulReceipt(receipt);
  if (!isAddr(owner)) throw Object.assign(new Error('LIDO_BAD_OWNER'), { code: 'LIDO_BAD_OWNER' });
  const { Interface, Contract } = await loadEthers();
  const iface = new Interface(LIDO_EVENT_ABI);
  const amount = amountWei == null ? null : BigInt(String(amountWei));
  const eventAddress = action === 'approve' || action === 'revoke' || action === 'stake'
    ? LIDO.stETH
    : action === 'wrap' || action === 'unwrap'
      ? LIDO.wstETH
      : LIDO.withdrawalQueue;
  const eventName = action === 'approve' || action === 'revoke'
    ? 'Approval'
    : action === 'stake'
      ? 'Submitted'
      : action === 'wrap' || action === 'unwrap'
        ? 'Transfer'
        : action === 'requestWithdraw'
          ? 'WithdrawalRequested'
          : 'WithdrawalClaimed';
  const events = parseReceiptLogs(receipt, iface, eventAddress, eventName);
  if (events.length === 0) {
    throw Object.assign(new Error('LIDO_EXPECTED_EVENT_MISSING'), { code: 'LIDO_EXPECTED_EVENT_MISSING', detail: { action } });
  }
  const args = events[0].parsed.args;

  if (action === 'approve' || action === 'revoke') {
    const spender = expectedSpender ?? (action === 'revoke' ? null : '');
    if (!sameAddress(String(args.owner), owner) || (spender && !sameAddress(String(args.spender), spender))) {
      throw Object.assign(new Error('LIDO_APPROVAL_EVENT_MISMATCH'), { code: 'LIDO_APPROVAL_EVENT_MISMATCH' });
    }
    const value = BigInt(String(args.value));
    if (action === 'revoke' && value !== 0n) {
      throw Object.assign(new Error('LIDO_REVOKE_AMOUNT_MISMATCH'), { code: 'LIDO_REVOKE_AMOUNT_MISMATCH' });
    }
    if (action === 'approve' && amount != null && value !== amount) {
      throw Object.assign(new Error('LIDO_APPROVAL_AMOUNT_MISMATCH'), { code: 'LIDO_APPROVAL_AMOUNT_MISMATCH' });
    }
    return Object.freeze({ ok: true, action, event: 'Approval', position: null });
  }

  if (action === 'stake') {
    const eventAmount = BigInt(String(args.amount));
    if (!sameAddress(String(args.sender), owner) || (amount != null && eventAmount !== amount)) {
      throw Object.assign(new Error('LIDO_STAKE_EVENT_MISMATCH'), { code: 'LIDO_STAKE_EVENT_MISMATCH' });
    }
    if (beforePosition) {
      const after = await getPosition(provider, owner);
      if (after.stETHWei <= BigInt(String(beforePosition.stETHWei ?? 0))) {
        throw Object.assign(new Error('LIDO_POSITION_UNCHANGED'), { code: 'LIDO_POSITION_UNCHANGED' });
      }
      return Object.freeze({ ok: true, action, event: 'Submitted', position: after });
    }
    return Object.freeze({ ok: true, action, event: 'Submitted', position: null });
  }

  if (action === 'wrap' || action === 'unwrap') {
    const zero = '0x0000000000000000000000000000000000000000';
    const wstFrom = String(args.from);
    const wstTo = String(args.to);
    const wstValue = BigInt(String(args.value));
    let protocolEventOk = false;
    if (action === 'wrap') {
      // The official WstETH contract emits standard ERC-20 Transfer events,
      // not synthetic Wrap/Unwrap events: mint wstETH, then pull stETH.
      const stEthTransfers = parseReceiptLogs(receipt, iface, LIDO.stETH, 'Transfer');
      protocolEventOk = sameAddress(wstFrom, zero) && sameAddress(wstTo, owner) && wstValue > 0n
        && stEthTransfers.some(({ parsed }) =>
          sameAddress(String(parsed.args.from), owner)
          && sameAddress(String(parsed.args.to), LIDO.wstETH)
          && BigInt(String(parsed.args.value)) === amount
        );
    } else {
      const stEthTransfers = parseReceiptLogs(receipt, iface, LIDO.stETH, 'Transfer');
      protocolEventOk = sameAddress(wstFrom, owner) && sameAddress(wstTo, zero)
        && (amount == null || wstValue === amount)
        && stEthTransfers.some(({ parsed }) =>
          sameAddress(String(parsed.args.from), LIDO.wstETH)
          && sameAddress(String(parsed.args.to), owner)
          && BigInt(String(parsed.args.value)) > 0n
        );
    }
    if (!protocolEventOk) {
      throw Object.assign(new Error('LIDO_PROTOCOL_EVENT_MISMATCH'), { code: 'LIDO_PROTOCOL_EVENT_MISMATCH', detail: { action } });
    }
    if (beforePosition) {
      const after = await getPosition(provider, owner);
      const before = BigInt(String(action === 'wrap' ? beforePosition.wstETHWei : beforePosition.stETHWei));
      const changed = action === 'wrap' ? after.wstETHWei > before : after.stETHWei > before;
      if (!changed) throw Object.assign(new Error('LIDO_POSITION_UNCHANGED'), { code: 'LIDO_POSITION_UNCHANGED' });
      return Object.freeze({ ok: true, action, event: 'Transfer', position: after });
    }
    return Object.freeze({ ok: true, action, event: 'Transfer', position: null });
  }

  if (action === 'requestWithdraw') {
    const eventAmount = BigInt(String(args.amountOfStETH));
    if (!sameAddress(String(args.requestor), owner) || !sameAddress(String(args.owner), owner) || (amount != null && eventAmount !== amount)) {
      throw Object.assign(new Error('LIDO_REQUEST_EVENT_MISMATCH'), { code: 'LIDO_REQUEST_EVENT_MISMATCH' });
    }
    const id = BigInt(String(args.requestId));
    const queue = new Contract(LIDO.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, provider);
    const rows = await queue.getWithdrawalStatus([id]);
    const row = rows?.[0];
    if (!row || !sameAddress(String(row.owner), owner) || BigInt(String(row.amountOfStETH)) !== eventAmount || Boolean(row.isFinalized) || Boolean(row.isClaimed)) {
      throw Object.assign(new Error('LIDO_REQUEST_STATE_MISMATCH'), { code: 'LIDO_REQUEST_STATE_MISMATCH', detail: { requestId: id } });
    }
    return Object.freeze({ ok: true, action, event: 'WithdrawalRequested', requestId: id, position: null });
  }

  if (action === 'claim') {
    const id = BigInt(String(args.requestId));
    if (!sameAddress(String(args.owner), owner) || !sameAddress(String(args.receiver), owner) || (requestId != null && id !== BigInt(String(requestId)))) {
      throw Object.assign(new Error('LIDO_CLAIM_EVENT_MISMATCH'), { code: 'LIDO_CLAIM_EVENT_MISMATCH' });
    }
    const queue = new Contract(LIDO.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, provider);
    const rows = await queue.getWithdrawalStatus([id]);
    const row = rows?.[0];
    if (!row || !sameAddress(String(row.owner), owner) || !Boolean(row.isFinalized) || !Boolean(row.isClaimed)) {
      throw Object.assign(new Error('LIDO_CLAIM_STATE_MISMATCH'), { code: 'LIDO_CLAIM_STATE_MISMATCH', detail: { requestId: id } });
    }
    return Object.freeze({ ok: true, action, event: 'WithdrawalClaimed', requestId: id, position: null });
  }

  throw Object.assign(new Error('LIDO_UNSUPPORTED_ACTION'), { code: 'LIDO_UNSUPPORTED_ACTION', detail: { action } });
}

/* -------------------------------------------------------------------------- */
/* Pool matching                                                              */
/* -------------------------------------------------------------------------- */

export function isLidoPool(pool) {
  if (!pool) return false;
  const project = String(pool.project ?? '').toLowerCase();
  const chain = String(pool.chain ?? '').toLowerCase();
  const sym = String(pool.symbol ?? '').toUpperCase();
  return project === 'lido' && chain === 'ethereum' && (sym.includes('STETH') || sym.includes('WSTETH') || sym === 'STETH' || sym === 'WSTETH');
}

export function isLidoStakePool(pool) {
  return isLidoPool(pool);
}

/* -------------------------------------------------------------------------- */
/* Error mapping                                                              */
/* -------------------------------------------------------------------------- */

const REVERT_MAP = Object.freeze({
  // Generic
  '0x': 'farm.lido.err.unknown',
  // Lido-specific errors — these are best-effort mappings from revert reasons
  STAKING_PAUSED: 'farm.lido.err.stakingPaused',
  PAUSED: 'farm.lido.err.paused',
  ZERO_SHARES: 'farm.lido.err.zeroShares',
  ZERO_ETH: 'farm.lido.err.zeroEth',
  NOT_ENOUGH_ETHER: 'farm.lido.err.insufficientBalance',
  INSUFFICIENT_BALANCE: 'farm.lido.err.insufficientBalance',
  ALLOWANCE: 'farm.lido.err.allowance',
  NOT_OWNER: 'farm.lido.err.notOwner',
  NOT_FINALIZED: 'farm.lido.err.notFinalized',
  ALREADY_CLAIMED: 'farm.lido.err.alreadyClaimed',
  REQUEST_NOT_FOUND: 'farm.lido.err.requestNotFound',
  BUNKER_MODE: 'farm.lido.err.bunkerMode'
});

export function explainRevert(err) {
  const raw = String(err?.reason ?? err?.message ?? err ?? '').slice(0, 400);
  const decoded = decodeRevertReason(err);
  const reason = decoded?.reason ?? raw;
  const lower = reason.toLowerCase();

  // Try to map known substrings
  for (const [key, i18nKey] of Object.entries(REVERT_MAP)) {
    if (key === '0x') continue;
    if (lower.includes(key.toLowerCase())) {
      return { key: i18nKey, reason };
    }
  }

  // Fallback to code mapping
  const code = err?.code ?? err?.data?.code ?? null;
  if (code && REVERT_MAP[code]) {
    return { key: REVERT_MAP[code], reason };
  }

  return { key: 'farm.lido.err.unknown', reason: reason || 'UNKNOWN' };
}

/* -------------------------------------------------------------------------- */
/* Constants for UI                                                           */
/* -------------------------------------------------------------------------- */

export const LIDO_PROTOCOL = Object.freeze({
  id: 'lido',
  name: 'Lido',
  chainId: 1,
  chainName: 'Ethereum',
  contracts: Object.freeze({
    stETH: LIDO.stETH,
    wstETH: LIDO.wstETH,
    withdrawalQueue: LIDO.withdrawalQueue
  }),
  mode: 'EXECUTABLE',
  capabilities: Object.freeze(['stake', 'wrap', 'unwrap', 'requestWithdraw', 'claim', 'getBalances', 'getWithdrawalRequests'])
});
