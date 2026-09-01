/**
 * LENDING BFF — the read/build API behind the Lending page.
 * ---------------------------------------------------------------------------
 * Production spec §6/§7/§29/§30. This module is a BFF, not a relayer and not
 * a custodian:
 *
 *   · every endpoint is READ or BUILD — the server returns unsigned calldata
 *     and the user's wallet signs. The backend CANNOT move funds: there is no
 *     key, no signer, no broadcast call anywhere in this file (§30).
 *   · all on-chain reads go through multi-RPC failover (§26): endpoints are
 *     tried in order, the circuit breaker records every failure, and a
 *     sustained outage flips lending into READ_ONLY instead of returning
 *     garbage (§27/§28).
 *   · market data is cached for a short window (§25); positions are ALWAYS
 *     re-verified against the chain on request — never served from cache.
 *   · POST routes require an Idempotency-Key header (§17) and replay a stored
 *     result instead of rebuilding.
 *   · addresses are allowlisted (§31): a pool or token address that is not in
 *     the audited registry is refused before any RPC is dialed.
 *
 * Sync rule: AAVE_V3_POOLS / RESERVE_SYMBOLS below mirror
 * src/lib/lending.js — server modules never import that file because it
 * pulls the Vite chain registry (import.meta.env) into Node.
 */
import express from 'express';
import { Interface, AbiCoder, getAddress } from 'ethers';
import { EVM_CHAINS, TOKENS } from './chainsLite.js';
import { withCache } from './cache.js';
import { fetchSimplePrices } from './providers.js';
import {
  assessPosition, evaluateAlerts, createCircuitBreaker,
  createIdempotencyStore, makeRequestId, CIRCUIT_STATE
} from '../src/lib/lending-engine/index.js';

/* ── canonical Aave V3 pool addresses (mirror of src/lib/lending.js) ──────── */
const AAVE_V3_POOLS = Object.freeze({
  1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  56: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
  137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
});

/** Reserve symbols per chain (mirror of src/lib/lending.js). A FILTER, not a promise. */
const RESERVE_SYMBOLS = Object.freeze({
  1: ['USDT', 'USDC', 'DAI', 'WBTC', 'LINK'],
  10: ['USDT', 'USDC'],
  56: ['USDT', 'USDC', 'BTCB', 'ETH'],
  137: ['USDT', 'USDC', 'DAI', 'WETH'],
  8453: ['USDC', 'cbBTC'],
  42161: ['USDT', 'USDC', 'WBTC', 'ARB'],
  43114: ['USDT', 'USDC', 'WETH']
});

const POOL_ABI = [
  'function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)'
];
const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31536000;
const BASE_DECIMALS = 8;
const ZERO = '0x0000000000000000000000000000000000000000';

const poolIface = new Interface(POOL_ABI);
const erc20Iface = new Interface(ERC20_ABI);
const coder = AbiCoder.defaultAbiCoder();

const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const safeJson = (res, payload, status = 200) => res.status(status).json(payload);

/* ── runtime state ────────────────────────────────────────────────────────── */

const breaker = createCircuitBreaker({ openThreshold: 3 });
const idempotency = createIdempotencyStore();
/** Unsigned transactions this BFF has BUILT. Never broadcast, never signed. */
const builtTransactions = new Map(); // walletLower → [{...}]
const alertSubscriptions = new Map(); // walletLower → [{ id, rules, at }]

const chainIds = () => Object.keys(AAVE_V3_POOLS).map(Number);
const poolFor = (chainId) => AAVE_V3_POOLS[Number(chainId)] || null;

const walletKey = (wallet) => {
  try { return getAddress(String(wallet || '')).toLowerCase(); } catch { return null; }
};

/** The audited token list for one chain, from chainsLite's registry. */
export function chainTokens(chainId) {
  return (TOKENS[Number(chainId)] || [])
    .filter((token) => token.address && !token.native)
    .filter((token) => (RESERVE_SYMBOLS[Number(chainId)] || []).includes(token.symbol));
}

