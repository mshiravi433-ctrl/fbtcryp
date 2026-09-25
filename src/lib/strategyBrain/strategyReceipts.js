/**
 * A strategy handoff is not a financial confirmation. The URL and the local
 * receipt hint only identify a candidate transaction to LOOK UP; neither may
 * advance a stage. On return the connected wallet's read provider must supply
 * a successful receipt plus matching transaction and protocol/token events
 * for every signed action. Aave USDC supply and USDC→ERC-20 swaps have
 * independent verifiers; other venues (and native-coin outputs) remain pending
 * until they have equally specific reconciliation. A hash is not sufficient.
 */
import { Interface, parseUnits } from 'ethers';
import { AAVE_V3_POOLS, lendingAssetsFor } from '../lending.js';
import { TOKENS } from '../chains.js';
import { defaultStorage, loadStrategyPlan } from './strategyStore.js';

export const STRATEGY_RECEIPT_HINTS_KEY = 'fbt.strategy-brain.receipt-hints.v1';
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SUPPORTED_VENUES = Object.freeze({ 'aave-base': 8453, 'aave-arbitrum': 42161 });
const AAVE_EVENTS = new Interface([
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)'
]);
const AAVE_SUPPLY = new Interface([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
]);
const ERC20_EVENTS = new Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)'
]);
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

function findAction(record, stageId, actionIndex) {
  const stage = record?.strategy?.stages?.find((s) => s.id === stageId);
  if (!stage?.movesFunds || record?.runtime?.stageProgress?.[stageId]?.state !== 'RUNNING') return null;
  const action = stage.actions?.[actionIndex];
  return action?.requiresSignature ? action : null;
}

