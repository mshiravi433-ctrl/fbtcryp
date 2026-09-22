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
  43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  59144: '0xc47b8C00b0f69a36fa203Ffeac0334874574a8Ac',
  146: '0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3'
});

/** Reserve symbols per chain (mirror of src/lib/lending.js). A FILTER, not a promise. */
const RESERVE_SYMBOLS = Object.freeze({
  1: ['USDT', 'USDC', 'DAI', 'WBTC', 'LINK'],
  10: ['USDT', 'USDC'],
  56: ['USDT', 'USDC', 'BTCB', 'ETH'],
  137: ['USDT', 'USDC', 'DAI', 'WETH'],
  8453: ['USDC', 'cbBTC'],
  42161: ['USDT', 'USDC', 'WBTC', 'ARB'],
  43114: ['USDT', 'USDC', 'WETH'],
  59144: ['USDC', 'USDT', 'WETH'],
  146: ['USDC', 'wS', 'stS']
});

export const POOL_ABI = [
  'function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getPriceOracle() view returns (address)'
];
/* The pool's OWN price oracle (§21). This is the price the protocol would use
   to liquidate you, so it is the only price this BFF is allowed to call an
   oracle price. Anything else is a reference and is labelled as one. */
export const ORACLE_ABI = [
  'function getAssetPrice(address asset) view returns (uint256)',
  'function getAssetsPrices(address[] calldata assets) view returns (uint256[] calldata)',
  'function BASE_CURRENCY_UNIT() view returns (uint256)'
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
const oracleIface = new Interface(ORACLE_ABI);
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

/* Bit layout of the Aave V3 reserve configuration bitmap. This mirrors
   RESERVE_CONFIG_BITS in src/lib/lending.js — the server cannot import that
   file (it pulls the Vite chain registry into Node), so the two are kept in
   step by `test/lending-bff-config-probe.test.js`, which decodes the same
   bitmap through both and fails if they ever disagree. */
export const RESERVE_CONFIG_BITS = Object.freeze({
  ltvShift: 0n,
  liquidationThresholdShift: 16n,
  liquidationBonusShift: 32n,
  decimalsShift: 48n,
  activeShift: 56n,
  frozenShift: 57n,
  borrowingEnabledShift: 58n,
  pausedShift: 60n,
  borrowCapShift: 80n,
  supplyCapShift: 116n,
  capBits: 36n
});

const bitAt = (raw, shift) => ((raw >> shift) & 1n) === 1n;
const fieldAt = (raw, shift, bits) => (raw >> shift) & ((1n << bits) - 1n);
/** Aave's cap field: 0 means unlimited, so it is null here, never 0. */
const capOrNull = (value) => (value > 0n ? Number(value) : null);

/**
 * Decode the reserve configuration bitmap.
 *
 * A ZERO bitmap is not "0% LTV, active, no caps" — it is "this read produced
 * nothing usable". Every derived value is then null and the status is
 * `unknown`, so no caller can mistake a failed read for a reserve that is open
 * and unlimited (§3/§37).
 */
export function decodeReserveConfig(configuration) {
  let raw;
  try { raw = BigInt(configuration ?? 0); } catch { raw = 0n; }
  const b = RESERVE_CONFIG_BITS;
  const readable = raw !== 0n;
  if (!readable) {
    return {
      readable: false, decimals: null, ltv: null, liquidationThreshold: null,
      liquidationBonus: null, active: null, frozen: null, paused: null,
      borrowingEnabled: null, supplyCapWhole: null, borrowCapWhole: null,
      status: 'unknown'
    };
  }
  const paused = bitAt(raw, b.pausedShift);
  const frozen = bitAt(raw, b.frozenShift);
  const ltvBps = Number(fieldAt(raw, b.ltvShift, 16n));
  const thresholdBps = Number(fieldAt(raw, b.liquidationThresholdShift, 16n));
  const bonusBps = Number(fieldAt(raw, b.liquidationBonusShift, 16n));
  return {
    readable: true,
    decimals: Number(fieldAt(raw, b.decimalsShift, 8n)),
    /* bps → percent; a genuine 0 stays 0 rather than becoming null, because
       "readable but zero" is a real (if unusual) protocol state. */
    ltv: ltvBps / 100,
    liquidationThreshold: thresholdBps / 100,
    liquidationBonus: bonusBps / 100,
    active: bitAt(raw, b.activeShift),
    frozen,
    paused,
    borrowingEnabled: bitAt(raw, b.borrowingEnabledShift),
    /* Whole tokens. Aave uses 0 to mean "no cap", so 0 is reported as null
       (unlimited) rather than as a cap of zero tokens — which would read as
       "nobody may supply this" and block a market that is in fact open. This
       matches src/lib/lending.js exactly; the cross-check test pins it. */
    supplyCapWhole: capOrNull(fieldAt(raw, b.supplyCapShift, b.capBits)),
    borrowCapWhole: capOrNull(fieldAt(raw, b.borrowCapShift, b.capBits)),
    status: paused ? 'paused' : frozen ? 'frozen' : 'active'
  };
}

export async function readReserve(chainId, token) {
  const pool = poolFor(chainId);
  if (!pool || !token) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  const [res, decimalsCall] = await Promise.all([
    ethCall(chainId, pool, poolIface.encodeFunctionData('getReserveData', [token.address])),
    ethCall(chainId, token.address, erc20Iface.encodeFunctionData('decimals', []))
  ]);
  if (!res.ok) return res;
  const decoded = poolIface.decodeFunctionResult('getReserveData', res.result);
  const data = decoded[0];
  const aToken = String(data.aTokenAddress || '');
  const listed = isAddress(aToken) && aToken !== ZERO;
  const config = decodeReserveConfig(data.configuration);
  /* §18 — the token contract is the authority on its own decimals. When the
     reserve bitmap disagrees, that is reported rather than silently resolved:
     a wrong decimal count turns a correct-looking amount into a 10^n error. */
  let verifiedDecimals = null;
  if (decimalsCall.ok) {
    try {
      verifiedDecimals = Number(erc20Iface.decodeFunctionResult('decimals', decimalsCall.result)[0]);
      if (!Number.isInteger(verifiedDecimals) || verifiedDecimals < 0 || verifiedDecimals > 36) verifiedDecimals = null;
    } catch { verifiedDecimals = null; }
  }
  const decimals = verifiedDecimals ?? config.decimals ?? (Number.isInteger(token.decimals) ? Number(token.decimals) : null);
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
    /* Spread first: `decimals` below is the RECONCILED value (token contract
       wins over the bitmap, §18), and must not be clobbered by the raw one. */
    ...config,
    decimals,
    decimalsSource: verifiedDecimals != null ? 'token-contract' : (config.decimals != null ? 'reserve-configuration' : 'registry'),
    decimalsMatch: verifiedDecimals != null && config.decimals != null ? verifiedDecimals === config.decimals : null
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

/* ── oracle (§21) — the PROTOCOL's own price feed, with a labelled reference ─ */

/**
 * Read the price oracle the pool itself uses.
 *
 * This is the price that decides whether a position gets liquidated, so it is
 * the only price this BFF reports as an oracle price. The chain of reads is:
 * pool.getPriceOracle() → oracle.BASE_CURRENCY_UNIT() → oracle.getAssetPrice()
 * per asset (batched through getAssetsPrices when the deployment supports it).
 *
 * A zero price is treated as MISSING, not as "$0": an asset the oracle has no
 * feed for returns 0, and reporting that as a real price would value someone's
 * collateral at nothing and tell them they are liquidatable (§21).
 */
export async function readProtocolOracle(chainId) {
  const pool = poolFor(chainId);
  const tokens = chainTokens(chainId);
  if (!pool) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  if (!tokens.length) return { ok: false, code: 'NO_TOKENS' };

  const oracleCall = await ethCall(chainId, pool, poolIface.encodeFunctionData('getPriceOracle', []));
  if (!oracleCall.ok) {
    breaker.report('oracle', false, oracleCall.code || 'ORACLE_READ_FAILED');
    return { ok: false, code: oracleCall.code || 'ORACLE_READ_FAILED' };
  }
  let oracleAddress = null;
  try {
    const decoded = poolIface.decodeFunctionResult('getPriceOracle', oracleCall.result);
    oracleAddress = String(decoded[0] || '');
  } catch { oracleAddress = ''; }
  /* An RPC that answers every call with empty data (a captive portal, a
     pruning node, a wrong endpoint) lands here. That is "no oracle", not
     "oracle at 0x0". */
  if (!isAddress(oracleAddress) || oracleAddress === ZERO) {
    breaker.report('oracle', false, 'NO_ORACLE_ON_POOL');
    return { ok: false, code: 'NO_ORACLE_ON_POOL' };
  }

  /* The base-currency scale is read, not assumed: 1e8 on the USD deployments,
     but the oracle is the authority on its own unit. */
  let baseUnit = 10n ** BigInt(BASE_DECIMALS);
  let baseUnitRead = false;
  const unitCall = await ethCall(chainId, oracleAddress, oracleIface.encodeFunctionData('BASE_CURRENCY_UNIT', []));
  if (unitCall.ok) {
    try {
      const decoded = oracleIface.decodeFunctionResult('BASE_CURRENCY_UNIT', unitCall.result);
      const value = BigInt(decoded[0] ?? 0);
      if (value > 0n) { baseUnit = value; baseUnitRead = true; }
    } catch { /* keep the documented default, flagged as unread below */ }
  }

  const addresses = tokens.map((token) => token.address);
  /** symbol → base-currency integer, or null when the feed had nothing. */
  const base = new Map(tokens.map((token) => [token.symbol, null]));

  /* One batched call first; some deployments do not expose it, so fall back to
     per-asset reads rather than reporting the whole oracle as down. */
  let batched = false;
  const batchCall = await ethCall(chainId, oracleAddress, oracleIface.encodeFunctionData('getAssetsPrices', [addresses]));
  if (batchCall.ok) {
    try {
      const decoded = oracleIface.decodeFunctionResult('getAssetsPrices', batchCall.result);
      const values = decoded[0];
      if (Array.isArray(values) && values.length === addresses.length) {
        tokens.forEach((token, i) => {
          const value = BigInt(values[i] ?? 0);
          if (value > 0n) base.set(token.symbol, value);
        });
        batched = true;
      }
    } catch { batched = false; }
  }
  if (!batched) {
    const singles = await Promise.all(tokens.map(async (token) => {
      const call = await ethCall(chainId, oracleAddress, oracleIface.encodeFunctionData('getAssetPrice', [token.address]));
      if (!call.ok) return null;
      try {
        const decoded = oracleIface.decodeFunctionResult('getAssetPrice', call.result);
        const value = BigInt(decoded[0] ?? 0);
        return value > 0n ? value : null;
      } catch { return null; }
    }));
    tokens.forEach((token, i) => { if (singles[i] != null) base.set(token.symbol, singles[i]); });
  }

  const priced = tokens.filter((token) => base.get(token.symbol) != null);
  if (!priced.length) {
    breaker.report('oracle', false, 'ORACLE_PRICE_UNAVAILABLE');
    return { ok: false, code: 'ORACLE_PRICE_UNAVAILABLE', oracleAddress };
  }
  breaker.report('oracle', true);

  const prices = {};
  const pricesBase = {};
  for (const token of priced) {
    const value = base.get(token.symbol);
    pricesBase[token.symbol] = value.toString();
    prices[token.symbol] = Number(value) / Number(baseUnit);
  }
  return {
    ok: true,
    source: 'aave-oracle',
    oracleAddress,
    baseUnit: baseUnit.toString(),
    baseUnitRead,
    prices,
    pricesBase,
    missing: tokens.filter((token) => base.get(token.symbol) == null).map((token) => token.symbol),
    status: priced.length === tokens.length ? 'ok' : 'partial',
    readVia: batched ? 'getAssetsPrices' : 'getAssetPrice'
  };
}

/** A third-party price used ONLY to flag a deviating protocol price (§21).
    It is never returned as an oracle price, and its failure is not an oracle
    failure — the on-chain read stands on its own without it (§32). */
async function referencePrices(chainId) {
  const tokens = chainTokens(chainId);
  const ids = tokens.map((token) => token.coingeckoId).filter(Boolean);
  if (!ids.length) return { ok: false, code: 'NO_PRICE_IDS', prices: {} };
  try {
    const raw = await fetchSimplePrices(ids, 'usd');
    const prices = {};
    for (const token of tokens) {
      const value = raw?.[token.coingeckoId]?.usd;
      if (Number.isFinite(value) && value > 0) prices[token.symbol] = value;
    }
    if (!Object.keys(prices).length) return { ok: false, code: 'REFERENCE_UNAVAILABLE', prices: {} };
    return { ok: true, source: 'coingecko-reference', prices };
  } catch (error) {
    /* Deliberately NOT reported to the breaker as an oracle failure: this is a
       convenience cross-check, and a CoinGecko outage must not flip lending
       read-only when the protocol's own oracle is answering fine. */
    return { ok: false, code: 'REFERENCE_UNAVAILABLE', detail: String(error?.message || error).slice(0, 80), prices: {} };
  }
}

/** A protocol price that disagrees with the reference by this much is flagged
    as an anomaly rather than silently used (§21). */
const ORACLE_ANOMALY_RATIO = 0.1;

/**
 * The oracle view this BFF serves: the protocol's own prices, plus an
 * explicitly-labelled third-party reference and any asset where the two
 * disagree sharply.
 *
 * `prices` stays `{ SYMBOL: usdNumber }` because server/ci/sources.js already
 * consumes that shape; the base-currency integers are alongside in
 * `pricesBase` for any caller that must not round.
 */
export async function oraclePrices(chainId) {
  const protocol = await readProtocolOracle(chainId);
  const reference = await referencePrices(chainId);

  if (!protocol.ok) {
    return {
      ok: false,
      code: protocol.code,
      source: 'aave-oracle',
      /* The reference is still passed through — labelled as what it is — so a
         caller can show "protocol oracle unavailable" next to an indicative
         price instead of showing nothing at all. It is never promoted to being
         the oracle price. */
      reference: reference.ok ? reference : { ok: false, code: reference.code },
      status: 'unavailable'
    };
  }

  const anomalies = [];
  if (reference.ok) {
    for (const [symbol, usd] of Object.entries(protocol.prices)) {
      const ref = reference.prices[symbol];
      if (!Number.isFinite(ref) || ref <= 0) continue;
      const deviation = Math.abs(usd - ref) / ref;
      if (deviation > ORACLE_ANOMALY_RATIO) {
        anomalies.push({ symbol, oracleUsd: usd, referenceUsd: ref, deviationPct: Math.round(deviation * 10000) / 100 });
      }
    }
  }

  return {
    ...protocol,
    reference: reference.ok ? reference : { ok: false, code: reference.code },
    anomalies,
    status: anomalies.length ? 'anomaly' : protocol.status
  };
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
    const evm = chainIds().map((chainId) => {
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
    });
    safeJson(res, {
      data: [...evm, {
        chainId: 900001,
        name: 'Solana',
        nativeToken: 'SOL',
        rpcCount: 2,
        explorer: 'https://solscan.io',
        protocols: ['kamino-klend'],
        oracle: 'kamino-oracle',
        enabled: true,
        pool: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF'
      }],
      meta: { schema: 'fbt.lending-networks.v1', dataStatus: 'live' }
    });
  });

  /** §6: live markets — pool rates, risk parameters, oracle prices. */
  router.get('/markets', async (req, res) => {
    const chainId = Number(req.query.network || 42161);
    const pool = poolFor(chainId);
    if (!pool) return safeJson(res, { error: { code: 'UNSUPPORTED_CHAIN', message: 'Lending is not wired on this network' } }, 404);

    const cacheKey = `lending:markets:${chainId}`;
    /* `withCache` returns a `{ value, cached, stale }` envelope — every other
       caller in this repo destructures `value`. This route used to treat the
       envelope itself as the payload, so `payload.data` was always undefined
       and the endpoint answered 503 on EVERY call — which is exactly why the
       /loan page's server fallback for oracle prices never fired and users
       only ever saw «قیمت‌های اوراکل خوانده نشد». (2026-09-22) */
    const { value: payload } = await withCache(cacheKey, 20_000, async () => {
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
          decimals: reserve.decimals,
          ltv: reserve.ltv,
          liquidationThreshold: reserve.liquidationThreshold,
          liquidationBonus: reserve.liquidationBonus,
          borrowingEnabled: reserve.borrowingEnabled,
          supplyCapWhole: reserve.supplyCapWhole,
          borrowCapWhole: reserve.borrowCapWhole,
          /* §21 — the protocol's own oracle price, and the integer base-currency
             value behind it so a caller that must not round can use that. */
          oraclePrice: oracle.ok ? (oracle.prices[reserve.symbol] ?? null) : null,
          oraclePriceBase: oracle.ok ? (oracle.pricesBase[reserve.symbol] ?? null) : null,
          /* A third-party cross-check, labelled as one. Never the oracle price. */
          referencePrice: oracle.reference?.ok ? (oracle.reference.prices[reserve.symbol] ?? null) : null,
          anomaly: (oracle.anomalies || []).find((a) => a.symbol === reserve.symbol) ?? null,
          status: reserve.status
        }));
      return {
        data: { network: String(chainId), markets },
        meta: {
          schema: 'fbt.lending-markets.v2',
          dataStatus: reserves.some((r) => r.ok) ? 'live' : 'unavailable',
          oracleStatus: oracle.ok ? oracle.status : 'unavailable',
          oracleSource: oracle.ok ? oracle.source : null,
          oracleAddress: oracle.ok ? oracle.oracleAddress : null,
          oracleCode: oracle.ok ? null : oracle.code,
          oracleMissing: oracle.ok ? oracle.missing : null,
          referenceSource: oracle.reference?.ok ? oracle.reference.source : null,
          totals: 'unavailable-until-indexer',
          readAt: Date.now(),
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
    /* Every listed reserve's RAW balances, by symbol — including the zero
       positions that are skipped below. The /loan page falls back to this map
       for its wallet-balance pre-flight when the browser's own RPC path is
       dead (supply needs the balance of an asset the user never deposited,
       which the filtered `positions` array deliberately omits). */
    const balancesBySymbol = {};
    /* 2026-09-22: these reads used to run SEQUENTIALLY (one `await` per
       reserve inside the loop) — 3 eth_calls × N reserves back-to-back, which
       pushed a cold Vercel invocation past the client's 6.5s BFF timeout and
       left the page on BALANCE_UNKNOWN exactly when the fallback was needed.
       They are independent reads; they now run concurrently. */
    const listed = reserves.filter((reserve) => reserve?.ok && reserve.listed);
    const balanceRows = await Promise.all(listed.map(async (reserve) => {
      const token = findToken(chainId, reserve.address);
      if (!token) return null;
      const balances = await readTokenBalances(chainId, wallet, token, reserve);
      return { reserve, token, balances };
    }));
    const isZeroWei = (value) => {
      /* Balances arrive as 0x-hex (or null when the call failed). The old
         `=== '0'` comparison never matched a hex zero, so empty positions
         were never skipped. A failed read is NOT zero — it stays listed so
         the caller can see the position exists but its size is unknown. */
      if (value == null) return false;
      try { return BigInt(value) === 0n; } catch { return false; }
    };
    for (const row of balanceRows) {
      if (!row) continue;
      const { reserve, token, balances } = row;
      balancesBySymbol[reserve.symbol] = {
        walletWei: balances.walletWei,
        suppliedWei: balances.suppliedWei,
        debtWei: balances.debtWei
      };
      if (isZeroWei(balances.suppliedWei) && isZeroWei(balances.debtWei)) continue;
      let hasCollateral = false;
      try { hasCollateral = BigInt(balances.suppliedWei ?? 0) > 0n; } catch { hasCollateral = false; }
      positions.push({
        asset: reserve.symbol,
        address: token.address,
        supplied: balances.suppliedWei,
        borrowed: balances.debtWei,
        walletBalance: balances.walletWei,
        collateral: hasCollateral,
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
      balances: balancesBySymbol,
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
    /* The oracle status is READ, not inferred from the circuit breaker: a
       breaker with no oracle failures yet would otherwise report "ok" for an
       oracle this process has never successfully reached (§3). */
    const oracle = await oraclePrices(chainId);
    const oracleView = oracle.ok
      ? { status: oracle.status === 'anomaly' ? 'anomaly' : (oracle.missing?.length ? 'partial' : 'ok'), staleAssets: oracle.missing }
      : { status: 'unavailable', code: oracle.code };
    const alerts = evaluateAlerts({ position: risk, oracle: oracleView });
    return safeJson(res, {
      data: alerts,
      meta: {
        schema: 'fbt.lending-alerts.v2',
        dataStatus: 'live',
        oracleStatus: oracleView.status,
        oracleCode: oracle.ok ? null : oracle.code,
        generatedAt: new Date().toISOString()
      }
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