export function findToken(chainId, assetRef) {
  const tokens = chainTokens(chainId);
  const ref = String(assetRef || '').toLowerCase();
  return tokens.find((token) => token.symbol.toLowerCase() === ref || token.address.toLowerCase() === ref) || null;
}

/* ── JSON-RPC with failover + circuit breaker (§26) ───────────────────────── */
/*
 * `chainTokens`, `findToken`, `rpcWithFailover`, `readReserve`, `readUserAccount`
 * and `oraclePrices` are exported for the Central Intelligence OS adapters
 * (server/ci/sources.js). They were previously private to this BFF, which forced
 * any other reader of the same Aave pools to open its own RPC session and invent
 * its own failover — two sources of truth about one chain. The Central State
 * reads lending through THESE functions so the brain and the /lending page can
 * never disagree about a health factor.
 */

async function rpcOnce(endpoint, method, params, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body?.error) throw new Error(String(body.error.message || body.error.code || 'rpc error'));
    return body?.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Try every endpoint for the chain, in order; report health to the breaker. */
export async function rpcWithFailover(chainId, method, params) {
  const chain = EVM_CHAINS[Number(chainId)];
  const endpoints = (chain?.rpc || []).slice();
  if (!endpoints.length) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const result = await rpcOnce(endpoint, method, params);
      breaker.report('rpc', true);
      return { ok: true, result };
    } catch (error) {
      lastError = error;
      breaker.report('rpc', false, String(error?.message || error).slice(0, 80));
    }
  }
  return { ok: false, code: 'RPC_ERROR', detail: String(lastError?.message || lastError).slice(0, 120) };
}

const ethCall = async (chainId, to, data) => rpcWithFailover(chainId, 'eth_call', [{ to, data }, 'latest']);

/** eth_estimateGas against the caller-provided unsigned transaction. */
async function estimateGas(chainId, tx, from) {
  const res = await rpcWithFailover(chainId, 'eth_estimateGas', [{
    from: from || ZERO,
    to: tx.to,
    data: tx.data,
    value: tx.value || '0x0'
  }]);
  if (!res.ok) return { ok: false, code: 'GAS_ESTIMATION_FAILED' };
  return { ok: true, gas: BigInt(res.result || '0x5208').toString() };
}

/* ── on-chain readers ─────────────────────────────────────────────────────── */