/** Route metadata is an identifier, NEVER an authorization or signature. */
export function strategyActionRoute(action, { strategyId, stageId, actionIndex } = {}) {
  const route = String(action?.route || '');
  if (!route.startsWith('/') || route.startsWith('//') || !action?.requiresSignature
    || !strategyId || !stageId || !Number.isSafeInteger(actionIndex) || actionIndex < 0) return route;
  const url = new URL(route, 'https://app.invalid');
  url.searchParams.set('strategyId', String(strategyId));
  url.searchParams.set('stageId', String(stageId));
  url.searchParams.set('actionIndex', String(actionIndex));
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Only the swap screen's curated USDC→ERC-20 route is reconcilable from
 * standard logs. Native-coin output, cross-chain swaps, unlisted addresses
 * and arbitrary stock/forex links have no token Transfer to prove acquisition. */
function swapSpec(action) {
  if (action?.capabilityId !== 'swap.quote' || action?.operation !== 'BUY'
    || !action?.route?.startsWith('/swap?')) return null;
  const route = new URL(action.route, 'https://app.invalid');
  const chainId = Number(route.searchParams.get('chain'));
  const target = String(action.params?.asset || '').toUpperCase();
  if (!Number.isSafeInteger(chainId) || chainId <= 0
    || !Number.isFinite(Number(action.params?.amountUsd)) || Number(action.params.amountUsd) <= 0
    || (action.params?.chainId != null && Number(action.params.chainId) !== chainId)
    || route.searchParams.get('from') !== 'USDC'
    || route.searchParams.get('to')?.toUpperCase() !== target || target === 'USDC'
    || (route.searchParams.has('amount') && Number(route.searchParams.get('amount')) !== Number(action.params.amountUsd))) return null;
  const tokens = TOKENS[chainId] || [];
  const usdc = tokens.find((t) => t.symbol === 'USDC' && ADDRESS.test(t.address || '') && !t.native);
  const bought = tokens.find((t) => t.symbol.toUpperCase() === target && ADDRESS.test(t.address || '') && !t.native);
  return usdc && bought ? { chainId, usdc, bought } : null;
}

function actionChain(action) {
  return action?.capabilityId === 'swap.quote' ? swapSpec(action)?.chainId
    : SUPPORTED_VENUES[String(action?.params?.venue || '')];
}

/** A venue being executable is distinct from being automatically reconcilable.
 * Use the same predicate in the card, start button, recorder and verifier. */
export function strategyReceiptSupport(action) {
  if (action?.capabilityId === 'lending.supply' && action.operation === 'SUPPLY'
    && action.route?.split('?')[0] === '/loan'
    && String(action.params?.asset).toUpperCase() === 'USDC'
    && Number.isFinite(Number(action.params?.amountUsd)) && Number(action.params.amountUsd) > 0
    && Number(action.params?.chainId) === actionChain(action)
    && lendingAssetsFor(actionChain(action)).some((a) => a.symbol === 'USDC')) {
    const query = new URL(action.route, 'https://app.invalid').searchParams;
    if (query.get('tab') !== 'supply' || query.get('asset')?.toUpperCase() !== 'USDC'
      || Number(query.get('chain')) !== actionChain(action)
      || Number(query.get('amount')) !== Number(action.params.amountUsd)) return null;
    return 'aave-supply';
  }
  if (swapSpec(action)) return 'erc20-swap';
  return null;
}

function readHints(store) {
  try {
    const parsed = JSON.parse(store?.getItem(STRATEGY_RECEIPT_HINTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-24) : [];
  } catch { return []; }
}

/** Write ONLY after the venue got a successful receipt. This remains an
 * untrusted localStorage locator: the read provider rechecks everything. */
export function recordStrategyReceiptHint({
  strategyId, stageId, actionIndex, txHash, owner, chainId, asset, amountWei,
  store = defaultStorage(), now = Date.now()
} = {}) {
  if (!HASH.test(String(txHash || '')) || !ADDRESS.test(String(owner || ''))
    || !Number.isSafeInteger(Number(actionIndex)) || Number(actionIndex) < 0) return { ok: false, code: 'INVALID_HINT' };
  const record = loadStrategyPlan(strategyId, { store });
  const action = findAction(record, stageId, Number(actionIndex));
  const expectedChain = actionChain(action);
  const support = strategyReceiptSupport(action);
  const isSupply = support === 'aave-supply';
  const swap = support === 'erc20-swap' ? swapSpec(action) : null;
  if (!action || (!isSupply && !swap) || !expectedChain || expectedChain !== Number(chainId)
    || String(asset).toUpperCase() !== (isSupply ? 'USDC' : swap?.bought?.symbol?.toUpperCase())
    || !/^[1-9]\d*$/.test(String(amountWei || ''))) return { ok: false, code: 'ACTION_MISMATCH' };
  const usdc = isSupply ? lendingAssetsFor(expectedChain).find((a) => a.symbol === 'USDC') : swap.usdc;
  if (!usdc || !matchingAmount(amountWei, action.params.amountUsd, usdc.decimals)) return { ok: false, code: 'AMOUNT_MISMATCH' };
  const hint = {
    strategyId, stageId, actionIndex: Number(actionIndex),
    txHash: String(txHash).toLowerCase(), owner: String(owner).toLowerCase(),
    chainId: expectedChain, at: now
  };
  const rows = readHints(store).filter((r) =>
    r.strategyId !== strategyId || r.stageId !== stageId || r.actionIndex !== hint.actionIndex);
  rows.push(hint);
  try { store?.setItem(STRATEGY_RECEIPT_HINTS_KEY, JSON.stringify(rows.slice(-24))); }
  catch { return { ok: false, code: 'STORE_UNAVAILABLE' }; }
  return { ok: true, hint };
}

async function checkStageBlock(provider, receipt, startedAt) {
  if (startedAt == null) return { ok: true }; // independent verifier use; reconciler always passes a start
  // A matching *old* transaction is not an execution of this stage. Clock
  // granularity/L2 drift gets a 30s grace; an earlier block cannot be
  // repurposed to unlock a later stage.
  if (!Number.isFinite(Number(startedAt)) || Number(startedAt) <= 0
    || typeof provider.getBlock !== 'function') return { ok: false, code: 'STAGE_TIME_UNAVAILABLE' };
  const block = await provider.getBlock(Number(receipt.blockNumber));
  const at = Number(block?.timestamp) * 1000;
  if (!Number.isFinite(at) || at <= 0) return { ok: false, code: 'BLOCK_TIME_UNAVAILABLE' };
  if (at < Number(startedAt) - 30_000 || at > Date.now() + 30_000) {
    return { ok: false, code: 'TRANSACTION_BEFORE_STAGE' };
  }
  return { ok: true };
}

function matchingAmount(actual, usd, decimals) {
  try {
    if (!Number.isFinite(Number(usd)) || Number(usd) <= 0) return false;
    const expected = parseUnits(String(usd), decimals);
    const value = BigInt(actual);
    // USDC is close to $1 but not a promise of a peg. A very small tolerance
    // permits a user's quoted input to differ by up to 0.5%; unrelated dust or
    // a prior full-size deposit must not satisfy a different plan action.
    const tolerance = expected / 200n + 1n;
    return value > 0n && value >= expected - tolerance && value <= expected + tolerance;
  } catch { return false; }
}

/** Match chain, signer, target pool, calldata AND emitted Supply event. */
export async function verifyAaveStrategySupply({ action, txHash, owner, provider, startedAt = null } = {}) {
  const chainId = Number(action?.params?.chainId);
  const venue = String(action?.params?.venue || '');
  const pool = AAVE_V3_POOLS[chainId];
  const usdc = lendingAssetsFor(chainId).find((a) => a.symbol === 'USDC');
  if (!HASH.test(String(txHash || '')) || !ADDRESS.test(String(owner || '')) || !provider
    || !pool || !usdc || SUPPORTED_VENUES[venue] !== chainId || action?.capabilityId !== 'lending.supply'
    || String(action?.params?.asset).toUpperCase() !== 'USDC') return { ok: false, code: 'UNSUPPORTED_ACTION' };
  try {
    const network = await provider.getNetwork();
    if (Number(network?.chainId) !== chainId) return { ok: false, code: 'WRONG_PROVIDER_CHAIN' };
    const [receipt, tx] = await Promise.all([
      provider.getTransactionReceipt(txHash), provider.getTransaction(txHash)
    ]);
    if (!receipt || !tx) return { ok: false, code: 'RECEIPT_PENDING' };
    if (Number(receipt.status) !== 1 || !Number.isInteger(Number(receipt.blockNumber))
      || Number(receipt.blockNumber) <= 0 || !same(receipt.hash ?? receipt.transactionHash, txHash)
      || !same(tx.hash, txHash) || !same(tx.from, owner) || !same(tx.to, pool)
      || (receipt.from && !same(receipt.from, owner)) || (receipt.to && !same(receipt.to, pool))) {
      return { ok: false, code: 'RECEIPT_MISMATCH' };
    }
    const call = AAVE_SUPPLY.parseTransaction({ data: tx.data ?? tx.input, value: tx.value ?? 0 });
    if (call?.name !== 'supply' || !same(call.args[0], usdc.address)
      || !same(call.args[2], owner) || !matchingAmount(call.args[1], action.params.amountUsd, usdc.decimals)) {
      return { ok: false, code: 'SUPPLY_MISMATCH' };
    }
    const event = (receipt.logs || []).some((log) => {
      if (!same(log.address, pool)) return false;
      try {
        const parsed = AAVE_EVENTS.parseLog(log);
        return parsed?.name === 'Supply' && same(parsed.args.reserve, usdc.address)
          && same(parsed.args.user, owner) && same(parsed.args.onBehalfOf, owner)
          && parsed.args.amount === call.args[1];
      } catch { return false; }
    });
    if (!event) return { ok: false, code: 'SUPPLY_EVENT_MISSING' };
    const time = await checkStageBlock(provider, receipt, startedAt);
    if (!time.ok) return time;
    return { ok: true, verified: true, capabilityId: action.capabilityId,
      txHash: txHash.toLowerCase(), chainId, blockNumber: Number(receipt.blockNumber),
      asset: 'USDC', amountWei: String(call.args[1]), wallet: owner.toLowerCase() };
  } catch {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  }
}

/** A swap needs BOTH the planned USDC debit and the acquired ERC-20 credit
 * inside one successful transaction FROM this wallet. A quote, tx hash,
 * allowance, or generic successful aggregator call alone proves no purchase.
 * This proves acquired quantity, NOT its USD value or a strategy profit. */
export async function verifyStrategySwap({ action, txHash, owner, provider, startedAt = null } = {}) {
  const spec = swapSpec(action);
  if (!spec || !HASH.test(String(txHash || '')) || !ADDRESS.test(String(owner || '')) || !provider) {
    return { ok: false, code: 'UNSUPPORTED_ACTION' };
  }
  try {
    const network = await provider.getNetwork();
    if (Number(network?.chainId) !== spec.chainId) return { ok: false, code: 'WRONG_PROVIDER_CHAIN' };
    const [receipt, tx] = await Promise.all([
      provider.getTransactionReceipt(txHash), provider.getTransaction(txHash)
    ]);
    if (!receipt || !tx) return { ok: false, code: 'RECEIPT_PENDING' };
    if (Number(receipt.status) !== 1 || !Number.isInteger(Number(receipt.blockNumber))
      || Number(receipt.blockNumber) <= 0 || !same(receipt.hash ?? receipt.transactionHash, txHash)
      || !same(tx.hash, txHash) || !same(tx.from, owner) || !ADDRESS.test(String(tx.to || ''))
      || !/^0x[0-9a-f]{8,}$/i.test(String(tx.data ?? tx.input ?? ''))
      || (receipt.from && !same(receipt.from, owner)) || (receipt.to && !same(receipt.to, tx.to))) {
      return { ok: false, code: 'RECEIPT_MISMATCH' };
    }
    let paidWei = 0n;
    let acquiredWei = 0n;
    for (const log of receipt.logs || []) {
      if (!same(log.address, spec.usdc.address) && !same(log.address, spec.bought.address)) continue;
      try {
        const decoded = ERC20_EVENTS.parseLog(log);
        if (decoded?.name !== 'Transfer') continue;
        if (same(log.address, spec.usdc.address) && same(decoded.args.from, owner)) paidWei += decoded.args.value;
        if (same(log.address, spec.bought.address) && same(decoded.args.to, owner)) acquiredWei += decoded.args.value;
      } catch { /* another event from a token contract */ }
    }
    if (!matchingAmount(paidWei, action.params.amountUsd, spec.usdc.decimals)) {
      return { ok: false, code: 'SWAP_INPUT_MISMATCH' };
    }
    if (acquiredWei <= 0n) return { ok: false, code: 'SWAP_OUTPUT_MISSING' };
    const time = await checkStageBlock(provider, receipt, startedAt);
    if (!time.ok) return time;
    return { ok: true, verified: true, capabilityId: action.capabilityId,
      txHash: txHash.toLowerCase(), chainId: spec.chainId, blockNumber: Number(receipt.blockNumber),
      asset: spec.bought.symbol, amountWei: String(paidWei), acquiredWei: String(acquiredWei),
      wallet: owner.toLowerCase() };
  } catch {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  }
}

/** Re-read ALL signed legs, including those saved before a reload. A local
 * "verified: true" flag, if present, is NEVER accepted as evidence. */
export async function reconcileStrategyReceipts({ strategy, stageId, owner, getProvider,
  store = defaultStorage() } = {}) {
  const record = loadStrategyPlan(strategy?.strategyId, { store });
  const stage = strategy?.stages?.find((s) => s.id === stageId);
  const signed = (stage?.actions || []).filter((a) => a.requiresSignature);
  const savedStage = record?.strategy?.stages?.find((s) => s.id === stageId);
  const startedAt = Number(record?.runtime?.stageProgress?.[stageId]?.startedAt);
  if (!record || !stage?.movesFunds || !signed.length || !ADDRESS.test(String(owner || ''))
    || typeof getProvider !== 'function' || !Number.isFinite(startedAt) || startedAt <= 0
    || savedStage?.actions?.length !== stage.actions.length
    || signed.some((a) => {
      const saved = findAction(record, stageId, stage.actions.indexOf(a));
      return !saved || saved.capabilityId !== a.capabilityId || saved.route !== a.route
        || JSON.stringify(saved.params) !== JSON.stringify(a.params);
    })) {
    return { ok: false, code: 'RUNNING_STAGE_AND_WALLET_REQUIRED' };
  }
  const hints = readHints(store);
  const proofs = [];
  const missing = [];
  const used = new Set();
  for (const action of signed) {
    const index = stage.actions.indexOf(action);
    const support = strategyReceiptSupport(action);
    if (!support) { missing.push({ actionIndex: index, code: 'ACTION_NOT_VERIFIABLE' }); continue; }
    const hint = hints.find((r) => r.strategyId === strategy.strategyId && r.stageId === stageId && r.actionIndex === index);
    const chainId = actionChain(action);
    if (!hint || !HASH.test(String(hint.txHash || '')) || !same(hint.owner, owner)
      || !chainId || Number(hint.chainId) !== chainId) {
      missing.push({ actionIndex: index, code: 'RECEIPT_HINT_MISSING' });
      continue;
    }
    if (used.has(hint.txHash)) { missing.push({ actionIndex: index, code: 'RECEIPT_REUSED' }); continue; }
    used.add(hint.txHash);
    let proof;
    try {
      const provider = await getProvider(chainId);
      const verify = support === 'erc20-swap' ? verifyStrategySwap : verifyAaveStrategySupply;
      proof = await verify({ action, txHash: hint.txHash, owner, provider, startedAt });
    } catch { proof = { ok: false, code: 'PROVIDER_UNAVAILABLE' }; }
    if (proof.ok) proofs.push(proof);
    else missing.push({ actionIndex: index, code: proof.code });
  }
  if (missing.length) return { ok: false, code: 'AWAITING_VERIFIED_RECEIPTS',
    verifiedCount: proofs.length, requiredCount: signed.length, missing };
  return { ok: true, receipt: { verified: true, actions: proofs, checkedAt: Date.now() } };
}