const rayToApyPct = (rateRay) => {
  try {
    const ray = BigInt(rateRay ?? 0);
    if (ray <= 0n) return 0;
    const apr = Number(ray) / Number(RAY);
    const apy = (1 + apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1;
    return Number.isFinite(apy) ? Math.round(apy * 1000000) / 10000 : null;
  } catch { return null; }
};

const baseToUsd = (value) => {
  try { return Number(BigInt(value ?? 0)) / 10 ** BASE_DECIMALS; } catch { return null; }
};

const readHealthFactor = (raw) => {
  try {
    const value = BigInt(raw ?? 0);
    if (value === 0n || value > 10n ** 30n) return null;
    return Number(value) / 1e18;
  } catch { return null; }
};

/**
 * Decode an Aave reserve configuration bitmask: LTV / liquidation threshold /
 * liquidation bonus are bps stored in 16-bit slots (§6 wants exactly these).
 */
function decodeReserveConfig(configuration) {
  const config = BigInt(configuration ?? 0);
  const ltv = Number((config >> 0n) & 0xFFFFn) / 100;
  const liquidationThreshold = Number((config >> 16n) & 0xFFFFn) / 100;
  const liquidationBonus = Number((config >> 32n) & 0xFFFFn) / 100;
  const frozen = ((config >> 57n) & 1n) === 1n;
  const paused = ((config >> 60n) & 1n) === 1n;
  return {
    ltv: ltv > 0 ? ltv : null,
    liquidationThreshold: liquidationThreshold > 0 ? liquidationThreshold : null,
    liquidationBonus,
    status: paused ? 'paused' : frozen ? 'frozen' : 'active'
  };
}

export async function readReserve(chainId, token) {
  const pool = poolFor(chainId);
  if (!pool || !token) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  const res = await ethCall(chainId, pool, poolIface.encodeFunctionData('getReserveData', [token.address]));
  if (!res.ok) return res;
  const decoded = poolIface.decodeFunctionResult('getReserveData', res.result);
  const data = decoded[0];
  const aToken = String(data.aTokenAddress || '');
  const listed = isAddress(aToken) && aToken !== ZERO;
  return {
    ok: true,
    listed,
    symbol: token.symbol,
    address: token.address,
    aTokenAddress: listed ? aToken : null,
    variableDebtTokenAddress: listed ? String(data.variableDebtTokenAddress || '') : null,
    supplyApy: listed ? rayToApyPct(data.currentLiquidityRate) : null,
    borrowApy: listed ? rayToApyPct(data.currentVariableBorrowRate) : null,
    liquidityIndex: data.liquidityIndex.toString(),
    ...decodeReserveConfig(data.configuration)
  };
}

export async function readUserAccount(chainId, wallet) {
  const pool = poolFor(chainId);
  if (!pool || !isAddress(wallet)) return { ok: false, code: 'BAD_REQUEST' };
  const res = await ethCall(chainId, pool, poolIface.encodeFunctionData('getUserAccountData', [wallet]));
  if (!res.ok) return res;
  const data = poolIface.decodeFunctionResult('getUserAccountData', res.result);
  return {
    ok: true,
    totalCollateralUsd: baseToUsd(data[0]),
    totalDebtUsd: baseToUsd(data[1]),
    availableBorrowsUsd: baseToUsd(data[2]),
    liquidationThresholdPct: Number(data[3]) / 100,
    ltvPct: Number(data[4]) / 100,
    healthFactor: readHealthFactor(data[5])
  };
}

async function readTokenBalances(chainId, wallet, token, reserve) {
  const [walletBal, suppliedBal, debtBal] = await Promise.all([
    ethCall(chainId, token.address, erc20Iface.encodeFunctionData('balanceOf', [wallet])),
    reserve?.aTokenAddress
      ? ethCall(chainId, reserve.aTokenAddress, erc20Iface.encodeFunctionData('balanceOf', [wallet]))
      : Promise.resolve({ ok: true, result: '0x0' }),
    reserve?.variableDebtTokenAddress
      ? ethCall(chainId, reserve.variableDebtTokenAddress, erc20Iface.encodeFunctionData('balanceOf', [wallet]))
      : Promise.resolve({ ok: true, result: '0x0' })
  ]);
  return {
    walletWei: walletBal.ok ? String(walletBal.result) : null,
    suppliedWei: suppliedBal.ok ? String(suppliedBal.result) : null,
    debtWei: debtBal.ok ? String(debtBal.result) : null
  };
}

/* ── oracle (§21) — aggregated price with anomaly flagging ────────────────── */

export async function oraclePrices(chainId) {
  const tokens = chainTokens(chainId);
  if (!tokens.length) return { ok: false, code: 'NO_TOKENS' };
  const ids = tokens.map((token) => token.coingeckoId).filter(Boolean);
  if (!ids.length) return { ok: false, code: 'NO_PRICE_IDS' };
  try {
    const prices = await fetchSimplePrices(ids, 'usd');
    const map = {};
    let missing = 0;
    for (const token of tokens) {
      const price = prices?.[token.coingeckoId]?.usd;
      if (Number.isFinite(price) && price > 0) map[token.symbol] = price;
      else missing += 1;
    }
    breaker.report('oracle', true);
    if (missing === tokens.length) return { ok: false, code: 'ORACLE_STALE' };
    return { ok: true, prices: map, status: missing > 0 ? 'partial' : 'ok' };
  } catch (error) {
    breaker.report('oracle', false, String(error?.message || error).slice(0, 80));
    return { ok: false, code: 'ORACLE_STALE' };
  }
}

/* ── transaction builders — UNSIGNED by construction (§30) ────────────────── */

const SUPPLY_SELECTOR = 'supply(address,uint256,address,uint16)';
const WITHDRAW_SELECTOR = 'withdraw(address,uint256,address)';
const BORROW_SELECTOR = 'borrow(address,uint256,uint256,uint16,address)';
const REPAY_SELECTOR = 'repay(address,uint256,uint256,address)';
const APPROVE_SELECTOR = 'approve(address,uint256)';
const VARIABLE_RATE_MODE = 2;
const REFERRAL = 0;

function buildActionTx({ action, chainId, token, amountWei, wallet, plan }) {
  const pool = poolFor(chainId);
  const txs = [];
  if (plan.approve) {
    txs.push({
      kind: 'approve',
      to: token.address,
      data: erc20Iface.encodeFunctionData(APPROVE_SELECTOR, [pool, plan.approve]),
      value: '0x0'
    });
  }
  let data;
  if (action === 'supply') data = poolIface.encodeFunctionData(SUPPLY_SELECTOR, [token.address, amountWei, wallet, REFERRAL]);
  else if (action === 'borrow') data = poolIface.encodeFunctionData(BORROW_SELECTOR, [token.address, amountWei, VARIABLE_RATE_MODE, REFERRAL, wallet]);
  else if (action === 'repay') data = poolIface.encodeFunctionData(REPAY_SELECTOR, [token.address, amountWei, VARIABLE_RATE_MODE, wallet]);
  else if (action === 'withdraw') data = poolIface.encodeFunctionData(WITHDRAW_SELECTOR, [token.address, amountWei, wallet]);
  else return { ok: false, code: 'BAD_ACTION' };
  txs.push({ kind: action, to: pool, data, value: '0x0' });
  return { ok: true, txs };
}

/* ── the router ───────────────────────────────────────────────────────────── */

export function lendingRouter() {
  const router = express.Router();
  router.use(express.json());

  /** §27/§28: circuit + read-only status, for the UI banner. */
  router.get('/status', (req, res) => {
    safeJson(res, {
      data: breaker.snapshot(),
      meta: { schema: 'fbt.lending-status.v1', dataStatus: 'live', generatedAt: new Date().toISOString() }
    });
  });

  /** §5/§29: network registry with feature flags. */
  router.get('/networks', (req, res) => {
    safeJson(res, {
      data: chainIds().map((chainId) => {
        const chain = EVM_CHAINS[chainId] || {};
        return {
          chainId,
          name: chain.name || `#${chainId}`,
          nativeToken: chain.native?.symbol || null,
          rpcCount: (chain.rpc || []).length,
          explorer: chain.explorer || null,
          protocols: ['aave-v3'],
          oracle: 'aave-oracle',
          enabled: Boolean(AAVE_V3_POOLS[chainId]),
          pool: AAVE_V3_POOLS[chainId]
        };
      }),
      meta: { schema: 'fbt.lending-networks.v1', dataStatus: 'live' }
    });
  });

  /** §6: live markets — pool rates, risk parameters, oracle prices. */
  router.get('/markets', async (req, res) => {
    const chainId = Number(req.query.network || 42161);
    const pool = poolFor(chainId);
    if (!pool) return safeJson(res, { error: { code: 'UNSUPPORTED_CHAIN', message: 'Lending is not wired on this network' } }, 404);

    const cacheKey = `lending:markets:${chainId}`;
    const payload = await withCache(cacheKey, 20_000, async () => {
      const [reserves, oracle] = await Promise.all([
        Promise.all(chainTokens(chainId).map((token) => readReserve(chainId, token))),
        oraclePrices(chainId)
      ]);
      const markets = reserves
        .filter((reserve) => reserve.ok && reserve.listed)
        .map((reserve) => ({
          asset: reserve.symbol,
          address: reserve.address,
          supplyApy: reserve.supplyApy,
          borrowApy: reserve.borrowApy,
          /* Totals need the UiPoolDataProvider aggregation — honest nulls until the indexer lands (§19). */
          totalSupply: null,
          totalBorrow: null,
          availableLiquidity: null,
          ltv: reserve.ltv,
          liquidationThreshold: reserve.liquidationThreshold,
          liquidationBonus: reserve.liquidationBonus,
          oraclePrice: oracle.ok ? (oracle.prices[reserve.symbol] ?? null) : null,
          status: reserve.status
        }));
      return {
        data: { network: String(chainId), markets },
        meta: {
          schema: 'fbt.lending-markets.v1',
          dataStatus: reserves.some((r) => r.ok) ? 'live' : 'unavailable',
          oracleStatus: oracle.ok ? oracle.status : oracle.code,
          totals: 'unavailable-until-indexer',
          circuit: breaker.state()
        }
      };
    });

    if (!payload?.data?.markets) {
      breaker.report('protocol', false, 'markets read failed');
      return safeJson(res, { error: { code: 'PROTOCOL_UNAVAILABLE', message: 'The lending protocol is not answering right now' } }, 503);
    }
    breaker.report('protocol', true);
    res.set('cache-control', 'public, max-age=20, stale-while-revalidate=60');
    return safeJson(res, payload);
  });

  /** §6: one market (by symbol or address). */
  router.get('/markets/:market', async (req, res) => {
    const chainId = Number(req.query.network || 42161);
    const token = findToken(chainId, req.params.market);
    if (!token) return safeJson(res, { error: { code: 'NOT_A_RESERVE', message: 'This asset is not a lending market on this network' } }, 404);
    const reserve = await readReserve(chainId, token);
    if (!reserve.ok) return safeJson(res, { error: { code: reserve.code, message: 'The protocol is not answering right now' } }, 503);
    if (!reserve.listed) return safeJson(res, { error: { code: 'NOT_A_RESERVE', message: 'This asset is not a lending market on this network' } }, 404);
    return safeJson(res, { data: reserve, meta: { schema: 'fbt.lending-market.v1', dataStatus: 'live' } });
  });

  /** §7: the user's position, re-verified on-chain every call — never cached. */
  router.get('/positions/:wallet', async (req, res) => {
    const chainId = Number(req.query.network || 42161);
    const wallet = walletKey(req.params.wallet);
    if (!wallet) return safeJson(res, { error: { code: 'BAD_REQUEST', message: 'Wallet address is invalid' } }, 400);
    const pool = poolFor(chainId);
    if (!pool) return safeJson(res, { error: { code: 'UNSUPPORTED_CHAIN', message: 'Lending is not wired on this network' } }, 404);

    const [account, reserves] = await Promise.all([
      readUserAccount(chainId, wallet),
      Promise.all(chainTokens(chainId).map((token) => readReserve(chainId, token)))
    ]);
    if (!account.ok) {
      breaker.report('protocol', false, account.code);
      return safeJson(res, { error: { code: account.code || 'PROTOCOL_UNAVAILABLE', message: 'The lending protocol is not answering right now' } }, 503);
    }
    breaker.report('protocol', true);

    const positions = [];
    for (const reserve of reserves) {
      if (!reserve.ok || !reserve.listed) continue;
      const token = findToken(chainId, reserve.address);
      const balances = await readTokenBalances(chainId, wallet, token, reserve);
      if (balances.suppliedWei === '0' && balances.debtWei === '0') continue;
      positions.push({
        asset: reserve.symbol,
        address: token.address,
        supplied: balances.suppliedWei,
        borrowed: balances.debtWei,
        walletBalance: balances.walletWei,
        collateral: BigInt(balances.suppliedWei) > 0n,
        supplyApy: reserve.supplyApy,
        borrowApy: reserve.borrowApy
      });
    }

    const risk = assessPosition({
      healthFactor: account.healthFactor,
      totalDebtUsd: account.totalDebtUsd,
      totalCollateralUsd: account.totalCollateralUsd,
      liquidationThresholdPct: account.liquidationThresholdPct
    });

    return safeJson(res, {
      wallet,
      network: chainId,
      positions,
      healthFactor: account.healthFactor,
      totalCollateralUsd: account.totalCollateralUsd,
      totalDebtUsd: account.totalDebtUsd,
      availableBorrowsUsd: account.availableBorrowsUsd,
      liquidationThresholdPct: account.liquidationThresholdPct,
      liquidationRisk: risk.liquidationRisk,
      riskLevel: risk.riskLevel,
      meta: { schema: 'fbt.lending-position.v1', dataStatus: 'live', source: 'on-chain' }
    });
  });

  /* ── quotes + transaction building (§10/§11/§29/§30) ──────────────────────
     Every POST below VALIDATES and BUILDS. Nothing is signed, nothing is
     broadcast. The response is an unsigned payload for the user's wallet. */

  const quoteHandler = (action) => async (req, res) => {
    if (breaker.state() === CIRCUIT_STATE.READ_ONLY) {
      return safeJson(res, { error: { code: 'READ_ONLY_MODE', message: 'Lending is in read-only mode while network data is verified' } }, 503);
    }
    const idemKey = req.get('idempotency-key');
    if (typeof idemKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idemKey)) {
      return safeJson(res, { error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid Idempotency-Key header is required' } }, 400);
    }
    const replay = idempotency.check(idemKey);
    if (replay.replay) return safeJson(res, replay.stored);

    const { network, asset, amount, wallet, amountWei } = req.body || {};
    const chainId = Number(network || 42161);
    const token = findToken(chainId, asset);
    if (!token) return safeJson(res, { error: { code: 'NOT_A_RESERVE', message: 'Asset is not in the lending allowlist for this network' } }, 400);
    const w = walletKey(wallet);
    if (!w) return safeJson(res, { error: { code: 'BAD_REQUEST', message: 'Wallet address is invalid' } }, 400);

    let units = null;
    if (amountWei) {
      if (!/^\d+$/.test(String(amountWei))) return safeJson(res, { error: { code: 'BAD_REQUEST', message: 'amountWei must be an integer' } }, 400);
      units = BigInt(amountWei);
    } else {
      const text = String(amount ?? '').trim().replace(',', '.');
      if (!/^\d+(\.\d+)?$/.test(text)) return safeJson(res, { error: { code: 'AMOUNT_REQUIRED', message: 'Enter an amount greater than zero' } }, 400);
      const [whole, fraction = ''] = text.split('.');
      units = BigInt((whole || '0') + (fraction + '0'.repeat(token.decimals)).slice(0, token.decimals));
    }
    if (units <= 0n) return safeJson(res, { error: { code: 'AMOUNT_REQUIRED', message: 'Enter an amount greater than zero' } }, 400);

    const reserve = await readReserve(chainId, token);
    if (!reserve.ok) return safeJson(res, { error: { code: 'PROTOCOL_UNAVAILABLE', message: 'The lending protocol is not answering right now' } }, 503);
    if (!reserve.listed) return safeJson(res, { error: { code: 'NOT_A_RESERVE', message: 'This asset is not a market on this network' } }, 400);
    if (reserve.status !== 'active') return safeJson(res, { error: { code: 'MARKET_PAUSED', message: 'This market is currently paused by the protocol' } }, 423);

    const [account, allowanceRes] = await Promise.all([
      readUserAccount(chainId, w),
      ethCall(chainId, token.address, erc20Iface.encodeFunctionData('allowance', [w, poolFor(chainId)]))
    ]);
    if (!account.ok) return safeJson(res, { error: { code: 'PROTOCOL_UNAVAILABLE', message: 'The lending protocol is not answering right now' } }, 503);
    const allowance = allowanceRes.ok ? BigInt(allowanceRes.result) : null;

    let validation = { ok: true };
    if (action === 'supply' || action === 'repay') {
      const walletBal = await ethCall(chainId, token.address, erc20Iface.encodeFunctionData('balanceOf', [w]));
      if (!walletBal.ok) return safeJson(res, { error: { code: 'RPC_ERROR', message: 'The network connection failed. Try again.' } }, 503);
      if (BigInt(walletBal.result) < units) {
        return safeJson(res, { error: { code: 'INSUFFICIENT_BALANCE', message: 'Your wallet balance is too low for this amount' } }, 400);
      }
      if (allowance != null && allowance < units) validation = { ok: true, needsApproval: true };
      else validation = { ok: true, needsApproval: false };
    }
    if (action === 'withdraw') {
      const reserveWithdraw = reserve;
      const suppliedBal = await ethCall(chainId, reserveWithdraw.aTokenAddress, erc20Iface.encodeFunctionData('balanceOf', [w]));
      if (!suppliedBal.ok) return safeJson(res, { error: { code: 'RPC_ERROR', message: 'The network connection failed. Try again.' } }, 503);
      if (BigInt(suppliedBal.result) < units) {
        return safeJson(res, { error: { code: 'INSUFFICIENT_BALANCE', message: 'Your supplied balance is lower than this amount' } }, 400);
      }
    }
    if (action === 'borrow') {
      const available = account.availableBorrowsUsd ?? 0;
      if (Number(amount || 0) > available) {
        return safeJson(res, { error: { code: 'BORROW_LIMIT_EXCEEDED', message: 'This amount is above your borrowing limit' } }, 400);
      }
      const projected = assessPosition({
        healthFactor: null,
        totalDebtUsd: (account.totalDebtUsd ?? 0) + Number(amount || 0),
        totalCollateralUsd: account.totalCollateralUsd,
        liquidationThresholdPct: account.liquidationThresholdPct
      });
      if (projected.liquidationRisk != null && projected.liquidationRisk > 0.95) {
        return safeJson(res, { error: { code: 'HEALTH_FACTOR_TOO_LOW', message: 'This would push your health factor below the safe limit' } }, 400);
      }
    }

    const plan = { approve: action === 'supply' || action === 'repay' ? (validation.needsApproval ? units : null) : null };
    const built = buildActionTx({ action, chainId, token, amountWei: units.toString(), wallet: w, plan });
    if (!built.ok) return safeJson(res, { error: { code: built.code, message: 'Unknown action' } }, 400);

    /* Simulate: gas estimate over the FINAL action tx — never the approval. */
    const gas = await estimateGas(chainId, built.txs[built.txs.length - 1], w);
    if (!gas.ok) {
      breaker.report('data', false, gas.code);
      return safeJson(res, { error: { code: gas.code, message: 'The network could not estimate this transaction' } }, 503);
    }
    breaker.report('data', true);

    const requestId = makeRequestId();
    const response = {
      data: {
        requestId,
        idempotencyKey: idemKey,
        action,
        network: chainId,
        pool: poolFor(chainId),
        asset: token.symbol,
        assetAddress: token.address,
        amount: String(amount ?? ''),
        amountWei: units.toString(),
        quote: {
          supplyApy: action === 'supply' ? reserve.supplyApy : null,
          borrowApy: action === 'borrow' ? reserve.borrowApy : null,
          needsApproval: Boolean(plan.approve)
        },
        transactions: built.txs.map((tx) => ({
          ...tx,
          chainId,
          gas: gas.gas,
          /* Unsigned by construction. */
          signed: false,
          broadcast: false,
          capabilities: { sign: 'wallet-only', broadcast: 'wallet-only' }
        })),
        status: 'built'
      },
      meta: {
        schema: 'fbt.lending-transaction-build.v1',
        dataStatus: 'live',
        security: {
          privateKeys: 'never-held',
          signing: 'wallet-only',
          broadcasting: 'wallet-only',
          allowlist: 'pool-and-token-addresses-verified'
        }
      }
    };
    idempotency.remember(idemKey, response);
    builtTransactions.set(w, [response.data, ...(builtTransactions.get(w) || [])].slice(0, 50));
    return safeJson(res, response);
  };

  router.post('/quote/supply', quoteHandler('supply'));
  router.post('/quote/borrow', quoteHandler('borrow'));
  router.post('/quote/repay', quoteHandler('repay'));
  router.post('/quote/withdraw', quoteHandler('withdraw'));
  router.post('/transaction/supply', quoteHandler('supply'));
  router.post('/transaction/borrow', quoteHandler('borrow'));
  router.post('/transaction/repay', quoteHandler('repay'));
  router.post('/transaction/withdraw', quoteHandler('withdraw'));

  /** §16/§19: transactions this BFF built for a wallet (unsigned, memory). */
  router.get('/transactions/:wallet', (req, res) => {
    const wallet = walletKey(req.params.wallet);
    if (!wallet) return safeJson(res, { error: { code: 'BAD_REQUEST', message: 'Wallet address is invalid' } }, 400);
    return safeJson(res, {
      data: builtTransactions.get(wallet) || [],
      meta: { schema: 'fbt.lending-transactions.v1', dataStatus: 'live', source: 'memory', note: 'Built unsigned transactions only — nothing is ever broadcast by the backend' }
    });
  });

  /** §22/§23: alert evaluation over the live position + subscriptions. */
  router.get('/alerts/:wallet', async (req, res) => {
    const chainId = Number(req.query.network || 42161);
    const wallet = walletKey(req.params.wallet);
    if (!wallet) return safeJson(res, { error: { code: 'BAD_REQUEST', message: 'Wallet address is invalid' } }, 400);
    const account = await readUserAccount(chainId, wallet);
    if (!account.ok) return safeJson(res, { error: { code: 'PROTOCOL_UNAVAILABLE', message: 'The lending protocol is not answering right now' } }, 503);
    const risk = assessPosition({
      healthFactor: account.healthFactor,
      totalDebtUsd: account.totalDebtUsd,
      totalCollateralUsd: account.totalCollateralUsd,
      liquidationThresholdPct: account.liquidationThresholdPct
    });
    const oracle = breaker.snapshot().failures.oracle ? { status: 'stale' } : { status: 'ok' };
    const alerts = evaluateAlerts({ position: risk, oracle });
    return safeJson(res, {
      data: alerts,
      meta: { schema: 'fbt.lending-alerts.v1', dataStatus: 'live', generatedAt: new Date().toISOString() }
    });
  });

  router.post('/alerts', (req, res) => {
    const { wallet, rules } = req.body || {};
    const w = walletKey(wallet);
    if (!w || !Array.isArray(rules) || rules.length === 0) {
      return safeJson(res, { error: { code: 'BAD_REQUEST', message: 'wallet and a non-empty rules array are required' } }, 400);
    }
    const allowed = ['HEALTH_FACTOR_LOW', 'LTV_HIGH', 'COLLATERAL_DROP', 'BORROW_APY_CHANGE', 'SUPPLY_APY_CHANGE', 'LIQUIDATION_DISTANCE', 'ORACLE_ANOMALY', 'POSITION_CHANGED', 'TRANSACTION_FAILED'];
    const clean = rules.filter((rule) => allowed.includes(rule));
    if (!clean.length) return safeJson(res, { error: { code: 'BAD_REQUEST', message: 'No supported alert rules' } }, 400);
    const subscription = { id: makeRequestId(), rules: clean, at: new Date().toISOString() };
    alertSubscriptions.set(w, [...(alertSubscriptions.get(w) || []), subscription]);
    return safeJson(res, { data: subscription, meta: { schema: 'fbt.lending-alert-subscription.v1', dataStatus: 'live', persistence: 'memory' } }, 201);
  });

  router.delete('/alerts/:id', (req, res) => {
    const id = String(req.params.id || '');
    let removed = false;
    for (const [wallet, subs] of alertSubscriptions) {
      const next = subs.filter((s) => s.id !== id);
      if (next.length !== subs.length) {
        removed = true;
        if (next.length) alertSubscriptions.set(wallet, next);
        else alertSubscriptions.delete(wallet);
      }
    }
    return safeJson(res, removed
      ? { data: { removed: true }, meta: { schema: 'fbt.lending-alert-subscription.v1' } }
      : { error: { code: 'NOT_FOUND', message: 'No such alert subscription' } }, removed ? 200 : 404);
  });

  return router;
}
